#!/bin/bash
# scripts/deploy-local.sh — Download latest CI build artifact and install locally
#
# Usage:
#   npm run deploy:local          # Wait for current CI, download & install
#   npm run deploy:local -- --no-wait  # Download latest available artifact (don't wait)

set -euo pipefail

APP_NAME="Open Cowork"
APP_PATH="/Applications/${APP_NAME}.app"
ARTIFACT_NAME="open-cowork-macos"

NO_WAIT=false
for arg in "$@"; do
  case "$arg" in
    --no-wait) NO_WAIT=true ;;
  esac
done

echo "==> Checking latest CI run on current branch..."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)

if [ "$NO_WAIT" = false ]; then
  # Find the run for the latest commit
  RUN_ID=$(gh run list --branch "$BRANCH" --workflow=ci.yml --limit 1 --json databaseId,headSha,status \
    --jq ".[0].databaseId")

  if [ -z "$RUN_ID" ]; then
    echo "ERROR: No CI run found for branch $BRANCH"
    exit 1
  fi

  RUN_STATUS=$(gh run view "$RUN_ID" --json status --jq '.status')
  if [ "$RUN_STATUS" = "in_progress" ] || [ "$RUN_STATUS" = "queued" ]; then
    echo "==> CI run $RUN_ID is $RUN_STATUS, waiting for completion..."
    gh run watch "$RUN_ID" --exit-status || true
  fi
else
  RUN_ID=$(gh run list --branch "$BRANCH" --workflow=ci.yml --status=completed --limit 1 --json databaseId \
    --jq ".[0].databaseId")

  if [ -z "$RUN_ID" ]; then
    echo "ERROR: No completed CI run found for branch $BRANCH"
    exit 1
  fi
fi

# Check if macOS build succeeded
MAC_JOB_CONCLUSION=$(gh run view "$RUN_ID" --json jobs --jq '.jobs[] | select(.name=="Build macOS") | .conclusion')
if [ "$MAC_JOB_CONCLUSION" != "success" ]; then
  echo "ERROR: macOS build did not succeed (status: $MAC_JOB_CONCLUSION)"
  echo "       Check: gh run view $RUN_ID --log-failed"
  exit 1
fi

echo "==> Downloading macOS artifact from CI run $RUN_ID..."

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$TMPDIR"

# Find the .app bundle
APP_BUNDLE=$(find "$TMPDIR" -name "*.app" -maxdepth 3 -type d | head -1)

if [ -z "$APP_BUNDLE" ]; then
  echo "ERROR: No .app bundle found in downloaded artifact"
  echo "Contents of download:"
  ls -R "$TMPDIR"
  exit 1
fi

echo "==> Found: $(basename "$APP_BUNDLE")"

# Kill the running app if it's open
if pgrep -f "$APP_NAME" > /dev/null 2>&1; then
  echo "==> Stopping running $APP_NAME..."
  pkill -f "$APP_NAME" || true
  sleep 1
fi

# Replace the installed app
if [ -d "$APP_PATH" ]; then
  echo "==> Removing old installation..."
  rm -rf "$APP_PATH"
fi

echo "==> Installing to $APP_PATH..."
cp -R "$APP_BUNDLE" "$APP_PATH"

# Remove quarantine flag
xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "==> Launching $APP_NAME..."
open -a "$APP_NAME"

echo ""
echo "Done! $APP_NAME installed from CI run $RUN_ID (branch: $BRANCH, commit: $COMMIT)"
