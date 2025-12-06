# Setube - El Convertidor de YouTube Definitivo

Setube es una aplicación web moderna, rápida y fácil de usar para convertir videos y playlists de YouTube a formatos de audio o video de alta calidad. Está diseñado para ser flexible, permitiendo la conversión de múltiples videos individuales o playlists enteras a la vez, de forma totalmente gratuita y sin limitaciones.

## ✨ Características

-   **Dos Modos de Conversión**: Cambia fácilmente entre la conversión de URLs individuales o playlists completas de YouTube.
-   **Procesamiento por Lotes**: Agrega y convierte múltiples URLs de video simultáneamente.
-   **Soporte para Playlists**: Simplemente pega la URL de una playlist para obtener todos sus videos para la conversión.
-   **Múltiples Formatos**:
    -   **Audio**: MP3, WAV, M4A
    -   **Video**: MP4
-   **Compresión ZIP**: Las descargas se empaquetan automáticamente en un archivo `.zip` al convertir más de un archivo.
-   **Interfaz de Usuario Dinámica**: Una interfaz limpia y receptiva construida con React y Tailwind CSS para una experiencia de usuario fluida.
-   **Seguimiento de Progreso en Vivo**: Para las conversiones de playlists, una barra de progreso en tiempo real te mantiene actualizado.

## 🛠️ Stack Tecnológico

Setube está construido con un stack tecnológico moderno y robusto:

-   **Frontend**:
    -   [Next.js](https://nextjs.org/) - Framework de React para renderizado del lado del servidor y generación de sitios estáticos.
    -   [React](https://reactjs.org/) - Una biblioteca de JavaScript para construir interfaces de usuario.
    -   [TypeScript](https://www.typescriptlang.org/) - Un superconjunto tipado de JavaScript que compila a JavaScript plano.
    -   [Tailwind CSS](https://tailwindcss.com/) - Un framework de CSS "utility-first" para un desarrollo rápido de la interfaz de usuario.
    -   [Lucide React](https://lucide.dev/) - Iconos hermosos y consistentes.
-   **API Backend**:
    -   La lógica de conversión es manejada por un servidor backend separado. Puedes encontrar el repositorio aquí: **[api-setube](https://github.com/GarcesSebastian/api-setube)**

## ⚙️ Cómo Empezar

Para obtener una copia local y ponerla en marcha, sigue estos sencillos pasos.

### Prerrequisitos

-   Node.js (se recomienda v20 o superior)
-   También necesitas tener el servidor [api-setube](https://github.com/GarcesSebastian/api-setube) corriendo localmente.

### Instalación

1.  **Clona el repositorio del frontend:**
    ```bash
    git clone https://github.com/GarcesSebastian/convert-yt.git
    cd convert-yt
    ```

2.  **Instala los paquetes de NPM:**
    ```bash
    npm install
    ```

3.  **Configura las variables de entorno:**
    Crea un archivo `.env.local` en la raíz del proyecto y agrega la URL de tu API de backend:
    ```
    NEXT_PUBLIC_API_URL=http://localhost:4000
    ```

4.  **Ejecuta el servidor de desarrollo:**
    ```bash
    npm run dev
    ```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador para ver el resultado.
