'use client';

import { Headphones, LoaderCircle, Maximize, Minimize, Pause, PictureInPicture2, Play } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type Player as PlayerEngine, usePlayerState } from '@/lib/player';
import { SEEK_STEP, SeekBar, VolumeControl } from './controls';
import {
  exitFullscreenIfInside,
  exitPictureInPicture,
  fullscreenElement,
  togglePictureInPicture,
} from './fullscreen';

const CLICK_DELAY_MS = 250;
const IDLE_MS = 2500;
/** Marca del contenedor del video, para saber si es él quien está en pantalla completa. */
const FRAME_ATTR = 'data-video-frame';

const noopSubscribe = () => () => undefined;

function subscribeFullscreen(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
    document.removeEventListener('webkitfullscreenchange', fn);
  };
}
const isFrameFullscreen = () => fullscreenElement()?.hasAttribute(FRAME_ATTR) === true;

function subscribePip(fn: () => void): () => void {
  // los dos eventos burbujean desde el <video>
  document.addEventListener('enterpictureinpicture', fn, true);
  document.addEventListener('leavepictureinpicture', fn, true);
  return () => {
    document.removeEventListener('enterpictureinpicture', fn, true);
    document.removeEventListener('leavepictureinpicture', fn, true);
  };
}
const isPip = () => typeof document !== 'undefined' && Boolean(document.pictureInPictureElement);

/** Pantalla completa del contenedor, o la del sistema en iPhone (solo el <video>). */
function fullscreenSupported(): boolean {
  const d = document as Document & { webkitFullscreenEnabled?: boolean };
  if (d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true) return true;
  return typeof HTMLVideoElement !== 'undefined' && 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
}
const pipSupported = () => document.pictureInPictureEnabled === true;

interface VideoPanelProps {
  player: PlayerEngine;
  /** El <video> único de la página; el motor lo recibe en `attach`. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Contenedor que va a pantalla completa (video, spinner y controles). */
  frameRef: RefObject<HTMLDivElement | null>;
  onFullscreen: () => void;
}

const toolClass =
  'inline-flex size-11 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85';

/**
 * Panel del video: flotante a la derecha en escritorio y a todo el ancho sobre la barra en móvil.
 * El <video> está siempre montado (oculto con `visibility`, así tiene tamaño al elegir la calidad de arranque).
 */
export function VideoPanel({ player, videoRef, frameRef, onFullscreen }: VideoPanelProps) {
  const s = usePlayerState(player);
  const track = s.track;
  const open = track !== null && s.mode === 'video';
  const busy = open && (s.status === 'loading' || s.status === 'buffering');
  const stopped = open && (s.status === 'paused' || s.status === 'ended');

  const fs = useSyncExternalStore(subscribeFullscreen, isFrameFullscreen, () => false);
  const pip = useSyncExternalStore(subscribePip, isPip, () => false);
  const canFs = useSyncExternalStore(noopSubscribe, fullscreenSupported, () => false);
  const canPip = useSyncExternalStore(noopSubscribe, pipSupported, () => false);

  const panelRef = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [idle, setIdle] = useState(false);

  // alto del panel para que en móvil el contenido y los avisos no queden debajo
  useEffect(() => {
    const root = document.documentElement;
    const el = panelRef.current;
    if (!open || !el) {
      root.style.setProperty('--video-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--video-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--video-h', '0px');
    };
  }, [open]);

  // al volver a solo audio (o cerrar) se sale de pantalla completa y de PiP
  useEffect(() => {
    if (open) return;
    exitFullscreenIfInside(frameRef.current);
    exitPictureInPicture(videoRef.current);
  }, [open, frameRef, videoRef]);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  // en pantalla completa los controles se ocultan tras 2,5 s sin mover el ratón
  const wake = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setIdle(false);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      setIdle(true);
    }, IDLE_MS);
  };

  const onVideoClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    // el doble clic (pantalla completa) cancela la pausa del primer clic
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      const t = player.getState().track;
      if (t) player.toggle(t);
    }, CLICK_DELAY_MS);
  };
  const onVideoDoubleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    if (canFs) onFullscreen();
  };

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    wake();
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
    e.preventDefault();
    player.seekBy(e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
  };

  const running = s.status === 'playing' || busy;
  const title = track?.title ?? '';

  return (
    <div
      ref={panelRef}
      className="video-panel"
      data-open={open}
      inert={!open}
      role="region"
      aria-label="Video"
      aria-hidden={open ? undefined : true}
    >
      <div
        ref={frameRef}
        data-video-frame=""
        data-theme="dark"
        data-fs={fs}
        data-idle={fs && idle && running}
        tabIndex={-1}
        className="video-frame"
        onKeyDown={onKey}
        onPointerMove={fs ? wake : undefined}
      >
        <video
          ref={videoRef}
          playsInline
          preload="none"
          poster={track?.thumbnail}
          onClick={onVideoClick}
          onDoubleClick={onVideoDoubleClick}
          className="size-full object-contain"
        />
        {busy ? (
          <span aria-hidden="true" className="video-center">
            <LoaderCircle focusable="false" className="size-6 animate-spin motion-reduce:animate-none" />
          </span>
        ) : stopped && !pip ? (
          <span aria-hidden="true" className="video-center">
            <Play focusable="false" className="size-6 translate-x-px" fill="currentColor" />
          </span>
        ) : null}

        <div className="video-tools">
          {canPip ? (
            <button
              type="button"
              onClick={() => togglePictureInPicture(videoRef.current)}
              aria-pressed={pip}
              aria-label="Imagen en imagen"
              title="Imagen en imagen"
              className={toolClass}
            >
              <PictureInPicture2 aria-hidden="true" focusable="false" className="size-5" />
            </button>
          ) : null}
          {canFs ? (
            <button
              type="button"
              onClick={onFullscreen}
              aria-label={fs ? 'Salir de pantalla completa' : 'Pantalla completa'}
              title={fs ? 'Salir de pantalla completa (f)' : 'Pantalla completa (f)'}
              className={toolClass}
            >
              {fs ? (
                <Minimize aria-hidden="true" focusable="false" className="size-5" />
              ) : (
                <Maximize aria-hidden="true" focusable="false" className="size-5" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => player.setMode('audio')}
            aria-label="Solo audio"
            title="Solo audio"
            className={toolClass}
          >
            <Headphones aria-hidden="true" focusable="false" className="size-5" />
          </button>
        </div>

        {fs && track ? (
          <div className="video-controls">
            <button
              type="button"
              onClick={() => player.toggle(track)}
              aria-label={running ? 'Pausar' : 'Reproducir'}
              title={running ? 'Pausar' : 'Reproducir'}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-red text-white hover:brightness-110"
            >
              {running ? (
                <Pause aria-hidden="true" focusable="false" className="size-5" fill="currentColor" />
              ) : (
                <Play aria-hidden="true" focusable="false" className="size-5 translate-x-px" fill="currentColor" />
              )}
            </button>
            <p className="hidden max-w-[32ch] truncate text-sm font-medium text-ink md:block" title={title}>
              {title}
            </p>
            <SeekBar key={track.key} player={player} variant="panel" />
            {s.volumeControl ? <VolumeControl player={player} volume={s.volume} muted={s.muted} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
