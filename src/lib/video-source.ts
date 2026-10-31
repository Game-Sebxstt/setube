import type HlsType from 'hls.js';
import type { ErrorData, HlsConfig, Level } from 'hls.js';

export type PlayerMode = 'audio' | 'video';

/** Qué vías de video tiene el navegador: MSE (hls.js) o HLS nativo (Safari, iPhone sin MSE). */
export interface VideoCaps {
  mse: boolean;
  native: boolean;
}

export const NO_VIDEO_CAPS: VideoCaps = { mse: false, native: false };
/** Mismo par de códecs base que comprueba `Hls.isSupported()`. */
export const VIDEO_MIME = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
export const HLS_MIME = 'application/vnd.apple.mpegurl';

type MediaSourceCtor = { isTypeSupported(type: string): boolean };

function mediaSourceCtor(): MediaSourceCtor | undefined {
  const g = globalThis as unknown as Record<string, MediaSourceCtor | undefined>;
  return g.ManagedMediaSource ?? g.MediaSource ?? g.WebKitMediaSource;
}

/** Detecta las vías de video sin cargar hls.js. */
export function detectVideoCaps(video: HTMLVideoElement | null): VideoCaps {
  if (!video) return NO_VIDEO_CAPS;
  let mse = false;
  try {
    const ms = mediaSourceCtor();
    mse = typeof ms?.isTypeSupported === 'function' && ms.isTypeSupported(VIDEO_MIME);
  } catch {
    mse = false;
  }
  let native = false;
  try {
    native = video.canPlayType(HLS_MIME) !== '';
  } catch {
    native = false;
  }
  return { mse, native };
}

export function hasVideo(c: VideoCaps): boolean {
  return c.mse || c.native;
}

type StartLevel = Pick<Level, 'height'> & Partial<Pick<Level, 'bitrate' | 'averageBitrate'>>;

/**
 * Parte del ancho de banda medido que se da por usable al elegir el arranque: el mismo margen con el que hls.js
 * decide subir de calidad (`abrBandWidthUpFactor`), para que no baje nada más empezar.
 */
export const START_BANDWIDTH_FACTOR = 0.7;

/**
 * Nivel de arranque para un panel de `targetHeight` píxeles físicos: el más alto que no lo supera,
 * o el más bajo si todos lo superan. Con `bandwidthBps` (lo medido antes en esta pestaña o lo que estima el
 * navegador) tampoco pasa del 70 % de ese ancho de banda. -1 deja la elección a hls.js (la primera variante del master).
 * `levels` viene ordenado por hls.js de menor a mayor.
 */
export function pickStartLevel(levels: readonly StartLevel[], targetHeight: number | null, bandwidthBps: number | null = null): number {
  if (levels.length === 0) return -1;
  const bySize = targetHeight !== null && targetHeight > 0;
  const byRate = bandwidthBps !== null && bandwidthBps > 0;
  if (!bySize && !byRate) return -1;
  const usable = byRate ? bandwidthBps * START_BANDWIDTH_FACTOR : Infinity;
  const rate = (l: StartLevel) => l.averageBitrate || l.bitrate || 0;
  let best = -1;
  let lowest = 0;
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i] as StartLevel;
    const h = l.height ?? 0;
    const fits = (!bySize || h <= (targetHeight as number)) && rate(l) <= usable;
    if (fits && (best < 0 || h >= (levels[best]?.height ?? 0))) best = i;
    if (h < (levels[lowest]?.height ?? 0) || (h === (levels[lowest]?.height ?? 0) && rate(l) < rate(levels[lowest] as StartLevel))) lowest = i;
  }
  return best >= 0 ? best : lowest;
}

/** Ancho de banda que hls.js midió en esta pestaña: el siguiente video arranca con él (calidad y ABR). */
export const BANDWIDTH_KEY = 'setube_bwe';
const BANDWIDTH_MIN = 100_000;
const BANDWIDTH_MAX = 200_000_000;

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Lo medido antes en esta pestaña, en bits por segundo; null si no hay nada válido. */
export function loadBandwidth(): number | null {
  try {
    const raw = session()?.getItem(BANDWIDTH_KEY);
    const v = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(v) && v >= BANDWIDTH_MIN ? Math.min(v, BANDWIDTH_MAX) : null;
  } catch {
    return null;
  }
}

/**
 * Estimación de partida para la calidad del primer video de la pestaña: lo medido por hls.js o, si no hay nada,
 * `navigator.connection.downlink` (Chrome y Android; Mbit/s, con tope de 10). Sin ninguna de las dos, null.
 */
export function startBandwidth(): number | null {
  const measured = loadBandwidth();
  if (measured !== null) return measured;
  try {
    const c = (globalThis.navigator as (Navigator & { connection?: { downlink?: unknown } }) | undefined)?.connection;
    const mbps = typeof c?.downlink === 'number' ? c.downlink : Number.NaN;
    return Number.isFinite(mbps) && mbps > 0 ? Math.max(BANDWIDTH_MIN, mbps * 1e6) : null;
  } catch {
    return null;
  }
}

export function saveBandwidth(bps: number): void {
  if (!Number.isFinite(bps) || bps < BANDWIDTH_MIN) return;
  try {
    session()?.setItem(BANDWIDTH_KEY, String(Math.round(Math.min(bps, BANDWIDTH_MAX))));
  } catch {
    // modo privado o almacenamiento lleno: el siguiente video arranca sin la medida
  }
}

/** Configuración fija de hls.js; el ancho de banda de partida se añade en cada video (`loadBandwidth`). */
export const HLS_CONFIG: Partial<HlsConfig> = {
  // fMP4 no necesita transmux: sin worker no hace falta `worker-src blob:` en la CSP
  enableWorker: false,
  autoStartLoad: false,
  capLevelToPlayerSize: true,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  backBufferLength: 30,
};

/** Tras una recuperación de media, otra antes de este plazo prueba `swapAudioCodec` y después se rinde. */
const MEDIA_RECOVERY_WINDOW_MS = 3000;

type HlsCtor = typeof HlsType;
let hlsModule: Promise<HlsCtor> | null = null;
let hlsLoaded: HlsCtor | null = null;

/** Carga hls.js en un chunk aparte; si falla (sin red), el siguiente intento vuelve a pedirlo. */
export function loadHls(): Promise<HlsCtor> {
  if (!hlsModule) {
    hlsModule = import('hls.js').then(
      (m) => {
        hlsLoaded = m.default;
        return m.default;
      },
      (err: unknown) => {
        hlsModule = null;
        throw err;
      },
    );
  }
  return hlsModule;
}

export type VideoFailReason = 'unsupported' | 'load' | 'network' | 'media' | 'other';

export interface VideoSourceOptions {
  url: string;
  /** Segundo en el que empezar (0 = principio). */
  startPosition: number;
  /** Alto del panel en píxeles físicos, si ya se conoce. */
  targetHeight: number | null;
  /** El video no se puede reproducir: el motor vuelve al audio. Se llama como mucho una vez. */
  onFatal: (reason: VideoFailReason) => void;
}

export interface VideoSource {
  /** `hls` (MSE) o `native`; `null` mientras se carga hls.js. */
  readonly kind: 'hls' | 'native' | null;
  /** Se resuelve en true cuando el elemento ya tiene la fuente y se puede llamar a `play()`. */
  readonly ready: Promise<boolean>;
  destroy(): void;
}

function clearElement(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // elemento ya desconectado
  }
}

function isHttpClientError(data: ErrorData): boolean {
  const code = data.response?.code ?? 0;
  return code >= 400 && code < 500;
}

/**
 * Abre el master HLS en `video`: hls.js si hay MSE (también en Chrome, cuyo HLS nativo no respeta
 * `BYTERANGE`), y HLS nativo solo si no hay MSE.
 */
export function openVideoSource(video: HTMLVideoElement, caps: VideoCaps, opts: VideoSourceOptions): VideoSource {
  let destroyed = false;
  let failed = false;
  let kind: VideoSource['kind'] = null;
  let hls: InstanceType<HlsCtor> | null = null;
  let onNativeError: (() => void) | null = null;
  // guarda la última medida de hls.js al cerrar (cambio de pista, de modo o cierre del reproductor)
  let saveEstimate: (() => void) | null = null;

  // siempre asíncrono: quien abre la fuente aún no tiene el objeto devuelto
  const fail = (reason: VideoFailReason) => {
    if (destroyed || failed) return;
    failed = true;
    queueMicrotask(() => {
      if (!destroyed) opts.onFatal(reason);
    });
  };

  const startNative = (): boolean => {
    kind = 'native';
    onNativeError = () => fail('media');
    video.addEventListener('error', onNativeError);
    video.src = opts.url;
    return true;
  };

  const startHls = (Hls: HlsCtor): boolean => {
    kind = 'hls';
    // Lo medido en el video anterior de esta pestaña: sin ello hls.js parte de 500 kbit/s y tarda en subir
    const measured = loadBandwidth();
    const h = new Hls({
      ...HLS_CONFIG,
      ...(measured !== null ? { abrEwmaDefaultEstimate: measured } : {}),
      startPosition: opts.startPosition > 0 ? opts.startPosition : -1,
    });
    hls = h;
    const { Events, ErrorTypes, ErrorDetails } = Hls;
    let netRetried = false;
    let lastMediaRecovery = 0;
    let swapped = false;
    let savedAt = 0;
    let sampled = false;
    // Solo tras algún fragmento cargado: antes, bandwidthEstimate es el valor por defecto y no una medida
    saveEstimate = () => {
      if (sampled) saveBandwidth(h.bandwidthEstimate);
    };

    h.on(Events.MANIFEST_PARSED, () => {
      // la calidad de arranque también tiene en cuenta la estimación del navegador; el ABR, solo lo medido
      const level = pickStartLevel(h.levels, opts.targetHeight, measured ?? startBandwidth());
      if (level >= 0) h.startLevel = level;
      h.startLoad(opts.startPosition > 0 ? opts.startPosition : -1);
    });
    h.on(Events.FRAG_BUFFERED, () => {
      netRetried = false;
      sampled = true;
      const now = Date.now();
      if (now - savedAt > 2000) {
        savedAt = now;
        saveEstimate?.();
      }
    });
    h.on(Events.ERROR, (_e, data) => {
      if (!data.fatal || destroyed) return;
      if (data.type === ErrorTypes.NETWORK_ERROR) {
        // master o playlist rechazados por la API (422, 404, 429…): hls.js ya agotó sus reintentos
        const playlist =
          data.details === ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
          data.details === ErrorDetails.MANIFEST_PARSING_ERROR;
        if (playlist || isHttpClientError(data) || netRetried) {
          fail(playlist ? 'load' : 'network');
          return;
        }
        netRetried = true;
        h.startLoad();
        return;
      }
      if (data.type === ErrorTypes.MEDIA_ERROR) {
        const now = Date.now();
        // recoverMediaError separa y vuelve a unir el MediaSource, y el elemento queda en pausa
        const recover = (swap: boolean) => {
          lastMediaRecovery = now;
          if (!video.paused) {
            h.once(Events.MEDIA_ATTACHED, () => {
              if (!destroyed) void video.play()?.catch(() => undefined);
            });
          }
          if (swap) h.swapAudioCodec();
          h.recoverMediaError();
        };
        if (now - lastMediaRecovery > MEDIA_RECOVERY_WINDOW_MS) {
          recover(false);
          return;
        }
        if (!swapped) {
          swapped = true;
          recover(true);
          return;
        }
        fail('media');
        return;
      }
      fail('other');
    });
    h.attachMedia(video);
    h.loadSource(opts.url);
    return true;
  };

  const start = (Hls: HlsCtor | null): boolean => {
    if (destroyed) return false;
    if (Hls?.isSupported()) return startHls(Hls);
    if (caps.native) return startNative();
    fail('unsupported');
    return false;
  };

  let ready: Promise<boolean>;
  if (!caps.mse) {
    // sin MSE no hace falta hls.js
    ready = Promise.resolve(start(null));
  } else if (hlsLoaded) {
    // ya cargado: la fuente se pone dentro del mismo gesto del usuario
    ready = Promise.resolve(start(hlsLoaded));
  } else {
    ready = loadHls().then(
      (Hls) => start(Hls),
      () => {
        if (destroyed) return false;
        if (caps.native) return start(null);
        fail('unsupported');
        return false;
      },
    );
  }

  return {
    get kind() {
      return kind;
    },
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (onNativeError) video.removeEventListener('error', onNativeError);
      if (hls) {
        saveEstimate?.();
        hls.destroy();
        hls = null;
      }
      clearElement(video);
    },
  };
}

/** Para pruebas: olvida el módulo cargado. */
export function resetHlsForTests(): void {
  hlsModule = null;
  hlsLoaded = null;
}
