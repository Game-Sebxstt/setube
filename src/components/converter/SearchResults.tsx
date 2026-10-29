'use client';

import { AlertCircle, Check, Plus, Radio, RotateCcw, X } from 'lucide-react';
import { memo, useId } from 'react';
import type { ErrorCode, SearchItem } from '@/lib/contract';
import { formatDuration, formatLimit, formatViews } from '@/lib/format';
import { messageFor } from '@/lib/messages';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; items: SearchItem[] }
  | { status: 'error'; query: string; code: ErrorCode };

interface SearchResultsProps {
  state: SearchState;
  /** videoIds que ya están en la cola. */
  queued: ReadonlySet<string>;
  /** Duración máxima para el tipo de salida elegido (audio o video). */
  maxDurationSec: number;
  onAdd: (item: SearchItem) => void;
  onRetry: () => void;
  onClose: () => void;
}

const SKELETONS = 8;

export function SearchResults({ state, queued, maxDurationSec, onAdd, onRetry, onClose }: SearchResultsProps) {
  const headingId = useId();
  if (state.status === 'idle') return null;
  const loading = state.status === 'loading';
  const count = state.status === 'ready' ? state.items.length : 0;
  // los directos no se pueden convertir: van al final
  const items = state.status === 'ready' ? [...state.items.filter((i) => !i.live), ...state.items.filter((i) => i.live)] : [];

  return (
    <section aria-labelledby={headingId} aria-busy={loading || undefined} className="search">
      <div className="flex items-center gap-3">
        <h2 id={headingId} className="min-w-0 flex-1 truncate font-medium">
          {loading ? 'Buscando' : 'Resultados para'} <q className="search-q">{state.query}</q>
        </h2>
        {state.status === 'ready' && count > 0 ? (
          <p className="shrink-0 text-sm text-ink-muted max-sm:hidden">
            {count} {count === 1 ? 'video' : 'videos'}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar resultados"
          title="Cerrar resultados"
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-panel"
        >
          <X aria-hidden="true" focusable="false" className="size-5" />
        </button>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {loading ? 'Buscando videos' : state.status === 'ready' ? `${count} ${count === 1 ? 'resultado' : 'resultados'}` : ''}
      </p>

      {state.status === 'error' ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="inline-flex items-start gap-1.5 text-red-ink">
            <AlertCircle aria-hidden="true" focusable="false" className="mt-0.5 size-4 shrink-0" />
            <span>{messageFor(state.code)}</span>
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-edge px-4 text-sm font-medium hover:bg-panel"
          >
            <RotateCcw aria-hidden="true" focusable="false" className="size-4" />
            Buscar de nuevo
          </button>
        </div>
      ) : state.status === 'ready' && count === 0 ? (
        <p className="mt-2 text-ink-muted">No hay videos para esta búsqueda. Prueba con otras palabras o pega el link del video.</p>
      ) : (
        <ul className="search-grid">
          {loading
            ? Array.from({ length: SKELETONS }, (_, i) => <SkeletonCard key={i} />)
            : items.map((it) => (
                <ResultCard key={it.videoId} item={it} inQueue={queued.has(it.videoId)} maxDurationSec={maxDurationSec} onAdd={onAdd} />
              ))}
        </ul>
      )}
    </section>
  );
}

function SkeletonCard() {
  return (
    <li aria-hidden="true" className="search-card">
      <span className="skel search-thumb block" />
      <span className="flex min-w-0 flex-col gap-1.5 pt-1">
        <span className="skel block h-4 w-11/12" />
        <span className="skel block h-4 w-3/5" />
        <span className="skel block h-3 w-2/5" />
      </span>
    </li>
  );
}

interface ResultCardProps {
  item: SearchItem;
  inQueue: boolean;
  maxDurationSec: number;
  onAdd: (item: SearchItem) => void;
}

const ResultCard = memo(function ResultCard({ item, inQueue, maxDurationSec, onAdd }: ResultCardProps) {
  const title = item.title ?? 'Video de YouTube';
  const duration = formatDuration(item.duration);
  const views = formatViews(item.views);
  const disabled = item.live || inQueue;
  const tooLong = !item.live && item.duration !== null && item.duration > maxDurationSec;
  const limitText = `Supera el máximo de ${formatLimit(maxDurationSec)}`;
  const state = item.live
    ? 'En vivo, no se puede convertir'
    : inQueue
      ? 'Ya está en la cola'
      : `${tooLong ? `${limitText}. ` : ''}Agregar a la cola`;

  return (
    <li>
      <button
        type="button"
        onClick={() => onAdd(item)}
        disabled={disabled}
        aria-label={`${title}${item.author ? `, de ${item.author}` : ''}${duration ? `, ${duration}` : ''}. ${state}`}
        data-state={item.live ? 'live' : inQueue ? 'queued' : 'idle'}
        className="search-card search-btn"
      >
        <span className="search-thumb relative block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnail} alt="" width={320} height={180} loading="lazy" decoding="async" className="size-full object-cover" />
          {item.live ? (
            <span className="search-badge search-badge-live">
              <Radio aria-hidden="true" focusable="false" className="size-3" />
              En vivo
            </span>
          ) : duration ? (
            <span className="search-badge num">{duration}</span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="line-clamp-2 font-medium leading-snug" title={title}>
            {title}
          </span>
          {item.author ? <span className="mt-0.5 truncate text-sm text-ink-muted">{item.author}</span> : null}
          {views ? <span className="text-sm text-ink-muted">{views} vistas</span> : null}
          {tooLong ? <span className="text-sm text-red-ink">{limitText}</span> : null}
        </span>
        <span aria-hidden="true" className="search-action">
          {item.live ? null : inQueue ? (
            <>
              <Check className="size-4" />
              <span className="max-sm:hidden">En la cola</span>
            </>
          ) : (
            <>
              <Plus className="size-4" />
              <span className="max-sm:hidden">Agregar</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
});
