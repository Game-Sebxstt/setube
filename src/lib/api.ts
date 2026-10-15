import { API_URL } from '@/config/site';
import {
  type CreateJobRequest,
  type CreatedJob,
  type ErrorBody,
  type ErrorCode,
  type JobSnapshot,
  type PlaylistResult,
  type PublicConfig,
  type ResolveRequest,
  type ResolveResponse,
  type VideoMeta,
  toErrorCode,
} from './contract';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('timeout', 'TimeoutError')), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: anySignal([opts.signal, timeout.signal]),
      cache: 'no-store',
    });
  } catch (err) {
    clearTimeout(timer);
    if (opts.signal?.aborted) throw err; // abort del llamador: se propaga tal cual
    throw new ApiError('NETWORK_ERROR', 0, 'network');
  }
  clearTimeout(timer);
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let body: ErrorBody | null = null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = null;
  }
  let details = body?.error?.details;
  const retryAfter = Number(res.headers.get('retry-after'));
  if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
    const d = details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
    if (d.retryAfterSec === undefined) details = { ...d, retryAfterSec: retryAfter };
  }
  throw new ApiError(toErrorCode(body?.error?.code), res.status, body?.error?.message ?? res.statusText, details);
}

export type PreviewCodec = 'aac' | 'opus';

/** URL del audio en streaming; `sid` identifica al reproductor ante los topes de la API. */
export const previewUrl = (videoId: string, codec: PreviewCodec, sid: string) =>
  `${API_URL}/api/videos/${encodeURIComponent(videoId)}/audio?codec=${codec}&sid=${encodeURIComponent(sid)}`;

/** Pide el primer byte del audio para saber por qué falló el reproductor. Devuelve el Content-Type servido. */
export async function previewProbe(videoId: string, codec: PreviewCodec, sid: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(previewUrl(videoId, codec, sid), { headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('NETWORK_ERROR', 0, 'network');
  }
  if (res.ok) {
    void res.body?.cancel().catch(() => undefined);
    return res.headers.get('content-type') ?? '';
  }
  let body: ErrorBody | null = null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = null;
  }
  throw new ApiError(toErrorCode(body?.error?.code), res.status, body?.error?.message ?? res.statusText, body?.error?.details);
}

export const api = {
  config: (signal?: AbortSignal) => request<PublicConfig>('/api/config', { signal, timeoutMs: 5000 }),
  resolve: (body: ResolveRequest, signal?: AbortSignal) =>
    request<ResolveResponse>('/api/resolve', { method: 'POST', body, signal, timeoutMs: 15_000 }),
  video: (videoId: string, signal?: AbortSignal) =>
    request<VideoMeta>(`/api/videos/${encodeURIComponent(videoId)}`, { signal, timeoutMs: 45_000 }),
  playlist: (url: string, signal?: AbortSignal) =>
    request<PlaylistResult>('/api/playlists/resolve', { method: 'POST', body: { url }, signal, timeoutMs: 45_000 }),
  createJob: (body: CreateJobRequest) => request<CreatedJob>('/api/jobs', { method: 'POST', body, timeoutMs: 30_000 }),
  job: (jobId: string) => request<JobSnapshot>(`/api/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 10_000 }),
  cancel: (jobId: string) =>
    request<{ jobId: string; status: 'canceled' }>(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', timeoutMs: 10_000 }),
};

export const eventsUrl = (jobId: string) => `${API_URL}/api/jobs/${encodeURIComponent(jobId)}/events`;
