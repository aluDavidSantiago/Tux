# Tux 🐧

**Tux** es una red social minimalista, fluida y elegante, guiada por un pingüino. Sirve para descubrir y compartir actividades casuales, económicas y de bajo esfuerzo: planes pequeños que rompen la rutina sin gastar mucho ni cansarse.

🔗 **Demo:** https://aludavidsantiago.github.io/Tux/

## 🚀 Características
- **Feed a pantalla completa:** un plan por pantalla con snap-scroll vertical, al estilo Shorts/Reels. Doble toque = «Me apunto».
- **Tarjetas completas:** categoría (Chill, Aventura, Gastronomía, Cultura, Nocturno), presupuesto (Gratis · $ · $$ · $$$), esfuerzo (Bajo · Medio · Alto), momento del día y duración.
- **Social en tiempo real:** contador de «Me apunto» y comentarios sincronizados con Firestore; guardar planes y marcarlos como «Lo hice».
- **Filtros y búsqueda:** presupuesto (Gratis, <10 €, 10–25 €, +25 €), energía (Relax total, Paseo ligero, Activo), vibe y cuándo (Día, Noche, Finde), combinables y aplicados al instante.
- **Cuentas:** email/contraseña (con recuperación) y «Continuar con Google»; perfil creado automáticamente en `users/{uid}`.
- **Perfil:** avatar de Tux interactivo (toca para cambiar su color) o foto propia, nickname y bio editables, pestañas *Mis planes*, *Guardados* y *Cumplidos*.
- **Publicar TuxPlan:** formulario con vista previa en vivo, imagen por URL o ilustración de Tux.
- **Tema claro / oscuro / sistema**, con negro OLED (`#0D0D0E`) y acento naranja pingüino (`#FF6B35` → `#FF8800`).
- **Mobile-first:** en escritorio la app se muestra en un marco centrado tipo teléfono.

## 🛠️ Stack técnico
- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES nativos, sin paso de build).
- **Backend:** Firebase Authentication y Cloud Firestore (SDK modular vía CDN).
- **Hosting:** GitHub Pages.

## 📂 Estructura
```text
├── index.html              # Redirige a public/ (entrada de GitHub Pages)
├── public/
│   ├── index.html          # Vistas, modales y sprite de iconos/mascota
│   ├── css/styles.css      # Sistema de diseño, temas y animaciones
│   ├── js/app.js           # Lógica de interfaz
│   └── assets/images/
├── src/
│   ├── firebaseConfig.js   # Inicialización de Firebase App, Auth y Firestore
│   ├── auth.js             # Email/contraseña, Google, recuperación, sesión
│   ├── users.js            # Perfiles (users/{uid})
│   ├── activities.js       # Catálogo de opciones, feed en tiempo real, publicación, filtros
│   └── social.js           # Me apunto, guardados, cumplidos y comentarios
├── firestore.rules         # Reglas de seguridad
├── firebase.json / .firebaserc
└── README.md
```

## 🗃️ Modelo de datos (Firestore)

| Colección | ID | Campos |
|-----------|----|--------|
| `users` | `{uid}` | `nickname`, `photoURL`, `avatarColor`, `bio`, `createdAt` |
| `activities` | auto | `title`, `description`, `emoji`, `imageUrl`, `category`, `budget`, `effort`, `when`, `duration`, `authorId`, `authorName`, `likeCount`, `commentCount`, `createdAt` |
| `activities/{id}/comments` | auto | `authorId`, `authorName`, `text`, `createdAt` |
| `likes` · `saved` · `completed` | `{uid}_{activityId}` | `uid`, `activityId`, `createdAt` |

Valores: `category` ∈ chill · aventura · gastronomia · cultura · nocturno; `budget` ∈ free · low · mid · high; `effort` ∈ low · mid · high; `when` ∈ day · night · weekend.

Los contadores `likeCount`/`commentCount` se actualizan en el mismo batch que el like o comentario, y las reglas verifican que cuadren. Mientras no haya planes publicados, el feed muestra planes de ejemplo.

## 🔐 Configuración de Firebase
1. **Authentication → Sign-in method:** activar *Email/Password* y *Google*.
2. **Authentication → Settings → Authorized domains:** añadir `aludavidsantiago.github.io`.
3. Desplegar reglas:
   ```bash
   firebase deploy --only firestore:rules
   ```

## 💻 Desarrollo local
Los módulos ES requieren servirse por HTTP (no `file://`). Desde la raíz del repo:

```bash
python3 -m http.server 8080
# abre http://localhost:8080/public/
```
