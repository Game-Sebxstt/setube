import type { Format, Kind, Quality } from './contract';

export const URLS_KEY = 'setube_urls';
export const PREFS_KEY = 'setube_prefs';
export const THEME_KEY = 'setube_theme';
export const VOLUME_KEY = 'setube_volume';
export const SEARCHES_KEY = 'setube_searches';

/** Búsquedas recientes que se recuerdan, de la más reciente a la más antigua. */
export const MAX_RECENT_SEARCHES = 8;
/** Las consultas más largas (ya normalizadas) no se guardan. */
export const MAX_SEARCH_LENGTH = 200;

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

/** Volumen del reproductor entre 0 y 1; cualquier otro valor vuelve a 1. */
export function loadVolume(s: StorageLike | null | undefined): number {
  const raw = safeGet(s, VOLUME_KEY);
  const v = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}
export function saveVolume(s: StorageLike | null | undefined, v: number): void {
  safeSet(s, VOLUME_KEY, String(Math.round(Math.min(1, Math.max(0, v)) * 100) / 100));
}

/** Consulta en una sola línea con espacios colapsados; `null` si queda vacía o pasa del límite. */
function normalizeSearch(q: unknown): string | null {
  if (typeof q !== 'string') return null;
  const n = q.trim().replace(/\s+/g, ' ');
  return n.length > 0 && n.length <= MAX_SEARCH_LENGTH ? n : null;
}
// Igual que la caché de resultados: no distingue mayúsculas
function searchKey(q: string): string {
  return q.toLocaleLowerCase('es');
}

/** Normaliza, quita duplicados (gana el primero, el más reciente) y recorta al máximo. */
function cleanSearches(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const q = normalizeSearch(entry);
    if (q === null) continue;
    const key = searchKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === MAX_RECENT_SEARCHES) break;
  }
  return out;
}

/** Parsea `setube_searches`: solo `{v:1, items: string[]}`. Cualquier otra cosa → []. */
export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? cleanSearches(items) : [];
}

export function serializeRecentSearches(list: readonly string[]): string {
  return JSON.stringify({ v: 1, items: list });
}

/** Pone la consulta primero sin duplicarla. Vacía o demasiado larga → la misma lista. */
export function addRecentSearch(list: readonly string[], q: string): readonly string[] {
  const n = normalizeSearch(q);
  if (n === null) return list;
  const key = searchKey(n);
  return [n, ...list.filter((e) => searchKey(e) !== key)].slice(0, MAX_RECENT_SEARCHES);
}

/** Quita la consulta sin distinguir mayúsculas. Si no estaba → la misma lista. */
export function removeRecentSearch(list: readonly string[], q: string): readonly string[] {
  const n = normalizeSearch(q);
  if (n === null) return list;
  const key = searchKey(n);
  const next = list.filter((e) => searchKey(e) !== key);
  return next.length === list.length ? list : next;
}

export function loadRecentSearches(s: StorageLike | null | undefined): string[] {
  return parseRecentSearches(safeGet(s, SEARCHES_KEY));
}
export function saveRecentSearches(s: StorageLike | null | undefined, list: readonly string[]): void {
  safeSet(s, SEARCHES_KEY, serializeRecentSearches(list));
}

/** Acceso seguro a window.localStorage (puede lanzar en algunos navegadores). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
