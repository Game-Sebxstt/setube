'use client';

import { Check, CornerDownLeft, ListVideo, Search, X } from 'lucide-react';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Num } from '@/components/ui/Num';
import { searchQuery } from '@/lib/search';
import { parseYouTubeUrl } from '@/lib/youtube-url';
import { RecentSearches } from './RecentSearches';

export interface AddResult {
  invalid: string[];
  videos: number;
  playlists: number;
  duplicates: number;
  overLimit: number;
}

interface CommandBarProps {
  onSubmit: (lines: string[]) => AddResult;
  /** Si está, el texto que no es un link se busca en YouTube. */
  onSearch?: (query: string) => void;
  /** Se vació el campo con Esc: cierra los resultados. */
  onClear?: () => void;
  error: string | null;
  /** Contenido pegado bajo el campo, dentro del mismo recuadro. */
  footer?: ReactNode;
  /** Búsquedas recientes, de la más reciente a la más antigua. Solo se usan si hay `onSearch`. */
  recent?: readonly string[];
  /** Si se pueden mostrar las recientes (por ejemplo, con los resultados cerrados). */
  showRecent?: boolean;
  onRemoveRecent?: (query: string) => void;
  onClearRecent?: () => void;
}

const NO_RECENT: readonly string[] = [];

type LineKind = 'video' | 'playlist' | 'invalid' | 'empty';

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function classify(line: string): LineKind {
  const l = line.trim();
  if (!l) return 'empty';
  const p = parseYouTubeUrl(l);
  if (!p) return 'invalid';
  return p.kind;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(r: AddResult): string {
  const parts: string[] = [];
  if (r.videos) parts.push(plural(r.videos, 'video', 'videos'));
  if (r.playlists) parts.push(plural(r.playlists, 'playlist', 'playlists'));
  if (parts.length === 0) return '';
  return `Agregado a la cola: ${parts.join(' y ')}.`;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export function CommandBar({
  onSubmit,
  onSearch,
  onClear,
  error,
  footer,
  recent = NO_RECENT,
  showRecent = false,
  onRemoveRecent,
  onClearRecent,
}: CommandBarProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<(lines: string[], keep?: string[]) => void>(() => undefined);
  const searchRef = useRef<CommandBarProps['onSearch']>(onSearch);

  const rawLines = value.split(/\r?\n/);
  const kinds = useMemo(() => value.split(/\r?\n/).map(classify), [value]);
  const counts = useMemo(() => {
    const c = { video: 0, playlist: 0, invalid: 0 };
    for (const k of kinds) if (k !== 'empty') c[k]++;
    return c;
  }, [kinds]);
  const rows = Math.min(8, Math.max(3, rawLines.length));
  const query = onSearch ? searchQuery(value) : null;

  const process = (lines: string[], keep: string[] = []) => {
    if (lines.length === 0) {
      setValue(keep.join('\n'));
      return;
    }
    const r = onSubmit(lines);
    setValue([...keep, ...r.invalid].join('\n'));
    setNotice(describe(r));
  };
  const submit = () => {
    if (query && onSearch) {
      setNotice('');
      onSearch(query);
      return;
    }
    process(splitLines(value));
  };
  useEffect(() => {
    submitRef.current = process;
    searchRef.current = onSearch;
  });

  // Atajos globales: Ctrl/Cmd+V fuera de un campo, «/» o Ctrl/Cmd+K para enfocar.
  useEffect(() => {
    const onPaste = (e: globalThis.ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      const lines = splitLines(text);
      if (lines.length === 0) return;
      e.preventDefault();
      ref.current?.focus();
      const q = searchRef.current ? searchQuery(text) : null;
      if (q && searchRef.current) {
        // texto suelto pegado fuera del campo: se escribe en la barra y se busca
        setValue(q);
        searchRef.current(q);
        return;
      }
      submitRef.current(lines, splitLines(ref.current?.value ?? ''));
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    const lines = splitLines(text);
    if (lines.length === 0) return;
    // texto suelto: se pega tal cual para seguir escribiendo la búsqueda
    if (onSearch && searchQuery(text)) return;
    e.preventDefault();
    // lo pegado se procesa; lo que ya había en el campo se conserva
    process(lines, splitLines(value));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && value) {
      e.preventDefault();
      setValue('');
      onClear?.();
    }
  };

  // Recientes: solo con el campo vacío, sin resultados abiertos y con algo guardado.
  const recentVisible = Boolean(onSearch) && showRecent && !value.trim() && recent.length > 0;
  const pickRecent = (q: string) => {
    ref.current?.focus();
    setNotice('');
    const query = searchQuery(q);
    setValue(query ?? q);
    // lo guardado siempre es una consulta, salvo que alguien haya editado el almacenamiento a mano
    if (query && onSearch) onSearch(query);
  };
  const removeRecent = (q: string) => {
    onRemoveRecent?.(q);
    // era la última: el foco vuelve al campo
    if (recent.length <= 1) ref.current?.focus();
  };
  const clearRecent = () => {
    onClearRecent?.();
    ref.current?.focus();
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => setScrollTop(e.currentTarget.scrollTop);
  // la línea de búsqueda no cuenta como no válida
  const invalid = query ? 0 : counts.invalid;
  const typed = counts.video + counts.playlist + invalid;

  return (
    <div className="cmd">
      <label htmlFor={id} className="visually-hidden">
        {onSearch ? 'Busca en YouTube o pega uno o varios links' : 'Pega uno o varios links'}
      </label>
      <div className="cmd-box">
        <div className="cmd-field">
          <div className="cmd-gutter" aria-hidden="true">
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {rawLines.map((_, i) => {
                const k = query ? (i === 0 ? 'search' : 'empty') : (kinds[i] ?? 'empty');
                return (
                  <span key={i} className="cmd-mark" data-kind={k}>
                    {k === 'search' ? <Search className="size-3.5" /> : null}
                    {k === 'video' ? <Check className="size-3.5" /> : null}
                    {k === 'playlist' ? <ListVideo className="size-3.5" /> : null}
                    {k === 'invalid' ? <X className="size-3.5" /> : null}
                    {k === 'empty' ? (i === 0 ? <span className="cmd-caret">$</span> : null) : null}
                  </span>
                );
              })}
            </div>
          </div>
          <textarea
            ref={ref}
            id={id}
            name="links"
            rows={rows}
            wrap="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onScroll={onScroll}
            placeholder={onSearch ? 'Busca un video o pega links de YouTube' : 'Pega aquí links de videos o playlists de YouTube'}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
            className="cmd-input"
          />
          <button
            type="button"
            onClick={submit}
            disabled={typed === 0 && !query}
            className="cmd-submit"
          >
            {query ? (
              <>
                <Search aria-hidden="true" focusable="false" className="size-4" />
                Buscar
              </>
            ) : (
              <>
                <CornerDownLeft aria-hidden="true" focusable="false" className="size-4" />
                Agregar
              </>
            )}
          </button>
        </div>
        {footer}
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-sm md:mt-3">
        <p id={hintId} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted max-md:hidden">
          <span>
            <kbd>Ctrl</kbd> <kbd>V</kbd> pega desde cualquier parte
          </span>
          <span className="hidden sm:inline">
            <kbd>Enter</kbd> {query ? 'busca' : 'agrega'}
          </span>
          <span className="hidden sm:inline">
            <kbd>Shift</kbd> <kbd>Enter</kbd> otra línea
          </span>
          <span className="hidden md:inline">
            <kbd>Ctrl</kbd> <kbd>Enter</kbd> convierte
          </span>
        </p>
        {typed > 0 && !query ? (
          <p className="flex flex-wrap gap-x-3 text-ink-muted" aria-hidden="true">
            {counts.video ? (
              <span>
                <Num>{counts.video}</Num> {counts.video === 1 ? 'video' : 'videos'}
              </span>
            ) : null}
            {counts.playlist ? (
              <span>
                <Num>{counts.playlist}</Num> {counts.playlist === 1 ? 'playlist' : 'playlists'}
              </span>
            ) : null}
            {invalid ? <span className="text-red-ink">{plural(invalid, 'línea no válida', 'líneas no válidas')}</span> : null}
          </p>
        ) : null}
      </div>
      <div aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <p id={errorId} className="text-red-ink">
            {error}
          </p>
        ) : notice ? (
          <p className="text-ink-muted">{notice}</p>
        ) : null}
      </div>
      {onSearch && onRemoveRecent && onClearRecent ? (
        <RecentSearches
          items={recentVisible ? recent : NO_RECENT}
          onPick={pickRecent}
          onRemove={removeRecent}
          onClear={clearRecent}
        />
      ) : null}
    </div>
  );
}
