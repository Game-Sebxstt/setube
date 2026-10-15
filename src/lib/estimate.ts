import type { Format, Quality } from './contract';
import type { QueueItem } from './queue';

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
