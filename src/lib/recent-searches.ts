import { useSyncExternalStore } from 'react';
import {
  SEARCHES_KEY,
  type StorageLike,
  addRecentSearch,
  browserStorage,
  parseRecentSearches,
  removeRecentSearch,
  saveRecentSearches,
  serializeRecentSearches,
} from './storage';

export interface RecentSearches {
  subscribe(fn: () => void): () => void;
  /** Lista actual, de la más reciente a la más antigua. Misma referencia mientras no cambie. */
  getSnapshot(): readonly string[];
  /** En el servidor y durante la hidratación no hay historial. */
  getServerSnapshot(): readonly string[];
  add(q: string): void;
  remove(q: string): void;
  clear(): void;
  /** Vuelve a poner una lista guardada antes (el "Deshacer" de borrar el historial). */
  restore(list: readonly string[]): void;
}

const EMPTY: readonly string[] = Object.freeze([]);

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((q, i) => q === b[i]);
}

/**
 * Historial de búsquedas en `setube_searches`. Lee el almacenamiento la primera vez que se pide la lista,
 * no al crearse, así que se puede crear en el servidor o sin `window` sin que lance.
 * Con suscriptores escucha el evento `storage` para seguir los cambios de otras pestañas; sin ellos vuelve a
 * leer cada vez que se pide o se cambia la lista.
 */
export function createRecentSearches(getStorage: () => StorageLike | null = browserStorage): RecentSearches {
  let items: readonly string[] = EMPTY;
  // último valor leído de `setube_searches`; undefined = sin leer todavía
  let raw: string | null | undefined;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  const readRaw = (): string | null => {
    try {
      return getStorage()?.getItem(SEARCHES_KEY) ?? null;
    } catch {
      return null;
    }
  };

  // Solo se cambia la lista si lo guardado cambió: si el almacenamiento falla o no existe, se conserva lo de
  // memoria. Con el mismo contenido se conserva la referencia.
  const reload = (): boolean => {
    const next = readRaw();
    if (next === raw) return false;
    raw = next;
    const list = parseRecentSearches(next);
    if (sameList(list, items)) return false;
    items = list.length === 0 ? EMPTY : list;
    return true;
  };

  const current = (): readonly string[] => {
    // sin suscriptores nadie escucha `storage`: se vuelve a leer por si otra pestaña lo cambió
    if (raw === undefined || listeners.size === 0) reload();
    return items;
  };

  const set = (next: readonly string[]) => {
    if (sameList(next, current())) return;
    items = next.length === 0 ? EMPTY : next;
    saveRecentSearches(getStorage(), items);
    // lo que quedó de verdad (igual al anterior si no se pudo escribir)
    raw = readRaw();
    notify();
  };

  const onStorage = (e: Event) => {
    const key = (e as StorageEvent).key;
    // key null: otra pestaña vació todo el almacenamiento
    if (key !== SEARCHES_KEY && key !== null) return;
    if (reload()) notify();
  };

  return {
    subscribe(fn) {
      const first = listeners.size === 0;
      listeners.add(fn);
      if (first) {
        if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
        // lo que cambió mientras nadie escuchaba
        if (raw !== undefined && reload()) notify();
      }
      return () => {
        if (!listeners.delete(fn) || listeners.size > 0) return;
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot: current,
    getServerSnapshot: () => EMPTY,
    add(q) {
      set(addRecentSearch(current(), q));
    },
    remove(q) {
      set(removeRecentSearch(current(), q));
    },
    clear() {
      set(EMPTY);
    },
    restore(list) {
      // add/remove suponen una lista ya limpia (normalizada, sin duplicados y con el máximo)
      set(parseRecentSearches(serializeRecentSearches(list)));
    },
  };
}

export function useRecentSearches(store: RecentSearches): readonly string[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
