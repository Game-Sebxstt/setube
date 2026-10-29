import { parseYouTubeUrl } from './youtube-url';

// Algo con pinta de URL no se busca aunque no sea de YouTube: se marca como no válido
const URL_LIKE = /^(https?:\/\/|www\.)|youtu\.?be|^[^\s]+\.[a-z]{2,}(\/|$)/i;

/** Texto de búsqueda: una sola línea que no es un link. `null` si hay que tratarlo como links. */
export function searchQuery(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) return null;
  const line = lines[0] as string;
  if (parseYouTubeUrl(line) || URL_LIKE.test(line)) return null;
  return line.replace(/\s+/g, ' ');
}
