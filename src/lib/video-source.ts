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

/**
 * Nivel de arranque para un panel de `targetHeight` píxeles físicos: el más alto que no lo supera,
 * o el más bajo si todos lo superan. -1 deja la elección a hls.js (la primera variante del master).
 * `levels` viene ordenado por hls.js de menor a mayor.
 */
export function pickStartLevel(levels: readonly Pick<Level, 'height'>[], targetHeight: number | null): number {
  if (!targetHeight || targetHeight <= 0 || levels.length === 0) return -1;
  let best = -1;
  let lowest = 0;
  for (let i = 0; i < levels.length; i++) {
    const h = levels[i]?.height ?? 0;
    if (h <= targetHeight && (best < 0 || h >= (levels[best]?.height ?? 0))) best = i;
    if (h < (levels[lowest]?.height ?? 0)) lowest = i;
  }
  return best >= 0 ? best : lowest;
}

/** Configuración de partida de hls.js (T7 la ajusta con medidas). */
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
    const h = new Hls({ ...HLS_CONFIG, startPosition: opts.startPosition > 0 ? opts.startPosition : -1 });
    hls = h;
    const { Events, ErrorTypes, ErrorDetails } = Hls;
    let netRetried = false;
    let lastMediaRecovery = 0;
    let swapped = false;

    h.on(Events.MANIFEST_PARSED, () => {
      const level = pickStartLevel(h.levels, opts.targetHeight);
      if (level >= 0) h.startLevel = level;
      h.startLoad(opts.startPosition > 0 ? opts.startPosition : -1);
    });
    h.on(Events.FRAG_BUFFERED, () => {
      netRetried = false;
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
