'use client';

import { LoaderCircle, Pause, Play } from 'lucide-react';
import type { PlayerStatus } from '@/lib/player';

interface PlayButtonProps {
  title: string;
  status: PlayerStatus | null;
  onToggle: () => void;
}

/** Botón de escucha sobre la miniatura de una fila. */
export function PlayButton({ title, status, onToggle }: PlayButtonProps) {
  const active = status === 'playing' || status === 'loading' || status === 'buffering';
  const busy = status === 'loading' || status === 'buffering';
  const label = active ? 'Pausar' : `Escuchar ${title}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={active ? 'Pausar' : 'Escuchar'}
      className="absolute inset-0 m-auto inline-flex size-11 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" focusable="false" className="size-5 animate-spin motion-reduce:animate-none" />
      ) : active ? (
        <Pause aria-hidden="true" focusable="false" className="size-5" fill="currentColor" />
      ) : (
        <Play aria-hidden="true" focusable="false" className="size-5 translate-x-px" fill="currentColor" />
      )}
    </button>
  );
}
