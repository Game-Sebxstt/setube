import { describe, expect, it } from 'vitest';
import type { CreatedJob, Overall, SnapshotItem } from '../src/lib/contract';
import { messageFor } from '../src/lib/messages';
import {
  type Action,
  type State,
  canConvert,
  globalProgress,
  initialState,
  isBusy,
  pendingItems,
  planLinks,
  reducer,
} from '../src/lib/queue';

const IDS = ['jNQXAC9IVRw', 'dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk'];
const JOB = '3f1c2a9e-6b1d-4d55-9a3c-2b7e0c9d1e4f';
const OVERALL: Overall = { pct: 0, done: 0, failed: 0, total: 1, active: true };

function keyGen() {
  let n = 0;
  return () => `k${n++}`;
}

function run(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

function withLinks(urls: string[], state = initialState()): State {
  const plan = planLinks(state, urls, 50, keyGen());
  return reducer(state, { type: 'addLinks', items: plan.items, playlists: plan.playlists });
}

function created(items: { itemId: string; videoId: string; status?: 'pending' | 'error'; code?: string }[]): CreatedJob {
  return {
    jobId: JOB,
    format: 'mp3',
    quality: 192,
    expiresAt: new Date().toISOString(),
    items: items.map((i) => ({
      itemId: i.itemId,
      videoId: i.videoId,
      title: null,
      duration: null,
      status: i.status ?? 'pending',
      ...(i.status === 'error' ? { error: { code: i.code ?? 'LIMIT_DURATION', message: 'x' }, errorKind: 'validation' as const } : {}),
    })),
  };
}

function srvItem(p: Partial<SnapshotItem> & { itemId: string; videoId: string }): SnapshotItem {
  return {
    title: null,
    duration: null,
    durationVerified: true,
    status: 'downloading',
    pct: 0,
    speedBps: null,
    etaSec: null,
    position: null,
    bytesSent: 0,
    attempt: 1,
    ...p,
  };
}

function itemEvent(item: SnapshotItem): Action {
  return { type: 'jobEvent', jobId: JOB, event: { type: 'item', name: item.status as 'downloading', data: { item, overall: OVERALL } } };
}

/** Cola con N videos y un job creado sobre todos. */
function jobState(n: number, opts: { withActivation?: boolean } = {}): State {
  let s = withLinks(IDS.slice(0, n).map((id) => `https://youtu.be/${id}`));
  const keys = s.items.map((i) => i.key);
  s = reducer(s, {
    type: 'jobCreated',
    job: created(s.items.map((i, idx) => ({ itemId: `i${idx}`, videoId: i.videoId }))),
    keys,
    mode: n === 1 ? 'file' : 'archive',
  });
  return reducer(s, { type: 'downloadDispatched', jobId: JOB, at: 1000, withActivation: opts.withActivation ?? true, first: false });
}

describe('queue: entrada', () => {
  it('agregar crea filas con miniatura local, sin red', () => {
    const s = withLinks(['https://www.youtube.com/watch?v=jNQXAC9IVRw']);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      videoId: 'jNQXAC9IVRw',
      thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg',
      meta: 'local',
      status: 'idle',
    });
  });

  it('deduplica por videoId (también contra la cola existente) y reporta inválidas', () => {
    const s0 = withLinks(['https://youtu.be/jNQXAC9IVRw']);
    const plan = planLinks(
      s0,
      ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://youtu.be/dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ', 'hola', 'https://evil.com/x'],
      50,
      keyGen(),
    );
    expect(plan.items.map((i) => i.videoId)).toEqual(['dQw4w9WgXcQ']);
    expect(plan.duplicates).toBe(2);
    expect(plan.invalid).toEqual(['hola', 'https://evil.com/x']);
  });

  it('respeta el tope de items', () => {
    const plan = planLinks(initialState(), IDS.map((id) => `https://youtu.be/${id}`), 2, keyGen());
    expect(plan.items).toHaveLength(2);
    expect(plan.overLimit).toBe(2);
  });

  it('las playlists crean una tarjeta y sus videos entran al resolverse', () => {
    let s = withLinks(['https://www.youtube.com/playlist?list=PL1234567890']);
    expect(s.playlists).toHaveLength(1);
    expect(s.items).toHaveLength(0);
    const card = s.playlists[0]!;
    s = reducer(s, {
      type: 'playlistLoaded',
      key: card.key,
      maxItems: 50,
      keys: ['p0', 'p1'],
      result: {
        playlistId: 'PL1234567890',
        title: 'Mi lista',
        thumbnail: null,
        author: null,
        count: 2,
        truncated: false,
        skipped: 0,
        items: [
          { videoId: IDS[0]!, title: 'A', duration: 19, thumbnail: '' },
          { videoId: IDS[1]!, title: 'B', duration: 212, thumbnail: '' },
        ],
      },
    });
    expect(s.items.map((i) => i.title)).toEqual(['A', 'B']);
    expect(s.items[0]?.origin).toEqual({ playlistId: 'PL1234567890', title: 'Mi lista' });
    expect(s.playlists[0]).toMatchObject({ status: 'ready', count: 2 });
  });

  it('watch?v=X&list=Y entra como video con listId', () => {
    const s = withLinks(['https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1234567890']);
    expect(s.items[0]).toMatchObject({ videoId: 'jNQXAC9IVRw', listId: 'PL1234567890' });
  });

  it('clear y undoClear', () => {
    const s0 = withLinks(IDS.slice(0, 2).map((id) => `https://youtu.be/${id}`));
    const s1 = reducer(s0, { type: 'clear' });
    expect(s1.items).toHaveLength(0);
    const s2 = reducer(s1, { type: 'undoClear' });
    expect(s2.items.map((i) => i.videoId)).toEqual(IDS.slice(0, 2));
    expect(s2.cleared).toBeNull();
  });
});

describe('queue: opciones y pendientes', () => {
  it('normaliza calidad al cambiar formato', () => {
    let s = initialState();
    s = reducer(s, { type: 'setOptions', options: { kind: 'video' } });
    expect(s.options).toEqual({ kind: 'video', format: 'mp4', quality: 720 });
    s = reducer(s, { type: 'setOptions', options: { kind: 'audio', format: 'm4a' } });
    expect(s.options).toEqual({ kind: 'audio', format: 'm4a', quality: null });
  });

  it('pendientes según opciones: un item listo en mp3 192 vuelve a ser pendiente en wav', () => {
    let s = jobState(1);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'done', pct: 100 })));
    expect(s.items[0]?.lastSuccess).toEqual({ format: 'mp3', quality: 192 });
    expect(pendingItems(s)).toHaveLength(0);
    expect(canConvert(s)).toBe(false);
    s = reducer(s, { type: 'setOptions', options: { format: 'wav' } });
    expect(pendingItems(s)).toHaveLength(1);
  });

  it('un video con error definitivo de metadata no es pendiente', () => {
    let s = withLinks(['https://youtu.be/jNQXAC9IVRw']);
    s = reducer(s, { type: 'videoMetaError', videoId: 'jNQXAC9IVRw', code: 'PRIVATE_VIDEO' });
    expect(pendingItems(s)).toHaveLength(0);
    // un error transitorio no lo invalida
    let t = withLinks(['https://youtu.be/jNQXAC9IVRw']);
    t = reducer(t, { type: 'videoMetaError', videoId: 'jNQXAC9IVRw', code: 'UPSTREAM_TIMEOUT' });
    expect(pendingItems(t)).toHaveLength(1);
  });
});

describe('queue: eventos SSE', () => {
  it('jobCreated marca los errores de validación de la respuesta desde el principio', () => {
    let s = withLinks(IDS.slice(0, 2).map((id) => `https://youtu.be/${id}`));
    s = reducer(s, {
      type: 'jobCreated',
      job: created([
        { itemId: 'i0', videoId: IDS[0]!, status: 'error', code: 'LIMIT_DURATION' },
        { itemId: 'i1', videoId: IDS[1]! },
      ]),
      keys: s.items.map((i) => i.key),
      mode: 'file',
    });
    expect(s.items[0]).toMatchObject({ status: 'error', error: 'LIMIT_DURATION' });
    expect(s.items[1]).toMatchObject({ status: 'pending', run: { jobId: JOB, itemId: 'i1' } });
    expect(isBusy(s, s.items[1]!.key)).toBe(true);
  });

  it('eventos de estado actualizan la fila y el progreso global', () => {
    let s = jobState(2);
    s = run(
      s,
      itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'downloading', pct: 40, speedBps: 2_400_000 })),
      itemEvent(srvItem({ itemId: 'i1', videoId: IDS[1]!, status: 'queued', pct: 0, position: 3 })),
    );
    expect(s.items[0]).toMatchObject({ status: 'downloading', pct: 40, speedBps: 2_400_000 });
    expect(s.items[1]).toMatchObject({ status: 'queued', position: 3 });
    expect(globalProgress(s).pct).toBe(20);
    expect(s.jobs[JOB]?.seenProgress).toBe(true);
  });

  it('pct menor se ignora con el mismo attempt y se acepta con attempt mayor', () => {
    let s = jobState(1);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, pct: 60, attempt: 1 })));
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, pct: 30, attempt: 1, status: 'converting' })));
    expect(s.items[0]).toMatchObject({ pct: 60, status: 'converting' });
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, pct: 5, attempt: 2, status: 'fetching' })));
    expect(s.items[0]).toMatchObject({ pct: 5, attempt: 2 });
    // un evento de un intento anterior se ignora
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, pct: 90, attempt: 1 })));
    expect(s.items[0]).toMatchObject({ pct: 5, attempt: 2, status: 'fetching' });
  });

  it('done cierra el job', () => {
    let s = jobState(1);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'done', pct: 100 })));
    expect(s.items[0]?.status).toBe('done');
    expect(s.jobs[JOB]?.status).toBe('ended');
    expect(isBusy(s, s.items[0]!.key)).toBe(false);
  });

  it('rejected antes de ver progreso marca todas las filas del job', () => {
    let s = jobState(2);
    s = reducer(s, {
      type: 'jobEvent',
      jobId: JOB,
      event: { type: 'rejected', data: { code: 'TOO_MANY_STREAMS', message: 'x', at: new Date().toISOString() } },
    });
    expect(s.items.map((i) => i.error)).toEqual(['TOO_MANY_STREAMS', 'TOO_MANY_STREAMS']);
    expect(s.jobs[JOB]?.status).toBe('ended');
  });

  it('rejected con itemId marca solo esa fila', () => {
    let s = jobState(2);
    s = reducer(s, {
      type: 'jobEvent',
      jobId: JOB,
      event: { type: 'rejected', data: { code: 'LIMIT_DURATION', message: 'x', at: '', itemId: 'i1' } },
    });
    expect(s.items[0]?.status).toBe('pending');
    expect(s.items[1]).toMatchObject({ status: 'error', error: 'LIMIT_DURATION' });
  });

  it('rejected después de ver progreso no toca las filas', () => {
    let s = jobState(1);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'downloading', pct: 10 })));
    const before = s.items;
    s = reducer(s, { type: 'jobEvent', jobId: JOB, event: { type: 'rejected', data: { code: 'JOB_BUSY', message: 'x', at: '' } } });
    expect(s.items).toBe(before);
    expect(s.jobs[JOB]?.status).toBe('active');
  });

  it('RATE_LIMITED sin details usa el copy de respaldo', () => {
    let s = jobState(1);
    s = reducer(s, { type: 'jobEvent', jobId: JOB, event: { type: 'rejected', data: { code: 'RATE_LIMITED', message: 'x', at: '' } } });
    const row = s.items[0]!;
    expect(row.error).toBe('RATE_LIMITED');
    expect(messageFor(row.error!, { details: row.errorDetails })).toBe('Demasiadas solicitudes. Espera un momento.');
  });

  it('expired → JOB_NOT_FOUND en los items no terminales', () => {
    let s = jobState(2);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'done', pct: 100 })));
    s = reducer(s, { type: 'jobEvent', jobId: JOB, event: { type: 'expired' } });
    expect(s.items[0]?.status).toBe('done');
    expect(s.items[1]).toMatchObject({ status: 'error', error: 'JOB_NOT_FOUND' });
    expect(s.jobs[JOB]?.status).toBe('ended');
  });

  it('DOWNLOAD_INTERRUPTED con < 64 KiB y sin activación → DOWNLOAD_BLOCKED', () => {
    let s = jobState(1, { withActivation: false });
    s = run(
      s,
      itemEvent(
        srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'error', bytesSent: 1000, error: { code: 'DOWNLOAD_INTERRUPTED', message: 'x' } }),
      ),
    );
    expect(s.items[0]?.error).toBe('DOWNLOAD_BLOCKED');
  });

  it('DOWNLOAD_INTERRUPTED con activación se mantiene', () => {
    let s = jobState(1, { withActivation: true });
    s = run(
      s,
      itemEvent(
        srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'error', bytesSent: 1000, error: { code: 'DOWNLOAD_INTERRUPTED', message: 'x' } }),
      ),
    );
    expect(s.items[0]?.error).toBe('DOWNLOAD_INTERRUPTED');
  });

  it('cancelación del job pasa las filas activas a canceladas', () => {
    let s = jobState(2);
    s = run(s, itemEvent(srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'done', pct: 100 })));
    s = reducer(s, { type: 'jobEvent', jobId: JOB, event: { type: 'job-canceled', data: { jobId: JOB, overall: OVERALL } } });
    expect(s.items.map((i) => i.status)).toEqual(['done', 'canceled']);
    expect(s.jobs[JOB]?.status).toBe('ended');
  });

  it('snapshot aplica el estado de todos los items', () => {
    let s = jobState(2);
    s = reducer(s, {
      type: 'jobEvent',
      jobId: JOB,
      event: {
        type: 'snapshot',
        data: {
          jobId: JOB,
          format: 'mp3',
          quality: 192,
          status: 'active',
          createdAt: '',
          expiresAt: '',
          seq: 4,
          overall: OVERALL,
          lastReject: null,
          items: [
            srvItem({ itemId: 'i0', videoId: IDS[0]!, status: 'converting', pct: 90 }),
            srvItem({ itemId: 'i1', videoId: IDS[1]!, status: 'pending', pct: 0, attempt: 0 }),
          ],
        },
      },
    });
    expect(s.items.map((i) => [i.status, i.pct])).toEqual([
      ['converting', 90],
      ['pending', 0],
    ]);
  });

  it('quitar está bloqueado mientras el item pertenece a un job activo', () => {
    const s = jobState(1);
    expect(reducer(s, { type: 'remove', key: s.items[0]!.key })).toBe(s);
  });
});
