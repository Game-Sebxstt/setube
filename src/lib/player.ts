import { useSyncExternalStore } from 'react';
import { ApiError, type PreviewCodec, previewProbe, previewUrl } from './api';
import type { ErrorCode } from './contract';
import type { QueueItem } from './queue';
import { browserStorage, loadVolume, saveVolume } from './storage';

export type Codec = PreviewCodec;
export interface PreviewCaps {
  aac: boolean;
  opus: boolean;
}

export interface Track {
  key: string;
  videoId: string;
  title: string;
  author: string | null;
  thumbnail: string;
  duration: number | null;
  preview: PreviewCaps;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export interface PlayerState {
  track: Track | null;
  status: PlayerStatus;
  codec: Codec | null;
  error: ErrorCode | null;
  volume: number;
  muted: boolean;
  caps: PreviewCaps;
  /** El navegador deja cambiar el volumen desde la página (iOS no). */
  volumeControl: boolean;
  nav: { prev: boolean; next: boolean };
}

export interface PlayerTime {
  current: number;
  buffered: number;
  duration: number | null;
}

export type PlayerEvent =
  | { type: 'load'; track: Track; codec: Codec }
  | { type: 'status'; status: PlayerStatus }
  | { type: 'fail'; code: ErrorCode; track?: Track }
  | { type: 'close' }
  | { type: 'volume'; volume: number; muted: boolean }
  | { type: 'caps'; caps: PreviewCaps; volumeControl?: boolean }
  | { type: 'nav'; nav: PlayerState['nav'] };

const NO_CAPS: PreviewCaps = { aac: false, opus: false };
const NO_NAV: PlayerState['nav'] = { prev: false, next: false };

export const INITIAL_PLAYER_STATE: PlayerState = {
  track: null,
  status: 'idle',
  codec: null,
  error: null,
  volume: 1,
  muted: false,
  caps: NO_CAPS,
  volumeControl: false,
  nav: NO_NAV,
};
const ZERO_TIME: PlayerTime = { current: 0, buffered: 0, duration: null };

export function playerReducer(s: PlayerState, e: PlayerEvent): PlayerState {
  switch (e.type) {
    case 'load':
      return { ...s, track: e.track, codec: e.codec, status: 'loading', error: null };
    case 'status': {
      if (!s.track || s.status === e.status) return s;
      if (e.status === 'paused' && (s.status === 'ended' || s.status === 'error')) return s;
      if (e.status === 'buffering' && s.status === 'paused') return s;
      return { ...s, status: e.status, error: null };
    }
    case 'fail':
      return { ...s, track: e.track ?? s.track, status: 'error', error: e.code };
    case 'close':
      return s.track === null && s.status === 'idle' ? s : { ...s, track: null, status: 'idle', codec: null, error: null };
    case 'volume':
      return s.volume === e.volume && s.muted === e.muted ? s : { ...s, volume: e.volume, muted: e.muted };
    case 'caps':
      return { ...s, caps: e.caps, volumeControl: e.volumeControl ?? s.volumeControl };
    case 'nav':
      return s.nav.prev === e.nav.prev && s.nav.next === e.nav.next ? s : { ...s, nav: e.nav };
  }
}

export function codecFor(p: PreviewCaps | null | undefined, caps: PreviewCaps): Codec | null {
  if (!p) return null;
  if (p.aac && caps.aac) return 'aac';
  if (p.opus && caps.opus) return 'opus';
  return null;
}

export function canPreview(item: QueueItem, maxDurationAudioSec: number, caps: PreviewCaps): boolean {
  return (
    item.meta === 'full' &&
    item.duration != null &&
    item.duration > 0 &&
    item.duration <= maxDurationAudioSec &&
    codecFor(item.preview, caps) !== null
  );
}

export function toTrack(item: QueueItem): Track {
  return {
    key: item.key,
    videoId: item.videoId,
    title: item.title ?? 'Video de YouTube',
    author: item.author,
    thumbnail: item.thumbnail,
    duration: item.duration,
    preview: item.preview ?? NO_CAPS,
  };
}

export function neighbors(tracks: readonly Track[], key: string | null): { prev: Track | null; next: Track | null } {
  const i = key === null ? -1 : tracks.findIndex((t) => t.key === key);
  if (i < 0) return { prev: null, next: null };
  return { prev: tracks[i - 1] ?? null, next: tracks[i + 1] ?? null };
}

const NO_SPACE =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"], [role="textbox"]';

/** Espacio reproduce o pausa solo si el foco no está en un control que ya lo usa. */
export function shouldHandleSpace(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return true;
  return target.closest(NO_SPACE) === null;
}

const BAD_KEY = (c: Codec) => `setube_preview_bad_${c}`;
const MIME: Record<Codec, string> = { aac: 'audio/mp4; codecs="mp4a.40.2"', opus: 'audio/webm; codecs="opus"' };
const RETRY_RESET_MS = 10_000;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function readBad(c: Codec): boolean {
  try {
    return window.sessionStorage.getItem(BAD_KEY(c)) === '1';
  } catch {
    return false;
  }
}
function writeBad(c: Codec): void {
  try {
    window.sessionStorage.setItem(BAD_KEY(c), '1');
  } catch {
    // modo privado: la marca vive solo en memoria
  }
}

export interface Player {
  getState(): PlayerState;
  subscribe(fn: () => void): () => void;
  getTime(): PlayerTime;
  subscribeTime(fn: () => void): () => void;
  /** Conecta el único <audio> de la página; devuelve la desconexión. */
  attach(audio: HTMLAudioElement): () => void;
  toggle(track: Track): void;
  play(): void;
  pause(): void;
  retry(): void;
  seek(sec: number, fast?: boolean): void;
  seekBy(delta: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  close(): void;
  setQueue(tracks: readonly Track[]): void;
  step(dir: -1 | 1): void;
  markUnsupported(c: Codec): void;
}

/** Motor del reproductor. No toca window ni navigator hasta `attach`. */
export function createPlayer(): Player {
  let state = INITIAL_PLAYER_STATE;
  let time = ZERO_TIME;
  const listeners = new Set<() => void>();
  const timeListeners = new Set<() => void>();
  let audio: HTMLAudioElement | null = null;
  let sid: string | null = null;
  let queue: readonly Track[] = [];

  let retryBudget = 1;
  let switchedCodec = false;
  let lastTime = 0;
  let resumeAt: number | null = null;
  let resumePlay = false;
  let budgetTimer: ReturnType<typeof setTimeout> | null = null;
  let probe: AbortController | null = null;

  const emit = (e: PlayerEvent) => {
    const next = playerReducer(state, e);
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn();
  };

  const durationOf = (a: HTMLAudioElement): number | null =>
    Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (state.track?.duration ?? null);

  const emitTime = () => {
    const a = audio;
    if (!a || !state.track) {
      if (time !== ZERO_TIME) {
        time = ZERO_TIME;
        for (const fn of timeListeners) fn();
      }
      return;
    }
    const current = a.currentTime || 0;
    let buffered = 0;
    for (let i = 0; i < a.buffered.length; i++) {
      if (a.buffered.start(i) <= current + 0.5 && a.buffered.end(i) >= current) buffered = a.buffered.end(i);
    }
    const duration = durationOf(a);
    if (time.current === current && time.buffered === buffered && time.duration === duration) return;
    time = { current, buffered, duration };
    for (const fn of timeListeners) fn();
  };

  const clearBudgetTimer = () => {
    if (budgetTimer) clearTimeout(budgetTimer);
    budgetTimer = null;
  };
  const abortProbe = () => {
    probe?.abort();
    probe = null;
  };

  const updateNav = () => {
    const n = neighbors(queue, state.track?.key ?? null);
    emit({ type: 'nav', nav: { prev: n.prev !== null, next: n.next !== null } });
  };

  const startPlay = (a: HTMLAudioElement) => {
    const p = a.play();
    if (!p) return;
    p.catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      // NotAllowedError: el navegador exige un gesto; AbortError: se cambió la fuente a mitad
      if (name === 'NotAllowedError') emit({ type: 'status', status: 'paused' });
    });
  };

  const setSource = (a: HTMLAudioElement, track: Track, codec: Codec) => {
    if (!sid) sid = crypto.randomUUID().replaceAll('-', '');
    a.src = previewUrl(track.videoId, codec, sid);
  };

  const load = (track: Track) => {
    const a = audio;
    if (!a) return;
    abortProbe();
    clearBudgetTimer();
    const codec = codecFor(track.preview, state.caps);
    if (!codec) {
      emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED', track });
      updateNav();
      return;
    }
    retryBudget = 1;
    switchedCodec = false;
    lastTime = 0;
    resumeAt = null;
    resumePlay = false;
    emit({ type: 'load', track, codec });
    updateNav();
    emitTime();
    setSource(a, track, codec);
    startPlay(a);
  };

  const markUnsupported = (c: Codec) => {
    writeBad(c);
    if (!state.caps[c]) return;
    emit({ type: 'caps', caps: { ...state.caps, [c]: false } });
  };

  /** El códec servido no funciona aquí: se marca y se prueba el otro una sola vez. */
  const switchCodec = (served: Codec) => {
    const a = audio;
    const track = state.track;
    if (!a || !track) return;
    markUnsupported(served);
    const next = codecFor(track.preview, state.caps);
    if (next && !switchedCodec) {
      switchedCodec = true;
      resumeAt = lastTime > 0 ? lastTime : null;
      emit({ type: 'load', track, codec: next });
      setSource(a, track, next);
      startPlay(a);
      return;
    }
    a.pause();
    emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED' });
  };

  const recover = () => {
    const a = audio;
    const track = state.track;
    const codec = state.codec;
    if (!a || !track || !codec) return;
    const mediaCode = a.error?.code ?? 0;
    const wasPlaying = state.status === 'playing' || state.status === 'buffering' || state.status === 'loading';
    const at = a.currentTime > 0 ? a.currentTime : lastTime;
    clearBudgetTimer();

    if (retryBudget > 0 && (mediaCode === MEDIA_ERR_NETWORK || mediaCode === MEDIA_ERR_DECODE || at > 0)) {
      retryBudget--;
      resumeAt = at > 0 ? at : null;
      resumePlay = wasPlaying;
      setSource(a, track, codec);
      if (wasPlaying) {
        emit({ type: 'status', status: 'loading' });
        startPlay(a);
      } else {
        emit({ type: 'status', status: 'paused' });
      }
      return;
    }

    abortProbe();
    const ctrl = new AbortController();
    probe = ctrl;
    emit({ type: 'status', status: 'loading' });
    previewProbe(track.videoId, codec, sid ?? '', ctrl.signal)
      .then((contentType) => {
        if (ctrl.signal.aborted || state.track?.key !== track.key) return;
        if (mediaCode === MEDIA_ERR_SRC_NOT_SUPPORTED) {
          switchCodec(contentType.startsWith('audio/webm') ? 'opus' : 'aac');
          return;
        }
        emit({ type: 'fail', code: 'PLAYER_ERROR' });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || state.track?.key !== track.key) return;
        emit({ type: 'fail', code: err instanceof ApiError ? err.code : 'PLAYER_ERROR' });
      })
      .finally(() => {
        if (probe === ctrl) probe = null;
      });
  };

  const retry = () => {
    const a = audio;
    const track = state.track;
    if (!a || !track) return;
    abortProbe();
    const codec = codecFor(track.preview, state.caps);
    if (!codec) {
      emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED' });
      return;
    }
    retryBudget = 1;
    switchedCodec = false;
    resumeAt = lastTime > 0 ? lastTime : null;
    emit({ type: 'load', track, codec });
    setSource(a, track, codec);
    startPlay(a);
  };

  const close = () => {
    abortProbe();
    clearBudgetTimer();
    lastTime = 0;
    resumeAt = null;
    const a = audio;
    emit({ type: 'close' });
    updateNav();
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    emitTime();
  };

  const seek = (sec: number, fast = false) => {
    const a = audio;
    if (!a || !state.track) return;
    const d = durationOf(a);
    const t = Math.max(0, d ? Math.min(sec, d) : sec);
    lastTime = t;
    if (a.readyState === 0) {
      resumeAt = t;
      emitTime();
      return;
    }
    if (fast && typeof a.fastSeek === 'function') a.fastSeek(t);
    else a.currentTime = t;
    emitTime();
  };

  const toggle = (track: Track) => {
    const a = audio;
    if (!a) return;
    if (state.track?.key !== track.key) {
      load(track);
      return;
    }
    switch (state.status) {
      case 'playing':
      case 'buffering':
      case 'loading':
        abortProbe();
        resumePlay = false;
        a.pause();
        emit({ type: 'status', status: 'paused' });
        return;
      case 'paused':
        // una pausa durante la recuperación deja el elemento con error: se recarga la fuente
        if (a.error) {
          retry();
          return;
        }
        emit({ type: 'status', status: 'loading' });
        startPlay(a);
        return;
      case 'error':
        retry();
        return;
      case 'ended':
        a.currentTime = 0;
        emit({ type: 'status', status: 'loading' });
        startPlay(a);
        return;
      case 'idle':
        load(track);
    }
  };

  const onEvent: Record<string, (a: HTMLAudioElement) => void> = {
    loadedmetadata: (a) => {
      const track = state.track;
      if (!track) return;
      // sin duración ni seek, el contenedor no está bien soportado en este navegador
      if ((track.duration ?? 0) > 0 && (!Number.isFinite(a.duration) || a.seekable.length === 0) && state.codec) {
        switchCodec(state.codec);
        return;
      }
      if (resumeAt !== null) {
        a.currentTime = Math.min(resumeAt, Number.isFinite(a.duration) ? a.duration : resumeAt);
        resumeAt = null;
      }
      if (resumePlay) {
        resumePlay = false;
        if (a.paused) startPlay(a);
      }
      emitTime();
    },
    playing: () => {
      emit({ type: 'status', status: 'playing' });
      clearBudgetTimer();
      budgetTimer = setTimeout(() => {
        retryBudget = 1;
      }, RETRY_RESET_MS);
    },
    waiting: (a) => {
      clearBudgetTimer();
      if (!a.paused) emit({ type: 'status', status: 'buffering' });
    },
    pause: (a) => {
      clearBudgetTimer();
      // un pause en cola de una fuente anterior no debe pisar la nueva carga
      if (a.paused) emit({ type: 'status', status: 'paused' });
    },
    ended: () => {
      clearBudgetTimer();
      emit({ type: 'status', status: 'ended' });
    },
    error: () => {
      if (state.track && state.status !== 'error') recover();
    },
    timeupdate: (a) => {
      if (a.currentTime > 0) lastTime = a.currentTime;
      emitTime();
    },
    progress: () => emitTime(),
    durationchange: () => emitTime(),
    seeking: () => emitTime(),
    emptied: () => emitTime(),
    volumechange: (a) => emit({ type: 'volume', volume: a.volume, muted: a.muted }),
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getTime: () => time,
    subscribeTime(fn) {
      timeListeners.add(fn);
      return () => timeListeners.delete(fn);
    },
    attach(a) {
      audio = a;
      if (!sid) sid = crypto.randomUUID().replaceAll('-', '');
      const saved = loadVolume(browserStorage());
      let volumeControl = false;
      try {
        a.volume = 0.5;
        volumeControl = Math.abs(a.volume - 0.5) < 0.01;
        a.volume = saved;
      } catch {
        volumeControl = false;
      }
      const caps: PreviewCaps = {
        aac: a.canPlayType(MIME.aac) !== '' && !readBad('aac'),
        opus: a.canPlayType(MIME.opus) !== '' && !readBad('opus'),
      };
      emit({ type: 'caps', caps, volumeControl });
      emit({ type: 'volume', volume: a.volume, muted: a.muted });
      const bound = Object.entries(onEvent).map(([name, fn]) => {
        const h = () => fn(a);
        a.addEventListener(name, h);
        return [name, h] as const;
      });
      return () => {
        close();
        for (const [name, h] of bound) a.removeEventListener(name, h);
        if (audio === a) audio = null;
      };
    },
    toggle,
    play() {
      const t = state.track;
      if (t && (state.status === 'paused' || state.status === 'ended' || state.status === 'error')) toggle(t);
    },
    pause() {
      const t = state.track;
      if (t && (state.status === 'playing' || state.status === 'buffering' || state.status === 'loading')) toggle(t);
    },
    retry,
    seek,
    seekBy(delta) {
      const a = audio;
      if (!a || !state.track) return;
      seek((a.readyState === 0 ? lastTime : a.currentTime) + delta);
    },
    setVolume(v) {
      const a = audio;
      if (!a) return;
      const vol = Math.min(1, Math.max(0, v));
      a.volume = vol;
      if (vol > 0 && a.muted) a.muted = false;
      saveVolume(browserStorage(), vol);
    },
    toggleMute() {
      const a = audio;
      if (!a) return;
      a.muted = !a.muted;
      if (!a.muted && a.volume === 0) a.volume = 1;
    },
    close,
    setQueue(tracks) {
      queue = tracks;
      updateNav();
    },
    step(dir) {
      const n = neighbors(queue, state.track?.key ?? null);
      const t = dir < 0 ? n.prev : n.next;
      if (t) load(t);
    },
    markUnsupported,
  };
}

const serverState = () => INITIAL_PLAYER_STATE;
const serverTime = () => ZERO_TIME;

export function usePlayerState(p: Player): PlayerState {
  return useSyncExternalStore(p.subscribe, p.getState, serverState);
}

export function usePlayerTime(p: Player): PlayerTime {
  return useSyncExternalStore(p.subscribeTime, p.getTime, serverTime);
}

export function usePlayerCaps(p: Player | null): PreviewCaps {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => p?.getState().caps ?? NO_CAPS,
    () => NO_CAPS,
  );
}

/** Estado de la pista `key`, o null si no es la actual. */
export function usePlayerStatus(p: Player | null, key: string): PlayerStatus | null {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => {
      const s = p?.getState();
      return s && s.track?.key === key ? s.status : null;
    },
    () => null,
  );
}

const noopSubscribe = () => () => undefined;
