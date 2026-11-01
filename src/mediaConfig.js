// Configuración de Cloudinary para las pruebas multimedia (subida sin firma).
// 1. Crea una cuenta gratuita en https://cloudinary.com
// 2. Settings → Upload → Upload presets → Add upload preset → Signing mode: "Unsigned"
// 3. Copia aquí tu "Cloud name" y el nombre del preset.
export const CLOUDINARY = {
  cloudName: "",
  uploadPreset: ""
};

export const isMediaConfigured = () => Boolean(CLOUDINARY.cloudName && CLOUDINARY.uploadPreset);
