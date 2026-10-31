'use client';

import { LoaderCircle, MonitorPlay, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef } from 'react';
import { type MessageContext, messageFor } from '@/lib/messages';
import { type Player as PlayerEngine, type PlayerState, shouldHandleSpace, usePlayerState } from '@/lib/player';
import { SEEK_STEP, SeekBar, VolumeControl } from './controls';
import { toggleFullscreen } from './fullscreen';
import { bindMediaSession } from './media-session';
import { VideoPanel } from './VideoPanel';

interface PlayerProps {
  player: PlayerEngine;
  messageCtx: MessageContext;
}

function statusText(s: PlayerState, ctx: MessageContext): string {
  if (!s.track) return '';
  switch (s.status) {
    case 'loading':
    case 'buffering':
      return s.mode === 'video' ? 'Cargando video…' : 'Cargando audio…';
    case 'playing':
      return `Reproduciendo ${s.track.title}`;
    case 'paused':
      return 'En pausa';
    case 'ended':
      return 'Terminó la reproducción';
    case 'error':
      return s.error ? messageFor(s.error, ctx) : messageFor('PLAYER_ERROR');
    default:
      return '';
  }
}

// Campos de texto: la barra de posición y el volumen (type=range) o un checkbox no cuentan
const TYPING =
  'input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

/** La tecla «f» no cuenta si el foco está en un campo donde se escribe. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING) !== null;
}

/** Reproductor global: un único <audio>, un único <video> (panel) y la mini barra fija abajo. */
export function Player({ player, messageCtx }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const s = usePlayerState(player);
  const track = s.track;

  useEffect(() => {
    const a = audioRef.current;
    const v = videoRef.current;
    if (!a) return;
    const detach = player.attach(a, v);
    const unbind = bindMediaSession(player, v ? [a, v] : [a]);
    return () => {
      unbind();
      detach();
    };
  }, [player]);

  // altura de la barra para que el contenido y los avisos no queden debajo
  const hasTrack = track !== null;
  useEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!hasTrack || !el) {
      root.style.setProperty('--player-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--player-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--player-h', '0px');
    };
  }, [hasTrack]);

  const fullscreen = useCallback(() => {
    toggleFullscreen(frameRef.current, videoRef.current);
    // el foco pasa al panel: espacio y flechas siguen funcionando sin pulsar el botón enfocado
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const st = player.getState();
      const t = st.track;
      if (!t) return;
      if (e.key === ' ' && !e.shiftKey) {
        if (!shouldHandleSpace(e.target)) return;
        e.preventDefault();
        player.toggle(t);
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && st.mode === 'video' && !isTyping(e.target)) {
        e.preventDefault();
        fullscreen();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [player, fullscreen]);

  const onBarKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'range') return;
    e.preventDefault();
    player.seekBy(e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
  };

  const busy = s.status === 'loading' || s.status === 'buffering';
  const active = busy || s.status === 'playing';
  const failed = s.status === 'error';
  const live = statusText(s, messageCtx);
  const watching = s.mode === 'video';

  return (
    <>
      <audio ref={audioRef} preload="none" hidden />
      <VideoPanel player={player} videoRef={videoRef} frameRef={frameRef} onFullscreen={fullscreen} />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {live}
      </p>
      {track ? (
        <section
          ref={barRef}
          aria-label="Reproductor"
          onKeyDown={onBarKey}
          className="player-bar fixed inset-x-0 z-40 border-t border-line bg-bg animate-row-in"
        >
          <div className="relative mx-auto flex h-14 max-w-7xl items-center gap-3 pr-1 pl-4 sm:px-6 lg:h-16 lg:gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={track.thumbnail}
              alt=""
              width={64}
              height={36}
              decoding="async"
              className="aspect-video h-10 w-auto shrink-0 rounded-seg bg-line object-cover lg:h-9"
            />
            <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
              <p className="truncate text-sm font-medium" title={track.title}>
                {track.title}
              </p>
              <p className="truncate text-sm text-ink-muted">
                {failed ? (
                  <span className="text-red-ink">{live}</span>
                ) : busy ? (
                  watching ? (
                    'Cargando video…'
                  ) : (
                    'Cargando…'
                  )
                ) : (
                  (track.author ?? 'YouTube')
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => player.step(-1)}
                disabled={!s.nav.prev}
                aria-label="Anterior"
                title="Anterior"
                className="hidden size-11 items-center justify-center rounded-control text-ink hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent lg:inline-flex"
              >
                <SkipBack aria-hidden="true" focusable="false" className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => player.toggle(track)}
                data-focus-return="play"
                aria-label={failed ? 'Reintentar' : active ? 'Pausar' : 'Reproducir'}
                title={failed ? 'Reintentar' : active ? 'Pausar' : 'Reproducir'}
                className="inline-flex size-11 items-center justify-center rounded-full bg-red text-white hover:brightness-110"
              >
                {failed ? (
                  <RotateCcw aria-hidden="true" focusable="false" className="size-5" />
                ) : busy ? (
                  <LoaderCircle aria-hidden="true" focusable="false" className="size-5 animate-spin motion-reduce:animate-none" />
                ) : active ? (
                  <Pause aria-hidden="true" focusable="false" className="size-5" fill="currentColor" />
                ) : (
                  <Play aria-hidden="true" focusable="false" className="size-5 translate-x-px" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                onClick={() => player.step(1)}
                disabled={!s.nav.next}
                aria-label="Siguiente"
                title="Siguiente"
                className="hidden size-11 items-center justify-center rounded-control text-ink hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent lg:inline-flex"
              >
                <SkipForward aria-hidden="true" focusable="false" className="size-5" />
              </button>
            </div>

            <SeekBar key={track.key} player={player} />

            {s.volumeControl ? <VolumeControl player={player} volume={s.volume} muted={s.muted} /> : null}

            {track.video ? (
              <button
                type="button"
                onClick={() => player.setMode(watching ? 'audio' : 'video')}
                onPointerEnter={() => player.warmVideo()}
                onFocus={() => player.warmVideo()}
                data-focus-return="video"
                aria-pressed={watching}
                aria-label="Ver video"
                title={watching ? 'Solo audio' : 'Ver video'}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-panel aria-pressed:text-red-ink"
              >
                <MonitorPlay aria-hidden="true" focusable="false" className="size-5" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => player.close()}
              aria-label="Cerrar reproductor"
              title="Cerrar"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-panel hover:text-ink"
            >
              <X aria-hidden="true" focusable="false" className="size-5" />
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
