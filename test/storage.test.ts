import { describe, expect, it } from 'vitest';
import {
  type StorageLike,
  URLS_KEY,
  loadPrefs,
  loadTheme,
  loadUrls,
  parseUrls,
  savePrefs,
  saveUrls,
  serializeUrls,
} from '../src/lib/storage';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('storage', () => {
  it('migra el formato v1 [{id,url}] a v2', () => {
    const v1 = JSON.stringify([
      { id: 'a', url: 'https://youtu.be/jNQXAC9IVRw' },
      { id: 'b', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    ]);
    expect(parseUrls(v1)).toEqual(['https://youtu.be/jNQXAC9IVRw', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  });

  it('lee y escribe v2 {v:2, urls}', () => {
    const s = memory();
    saveUrls(s, ['https://youtu.be/jNQXAC9IVRw']);
    expect(JSON.parse(s.data[URLS_KEY] as string)).toEqual({ v: 2, urls: ['https://youtu.be/jNQXAC9IVRw'] });
    expect(loadUrls(s)).toEqual(['https://youtu.be/jNQXAC9IVRw']);
  });

  it('JSON corrupto se descarta sin lanzar', () => {
    expect(parseUrls('{no es json')).toEqual([]);
    expect(parseUrls('{"v":3,"urls":["x"]}')).toEqual([]);
    expect(parseUrls('42')).toEqual([]);
    expect(parseUrls(null)).toEqual([]);
    expect(loadUrls(memory({ [URLS_KEY]: '[[[' }))).toEqual([]);
  });

  it('filtra entradas no string en v1 y v2', () => {
    expect(parseUrls(JSON.stringify([{ id: 'a' }, { url: 5 }, { url: 'ok' }]))).toEqual(['ok']);
    expect(parseUrls(serializeUrls(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('un storage que lanza no rompe nada', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(loadUrls(broken)).toEqual([]);
    expect(() => saveUrls(broken, ['x'])).not.toThrow();
    expect(loadTheme(broken)).toBe('dark');
  });

  it('prefs versionadas', () => {
    const s = memory();
    savePrefs(s, { kind: 'video', format: 'mp4', quality: 1080 });
    expect(loadPrefs(s)).toEqual({ kind: 'video', format: 'mp4', quality: 1080 });
    expect(loadPrefs(memory({ setube_prefs: '{"v":1,"kind":"audio","format":"flac"}' }))).toBeNull();
  });

  it('tema oscuro por defecto', () => {
    expect(loadTheme(memory())).toBe('dark');
    expect(loadTheme(memory({ setube_theme: 'light' }))).toBe('light');
    expect(loadTheme(memory({ setube_theme: 'sepia' }))).toBe('dark');
  });
});
