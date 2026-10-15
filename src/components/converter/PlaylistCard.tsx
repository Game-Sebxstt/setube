'use client';

import { AlertCircle, ListVideo, LoaderCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Num } from '@/components/ui/Num';
import type { PlaylistCard as Card } from '@/lib/queue';
import { messageFor } from '@/lib/messages';

interface PlaylistCardProps {
  card: Card;
  maxPlaylistItems: number;
  onRemove: (key: string) => void;
}

export function PlaylistCard({ card, maxPlaylistItems, onRemove }: PlaylistCardProps) {
  const loading = card.status === 'loading';
  const title = card.title ?? 'Playlist de YouTube';
  let detail: ReactNode;
  if (loading)
    detail = (
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle aria-hidden="true" focusable="false" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <span>Leyendo playlist…</span>
        {card.count != null ? (
          <span>
            <Num>{card.count}</Num> {card.count === 1 ? 'video' : 'videos'}
          </span>
        ) : null}
      </span>
    );
  else if (card.status === 'error')
    detail = (
      <span className="inline-flex items-start gap-1.5">
        <AlertCircle aria-hidden="true" focusable="false" className="mt-0.5 size-4 shrink-0" />
        <span>{messageFor(card.error ?? 'PLAYLIST_UNAVAILABLE')}</span>
      </span>
    );
  else
    detail = (
      <>
        <Num>{card.count ?? 0}</Num> {card.count === 1 ? 'video' : 'videos'}
      </>
    );

  return (
    <li
      aria-busy={loading || undefined}
      className="grid animate-row-in grid-cols-[96px_minmax(0,1fr)] gap-3 py-2.5 md:py-3 lg:grid-cols-[128px_minmax(0,1fr)] lg:gap-4"
    >
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
      ) : loading ? (
        <div aria-hidden="true" className="skel aspect-video w-24 rounded-control lg:w-32" />
      ) : (
        <div className="flex aspect-video w-24 items-center justify-center rounded-control bg-line lg:w-32">
          <ListVideo aria-hidden="true" focusable="false" className="size-6 text-ink-muted" />
        </div>
      )}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          {loading && !card.title ? (
            <>
              <span aria-hidden="true" className="skel mt-1 mb-1.5 block h-4 w-3/5" />
              <span className="visually-hidden">{title}</span>
            </>
          ) : (
            <p className="line-clamp-1 font-medium" title={title}>
              {title}
            </p>
          )}
          <p className={`text-sm ${card.status === 'error' ? 'text-red-ink' : 'text-ink-muted'}`}>{detail}</p>
          {card.status === 'ready' && card.truncated ? (
            <p className="text-sm text-ink-muted">
              Se agregaron los primeros <Num>{maxPlaylistItems}</Num> videos.
            </p>
          ) : null}
          {card.status === 'ready' && card.skipped > 0 ? (
            <p className="hidden text-sm text-ink-muted md:block">
              <Num>{card.skipped}</Num>{' '}
              {card.skipped === 1 ? 'video privado o borrado se omitió.' : 'videos privados o borrados se omitieron.'}
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
