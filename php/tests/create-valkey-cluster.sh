#!/bin/bash

BASE_DIR="$HOME/valkey-cluster"
PORTS=(7001 7002 7003 7004 7005 7006)
VALKEY_BIN=$(which valkey-server)
CLI_BIN=$(which valkey-cli)

if [ -z "$VALKEY_BIN" ] || [ -z "$CLI_BIN" ]; then
  echo "valkey-server or valkey-cli not found in PATH"
  exit 1
fi

# 1. Clean previous setup
echo "Cleaning up old cluster data..."
rm -rf "$BASE_DIR"
mkdir -p "$BASE_DIR"

# 2. Create config and data folders
for port in "${PORTS[@]}"; do
  NODE_DIR="$BASE_DIR/$port"
  mkdir -p "$NODE_DIR"

  cat > "$NODE_DIR/valkey.conf" <<EOF
port $port
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 5000
appendonly no
dbfilename dump.rdb
dir $NODE_DIR
logfile "$NODE_DIR/valkey.log"
protected-mode no
EOF
done

# 3. Start each node
echo "Starting Valkey nodes..."
for port in "${PORTS[@]}"; do
  "$VALKEY_BIN" "$BASE_DIR/$port/valkey.conf" &
  sleep 0.2
done

sleep 2

# 4. Create the cluster
echo "Creating cluster..."
"$CLI_BIN" --cluster create \
  127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003 \
  127.0.0.1:7004 127.0.0.1:7005 127.0.0.1:7006 \
  --cluster-replicas 1 \
  --cluster-yes
