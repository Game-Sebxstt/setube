import { useSyncExternalStore } from 'react';
import { ApiError, type PreviewCodec, hlsMasterUrl, previewProbe, previewUrl } from './api';
import type { ErrorCode } from './contract';
import type { QueueItem } from './queue';
import { browserStorage, loadPlayerMode, loadVolume, savePlayerMode, saveVolume } from './storage';
import {
  NO_VIDEO_CAPS,
  type PlayerMode,
  type VideoCaps,
  type VideoSource,
  detectVideoCaps,
  hasVideo,
  loadHls,
  openVideoSource,
} from './video-source';

export type { PlayerMode, VideoCaps } from './video-source';
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
  /** La pista se puede ver en video (API con `previewVideo` y video compatible). */
  video: boolean;
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
  /** Modo del elemento activo: `<audio>` o `<video>`. Sin pista siempre es `audio`. */
  mode: PlayerMode;
  /** Modo que eligió el usuario; se usa al cargar una pista nueva si la pista lo admite. */
  preferredMode: PlayerMode;
  videoCaps: VideoCaps;
  /** Aviso que no detiene la reproducción (p. ej. el video falló y sigue el audio). */
  notice: ErrorCode | null;
}

export interface PlayerTime {
  current: number;
  buffered: number;
  duration: number | null;
}

export type PlayerEvent =
  | { type: 'load'; track: Track; codec: Codec; mode?: PlayerMode }
  | { type: 'status'; status: PlayerStatus }
  | { type: 'fail'; code: ErrorCode; track?: Track }
  | { type: 'close' }
  | { type: 'volume'; volume: number; muted: boolean }
  | { type: 'caps'; caps: PreviewCaps; volumeControl?: boolean; videoCaps?: VideoCaps }
  | { type: 'nav'; nav: PlayerState['nav'] }
  | { type: 'mode'; mode: PlayerMode; status?: PlayerStatus }
  | { type: 'prefer'; mode: PlayerMode }
  | { type: 'notice'; code: ErrorCode | null };

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
  mode: 'audio',
  preferredMode: 'audio',
  videoCaps: NO_VIDEO_CAPS,
  notice: null,
};
const ZERO_TIME: PlayerTime = { current: 0, buffered: 0, duration: null };

export function playerReducer(s: PlayerState, e: PlayerEvent): PlayerState {
  switch (e.type) {
    case 'load':
      return { ...s, track: e.track, codec: e.codec, status: 'loading', error: null, mode: e.mode ?? s.mode, notice: null };
    case 'status': {
      if (!s.track || s.status === e.status) return s;
      if (e.status === 'paused' && (s.status === 'ended' || s.status === 'error')) return s;
      if (e.status === 'buffering' && s.status === 'paused') return s;
      return { ...s, status: e.status, error: null };
    }
    case 'fail':
      return { ...s, track: e.track ?? s.track, status: 'error', error: e.code };
    case 'close':
      return s.track === null && s.status === 'idle' && s.mode === 'audio' && s.notice === null
        ? s
        : { ...s, track: null, status: 'idle', codec: null, error: null, mode: 'audio', notice: null };
    case 'volume':
      return s.volume === e.volume && s.muted === e.muted ? s : { ...s, volume: e.volume, muted: e.muted };
    case 'caps':
      return {
        ...s,
        caps: e.caps,
        volumeControl: e.volumeControl ?? s.volumeControl,
        videoCaps: e.videoCaps ?? s.videoCaps,
      };
    case 'nav':
      return s.nav.prev === e.nav.prev && s.nav.next === e.nav.next ? s : { ...s, nav: e.nav };
    case 'mode': {
      // sin pista no hay elemento de video activo
      const mode = s.track ? e.mode : 'audio';
      const status = s.track && e.status ? e.status : s.status;
      if (s.mode === mode && s.status === status) return s;
      return { ...s, mode, status, error: status === s.status ? s.error : null, notice: null };
    }
    case 'prefer':
      return s.preferredMode === e.mode ? s : { ...s, preferredMode: e.mode };
    case 'notice':
      return s.notice === e.code ? s : { ...s, notice: e.code };
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

/**
 * La fila se puede ver en video: metadata completa, duración dentro del límite de la escucha,
 * alguna calidad de video, audio AAC (el grupo de audio del HLS) y MSE o HLS nativo.
 * Que la API tenga `previewVideo` lo comprueba quien llama.
 */
export function canPreviewVideo(item: QueueItem, maxDurationAudioSec: number, caps: VideoCaps): boolean {
  return (
    item.meta === 'full' &&
    item.duration != null &&
    item.duration > 0 &&
    item.duration <= maxDurationAudioSec &&
    (item.qualities?.length ?? 0) > 0 &&
    item.preview?.aac === true &&
    hasVideo(caps)
  );
}

export function toTrack(item: QueueItem, video = false): Track {
  return {
    key: item.key,
    videoId: item.videoId,
    title: item.title ?? 'Video de YouTube',
    author: item.author,
    thumbnail: item.thumbnail,
    duration: item.duration,
    preview: item.preview ?? NO_CAPS,
    video,
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

function isRunning(s: PlayerStatus): boolean {
  return s === 'playing' || s === 'buffering' || s === 'loading';
}

function clearMedia(el: HTMLMediaElement): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

/** Alto del panel de video en píxeles físicos, o null si aún no se ve. */
function panelHeight(v: HTMLVideoElement): number | null {
  const h = v.clientHeight;
  if (!h || h <= 0) return null;
  const dpr = typeof globalThis.devicePixelRatio === 'number' && globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
  return Math.round(h * dpr);
}

export interface Player {
  getState(): PlayerState;
  subscribe(fn: () => void): () => void;
  getTime(): PlayerTime;
  subscribeTime(fn: () => void): () => void;
  /** Conecta el único <audio> y, si lo hay, el único <video> de la página; devuelve la desconexión. */
  attach(audio: HTMLAudioElement, video?: HTMLVideoElement | null): () => void;
  /** Elemento activo (el que suena), o null antes de `attach`. */
  getMedia(): HTMLMediaElement | null;
  /**
   * Reproduce o pausa `track`. Con `mode`, la reproduce en ese modo: si ya es la actual en otro modo,
   * cambia de modo en el mismo segundo y la reproduce.
   */
  toggle(track: Track, mode?: PlayerMode): void;
  /** El usuario elige el modo: se guarda como preferido y, si hay pista, se cambia en el mismo segundo y estado. */
  setMode(mode: PlayerMode): void;
  /**
   * Descarga hls.js antes del primer «Ver video» (al pasar el ratón o enfocar el botón), para que la fuente
   * y `play()` vayan dentro del gesto del usuario. Sin MSE no hace nada.
   */
  warmVideo(): void;
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
  let video: HTMLVideoElement | null = null;
  let videoSource: VideoSource | null = null;
  /** Segundo que se le pasó a hls.js como `startPosition`: ese salto ya lo hace hls.js. */
  let hlsStart: number | null = null;
  let sid: string | null = null;
  let queue: readonly Track[] = [];

  let retryBudget = 1;
  let switchedCodec = false;
  let lastTime = 0;
  let resumeAt: number | null = null;
  /**
   * Segundo de un cambio de modo o de un reintento mientras el elemento nuevo aún está en 0.
   * Se publica en lugar de `currentTime` hasta que el elemento llega a ese punto (sin saltos a 0 en la barra).
   */
  let pendingAt: number | null = null;
  let resumePlay = false;
  let budgetTimer: ReturnType<typeof setTimeout> | null = null;
  let probe: AbortController | null = null;

  const emit = (e: PlayerEvent) => {
    const next = playerReducer(state, e);
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn();
  };

  /** Elemento que suena; los eventos del otro no cuentan. */
  const active = (): HTMLMediaElement | null => (state.mode === 'video' ? video : audio);

  const durationOf = (a: HTMLMediaElement): number | null =>
    Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (state.track?.duration ?? null);

  const emitTime = () => {
    const a = active();
    if (!a || !state.track) {
      if (time !== ZERO_TIME) {
        time = ZERO_TIME;
        for (const fn of timeListeners) fn();
      }
      return;
    }
    // el elemento nuevo ya llegó al segundo pendiente (tiene cabecera y avanzó desde 0)
    if (pendingAt !== null && a.readyState > 0 && a.currentTime > 0) pendingAt = null;
    const current = pendingAt ?? (a.currentTime || 0);
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

  /** La versión de la cola manda: allí `video` refleja la config y las capacidades actuales. */
  const fresh = (t: Track): Track => queue.find((q) => q.key === t.key) ?? t;

  const videoAvailable = (t: Track): boolean => video !== null && fresh(t).video && hasVideo(state.videoCaps);

  const modeFor = (t: Track, wanted: PlayerMode | undefined): PlayerMode =>
    (wanted ?? state.preferredMode) === 'video' && videoAvailable(t) ? 'video' : 'audio';

  /** Segundo en el que está (o estará, si hay un salto pendiente) el elemento. */
  const positionOf = (el: HTMLMediaElement | null): number => {
    if (resumeAt !== null) return resumeAt;
    if (pendingAt !== null) return pendingAt;
    if (el && el.readyState > 0 && el.currentTime > 0) return el.currentTime;
    return lastTime;
  };

  const startPlay = (a: HTMLMediaElement) => {
    const p = a.play();
    if (!p) return;
    p.catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      // NotAllowedError: el navegador exige un gesto; AbortError: se cambió la fuente a mitad
      if (name === 'NotAllowedError' && a === active()) emit({ type: 'status', status: 'paused' });
    });
  };

  const ensureSid = (): string => {
    if (!sid) sid = crypto.randomUUID().replaceAll('-', '');
    return sid;
  };

  const setSource = (a: HTMLAudioElement, track: Track, codec: Codec) => {
    a.src = previewUrl(track.videoId, codec, ensureSid());
  };

  const stopVideo = () => {
    const src = videoSource;
    videoSource = null;
    hlsStart = null;
    src?.destroy();
  };

  /** Deja el elemento de `mode` vacío y en pausa. */
  const stopMode = (mode: PlayerMode) => {
    if (mode === 'video') stopVideo();
    else if (audio) clearMedia(audio);
  };

  /** El video no se puede reproducir: vuelve al audio en el mismo punto y avisa. */
  const videoFailed = (src: VideoSource) => {
    if (videoSource !== src || state.mode !== 'video' || !state.track) return;
    switchTo('audio', isRunning(state.status));
    emit({ type: 'notice', code: 'VIDEO_UNSUPPORTED' });
  };

  const startVideo = (track: Track, at: number, play: boolean) => {
    const v = video;
    if (!v) return;
    stopVideo();
    const startAt = at > 0 ? at : null;
    resumeAt = startAt;
    const src: VideoSource = openVideoSource(v, state.videoCaps, {
      url: hlsMasterUrl(track.videoId, ensureSid()),
      startPosition: at,
      targetHeight: panelHeight(v),
      onFatal: () => videoFailed(src),
    });
    videoSource = src;
    if (src.kind === 'hls') hlsStart = startAt;
    if (src.kind !== null) {
      // fuente puesta en el mismo gesto (HLS nativo o hls.js ya cargado)
      if (play) startPlay(v);
      return;
    }
    void src.ready.then((ok) => {
      if (!ok || videoSource !== src || state.mode !== 'video') return;
      if (src.kind === 'hls') hlsStart = startAt;
      // si el usuario pausó mientras se cargaba hls.js, no se arranca
      if (play && isRunning(state.status)) startPlay(v);
    });
  };

  /** Pone la fuente de `mode` en `at` y la arranca si `play`. */
  const begin = (mode: PlayerMode, track: Track, codec: Codec, at: number, play: boolean) => {
    if (mode === 'video') {
      startVideo(track, at, play);
      return;
    }
    const a = audio;
    if (!a) return;
    setSource(a, track, codec);
    resumeAt = at > 0 ? at : null;
    if (play) startPlay(a);
  };

  /** Cambia de elemento conservando el segundo; `play` decide si sigue sonando. */
  const switchTo = (next: PlayerMode, play: boolean) => {
    const track = state.track;
    if (!track || !audio || next === state.mode) return;
    const prev = state.mode;
    const ended = state.status === 'ended';
    const at = ended ? 0 : positionOf(active());
    abortProbe();
    clearBudgetTimer();
    retryBudget = 1;
    switchedCodec = false;
    resumePlay = false;
    resumeAt = null;
    lastTime = at;
    pendingAt = at > 0 ? at : null;
    const codec = state.codec ?? codecFor(track.preview, state.caps);
    // primero el modo: los eventos del elemento que se vacía ya no cuentan
    emit({ type: 'mode', mode: next, status: play ? 'loading' : 'paused' });
    stopMode(prev);
    if (!codec && next === 'audio') {
      emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED' });
      return;
    }
    begin(next, track, codec ?? 'aac', at, play);
    emitTime();
  };

  const load = (input: Track, wanted?: PlayerMode) => {
    const a = audio;
    if (!a) return;
    const track = fresh(input);
    abortProbe();
    clearBudgetTimer();
    pendingAt = null;
    const prev = state.mode;
    const codec = codecFor(track.preview, state.caps);
    if (!codec) {
      if (prev === 'video') {
        emit({ type: 'mode', mode: 'audio' });
        stopVideo();
      }
      emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED', track });
      updateNav();
      return;
    }
    const mode = modeFor(track, wanted);
    retryBudget = 1;
    switchedCodec = false;
    lastTime = 0;
    resumeAt = null;
    resumePlay = false;
    emit({ type: 'load', track, codec, mode });
    if (prev !== mode) stopMode(prev);
    updateNav();
    emitTime();
    begin(mode, track, codec, 0, true);
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

  /** Recuperación del <audio> (el <video> la hace en video-source). */
  const recover = () => {
    const a = audio;
    const track = state.track;
    const codec = state.codec;
    if (!a || !track || !codec) return;
    const mediaCode = a.error?.code ?? 0;
    const wasPlaying = isRunning(state.status);
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
    const current = state.track;
    if (!a || !current) return;
    const track = fresh(current);
    abortProbe();
    const codec = codecFor(track.preview, state.caps);
    if (!codec) {
      emit({ type: 'fail', code: 'PLAYER_UNSUPPORTED' });
      return;
    }
    const prev = state.mode;
    const mode = prev === 'video' && videoAvailable(track) ? 'video' : 'audio';
    retryBudget = 1;
    switchedCodec = false;
    const at = lastTime > 0 ? lastTime : 0;
    pendingAt = at > 0 ? at : null;
    emit({ type: 'load', track, codec, mode });
    if (prev !== mode) stopMode(prev);
    begin(mode, track, codec, at, true);
  };

  const close = () => {
    abortProbe();
    clearBudgetTimer();
    lastTime = 0;
    resumeAt = null;
    pendingAt = null;
    resumePlay = false;
    const a = audio;
    emit({ type: 'close' });
    updateNav();
    stopVideo();
    if (a) clearMedia(a);
    emitTime();
  };

  const seek = (sec: number, fast = false) => {
    const a = active();
    if (!a || !state.track) return;
    const d = durationOf(a);
    const t = Math.max(0, d ? Math.min(sec, d) : sec);
    lastTime = t;
    if (a.readyState === 0) {
      resumeAt = t;
      // durante un cambio de modo la barra muestra el destino del salto
      if (pendingAt !== null) pendingAt = t > 0 ? t : null;
      emitTime();
      return;
    }
    pendingAt = null;
    if (fast && typeof a.fastSeek === 'function') a.fastSeek(t);
    else a.currentTime = t;
    emitTime();
  };

  const toggle = (input: Track, mode?: PlayerMode) => {
    if (!audio) return;
    const track = fresh(input);
    if (state.track?.key !== track.key) {
      load(track, mode);
      return;
    }
    if (mode && mode !== state.mode && (mode === 'audio' || videoAvailable(track))) {
      switchTo(mode, true);
      return;
    }
    const a = active();
    if (!a) return;
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
        load(track, mode);
    }
  };

  const onEvent: Record<string, (a: HTMLMediaElement) => void> = {
    loadedmetadata: (a) => {
      const track = state.track;
      if (!track) return;
      // sin duración ni seek, el contenedor no está bien soportado en este navegador
      if (
        state.mode === 'audio' &&
        (track.duration ?? 0) > 0 &&
        (!Number.isFinite(a.duration) || a.seekable.length === 0) &&
        state.codec
      ) {
        switchCodec(state.codec);
        return;
      }
      if (resumeAt !== null) {
        // el salto a `startPosition` ya lo hace hls.js; uno posterior del usuario sí se aplica aquí
        const byHls = state.mode === 'video' && videoSource?.kind === 'hls' && hlsStart === resumeAt;
        if (!byHls) a.currentTime = Math.min(resumeAt, Number.isFinite(a.duration) ? a.duration : resumeAt);
        resumeAt = null;
      }
      hlsStart = null;
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
      // los errores del <video> los gestiona video-source (hls.js o HLS nativo)
      if (state.mode === 'audio' && state.track && state.status !== 'error') recover();
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

  const bind = (el: HTMLMediaElement) =>
    Object.entries(onEvent).map(([name, fn]) => {
      const h = () => {
        if (el === active()) fn(el);
      };
      el.addEventListener(name, h);
      return () => el.removeEventListener(name, h);
    });

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
    attach(a, v = null) {
      audio = a;
      video = v;
      ensureSid();
      const storage = browserStorage();
      const saved = loadVolume(storage);
      let volumeControl = false;
      try {
        a.volume = 0.5;
        volumeControl = Math.abs(a.volume - 0.5) < 0.01;
        a.volume = saved;
        if (v) v.volume = saved;
      } catch {
        volumeControl = false;
      }
      const caps: PreviewCaps = {
        aac: a.canPlayType(MIME.aac) !== '' && !readBad('aac'),
        opus: a.canPlayType(MIME.opus) !== '' && !readBad('opus'),
      };
      emit({ type: 'caps', caps, volumeControl, videoCaps: detectVideoCaps(v) });
      emit({ type: 'prefer', mode: loadPlayerMode(storage) });
      emit({ type: 'volume', volume: a.volume, muted: a.muted });
      const unbind = [...bind(a), ...(v ? bind(v) : [])];
      return () => {
        close();
        for (const off of unbind) off();
        if (audio === a) audio = null;
        if (video === v) video = null;
      };
    },
    getMedia: active,
    toggle,
    setMode(mode) {
      savePlayerMode(browserStorage(), mode);
      emit({ type: 'prefer', mode });
      const t = state.track;
      if (!t || mode === state.mode) return;
      if (mode === 'video' && !videoAvailable(t)) return;
      switchTo(mode, isRunning(state.status));
    },
    warmVideo() {
      if (!video || !state.videoCaps.mse) return;
      // si falla (sin red), openVideoSource lo vuelve a intentar al entrar en video
      loadHls().catch(() => undefined);
    },
    play() {
      const t = state.track;
      if (t && (state.status === 'paused' || state.status === 'ended' || state.status === 'error')) toggle(t);
    },
    pause() {
      const t = state.track;
      if (t && isRunning(state.status)) toggle(t);
    },
    retry,
    seek,
    seekBy(delta) {
      const a = active();
      if (!a || !state.track) return;
      // mientras el elemento nuevo está en 0 la base es el segundo pendiente
      seek((pendingAt ?? (a.readyState === 0 ? lastTime : a.currentTime)) + delta);
    },
    setVolume(v) {
      const a = audio;
      if (!a) return;
      const vol = Math.min(1, Math.max(0, v));
      for (const el of [a, video]) {
        if (!el) continue;
        el.volume = vol;
        if (vol > 0 && el.muted) el.muted = false;
      }
      saveVolume(browserStorage(), vol);
    },
    toggleMute() {
      const a = active();
      if (!a) return;
      const muted = !a.muted;
      for (const el of [audio, video]) {
        if (!el) continue;
        el.muted = muted;
        if (!muted && el.volume === 0) el.volume = 1;
      }
    },
    close,
    setQueue(tracks) {
      queue = tracks;
      updateNav();
    },
    step(dir) {
      const n = neighbors(queue, state.track?.key ?? null);
      const t = dir < 0 ? n.prev : n.next;
      // quien está viendo video sigue en video si la siguiente lo admite
      if (t) load(t, state.mode === 'video' ? 'video' : undefined);
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

export function usePlayerVideoCaps(p: Player | null): VideoCaps {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => p?.getState().videoCaps ?? NO_VIDEO_CAPS,
    () => NO_VIDEO_CAPS,
  );
}

/** Modo que eligió el usuario (el que usa la miniatura de cada fila). */
export function usePlayerPreferredMode(p: Player | null): PlayerMode {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => p?.getState().preferredMode ?? 'audio',
    () => 'audio',
  );
}

/** true si la pista cargada se puede ver en video (suene en audio o en video). */
export function usePlayerTrackHasVideo(p: Player | null): boolean {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => p?.getState().track?.video === true,
    () => false,
  );
}

/** Modo de la pista `key` si es la actual, o null si no lo es. */
export function usePlayerTrackMode(p: Player | null, key: string): PlayerMode | null {
  return useSyncExternalStore(
    p ? p.subscribe : noopSubscribe,
    () => {
      const s = p?.getState();
      return s && s.track?.key === key ? s.mode : null;
    },
    () => null,
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
