# Tux 🐧

**Tux** es una red social minimalista para descubrir y compartir actividades casuales, económicas y de bajo esfuerzo. Cada día (o cada semana) Tux elige **una actividad estrella** para ti, la cierras con una prueba en foto, vídeo o **360°/VR**, y la comunidad la ve en una galería inmersiva.

🔗 **Demo:** https://aludavidsantiago.github.io/Tux/ · **Versión:** 1.0.0-beta

## 🚀 Características
- **Panel · TuxPlans Central:** una única actividad estrella por periodo, elegida según tus intereses, presupuesto y energía máximos, con los motivos de la elección a la vista y una cuenta atrás hasta la siguiente.
- **Frecuencia configurable:** de una sugerencia al día a una a la semana (diaria, 2 días, 3 días, semanal).
- **Descarte con justificación:** descartar exige elegir un motivo («No tengo el material requerido», «Ubicación inalcanzable», «No es mi vibe»…). Sin motivo, el botón no se activa.
- **Mis planes:** en curso, completados, guardados y **papelera**. Lo descartado no se vuelve a sugerir salvo que lo restaures.
- **Prueba multimedia obligatoria:** completar un plan exige adjuntar JPG/PNG (≤10 MB) o MP4 (≤100 MB), que se guardan en el disco externo `/Volumes/HDD/Tux_Storage` a través del servidor local de Tux.
- **360°/VR:** detección automática de contenido equirectangular (2:1) y visor inmersivo con A-Frame (WebXR) en la Galería VR, en las pruebas y en las imágenes 360° de los planes.
- **Explorar:** feed vertical a pantalla completa con filtros, búsqueda, «Me apunto», comentarios y guardados.
- **Acceso libre:** cualquiera navega; al interactuar aparece el acceso (email/contraseña o Google).
- **Minimal Monolith:** negro OLED `#0D0D0E`, acento `#FF6B35`, microinteracciones y tema oscuro/claro/sistema.

## 🛠️ Stack técnico
- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES nativos, sin build).
- **Backend:** Firebase Authentication + Cloud Firestore.
- **Multimedia:** servidor Node local (`server/`) que guarda en el HDD externo · Cloudinary como alternativa · visor 360° con A-Frame 1.6.
- **Hosting:** GitHub Pages.

## 📂 Estructura
```text
├── index.html              # Redirige a public/ (entrada de GitHub Pages)
├── public/
│   ├── index.html          # Vistas, modales y sprite de iconos
│   ├── css/styles.css      # Sistema de diseño
│   ├── js/app.js           # Orquestador de la interfaz
│   ├── js/ui.js            # Utilidades DOM, toasts y modales
│   ├── js/vr.js            # Visor 360°/VR (A-Frame)
│   └── img/                # Logo, favicon e icono táctil
├── src/
│   ├── firebaseConfig.js   # Firebase App, Auth y Firestore
│   ├── mediaConfig.js      # ⚙️ Proveedor multimedia (local/Cloudinary) y URL del servidor
│   ├── auth.js · users.js  # Acceso y perfiles
│   ├── activities.js       # Catálogo, feed en tiempo real y filtros
│   ├── social.js           # Me apunto, guardados y comentarios
│   ├── plans.js            # Preferencias, estrella e historial
│   ├── recommendations.js  # Motor de la actividad estrella (funciones puras)
│   └── media.js            # Validación, detección 360°, subida y pruebas
├── server/                 # Servidor multimedia local (Node ≥ 20)
│   ├── server.js           # API de subida + entrega de archivos (sin listados ni borrado web)
│   ├── storage.js          # Carpetas aisladas por usuario en el HDD
│   ├── auth.js             # Verificación de ID tokens de Firebase
│   ├── admin.js            # Estadísticas y purga (solo terminal)
│   └── config.js           # Rutas, puertos, orígenes y límites
├── firestore.rules
└── firebase.json / .firebaserc
```

## 🗃️ Modelo de datos (Firestore)

| Ruta | Campos |
|------|--------|
| `users/{uid}` | `nickname`, `photoURL`, `avatarColor`, `bio`, `prefs { frequencyDays, interests[], maxBudget, maxEffort }`, `star { activityId, period, frequencyDays }`, `createdAt` |
| `users/{uid}/history/{activityId}` | `status` (accepted · completed · discarded), `title`, `category`, `emoji`, `imageUrl`, `reason`, `note`, `proofId`, `proofUrl`, `proofType`, `is360`, `updatedAt` |
| `activities/{id}` (+ `comments`) | plan publicado con contadores `likeCount` / `commentCount` |
| `likes` · `saved` | `{uid}_{activityId}` → `uid`, `activityId`, `createdAt` |
| `proofs/{id}` | `uid`, `authorName`, `activityId`, `activityTitle`, `url`, `thumbUrl`, `type`, `is360`, `width`, `height`, `caption`, `createdAt` |

Las reglas exigen `reason` al descartar y una prueba al completar. Las pruebas locales se guardan como `local:users/{uid}/{archivo}` y las reglas solo aceptan referencias a la carpeta del **propio** usuario.

## 💾 Almacenamiento en el disco externo (HDD)
```bash
cd server
npm install
npm start            # manual: http://localhost:8787 → /Volumes/HDD/Tux_Storage
```
- Estructura: `/Volumes/HDD/Tux_Storage/users/{uid}/{uuid}.jpg|png|mp4` (+ `{uuid}.thumb.jpg` para vídeos).
- **Aislamiento:** solo el servidor escribe; cada subida exige un ID token de Firebase válido y va a la carpeta de ese uid. Se comprueban tipo, firma binaria, tamaño (10 MB imagen, 100 MB vídeo), cuota (5 GB/usuario) y ritmo (20 subidas/min).
- **No navegable:** no hay listados de carpetas, ni rutas de borrado o modificación por la web; los archivos se sirven solo por su nombre UUID exacto.
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
- Variables opcionales: `TUX_STORAGE_ROOT`, `TUX_VOLUME_ROOT`, `TUX_PORT`, `TUX_EXTRA_ORIGINS`.
- El disco está en **exFAT**, que no guarda permisos POSIX: el aislamiento lo garantiza el servidor, no el sistema de archivos.

## 🔐 Configuración
1. **Firebase Auth:** activar *Email/Password* y *Google*; añadir `aludavidsantiago.github.io` a los dominios autorizados.
2. **Multimedia:** por defecto `MEDIA_PROVIDER = "local"` en `src/mediaConfig.js` (servidor de arriba). Para Cloudinary, cambia a `"cloudinary"` y rellena `cloudName` y `uploadPreset`.
3. **Reglas:** `firebase deploy --only firestore:rules`

## 💻 Desarrollo local
```bash
python3 -m http.server 8080
# abre http://localhost:8080/public/
```
