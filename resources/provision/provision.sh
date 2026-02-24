#!/bin/bash
# Coeadapt Guest Provisioner - Stage 2
# Called by bootstrap.sh after base dependencies are installed.
# Installs Node.js, Navi agent, configures systemd service.

set -euo pipefail

HOST_IP="${1:-10.0.2.2}"
HOST_PORT="${2:-9580}"
BASE_URL="http://${HOST_IP}:${HOST_PORT}"

INSTALL_DIR="/opt/coeadapt"
NODE_DIR="${INSTALL_DIR}/node"
NAVI_DIR="${INSTALL_DIR}/navi"

report_status() {
  local phase="$1" message="$2" progress="${3:-0}"
  curl -s -X POST "${BASE_URL}/status" \
    -H 'Content-Type: application/json' \
    -d "{\"phase\":\"${phase}\",\"message\":\"${message}\",\"progress\":${progress}}" \
    >/dev/null 2>&1 || true
}

# ── Download config ─────────────────────────────────────────────────

report_status "installing_node" "Downloading configuration..." 40

CONFIG=$(curl -sL "${BASE_URL}/config.json")
DEVICE_TOKEN=$(echo "$CONFIG" | jq -r '.deviceToken')
API_URL=$(echo "$CONFIG" | jq -r '.apiUrl')
MCP_PORT=$(echo "$CONFIG" | jq -r '.mcpPort')
GUEST_USER=$(echo "$CONFIG" | jq -r '.guestUsername')
WORKSPACE_PATH=$(echo "$CONFIG" | jq -r '.workspacePath')

# ── Install Node.js ─────────────────────────────────────────────────

report_status "installing_node" "Installing Node.js runtime..." 45

mkdir -p "$NODE_DIR"

# Try downloading bundled Node.js from host
if curl -sL "${BASE_URL}/node-linux-x64.tar.gz" -o /tmp/node-bundle.tar.gz 2>/dev/null && [ -s /tmp/node-bundle.tar.gz ]; then
  tar -xzf /tmp/node-bundle.tar.gz -C "$NODE_DIR" --strip-components=1
  rm -f /tmp/node-bundle.tar.gz
else
  # Fallback: install via NodeSource if bundle not available
  report_status "installing_node" "Bundled Node.js not found, installing from NodeSource..." 48
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1
  apt-get install -y -qq nodejs 2>&1
  # Symlink to expected location
  ln -sf /usr/bin/node "$NODE_DIR/bin/node" 2>/dev/null || true
  ln -sf /usr/bin/npm "$NODE_DIR/bin/npm" 2>/dev/null || true
fi

# Add Node.js to system PATH
mkdir -p "$NODE_DIR/bin"
cat > /etc/profile.d/coeadapt-node.sh <<PATHEOF
export PATH="${NODE_DIR}/bin:\$PATH"
PATHEOF
export PATH="${NODE_DIR}/bin:$PATH"

# Verify Node.js
NODE_BIN="${NODE_DIR}/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN=$(which node 2>/dev/null || true)
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  report_status "error" "Node.js installation failed - no node binary found" 50
  exit 1
fi

NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null || echo "unknown")
report_status "installing_node" "Node.js ${NODE_VERSION} installed" 55

# ── Install Navi agent ──────────────────────────────────────────────

report_status "installing_navi" "Installing Navi career agent..." 60

mkdir -p "$NAVI_DIR/server"

# Download Navi agent bundle from host
if curl -sL "${BASE_URL}/navi-agent.tar.gz" -o /tmp/navi-bundle.tar.gz 2>/dev/null && [ -s /tmp/navi-bundle.tar.gz ]; then
  tar -xzf /tmp/navi-bundle.tar.gz -C "$NAVI_DIR"
  rm -f /tmp/navi-bundle.tar.gz
else
  # Try downloading just the server JS
  curl -sL "${BASE_URL}/navi-agent/server/index.js" -o "$NAVI_DIR/server/index.js" 2>/dev/null || {
    report_status "error" "Failed to download Navi agent bundle" 60
    exit 1
  }
fi

report_status "installing_navi" "Navi agent files installed" 70

# ── Create workspace ────────────────────────────────────────────────

sudo -u "$GUEST_USER" mkdir -p "$WORKSPACE_PATH" 2>/dev/null || mkdir -p "$WORKSPACE_PATH"

# ── Configure environment ───────────────────────────────────────────

report_status "configuring_service" "Configuring Navi agent service..." 75

cat > /etc/coeadapt-navi.env <<ENVEOF
COEADAPT_API_URL=${API_URL}
COEADAPT_DEVICE_TOKEN=${DEVICE_TOKEN}
NAVI_WORKSPACE=${WORKSPACE_PATH}
NAVI_MCP_PORT=${MCP_PORT}
NODE_ENV=production
ENVEOF
chmod 600 /etc/coeadapt-navi.env

# ── Create systemd service ──────────────────────────────────────────

report_status "configuring_service" "Creating systemd service..." 80

cat > /etc/systemd/system/navi-agent.service <<SVCEOF
[Unit]
Description=Coeadapt Navi Agent (MCP Server)
After=network.target vboxadd-service.service
Wants=network.target

[Service]
Type=simple
User=${GUEST_USER}
EnvironmentFile=/etc/coeadapt-navi.env
ExecStart=${NODE_BIN} ${NAVI_DIR}/server/index.js
Restart=on-failure
RestartSec=5
WorkingDirectory=${WORKSPACE_PATH}

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable navi-agent.service 2>&1
systemctl start navi-agent.service 2>&1

# ── Verify service started ──────────────────────────────────────────

report_status "configuring_service" "Verifying Navi agent service..." 90

sleep 3

if systemctl is-active --quiet navi-agent.service; then
  report_status "done" "Provisioning complete. Navi agent is running on port ${MCP_PORT}." 100
else
  STATUS=$(systemctl status navi-agent.service 2>&1 | tail -5)
  report_status "error" "Navi agent failed to start: ${STATUS}" 90
  exit 1
fi
