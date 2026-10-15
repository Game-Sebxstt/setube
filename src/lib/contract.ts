export const API_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_URL',
  'LIMIT_ITEMS',
  'LIMIT_DURATION',
  'NO_VALID_ITEMS',
  'JOB_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'ITEM_INVALID',
  'JOB_BUSY',
  'JOB_CANCELED',
  'VIDEO_UNAVAILABLE',
  'PRIVATE_VIDEO',
  'AGE_RESTRICTED',
  'LIVE_NOT_SUPPORTED',
  'FORMAT_UNAVAILABLE',
  'PLAYLIST_UNAVAILABLE',
  'PLAYLIST_EMPTY',
  'UPSTREAM_BLOCKED',
  'UPSTREAM_FORBIDDEN',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'RATE_LIMITED',
  'TOO_MANY_STREAMS',
  'TOO_MANY_SUBSCRIBERS',
  'TOO_MANY_PREVIEWS',
  'QUEUE_FULL',
  'QUEUE_TIMEOUT',
  'INSTANCE_BUSY',
  'CONVERSION_TIMEOUT',
  'STALLED',
  'DOWNLOAD_INTERRUPTED',
  'SERVER_SHUTDOWN',
  'CAPTCHA_REQUIRED',
  'CAPTCHA_FAILED',
  'CAPTCHA_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'DOWNLOAD_BLOCKED', 'PLAYER_ERROR', 'PLAYER_UNSUPPORTED', 'UNKNOWN'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type ErrorCode = ApiErrorCode | ClientErrorCode;

const API_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);
export function isApiErrorCode(v: unknown): v is ApiErrorCode {
  return typeof v === 'string' && API_CODE_SET.has(v);
}
/** Normaliza un código cualquiera a uno conocido por el cliente. */
export function toErrorCode(v: unknown): ErrorCode {
  if (isApiErrorCode(v)) return v;
  if (typeof v === 'string' && (CLIENT_ERROR_CODES as readonly string[]).includes(v)) return v as ClientErrorCode;
  return 'UNKNOWN';
}

export type Format = 'mp3' | 'm4a' | 'wav' | 'mp4';
export type AudioQuality = 128 | 192 | 320;
export type VideoQuality = 360 | 480 | 720 | 1080 | 'best';
export type Quality = AudioQuality | VideoQuality;
export type Kind = 'audio' | 'video';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

// GET /api/config
export interface PublicConfig {
  maxItemsPerJob: number;
  maxPlaylistItems: number;
  maxDurationAudioSec: number;
  maxDurationVideoSec: number;
  formats: { mp3: number[]; m4a: number[]; wav: number[]; mp4: (number | 'best')[] };
  defaults: { mp3: number; mp4: number };
  turnstile: boolean;
  /** Escucha en streaming habilitada en la API. */
  preview?: boolean;
}

// POST /api/resolve
export interface ResolveRequest {
  items: { id: string; url: string }[];
}
export interface ResolveResult {
  id: string;
  url: string;
  kind: 'video' | 'playlist' | null;
  videoId?: string;
  playlistId?: string;
  title: string | null;
  author: string | null;
  thumbnail: string | null;
  status: 'ok' | 'error';
  error?: { code: 'INVALID_URL' | 'VIDEO_UNAVAILABLE' | 'UPSTREAM_ERROR'; message: string };
}
export interface ResolveResponse {
  results: ResolveResult[];
}

// GET /api/videos/:videoId
export interface VideoMeta {
  videoId: string;
  title: string;
  author: string | null;
  duration: number;
  thumbnail: string;
  description: string | null;
  live: false;
  audio: {
    sourceCodec: string;
    sourceAbrKbps: number | null;
    m4aNative: boolean;
    /** Códecs disponibles para escuchar en streaming. */
    preview?: { aac: boolean; opus: boolean };
  };
  videoQualities: number[];
  estimatedBytes: {
    mp3: Record<'128' | '192' | '320', number>;
    m4a: number | null;
    wav: number;
    mp4: Record<string, number | null>;
  };
  limits: { audioOk: boolean; videoOk: boolean };
}

// POST /api/playlists/resolve
export interface PlaylistResult {
  playlistId: string;
  title: string | null;
  thumbnail: string | null;
  author: string | null;
  count: number;
  truncated: boolean;
  skipped: number;
  items: { videoId: string; title: string | null; duration: number | null; thumbnail: string }[];
}

// POST /api/jobs
export interface CreateJobRequest {
  items: { videoId: string }[];
  format: Format;
  quality?: Quality;
  turnstileToken?: string;
}
export interface ItemError {
  code: string;
  message: string;
}
export interface CreatedJobItem {
  itemId: string;
  videoId: string;
  title: string | null;
  duration: number | null;
  status: 'pending' | 'error';
  error?: ItemError;
  errorKind?: 'validation';
}
export interface CreatedJob {
  jobId: string;
  format: Format;
  quality: Quality | null;
  expiresAt: string;
  items: CreatedJobItem[];
}

// GET /api/jobs/:id
export type ServerItemStatus =
  | 'pending'
  | 'queued'
  | 'fetching'
  | 'downloading'
  | 'converting'
  | 'done'
  | 'error'
  | 'canceled';

export interface Overall {
  pct: number;
  done: number;
  failed: number;
  total: number;
  active: boolean;
}
export interface SnapshotItem {
  itemId: string;
  videoId: string;
  title: string | null;
  duration: number | null;
  durationVerified: boolean;
  status: ServerItemStatus;
  pct: number;
  phase?: 'download' | 'convert';
  speedBps: number | null;
  etaSec: number | null;
  position: number | null;
  bytesSent: number;
  attempt: number;
  error?: ItemError;
  errorKind?: 'validation' | 'runtime';
  stale?: true;
  updatedAt?: number | string;
}
export interface Reject {
  code: string;
  message: string;
  at: string;
  itemId?: string;
  details?: unknown;
}
export interface JobSnapshot {
  jobId: string;
  format: Format;
  quality: Quality | null;
  status: 'active' | 'canceled';
  createdAt: string;
  expiresAt: string;
  seq: number;
  overall: Overall;
  lastReject: Reject | null;
  items: SnapshotItem[];
}

// SSE
export type ItemEventName = 'queued' | 'fetching' | 'downloading' | 'converting' | 'done' | 'error' | 'canceled';
export type JobStreamEvent =
  | { type: 'snapshot'; data: JobSnapshot }
  | { type: 'item'; name: ItemEventName; data: { item: SnapshotItem; overall: Overall } }
  | { type: 'job-canceled'; data: { jobId: string; overall: Overall } }
  | { type: 'rejected'; data: Reject }
  | { type: 'expired' };

export const TERMINAL_SERVER_STATUSES: readonly ServerItemStatus[] = ['done', 'error', 'canceled'];
