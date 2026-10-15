'use client';

import { ListVideo, X } from 'lucide-react';
import type { PlaylistCard as Card } from '@/lib/queue';
import { messageFor } from '@/lib/messages';

interface PlaylistCardProps {
  card: Card;
  maxPlaylistItems: number;
  onRemove: (key: string) => void;
}

export function PlaylistCard({ card, maxPlaylistItems, onRemove }: PlaylistCardProps) {
  const title = card.title ?? 'Playlist de YouTube';
  let detail: string;
  if (card.status === 'loading') detail = 'Cargando playlist…';
  else if (card.status === 'error') detail = messageFor(card.error ?? 'PLAYLIST_UNAVAILABLE');
  else detail = card.count === 1 ? '1 video' : `${card.count ?? 0} videos`;

  return (
    <li className="grid animate-row-in grid-cols-[96px_minmax(0,1fr)] gap-3 py-3 lg:grid-cols-[128px_minmax(0,1fr)] lg:gap-4">
      {card.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.thumbnail}
          alt=""
          width={128}
          height={72}
          loading="lazy"
          className="aspect-video w-24 rounded-control bg-line object-cover lg:w-32"
        />
      ) : (
        <div className="flex aspect-video w-24 items-center justify-center rounded-control bg-line lg:w-32">
          <ListVideo aria-hidden="true" focusable="false" className="size-6 text-ink-muted" />
        </div>
      )}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 font-medium" title={title}>
            {title}
          </p>
          <p className={`text-sm ${card.status === 'error' ? 'text-red-ink' : 'text-ink-muted'}`}>
            <span className={card.status === 'ready' ? 'num' : undefined}>{detail}</span>
          </p>
          {card.status === 'ready' && card.truncated ? (
            <p className="text-sm text-ink-muted">Se agregaron los primeros {maxPlaylistItems} videos.</p>
          ) : null}
          {card.status === 'ready' && card.skipped > 0 ? (
            <p className="text-sm text-ink-muted">
              {card.skipped === 1 ? '1 video privado o borrado se omitió.' : `${card.skipped} videos privados o borrados se omitieron.`}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Quitar playlist"
          title="Quitar playlist"
          onClick={() => onRemove(card.key)}
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-panel"
        >
          <X aria-hidden="true" focusable="false" className="size-5" />
        </button>
      </div>
    </li>
  );
}
