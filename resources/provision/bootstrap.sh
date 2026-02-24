#!/bin/bash
# Coeadapt Guest Bootstrap - Stage 1
# Downloads and runs via: curl -sL http://10.0.2.2:9580/bootstrap.sh | sudo bash
#
# Installs base dependencies (Guest Additions, xdotool) then downloads
# and runs the full provisioning script from the host HTTP server.

set -euo pipefail

HOST_IP="${1:-10.0.2.2}"
HOST_PORT="${2:-9580}"
BASE_URL="http://${HOST_IP}:${HOST_PORT}"

report_status() {
  local phase="$1" message="$2" progress="${3:-0}"
  curl -s -X POST "${BASE_URL}/status" \
    -H 'Content-Type: application/json' \
    -d "{\"phase\":\"${phase}\",\"message\":\"${message}\",\"progress\":${progress}}" \
    >/dev/null 2>&1 || true
}

report_status "installing_deps" "Installing system dependencies..." 5

export DEBIAN_FRONTEND=noninteractive

# Update and install base packages
apt-get update -qq 2>&1
apt-get install -y -qq curl jq xdotool 2>&1

report_status "installing_guest_additions" "Installing VirtualBox Guest Additions..." 20

# Install Guest Additions from Ubuntu/Mint repos
apt-get install -y -qq virtualbox-guest-utils virtualbox-guest-x11 2>&1 || {
  report_status "installing_guest_additions" "Guest Additions apt failed, trying ISO..." 25
  # Fallback: try mounting and running from the GA ISO if attached
  if [ -b /dev/cdrom ] || [ -b /dev/sr0 ]; then
    MOUNT_DIR=$(mktemp -d)
    mount /dev/cdrom "$MOUNT_DIR" 2>/dev/null || mount /dev/sr0 "$MOUNT_DIR" 2>/dev/null || true
    if [ -f "$MOUNT_DIR/VBoxLinuxAdditions.run" ]; then
      "$MOUNT_DIR/VBoxLinuxAdditions.run" --nox11 2>&1 || true
    fi
    umount "$MOUNT_DIR" 2>/dev/null || true
    rmdir "$MOUNT_DIR" 2>/dev/null || true
  fi
}

# Load vboxsf module if available (needed for shared folders later)
modprobe vboxsf 2>/dev/null || true

report_status "provisioning" "Downloading full provisioning script..." 35

# Download and run the full provisioning script
PROVISION_SCRIPT=$(mktemp)
curl -sL "${BASE_URL}/provision.sh" -o "$PROVISION_SCRIPT"
chmod +x "$PROVISION_SCRIPT"
bash "$PROVISION_SCRIPT" "$HOST_IP" "$HOST_PORT"
