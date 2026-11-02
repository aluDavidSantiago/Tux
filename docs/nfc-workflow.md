# Quick Share · Insta360 → Tux con una etiqueta NFC

Acercas el iPhone a una etiqueta NFC (pegada en el palo de selfi o en la funda de la Insta360) y:

1. Un **Atajo de iOS** coge la última foto 360° exportada de la Insta360.
2. La **sube al disco de Tux** (`/Volumes/HDD/Tux_Storage/users/{tu uid}/`) a través del túnel HTTPS.
3. Abre Tux en **«Publicación rápida»** con ese archivo ya cargado: eliges la actividad, la portada 360°, escribes el comentario y publicas.

```text
Etiqueta NFC ─▶ Atajo de iOS ─▶ POST {servidor}/api/quick/upload (clave X-Tux-Key) ─▶ HDD del Mac mini
                     │
                     └─▶ abre https://aludavidsantiago.github.io/Tux/upload/?quick={archivo} ─▶ modal «Publicación rápida»
```

> **¿Por qué el atajo sube el archivo él mismo?** Ninguna web (tampoco Safari en iOS) puede leer la fototeca por su
> cuenta, e iOS no permite que un atajo «pase» un archivo a una página web. Por eso el atajo sube la foto con tu
> clave personal y la app solo tiene que recogerla.
>
> **¿Por qué no `https://…trycloudflare.com/upload?quick=true`?** Esa dirección es el **servidor multimedia** (el
> HDD), no la app web: ahí no hay ninguna página `/upload`. La app vive en GitHub Pages. Además, la URL del túnel
> rápido cambia cada vez que se reinicia, así que el atajo la lee cada vez de la configuración pública de Tux.

## Enlaces que entiende la app

Funcionan tanto en `/Tux/upload/` como en `/Tux/public/`:

| Enlace | Qué hace |
|---|---|
| `https://aludavidsantiago.github.io/Tux/upload/?quick=true` | Abre «Publicación rápida» para elegir el archivo con un toque (sin atajo de subida). |
| `…/upload/?quick={uuid}.jpg` | Carga ese archivo, que el atajo acaba de subir a tu carpeta del HDD. Es la URL que devuelve el servidor en `openUrl`. |
| `…/upload/?quick=true&mediaUrl=https://…` | Descarga un archivo de otra web (solo si esa web permite CORS) y lo prepara para publicar. |
| `&autoOpen360=true` | Si el archivo es 360°, abre directamente el visor para **fijar la portada**. |

Si no has iniciado sesión, Tux te la pide y después continúa con la publicación. Si cierras el modal sin publicar
un archivo importado, Tux pregunta si quieres borrarlo del disco.

## Requisitos

- iPhone XS o posterior (lectura NFC en segundo plano) con la app **Atajos**.
- Etiquetas NFC NTAG213/215/216 (las pegatinas normales sirven; no hace falta grabarles nada).
- La app de Insta360 configurada para **exportar las fotos 360° a la fototeca** como JPG equirectangular
  («Exportar» → foto 360°, no la versión reencuadrada).
- El túnel de Tux activo y su URL publicada en `/admin → Servidor multimedia`.

## 1. Genera tu clave de subida rápida

En Tux: **Ajustes → Quick Share · NFC → Generar clave para el atajo** y copia la clave (`tuxq_…`). Solo se muestra
una vez. Generar otra invalida la anterior, y **Revocar clave** desactiva el atajo al momento (por ejemplo, si
pierdes el móvil).

## 2. Crea el atajo «Subir a Tux»

En **Atajos → «+»**, añade estas acciones en orden. Los nombres son los de iOS en español:

1. **Buscar fotos**
   - Filtro: *Álbum* es *Insta360* (el álbum que crea la app de Insta360 al exportar; comprueba su nombre exacto en Fotos).
   - Ordenar por *Fecha de creación* · *Más reciente primero* · *Limitar* activado a **1**.
   - Alternativa sin álbum: **Obtener las últimas fotos** (1).
2. **Convertir imagen** → a **JPEG**, calidad alta, con **«Conservar metadatos» activado**: así Tux detecta el 360° también
   por los metadatos XMP, y no solo por la proporción 2:1. Este paso evita además las fotos HEIC, que Tux rechaza.
3. **Obtener contenido de la URL**:
   `https://firestore.googleapis.com/v1/projects/tuxsocial/databases/(default)/documents/config/media`
   (método GET). Devuelve la URL del túnel activo.
4. **Obtener valor del diccionario** → clave `fields.serverUrl.stringValue` del *Contenido de la URL*.
   Renómbralo como variable **Servidor** («Añadir a variable» o «Establecer variable»).
5. **Obtener contenido de la URL**: `Servidor` + `/api/quick/upload`
   - Método: **POST**
   - Encabezados: `X-Tux-Key` = *tu clave* · `Content-Type` = `image/jpeg`
   - Cuerpo de la solicitud: **Archivo** → la *Imagen convertida* del paso 2.
6. **Obtener valor del diccionario** → clave `openUrl` del contenido devuelto por el paso 5.
7. **Abrir URL** → el *Valor del diccionario* del paso 6.

Opcional: tras el paso 5, añade **Si** el *Contenido de la URL* contiene `error` → **Mostrar alerta** con ese valor
(clave revocada, archivo demasiado grande, etc.).

Ejecuta el atajo una vez a mano para conceder los permisos de Fotos y de red.

### Vídeos 360°

Cloudflare limita cada petición a 100 MB, así que el atajo admite archivos de hasta **95 MB**. Para vídeos, cambia el paso 1
por **Buscar vídeos**, quita el paso 2 y pon `Content-Type` = `video/mp4`. Los vídeos 360° más pesados súbelos desde la app
(«Completar plan»), que los envía por trozos.

## 3. Vincula la etiqueta NFC

1. **Atajos → Automatización → «+»** (o «Nueva automatización») → **NFC**.
2. **Escanear** y acerca la etiqueta; ponle un nombre (por ejemplo, «Palo Insta360»).
3. Marca **Ejecutar inmediatamente** y desactiva «Notificar al ejecutar» si no quieres el aviso.
4. Elige el atajo **Subir a Tux**.

Pega la etiqueta en el palo de selfi o en la funda de la cámara. Con el iPhone desbloqueado, acércalo a la etiqueta.

## Probar el flujo paso a paso

1. **Solo la app:** abre en el iPhone `https://aludavidsantiago.github.io/Tux/upload/?quick=true` (o
   **Ajustes → Quick Share → Probar publicación rápida**). Debe abrirse «Publicación rápida» con el desplegable de
   actividades. Elige una foto 360° y pulsa **Elegir portada 360°**: el visor muestra «Fijar como portada».
2. **El servidor, desde el Mac:** con tu clave y una foto 360°:
   ```bash
   SERVER=$(cd server && npm run -s tunnel:url)
   curl -s -X POST -H "X-Tux-Key: tuxq_…" --data-binary @foto360.jpg "$SERVER/api/quick/upload"
   # {"ok":true,"file":"….jpg","openUrl":"https://aludavidsantiago.github.io/Tux/upload/?quick=….jpg",…}
   ```
   Abre ese `openUrl` en el iPhone (por AirDrop o copiándolo): la foto debe aparecer ya cargada. Añade
   `&autoOpen360=true` para que se abra directamente el selector de portada.
3. **El atajo:** ejecútalo desde la app Atajos y comprueba que termina abriendo Tux con tu última foto.
4. **La etiqueta:** acerca el iPhone a la etiqueta NFC.

## Seguridad

- La clave solo permite **subir** a tu propia carpeta: no da acceso a ver, borrar ni publicar. Publicar sigue
  necesitando tu sesión de Tux.
- Va firmada con HMAC por el servidor. Solo vale la última clave emitida para cada usuario, y eliminar una cuenta desde `/admin`
  la revoca.
- Las subidas por atajo cuentan para tu cuota (20 GB) y para el límite de 20 subidas por minuto.
- Desactivar una cuenta desde `/admin` no revoca su clave de atajo; si hace falta, elimina la cuenta o pide al usuario
  que la revoque. El archivo subido no se puede publicar igualmente, porque las reglas bloquean las cuentas desactivadas.
