import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecentSearches } from '../src/lib/recent-searches';
import { MAX_RECENT_SEARCHES, SEARCHES_KEY, type StorageLike, serializeRecentSearches } from '../src/lib/storage';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string>; writes: number } {
  const data = { ...init };
  const s = {
    data,
    writes: 0,
    getItem: (k: string) => (k in data ? (data[k] as string) : null),
    setItem: (k: string, v: string) => {
      s.writes++;
      data[k] = v;
    },
  };
  return s;
}

const saved = (s: { data: Record<string, string> }) => JSON.parse(s.data[SEARCHES_KEY] as string) as unknown;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRecentSearches', () => {
  it('sin window no lanza y empieza vacío', () => {
    expect(typeof window).toBe('undefined');
    const store = createRecentSearches();
    expect(store.getSnapshot()).toEqual([]);
    expect(store.getServerSnapshot()).toEqual([]);
    const off = store.subscribe(() => undefined);
    store.add('lofi');
    expect(store.getSnapshot()).toEqual(['lofi']);
    off();
  });

  it('lee de forma perezosa en el primer getSnapshot', () => {
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['b', 'a']) });
    const getStorage = vi.fn(() => s);
    const store = createRecentSearches(getStorage);
    expect(getStorage).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual(['b', 'a']);
    expect(getStorage).toHaveBeenCalledTimes(1);
  });

  it('getSnapshot devuelve la misma referencia mientras no cambia', () => {
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['a']) });
    const store = createRecentSearches(() => s);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
  });

  it('add pone la consulta primero, persiste y notifica', () => {
    const s = memory();
    const store = createRecentSearches(() => s);
    const fn = vi.fn();
    store.subscribe(fn);
    store.add('karol g');
    store.add('bad bunny');
    store.add('Karol G');
    expect(store.getSnapshot()).toEqual(['Karol G', 'bad bunny']);
    expect(saved(s)).toEqual({ v: 1, items: ['Karol G', 'bad bunny'] });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('sin cambios no notifica, no escribe y conserva la referencia', () => {
    const s = memory();
    const store = createRecentSearches(() => s);
    store.add('a');
    const before = store.getSnapshot();
    const writes = s.writes;
    const fn = vi.fn();
    store.subscribe(fn);
    store.add('a'); // ya es la primera
    store.add('   '); // vacía
    store.add('x'.repeat(201)); // demasiado larga
    store.remove('no estaba');
    store.restore(['a']);
    expect(fn).not.toHaveBeenCalled();
    expect(s.writes).toBe(writes);
    expect(store.getSnapshot()).toBe(before);
  });

  it('remove quita sin distinguir mayúsculas, persiste y notifica', () => {
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['Lofi', 'jazz']) });
    const store = createRecentSearches(() => s);
    const fn = vi.fn();
    store.subscribe(fn);
    store.remove('LOFI');
    expect(store.getSnapshot()).toEqual(['jazz']);
    expect(saved(s)).toEqual({ v: 1, items: ['jazz'] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clear vacía y restore recupera la lista entera', () => {
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['c', 'b', 'a']) });
    const store = createRecentSearches(() => s);
    const fn = vi.fn();
    store.subscribe(fn);
    const list = store.getSnapshot();
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(saved(s)).toEqual({ v: 1, items: [] });
    store.restore(list);
    expect(store.getSnapshot()).toEqual(['c', 'b', 'a']);
    expect(saved(s)).toEqual({ v: 1, items: ['c', 'b', 'a'] });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('restore limpia la lista: normaliza, quita duplicados y recorta', () => {
    const s = memory();
    const store = createRecentSearches(() => s);
    const many = Array.from({ length: MAX_RECENT_SEARCHES + 2 }, (_, i) => `q${i}`);
    store.restore([' Lofi ', 'lofi', '', ...many]);
    expect(store.getSnapshot()).toEqual(['Lofi', ...many.slice(0, MAX_RECENT_SEARCHES - 1)]);
    store.add('lofi');
    expect(store.getSnapshot()[0]).toBe('lofi');
    expect(store.getSnapshot().filter((q) => q.toLowerCase() === 'lofi')).toHaveLength(1);
  });

  it('respeta el máximo de búsquedas', () => {
    const s = memory();
    const store = createRecentSearches(() => s);
    for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i++) store.add(`q${i}`);
    expect(store.getSnapshot()).toHaveLength(MAX_RECENT_SEARCHES);
    expect(store.getSnapshot()[0]).toBe(`q${MAX_RECENT_SEARCHES + 2}`);
  });

  it('dejar de suscribirse corta las notificaciones', () => {
    const store = createRecentSearches(() => memory());
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    off(); // dos veces no rompe nada
    store.add('a');
    expect(fn).not.toHaveBeenCalled();
  });

  it('un storage que lanza no rompe el store', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createRecentSearches(() => broken);
    expect(store.getSnapshot()).toEqual([]);
    store.add('lofi');
    expect(store.getSnapshot()).toEqual(['lofi']);
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('si no se puede escribir (cuota llena) conserva lo de memoria', () => {
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['a']) });
    const full: StorageLike = {
      getItem: s.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createRecentSearches(() => full);
    store.add('b');
    expect(store.getSnapshot()).toEqual(['b', 'a']);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('sin almacenamiento (null) funciona solo en memoria', () => {
    const store = createRecentSearches(() => null);
    store.add('lofi');
    expect(store.getSnapshot()).toEqual(['lofi']);
  });
});

describe('createRecentSearches entre pestañas', () => {
  function fakeWindow() {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const fire = (key: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { target, fire };
  }

  it('sigue el evento storage de setube_searches mientras hay suscriptores', () => {
    const { fire } = fakeWindow();
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['a']) });
    const store = createRecentSearches(() => s);
    const fn = vi.fn();
    const off = store.subscribe(fn);
    expect(store.getSnapshot()).toEqual(['a']);

    // otra pestaña escribe
    s.data[SEARCHES_KEY] = serializeRecentSearches(['b', 'a']);
    fire(SEARCHES_KEY);
    expect(store.getSnapshot()).toEqual(['b', 'a']);
    expect(fn).toHaveBeenCalledTimes(1);

    // otras claves no cuentan, y el mismo contenido no notifica
    fire('setube_urls');
    fire(SEARCHES_KEY);
    expect(fn).toHaveBeenCalledTimes(1);

    // localStorage.clear() en otra pestaña
    delete s.data[SEARCHES_KEY];
    fire(null);
    expect(store.getSnapshot()).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);

    off();
    s.data[SEARCHES_KEY] = serializeRecentSearches(['c']);
    fire(SEARCHES_KEY);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sin suscriptores vuelve a leer al pedir la lista y al cambiarla', () => {
    fakeWindow();
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['a']) });
    const store = createRecentSearches(() => s);
    const off = store.subscribe(() => undefined);
    const before = store.getSnapshot();
    off();
    // mismo contenido: misma referencia
    expect(store.getSnapshot()).toBe(before);
    s.data[SEARCHES_KEY] = serializeRecentSearches(['z', 'a']);
    expect(store.getSnapshot()).toEqual(['z', 'a']);
    // add parte de lo guardado, no de la copia en memoria
    s.data[SEARCHES_KEY] = serializeRecentSearches(['b', 'a']);
    store.add('a');
    expect(store.getSnapshot()).toEqual(['a', 'b']);
  });

  it('al volver a suscribirse avisa de lo que cambió mientras nadie escuchaba', () => {
    fakeWindow();
    const s = memory({ [SEARCHES_KEY]: serializeRecentSearches(['a']) });
    const store = createRecentSearches(() => s);
    expect(store.getSnapshot()).toEqual(['a']);
    s.data[SEARCHES_KEY] = serializeRecentSearches(['b', 'a']);
    const fn = vi.fn();
    store.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual(['b', 'a']);
  });
});
