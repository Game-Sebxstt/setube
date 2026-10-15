import type { Format, Quality } from './contract';
import type { Options, QueueItem } from './queue';

export interface Preset {
  id: string;
  name: string;
  hint: string;
  format: Format;
  quality: Quality | null;
}

export const PRESETS: readonly Preset[] = [
  { id: 'musica', name: 'Música en alta', hint: 'MP3 a 320 kbps', format: 'mp3', quality: 320 },
  { id: 'diario', name: 'Uso diario', hint: 'MP3 a 192 kbps', format: 'mp3', quality: 192 },
  { id: 'podcast', name: 'Podcast liviano', hint: 'MP3 a 128 kbps', format: 'mp3', quality: 128 },
  { id: 'original', name: 'Audio original', hint: 'M4A sin recodificar', format: 'm4a', quality: null },
  { id: 'edicion', name: 'Para editar', hint: 'WAV sin compresión', format: 'wav', quality: null },
  { id: 'movil', name: 'Video para el móvil', hint: 'MP4 a 480p', format: 'mp4', quality: 480 },
  { id: 'hd', name: 'Video Full HD', hint: 'MP4 a 1080p', format: 'mp4', quality: 1080 },
];

export function presetMatches(p: Preset, o: Options): boolean {
  return p.format === o.format && p.quality === o.quality;
}

export interface FormatInfo {
  format: Format;
  label: string;
  kind: 'audio' | 'video';
  summary: string;
  /** Qué hace el servidor con el audio/video original. */
  process: string;
  reencodes: boolean;
  goodFor: string;
}

export const FORMAT_INFO: Record<Format, FormatInfo> = {
  mp3: {
    format: 'mp3',
    label: 'MP3',
    kind: 'audio',
    summary: 'Se reproduce en cualquier dispositivo, coche o reproductor.',
    process: 'Recodifica',
    reencodes: true,
    goodFor: 'Música y listas para escuchar en todas partes.',
  },
  m4a: {
    format: 'm4a',
    label: 'M4A',
    kind: 'audio',
    summary: 'El audio AAC tal como lo sirve YouTube, sin pérdida extra.',
    process: 'Sin recodificar',
    reencodes: false,
    goodFor: 'La mejor fidelidad posible con archivos pequeños.',
  },
  wav: {
    format: 'wav',
    label: 'WAV',
    kind: 'audio',
    summary: 'Audio sin compresión, 16 bits a 44,1 kHz. Archivos grandes.',
    process: 'Decodifica a PCM',
    reencodes: true,
    goodFor: 'Editar en un DAW, samplear o mezclar.',
  },
  mp4: {
    format: 'mp4',
    label: 'MP4',
    kind: 'video',
    summary: 'Video H.264 con su audio, copiado sin recodificar.',
    process: 'Sin recodificar',
    reencodes: false,
    goodFor: 'Ver sin conexión en el móvil, la tele o el portátil.',
  },
};

export const AUDIO_QUALITY_INFO: Record<string, string> = {
  128: 'Voz y podcasts. Cerca de 1 MB por minuto.',
  192: 'Equilibrio para música. Cerca de 1,4 MB por minuto.',
  320: 'El máximo de MP3. Cerca de 2,4 MB por minuto.',
};

export const VIDEO_QUALITY_INFO: Record<string, string> = {
  '360': 'Pantallas pequeñas y datos móviles.',
  '480': 'Se ve bien en el móvil y ocupa poco.',
  '720': 'HD para portátil y tablet.',
  '1080': 'Full HD para pantallas grandes.',
  best: 'La mayor resolución de cada video, hasta 1080p.',
};

/** Tamaño estimado de un item para un formato y calidad concretos (de GET /api/videos/:id). */
export function estimateFor(item: QueueItem, format: Format, quality: Quality | null): number | null {
  const e = item.estimated;
  if (!e) return null;
  if (format === 'mp3') return e.mp3[String(quality ?? 192) as '128' | '192' | '320'] ?? null;
  if (format === 'm4a') return e.m4a;
  if (format === 'wav') return e.wav;
  return e.mp4[String(quality ?? 720)] ?? null;
}

export interface Totals {
  items: number;
  convertible: number;
  duration: number;
  /** items con duración conocida */
  withDuration: number;
}

export function totalsOf(items: readonly QueueItem[]): Totals {
  let duration = 0;
  let withDuration = 0;
  let convertible = 0;
  for (const i of items) {
    if (i.meta !== 'error') convertible++;
    if (i.duration != null) {
      duration += i.duration;
      withDuration++;
    }
  }
  return { items: items.length, convertible, duration, withDuration };
}

/** Suma de tamaños estimados; `known` dice cuántos items aportaron dato. */
export function sizeOf(items: readonly QueueItem[], format: Format, quality: Quality | null): { bytes: number; known: number } {
  let bytes = 0;
  let known = 0;
  for (const i of items) {
    if (i.meta === 'error') continue;
    const b = estimateFor(i, format, quality);
    if (b != null) {
      bytes += b;
      known++;
    }
  }
  return { bytes, known };
}
