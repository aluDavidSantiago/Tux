# Tux 🐧

**Tux** es una red social minimalista, fluida y elegante, guiada por un pingüino. Sirve para descubrir y compartir actividades casuales, económicas y de bajo esfuerzo: planes pequeños que rompen la rutina sin gastar mucho ni cansarse.

🔗 **Demo:** https://aludavidsantiago.github.io/Tux/

## 🚀 Características
- **Feed estilo Shorts:** tarjetas a pantalla completa con desplazamiento vertical por pasos.
- **Filtros por presupuesto y esfuerzo:** Gratis · $ · $$ y Relax · Moderado.
- **Modo claro / oscuro:** sigue al sistema por defecto y recuerda tu elección.
- **Tux, la mascota:** presente en la marca, en los estados vacíos y en los detalles de la interfaz.
- **Cuentas con Google:** inicio de sesión mediante Firebase Authentication.

## 🛠️ Stack técnico
- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES nativos, sin paso de build).
- **Backend:** Firebase Authentication y Cloud Firestore (SDK modular vía CDN).
- **Hosting:** GitHub Pages.

## 📂 Estructura
```text
├── index.html              # Redirige a public/ (entrada de GitHub Pages)
├── public/
│   ├── index.html          # Interfaz principal
│   ├── css/styles.css      # Estilos y temas claro/oscuro
│   ├── js/app.js           # Lógica de interfaz (feed, filtros, tema, sesión)
│   └── assets/images/      # Recursos gráficos
├── src/
│   ├── firebaseConfig.js   # Inicialización de Firebase App, Auth y Firestore
│   ├── auth.js             # Inicio/cierre de sesión
│   └── activities.js       # Consultas de actividades con filtros
├── .gitignore
└── README.md
```

## 🗃️ Modelo de datos (Firestore)
Colección `activities`:

| Campo         | Tipo      | Valores                     |
|---------------|-----------|-----------------------------|
| `title`       | string    |                             |
| `description` | string    |                             |
| `emoji`       | string    | p. ej. `🌅`                 |
| `budget`      | string    | `free` · `low` · `mid`      |
| `effort`      | string    | `low` · `mid`               |
| `createdAt`   | timestamp |                             |

Mientras la colección esté vacía o no sea accesible, el feed muestra actividades de ejemplo.

## 💻 Desarrollo local
Los módulos ES requieren servirse por HTTP (no `file://`). Desde la raíz del repo:

```bash
python3 -m http.server 8080
# abre http://localhost:8080/public/
```
