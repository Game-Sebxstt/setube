'use client';

import { LoaderCircle, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { Num } from '@/components/ui/Num';
import { formatDuration } from '@/lib/format';
import { type MessageContext, messageFor } from '@/lib/messages';
import { type Player as PlayerEngine, type PlayerState, shouldHandleSpace, usePlayerState, usePlayerTime } from '@/lib/player';
import { bindMediaSession } from './media-session';

const SEEK_STEP = 5;
const SEEK_DEBOUNCE_MS = 250;

interface PlayerProps {
  player: PlayerEngine;
  messageCtx: MessageContext;
}

function statusText(s: PlayerState, ctx: MessageContext): string {
  if (!s.track) return '';
  switch (s.status) {
    case 'loading':
    case 'buffering':
      return 'Cargando audio…';
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

/** Reproductor global: un único <audio> y la mini barra fija abajo. */
export function Player({ player, messageCtx }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const s = usePlayerState(player);
  const track = s.track;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const detach = player.attach(a);
    const unbind = bindMediaSession(player, a);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
      const t = player.getState().track;
      if (!t || !shouldHandleSpace(e.target)) return;
      e.preventDefault();
      player.toggle(t);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [player]);

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

  return (
    <>
      <audio ref={audioRef} preload="none" hidden />
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
                  'Cargando…'
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

function SeekBar({ player }: { player: PlayerEngine }) {
  const time = usePlayerTime(player);
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const duration = time.duration;
  const value = drag ?? time.current;
  const pct = duration ? Math.min(100, (value / duration) * 100) : 0;
  const buf = duration ? Math.min(100, (time.buffered / duration) * 100) : 0;
  const durText = duration ? formatDuration(duration) : '–:–';
  const curText = formatDuration(value) || '0:00';

  const onChange = (v: number) => {
    setDrag(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      player.seek(v);
      setDrag(null);
    }, SEEK_DEBOUNCE_MS);
  };

  return (
    <div className="seek-wrap flex items-center gap-3 lg:min-w-0 lg:flex-1">
      <Num className="hidden w-14 shrink-0 text-right text-sm lg:inline">{curText}</Num>
      <input
        type="range"
        className="seek"
        min={0}
        max={duration ?? 0}
        step={SEEK_STEP}
        value={Math.min(value, duration ?? 0)}
        disabled={!duration}
        aria-label="Posición"
        aria-valuetext={`${curText} de ${durText}`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%`, '--buf': `${buf}%` } as CSSProperties}
      />
      <Num className="hidden w-14 shrink-0 text-sm lg:inline">{durText}</Num>
    </div>
  );
}

function VolumeControl({ player, volume, muted }: { player: PlayerEngine; volume: number; muted: boolean }) {
  const shown = muted ? 0 : volume;
  return (
    <div className="hidden shrink-0 items-center gap-1 lg:flex">
      <button
        type="button"
        onClick={() => player.toggleMute()}
        aria-label={muted || volume === 0 ? 'Activar sonido' : 'Silenciar'}
        title={muted || volume === 0 ? 'Activar sonido' : 'Silenciar'}
        className="inline-flex size-11 items-center justify-center rounded-control text-ink hover:bg-panel"
      >
        {muted || volume === 0 ? (
          <VolumeX aria-hidden="true" focusable="false" className="size-5" />
        ) : (
          <Volume2 aria-hidden="true" focusable="false" className="size-5" />
        )}
      </button>
      <input
        type="range"
        className="seek w-24"
        min={0}
        max={1}
        step={0.05}
        value={shown}
        aria-label="Volumen"
        aria-valuetext={`${Math.round(shown * 100)} %`}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        style={{ '--pct': `${shown * 100}%`, '--buf': '0%' } as CSSProperties}
      />
    </div>
  );
}
