// Copyright Valkey GLIDE Project Contributors - SPDX Identifier: Apache-2.0

mod types;

use crate::cluster_scan_container::insert_cluster_scan_cursor;
use crate::scripts_container::get_script;
use futures::FutureExt;
use logger_core::{log_error, log_info, log_warn};
use once_cell::sync::OnceCell;
use redis::aio::ConnectionLike;
use redis::cluster_async::ClusterConnection;
use redis::cluster_routing::{
    MultipleNodeRoutingInfo, ResponsePolicy, Routable, RoutingInfo, SingleNodeRoutingInfo,
};
use redis::cluster_slotmap::ReadFromReplicaStrategy;
use redis::{
    ClusterScanArgs, Cmd, ErrorKind, FromRedisValue, PipelineRetryStrategy, PushInfo, RedisError,
    RedisResult, RetryStrategy, ScanStateRC, Value,
};
pub use standalone_client::StandaloneClient;
use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::thread;
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::runtime::{Builder, Handle};
pub use types::*;

use self::value_conversion::{convert_to_expected_type, expected_type_for_cmd, get_value_type};
mod reconnecting_connection;
mod standalone_client;
mod value_conversion;
use redis::InfoDict;
use telemetrylib::GlideOpenTelemetry;
use tokio::sync::{Notify, RwLock, mpsc, oneshot};
use versions::Versioning;

pub const HEARTBEAT_SLEEP_DURATION: Duration = Duration::from_secs(1);
pub const DEFAULT_RETRIES: u32 = 3;
/// Note: If you change the default value, make sure to change the documentation in *all* wrappers.
pub const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_millis(250);
pub const DEFAULT_PERIODIC_TOPOLOGY_CHECKS_INTERVAL: Duration = Duration::from_secs(60);
/// Note: If you change the default value, make sure to change the documentation in *all* wrappers.
pub const DEFAULT_CONNECTION_TIMEOUT: Duration = Duration::from_millis(250);
pub const FINISHED_SCAN_CURSOR: &str = "finished";

/// The value of 1000 for the maximum number of inflight requests is determined based on Little's Law in queuing theory:
///
/// Expected maximum request rate: 50,000 requests/second
/// Expected response time: 1 millisecond
///
/// According to Little's Law, the maximum number of inflight requests required to fully utilize the maximum request rate is:
///   (50,000 requests/second) × (1 millisecond / 1000 milliseconds) = 50 requests
///
/// The value of 1000 provides a buffer for bursts while still allowing full utilization of the maximum request rate.
pub const DEFAULT_MAX_INFLIGHT_REQUESTS: u32 = 1000;

/// The connection check interval is currently not exposed to the user via ConnectionRequest,
/// as improper configuration could negatively impact performance or pub/sub resiliency.
/// A 3-second interval provides a reasonable balance between connection validation
/// and performance overhead.
pub const CONNECTION_CHECKS_INTERVAL: Duration = Duration::from_secs(3);

/// A static Glide runtime instance
static RUNTIME: OnceCell<GlideRt> = OnceCell::new();

pub struct GlideRt {
    pub runtime: Handle,
    pub(crate) thread: Option<JoinHandle<()>>,
    shutdown_notifier: Arc<Notify>,
}

/// Initializes a single-threaded Tokio runtime in a dedicated thread (if not already initialized)
/// and returns a static reference to the `GlideRt` wrapper, which holds the runtime handle and a shutdown notifier.
/// The runtime remains active indefinitely until a shutdown is triggered via the notifier, allowing tasks to be spawned
/// throughout the lifetime of the application.
pub fn get_or_init_runtime() -> Result<&'static GlideRt, String> {
    RUNTIME.get_or_try_init(|| {
        let notify = Arc::new(Notify::new());
        let notify_thread = notify.clone();

        let (tx, rx) = oneshot::channel();

        let thread_handle = thread::Builder::new()
            .name("glide-runtime-thread".into())
            .spawn(move || {
                match Builder::new_current_thread().enable_all().build() {
                    Ok(runtime) => {
                        let _ = tx.send(Ok(runtime.handle().clone()));
                        // Keep runtime alive until shutdown is signaled
                        runtime.block_on(notify_thread.notified());
                    }
                    Err(err) => {
                        let _ = tx.send(Err(format!("Failed to create runtime: {err}")));
                    }
                }
            })
            .map_err(|_| "Failed to spawn runtime thread".to_string())?;

        let runtime_handle = rx
            .blocking_recv()
            .map_err(|err| format!("Failed to receive runtime handle: {err:?}"))??;

        Ok(GlideRt {
            runtime: runtime_handle,
            thread: Some(thread_handle),
            shutdown_notifier: notify,
        })
    })
}

impl Drop for GlideRt {
    fn drop(&mut self) {
        if let Some(rt) = RUNTIME.get() {
            rt.shutdown_notifier.notify_one();
        }

        // Move the JoinHandle out of the Option and join it
        if let Some(handle) = self.thread.take() {
            handle.join().expect("GlideRt thread panicked");
        }
    }
}

pub(super) fn get_port(address: &NodeAddress) -> u16 {
    const DEFAULT_PORT: u16 = 6379;
    if address.port == 0 {
        DEFAULT_PORT
    } else {
        address.port
    }
}

pub(super) fn get_redis_connection_info(
    connection_request: &ConnectionRequest,
) -> redis::RedisConnectionInfo {
    let protocol = connection_request.protocol.unwrap_or_default();
    let db = connection_request.database_id;
    let client_name = connection_request.client_name.clone();
    let pubsub_subscriptions = connection_request.pubsub_subscriptions.clone();
    match &connection_request.authentication_info {
        Some(info) => redis::RedisConnectionInfo {
            db,
            username: info.username.clone(),
            password: info.password.clone(),
            protocol,
            client_name,
            pubsub_subscriptions,
        },
        None => redis::RedisConnectionInfo {
            db,
            protocol,
            client_name,
            pubsub_subscriptions,
            ..Default::default()
        },
    }
}

pub(super) fn get_connection_info(
    address: &NodeAddress,
    tls_mode: TlsMode,
    redis_connection_info: redis::RedisConnectionInfo,
) -> redis::ConnectionInfo {
    let addr = if tls_mode != TlsMode::NoTls {
        redis::ConnectionAddr::TcpTls {
            host: address.host.to_string(),
            port: get_port(address),
            insecure: tls_mode == TlsMode::InsecureTls,
            tls_params: None,
        }
    } else {
        redis::ConnectionAddr::Tcp(address.host.to_string(), get_port(address))
    };
    redis::ConnectionInfo {
        addr,
        redis: redis_connection_info,
    }
}

#[derive(Clone)]
pub enum ClientWrapper {
    Standalone(StandaloneClient),
    Cluster { client: ClusterConnection },
    Lazy(Box<LazyClient>),
}

/// A client wrapper that defers connection until the first command is executed.
#[derive(Clone)]
pub struct LazyClient {
    config: ConnectionRequest,
    push_sender: Option<mpsc::UnboundedSender<PushInfo>>,
}

#[derive(Clone)]
pub struct Client {
    internal_client: Arc<RwLock<ClientWrapper>>,
    request_timeout: Duration,
    // Setting this counter to limit the inflight requests, in case of any queue is blocked, so we return error to the customer.
    inflight_requests_allowed: Arc<AtomicIsize>,
}

async fn run_with_timeout<T>(
    timeout: Option<Duration>,
    future: impl futures::Future<Output = RedisResult<T>> + Send,
) -> redis::RedisResult<T> {
    match timeout {
        Some(duration) => match tokio::time::timeout(duration, future).await {
            Ok(result) => result,
            Err(_) => {
                // Record timeout error metric if telemetry is initialized
                if let Err(e) = GlideOpenTelemetry::record_timeout_error() {
                    log_error(
                        "OpenTelemetry:timeout_error",
                        format!("Failed to record timeout error: {e}"),
                    );
                }
                Err(io::Error::from(io::ErrorKind::TimedOut).into())
            }
        },
        None => future.await,
    }
}

/// Extension to the request timeout for blocking commands to ensure we won't return with timeout error before the server responded
const BLOCKING_CMD_TIMEOUT_EXTENSION: f64 = 0.5; // seconds

enum TimeUnit {
    Milliseconds = 1000,
    Seconds = 1,
}

/// Enumeration representing different request timeout options.
#[derive(Default, PartialEq, Debug)]
enum RequestTimeoutOption {
    // Indicates no timeout should be set for the request.
    NoTimeout,
    // Indicates the request timeout should be based on the client's configured timeout.
    #[default]
    ClientConfig,
    // Indicates the request timeout should be based on the timeout specified in the blocking command.
    BlockingCommand(Duration),
}

/// Helper function for parsing a timeout argument to f64.
/// Attempts to parse the argument found at `timeout_idx` from bytes into an f64.
fn parse_timeout_to_f64(cmd: &Cmd, timeout_idx: usize) -> RedisResult<f64> {
    let create_err = |err_msg| {
        RedisError::from((
            ErrorKind::ResponseError,
            err_msg,
            format!(
                "Expected to find timeout value at index {:?} for command {:?}.",
                timeout_idx,
                std::str::from_utf8(&cmd.command().unwrap_or_default()),
            ),
        ))
    };
    let timeout_bytes = cmd
        .arg_idx(timeout_idx)
        .ok_or(create_err("Couldn't find timeout index"))?;
    let timeout_str = std::str::from_utf8(timeout_bytes)
        .map_err(|_| create_err("Failed to parse the timeout argument to string"))?;
    timeout_str
        .parse::<f64>()
        .map_err(|_| create_err("Failed to parse the timeout argument to f64"))
}

/// Attempts to get the timeout duration from the command argument at `timeout_idx`.
/// If the argument can be parsed into a duration, it returns the duration in seconds with BlockingCmdTimeout.
/// If the timeout argument value is zero, NoTimeout will be returned. Otherwise, ClientConfigTimeout is returned.
fn get_timeout_from_cmd_arg(
    cmd: &Cmd,
    timeout_idx: usize,
    time_unit: TimeUnit,
) -> RedisResult<RequestTimeoutOption> {
    let timeout_secs = parse_timeout_to_f64(cmd, timeout_idx)? / ((time_unit as i32) as f64);
    if timeout_secs < 0.0 {
        // Timeout cannot be negative, return the client's configured request timeout
        Err(RedisError::from((
            ErrorKind::ResponseError,
            "Timeout cannot be negative",
            format!("Received timeout = {timeout_secs:?}."),
        )))
    } else if timeout_secs == 0.0 {
        // `0` means we should set no timeout
        Ok(RequestTimeoutOption::NoTimeout)
    } else {
        // We limit the maximum timeout due to restrictions imposed by Redis and the Duration crate
        if timeout_secs > u32::MAX as f64 {
            Err(RedisError::from((
                ErrorKind::ResponseError,
                "Timeout is out of range, max timeout is 2^32 - 1 (u32::MAX)",
                format!("Received timeout = {timeout_secs:?}."),
            )))
        } else {
            // Extend the request timeout to ensure we don't timeout before receiving a response from the server.
            Ok(RequestTimeoutOption::BlockingCommand(
                Duration::from_secs_f64(
                    (timeout_secs + BLOCKING_CMD_TIMEOUT_EXTENSION).min(u32::MAX as f64),
                ),
            ))
        }
    }
}

fn get_request_timeout(cmd: &Cmd, default_timeout: Duration) -> RedisResult<Option<Duration>> {
    let command = cmd.command().unwrap_or_default();
    let timeout = match command.as_slice() {
        b"BLPOP" | b"BRPOP" | b"BLMOVE" | b"BZPOPMAX" | b"BZPOPMIN" | b"BRPOPLPUSH" => {
            get_timeout_from_cmd_arg(cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds)
        }
        b"BLMPOP" | b"BZMPOP" => get_timeout_from_cmd_arg(cmd, 1, TimeUnit::Seconds),
        b"XREAD" | b"XREADGROUP" => cmd
            .position(b"BLOCK")
            .map(|idx| get_timeout_from_cmd_arg(cmd, idx + 1, TimeUnit::Milliseconds))
            .unwrap_or(Ok(RequestTimeoutOption::ClientConfig)),
        b"WAIT" => get_timeout_from_cmd_arg(cmd, 2, TimeUnit::Milliseconds),
        _ => Ok(RequestTimeoutOption::ClientConfig),
    }?;

    match timeout {
        RequestTimeoutOption::NoTimeout => Ok(None),
        RequestTimeoutOption::ClientConfig => Ok(Some(default_timeout)),
        RequestTimeoutOption::BlockingCommand(blocking_cmd_duration) => {
            Ok(Some(blocking_cmd_duration))
        }
    }
}

impl Client {
    async fn get_or_initialize_client(&self) -> RedisResult<ClientWrapper> {
        {
            let guard = self.internal_client.read().await;
            if !matches!(&*guard, ClientWrapper::Lazy(_)) {
                return Ok(guard.clone()); // ✅ Already initialized, return clone
            }
        }

        let mut guard = self.internal_client.write().await;

        if let ClientWrapper::Lazy(lazy_client) = &mut *guard {
            let mut config = lazy_client.config.clone();
            let push_sender = lazy_client.push_sender.clone();

            // When initializing the actual connection from a lazy client,
            // the underlying connection attempt itself should not be lazy.
            config.lazy_connect = false;

            // Create the appropriate client based on configuration
            let real_client = if config.cluster_mode_enabled {
                // Create cluster client
                let client = create_cluster_client(config, push_sender).await?;
                ClientWrapper::Cluster { client }
            } else {
                // Create standalone client
                let client = StandaloneClient::create_client(config, push_sender)
                    .await
                    .map_err(|e| {
                        RedisError::from((
                            ErrorKind::IoError,
                            "Standalone connect failed",
                            format!("{e:?}"),
                        ))
                    })?;
                ClientWrapper::Standalone(client)
            };

            // Replace the lazy client with the real client
            *guard = real_client;
        }

        Ok(guard.clone()) // ✅ Return clone of the now-initialized wrapper
    }

    /// Send a command to the server.
    /// This function will route the command to the correct node, and retry if needed.
    pub fn send_command<'a>(
        &'a mut self,
        cmd: &'a Cmd,
        routing: Option<RoutingInfo>,
    ) -> redis::RedisFuture<'a, Value> {
        Box::pin(async move {
            let client = self.get_or_initialize_client().await?;

            let expected_type = expected_type_for_cmd(cmd);
            let request_timeout = match get_request_timeout(cmd, self.request_timeout) {
                Ok(request_timeout) => request_timeout,
                Err(err) => return Err(err),
            };

            let value = run_with_timeout(request_timeout, async move {
                match client {
                    ClientWrapper::Standalone(mut client) => client.send_command(cmd).await,
                    ClientWrapper::Cluster {mut client } => {
                        let final_routing =
                            if let Some(RoutingInfo::SingleNode(SingleNodeRoutingInfo::Random)) =
                                routing
                            {
                                let cmd_name = cmd.command().unwrap_or_default();
                                let cmd_name = String::from_utf8_lossy(&cmd_name);
                                if redis::cluster_routing::is_readonly_cmd(cmd_name.as_bytes()) {
                                // A read-only command, go ahead and send it to a random node
                                    RoutingInfo::SingleNode(SingleNodeRoutingInfo::Random)
                                } else {
                                // A "Random" node was selected, but the command is a "@write" command
                                // change the routing to "RandomPrimary"
                                    log_warn(
                                        "send_command",
                                        format!(
                                            "User provided 'Random' routing which is not suitable for the writeable command '{cmd_name}'. Changing it to 'RandomPrimary'"
                                        ),
                                    );
                                    RoutingInfo::SingleNode(SingleNodeRoutingInfo::RandomPrimary)
                                }
                            } else {
                                routing
                                    .or_else(|| RoutingInfo::for_routable(cmd))
                                    .unwrap_or(RoutingInfo::SingleNode(SingleNodeRoutingInfo::Random))
                            };
                        client.route_command(cmd, final_routing).await
                    },
                    ClientWrapper::Lazy(_) => unreachable!("Lazy client should have been initialized"),
                }
                .and_then(|value| convert_to_expected_type(value, expected_type))
            })
            .await?;

            Ok(value)
        })
    }

    // Cluster scan is not passed to redis-rs as a regular command, so we need to handle it separately.
    // We send the command to a specific function in the redis-rs cluster client, which internally handles the
    // the complication of a command scan, and generate the command base on the logic in the redis-rs library.
    //
    // The function returns a tuple with the cursor and the keys found in the scan.
    // The cursor is not a regular cursor, but an ARC to a struct that contains the cursor and the data needed
    // to continue the scan called ScanState.
    // In order to avoid passing Rust GC to clean the ScanState when the cursor (ref) is passed to the wrapper,
    // which means that Rust layer is not aware of the cursor anymore, we need to keep the ScanState alive.
    // We do that by storing the ScanState in a global container, and return a cursor-id of the cursor to the wrapper.
    //
    // The wrapper create an object contain the cursor-id with a drop function that will remove the cursor from the container.
    // When the ref is removed from the hash-map, there's no more references to the ScanState, and the GC will clean it.
    pub async fn cluster_scan<'a>(
        &'a mut self,
        scan_state_cursor: &'a ScanStateRC,
        cluster_scan_args: ClusterScanArgs,
    ) -> RedisResult<Value> {
        // Clone arguments before the async block (ScanStateRC is Arc, clone is cheap)
        let scan_state_cursor_clone = scan_state_cursor.clone();
        let cluster_scan_args_clone = cluster_scan_args.clone(); // Assuming ClusterScanArgs is Clone

        // Check and initialize if lazy *inside* the async block
        let client = self.get_or_initialize_client().await?;

        match client {
            ClientWrapper::Standalone(_) => {
                unreachable!("Cluster scan is not supported in standalone mode")
            }
            ClientWrapper::Cluster { mut client } => {
                let (cursor, keys) = client
                    .cluster_scan(scan_state_cursor_clone, cluster_scan_args_clone) // Use clones
                    .await?;
                let cluster_cursor_id = if cursor.is_finished() {
                    Value::BulkString(FINISHED_SCAN_CURSOR.into()) // Use constant
                } else {
                    Value::BulkString(insert_cluster_scan_cursor(cursor).into())
                };
                Ok(Value::Array(vec![cluster_cursor_id, Value::Array(keys)]))
            }
            // Lazy case is now handled by the initial check
            ClientWrapper::Lazy(_) => unreachable!("Lazy client should have been initialized"),
        }
    }

    fn get_transaction_values(
        pipeline: &redis::Pipeline,
        mut values: Vec<Value>,
        command_count: usize,
        offset: usize,
        raise_on_error: bool,
    ) -> RedisResult<Value> {
        assert_eq!(values.len(), 1);
        let value = values.pop();
        let values = match value {
            Some(Value::Array(values)) => values,
            Some(Value::Nil) => {
                return Ok(Value::Nil);
            }
            Some(value) => {
                if offset == 2 {
                    vec![value]
                } else {
                    return Err((
                        ErrorKind::ResponseError,
                        "Received non-array response for transaction",
                        format!("(response was {:?})", get_value_type(&value)),
                    )
                        .into());
                }
            }
            _ => {
                return Err((
                    ErrorKind::ResponseError,
                    "Received empty response for transaction",
                )
                    .into());
            }
        };
        Self::convert_pipeline_values_to_expected_types(
            pipeline,
            values,
            command_count,
            raise_on_error,
        )
    }

    fn convert_pipeline_values_to_expected_types(
        pipeline: &redis::Pipeline,
        values: Vec<Value>,
        command_count: usize,
        raise_on_error: bool,
    ) -> RedisResult<Value> {
        let values = values
            .into_iter()
            .map(|value| {
                if raise_on_error {
                    value.extract_error()
                } else {
                    Ok(value)
                }
            })
            .zip(
                pipeline
                    .cmd_iter()
                    .map(|cmd| expected_type_for_cmd(cmd.as_ref())),
            )
            .map(|(value, expected_type)| convert_to_expected_type(value?, expected_type))
            .try_fold(
                Vec::with_capacity(command_count),
                |mut acc, result| -> RedisResult<_> {
                    acc.push(result?);
                    Ok(acc)
                },
            )?;
        Ok(Value::Array(values))
    }

    /// Send a pipeline to the server.
    /// Transaction is a batch of commands that are sent in a single request.
    /// Unlike a pipelines, transactions are atomic, and in cluster mode, the key-based commands must route to the same slot.
    pub fn send_transaction<'a>(
        &'a mut self,
        pipeline: &'a redis::Pipeline,
        routing: Option<RoutingInfo>,
        transaction_timeout: Option<u32>,
        raise_on_error: bool,
    ) -> redis::RedisFuture<'a, Value> {
        Box::pin(async move {
            let client = self.get_or_initialize_client().await?;

            let command_count = pipeline.cmd_iter().count();
            // The offset is set to command_count + 1 to account for:
            // 1. The first command, which is the "MULTI" command, that returns "OK"
            // 2. The "QUEUED" responses for each of the commands in the pipeline (before EXEC)
            // After these initial responses (OK and QUEUED), we expect a single response,
            // which is an array containing the results of all the commands in the pipeline.
            let offset = command_count + 1;

            run_with_timeout(
                Some(to_duration(transaction_timeout, self.request_timeout)),
                async move {
                    match client {
                        ClientWrapper::Standalone(mut client) => {
                            let values = client.send_pipeline(pipeline, offset, 1).await?;
                            Client::get_transaction_values(
                                pipeline,
                                values,
                                command_count,
                                offset,
                                raise_on_error,
                            )
                        }
                        ClientWrapper::Cluster { mut client } => {
                            let values = match routing {
                                Some(RoutingInfo::SingleNode(route)) => {
                                    client
                                        .route_pipeline(pipeline, offset, 1, Some(route), None)
                                        .await?
                                }
                                _ => {
                                    client
                                        .req_packed_commands(pipeline, offset, 1, None)
                                        .await?
                                }
                            };
                            Client::get_transaction_values(
                                pipeline,
                                values,
                                command_count,
                                offset,
                                raise_on_error,
                            )
                        }
                        ClientWrapper::Lazy(_) => {
                            unreachable!("Lazy client should have been initialized")
                        }
                    }
                },
            )
            .await
        })
    }

    /// Send a pipeline to the server.
    /// Pipeline is a batch of commands that are sent in a single request.
    /// Unlike a transaction, the commands are not executed atomically, and in cluster mode, the commands can be sent to different nodes.
    ///
    /// The `raise_on_error` parameter determines whether the pipeline should raise an error if any of the commands in the pipeline fail, or return the error as part of the response.
    /// - `pipeline_retry_strategy`: Configures the retry behavior for pipeline commands.
    ///   - If `retry_server_error` is `true`, failed commands with a retriable `RetryMethod` will be retried,
    ///     potentially causing reordering within the same slot.
    ///     ⚠️ **Caution**: This may lead to commands being executed in a different order than originally sent,
    ///     which could affect operations that rely on strict execution sequence.
    ///   - If `retry_connection_error` is `true`, sub-pipeline requests will be retried on connection errors.
    ///     ⚠️ **Caution**: Retrying after a connection error may result in duplicate executions, since the server might have already received and processed the request before the error occurred.
    ///     TODO: add wiki link.
    pub fn send_pipeline<'a>(
        &'a mut self,
        pipeline: &'a redis::Pipeline,
        routing: Option<RoutingInfo>,
        raise_on_error: bool,
        pipeline_timeout: Option<u32>,
        pipeline_retry_strategy: PipelineRetryStrategy,
    ) -> redis::RedisFuture<'a, Value> {
        Box::pin(async move {
            let client = self.get_or_initialize_client().await?;

            let command_count = pipeline.cmd_iter().count();
            if pipeline.is_empty() {
                return Err(RedisError::from((
                    ErrorKind::ResponseError,
                    "Received empty pipeline",
                )));
            }

            run_with_timeout(
                Some(to_duration(pipeline_timeout, self.request_timeout)),
                async move {
                    let values = match client {
                        ClientWrapper::Standalone(mut client) => {
                            client.send_pipeline(pipeline, 0, command_count).await
                        }

                        ClientWrapper::Cluster { mut client } => match routing {
                            Some(RoutingInfo::SingleNode(route)) => {
                                client
                                    .route_pipeline(
                                        pipeline,
                                        0,
                                        command_count,
                                        Some(route),
                                        Some(pipeline_retry_strategy),
                                    )
                                    .await
                            }
                            _ => {
                                client
                                    .req_packed_commands(
                                        pipeline,
                                        0,
                                        command_count,
                                        Some(pipeline_retry_strategy),
                                    )
                                    .await
                            }
                        },
                        ClientWrapper::Lazy(_) => {
                            unreachable!("Lazy client should have been initialized")
                        }
                    }?;

                    Client::convert_pipeline_values_to_expected_types(
                        pipeline,
                        values,
                        command_count,
                        raise_on_error,
                    )
                },
            )
            .await
        })
    }

    pub async fn invoke_script<'a>(
        &'a mut self,
        hash: &'a str,
        keys: &Vec<&[u8]>,
        args: &Vec<&[u8]>,
        routing: Option<RoutingInfo>,
    ) -> redis::RedisResult<Value> {
        let _ = self.get_or_initialize_client().await?;

        let eval = eval_cmd(hash, keys, args);
        let result = self.send_command(&eval, routing.clone()).await;
        let Err(err) = result else {
            return result;
        };
        if err.kind() == ErrorKind::NoScriptError {
            let Some(code) = get_script(hash) else {
                return Err(err);
            };
            let load = load_cmd(&code);
            self.send_command(&load, None).await?;
            self.send_command(&eval, routing).await
        } else {
            Err(err)
        }
    }

    pub fn reserve_inflight_request(&self) -> bool {
        // We use this approach of checking the `inflight_requests_allowed` value
        // twice, before and after decrementing, to prevent it from reaching negative
        // values. Allowing the `inflight_requests_allowed` value to go below zero
        // could lead to a race condition where tasks might not be able to run even
        // when there are available slots.
        if self.inflight_requests_allowed.load(Ordering::SeqCst) <= 0 {
            false
        } else {
            // The value is being checked again because it might have changed
            // during the intervening period since the load by other tasks.
            if self
                .inflight_requests_allowed
                .fetch_sub(1, Ordering::SeqCst)
                <= 0
            {
                self.inflight_requests_allowed
                    .fetch_add(1, Ordering::SeqCst);
                return false;
            }
            true
        }
    }

    pub fn release_inflight_request(&self) -> isize {
        self.inflight_requests_allowed
            .fetch_add(1, Ordering::SeqCst)
    }

    /// Update the password used to authenticate with the servers.
    /// If None is passed, the password will be removed.
    /// If `immediate_auth` is true, the password will be used to authenticate with the servers immediately using the `AUTH` command.
    /// The default behavior is to update the password without authenticating immediately.
    /// If the password is empty or None, and `immediate_auth` is true, the password will be updated and an error will be returned.
    pub async fn update_connection_password(
        &mut self,
        password: Option<String>,
        immediate_auth: bool,
    ) -> RedisResult<Value> {
        let timeout = self.request_timeout;
        // The password update operation is wrapped in a timeout to prevent it from blocking indefinitely.
        // If the operation times out, an error is returned.
        // Since the password update operation is not a command that go through the regular command pipeline,
        // it is not have the regular timeout handling, as such we need to handle it separately.
        match tokio::time::timeout(timeout, async {
            let mut client = self.get_or_initialize_client().await?;
            match client {
                ClientWrapper::Standalone(ref mut client) => {
                    client.update_connection_password(password.clone()).await
                }
                ClientWrapper::Cluster { ref mut client } => {
                    client.update_connection_password(password.clone()).await
                }
                ClientWrapper::Lazy(_) => unreachable!("Lazy client should have been initialized"),
            }
        })
        .await
        {
            Ok(result) => {
                if immediate_auth {
                    self.send_immediate_auth(password).await
                } else {
                    result
                }
            }
            Err(_elapsed) => Err(RedisError::from((
                ErrorKind::IoError,
                "Password update operation timed out, please check the connection",
            ))),
        }
    }

    async fn send_immediate_auth(&mut self, password: Option<String>) -> RedisResult<Value> {
        match &password {
            Some(pw) if pw.is_empty() => Err(RedisError::from((
                ErrorKind::UserOperationError,
                "Empty password provided for authentication",
            ))),
            None => Err(RedisError::from((
                ErrorKind::UserOperationError,
                "No password provided for authentication",
            ))),
            Some(password) => {
                let routing = RoutingInfo::MultiNode((
                    MultipleNodeRoutingInfo::AllNodes,
                    Some(ResponsePolicy::AllSucceeded),
                ));
                let mut cmd = redis::cmd("AUTH");
                if let Some(username) = self.get_username().await? {
                    cmd.arg(username);
                }
                cmd.arg(password);
                self.send_command(&cmd, Some(routing)).await
            }
        }
    }

    /// Returns the username if one was configured during client creation. Otherwise, returns None.
    async fn get_username(&mut self) -> RedisResult<Option<String>> {
        let client = self.get_or_initialize_client().await?;

        match client {
            ClientWrapper::Cluster { mut client } => match client.get_username().await {
                Ok(Value::SimpleString(username)) => Ok(Some(username)),
                Ok(Value::Nil) => Ok(None),
                Ok(other) => Err(RedisError::from((
                    ErrorKind::ClientError,
                    "Unexpected type",
                    format!("Expected SimpleString or Nil, got: {other:?}"),
                ))),
                Err(e) => Err(RedisError::from((
                    ErrorKind::ResponseError,
                    "Error getting username",
                    format!("Received error - {e:?}."),
                ))),
            },
            ClientWrapper::Standalone(client) => Ok(client.get_username()),
            ClientWrapper::Lazy(_) => unreachable!("Lazy client should have been initialized"),
        }
    }
}

fn load_cmd(code: &[u8]) -> Cmd {
    let mut cmd = redis::cmd("SCRIPT");
    cmd.arg("LOAD").arg(code);
    cmd
}

fn eval_cmd(hash: &str, keys: &Vec<&[u8]>, args: &Vec<&[u8]>) -> Cmd {
    let mut cmd = redis::cmd("EVALSHA");
    cmd.arg(hash).arg(keys.len());
    for key in keys {
        cmd.arg(key);
    }
    for arg in args {
        cmd.arg(arg);
    }
    cmd
}

fn to_duration(time_in_millis: Option<u32>, default: Duration) -> Duration {
    time_in_millis
        .map(|val| Duration::from_millis(val as u64))
        .unwrap_or(default)
}

async fn create_cluster_client(
    request: ConnectionRequest,
    push_sender: Option<mpsc::UnboundedSender<PushInfo>>,
) -> RedisResult<redis::cluster_async::ClusterConnection> {
    // TODO - implement timeout for each connection attempt
    let tls_mode = request.tls_mode.unwrap_or_default();
    let redis_connection_info = get_redis_connection_info(&request);
    let initial_nodes: Vec<_> = request
        .addresses
        .into_iter()
        .map(|address| get_connection_info(&address, tls_mode, redis_connection_info.clone()))
        .collect();
    let periodic_topology_checks = match request.periodic_checks {
        Some(PeriodicCheck::Disabled) => None,
        Some(PeriodicCheck::Enabled) => Some(DEFAULT_PERIODIC_TOPOLOGY_CHECKS_INTERVAL),
        Some(PeriodicCheck::ManualInterval(interval)) => Some(interval),
        None => Some(DEFAULT_PERIODIC_TOPOLOGY_CHECKS_INTERVAL),
    };
    let connection_timeout = to_duration(request.connection_timeout, DEFAULT_CONNECTION_TIMEOUT);
    let mut builder = redis::cluster::ClusterClientBuilder::new(initial_nodes)
        .connection_timeout(connection_timeout)
        .retries(DEFAULT_RETRIES);
    let read_from_strategy = request.read_from.unwrap_or_default();
    builder = builder.read_from(match read_from_strategy {
        ReadFrom::AZAffinity(az) => ReadFromReplicaStrategy::AZAffinity(az),
        ReadFrom::AZAffinityReplicasAndPrimary(az) => {
            ReadFromReplicaStrategy::AZAffinityReplicasAndPrimary(az)
        }
        ReadFrom::PreferReplica => ReadFromReplicaStrategy::RoundRobin,
        ReadFrom::Primary => ReadFromReplicaStrategy::AlwaysFromPrimary,
    });
    if let Some(interval_duration) = periodic_topology_checks {
        builder = builder.periodic_topology_checks(interval_duration);
    }
    builder = builder.use_protocol(request.protocol.unwrap_or_default());
    if let Some(client_name) = redis_connection_info.client_name {
        builder = builder.client_name(client_name);
    }
    if tls_mode != TlsMode::NoTls {
        let tls = if tls_mode == TlsMode::SecureTls {
            redis::cluster::TlsMode::Secure
        } else {
            redis::cluster::TlsMode::Insecure
        };
        builder = builder.tls(tls);
    }
    if let Some(pubsub_subscriptions) = redis_connection_info.pubsub_subscriptions.clone() {
        builder = builder.pubsub_subscriptions(pubsub_subscriptions);
    }

    let retry_strategy = match request.connection_retry_strategy {
        Some(strategy) => RetryStrategy::new(
            strategy.exponent_base,
            strategy.factor,
            strategy.number_of_retries,
            strategy.jitter_percent,
        ),
        None => RetryStrategy::default(),
    };
    builder = builder.reconnect_retry_strategy(retry_strategy);

    // Always use with Glide
    builder = builder.periodic_connections_checks(Some(CONNECTION_CHECKS_INTERVAL));

    let client = builder.build()?;
    let mut con = client.get_async_connection(push_sender).await?;

    // This validation ensures that sharded subscriptions are not applied to Redis engines older than version 7.0,
    // preventing scenarios where the client becomes inoperable or, worse, unaware that sharded pubsub messages are not being received.
    // The issue arises because `client.get_async_connection()` might succeed even if the engine does not support sharded pubsub.
    // For example, initial connections may exclude the target node for sharded subscriptions, allowing the creation to succeed,
    // but subsequent resubscription tasks will fail when `setup_connection()` cannot establish a connection to the node.
    //
    // One approach to handle this would be to check the engine version inside `setup_connection()` and skip applying sharded subscriptions.
    // However, this approach would leave the application unaware that the subscriptions were not applied, requiring the user to analyze logs to identify the issue.
    // Instead, we explicitly check the engine version here and fail the connection creation if it is incompatible with sharded subscriptions.

    if let Some(pubsub_subscriptions) = redis_connection_info.pubsub_subscriptions {
        if pubsub_subscriptions.contains_key(&redis::PubSubSubscriptionKind::Sharded) {
            let info_res = con
                .route_command(
                    redis::cmd("INFO").arg("SERVER"),
                    RoutingInfo::SingleNode(SingleNodeRoutingInfo::Random),
                )
                .await?;
            let info_dict: InfoDict = FromRedisValue::from_redis_value(&info_res)?;
            match info_dict.get::<String>("redis_version") {
                Some(version) => match (Versioning::new(version), Versioning::new("7.0")) {
                    (Some(server_ver), Some(min_ver)) => {
                        if server_ver < min_ver {
                            return Err(RedisError::from((
                                ErrorKind::InvalidClientConfig,
                                "Sharded subscriptions provided, but the engine version is < 7.0",
                            )));
                        }
                    }
                    _ => {
                        return Err(RedisError::from((
                            ErrorKind::ResponseError,
                            "Failed to parse engine version",
                        )));
                    }
                },
                _ => {
                    return Err(RedisError::from((
                        ErrorKind::ResponseError,
                        "Could not determine engine version from INFO result",
                    )));
                }
            }
        }
    }

    Ok(con)
}

#[derive(thiserror::Error)]
pub enum ConnectionError {
    Standalone(standalone_client::StandaloneClientConnectionError),
    Cluster(redis::RedisError),
    Timeout,
    IoError(std::io::Error),
}

impl std::fmt::Debug for ConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Standalone(arg0) => f.debug_tuple("Standalone").field(arg0).finish(),
            Self::Cluster(arg0) => f.debug_tuple("Cluster").field(arg0).finish(),
            Self::IoError(arg0) => f.debug_tuple("IoError").field(arg0).finish(),
            Self::Timeout => write!(f, "Timeout"),
        }
    }
}

impl std::fmt::Display for ConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionError::Standalone(err) => write!(f, "{err:?}"),
            ConnectionError::Cluster(err) => write!(f, "{err}"),
            ConnectionError::IoError(err) => write!(f, "{err}"),
            ConnectionError::Timeout => f.write_str("connection attempt timed out"),
        }
    }
}

fn format_optional_value<T>(name: &'static str, value: Option<T>) -> String
where
    T: std::fmt::Display,
{
    if let Some(value) = value {
        format!("\n{name}: {value}")
    } else {
        String::new()
    }
}

fn sanitized_request_string(request: &ConnectionRequest) -> String {
    let addresses = request
        .addresses
        .iter()
        .map(|address| format!("{}:{}", address.host, address.port))
        .collect::<Vec<_>>()
        .join(", ");
    let tls_mode = request
        .tls_mode
        .map(|tls_mode| {
            format!(
                "\nTLS mode: {}",
                match tls_mode {
                    TlsMode::NoTls => "No TLS",
                    TlsMode::SecureTls => "Secure",
                    TlsMode::InsecureTls => "Insecure",
                }
            )
        })
        .unwrap_or_default();
    let cluster_mode = if request.cluster_mode_enabled {
        "\nCluster mode"
    } else {
        "\nStandalone mode"
    };
    let request_timeout = format_optional_value("Request timeout", request.request_timeout);
    let connection_timeout =
        format_optional_value("Connection timeout", request.connection_timeout);
    let database_id = format!("\ndatabase ID: {}", request.database_id);
    let rfr_strategy = request
        .read_from
        .clone()
        .map(|rfr| {
            format!(
                "\nRead from Replica mode: {}",
                match rfr {
                    ReadFrom::Primary => "Only primary",
                    ReadFrom::PreferReplica => "Prefer replica",
                    ReadFrom::AZAffinity(_) => "Prefer replica in user's availability zone",
                    ReadFrom::AZAffinityReplicasAndPrimary(_) =>
                        "Prefer replica and primary in user's availability zone",
                }
            )
        })
        .unwrap_or_default();
    let connection_retry_strategy = request.connection_retry_strategy.as_ref().map(|strategy|
            format!("\nreconnect backoff strategy: number of increasing duration retries: {}, base: {}, factor: {}, jitter: {:?}",
        strategy.number_of_retries, strategy.exponent_base, strategy.factor, strategy.jitter_percent)).unwrap_or_default();
    let protocol = request
        .protocol
        .map(|protocol| format!("\nProtocol: {protocol:?}"))
        .unwrap_or_default();
    let client_name = request
        .client_name
        .as_ref()
        .map(|client_name| format!("\nClient name: {client_name}"))
        .unwrap_or_default();
    let periodic_checks = if request.cluster_mode_enabled {
        match request.periodic_checks {
            Some(PeriodicCheck::Disabled) => "\nPeriodic Checks: Disabled".to_string(),
            Some(PeriodicCheck::Enabled) => format!(
                "\nPeriodic Checks: Enabled with default interval of {DEFAULT_PERIODIC_TOPOLOGY_CHECKS_INTERVAL:?}"
            ),
            Some(PeriodicCheck::ManualInterval(interval)) => format!(
                "\nPeriodic Checks: Enabled with manual interval of {:?}s",
                interval.as_secs()
            ),
            None => String::new(),
        }
    } else {
        String::new()
    };

    let pubsub_subscriptions = request
        .pubsub_subscriptions
        .as_ref()
        .map(|pubsub_subscriptions| format!("\nPubsub subscriptions: {pubsub_subscriptions:?}"))
        .unwrap_or_default();

    let inflight_requests_limit = format_optional_value(
        "\nInflight requests limit: {}",
        request.inflight_requests_limit,
    );

    format!(
        "\nAddresses: {addresses}{tls_mode}{cluster_mode}{request_timeout}{connection_timeout}{rfr_strategy}{connection_retry_strategy}{database_id}{protocol}{client_name}{periodic_checks}{pubsub_subscriptions}{inflight_requests_limit}",
    )
}

impl Client {
    pub async fn new(
        request: ConnectionRequest,
        push_sender: Option<mpsc::UnboundedSender<PushInfo>>,
    ) -> Result<Self, ConnectionError> {
        const DEFAULT_CLIENT_CREATION_TIMEOUT: Duration = Duration::from_secs(10);

        log_info(
            "Connection configuration",
            sanitized_request_string(&request),
        );
        let request_timeout = to_duration(request.request_timeout, DEFAULT_RESPONSE_TIMEOUT);
        let inflight_requests_limit = request
            .inflight_requests_limit
            .unwrap_or(DEFAULT_MAX_INFLIGHT_REQUESTS);
        let inflight_requests_allowed = Arc::new(AtomicIsize::new(
            inflight_requests_limit.try_into().unwrap(),
        ));

        tokio::time::timeout(DEFAULT_CLIENT_CREATION_TIMEOUT, async move {
            let internal_client = if request.lazy_connect {
                ClientWrapper::Lazy(Box::new(LazyClient {
                    config: request,
                    push_sender,
                }))
            } else if request.cluster_mode_enabled {
                let client = create_cluster_client(request, push_sender)
                    .await
                    .map_err(ConnectionError::Cluster)?;
                ClientWrapper::Cluster { client }
            } else {
                ClientWrapper::Standalone(
                    StandaloneClient::create_client(request, push_sender)
                        .await
                        .map_err(ConnectionError::Standalone)?,
                )
            };

            Ok(Self {
                internal_client: Arc::new(RwLock::new(internal_client)),
                request_timeout,
                inflight_requests_allowed,
            })
        })
        .await
        .map_err(|_| ConnectionError::Timeout)?
    }
}

pub trait GlideClientForTests {
    fn send_command<'a>(
        &'a mut self,
        cmd: &'a Cmd,
        routing: Option<RoutingInfo>,
    ) -> redis::RedisFuture<'a, redis::Value>;
}

impl GlideClientForTests for Client {
    fn send_command<'a>(
        &'a mut self,
        cmd: &'a Cmd,
        routing: Option<RoutingInfo>,
    ) -> redis::RedisFuture<'a, redis::Value> {
        self.send_command(cmd, routing)
    }
}

impl GlideClientForTests for StandaloneClient {
    fn send_command<'a>(
        &'a mut self,
        cmd: &'a Cmd,
        _routing: Option<RoutingInfo>,
    ) -> redis::RedisFuture<'a, redis::Value> {
        self.send_command(cmd).boxed()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use redis::Cmd;

    use crate::client::{
        BLOCKING_CMD_TIMEOUT_EXTENSION, RequestTimeoutOption, TimeUnit, get_request_timeout,
    };

    use super::get_timeout_from_cmd_arg;

    #[test]
    fn test_get_timeout_from_cmd_returns_correct_duration_int() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg("5");
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            RequestTimeoutOption::BlockingCommand(Duration::from_secs_f64(
                5.0 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_correct_duration_float() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg(0.5);
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            RequestTimeoutOption::BlockingCommand(Duration::from_secs_f64(
                0.5 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_correct_duration_milliseconds() {
        let mut cmd = Cmd::new();
        cmd.arg("XREAD").arg("BLOCK").arg("500").arg("key");
        let result = get_timeout_from_cmd_arg(&cmd, 2, TimeUnit::Milliseconds);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            RequestTimeoutOption::BlockingCommand(Duration::from_secs_f64(
                0.5 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_err_when_timeout_isnt_passed() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg("key3");
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{err:?}");
        assert!(err.to_string().to_lowercase().contains("index"), "{err}");
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_err_when_timeout_is_larger_than_u32_max() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP")
            .arg("key1")
            .arg("key2")
            .arg(u32::MAX as u64 + 1);
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{err:?}");
        assert!(err.to_string().to_lowercase().contains("u32"), "{err}");
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_err_when_timeout_is_negative() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg(-1);
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().to_lowercase().contains("negative"), "{err}");
    }

    #[test]
    fn test_get_timeout_from_cmd_returns_no_timeout_when_zero_is_passed() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg(0);
        let result = get_timeout_from_cmd_arg(&cmd, cmd.args_iter().len() - 1, TimeUnit::Seconds);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), RequestTimeoutOption::NoTimeout,);
    }

    #[test]
    fn test_get_request_timeout_with_blocking_command_returns_cmd_arg_timeout() {
        let mut cmd = Cmd::new();
        cmd.arg("BLPOP").arg("key1").arg("key2").arg("500");
        let result = get_request_timeout(&cmd, Duration::from_millis(100));
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(Duration::from_secs_f64(
                500.0 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );

        let mut cmd = Cmd::new();
        cmd.arg("XREADGROUP").arg("BLOCK").arg("500").arg("key");
        let result = get_request_timeout(&cmd, Duration::from_millis(100));
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(Duration::from_secs_f64(
                0.5 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );

        let mut cmd = Cmd::new();
        cmd.arg("BLMPOP").arg("0.857").arg("key");
        let result = get_request_timeout(&cmd, Duration::from_millis(100));
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(Duration::from_secs_f64(
                0.857 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );

        let mut cmd = Cmd::new();
        cmd.arg("WAIT").arg(1).arg("500");
        let result = get_request_timeout(&cmd, Duration::from_millis(500));
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(Duration::from_secs_f64(
                0.5 + BLOCKING_CMD_TIMEOUT_EXTENSION
            ))
        );
    }

    #[test]
    fn test_get_request_timeout_non_blocking_command_returns_default_timeout() {
        let mut cmd = Cmd::new();
        cmd.arg("SET").arg("key").arg("value").arg("PX").arg("500");
        let result = get_request_timeout(&cmd, Duration::from_millis(100));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some(Duration::from_millis(100)));

        let mut cmd = Cmd::new();
        cmd.arg("XREADGROUP").arg("key");
        let result = get_request_timeout(&cmd, Duration::from_millis(100));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some(Duration::from_millis(100)));
    }
}
