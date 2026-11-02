// Almacenamiento de las pruebas multimedia.
//   "local":      servidor Node de este repositorio (server/), que guarda en /Volumes/HDD/Tux_Storage.
//   "cloudinary": servicio en la nube (rellena cloudName y un upload preset "Unsigned").
export const MEDIA_PROVIDER = "local";

// Dirección del servidor local. Si lo expones con un túnel (https), pon aquí esa URL.
export const LOCAL_MEDIA_SERVER = "http://localhost:8787";

export const CLOUDINARY = {
  cloudName: "",
  uploadPreset: ""
};

export const isMediaConfigured = () =>
  MEDIA_PROVIDER === "local" || Boolean(CLOUDINARY.cloudName && CLOUDINARY.uploadPreset);
