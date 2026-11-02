#!/bin/bash
# Túnel HTTPS de Cloudflare para el servidor multimedia de Tux (puerto 8787 → Internet).
# El servidor sigue escuchando solo en 127.0.0.1: cloudflared abre una conexión SALIENTE hacia
# Cloudflare, así que no hay que abrir puertos en el router ni exponer la IP de casa.
#
#   bash tunnel.sh quick              Túnel rápido gratuito (*.trycloudflare.com, URL nueva en cada arranque)
#   bash tunnel.sh setup <hostname>   Crea un túnel con nombre y URL fija (requiere un dominio en Cloudflare)
#   bash tunnel.sh run                Arranca el túnel con nombre creado con «setup»
#   bash tunnel.sh url                Muestra la URL pública actual
#
# La URL activa se guarda en ~/Library/Logs/Tux/tunnel-url.txt; el servidor la expone en /health
# para que el panel /admin la publique a todos los clientes (Firestore config/media).
set -euo pipefail

PORT="${TUX_PORT:-8787}"
ORIGIN="http://127.0.0.1:$PORT"
NAME="${TUX_TUNNEL_NAME:-tux-media}"
CONF_DIR="$HOME/.cloudflared"
CONF="$CONF_DIR/$NAME.yml"
LOG_DIR="$HOME/Library/Logs/Tux"
URL_FILE="$LOG_DIR/tunnel-url.txt"

mkdir -p "$LOG_DIR"

find_cloudflared() {
  local bin
  bin="$(command -v cloudflared || true)"
  for candidate in /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared; do
    [[ -z "$bin" && -x "$candidate" ]] && bin="$candidate"
  done
  if [[ -z "$bin" ]]; then
    echo "No se encontró cloudflared. Instálalo con:  brew install cloudflared" >&2
    exit 1
  fi
  echo "$bin"
}

wait_for_server() {
  for _ in $(seq 1 30); do
    curl -fsS "$ORIGIN/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "Aviso: el servidor de Tux no responde en $ORIGIN (¿HDD desconectado?). El túnel arranca igualmente." >&2
}

cmd_quick() {
  local bin
  bin="$(find_cloudflared)"
  wait_for_server
  rm -f "$URL_FILE"
  echo "Abriendo túnel rápido hacia $ORIGIN…"
  # Se lee la salida de cloudflared para capturar la URL asignada (https://xxxx.trycloudflare.com).
  "$bin" tunnel --no-autoupdate --url "$ORIGIN" 2>&1 | while IFS= read -r line; do
    echo "$line"
    if [[ ! -s "$URL_FILE" && "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
      echo "${BASH_REMATCH[1]}" > "$URL_FILE"
      echo ""
      echo "  ✅ Tux multimedia disponible en: ${BASH_REMATCH[1]}"
      echo "     Publícala en /admin → Servidor multimedia → «Usar URL del túnel»."
      echo ""
    fi
  done
}

cmd_setup() {
  local host="${1:-}" bin
  if [[ -z "$host" ]]; then
    echo "Uso: bash tunnel.sh setup media.tudominio.com" >&2
    exit 1
  fi
  bin="$(find_cloudflared)"
  mkdir -p "$CONF_DIR"
  [[ -f "$CONF_DIR/cert.pem" ]] || "$bin" tunnel login
  "$bin" tunnel info "$NAME" >/dev/null 2>&1 || "$bin" tunnel create "$NAME"
  local id
  id="$("$bin" tunnel info "$NAME" 2>/dev/null | grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' | head -1)"
  if [[ -z "$id" ]]; then
    echo "No se pudo obtener el ID del túnel $NAME." >&2
    exit 1
  fi
  cat > "$CONF" <<YAML
# Generado por server/tunnel/tunnel.sh — túnel con nombre de Tux.
tunnel: $id
credentials-file: $CONF_DIR/$id.json
ingress:
  - hostname: $host
    service: $ORIGIN
    originRequest:
      connectTimeout: 30s
      noHappyEyeballs: true
  - service: http_status:404
YAML
  "$bin" tunnel route dns "$NAME" "$host"
  echo "https://$host" > "$CONF_DIR/$NAME.url"
  echo "Túnel $NAME listo → https://$host"
  echo "Arráncalo con «bash tunnel.sh run» o instálalo como servicio: «bash install-tunnel-agent.sh»."
}

cmd_run() {
  local bin
  bin="$(find_cloudflared)"
  if [[ ! -f "$CONF" ]]; then
    echo "No existe $CONF. Ejecuta antes: bash tunnel.sh setup <hostname>" >&2
    exit 1
  fi
  wait_for_server
  cp "$CONF_DIR/$NAME.url" "$URL_FILE" 2>/dev/null || true
  exec "$bin" tunnel --no-autoupdate --config "$CONF" run "$NAME"
}

case "${1:-}" in
  quick) cmd_quick ;;
  setup) shift; cmd_setup "$@" ;;
  run) cmd_run ;;
  url) cat "$URL_FILE" 2>/dev/null || echo "No hay ningún túnel activo." ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
