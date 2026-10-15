import type { Player } from '@/lib/player';

const SKIP_SEC = 10;

/** Controles de la pantalla de bloqueo y de las teclas multimedia. Devuelve la limpieza. */
export function bindMediaSession(player: Player, audio: HTMLAudioElement): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => undefined;
  const ms = navigator.mediaSession;

  const handle = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, h);
    } catch {
      // acción no soportada por este navegador
    }
  };

  const position = () => {
    try {
      const d = player.getTime().duration;
      if (!player.getState().track || !d || !Number.isFinite(d) || d <= 0) return;
      ms.setPositionState({
        duration: d,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime || 0), d),
      });
    } catch {
      // posición inválida durante un cambio de fuente
    }
  };

  handle('play', () => player.play());
  handle('pause', () => player.pause());
  handle('stop', () => player.close());
  handle('seekto', (d) => {
    if (typeof d.seekTime === 'number') player.seek(d.seekTime, Boolean(d.fastSeek));
  });
  handle('seekbackward', (d) => player.seekBy(-(d.seekOffset ?? SKIP_SEC)));
  handle('seekforward', (d) => player.seekBy(d.seekOffset ?? SKIP_SEC));

  let lastKey: string | null = null;
  let lastPrev: boolean | null = null;
  let lastNext: boolean | null = null;

  const sync = () => {
    const s = player.getState();
    const key = s.track?.key ?? null;
    if (key !== lastKey) {
      lastKey = key;
      try {
        ms.metadata =
          s.track && typeof MediaMetadata !== 'undefined'
            ? new MediaMetadata({
                title: s.track.title,
                artist: s.track.author ?? '',
                album: 'Setube',
                artwork: [{ src: s.track.thumbnail, sizes: '320x180', type: 'image/jpeg' }],
              })
            : null;
      } catch {
        ms.metadata = null;
      }
    }
    if (s.nav.prev !== lastPrev) {
      lastPrev = s.nav.prev;
      handle('previoustrack', s.nav.prev ? () => player.step(-1) : null);
    }
    if (s.nav.next !== lastNext) {
      lastNext = s.nav.next;
      handle('nexttrack', s.nav.next ? () => player.step(1) : null);
    }
    ms.playbackState = !s.track
      ? 'none'
      : s.status === 'playing' || s.status === 'buffering' || s.status === 'loading'
        ? 'playing'
        : 'paused';
    position();
  };

  const events = ['durationchange', 'seeked', 'ratechange', 'playing', 'pause'] as const;
  for (const e of events) audio.addEventListener(e, position);
  const unsubscribe = player.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    for (const e of events) audio.removeEventListener(e, position);
    for (const a of ['play', 'pause', 'stop', 'seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) {
      handle(a, null);
    }
    try {
      ms.metadata = null;
      ms.playbackState = 'none';
    } catch {
      // sin soporte parcial
    }
  };
}
