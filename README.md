# Setube - The Ultimate YouTube Converter

Setube is a modern, fast, and user-friendly web application for converting YouTube videos and playlists into high-quality audio or video formats. It's designed to be flexible, allowing for the conversion of multiple individual videos or entire playlists at once, completely free and without limitations.

## ✨ Features

-   **Dual Conversion Modes**: Seamlessly switch between converting individual URLs or entire YouTube playlists.
-   **Batch Processing**: Add and convert multiple video URLs simultaneously.
-   **Playlist Support**: Simply paste a playlist URL to fetch all its videos for conversion.
-   **Multiple Formats**:
    -   **Audio**: MP3, WAV, M4A
    -   **Video**: MP4
-   **ZIP Compression**: Downloads are automatically bundled into a `.zip` file when converting more than one file.
-   **Dynamic UI**: A clean and responsive interface built with React and Tailwind CSS for a smooth user experience.
-   **Live Progress Tracking**: For playlist conversions, a real-time progress bar keeps you updated.

## 🛠️ Technical Stack

Setube is built with a modern and robust technology stack:

-   **Frontend**:
    -   [Next.js](https://nextjs.org/) - React framework for server-side rendering and static site generation.
    -   [React](https://reactjs.org/) - A JavaScript library for building user interfaces.
    -   [TypeScript](https://www.typescriptlang.org/) - A typed superset of JavaScript that compiles to plain JavaScript.
    -   [Tailwind CSS](https://tailwindcss.com/) - A utility-first CSS framework for rapid UI development.
    -   [Lucide React](https://lucide.dev/) - Beautiful and consistent icons.
-   **Backend API**:
    -   The conversion logic is handled by a separate backend server. You can find the repository here: **[api-setube](https://github.com/GarcesSebastian/api-setube)**

## ⚙️ Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

-   Node.js (v20 or higher recommended)
-   You also need to have the [api-setube](https://github.com/GarcesSebastian/api-setube) server running locally.

### Installation

1.  **Clone the frontend repository:**
    ```bash
    git clone https://github.com/GarcesSebastian/convert-yt.git
    cd convert-yt
    ```

2.  **Install NPM packages:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env.local` file in the root of the project and add the URL of your backend API:
    ```
    NEXT_PUBLIC_API_URL=http://localhost:4000
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
