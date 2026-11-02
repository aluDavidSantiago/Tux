#!/bin/bash
# Instala el túnel de Cloudflare como LaunchAgent (com.tux.tunnel), junto al del servidor
# (com.tux.mediaserver). Usa el túnel con nombre si existe (URL fija); si no, un túnel rápido.
# Uso: bash server/tunnel/install-tunnel-agent.sh [quick|run]
set -euo pipefail

LABEL="com.tux.tunnel"
DIR="$(cd "$(dirname "$0")" && pwd)"
NAME="${TUX_TUNNEL_NAME:-tux-media}"
MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  [[ -f "$HOME/.cloudflared/$NAME.yml" ]] && MODE="run" || MODE="quick"
fi
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Tux"

command -v cloudflared >/dev/null || [[ -x /opt/homebrew/bin/cloudflared ]] || [[ -x /usr/local/bin/cloudflared ]] || {
  echo "Instala antes cloudflared:  brew install cloudflared" >&2
  exit 1
}
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$DIR/tunnel.sh</string>
    <string>$MODE</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <!-- Siempre activo: si se corta la conexión o cloudflared termina, launchd lo relanza. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>20</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/tunnel.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Instalado: $PLIST (modo $MODE)"
echo "Logs:      $LOG_DIR/tunnel.log"
echo "URL:       bash $DIR/tunnel.sh url"
