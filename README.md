# Setube (web)

Cliente web de Setube, un convertidor de YouTube a audio y video. Pegas links de videos o playlists, eliges formato y calidad, y la descarga empieza en streaming mientras ves el progreso real de cada video. Los archivos no se guardan en el servidor.

Hecho por [Sebxstt](https://github.com/GarcesSebastian). En producción: [setube.sebxstt.dev](https://setube.sebxstt.dev).

Este repo es solo el frontend. La conversión la hace la API (repo `api-setube`).

## Qué hace la interfaz

- Barra de comandos para links. Acepta uno o varios por línea y marca cada línea en vivo como video, playlist o no válida. Pegar procesa al momento, `Enter` agrega, `Shift+Enter` añade otra línea y `Esc` limpia el campo. Las líneas no válidas se quedan en el campo para corregirlas.
- Atajos globales: `Ctrl/Cmd+V` fuera de un campo pega directo en la barra, `/` o `Ctrl/Cmd+K` la enfocan y `Ctrl/Cmd+Enter` convierte desde cualquier parte.
- Playlists: se expanden en sus videos (hasta el límite que devuelve la API) y muestran una tarjeta con miniatura, título, cantidad y aviso si se recortó. Un link `watch?v=...&list=...` agrega el video y ofrece "Agregar la playlist completa".
- Selector de salida compacto, pegado bajo la barra de comandos en el mismo recuadro:
  - Control segmentado Audio | Video y chips de formato (MP3, M4A, WAV o MP4).
  - Calidad en un desplegable: MP3 a 128/192/320 kbps y MP4 de 360p a 1080p o "Mejor", con el tamaño estimado de cada opción. M4A queda en calidad original y WAV en 16 bits a 44,1 kHz. Con un solo video en la cola se deshabilitan las calidades que ese video no tiene.
  - Una línea con lo que hace el formato elegido y otra con el resumen de la cola: videos, duración total, tamaño estimado y duración máxima por video.
  - En desktop el botón Convertir/Cancelar va al final de esa fila; en móvil queda en la barra fija de abajo.
- Ficha por video: canal, duración, playlist de origen, resoluciones disponibles, tamaño estimado para cada salida, descripción y enlace a YouTube.
- Cola con progreso en vivo por SSE: medidor segmentado por fila con porcentaje, fase (en cola, obteniendo datos, descargando, convirtiendo, listo) y velocidad, más una barra general con el progreso total. En móvil esa barra queda fija abajo junto al botón principal.
- Descarga con el gestor nativo del navegador: un video baja como archivo y dos o más como ZIP ("Descargar todo (ZIP)"). Cada fila se puede descargar, reintentar o quitar, la conversión en curso se puede cancelar y "Vaciar" la cola se puede deshacer.
- Persistencia local en `localStorage`: links de la cola (`setube_urls`), formato y calidad (`setube_prefs`) y tema (`setube_theme`).
- Tema oscuro por defecto y claro opcional, aplicado antes del primer pintado para evitar el parpadeo.
- Accesibilidad: controles nativos (radios, fieldsets, botones con `aria-pressed`), anuncios `aria-live` cuando terminan las conversiones, avisos que se pausan con el foco y objetivos táctiles de 44 px.
- SEO: metadatos, Open Graph y Twitter con imagen generada, JSON-LD, `robots.txt` y `sitemap.xml`. FAQ estática renderizada en el servidor.
- Cabeceras de seguridad: CSP estricta (incluye la URL de la API y Turnstile solo si está configurado), `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
- Cloudflare Turnstile invisible opcional, activo solo si la API lo pide y hay site key.

## Stack

- Next.js 16 (App Router, `output: 'standalone'`)
- React 19 y TypeScript
- Tailwind CSS v4
- lucide-react para iconos
- Fuentes autoalojadas con `next/font`: Archivo (títulos), IBM Plex Sans (texto) y JetBrains Mono (cifras)
- Vitest para pruebas unitarias y Playwright con axe para las pruebas de extremo a extremo

## Desarrollo local

Requisitos: Node 24 y la API corriendo.

1. Levanta la API. Desde la carpeta raíz que contiene `setube` y `api-setube`, con el `.env` raíz creado a partir de `.env.example` (`REDIS_PASSWORD`, `IP_HASH_SALT`):

   ```bash
   docker compose --profile dev up redis api-dev
   ```

   La API queda en http://localhost:4000.

2. Configura y arranca la web:

   ```bash
   cp .env.example .env.local
   npm install
   npm run dev
   ```

   Abre http://localhost:3000.

## Variables de entorno

Todas son públicas y de build: Next las incrusta en el bundle al compilar. Si cambias alguna tienes que volver a hacer el build (o redeploy).

| Variable | Obligatoria | Default | Uso |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Sí | ninguno | URL pública de la API. Sin ella `next build` falla. En `.env.example` está `http://localhost:4000`. |
| `NEXT_PUBLIC_SITE_URL` | No | `https://setube.sebxstt.dev` | URL canónica del sitio para metadatos, sitemap y Open Graph. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No | vacía | Site key de Cloudflare Turnstile. Vacía desactiva el captcha. |

Los límites (videos por tanda, duración máxima, calidades) no se configuran aquí: la web los lee de `GET /api/config` y, si la llamada falla, usa los valores por defecto de `src/lib/defaults.ts`.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo en el puerto 3000 |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build con `next start` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Pruebas unitarias con Vitest |
| `npm run e2e` | Pruebas de Playwright contra el stack de Docker Compose |

## Docker

El `Dockerfile` hace el build en varias etapas y deja solo la salida standalone corriendo como usuario `node`.

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.ejemplo.com -t setube-web .
docker run --rm -p 3000:3000 setube-web
```

También acepta `NEXT_PUBLIC_SITE_URL` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` como `--build-arg`. El contenedor escucha en `PORT=3000` y trae un healthcheck que consulta `/robots.txt`.

El `.dockerignore` deja fuera `.env*`, las pruebas y algunos archivos sueltos de `public` (`sebxstt.zip`, `test.pdf`), así que no acaban en la imagen.

## Despliegue en Railway

1. Crea un servicio desde este repo. Railway detecta el `Dockerfile` y lo usa.
2. Variables del servicio:
   - `PORT=3000`
   - `NEXT_PUBLIC_API_URL=https://api-setube.sebxstt.dev` (o `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` si aún no tienes el dominio propio; cambia `api` por el nombre de tu servicio de la API)
   - `NEXT_PUBLIC_SITE_URL=https://setube.sebxstt.dev`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` si usas Turnstile

   Como el `Dockerfile` declara esas variables con `ARG`, Railway se las pasa al build. Al cambiarlas hace falta un redeploy.
3. En Settings, pon `/robots.txt` como healthcheck path.
4. En Networking, genera un dominio apuntando al puerto 3000 y añade el dominio propio `setube.sebxstt.dev` con el CNAME que te indique Railway.
5. Añade `https://setube.sebxstt.dev` a `CORS_ORIGINS` de la API; si no, el navegador bloquea las peticiones.

## Estructura

```
src/
  app/          layout, página, not-found, robots, sitemap, imágenes OG y estilos globales
  components/
    converter/  barra de comandos, selector de salida, cola, filas, medidores y avisos
    site/       cabecera, pie, FAQ, tema y JSON-LD
  config/       URLs públicas del sitio y CSP
  lib/          cliente de la API, tipos del contrato, estado de la cola, SSE, descargas, formato y persistencia
test/           pruebas unitarias
e2e/            pruebas de Playwright
```

## Aviso legal

Setube es para contenido propio o sobre el que tengas permiso. Descargar material protegido sin autorización puede infringir los derechos de autor y los términos de YouTube.
