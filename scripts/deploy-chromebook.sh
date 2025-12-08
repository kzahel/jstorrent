#!/bin/bash
#
# Deploy extension to Chromebook for testing.
# Run from dev laptop, not from Crostini.
#
# Prerequisites:
#   - SSH access: ssh chromebook works
#   - CDP tunnel active: ssh -L 9222:127.0.0.1:9222 chromebook
#   - Extension loaded once from ~/Downloads/crostini-shared/jstorrent-extension/
#
# Usage:
#   ./scripts/deploy-chromebook.sh
#
set -e
cd "$(dirname "$0")/.."

CHROMEBOOK_HOST="${CHROMEBOOK_HOST:-chromebook}"
REMOTE_PATH="/mnt/chromeos/MyFiles/Downloads/crostini-shared/jstorrent-extension"

# Warn if running from Crostini
if [[ -f /etc/apt/sources.list.d/cros.list ]]; then
    echo "Warning: Running from Crostini. This script is meant for external dev machines."
    echo "   Press Ctrl+C to cancel, or wait 3s to continue anyway..."
    sleep 3
fi

echo "Building extension..."
pnpm build

echo "Deploying to $CHROMEBOOK_HOST:$REMOTE_PATH/"

# Create target directory if needed
ssh "$CHROMEBOOK_HOST" "mkdir -p '$REMOTE_PATH'"

rsync -av --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    extension/dist/ \
    "$CHROMEBOOK_HOST:$REMOTE_PATH/"

echo "Reloading extension..."
if python extension/tools/reload-extension.py 2>/dev/null; then
    echo "Done! Extension reloaded."
else
    echo "Build deployed but reload failed."
    echo "   Is the CDP tunnel active? ssh -L 9222:127.0.0.1:9222 $CHROMEBOOK_HOST"
fi
