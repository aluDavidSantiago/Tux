#!/bin/bash
# Instala el servidor multimedia de Tux como LaunchAgent de macOS.
# - Arranca solo al iniciar sesión y cuando el disco /Volumes/HDD está montado.
# - Si el servidor se cae y el disco sigue montado, launchd lo vuelve a levantar.
# Uso: bash server/launchd/install-agent.sh
set -euo pipefail

LABEL="com.tux.mediaserver"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
VOLUME="${TUX_VOLUME_ROOT:-/Volumes/HDD}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Tux"

if [[ -z "$NODE_BIN" ]]; then
  echo "No se encontró node en el PATH." >&2
  exit 1
fi
NODE_BIN="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$NODE_BIN")"

if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
  echo "Instalando dependencias del servidor…"
  (cd "$SERVER_DIR" && npm install --no-fund --no-audit)
fi

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
    <string>$NODE_BIN</string>
    <string>$SERVER_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SERVER_DIR</string>

  <!-- Arranca al iniciar sesión… -->
  <key>RunAtLoad</key>
  <true/>
  <!-- …y se mantiene vivo solo mientras el HDD esté montado: si el disco no está,
       launchd espera; en cuanto se conecta, lo arranca. -->
  <key>KeepAlive</key>
  <dict>
    <key>PathState</key>
    <dict>
      <key>$VOLUME</key>
      <true/>
    </dict>
  </dict>
  <!-- Reevalúa cada vez que se monta un volumen. -->
  <key>StartOnMount</key>
  <true/>
  <!-- Evita reinicios en bucle si algo falla (p. ej. puerto ocupado). -->
  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TUX_VOLUME_ROOT</key>
    <string>$VOLUME</string>
  </dict>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/media-server.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/media-server.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null

# Recarga limpia (por si ya estaba instalado).
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Instalado: $PLIST"
echo "Logs:      $LOG_DIR/media-server.log"
