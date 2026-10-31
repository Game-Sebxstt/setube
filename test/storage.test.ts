import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_LENGTH,
  PLAYER_MODE_KEY,
  SEARCHES_KEY,
  type StorageLike,
  URLS_KEY,
  addRecentSearch,
  loadPlayerMode,
  loadPrefs,
  loadRecentSearches,
  loadTheme,
  loadUrls,
  parseRecentSearches,
  parseUrls,
  removeRecentSearch,
  savePlayerMode,
  savePrefs,
  saveRecentSearches,
  saveUrls,
  serializeRecentSearches,
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

describe('búsquedas recientes', () => {
  const raw = (items: unknown, v: unknown = 1) => JSON.stringify({ v, items });
  const many = (n: number) => Array.from({ length: n }, (_, i) => `consulta ${i + 1}`);

  it('clave, límites y formato v1', () => {
    expect(SEARCHES_KEY).toBe('setube_searches');
    expect(MAX_RECENT_SEARCHES).toBe(8);
    expect(MAX_SEARCH_LENGTH).toBe(200);
    expect(JSON.parse(serializeRecentSearches(['lofi', 'jazz']))).toEqual({ v: 1, items: ['lofi', 'jazz'] });
    expect(parseRecentSearches(serializeRecentSearches(['lofi', 'jazz']))).toEqual(['lofi', 'jazz']);
  });

  it('parse descarta JSON corrupto, otra versión u otra forma', () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches('')).toEqual([]);
    expect(parseRecentSearches('{no es json')).toEqual([]);
    expect(parseRecentSearches('42')).toEqual([]);
    expect(parseRecentSearches('null')).toEqual([]);
    expect(parseRecentSearches('["lofi"]')).toEqual([]);
    expect(parseRecentSearches(raw(['lofi'], 2))).toEqual([]);
    expect(parseRecentSearches(raw(['lofi'], '1'))).toEqual([]);
    expect(parseRecentSearches(JSON.stringify({ v: 1 }))).toEqual([]);
    expect(parseRecentSearches(raw('lofi'))).toEqual([]);
  });

  it('parse filtra entradas no string, vacías o demasiado largas', () => {
    const long = 'a'.repeat(MAX_SEARCH_LENGTH + 1);
    const limit = 'b'.repeat(MAX_SEARCH_LENGTH);
    expect(parseRecentSearches(raw([5, null, {}, ['x'], '', '   ', long, limit, 'ok']))).toEqual([limit, 'ok']);
  });

  it('parse normaliza espacios y quita duplicados sin distinguir mayúsculas', () => {
    expect(parseRecentSearches(raw(['  Lo   Fi\tbeats ', 'lo fi BEATS', 'jazz', 'JAZZ', 'Ñandú', 'ñandú']))).toEqual([
      'Lo Fi beats',
      'jazz',
      'Ñandú',
    ]);
  });

  it('parse recorta a 8 después de quitar duplicados', () => {
    expect(parseRecentSearches(raw(many(12)))).toEqual(many(8));
    expect(parseRecentSearches(raw(['a', 'A', ...many(8)]))).toEqual(['a', ...many(7)]);
  });

  it('add pone la nueva primero, normalizada', () => {
    expect(addRecentSearch([], '  lofi   beats ')).toEqual(['lofi beats']);
    expect(addRecentSearch(['jazz'], 'lofi')).toEqual(['lofi', 'jazz']);
  });

  it('add sube un duplicado al principio con la última forma escrita', () => {
    expect(addRecentSearch(['jazz', 'Lofi', 'rock'], 'LOFI')).toEqual(['LOFI', 'jazz', 'rock']);
    expect(addRecentSearch(['lofi', 'jazz'], 'lofi')).toEqual(['lofi', 'jazz']);
  });

  it('add recorta a 8', () => {
    const next = addRecentSearch(many(8), 'nueva');
    expect(next).toHaveLength(8);
    expect(next[0]).toBe('nueva');
    expect(next).not.toContain('consulta 8');
  });

  it('add ignora vacías o demasiado largas y no toca la lista', () => {
    const list = ['lofi'];
    expect(addRecentSearch(list, '')).toBe(list);
    expect(addRecentSearch(list, '   \n ')).toBe(list);
    expect(addRecentSearch(list, 'a'.repeat(MAX_SEARCH_LENGTH + 1))).toBe(list);
    expect(addRecentSearch(list, 'a'.repeat(MAX_SEARCH_LENGTH))).toHaveLength(2);
    expect(list).toEqual(['lofi']);
  });

  it('add es pura', () => {
    const list = ['jazz', 'lofi'];
    const next = addRecentSearch(list, 'rock');
    expect(next).not.toBe(list);
    expect(list).toEqual(['jazz', 'lofi']);
  });

  it('remove quita sin distinguir mayúsculas', () => {
    const list = ['jazz', 'Lofi', 'rock'];
    expect(removeRecentSearch(list, 'LOFI')).toEqual(['jazz', 'rock']);
    expect(removeRecentSearch(list, ' lofi ')).toEqual(['jazz', 'rock']);
    expect(list).toEqual(['jazz', 'Lofi', 'rock']);
  });

  it('remove devuelve la misma lista si no estaba', () => {
    const list = ['jazz'];
    expect(removeRecentSearch(list, 'rock')).toBe(list);
    expect(removeRecentSearch(list, '')).toBe(list);
  });

  it('load y save usan setube_searches', () => {
    const s = memory();
    saveRecentSearches(s, ['lofi', 'jazz']);
    expect(JSON.parse(s.data[SEARCHES_KEY] as string)).toEqual({ v: 1, items: ['lofi', 'jazz'] });
    expect(loadRecentSearches(s)).toEqual(['lofi', 'jazz']);
    expect(loadRecentSearches(memory())).toEqual([]);
    expect(loadRecentSearches(memory({ [SEARCHES_KEY]: '[[[' }))).toEqual([]);
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
    expect(loadRecentSearches(broken)).toEqual([]);
    expect(() => saveRecentSearches(broken, ['lofi'])).not.toThrow();
    expect(loadRecentSearches(null)).toEqual([]);
    expect(() => saveRecentSearches(undefined, ['lofi'])).not.toThrow();
  });

  it('no toca las otras claves', () => {
    const s = memory({ [URLS_KEY]: serializeUrls(['https://youtu.be/jNQXAC9IVRw']), setube_theme: 'light' });
    saveRecentSearches(s, ['lofi']);
    expect(loadUrls(s)).toEqual(['https://youtu.be/jNQXAC9IVRw']);
    expect(loadTheme(s)).toBe('light');
  });
});

describe('modo preferido del reproductor', () => {
  it('por defecto es audio y guarda solo audio o video', () => {
    const s = memory();
    expect(loadPlayerMode(s)).toBe('audio');
    savePlayerMode(s, 'video');
    expect(s.data[PLAYER_MODE_KEY]).toBe('video');
    expect(loadPlayerMode(s)).toBe('video');
    savePlayerMode(s, 'audio');
    expect(loadPlayerMode(s)).toBe('audio');
  });

  it('un valor desconocido o un storage roto vuelven a audio', () => {
    expect(loadPlayerMode(memory({ [PLAYER_MODE_KEY]: 'VIDEO' }))).toBe('audio');
    expect(loadPlayerMode(null)).toBe('audio');
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(loadPlayerMode(broken)).toBe('audio');
    expect(() => savePlayerMode(broken, 'video')).not.toThrow();
  });
});
