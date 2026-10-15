const DEFAULT_SITE_URL = 'https://setube.sebxstt.dev';

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Next incrusta NEXT_PUBLIC_* en build; el acceso a process.env tiene que ser estático.
export const SITE_URL = trimSlash(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL);
export const API_URL = trimSlash(process.env.NEXT_PUBLIC_API_URL || '');
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

export const SITE_NAME = 'Setube';
export const SITE_TITLE = 'Setube: convierte YouTube a MP3, M4A, WAV y MP4';
export const SITE_DESCRIPTION =
  'Pega links de YouTube, de videos o playlists, y descárgalos en MP3, M4A, WAV o MP4 con progreso en tiempo real.';
export const AUTHOR = { name: 'Sebxstt', alternateName: 'GarcesSebastian', url: 'https://github.com/GarcesSebastian' };
