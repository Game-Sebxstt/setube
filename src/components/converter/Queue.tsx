'use client';

import type { MessageContext } from '@/lib/messages';
import { type Options, type State, isBusy } from '@/lib/queue';
import { EmptyState } from './EmptyState';
import { PlaylistCard } from './PlaylistCard';
import { QueueRow } from './QueueRow';

interface QueueProps {
  state: State;
  messageCtx: MessageContext;
  maxPlaylistItems: number;
  canZip: boolean;
  onZip: () => void;
  onClear: () => void;
  onDownload: (key: string) => void;
  onRemove: (key: string) => void;
  onAddPlaylist: (listId: string) => void;
  onExample: () => void;
  options: Options;
}

export function Queue({ state, messageCtx, maxPlaylistItems, canZip, onZip, onClear, onDownload, onRemove, onAddPlaylist, onExample, options }: QueueProps) {
  const count = state.items.length;
  const empty = count === 0 && state.playlists.length === 0;
  return (
    <section aria-labelledby="queue-title">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
        <h2 id="queue-title" className="font-display text-lg">
          Cola <span className="num text-base font-normal text-ink-muted">({count})</span>
        </h2>
        <div className="flex items-center gap-1">
          {canZip ? (
            <button
              type="button"
              onClick={onZip}
              className="min-h-11 rounded-control px-3 text-sm font-medium text-ink hover:bg-panel lg:hidden"
            >
              Descargar todo (ZIP)
            </button>
          ) : null}
          {!empty ? (
            <button type="button" onClick={onClear} className="min-h-11 rounded-control px-3 text-sm font-medium text-ink hover:bg-panel">
              Vaciar
            </button>
          ) : null}
        </div>
      </div>
      {empty ? (
        <EmptyState onExample={onExample} />
      ) : (
        <ul className="divide-y divide-line">
          {state.playlists.map((p) => (
            <PlaylistCard key={p.key} card={p} maxPlaylistItems={maxPlaylistItems} onRemove={onRemove} />
          ))}
          {state.items.map((i) => (
            <QueueRow
              key={i.key}
              item={i}
              options={options}
              busy={isBusy(state, i.key)}
              messageCtx={messageCtx}
              onDownload={onDownload}
              onRemove={onRemove}
              onAddPlaylist={onAddPlaylist}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
