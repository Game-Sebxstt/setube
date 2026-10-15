import type { ErrorCode } from './contract';
import { minutes } from './format';

export interface MessageContext {
  maxItemsPerJob?: number;
  maxDurationAudioSec?: number;
  maxDurationVideoSec?: number;
  details?: unknown;
}

type Message = string | ((ctx: MessageContext) => string);

function retryAfter(details: unknown): number | null {
  if (details && typeof details === 'object' && 'retryAfterSec' in details) {
    const v = (details as { retryAfterSec: unknown }).retryAfterSec;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.ceil(v);
  }
  return null;
}

export const MESSAGES: Record<ErrorCode, Message> = {
  INVALID_INPUT: 'La solicitud no es válida. Recarga la página e intenta de nuevo.',
  INVALID_URL: 'Esto no parece un link de YouTube.',
  LIMIT_ITEMS: (c) => `Puedes convertir hasta ${c.maxItemsPerJob ?? 50} videos a la vez.`,
  LIMIT_DURATION: (c) =>
    `Supera la duración máxima: ${minutes(c.maxDurationAudioSec ?? 3600)} min en audio, ${minutes(c.maxDurationVideoSec ?? 1200)} min en video.`,
  NO_VALID_ITEMS: 'Ninguno de los videos se puede convertir. Revisa los errores de cada uno.',
  JOB_NOT_FOUND: 'Esta conversión ya expiró. Vuelve a convertir.',
  ITEM_NOT_FOUND: 'Este video ya no está en la conversión. Vuelve a convertir.',
  ITEM_INVALID: 'Este video no se puede convertir con las opciones elegidas.',
  JOB_BUSY: 'Esta descarga ya está en curso.',
  JOB_CANCELED: 'La conversión fue cancelada.',
  VIDEO_UNAVAILABLE: 'Este video no está disponible.',
  PRIVATE_VIDEO: 'Este video es privado.',
  AGE_RESTRICTED: 'Este video tiene restricción de edad y no se puede convertir.',
  LIVE_NOT_SUPPORTED: 'Las transmisiones en vivo no se pueden convertir.',
  FORMAT_UNAVAILABLE: 'Este video no tiene una versión compatible con el formato elegido.',
  PLAYLIST_UNAVAILABLE: 'No se pudo obtener la información de la playlist. Verifica la URL.',
  PLAYLIST_EMPTY: 'La playlist no tiene videos disponibles.',
  UPSTREAM_BLOCKED: 'YouTube está limitando las descargas en este momento. Intenta en unos minutos.',
  UPSTREAM_FORBIDDEN: 'YouTube rechazó la descarga. Intenta de nuevo en unos minutos.',
  UPSTREAM_ERROR: 'No se pudo obtener el video de YouTube. Reintenta.',
  UPSTREAM_TIMEOUT: 'YouTube tardó demasiado en responder. Reintenta.',
  RATE_LIMITED: (c) => {
    const s = retryAfter(c.details);
    return s === null ? 'Demasiadas solicitudes. Espera un momento.' : `Demasiadas solicitudes. Espera ${s} s.`;
  },
  TOO_MANY_STREAMS: 'Ya tienes varias descargas en curso. Espera a que termine alguna.',
  TOO_MANY_SUBSCRIBERS: 'Esta conversión está abierta en demasiadas pestañas.',
  QUEUE_FULL: 'El servidor está ocupado. Intenta en un momento.',
  QUEUE_TIMEOUT: 'Tardó demasiado en tener turno. Reintenta.',
  INSTANCE_BUSY: 'El servidor está ocupado. Intenta en un momento.',
  CONVERSION_TIMEOUT: 'La conversión tardó demasiado. Reintenta.',
  STALLED: 'La conversión se detuvo. Reintenta.',
  DOWNLOAD_INTERRUPTED: 'La descarga se interrumpió.',
  SERVER_SHUTDOWN: 'El servidor se está reiniciando. Reintenta en unos segundos.',
  CAPTCHA_REQUIRED: 'Completa la verificación para continuar.',
  CAPTCHA_FAILED: 'No se pudo verificar que eres una persona. Intenta de nuevo.',
  CAPTCHA_UNAVAILABLE: 'La verificación no está disponible ahora. Intenta en un momento.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible en este momento. Intenta en un momento.',
  INTERNAL: 'Ocurrió un error inesperado. Intenta de nuevo.',
  NETWORK_ERROR: 'No se pudo conectar con el servidor.',
  DOWNLOAD_BLOCKED: 'Tu navegador pudo bloquear la descarga. Permite las descargas múltiples para este sitio.',
  UNKNOWN: 'Ocurrió un error inesperado. Intenta de nuevo.',
};

export function messageFor(code: ErrorCode, ctx: MessageContext = {}): string {
  const m = MESSAGES[code] ?? MESSAGES.UNKNOWN;
  return typeof m === 'function' ? m(ctx) : m;
}

// Para cuando el watchdog no puede determinar la causa.
export const DOWNLOAD_START_FAILED = 'No se pudo iniciar la descarga. Intenta de nuevo.';
export const CONNECTION_LOST = 'Se perdió la conexión con el servidor durante la conversión';
export const DUPLICATE_VIDEO = 'Ese video ya está en la cola';
export const queueLimitMessage = (max: number) => `La cola admite hasta ${max} videos`;
export const invalidLinesMessage = (n: number) => `Estas líneas no son links de YouTube: ${n}`;
