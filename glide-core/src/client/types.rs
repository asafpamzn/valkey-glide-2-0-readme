// Copyright Valkey GLIDE Project Contributors - SPDX Identifier: Apache-2.0

#[allow(unused_imports)]
use logger_core::log_warn;
#[allow(unused_imports)]
use std::collections::HashSet;
use std::time::Duration;

#[cfg(feature = "proto")]
use crate::connection_request as protobuf;

#[derive(Default, Clone, Debug)]
pub struct ConnectionRequest {
    pub read_from: Option<ReadFrom>,
    pub client_name: Option<String>,
    pub authentication_info: Option<AuthenticationInfo>,
    pub database_id: i64,
    pub protocol: Option<redis::ProtocolVersion>,
    pub tls_mode: Option<TlsMode>,
    pub addresses: Vec<NodeAddress>,
    pub cluster_mode_enabled: bool,
    pub request_timeout: Option<u32>,
    pub connection_timeout: Option<u32>,
    pub connection_retry_strategy: Option<ConnectionRetryStrategy>,
    pub periodic_checks: Option<PeriodicCheck>,
    pub pubsub_subscriptions: Option<redis::PubSubSubscriptionInfo>,
    pub inflight_requests_limit: Option<u32>,
    pub lazy_connect: bool,
}

#[derive(PartialEq, Eq, Clone, Default, Debug)]
pub struct AuthenticationInfo {
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Default, Clone, Copy, Debug)]
pub enum PeriodicCheck {
    #[default]
    Enabled,
    Disabled,
    ManualInterval(Duration),
}

#[derive(Clone, Debug)]
pub struct NodeAddress {
    pub host: String,
    pub port: u16,
}

impl ::std::fmt::Display for NodeAddress {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        write!(f, "Host: `{}`, Port: {}", self.host, self.port)
    }
}

#[derive(PartialEq, Eq, Clone, Default, Debug)]
pub enum ReadFrom {
    #[default]
    Primary,
    PreferReplica,
    AZAffinity(String),
    AZAffinityReplicasAndPrimary(String),
}

#[derive(PartialEq, Eq, Clone, Copy, Default, Debug)]
#[repr(C)]
pub enum TlsMode {
    #[default]
    NoTls,
    InsecureTls,
    SecureTls,
}

#[derive(PartialEq, Eq, Clone, Copy, Debug)]
#[repr(C)]
pub struct ConnectionRetryStrategy {
    pub exponent_base: u32,
    pub factor: u32,
    pub number_of_retries: u32,
    pub jitter_percent: Option<u32>,
}

#[cfg(feature = "proto")]
fn chars_to_string_option(chars: &::protobuf::Chars) -> Option<String> {
    if chars.is_empty() {
        None
    } else {
        Some(chars.to_string())
    }
}

#[cfg(feature = "proto")]
pub(crate) fn none_if_zero(value: u32) -> Option<u32> {
    if value == 0 { None } else { Some(value) }
}

#[cfg(feature = "proto")]
impl From<protobuf::ConnectionRequest> for ConnectionRequest {
    fn from(value: protobuf::ConnectionRequest) -> Self {
        let read_from = value.read_from.enum_value().ok().map(|val| match val {
            protobuf::ReadFrom::Primary => ReadFrom::Primary,
            protobuf::ReadFrom::PreferReplica => ReadFrom::PreferReplica,
            protobuf::ReadFrom::LowestLatency => todo!(),
            protobuf::ReadFrom::AZAffinity => {
                if let Some(client_az) = chars_to_string_option(&value.client_az) {
                    ReadFrom::AZAffinity(client_az)
                } else {
                    log_warn(
                        "types",
                        format!(
                            "Failed to convert availability zone string: '{:?}'. Falling back to `ReadFrom::PreferReplica`",
                            value.client_az
                        ),
                    );
                    ReadFrom::PreferReplica
                }
            }
            protobuf::ReadFrom::AZAffinityReplicasAndPrimary => {
                if let Some(client_az) = chars_to_string_option(&value.client_az) {
                    ReadFrom::AZAffinityReplicasAndPrimary(client_az)
                } else {
                    log_warn(
                        "types",
                        format!(
                            "Failed to convert availability zone string: '{:?}'. Falling back to `ReadFrom::PreferReplica`",
                            value.client_az
                        ),
                    );
                    ReadFrom::PreferReplica
                }
            },
        });

        let client_name = chars_to_string_option(&value.client_name);
        let authentication_info = value.authentication_info.0.and_then(|authentication_info| {
            let password = chars_to_string_option(&authentication_info.password);
            let username = chars_to_string_option(&authentication_info.username);
            if password.is_none() && username.is_none() {
                return None;
            }

            Some(AuthenticationInfo { password, username })
        });

        let database_id = value.database_id as i64;
        let protocol = value.protocol.enum_value().ok().map(|val| match val {
            protobuf::ProtocolVersion::RESP3 => redis::ProtocolVersion::RESP3,
            protobuf::ProtocolVersion::RESP2 => redis::ProtocolVersion::RESP2,
        });

        let tls_mode = value.tls_mode.enum_value().ok().map(|val| match val {
            protobuf::TlsMode::NoTls => TlsMode::NoTls,
            protobuf::TlsMode::SecureTls => TlsMode::SecureTls,
            protobuf::TlsMode::InsecureTls => TlsMode::InsecureTls,
        });

        let addresses = value
            .addresses
            .into_iter()
            .map(|addr| NodeAddress {
                host: addr.host.to_string(),
                port: addr.port as u16,
            })
            .collect();
        let cluster_mode_enabled = value.cluster_mode_enabled;
        let request_timeout = none_if_zero(value.request_timeout);
        let connection_timeout = none_if_zero(value.connection_timeout);
        let connection_retry_strategy =
            value
                .connection_retry_strategy
                .0
                .map(|strategy| ConnectionRetryStrategy {
                    exponent_base: strategy.exponent_base,
                    factor: strategy.factor,
                    number_of_retries: strategy.number_of_retries,
                    jitter_percent: Some(strategy.jitter_percent),
                });
        let periodic_checks = value
            .periodic_checks
            .map(|periodic_check| match periodic_check {
                protobuf::connection_request::Periodic_checks::PeriodicChecksManualInterval(
                    interval,
                ) => PeriodicCheck::ManualInterval(Duration::from_secs(
                    interval.duration_in_sec.into(),
                )),
                protobuf::connection_request::Periodic_checks::PeriodicChecksDisabled(_) => {
                    PeriodicCheck::Disabled
                }
            });
        let mut pubsub_subscriptions: Option<redis::PubSubSubscriptionInfo> = None;
        if let Some(protobuf_pubsub) = value.pubsub_subscriptions.0 {
            let mut redis_pubsub = redis::PubSubSubscriptionInfo::new();
            for (pubsub_type, channels_patterns) in
                protobuf_pubsub.channels_or_patterns_by_type.iter()
            {
                let kind = match *pubsub_type {
                    0 => redis::PubSubSubscriptionKind::Exact,
                    1 => redis::PubSubSubscriptionKind::Pattern,
                    2 => redis::PubSubSubscriptionKind::Sharded,
                    3_u32..=u32::MAX => {
                        log_warn(
                            "client creation",
                            format!(
                                "Omitting pubsub subscription on an unknown type: {:?}",
                                *pubsub_type
                            ),
                        );
                        continue;
                    }
                };

                for channel_pattern in channels_patterns.channels_or_patterns.iter() {
                    redis_pubsub
                        .entry(kind)
                        .and_modify(|channels_patterns| {
                            channels_patterns.insert(channel_pattern.to_vec());
                        })
                        .or_insert(HashSet::from([channel_pattern.to_vec()]));
                }
            }
            pubsub_subscriptions = Some(redis_pubsub);
        }

        let inflight_requests_limit = none_if_zero(value.inflight_requests_limit);
        let lazy_connect = value.lazy_connect;

        ConnectionRequest {
            read_from,
            client_name,
            authentication_info,
            database_id,
            protocol,
            tls_mode,
            addresses,
            cluster_mode_enabled,
            request_timeout,
            connection_timeout,
            connection_retry_strategy,
            periodic_checks,
            pubsub_subscriptions,
            inflight_requests_limit,
            lazy_connect,
            // otel_endpoint,
            //otel_span_flush_interval_ms: Some(otel_span_flush_interval_ms),
        }
    }
}
