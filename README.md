# Tux 🐧

**Tux** es una red social minimalista para descubrir y compartir actividades casuales, económicas y de bajo esfuerzo. Cada día (o cada semana) Tux elige **una actividad estrella** para ti, la cierras con una prueba en foto, vídeo o **360°/VR**, y la comunidad la ve en una galería inmersiva.

🔗 **Demo:** https://aludavidsantiago.github.io/Tux/ · **Admin:** https://aludavidsantiago.github.io/Tux/admin/ · **Versión:** 1.4.0-beta

## 🚀 Características
- **Panel · TuxPlans Central:** una única actividad estrella por periodo, elegida según tus intereses, presupuesto y energía máximos, con los motivos de la elección a la vista y una cuenta atrás hasta la siguiente.
- **Frecuencia configurable:** de una sugerencia al día a una a la semana (diaria, 2 días, 3 días, semanal).
- **Descarte con justificación:** descartar exige elegir un motivo («No tengo el material requerido», «Ubicación inalcanzable», «No es mi vibe»…). Sin motivo, el botón no se activa.
- **Mis planes:** en curso, completados, guardados y **papelera**. Lo descartado no se vuelve a sugerir salvo que lo restaures.
- **Prueba multimedia obligatoria:** completar un plan exige adjuntar JPG/PNG (≤50 MB) o MP4 (≤500 MB), que se guardan en el disco externo `/Volumes/HDD/Tux_Storage` a través del servidor de Tux. Sin Cloudinary ni otras plataformas: el 100 % del almacenamiento está en el HDD.
- **Acceso global:** el servidor del Mac mini se publica con un túnel HTTPS de Cloudflare, así que móviles y ordenadores de fuera de casa suben y ven las pruebas. Los archivos grandes se suben por trozos de 48 MB (límite de 100 MB por petición de Cloudflare).
- **Comunidad:** feed de publicaciones (pruebas) en «Descubrir» y «Siguiendo», búsqueda de usuarios por nickname y botón «Responder» que abre un chat privado con la publicación citada.
- **Perfiles públicos:** seguidores y seguidos (contadores en tiempo real), rejilla de pruebas, pestaña 360°/VR, planes publicados y actividad. Botones «Seguir / Siguiendo» y «Mensaje».
- **Mensajes privados:** chats 1 a 1 en tiempo real con indicador de no leídos en la cabecera.
- **Portada 360°:** el autor fija en el visor el ángulo (yaw, pitch, fov) con el que se ve su publicación. El feed muestra una miniatura panorámica interactiva (arrastrar para mirar) que arranca en esa portada; perfiles y Galería VR la usan como encuadre. Un único contexto WebGL compartido dibuja todas las miniaturas.
- **Foto de perfil propia:** subir y recortar (512×512) en el navegador; se guarda en `users/{uid}/avatar.jpg` del HDD.
- **Tux personalizable:** la mascota se dibuja por capas (fondo, ropa, accesorio, gorro) con 17 ítems que se desbloquean completando planes, compartiendo 360°, publicando y haciendo amigos (`userAvatars/{uid}`).
- **Quick Share · NFC (Insta360):** una etiqueta NFC lanza un Atajo de iOS que sube la última foto 360° al HDD con una clave personal y abre Tux en «Publicación rápida» con el archivo cargado: actividad, portada 360°, comentario y publicar. Enlaces `…/Tux/upload/?quick=true`, `?quick={archivo}`, `&mediaUrl=`, `&autoOpen360=true`. Guía: [`docs/nfc-workflow.md`](docs/nfc-workflow.md).
- **Reportes:** cualquier usuario puede reportar una publicación; el admin las revisa en `/admin → Reportadas` y puede eliminarlas en cascada (HDD + Firestore) o descartar los reportes.
- **Gestión de cuentas (admin):** desactivar / reactivar (bloquea escrituras en Firestore y acceso al HDD) y eliminar cuenta: borrado físico recursivo de `users/{uid}/` en el HDD más sus publicaciones, planes, comentarios, seguidores (con contadores), chats, reportes y perfil.
- **360°/VR (Insta360):** detección por proporción 2:1 **y** por metadatos (XMP `GPano` en JPG/PNG, Spherical Video V1/V2 `sv3d`/`proj` en MP4). Todo contenido 360° —aunque se subiera sin marcar— se abre siempre en el visor inmersivo A-Frame (WebXR). Límites locales ampliados para exportaciones 360°: 50 MB por foto y 500 MB por vídeo.
- **Gestión de tus publicaciones:** eliminar tus planes publicados (con confirmación), reemplazar o quitar la prueba multimedia de un plan completado (vuelve a «En curso»). Cada borrado elimina también el archivo físico del HDD.
- **Notificaciones:** campana en la cabecera con los avisos que envía el equipo de Tux.
- **Herramientas de desarrollo** (admins, `localhost` o `?dev=1`): generar planes de prueba, nueva actividad estrella al instante y borrar los planes de prueba.
- **Panel de administración** (`/admin`): pruebas multimedia con previsualización 360°, avisos de incoherencias (2:1 sin marcar, 360° que no es 2:1), «Quitar solo prueba» y «Eliminar publicación» con borrado en el HDD, planes, usuarios y envío de notificaciones con plantillas.
- **Explorar:** feed vertical a pantalla completa con filtros, búsqueda, «Me apunto», comentarios y guardados.
- **Acceso libre:** cualquiera navega; al interactuar aparece el acceso (email/contraseña o Google).
- **Minimal Monolith:** negro OLED `#0D0D0E`, acento `#FF6B35`, microinteracciones y tema oscuro/claro/sistema.

## 🛠️ Stack técnico
- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES nativos, sin build).
- **Backend:** Firebase Authentication + Cloud Firestore.
- **Multimedia:** servidor Node (`server/`) que guarda en el HDD externo, expuesto con Cloudflare Tunnel · visor 360° con A-Frame 1.6.
- **Hosting:** GitHub Pages.

## 📂 Estructura
```text
├── index.html              # Redirige a public/ (entrada de GitHub Pages)
├── public/
│   ├── index.html          # Vistas, modales y sprite de iconos
│   ├── css/styles.css      # Sistema de diseño
│   ├── js/app.js           # Orquestador de la interfaz
│   ├── js/ui.js            # Utilidades DOM, toasts y modales
│   ├── js/vr.js            # Escena 360°/VR (A-Frame)
│   ├── js/viewer.js        # Visor compartido (app + admin) con detección 360° al reproducir
│   ├── admin/              # Panel de administración (/admin)
│   └── img/                # Logo, favicon e icono táctil
├── src/
│   ├── firebaseConfig.js   # Firebase App, Auth y Firestore
│   ├── mediaConfig.js      # ⚙️ URL del servidor multimedia (?media=, Firestore config/media o localhost)
│   ├── auth.js · users.js  # Acceso y perfiles
│   ├── activities.js       # Catálogo, feed en tiempo real y filtros
│   ├── social.js           # Me apunto, guardados, comentarios y seguidores
│   ├── chat.js             # Mensajería privada en tiempo real
│   ├── plans.js            # Preferencias, estrella e historial
│   ├── recommendations.js  # Motor de la actividad estrella (funciones puras)
│   ├── media.js            # Validación, detección 360°, ticket de lectura, subida (por trozos) y borrado
│   ├── notifications.js    # Notificaciones de usuario
│   └── admin.js            # Operaciones de administración
├── server/                 # Servidor multimedia local (Node ≥ 20)
│   ├── server.js           # API de subida (directa o por trozos), tickets y entrega de archivos
│   ├── storage.js          # Carpetas aisladas por usuario en el HDD
│   ├── auth.js             # Verificación de ID tokens de Firebase
│   ├── tickets.js          # Tickets de lectura firmados (HMAC) para <img>/<video>
│   ├── tunnel/             # Cloudflare Tunnel: tunnel.sh, LaunchAgent y guía (README.md)
│   ├── admin.js            # Estadísticas y purga (solo terminal)
│   └── config.js           # Rutas, puertos, orígenes y límites
├── firestore.rules
└── firebase.json / .firebaserc
```

## 🗃️ Modelo de datos (Firestore)

| Ruta | Campos |
|------|--------|
| `users/{uid}` | `nickname`, `photoURL`, `avatarColor`, `bio`, `prefs { frequencyDays, interests[], maxBudget, maxEffort }`, `star { activityId, period, frequencyDays }`, `followersCount`, `followingCount`, `createdAt` |
| `follows/{followerUid}_follows_{targetUid}` | `followerUid`, `targetUid`, `createdAt` (los contadores cambian en el mismo batch; las reglas lo verifican) |
| `chats/{uidA}_{uidB}` | `members [uidA, uidB]` ordenados, `lastMessage { text, senderId, createdAt }`, `updatedAt`, `lastRead { uid: fecha }` |
| `chats/{id}/messages/{id}` | `senderId`, `text` (≤1000), `createdAt`, `replyTo { proofId, title, thumb }` opcional |
| `userAvatars/{uid}` | `equipped { hat, outfit, accessory, background }`, `unlocked [ids]`, `updatedAt` |
| `reports/{proofId}_{reporterUid}` | `proofId`, `proofUid`, `activityTitle`, `reporterUid`, `reason`, `note`, `createdAt` · solo admins leen |
| `disabledUsers/{uid}` | `reason`, `deleted`, `disabledBy`, `nickname`, `createdAt` · bloquea la cuenta (reglas + servidor del HDD) |
| `config/media` | `serverUrl` (URL pública del túnel), `updatedBy`, `updatedAt` · solo admins escriben |
| `users/{uid}/history/{activityId}` | `status` (accepted · completed · discarded), `title`, `category`, `emoji`, `imageUrl`, `reason`, `note`, `proofId`, `proofUrl`, `proofType`, `is360`, `updatedAt` |
| `activities/{id}` (+ `comments`) | plan publicado con contadores `likeCount` / `commentCount` |
| `likes` · `saved` | `{uid}_{activityId}` → `uid`, `activityId`, `createdAt` |
| `notifications/{id}` | `toUid`, `title`, `body`, `kind` (info · 360 · warning), `read`, `fromName`, `createdAt` |
| `admins/{uid}` | documento de alta de administrador (solo se crea desde la consola) |
| `proofs/{id}` | `uid`, `authorName`, `activityId`, `activityTitle`, `url`, `thumbUrl`, `type`, `is360`, `width`, `height`, `caption`, `createdAt`, `cover { yaw, pitch, fov }` |

Las reglas exigen `reason` al descartar y una prueba al completar. Las pruebas se guardan como `local:users/{uid}/{archivo}` y las reglas solo aceptan referencias a la carpeta del **propio** usuario. Los chats solo los leen y escriben sus dos miembros (la pertenencia se deduce del ID).

## 💾 Almacenamiento en el disco externo (HDD)
```bash
cd server
npm install
npm start            # manual: http://localhost:8787 → /Volumes/HDD/Tux_Storage
```
- Estructura: `/Volumes/HDD/Tux_Storage/users/{uid}/{uuid}.jpg|png|mp4` (+ `{uuid}.thumb.jpg`: fotograma de vídeo o versión reducida de la foto, 2048 px en 360°) y `avatar.jpg` (foto de perfil).
- **Quick Share:** `GET/POST/DELETE /api/quick/key` (estado, emitir o revocar la clave del atajo, con sesión) y `POST /api/quick/upload` (cabecera `X-Tux-Key`, hasta 95 MB por el límite de Cloudflare; detecta el tipo por la firma y rechaza HEIC).
- **Eliminar cuenta:** `DELETE /api/admin/users/{uid}` (solo admins) borra la carpeta entera del usuario. La cuenta de Firebase Auth no se puede borrar desde el navegador (requiere el Admin SDK con una cuenta de servicio): queda bloqueada mediante `disabledUsers/{uid}`.
- **Aislamiento:** solo el servidor escribe; cada subida exige un ID token de Firebase válido y va a la carpeta de ese uid. Se comprueban tipo, firma binaria, tamaño (50 MB imagen, 500 MB vídeo), cuota (20 GB/usuario) y ritmo (20 subidas/min).
- **Solo usuarios con sesión:** para ver un archivo hace falta un ticket de lectura (`?k=`) que el servidor emite tras validar el ID token (`POST /api/media/ticket`, firmado con HMAC, caduca a las 12–18 h). Cualquier usuario autenticado puede ver las pruebas de los demás; los invitados no.
- **No navegable:** no hay listados de carpetas ni rutas de modificación; los archivos se sirven solo por su nombre UUID exacto.
- **Borrado sincronizado:** `DELETE /api/media/users/{uid}/{archivo}` solo para el dueño del archivo o un admin. Borrar un vídeo arrastra su miniatura.
- **Seguridad del disco:** si el HDD no está montado, el servidor no arranca ni escribe (evita crear `/Volumes/HDD` en el disco interno).
- **Arranque automático (macOS):** el servidor está instalado como LaunchAgent (`~/Library/LaunchAgents/com.tux.mediaserver.plist`). Arranca al iniciar sesión, espera a que `/Volumes/HDD` esté montado, se relanza solo si se cae y no se relanza mientras falte el disco. Logs en `~/Library/Logs/Tux/media-server.log`.
  ```bash
  npm run agent:install     # (re)instalar tras mover el repo o cambiar de Node
  npm run agent:status      # estado del servicio y del disco
  npm run agent:uninstall   # quitarlo
  ```
- **Administración** (solo terminal):
  ```bash
  npm run admin -- stats
  npm run admin -- list <uid>
  npm run admin -- purge --uid <uid> --yes
  npm run admin -- purge --all --yes
  ```
- Variables opcionales: `TUX_STORAGE_ROOT`, `TUX_VOLUME_ROOT`, `TUX_PORT`, `TUX_EXTRA_ORIGINS`, `TUX_PUBLIC_URL`, `TUX_TICKET_SECRET_FILE`.

## 🌍 Acceso global (Cloudflare Tunnel)
```bash
brew install cloudflared
cd server
npm run tunnel:quick                            # prueba: URL https://….trycloudflare.com
npm run tunnel:setup -- media.tudominio.com     # URL fija (dominio en Cloudflare)
npm run tunnel:install                          # LaunchAgent com.tux.tunnel
```
Después, en **/admin → Servidor multimedia**, publica la URL del túnel: todos los clientes la leen de Firestore (`config/media`) en tiempo real. Para probar en un solo navegador: `?media=https://…` (y `?media=reset`). Guía completa en [`server/tunnel/README.md`](server/tunnel/README.md).
- El disco está en **exFAT**, que no guarda permisos POSIX: el aislamiento lo garantiza el servidor, no el sistema de archivos.

## 🛡️ Administradores
El rol de admin lo da la existencia de `admins/{uid}` en Firestore. Las reglas impiden crearlo desde la app:
1. En Tux → Ajustes → Cuenta, copia **Tu ID de usuario**.
2. Consola de Firebase → Firestore → colección `admins` → documento con ese ID y un campo `role: "admin"`.
3. Recarga la app: aparecen el acceso a `/admin` y las herramientas de desarrollo.

Las reglas permiten a un admin borrar planes y pruebas de cualquier usuario, devolver un plan a «En curso» y enviar notificaciones. El servidor del HDD comprueba ese mismo documento (con el token del admin) antes de borrar archivos ajenos.

## 🔐 Configuración
1. **Firebase Auth:** activar *Email/Password* y *Google*; añadir `aludavidsantiago.github.io` a los dominios autorizados.
2. **Multimedia:** servidor de `server/` + túnel de Cloudflare; la URL se publica desde `/admin` (ver «Acceso global»).
3. **Reglas:** `firebase deploy --only firestore:rules`

## 💻 Desarrollo local
```bash
python3 -m http.server 8080
# abre http://localhost:8080/public/
```
