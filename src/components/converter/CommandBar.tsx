'use client';

import { Check, CornerDownLeft, ListVideo, X } from 'lucide-react';
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
import { parseYouTubeUrl } from '@/lib/youtube-url';

export interface AddResult {
  invalid: string[];
  videos: number;
  playlists: number;
  duplicates: number;
  overLimit: number;
}

interface CommandBarProps {
  onSubmit: (lines: string[]) => AddResult;
  error: string | null;
  /** Contenido pegado bajo el campo, dentro del mismo recuadro. */
  footer?: ReactNode;
}

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

export function CommandBar({ onSubmit, error, footer }: CommandBarProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<(lines: string[], keep?: string[]) => void>(() => undefined);

  const rawLines = value.split(/\r?\n/);
  const kinds = useMemo(() => value.split(/\r?\n/).map(classify), [value]);
  const counts = useMemo(() => {
    const c = { video: 0, playlist: 0, invalid: 0 };
    for (const k of kinds) if (k !== 'empty') c[k]++;
    return c;
  }, [kinds]);
  const rows = Math.min(8, Math.max(3, rawLines.length));

  const process = (lines: string[], keep: string[] = []) => {
    if (lines.length === 0) {
      setValue(keep.join('\n'));
      return;
    }
    const r = onSubmit(lines);
    setValue([...keep, ...r.invalid].join('\n'));
    setNotice(describe(r));
  };
  useEffect(() => {
    submitRef.current = process;
  });

  // Atajos globales: Ctrl/Cmd+V fuera de un campo, «/» o Ctrl/Cmd+K para enfocar.
  useEffect(() => {
    const onPaste = (e: globalThis.ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const lines = splitLines(e.clipboardData?.getData('text') ?? '');
      if (lines.length === 0) return;
      e.preventDefault();
      ref.current?.focus();
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
    const lines = splitLines(e.clipboardData.getData('text'));
    if (lines.length === 0) return;
    e.preventDefault();
    // lo pegado se procesa; lo que ya había en el campo se conserva
    process(lines, splitLines(value));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      process(splitLines(value));
    } else if (e.key === 'Escape' && value) {
      e.preventDefault();
      setValue('');
    }
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => setScrollTop(e.currentTarget.scrollTop);
  const typed = counts.video + counts.playlist + counts.invalid;

  return (
    <div className="cmd">
      <label htmlFor={id} className="visually-hidden">
        Pega uno o varios links
      </label>
      <div className="cmd-box">
        <div className="cmd-field">
          <div className="cmd-gutter" aria-hidden="true">
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {rawLines.map((_, i) => {
                const k = kinds[i] ?? 'empty';
                return (
                  <span key={i} className="cmd-mark" data-kind={k}>
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
            placeholder="Pega aquí links de videos o playlists de YouTube"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
            className="cmd-input"
          />
          <button
            type="button"
            onClick={() => process(splitLines(value))}
            disabled={typed === 0}
            className="cmd-submit"
          >
            <CornerDownLeft aria-hidden="true" focusable="false" className="size-4" />
            Agregar
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
            <kbd>Enter</kbd> agrega
          </span>
          <span className="hidden sm:inline">
            <kbd>Shift</kbd> <kbd>Enter</kbd> otra línea
          </span>
          <span className="hidden md:inline">
            <kbd>Ctrl</kbd> <kbd>Enter</kbd> convierte
          </span>
        </p>
        {typed > 0 ? (
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
            {counts.invalid ? <span className="text-red-ink">{plural(counts.invalid, 'línea no válida', 'líneas no válidas')}</span> : null}
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
    </div>
  );
}
