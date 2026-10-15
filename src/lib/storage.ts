import type { Format, Kind, Quality } from './contract';

export const URLS_KEY = 'setube_urls';
export const PREFS_KEY = 'setube_prefs';
export const THEME_KEY = 'setube_theme';

export type Theme = 'dark' | 'light';
export interface Prefs {
  kind: Kind;
  format: Format;
  quality: Quality | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FORMATS: readonly Format[] = ['mp3', 'm4a', 'wav', 'mp4'];
const QUALITIES: readonly (number | string)[] = [128, 192, 320, 360, 480, 720, 1080, 'best'];

function safeGet(s: StorageLike | null | undefined, key: string): string | null {
  try {
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeSet(s: StorageLike | null | undefined, key: string, value: string): void {
  try {
    s?.setItem(key, value);
  } catch {
    // almacenamiento lleno o modo privado: se ignora
  }
}

/** Parsea `setube_urls`: v2 `{v:2, urls}` o v1 `[{id,url}]`. Cualquier otra cosa → []. */
export function parseUrls(raw: string | null): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data.map((e) => (e && typeof e === 'object' && 'url' in e ? (e as { url: unknown }).url : null));
  } else if (data && typeof data === 'object' && (data as { v?: unknown }).v === 2 && Array.isArray((data as { urls?: unknown }).urls)) {
    list = (data as { urls: unknown[] }).urls;
  }
  return list.filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= 2048);
}

export function serializeUrls(urls: readonly string[]): string {
  return JSON.stringify({ v: 2, urls });
}

export function loadUrls(s: StorageLike | null | undefined): string[] {
  return parseUrls(safeGet(s, URLS_KEY));
}
export function saveUrls(s: StorageLike | null | undefined, urls: readonly string[]): void {
  safeSet(s, URLS_KEY, serializeUrls(urls));
}

export function parsePrefs(raw: string | null): Prefs | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; kind?: unknown; format?: unknown; quality?: unknown };
    if (d?.v !== 1) return null;
    if (d.kind !== 'audio' && d.kind !== 'video') return null;
    if (!FORMATS.includes(d.format as Format)) return null;
    const quality = d.quality === null || QUALITIES.includes(d.quality as number | string) ? (d.quality as Quality | null) : null;
    return { kind: d.kind, format: d.format as Format, quality };
  } catch {
    return null;
  }
}
export function loadPrefs(s: StorageLike | null | undefined): Prefs | null {
  return parsePrefs(safeGet(s, PREFS_KEY));
}
export function savePrefs(s: StorageLike | null | undefined, p: Prefs): void {
  safeSet(s, PREFS_KEY, JSON.stringify({ v: 1, ...p }));
}

export function loadTheme(s: StorageLike | null | undefined): Theme {
  return safeGet(s, THEME_KEY) === 'light' ? 'light' : 'dark';
}
export function saveTheme(s: StorageLike | null | undefined, t: Theme): void {
  safeSet(s, THEME_KEY, t);
}

/** Acceso seguro a window.localStorage (puede lanzar en algunos navegadores). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
