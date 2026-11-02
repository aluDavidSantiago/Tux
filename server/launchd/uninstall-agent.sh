#!/bin/bash
# Detiene y elimina el LaunchAgent del servidor multimedia de Tux.
# Uso: bash server/launchd/uninstall-agent.sh
set -euo pipefail

LABEL="com.tux.mediaserver"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Desinstalado $LABEL (los logs siguen en ~/Library/Logs/Tux)."
