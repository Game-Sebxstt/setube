import type { ItemEventName, JobSnapshot, JobStreamEvent, Overall, Reject, ServerItemStatus, SnapshotItem } from './contract';
import { ApiError } from './api';

const ITEM_EVENTS: readonly ItemEventName[] = ['queued', 'fetching', 'downloading', 'converting', 'done', 'error', 'canceled'];
const TERMINAL: readonly ServerItemStatus[] = ['done', 'error', 'canceled'];
const BACKOFF_MS = [1000, 2000, 4000];
const CONNECTING_TIMEOUT_MS = 30_000;

export interface JobEventsHandlers {
  onEvent(event: JobStreamEvent): void;
  /** El job dejó de existir (404 o `expired`). */
  onEnded(code: 'JOB_NOT_FOUND'): void;
  /** 30 s sin poder reconectar, o reintentos agotados. */
  onConnectionLost(): void;
}

export interface JobEventsDeps {
  url: string;
  getJob: () => Promise<JobSnapshot>;
  EventSourceCtor?: typeof EventSource;
}

export interface JobEventsHandle {
  close(): void;
}

function parse<T>(e: MessageEvent): T | null {
  try {
    return JSON.parse(String(e.data)) as T;
  } catch {
    return null;
  }
}

export function openJobEvents(deps: JobEventsDeps, h: JobEventsHandlers): JobEventsHandle {
  const ES = deps.EventSourceCtor ?? EventSource;
  const statuses = new Map<string, ServerItemStatus>();
  let es: EventSource | null = null;
  let closed = false;
  let reopenCount = 0;
  let connectingTimer: ReturnType<typeof setTimeout> | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConnecting = () => {
    if (connectingTimer) clearTimeout(connectingTimer);
    connectingTimer = null;
  };
  const close = () => {
    closed = true;
    clearConnecting();
    if (reopenTimer) clearTimeout(reopenTimer);
    es?.close();
    es = null;
  };
  const maybeFinish = () => {
    if (statuses.size > 0 && [...statuses.values()].every((s) => TERMINAL.includes(s))) close();
  };
  const emit = (ev: JobStreamEvent) => {
    if (closed) return;
    h.onEvent(ev);
  };

  const connect = () => {
    if (closed) return;
    const src = new ES(deps.url);
    es = src;
    src.onopen = () => {
      clearConnecting();
      reopenCount = 0;
    };
    src.addEventListener('snapshot', (e) => {
      const data = parse<JobSnapshot>(e as MessageEvent);
      if (!data) return;
      statuses.clear();
      for (const it of data.items) statuses.set(it.itemId, it.status);
      emit({ type: 'snapshot', data });
      if (data.status === 'canceled') close();
      else maybeFinish();
    });
    for (const name of ITEM_EVENTS) {
      src.addEventListener(name, (e) => {
        const data = parse<{ item?: SnapshotItem; jobId?: string; overall: Overall }>(e as MessageEvent);
        if (!data) return;
        if (name === 'canceled' && !data.item && data.jobId) {
          emit({ type: 'job-canceled', data: { jobId: data.jobId, overall: data.overall } });
          close();
          return;
        }
        if (!data.item) return;
        statuses.set(data.item.itemId, data.item.status);
        emit({ type: 'item', name, data: { item: data.item, overall: data.overall } });
        maybeFinish();
      });
    }
    src.addEventListener('rejected', (e) => {
      const data = parse<Reject>(e as MessageEvent);
      if (data) emit({ type: 'rejected', data });
    });
    src.addEventListener('expired', () => {
      emit({ type: 'expired' });
      close();
      h.onEnded('JOB_NOT_FOUND');
    });
    // server-restart: no se hace nada, EventSource reconecta solo
    src.onerror = () => {
      if (closed) return;
      if (src.readyState === ES.CLOSED) {
        clearConnecting();
        void recover();
      } else if (!connectingTimer) {
        connectingTimer = setTimeout(() => {
          connectingTimer = null;
          if (!closed) h.onConnectionLost();
        }, CONNECTING_TIMEOUT_MS);
      }
    };
  };

  const recover = async () => {
    es?.close();
    es = null;
    try {
      await deps.getJob();
    } catch (err) {
      if (closed) return;
      if (err instanceof ApiError && err.code === 'JOB_NOT_FOUND') {
        close();
        h.onEnded('JOB_NOT_FOUND');
        return;
      }
    }
    if (closed) return;
    const delay = BACKOFF_MS[reopenCount];
    if (delay === undefined) {
      close();
      h.onConnectionLost();
      return;
    }
    reopenCount++;
    reopenTimer = setTimeout(connect, delay);
  };

  connect();
  return { close };
}
