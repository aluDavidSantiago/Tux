// Inicialización de Firebase (App, Auth y Firestore) vía CDN modular.
// Nota: la apiKey web de Firebase es pública por diseño; la seguridad real
// depende de las reglas de Firestore y de los dominios autorizados en Auth.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBH2drrxf3p2L0CJYUyPjvH8JfhIQEsyD4",
  authDomain: "tuxsocial.firebaseapp.com",
  projectId: "tuxsocial",
  storageBucket: "tuxsocial.firebasestorage.app",
  messagingSenderId: "1028610750643",
  appId: "1:1028610750643:web:0ed9096b2ecc9e7c9ed8c6",
  measurementId: "G-ER3SV0SH1E"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
