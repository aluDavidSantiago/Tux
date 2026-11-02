#!/bin/bash
# Quita el LaunchAgent del túnel de Cloudflare.
set -euo pipefail
LABEL="com.tux.tunnel"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME/Library/Logs/Tux/tunnel-url.txt"
echo "Túnel desinstalado."
