'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { API_URL, TURNSTILE_SITE_KEY } from '@/config/site';
import { ApiError, api, eventsUrl } from '@/lib/api';
import { type ErrorCode, type JobStreamEvent, type PublicConfig, type Reject, toErrorCode } from '@/lib/contract';
import { COMPILED_CONFIG } from '@/lib/defaults';
import { type Dispatched, dispatchDownload, downloadTarget } from '@/lib/download';
import { openJobEvents, type JobEventsHandle } from '@/lib/job-events';
import { createLimiter } from '@/lib/limit';
import {
  CONNECTION_LOST,
  DOWNLOAD_START_FAILED,
  DUPLICATE_VIDEO,
  invalidLinesMessage,
  messageFor,
  queueLimitMessage,
} from '@/lib/messages';
import {
  type Options,
  type State,
  activeJobIds,
  globalProgress,
  initialState,
  pendingItems,
  planLinks,
  reducer,
  toUrls,
  validItems,
} from '@/lib/queue';
import { browserStorage, loadPrefs, loadUrls, savePrefs, saveUrls } from '@/lib/storage';
import { createTurnstile, type TurnstileHandle } from '@/lib/turnstile';
import { playlistUrl } from '@/lib/youtube-url';
import { type AddResult, CommandBar } from './CommandBar';
import { MasterBar } from './MasterBar';
import { OutputRack } from './OutputRack';
import { Queue } from './Queue';
import { Toaster, useToasts } from './Toaster';

const MAX_ACTIVE_JOBS = 2;
const RESOLVE_DEBOUNCE_MS = 200;
const RESOLVE_BATCH = 50;
const WATCHDOG_MS = 8000;
const PERSIST_DEBOUNCE_MS = 300;
const ANNOUNCE_THROTTLE_MS = 2000;

const newKey = () => crypto.randomUUID();

interface JobRuntime {
  events: JobEventsHandle | null;
  download: Dispatched | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  dispatchAt: number | null;
  seenProgress: boolean;
  url: string;
  finalized: boolean;
}

export function Converter() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [config, setConfig] = useState<PublicConfig>(COMPILED_CONFIG);
  const { toasts, push, dismiss } = useToasts();
  const [announcement, setAnnouncement] = useState('');

  const stateRef = useRef<State>(state);
  const configRef = useRef(config);
  useEffect(() => {
    stateRef.current = state;
    configRef.current = config;
  }, [state, config]);

  const messageCtx = useMemo(
    () => ({
      maxItemsPerJob: config.maxItemsPerJob,
      maxDurationAudioSec: config.maxDurationAudioSec,
      maxDurationVideoSec: config.maxDurationVideoSec,
    }),
    [config],
  );
  const msg = useCallback((code: ErrorCode, details?: unknown) => messageFor(code, { ...messageCtx, details }), [messageCtx]);

  // Prefetch: resolve por lotes con debounce, metadata con concurrencia 3 y playlists.

  const resolveBuffer = useRef<{ key: string; url: string; kind: 'video' | 'playlist' }[]>([]);
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaLimiter = useRef(createLimiter(3));
  const metaRequested = useRef(new Set<string>());

  const fetchMeta = useCallback((videoId: string) => {
    if (metaRequested.current.has(videoId)) return;
    metaRequested.current.add(videoId);
    void metaLimiter.current(async () => {
      try {
        const meta = await api.video(videoId);
        dispatch({ type: 'videoMeta', videoId, meta });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'UNKNOWN';
        dispatch({ type: 'videoMetaError', videoId, code });
        // los errores transitorios se pueden volver a pedir más tarde
        if (!['VIDEO_UNAVAILABLE', 'PRIVATE_VIDEO', 'AGE_RESTRICTED', 'LIVE_NOT_SUPPORTED'].includes(code)) {
          metaRequested.current.delete(videoId);
        }
      }
    });
  }, []);

  const loadPlaylist = useCallback(
    async (key: string, url: string) => {
      try {
        const result = await api.playlist(url);
        dispatch({
          type: 'playlistLoaded',
          key,
          result,
          keys: result.items.map(() => newKey()),
          maxItems: configRef.current.maxItemsPerJob,
        });
        for (const it of result.items) fetchMeta(it.videoId);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'UNKNOWN';
        dispatch({ type: 'playlistError', key, code });
        push(msg(code));
      }
    },
    [fetchMeta, msg, push],
  );

  const flushResolve = useCallback(async () => {
    resolveTimer.current = null;
    const batch = resolveBuffer.current.splice(0, resolveBuffer.current.length);
    for (let i = 0; i < batch.length; i += RESOLVE_BATCH) {
      const chunk = batch.slice(i, i + RESOLVE_BATCH);
      try {
        const { results } = await api.resolve({ items: chunk.map((c) => ({ id: c.key, url: c.url })) });
        dispatch({ type: 'resolveResults', results });
        for (const r of results) if (r.kind === 'video' && r.status === 'ok' && r.videoId) fetchMeta(r.videoId);
      } catch (err) {
        // sin resolve rápido, la fase completa sigue trayendo los datos
        for (const c of chunk) {
          const it = stateRef.current.items.find((x) => x.key === c.key);
          if (it) fetchMeta(it.videoId);
        }
        if (err instanceof ApiError && err.code === 'NETWORK_ERROR') push(msg('NETWORK_ERROR'));
      }
      for (const c of chunk) if (c.kind === 'playlist') void loadPlaylist(c.key, c.url);
    }
  }, [fetchMeta, loadPlaylist, msg, push]);

  const scheduleResolve = useCallback(
    (entries: { key: string; url: string; kind: 'video' | 'playlist' }[]) => {
      if (entries.length === 0) return;
      resolveBuffer.current.push(...entries);
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
      resolveTimer.current = setTimeout(() => void flushResolve(), RESOLVE_DEBOUNCE_MS);
    },
    [flushResolve],
  );

  const addLines = useCallback(
    (lines: string[], { quiet = false }: { quiet?: boolean } = {}): AddResult => {
      const plan = planLinks(stateRef.current, lines, configRef.current.maxItemsPerJob, newKey);
      dispatch({ type: 'addLinks', items: plan.items, playlists: plan.playlists });
      // la ref se actualiza antes para que dos llamadas seguidas no dupliquen
      stateRef.current = reducer(stateRef.current, { type: 'addLinks', items: plan.items, playlists: plan.playlists });
      scheduleResolve([
        ...plan.items.map((i) => ({ key: i.key, url: i.url, kind: 'video' as const })),
        ...plan.playlists.map((p) => ({ key: p.key, url: p.url, kind: 'playlist' as const })),
      ]);
      if (!quiet) {
        if (plan.duplicates > 0) push(DUPLICATE_VIDEO, 'info');
        if (plan.overLimit > 0) push(queueLimitMessage(configRef.current.maxItemsPerJob), 'info');
      }
      dispatch({ type: 'setInputError', message: plan.invalid.length ? invalidLinesMessage(plan.invalid.length) : null });
      return {
        invalid: plan.invalid,
        videos: plan.items.length,
        playlists: plan.playlists.length,
        duplicates: plan.duplicates,
        overLimit: plan.overLimit,
      };
    },
    [push, scheduleResolve],
  );

  // Arranque: /api/config, preferencias y URLs guardadas.

  const booted = useRef(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const storage = browserStorage();
    const prefs = loadPrefs(storage);
    if (prefs) dispatch({ type: 'setOptions', options: prefs });
    const ctrl = new AbortController();
    api
      .config(ctrl.signal)
      .then((c) => setConfig(c))
      .catch(() => undefined) // defaults compilados
      .finally(() => {
        const urls = loadUrls(storage);
        if (urls.length) addLines(urls, { quiet: true });
        loaded.current = true;
      });
  }, [addLines]);

  const urlsKey = useMemo(() => toUrls(state).join('\n'), [state]);
  useEffect(() => {
    // no se pisa lo guardado antes de haberlo cargado
    if (!loaded.current) return;
    const t = setTimeout(() => saveUrls(browserStorage(), urlsKey ? urlsKey.split('\n') : []), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [urlsKey]);

  useEffect(() => {
    const t = setTimeout(() => savePrefs(browserStorage(), state.options), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.options]);

  // Turnstile (solo si /api/config lo activa y hay site key).

  const turnstileEl = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileHandle | null>(null);
  const turnstileOn = config.turnstile && Boolean(TURNSTILE_SITE_KEY);
  useEffect(() => {
    if (!turnstileOn || !turnstileEl.current) return;
    const h = createTurnstile(turnstileEl.current, TURNSTILE_SITE_KEY);
    turnstile.current = h;
    return () => {
      h.destroy();
      turnstile.current = null;
    };
  }, [turnstileOn]);

  // Jobs: creación, SSE, descarga por iframe y watchdog.

  const runtimes = useRef(new Map<string, JobRuntime>());
  const creating = useRef(0);
  const waiting = useRef<string[][]>([]);
  const lastLiveAt = useRef(0);

  const finalize = useCallback((jobId: string, removeNow = false) => {
    const rt = runtimes.current.get(jobId);
    if (!rt || rt.finalized) return;
    rt.finalized = true;
    if (rt.watchdog) clearTimeout(rt.watchdog);
    rt.events?.close();
    if (rt.download) {
      if (removeNow) rt.download.removeNow();
      else rt.download.removeLater(60_000);
    }
  }, []);

  const onWatchdog = useCallback(
    async (jobId: string) => {
      const rt = runtimes.current.get(jobId);
      if (!rt || rt.finalized || rt.seenProgress) return;
      let code: ErrorCode | null = null;
      let details: unknown;
      let text: string;
      try {
        const snap = await api.job(jobId);
        if (rt.finalized || rt.seenProgress) return;
        const rej = snap.lastReject;
        const dispatchedAt = rt.dispatchAt ?? 0;
        if (rej && Date.parse(rej.at) >= dispatchedAt - 1000) {
          code = toErrorCode(rej.code);
          details = rej.details;
          text = msg(code, details);
        } else if (snap.overall.active || (!rej && rt.download && !rt.download.withActivation && !rt.download.first)) {
          code = 'DOWNLOAD_BLOCKED';
          text = msg(code);
        } else {
          code = 'UNKNOWN';
          text = DOWNLOAD_START_FAILED;
        }
      } catch (err) {
        if (rt.finalized || rt.seenProgress) return;
        code = err instanceof ApiError && err.code === 'JOB_NOT_FOUND' ? 'JOB_NOT_FOUND' : 'UNKNOWN';
        text = code === 'JOB_NOT_FOUND' ? msg(code) : DOWNLOAD_START_FAILED;
      }
      dispatch({ type: 'jobEnded', jobId, code, details });
      push(text);
      finalize(jobId, true);
    },
    [finalize, msg, push],
  );

  const startDownload = useCallback(
    (jobId: string) => {
      const rt = runtimes.current.get(jobId);
      if (!rt || rt.download || rt.finalized) return;
      const d = dispatchDownload(rt.url);
      rt.download = d;
      rt.dispatchAt = Date.now();
      dispatch({ type: 'downloadDispatched', jobId, at: rt.dispatchAt, withActivation: d.withActivation, first: d.first });
      rt.watchdog = setTimeout(() => void onWatchdog(jobId), WATCHDOG_MS);
    },
    [onWatchdog],
  );

  const handleEvent = useCallback(
    (jobId: string, ev: JobStreamEvent) => {
      const rt = runtimes.current.get(jobId);
      if (!rt) return;
      dispatch({ type: 'jobEvent', jobId, event: ev });
      if (ev.type === 'snapshot') {
        startDownload(jobId);
        return;
      }
      if (ev.type === 'item') {
        if (['queued', 'fetching', 'downloading', 'converting', 'done'].includes(ev.data.item.status)) {
          rt.seenProgress = true;
          lastLiveAt.current = Date.now();
          if (rt.watchdog) {
            clearTimeout(rt.watchdog);
            rt.watchdog = null;
          }
        }
        return;
      }
      if (ev.type === 'rejected') {
        const r: Reject = ev.data;
        const code = toErrorCode(r.code);
        push(msg(code, r.details));
        if (!rt.seenProgress) {
          if (rt.watchdog) clearTimeout(rt.watchdog);
          rt.watchdog = null;
          rt.download?.removeNow();
        }
      }
    },
    [msg, push, startDownload],
  );

  const pump = useRef<() => void>(() => undefined);

  const runJob = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      if (activeJobIds(stateRef.current).filter((id) => !runtimes.current.get(id)?.finalized).length + creating.current >= MAX_ACTIVE_JOBS) {
        waiting.current.push(keys);
        dispatch({ type: 'markWaiting', keys });
        return;
      }
      const s = stateRef.current;
      const rows = keys.map((k) => s.items.find((i) => i.key === k)).filter((i) => i !== undefined);
      if (rows.length === 0) return;
      const { format, quality } = s.options;
      creating.current++;
      try {
        let turnstileToken: string | undefined;
        if (turnstile.current) {
          try {
            turnstileToken = await turnstile.current.getToken();
          } catch {
            dispatch({ type: 'jobFailed', keys, code: 'CAPTCHA_FAILED' });
            push(msg('CAPTCHA_FAILED'));
            return;
          }
        }
        const job = await api.createJob({
          items: rows.map((r) => ({ videoId: r.videoId })),
          format,
          ...(quality !== null ? { quality } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
        });
        const target = downloadTarget(job, API_URL);
        const rowKeys = rows.map((r) => r.key);
        dispatch({ type: 'jobCreated', job, keys: rowKeys, mode: target?.mode ?? 'file' });
        if (!target) return;
        const rt: JobRuntime = {
          events: null,
          download: null,
          watchdog: null,
          dispatchAt: null,
          seenProgress: false,
          url: target.url,
          finalized: false,
        };
        runtimes.current.set(job.jobId, rt);
        rt.events = openJobEvents(
          { url: eventsUrl(job.jobId), getJob: () => api.job(job.jobId) },
          {
            onEvent: (ev) => handleEvent(job.jobId, ev),
            onEnded: (code) => {
              dispatch({ type: 'jobEnded', jobId: job.jobId, code });
              finalize(job.jobId);
            },
            onConnectionLost: () => {
              push(CONNECTION_LOST);
              if (!rt.download) {
                dispatch({ type: 'jobEnded', jobId: job.jobId, code: 'NETWORK_ERROR' });
                finalize(job.jobId, true);
              }
            },
          },
        );
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        const code: ErrorCode = e?.code ?? 'UNKNOWN';
        if (code === 'NO_VALID_ITEMS' && Array.isArray(e?.details)) {
          const errors = (e.details as { error?: { code?: string } }[]).map((d, idx) => ({
            key: rows[idx]?.key ?? '',
            code: toErrorCode(d?.error?.code),
          }));
          dispatch({ type: 'rowErrors', errors: errors.filter((x) => x.key) });
        } else {
          dispatch({ type: 'jobFailed', keys, code, details: e?.details });
        }
        push(msg(code, e?.details));
      } finally {
        creating.current--;
        pump.current();
      }
    },
    [finalize, handleEvent, msg, push],
  );

  const pumpImpl = useCallback(() => {
    while (waiting.current.length > 0) {
      const active = activeJobIds(stateRef.current).filter((id) => !runtimes.current.get(id)?.finalized).length + creating.current;
      if (active >= MAX_ACTIVE_JOBS) return;
      const next = waiting.current.shift();
      if (next) void runJob(next);
    }
  }, [runJob]);
  useEffect(() => {
    pump.current = pumpImpl;
  }, [pumpImpl]);

  // Cierre de jobs terminados: quita el iframe a los 60 s, cierra SSE y libera turno local.
  useEffect(() => {
    let freed = false;
    for (const [jobId, rt] of runtimes.current) {
      if (rt.finalized) continue;
      const job = state.jobs[jobId];
      if (job && job.status === 'ended') {
        finalize(jobId, Boolean(job.rejectedCode) && !rt.seenProgress);
        freed = true;
      }
    }
    if (freed) pump.current();
  }, [state.jobs, finalize]);

  useEffect(() => {
    const map = runtimes.current;
    return () => {
      for (const id of map.keys()) finalize(id, true);
    };
  }, [finalize]);

  // Acciones de usuario

  const activeIds = activeJobIds(state);
  const hasActive = activeIds.length > 0 || state.items.some((i) => i.run === null && i.status === 'pending');
  const pending = pendingItems(state);
  const valid = validItems(state);
  const progress = globalProgress(state);

  const convert = () => {
    const list = pending.length > 0 ? pending : valid;
    void runJob(list.map((i) => i.key));
  };
  const cancel = () => {
    const queued = waiting.current.flat();
    waiting.current = [];
    if (queued.length) dispatch({ type: 'cancelWaiting', keys: queued });
    for (const id of activeJobIds(stateRef.current)) {
      api.cancel(id).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'JOB_NOT_FOUND') {
          dispatch({ type: 'jobEnded', jobId: id, code: 'JOB_NOT_FOUND' });
        } else {
          push(msg(err instanceof ApiError ? err.code : 'UNKNOWN'));
        }
      });
    }
  };
  const zip = () => void runJob(valid.map((i) => i.key));
  const downloadRow = useCallback((key: string) => void runJob([key]), [runJob]);
  const removeRow = useCallback((key: string) => dispatch({ type: 'remove', key }), []);
  const addPlaylist = useCallback((listId: string) => void addLines([playlistUrl(listId)]), [addLines]);
  const clear = () => {
    dispatch({ type: 'clear' });
    push('Se vació la cola.', 'info', { label: 'Deshacer', run: () => dispatch({ type: 'undoClear' }) });
  };
  const setOptions = (o: Partial<Options>) => dispatch({ type: 'setOptions', options: o });

  // Región aria-live: solo cambios de estado, con throttle de 2 s.

  const doneCount = state.items.filter((i) => i.status === 'done').length;
  const lastDone = useRef(doneCount);
  const lastAnnounce = useRef(0);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (doneCount === lastDone.current) return;
    const increased = doneCount > lastDone.current;
    lastDone.current = doneCount;
    if (!increased) return;
    const s = stateRef.current;
    const text =
      progress.total > 1
        ? `${progress.done} de ${progress.total} listos`
        : `Video ${s.items.find((i) => i.status === 'done')?.title ?? ''} listo`.replace('  ', ' ');
    const wait = Math.max(0, ANNOUNCE_THROTTLE_MS - (Date.now() - lastAnnounce.current));
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      lastAnnounce.current = Date.now();
      setAnnouncement(text);
    }, wait);
  }, [doneCount, progress.done, progress.total]);

  const count = pending.length;
  const primary = hasActive ? (
    <button
      type="button"
      onClick={cancel}
      className="inline-flex min-h-11 items-center justify-center rounded-control border border-red-ink px-5 font-display text-base text-red-ink"
    >
      Cancelar
    </button>
  ) : (
    <button
      type="button"
      onClick={convert}
      disabled={valid.length === 0}
      className="inline-flex min-h-11 items-center justify-center rounded-control bg-red px-5 font-display text-base text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {count === 0 && valid.length > 0 ? 'Convertir todo de nuevo' : count > 1 ? `Convertir ${count}` : 'Convertir'}
    </button>
  );

  const single = state.items.length === 1 ? state.items[0] : undefined;
  const canZip = valid.length >= 2 && !hasActive;

  // Ctrl/Cmd+Enter convierte (o cancela) desde cualquier parte.
  const primaryAction = useRef<() => void>(() => undefined);
  useEffect(() => {
    primaryAction.current = () => {
      if (hasActive) return;
      if (valid.length > 0) convert();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        primaryAction.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const addExample = () => void addLines(['https://www.youtube.com/watch?v=jNQXAC9IVRw']);

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-6 pb-36 sm:px-6 lg:pt-10 lg:pb-12">
        <div className="hero">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
            <h1 className="font-display hero-title">Convierte links de YouTube</h1>
            <p className="max-w-[46ch] pb-1 text-ink-muted">
              Videos y playlists a MP3, M4A, WAV o MP4. Varios a la vez, con el progreso de cada uno en vivo.
            </p>
          </div>
          <div className="mt-5">
            <CommandBar onSubmit={(lines) => addLines(lines)} error={state.inputError} />
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-1">
            <OutputRack
              options={state.options}
              config={config}
              items={state.items}
              singleQualities={single?.qualities ?? null}
              onChange={setOptions}
            >
              <div className="mt-5 hidden flex-wrap gap-3 lg:flex">
                {primary}
                {canZip ? (
                  <button
                    type="button"
                    onClick={zip}
                    className="inline-flex min-h-11 items-center rounded-control border border-edge px-5 text-base font-medium text-ink hover:bg-bg"
                  >
                    Descargar todo (ZIP)
                  </button>
                ) : null}
              </div>
              <p className="mt-4 text-sm text-ink-muted">
                Convierte solo contenido que te pertenezca o que tengas permiso para descargar.
              </p>
              {turnstileOn ? <div ref={turnstileEl} className="mt-4" /> : null}
            </OutputRack>
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 lg:row-start-1">
            <MasterBar progress={progress} primary={primary} showPrimaryOnDesktop={false} />
            <Queue
              state={state}
              options={state.options}
              messageCtx={messageCtx}
              maxPlaylistItems={config.maxPlaylistItems}
              canZip={canZip}
              onZip={zip}
              onClear={clear}
              onDownload={downloadRow}
              onRemove={removeRow}
              onAddPlaylist={addPlaylist}
              onExample={addExample}
            />
          </div>
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}