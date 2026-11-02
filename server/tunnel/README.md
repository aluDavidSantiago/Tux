# Acceso global al HDD con Cloudflare Tunnel

Tux guarda toda la multimedia en el disco externo del Mac mini (`/Volumes/HDD/Tux_Storage/`). Para que
los móviles y ordenadores de fuera de casa puedan subir y ver las pruebas, el servidor (`127.0.0.1:8787`)
se publica con un túnel HTTPS gratuito de Cloudflare:

```text
Móvil / navegador ──HTTPS──▶ Cloudflare ──túnel saliente──▶ cloudflared (Mac mini) ──▶ 127.0.0.1:8787 ──▶ HDD
```

- **Sin abrir puertos** en el router: `cloudflared` abre una conexión saliente; el servidor sigue escuchando solo en `127.0.0.1`.
- **HTTPS de serie:** sin avisos de contenido mixto desde GitHub Pages ni bloqueos de red local en el navegador.
- **Nada cambia en la seguridad del servidor:** toda petición que llega por el túnel pasa por las mismas comprobaciones:
  - Subidas y borrados: ID token de Firebase (`Authorization: Bearer …`) verificado con las claves públicas de Google; cada usuario solo escribe en `users/{su uid}/`.
  - Lectura (`/media/…`): ticket firmado (HMAC) que el servidor solo emite tras validar el ID token (`POST /api/media/ticket`). Sin sesión iniciada no se entrega ningún archivo.
- **Límite de 100 MB por petición de Cloudflare:** la app sube los archivos grandes (vídeos 360° de hasta 500 MB) por trozos de 48 MB (`/api/media/uploads`).

## 1. Instalar cloudflared

```bash
brew install cloudflared
```

## 2a. Túnel rápido (sin dominio, para probar)

```bash
cd server
npm run tunnel:quick
# ✅ Tux multimedia disponible en: https://palabras-al-azar.trycloudflare.com
```

La URL cambia cada vez que se reinicia el túnel. No requiere cuenta de Cloudflare.

## 2b. Túnel con nombre (URL fija, recomendado)

Necesita una cuenta gratuita de Cloudflare y un dominio gestionado en ella.

```bash
cd server
npm run tunnel:setup -- media.tudominio.com   # login, crea el túnel "tux-media" y el registro DNS
npm run tunnel:run                             # prueba manual
```

La configuración queda en `~/.cloudflared/tux-media.yml` (fuera del repositorio, junto con las credenciales).

## 3. Dejarlo como servicio (launchd)

```bash
npm run tunnel:install     # com.tux.tunnel: con nombre si existe, si no túnel rápido
npm run tunnel:status      # estado + URL pública
npm run tunnel:uninstall
```

macOS no deja a launchd leer scripts dentro de `~/Documents`, así que el instalador copia `tunnel.sh` a
`~/Library/Application Support/Tux/` y el servicio lo ejecuta desde ahí: **vuelve a ejecutar `npm run tunnel:install`
tras modificar `tunnel.sh`**.

Convive con el LaunchAgent del servidor (`com.tux.mediaserver`): el servidor solo corre con el HDD montado
y el túnel se relanza solo si se corta la conexión. Logs en `~/Library/Logs/Tux/tunnel.log`.

## 4. Publicar la URL a todos los clientes

La app web lee la URL del servidor multimedia de una configuración centralizada, por orden de prioridad:

1. `?media=https://…` en la URL de la app (se recuerda en ese navegador; `?media=reset` lo borra). Útil para pruebas.
2. **Firestore `config/media` → `serverUrl`**, que se edita desde **/admin → Servidor multimedia**. En el Mac mini,
   el botón «Usar URL del túnel» lee la URL activa de `http://localhost:8787/health` y la publica.
3. `http://localhost:8787` (desarrollo en el propio Mac).

Con el túnel rápido hay que volver a publicar la URL tras cada reinicio; con el túnel con nombre basta una vez.

## Variables opcionales

| Variable | Uso |
|---|---|
| `TUX_PUBLIC_URL` | URL pública fija que el servidor anuncia en `/health` (si no, la de `tunnel.sh`). |
| `TUX_TUNNEL_NAME` | Nombre del túnel con nombre (por defecto `tux-media`). |
| `TUX_TICKET_SECRET` / `TUX_TICKET_SECRET_FILE` | Clave HMAC de los tickets (por defecto se genera en `~/.tux/media-ticket.key`). |
| `TUX_EXTRA_ORIGINS` | Orígenes web adicionales autorizados a subir (además de GitHub Pages y `localhost:8080`). |
