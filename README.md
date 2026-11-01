# Tux 🐧

**Tux** es una red social minimalista para descubrir y compartir actividades casuales, económicas y de bajo esfuerzo. Cada día (o cada semana) Tux elige **una actividad estrella** para ti, la cierras con una prueba en foto, vídeo o **360°/VR**, y la comunidad la ve en una galería inmersiva.

🔗 **Demo:** https://aludavidsantiago.github.io/Tux/ · **Versión:** 1.0.0-beta

## 🚀 Características
- **Panel · TuxPlans Central:** una única actividad estrella por periodo, elegida según tus intereses, presupuesto y energía máximos, con los motivos de la elección a la vista y una cuenta atrás hasta la siguiente.
- **Frecuencia configurable:** de una sugerencia al día a una a la semana (diaria, 2 días, 3 días, semanal).
- **Descarte con justificación:** descartar exige elegir un motivo («No tengo el material requerido», «Ubicación inalcanzable», «No es mi vibe»…). Sin motivo, el botón no se activa.
- **Mis planes:** en curso, completados, guardados y **papelera**. Lo descartado no se vuelve a sugerir salvo que lo restaures.
- **Prueba multimedia obligatoria:** completar un plan exige adjuntar JPG/PNG (≤10 MB) o MP4 (≤100 MB).
- **360°/VR:** detección automática de contenido equirectangular (2:1) y visor inmersivo con A-Frame (WebXR) en la Galería VR, en las pruebas y en las imágenes 360° de los planes.
- **Explorar:** feed vertical a pantalla completa con filtros, búsqueda, «Me apunto», comentarios y guardados.
- **Acceso libre:** cualquiera navega; al interactuar aparece el acceso (email/contraseña o Google).
- **Minimal Monolith:** negro OLED `#0D0D0E`, acento `#FF6B35`, microinteracciones y tema oscuro/claro/sistema.

## 🛠️ Stack técnico
- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES nativos, sin build).
- **Backend:** Firebase Authentication + Cloud Firestore.
- **Multimedia:** Cloudinary (subida sin firma) · visor 360° con A-Frame 1.6 (carga bajo demanda).
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
│   ├── mediaConfig.js      # ⚙️ Cloudinary (cloud name + upload preset)
│   ├── auth.js · users.js  # Acceso y perfiles
│   ├── activities.js       # Catálogo, feed en tiempo real y filtros
│   ├── social.js           # Me apunto, guardados y comentarios
│   ├── plans.js            # Preferencias, estrella e historial
│   ├── recommendations.js  # Motor de la actividad estrella (funciones puras)
│   └── media.js            # Validación, detección 360°, subida y pruebas
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

Las reglas exigen `reason` al descartar y una URL de Cloudinary como prueba al completar.

## 🔐 Configuración
1. **Firebase Auth:** activar *Email/Password* y *Google*; añadir `aludavidsantiago.github.io` a los dominios autorizados.
2. **Cloudinary:** crear un *upload preset* en modo **Unsigned** y rellenar `cloudName` y `uploadPreset` en `src/mediaConfig.js`.
3. **Reglas:** `firebase deploy --only firestore:rules`

## 💻 Desarrollo local
```bash
python3 -m http.server 8080
# abre http://localhost:8080/public/
```
