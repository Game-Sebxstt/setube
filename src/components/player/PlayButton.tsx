'use client';

import { LoaderCircle, Pause, Play } from 'lucide-react';
import type { PlayerMode, PlayerStatus } from '@/lib/player';

interface PlayButtonProps {
  title: string;
  status: PlayerStatus | null;
  /** Modo en el que reproduce el botón: en video la etiqueta dice «Reproducir» y no «Escuchar». */
  mode?: PlayerMode;
  onToggle: () => void;
  /** Intención de reproducir en video (ratón encima o foco): se puede adelantar la carga de hls.js. */
  onIntent?: () => void;
}

/** Botón de escucha (o de video, según el modo preferido) sobre la miniatura de una fila. */
export function PlayButton({ title, status, mode = 'audio', onToggle, onIntent }: PlayButtonProps) {
  const active = status === 'playing' || status === 'loading' || status === 'buffering';
  const busy = status === 'loading' || status === 'buffering';
  const verb = mode === 'video' ? 'Reproducir' : 'Escuchar';
  const label = active ? 'Pausar' : `${verb} ${title}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-label={label}
      title={active ? 'Pausar' : verb}
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
