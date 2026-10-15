import {
  type CreatedJob,
  type ErrorCode,
  type Format,
  type JobStreamEvent,
  type Kind,
  type Overall,
  type PlaylistResult,
  type Quality,
  type ResolveResult,
  type SnapshotItem,
  type VideoMeta,
  toErrorCode,
} from './contract';
import { parseYouTubeUrl, thumbnailUrl } from './youtube-url';

export type RowStatus =
  | 'idle'
  | 'pending'
  | 'queued'
  | 'fetching'
  | 'downloading'
  | 'converting'
  | 'done'
  | 'error'
  | 'canceled';

export interface QueueItem {
  key: string;
  url: string;
  videoId: string;
  /** playlist del link `watch?v=X&list=Y` (para «Agregar la playlist completa»). */
  listId: string | null;
  origin: { playlistId: string; title: string | null } | null;
  title: string | null;
  author: string | null;
  thumbnail: string;
  duration: number | null;
  description: string | null;
  qualities: number[] | null;
  estimated: VideoMeta['estimatedBytes'] | null;
  meta: 'local' | 'quick' | 'full' | 'error';
  metaError?: ErrorCode;
  run: { jobId: string; itemId: string } | null;
  status: RowStatus;
  pct: number;
  attempt: number;
  speedBps: number | null;
  etaSec: number | null;
  position: number | null;
  error?: ErrorCode;
  errorDetails?: unknown;
  lastSuccess?: { format: Format; quality: Quality | null };
}

export interface PlaylistCard {
  key: string;
  url: string;
  playlistId: string;
  title: string | null;
  thumbnail: string | null;
  count: number | null;
  truncated: boolean;
  skipped: number;
  status: 'loading' | 'ready' | 'error';
  error?: ErrorCode;
}

export interface Options {
  kind: Kind;
  format: Format;
  quality: Quality | null;
}

export interface JobState {
  mode: 'file' | 'archive';
  format: Format;
  quality: Quality | null;
  itemKeys: string[];
  itemMap: Record<string, string>; // itemId → key
  overall: Overall | null;
  status: 'active' | 'ended';
  dispatch: { at: number; withActivation: boolean; first: boolean } | null;
  seenProgress: boolean;
  /** Último rechazo (código) que cerró el job antes de ver progreso. */
  rejectedCode?: ErrorCode;
}

export interface State {
  items: QueueItem[];
  playlists: PlaylistCard[];
  options: Options;
  jobs: Record<string, JobState>;
  inputError: string | null;
  cleared: { items: QueueItem[]; playlists: PlaylistCard[] } | null;
}

export const DEFAULT_OPTIONS: Options = { kind: 'audio', format: 'mp3', quality: 192 };
export const AUDIO_FORMATS: readonly Format[] = ['mp3', 'm4a', 'wav'];
export const VIDEO_FORMATS: readonly Format[] = ['mp4'];
const ACTIVE_ROW: readonly RowStatus[] = ['pending', 'queued', 'fetching', 'downloading', 'converting'];
const TERMINAL_ROW: readonly RowStatus[] = ['done', 'error', 'canceled'];
const PROGRESS_STATUSES: readonly string[] = ['queued', 'fetching', 'downloading', 'converting', 'done'];
const LIVE_SERVER: readonly string[] = ['queued', 'fetching', 'downloading', 'converting'];
/** Errores de metadata que hacen el video inconvertible. */
const DEFINITIVE_META_ERRORS: readonly ErrorCode[] = ['VIDEO_UNAVAILABLE', 'PRIVATE_VIDEO', 'AGE_RESTRICTED', 'LIVE_NOT_SUPPORTED', 'INVALID_URL'];
export const BLOCKED_BYTES_THRESHOLD = 64 * 1024;

export function initialState(options: Options = DEFAULT_OPTIONS): State {
  return { items: [], playlists: [], options: normalizeOptions(options), jobs: {}, inputError: null, cleared: null };
}

export function defaultQuality(format: Format): Quality | null {
  if (format === 'mp3') return 192;
  if (format === 'mp4') return 720;
  return null;
}

export function normalizeOptions(o: Partial<Options> & { format?: Format }): Options {
  const format: Format = o.format ?? (o.kind === 'video' ? 'mp4' : 'mp3');
  const kind: Kind = format === 'mp4' ? 'video' : 'audio';
  let quality: Quality | null = o.quality ?? null;
  if (format === 'mp3' && quality !== 128 && quality !== 192 && quality !== 320) quality = 192;
  if (format === 'mp4' && quality !== 360 && quality !== 480 && quality !== 720 && quality !== 1080 && quality !== 'best') quality = 720;
  if (format === 'm4a' || format === 'wav') quality = null;
  return { kind, format, quality };
}

// Entrada: clasificación de líneas pegadas

export interface NewItem {
  key: string;
  url: string;
  videoId: string;
  listId: string | null;
  origin?: QueueItem['origin'];
  title?: string | null;
  duration?: number | null;
}
export interface NewPlaylist {
  key: string;
  url: string;
  playlistId: string;
}
export interface LinkPlan {
  items: NewItem[];
  playlists: NewPlaylist[];
  invalid: string[];
  duplicates: number;
  overLimit: number;
}

/** Decide qué entra en la cola. `newKey` genera ids de cliente (crypto.randomUUID en el navegador). */
export function planLinks(state: State, lines: readonly string[], maxItems: number, newKey: () => string): LinkPlan {
  const plan: LinkPlan = { items: [], playlists: [], invalid: [], duplicates: 0, overLimit: 0 };
  const seen = new Set(state.items.map((i) => i.videoId));
  const seenLists = new Set(state.playlists.map((p) => p.playlistId));
  let room = Math.max(0, maxItems - state.items.length);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const p = parseYouTubeUrl(line);
    if (!p) {
      plan.invalid.push(line);
      continue;
    }
    if (p.kind === 'playlist' && p.playlistId) {
      if (seenLists.has(p.playlistId)) {
        plan.duplicates++;
        continue;
      }
      seenLists.add(p.playlistId);
      plan.playlists.push({ key: newKey(), url: p.canonicalUrl, playlistId: p.playlistId });
      continue;
    }
    const videoId = p.videoId as string;
    if (seen.has(videoId)) {
      plan.duplicates++;
      continue;
    }
    if (room <= 0) {
      plan.overLimit++;
      continue;
    }
    seen.add(videoId);
    room--;
    plan.items.push({ key: newKey(), url: p.canonicalUrl, videoId, listId: p.playlistId ?? null });
  }
  return plan;
}

function newRow(n: NewItem): QueueItem {
  return {
    key: n.key,
    url: n.url,
    videoId: n.videoId,
    listId: n.listId,
    origin: n.origin ?? null,
    title: n.title ?? null,
    author: null,
    thumbnail: thumbnailUrl(n.videoId),
    duration: n.duration ?? null,
    description: null,
    qualities: null,
    estimated: null,
    meta: 'local',
    run: null,
    status: 'idle',
    pct: 0,
    attempt: 0,
    speedBps: null,
    etaSec: null,
    position: null,
  };
}

// Acciones

export type Action =
  | { type: 'addLinks'; items: NewItem[]; playlists: NewPlaylist[] }
  | { type: 'setInputError'; message: string | null }
  | { type: 'resolveResults'; results: ResolveResult[] }
  | { type: 'videoMeta'; videoId: string; meta: VideoMeta }
  | { type: 'videoMetaError'; videoId: string; code: ErrorCode }
  | { type: 'playlistLoaded'; key: string; result: PlaylistResult; keys: string[]; maxItems: number }
  | { type: 'playlistError'; key: string; code: ErrorCode }
  | { type: 'remove'; key: string }
  | { type: 'clear' }
  | { type: 'undoClear' }
  | { type: 'setOptions'; options: Partial<Options> }
  | { type: 'markWaiting'; keys: string[] }
  | { type: 'jobFailed'; keys: string[]; code: ErrorCode; details?: unknown }
  | { type: 'rowErrors'; errors: { key: string; code: ErrorCode }[] }
  | { type: 'cancelWaiting'; keys: string[] }
  | { type: 'jobCreated'; job: CreatedJob; keys: string[]; mode: 'file' | 'archive' }
  | { type: 'downloadDispatched'; jobId: string; at: number; withActivation: boolean; first: boolean }
  | { type: 'jobEvent'; jobId: string; event: JobStreamEvent }
  | { type: 'jobEnded'; jobId: string; code: ErrorCode; details?: unknown };

function mapItems(state: State, fn: (i: QueueItem) => QueueItem): State {
  let changed = false;
  const items = state.items.map((i) => {
    const n = fn(i);
    if (n !== i) changed = true;
    return n;
  });
  return changed ? { ...state, items } : state;
}

function isTerminal(s: RowStatus): boolean {
  return TERMINAL_ROW.includes(s);
}

function settleJob(state: State, jobId: string): State {
  const job = state.jobs[jobId];
  if (!job || job.status === 'ended') return state;
  const rows = state.items.filter((i) => i.run?.jobId === jobId);
  const allDone = rows.every((r) => isTerminal(r.status));
  if (!allDone) return state;
  return { ...state, jobs: { ...state.jobs, [jobId]: { ...job, status: 'ended' } } };
}

function applyServerItem(row: QueueItem, ev: SnapshotItem, job: JobState): QueueItem {
  if (ev.attempt < row.attempt) return row; // evento viejo de un intento anterior
  const sameAttempt = ev.attempt === row.attempt;
  // dentro de un intento, el pct nunca baja; con attempt mayor se reinicia
  const pct = sameAttempt ? Math.max(row.pct, ev.pct) : ev.pct;
  const status = ev.status as RowStatus;
  const next: QueueItem = {
    ...row,
    status,
    pct: status === 'done' ? 100 : pct,
    attempt: ev.attempt,
    speedBps: ev.speedBps,
    etaSec: ev.etaSec,
    position: ev.position,
    title: row.title ?? ev.title,
    duration: row.duration ?? ev.duration,
  };
  if (status === 'error') {
    let code = toErrorCode(ev.error?.code);
    if (
      code === 'DOWNLOAD_INTERRUPTED' &&
      ev.bytesSent < BLOCKED_BYTES_THRESHOLD &&
      job.dispatch !== null &&
      !job.dispatch.withActivation
    ) {
      code = 'DOWNLOAD_BLOCKED';
    }
    next.error = code;
    next.errorDetails = undefined;
  } else {
    delete next.error;
    delete next.errorDetails;
  }
  if (status === 'done') next.lastSuccess = { format: job.format, quality: job.quality };
  return next;
}

function failRows(state: State, keys: ReadonlySet<string>, code: ErrorCode, details?: unknown): State {
  return mapItems(state, (i) =>
    keys.has(i.key) && !isTerminal(i.status)
      ? { ...i, status: 'error', error: code, errorDetails: details, speedBps: null, etaSec: null, position: null }
      : i,
  );
}

function rowsOfJob(state: State, jobId: string): QueueItem[] {
  return state.items.filter((i) => i.run?.jobId === jobId);
}

function handleJobEvent(state: State, jobId: string, event: JobStreamEvent): State {
  const job = state.jobs[jobId];
  if (!job) return state;
  switch (event.type) {
    case 'snapshot': {
      const byKey = new Map<string, SnapshotItem>();
      for (const it of event.data.items) {
        const key = job.itemMap[it.itemId];
        if (key) byKey.set(key, it);
      }
      let s = mapItems(state, (i) => {
        const ev = i.run?.jobId === jobId ? byKey.get(i.key) : undefined;
        if (!ev) return i;
        if (event.data.status === 'canceled' && !isTerminal(i.status)) return { ...i, status: 'canceled', speedBps: null, etaSec: null };
        return applyServerItem(i, ev, job);
      });
      const seenProgress = job.seenProgress || event.data.items.some((i) => LIVE_SERVER.includes(i.status));
      s = { ...s, jobs: { ...s.jobs, [jobId]: { ...job, overall: event.data.overall, seenProgress } } };
      return settleJob(s, jobId);
    }
    case 'item': {
      const key = job.itemMap[event.data.item.itemId];
      if (!key) return state;
      let s = mapItems(state, (i) => (i.key === key && i.run?.jobId === jobId ? applyServerItem(i, event.data.item, job) : i));
      const seenProgress = job.seenProgress || PROGRESS_STATUSES.includes(event.data.item.status);
      s = { ...s, jobs: { ...s.jobs, [jobId]: { ...job, overall: event.data.overall, seenProgress } } };
      return settleJob(s, jobId);
    }
    case 'job-canceled': {
      const keys = new Set(job.itemKeys);
      const s = mapItems(state, (i) =>
        keys.has(i.key) && i.run?.jobId === jobId && !isTerminal(i.status)
          ? { ...i, status: 'canceled', speedBps: null, etaSec: null, position: null }
          : i,
      );
      return { ...s, jobs: { ...s.jobs, [jobId]: { ...job, overall: event.data.overall, status: 'ended' } } };
    }
    case 'rejected': {
      // Ya vio progreso: el rechazo es de otra conexión (p. ej. JOB_BUSY); solo toast, no toca filas.
      if (job.seenProgress) return state;
      const code = toErrorCode(event.data.code);
      const targetKey = event.data.itemId ? job.itemMap[event.data.itemId] : undefined;
      const keys = new Set(
        targetKey ? [targetKey] : rowsOfJob(state, jobId).map((r) => r.key),
      );
      const s = failRows(state, keys, code, event.data.details);
      const ended = !targetKey || rowsOfJob(s, jobId).every((r) => isTerminal(r.status));
      return {
        ...s,
        jobs: { ...s.jobs, [jobId]: { ...job, status: ended ? 'ended' : job.status, rejectedCode: code } },
      };
    }
    case 'expired':
      return handleJobEnded(state, jobId, 'JOB_NOT_FOUND');
  }
}

function handleJobEnded(state: State, jobId: string, code: ErrorCode, details?: unknown): State {
  const job = state.jobs[jobId];
  if (!job) return state;
  const keys = new Set(rowsOfJob(state, jobId).map((r) => r.key));
  const s = failRows(state, keys, code, details);
  return { ...s, jobs: { ...s.jobs, [jobId]: { ...job, status: 'ended' } } };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'addLinks': {
      if (action.items.length === 0 && action.playlists.length === 0) return state;
      const cards: PlaylistCard[] = action.playlists.map((p) => ({
        key: p.key,
        url: p.url,
        playlistId: p.playlistId,
        title: null,
        thumbnail: null,
        count: null,
        truncated: false,
        skipped: 0,
        status: 'loading',
      }));
      return {
        ...state,
        items: [...state.items, ...action.items.map(newRow)],
        playlists: [...state.playlists, ...cards],
        cleared: null,
      };
    }
    case 'setInputError':
      return state.inputError === action.message ? state : { ...state, inputError: action.message };
    case 'resolveResults': {
      const byId = new Map(action.results.map((r) => [r.id, r]));
      let s = mapItems(state, (i) => {
        const r = byId.get(i.key);
        if (!r || i.meta === 'full') return i;
        if (r.status === 'error') {
          const code = toErrorCode(r.error?.code);
          if (DEFINITIVE_META_ERRORS.includes(code)) return { ...i, meta: 'error', metaError: code };
          return i;
        }
        return { ...i, meta: 'quick', title: r.title ?? i.title, author: r.author ?? i.author };
      });
      s = {
        ...s,
        playlists: s.playlists.map((p) => {
          const r = byId.get(p.key);
          if (!r || p.status !== 'loading') return p;
          return { ...p, title: p.title ?? r.title, thumbnail: p.thumbnail ?? r.thumbnail };
        }),
      };
      return s;
    }
    case 'videoMeta': {
      const m = action.meta;
      return mapItems(state, (i) =>
        i.videoId === action.videoId
          ? {
              ...i,
              meta: 'full',
              metaError: undefined,
              title: m.title || i.title,
              author: m.author ?? i.author,
              duration: m.duration,
              description: m.description,
              qualities: m.videoQualities,
              estimated: m.estimatedBytes,
            }
          : i,
      );
    }
    case 'videoMetaError': {
      if (!DEFINITIVE_META_ERRORS.includes(action.code)) return state;
      return mapItems(state, (i) => (i.videoId === action.videoId ? { ...i, meta: 'error', metaError: action.code } : i));
    }
    case 'playlistLoaded': {
      const r = action.result;
      const card = state.playlists.find((p) => p.key === action.key);
      if (!card) return state;
      const seen = new Set(state.items.map((i) => i.videoId));
      let room = Math.max(0, action.maxItems - state.items.length);
      const added: QueueItem[] = [];
      r.items.forEach((it, idx) => {
        const key = action.keys[idx];
        if (!key || seen.has(it.videoId) || room <= 0) return;
        seen.add(it.videoId);
        room--;
        added.push(
          newRow({
            key,
            url: `https://www.youtube.com/watch?v=${it.videoId}`,
            videoId: it.videoId,
            listId: null,
            origin: { playlistId: r.playlistId, title: r.title },
            title: it.title,
            duration: it.duration,
          }),
        );
      });
      return {
        ...state,
        items: [...state.items, ...added],
        playlists: state.playlists.map((p) =>
          p.key === action.key
            ? {
                ...p,
                status: 'ready',
                title: r.title ?? p.title,
                thumbnail: r.thumbnail ?? p.thumbnail,
                count: r.count,
                truncated: r.truncated,
                skipped: r.skipped,
              }
            : p,
        ),
      };
    }
    case 'playlistError':
      return {
        ...state,
        playlists: state.playlists.map((p) => (p.key === action.key ? { ...p, status: 'error', error: action.code } : p)),
      };
    case 'remove': {
      if (isBusy(state, action.key)) return state;
      const items = state.items.filter((i) => i.key !== action.key);
      const playlists = state.playlists.filter((p) => p.key !== action.key);
      if (items.length === state.items.length && playlists.length === state.playlists.length) return state;
      return { ...state, items, playlists };
    }
    case 'clear': {
      const keep = state.items.filter((i) => isBusy(state, i.key));
      const gone = state.items.filter((i) => !isBusy(state, i.key));
      if (gone.length === 0 && state.playlists.length === 0) return state;
      return { ...state, items: keep, playlists: [], cleared: { items: gone, playlists: state.playlists } };
    }
    case 'undoClear': {
      if (!state.cleared) return state;
      const present = new Set(state.items.map((i) => i.videoId));
      const restored = state.cleared.items.filter((i) => !present.has(i.videoId));
      return {
        ...state,
        items: [...restored, ...state.items],
        playlists: [...state.cleared.playlists, ...state.playlists],
        cleared: null,
      };
    }
    case 'setOptions': {
      const merged = { ...state.options, ...action.options };
      // al cambiar de tipo sin formato explícito, se toma el primer formato del tipo
      if (action.options.kind && !action.options.format && action.options.kind !== state.options.kind) {
        merged.format = action.options.kind === 'video' ? 'mp4' : 'mp3';
        merged.quality = null;
      }
      if (action.options.format && action.options.format !== state.options.format && action.options.quality === undefined) {
        merged.quality = null;
      }
      return { ...state, options: normalizeOptions(merged) };
    }
    case 'markWaiting': {
      const keys = new Set(action.keys);
      return mapItems(state, (i) =>
        keys.has(i.key) ? { ...i, status: 'pending', run: null, pct: 0, error: undefined, errorDetails: undefined } : i,
      );
    }
    case 'jobFailed':
      return mapItems(state, (i) =>
        action.keys.includes(i.key) && (i.run === null || !isActiveJob(state, i.run.jobId))
          ? { ...i, status: 'error', error: action.code, errorDetails: action.details, speedBps: null, etaSec: null, position: null }
          : i,
      );
    case 'rowErrors': {
      const byKey = new Map(action.errors.map((e) => [e.key, e.code]));
      return mapItems(state, (i) => {
        const code = byKey.get(i.key);
        return code ? { ...i, status: 'error', error: code, errorDetails: undefined, run: null } : i;
      });
    }
    case 'cancelWaiting': {
      const keys = new Set(action.keys);
      return mapItems(state, (i) =>
        keys.has(i.key) && i.run === null && i.status === 'pending' ? { ...i, status: 'canceled' } : i,
      );
    }
    case 'jobCreated': {
      const { job } = action;
      const itemMap: Record<string, string> = {};
      const byKey = new Map<string, (typeof job.items)[number]>();
      job.items.forEach((it, idx) => {
        const key = action.keys[idx];
        if (!key) return;
        itemMap[it.itemId] = key;
        byKey.set(key, it);
      });
      const s = mapItems(state, (i) => {
        const it = byKey.get(i.key);
        if (!it) return i;
        const base: QueueItem = {
          ...i,
          run: { jobId: job.jobId, itemId: it.itemId },
          attempt: 0,
          pct: 0,
          speedBps: null,
          etaSec: null,
          position: null,
          title: i.title ?? it.title,
          duration: i.duration ?? it.duration,
        };
        if (it.status === 'error') {
          return { ...base, status: 'error', error: toErrorCode(it.error?.code), errorDetails: undefined };
        }
        return { ...base, status: 'pending', error: undefined, errorDetails: undefined };
      });
      const jobState: JobState = {
        mode: action.mode,
        format: job.format,
        quality: job.quality,
        itemKeys: action.keys.slice(0, job.items.length),
        itemMap,
        overall: null,
        status: 'active',
        dispatch: null,
        seenProgress: false,
      };
      return settleJob({ ...s, jobs: { ...s.jobs, [job.jobId]: jobState } }, job.jobId);
    }
    case 'downloadDispatched': {
      const job = state.jobs[action.jobId];
      if (!job) return state;
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [action.jobId]: { ...job, dispatch: { at: action.at, withActivation: action.withActivation, first: action.first } },
        },
      };
    }
    case 'jobEvent':
      return handleJobEvent(state, action.jobId, action.event);
    case 'jobEnded':
      return handleJobEnded(state, action.jobId, action.code, action.details);
  }
}

// Selectores

export function isActiveJob(state: State, jobId: string): boolean {
  return state.jobs[jobId]?.status === 'active';
}

export function activeJobIds(state: State): string[] {
  return Object.keys(state.jobs).filter((id) => state.jobs[id]?.status === 'active');
}

/** El item pertenece a un job activo (o espera turno local). */
export function isBusy(state: State, key: string): boolean {
  const i = state.items.find((x) => x.key === key);
  if (!i) return false;
  if (i.run && isActiveJob(state, i.run.jobId) && !isTerminal(i.status)) return true;
  return i.run === null && i.status === 'pending';
}

export function isConvertible(i: QueueItem): boolean {
  return !(i.meta === 'error' && i.metaError !== undefined && DEFINITIVE_META_ERRORS.includes(i.metaError));
}

function sameSuccess(i: QueueItem, o: Options): boolean {
  return i.lastSuccess !== undefined && i.lastSuccess.format === o.format && i.lastSuccess.quality === o.quality;
}

/** Items válidos cuyo último éxito no coincide con las opciones actuales y que no están en curso. */
export function pendingItems(state: State): QueueItem[] {
  return state.items.filter((i) => isConvertible(i) && !sameSuccess(i, state.options) && !isBusy(state, i.key));
}

/** Todos los items válidos de la cola (para «Descargar todo (ZIP)»). */
export function validItems(state: State): QueueItem[] {
  return state.items.filter((i) => isConvertible(i) && !isBusy(state, i.key));
}

export function canConvert(state: State): boolean {
  return pendingItems(state).length > 0;
}

export interface GlobalProgress {
  pct: number;
  done: number;
  total: number;
  active: boolean;
}

/** Media del pct de los items de los jobs activos; sin jobs activos, el estado de la última tanda. */
export function globalProgress(state: State): GlobalProgress {
  const active = activeJobIds(state);
  const keys = new Set(active.flatMap((id) => state.jobs[id]?.itemKeys ?? []));
  const rows = state.items.filter((i) => keys.has(i.key) || (i.run === null && i.status === 'pending'));
  if (rows.length === 0) {
    const finished = state.items.filter((i) => i.status === 'done').length;
    return { pct: 0, done: finished, total: state.items.length, active: false };
  }
  const pct = rows.reduce((acc, r) => acc + (isTerminal(r.status) ? 100 : r.pct), 0) / rows.length;
  return { pct, done: rows.filter((r) => r.status === 'done').length, total: rows.length, active: true };
}

export function rowActive(i: QueueItem): boolean {
  return ACTIVE_ROW.includes(i.status);
}

export function toUrls(state: State): string[] {
  return [...state.items.map((i) => i.url), ...state.playlists.map((p) => p.url)];
}
