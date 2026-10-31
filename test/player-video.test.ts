import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Player, type Track, canPreviewVideo, createPlayer, playerReducer, INITIAL_PLAYER_STATE } from '../src/lib/player';
import type { QueueItem } from '../src/lib/queue';
import { PLAYER_MODE_KEY } from '../src/lib/storage';
import {
  HLS_CONFIG,
  HLS_MIME,
  NO_VIDEO_CAPS,
  detectVideoCaps,
  openVideoSource,
  pickStartLevel,
  resetHlsForTests,
} from '../src/lib/video-source';
import { AUDIO_TYPES, FakeMedia, asAudio, asVideo, flush } from './helpers/fake-media';

type Handler = (event: string, data: unknown) => void;

const H = vi.hoisted(() => {
  class FakeHls {
    static supported = true;
    static instances: FakeHls[] = [];
    static isSupported() {
      return FakeHls.supported;
    }
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      FRAG_BUFFERED: 'hlsFragBuffered',
      ERROR: 'hlsError',
      MEDIA_ATTACHED: 'hlsMediaAttached',
    };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError', OTHER_ERROR: 'otherError' };
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError',
      MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeOut',
      MANIFEST_PARSING_ERROR: 'manifestParsingError',
      FRAG_LOAD_ERROR: 'fragLoadError',
      BUFFER_APPEND_ERROR: 'bufferAppendError',
    };
    readonly config: Record<string, unknown>;
    readonly handlers = new Map<string, Handler[]>();
    media: { src: string; removeAttribute(n: string): void } | null = null;
    url: string | null = null;
    levels: { height: number }[] = [];
    startLevel = -1;
    readonly startLoads: number[] = [];
    recoveries = 0;
    swaps = 0;
    destroyed = false;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      FakeHls.instances.push(this);
    }
    on(e: string, fn: Handler) {
      this.handlers.set(e, [...(this.handlers.get(e) ?? []), fn]);
    }
    once(e: string, fn: Handler) {
      const w: Handler = (ev, d) => {
        this.handlers.set(
          e,
          (this.handlers.get(e) ?? []).filter((h) => h !== w),
        );
        fn(ev, d);
      };
      this.on(e, w);
    }
    emit(e: string, data: unknown = {}) {
      for (const fn of this.handlers.get(e) ?? []) fn(e, data);
    }
    attachMedia(m: { src: string; removeAttribute(n: string): void }) {
      this.media = m;
      m.src = 'blob:fake-mediasource';
    }
    loadSource(u: string) {
      this.url = u;
    }
    startLoad(p = -1) {
      this.startLoads.push(p);
    }
    recoverMediaError() {
      this.recoveries++;
    }
    swapAudioCodec() {
      this.swaps++;
    }
    destroy() {
      this.destroyed = true;
      this.media?.removeAttribute('src');
    }
  }
  return { FakeHls };
});

vi.mock('hls.js', () => ({ default: H.FakeHls }));

const lastHls = () => {
  const h = H.FakeHls.instances.at(-1);
  if (!h) throw new Error('sin instancia de hls.js');
  return h;
};

const track = (key: string, extra: Partial<Track> = {}): Track => ({
  key,
  videoId: `vid${key}`.padEnd(11, 'x'),
  title: `Pista ${key}`,
  author: null,
  thumbnail: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
  duration: 120,
  preview: { aac: true, opus: true },
  video: true,
  ...extra,
});

function memoryStorage(init: Record<string, string> = {}) {
  const data: Record<string, string> = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? (data[k] as string) : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

let detach: (() => void) | null = null;
let local: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  resetHlsForTests();
  H.FakeHls.instances = [];
  H.FakeHls.supported = true;
  local = memoryStorage();
  vi.stubGlobal('MediaSource', { isTypeSupported: (t: string) => t.startsWith('video/mp4') });
  vi.stubGlobal('window', { localStorage: local, sessionStorage: memoryStorage() });
});

afterEach(() => {
  detach?.();
  detach = null;
  vi.unstubAllGlobals();
});

function setup(videoTypes: Record<string, string> = {}): { p: Player; audio: FakeMedia; video: FakeMedia } {
  const audio = new FakeMedia(AUDIO_TYPES);
  const video = new FakeMedia(videoTypes);
  const p = createPlayer();
  detach = p.attach(asAudio(audio), asVideo(video));
  return { p, audio, video };
}

describe('pickStartLevel', () => {
  const levels = [{ height: 360 }, { height: 720 }, { height: 1080 }];
  it('elige el más alto que cabe en el panel', () => {
    expect(pickStartLevel(levels, 800)).toBe(1);
    expect(pickStartLevel(levels, 1080)).toBe(2);
    expect(pickStartLevel(levels, 2160)).toBe(2);
  });
  it('si ninguno cabe, el más bajo; sin tamaño, lo decide hls.js', () => {
    expect(pickStartLevel(levels, 200)).toBe(0);
    expect(pickStartLevel(levels, null)).toBe(-1);
    expect(pickStartLevel(levels, 0)).toBe(-1);
    expect(pickStartLevel([], 720)).toBe(-1);
  });
  it('con dos variantes de la misma altura toma la última (más bitrate)', () => {
    expect(pickStartLevel([{ height: 360 }, { height: 720 }, { height: 720 }], 720)).toBe(2);
  });
});

describe('detectVideoCaps', () => {
  it('sin <video> no hay video', () => {
    expect(detectVideoCaps(null)).toEqual(NO_VIDEO_CAPS);
  });
  it('MSE por isTypeSupported y HLS nativo por canPlayType', () => {
    expect(detectVideoCaps(asVideo(new FakeMedia()))).toEqual({ mse: true, native: false });
    expect(detectVideoCaps(asVideo(new FakeMedia({ [HLS_MIME]: 'maybe' })))).toEqual({ mse: true, native: true });
  });
  it('prefiere ManagedMediaSource y sin MSE queda solo el nativo', () => {
    vi.stubGlobal('ManagedMediaSource', { isTypeSupported: () => false });
    expect(detectVideoCaps(asVideo(new FakeMedia({ [HLS_MIME]: 'maybe' })))).toEqual({ mse: false, native: true });
    vi.stubGlobal('ManagedMediaSource', undefined);
    vi.stubGlobal('MediaSource', undefined);
    expect(detectVideoCaps(asVideo(new FakeMedia()))).toEqual({ mse: false, native: false });
  });
});

describe('canPreviewVideo', () => {
  const item = (extra: Partial<QueueItem> = {}): QueueItem => ({
    key: 'k1',
    url: 'https://youtu.be/jNQXAC9IVRw',
    videoId: 'jNQXAC9IVRw',
    listId: null,
    origin: null,
    title: 'Me at the zoo',
    author: 'jawed',
    thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg',
    duration: 19,
    description: null,
    qualities: [240, 360],
    estimated: null,
    preview: { aac: true, opus: true },
    meta: 'full',
    run: null,
    status: 'idle',
    pct: 0,
    attempt: 0,
    speedBps: null,
    etaSec: null,
    position: null,
    ...extra,
  });
  const mse = { mse: true, native: false };

  it('exige calidades de video, AAC, duración en el límite y una vía de video', () => {
    expect(canPreviewVideo(item(), 3600, mse)).toBe(true);
    expect(canPreviewVideo(item(), 3600, { mse: false, native: true })).toBe(true);
    expect(canPreviewVideo(item(), 3600, NO_VIDEO_CAPS)).toBe(false);
    expect(canPreviewVideo(item({ qualities: [] }), 3600, mse)).toBe(false);
    expect(canPreviewVideo(item({ qualities: null }), 3600, mse)).toBe(false);
    expect(canPreviewVideo(item({ preview: { aac: false, opus: true } }), 3600, mse)).toBe(false);
    expect(canPreviewVideo(item({ duration: 4000 }), 3600, mse)).toBe(false);
    expect(canPreviewVideo(item({ meta: 'quick' }), 3600, mse)).toBe(false);
  });
});

describe('playerReducer (modos)', () => {
  const t = track('a');
  const loaded = playerReducer(INITIAL_PLAYER_STATE, { type: 'load', track: t, codec: 'aac', mode: 'video' });

  it('load fija el modo y limpia el aviso', () => {
    const withNotice = playerReducer(loaded, { type: 'notice', code: 'VIDEO_UNSUPPORTED' });
    expect(withNotice.notice).toBe('VIDEO_UNSUPPORTED');
    const again = playerReducer(withNotice, { type: 'load', track: t, codec: 'aac' });
    expect(again.mode).toBe('video');
    expect(again.notice).toBeNull();
  });

  it('mode cambia el modo y, si se pide, el estado (también desde error)', () => {
    const failed = playerReducer(loaded, { type: 'fail', code: 'PLAYER_ERROR' });
    const s = playerReducer(failed, { type: 'mode', mode: 'audio', status: 'paused' });
    expect(s.mode).toBe('audio');
    expect(s.status).toBe('paused');
    expect(s.error).toBeNull();
    expect(playerReducer(s, { type: 'mode', mode: 'audio' })).toBe(s);
  });

  it('sin pista el modo activo es siempre audio, y close vuelve a audio', () => {
    expect(playerReducer(INITIAL_PLAYER_STATE, { type: 'mode', mode: 'video' })).toBe(INITIAL_PLAYER_STATE);
    const closed = playerReducer(loaded, { type: 'close' });
    expect(closed.mode).toBe('audio');
    expect(closed.track).toBeNull();
  });

  it('prefer y notice repetidos devuelven el mismo estado', () => {
    const s = playerReducer(loaded, { type: 'prefer', mode: 'video' });
    expect(s.preferredMode).toBe('video');
    expect(playerReducer(s, { type: 'prefer', mode: 'video' })).toBe(s);
    expect(playerReducer(s, { type: 'notice', code: null })).toBe(s);
  });
});

describe('motor en modo video', () => {
  it('attach detecta MSE y lee el modo preferido', () => {
    local.data[PLAYER_MODE_KEY] = 'video';
    const { p } = setup();
    expect(p.getState().videoCaps).toEqual({ mse: true, native: false });
    expect(p.getState().preferredMode).toBe('video');
    expect(p.getState().mode).toBe('audio');
  });

  it('sin <video> conectado nunca entra en modo video', () => {
    const audio = new FakeMedia(AUDIO_TYPES);
    const p = createPlayer();
    detach = p.attach(asAudio(audio));
    p.toggle(track('a'), 'video');
    expect(p.getState().mode).toBe('audio');
    expect(audio.src).toContain('/audio?codec=aac');
  });

  it('«Ver video» carga hls.js con la configuración de partida y el master con el sid del reproductor', async () => {
    const { p, audio, video } = setup();
    p.toggle(track('a'), 'video');
    expect(p.getState().mode).toBe('video');
    expect(p.getState().status).toBe('loading');
    expect(audio.src).toBe('');
    await flush();
    const h = lastHls();
    expect(h.config).toMatchObject({ ...HLS_CONFIG, startPosition: -1 });
    expect(h.config.enableWorker).toBe(false);
    expect(h.url).toMatch(/\/api\/videos\/vidaxxxxxxx\/hls\/master\.m3u8\?sid=[0-9a-f]{32}$/);
    expect(video.src).toBe('blob:fake-mediasource');
    expect(video.playCalls).toBe(1);
    h.levels = [{ height: 360 }, { height: 720 }];
    h.emit('hlsManifestParsed');
    expect(h.startLoads).toEqual([-1]);
    expect(h.startLevel).toBe(-1);
    video.fire('playing');
    expect(p.getState().status).toBe('playing');
  });

  it('el sid del master es el mismo que el del audio', async () => {
    const { p, audio } = setup();
    p.toggle(track('a'));
    const audioSid = new URL(audio.src, 'http://x').searchParams.get('sid');
    p.setMode('video');
    await flush();
    expect(new URL(lastHls().url ?? '', 'http://x').searchParams.get('sid')).toBe(audioSid);
  });

  it('startLevel según el alto del panel en píxeles físicos', async () => {
    const { p, video } = setup();
    video.clientHeight = 270;
    vi.stubGlobal('devicePixelRatio', 2);
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    h.levels = [{ height: 360 }, { height: 480 }, { height: 720 }, { height: 1080 }];
    h.emit('hlsManifestParsed');
    expect(h.startLevel).toBe(1);
  });

  it('video → audio conserva el segundo y sigue sonando', async () => {
    const { p, audio, video } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    video.meta(120);
    video.fire('playing');
    video.tick(37);
    p.setMode('audio');
    expect(local.data[PLAYER_MODE_KEY]).toBe('audio');
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().status).toBe('loading');
    expect(h.destroyed).toBe(true);
    expect(video.src).toBe('');
    expect(video.loadCalls).toBeGreaterThan(0);
    expect(audio.src).toContain('/audio?codec=aac');
    expect(audio.playCalls).toBe(1);
    audio.meta(120);
    expect(audio.currentTime).toBe(37);
  });

  it('audio → video en pausa queda en pausa y hls.js arranca en el mismo segundo', async () => {
    const { p, audio, video } = setup();
    p.toggle(track('a'));
    audio.meta(120);
    audio.fire('playing');
    audio.tick(20);
    p.toggle(track('a'));
    expect(p.getState().status).toBe('paused');
    p.setMode('video');
    expect(local.data[PLAYER_MODE_KEY]).toBe('video');
    expect(p.getState().mode).toBe('video');
    expect(p.getState().status).toBe('paused');
    expect(audio.src).toBe('');
    await flush();
    const h = lastHls();
    expect(h.config.startPosition).toBe(20);
    expect(video.playCalls).toBe(0);
    h.emit('hlsManifestParsed');
    expect(h.startLoads).toEqual([20]);
    // el salto inicial lo hace hls.js, el motor no lo repite
    video.meta(120);
    expect(video.currentTime).toBe(0);
    expect(p.getTime().duration).toBe(120);
    p.toggle(track('a'));
    expect(video.playCalls).toBe(1);
    expect(p.getState().status).toBe('loading');
  });

  it('un salto mientras carga hls.js se aplica en loadedmetadata', async () => {
    const { p, video } = setup();
    p.toggle(track('a'), 'video');
    p.seek(80);
    await flush();
    video.meta(120);
    expect(video.currentTime).toBe(80);
  });

  it('los eventos del elemento inactivo no cuentan', async () => {
    const { p, audio } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    audio.fire('playing');
    audio.fail(2);
    expect(p.getState().status).toBe('loading');
    expect(audio.src).toBe('');
  });

  it('pausar mientras se carga hls.js evita que arranque', async () => {
    const { p, video } = setup();
    p.toggle(track('a'), 'video');
    p.toggle(track('a'));
    expect(p.getState().status).toBe('paused');
    await flush();
    expect(lastHls().url).not.toBeNull();
    expect(video.playCalls).toBe(0);
  });

  it('con hls.js ya cargado, la fuente y play() van en el mismo gesto', async () => {
    const { p, video } = setup();
    p.setQueue([track('a'), track('b')]);
    p.toggle(track('a'), 'video');
    await flush();
    expect(video.playCalls).toBe(1);
    p.step(1);
    expect(p.getState().track?.key).toBe('b');
    expect(p.getState().mode).toBe('video');
    expect(H.FakeHls.instances).toHaveLength(2);
    expect(H.FakeHls.instances[0]?.destroyed).toBe(true);
    expect(video.playCalls).toBe(2);
  });

  it('un error fatal de carga vuelve al audio en el mismo punto y avisa', async () => {
    const { p, audio, video } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    video.meta(120);
    video.fire('playing');
    video.tick(50);
    h.emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 422 } });
    expect(p.getState().mode).toBe('video');
    await flush();
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().notice).toBe('VIDEO_UNSUPPORTED');
    expect(p.getState().status).toBe('loading');
    expect(p.getState().preferredMode).toBe('audio');
    expect(h.destroyed).toBe(true);
    expect(audio.playCalls).toBe(1);
    audio.meta(120);
    expect(audio.currentTime).toBe(50);
    audio.fire('playing');
    expect(p.getState().notice).toBe('VIDEO_UNSUPPORTED');
  });

  it('un error de red en un segmento reintenta una vez antes de rendirse', async () => {
    const { p } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    h.emit('hlsError', { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 0 } });
    expect(h.startLoads).toEqual([-1]);
    h.emit('hlsFragBuffered');
    h.emit('hlsError', { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 0 } });
    expect(h.startLoads).toEqual([-1, -1]);
    h.emit('hlsError', { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 0 } });
    await flush();
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().notice).toBe('VIDEO_UNSUPPORTED');
  });

  it('un segmento con 404 o 502 de la API acaba en audio sin reintento', async () => {
    const { p } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    h.emit('hlsError', { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 404 } });
    await flush();
    expect(h.startLoads).toEqual([]);
    expect(p.getState().mode).toBe('audio');
  });

  it('errores de media: recoverMediaError, después swapAudioCodec y al tercero vuelve al audio', async () => {
    const { p, video } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    video.paused = false;
    const err = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };
    h.emit('hlsError', err);
    expect(h.recoveries).toBe(1);
    expect(h.swaps).toBe(0);
    // tras reunir el MediaSource vuelve a reproducir
    h.emit('hlsMediaAttached');
    expect(video.playCalls).toBe(2);
    h.emit('hlsError', err);
    expect(h.recoveries).toBe(2);
    expect(h.swaps).toBe(1);
    await flush();
    expect(p.getState().mode).toBe('video');
    h.emit('hlsError', err);
    await flush();
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().notice).toBe('VIDEO_UNSUPPORTED');
  });

  it('los errores no fatales se ignoran', async () => {
    const { p } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    lastHls().emit('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' });
    await flush();
    expect(p.getState().mode).toBe('video');
  });

  it('una pista sin video se reproduce en audio aunque se pida video', () => {
    const { p, audio } = setup();
    p.toggle(track('a', { video: false }), 'video');
    expect(p.getState().mode).toBe('audio');
    expect(audio.src).toContain('/audio?codec=aac');
  });

  it('la versión de la cola manda sobre la pista recibida', async () => {
    const { p } = setup();
    p.setQueue([track('a', { video: true })]);
    p.toggle(track('a', { video: false }), 'video');
    expect(p.getState().mode).toBe('video');
    expect(p.getState().track?.video).toBe(true);
    await flush();
  });

  it('el modo preferido se usa al cargar una pista nueva', async () => {
    const { p, video } = setup();
    p.setMode('video');
    expect(p.getState().preferredMode).toBe('video');
    expect(local.data[PLAYER_MODE_KEY]).toBe('video');
    p.toggle(track('a'));
    expect(p.getState().mode).toBe('video');
    await flush();
    expect(video.playCalls).toBe(1);
  });

  it('toggle(track, video) sobre la pista que suena en audio cambia de modo y reproduce', async () => {
    const { p, audio, video } = setup();
    p.toggle(track('a'));
    audio.meta(120);
    audio.tick(12);
    p.toggle(track('a'));
    p.toggle(track('a'), 'video');
    expect(p.getState().mode).toBe('video');
    expect(p.getState().status).toBe('loading');
    expect(p.getState().preferredMode).toBe('audio');
    await flush();
    expect(lastHls().config.startPosition).toBe(12);
    expect(video.playCalls).toBe(1);
    // en el mismo modo, toggle pausa
    p.toggle(track('a'), 'video');
    expect(p.getState().status).toBe('paused');
  });

  it('close en video destruye hls.js y vuelve a audio', async () => {
    const { p, video } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    const h = lastHls();
    p.close();
    expect(h.destroyed).toBe(true);
    expect(video.src).toBe('');
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().track).toBeNull();
  });

  it('retry en video vuelve a abrir el master en el último segundo', async () => {
    const { p, video } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    video.meta(120);
    video.tick(33);
    p.retry();
    await flush();
    expect(H.FakeHls.instances).toHaveLength(2);
    expect(lastHls().config.startPosition).toBe(33);
    expect(p.getState().mode).toBe('video');
  });

  it('volumen y silencio se aplican a los dos elementos', () => {
    const { p, audio, video } = setup();
    p.setVolume(0.4);
    expect(audio.volume).toBe(0.4);
    expect(video.volume).toBe(0.4);
    p.toggleMute();
    expect(audio.muted).toBe(true);
    expect(video.muted).toBe(true);
  });

  it('getMedia devuelve el elemento activo', async () => {
    const { p, audio, video } = setup();
    expect(p.getMedia()).toBe(asAudio(audio));
    p.toggle(track('a'), 'video');
    expect(p.getMedia()).toBe(asVideo(video));
    await flush();
  });
});

describe('openVideoSource sin hls.js', () => {
  it('sin MSE usa el HLS nativo con la misma URL', async () => {
    const video = new FakeMedia({ [HLS_MIME]: 'maybe' });
    const onFatal = vi.fn();
    const src = openVideoSource(asVideo(video), { mse: false, native: true }, {
      url: 'http://api/x/hls/master.m3u8?sid=1',
      startPosition: 0,
      targetHeight: null,
      onFatal,
    });
    expect(src.kind).toBe('native');
    expect(video.src).toBe('http://api/x/hls/master.m3u8?sid=1');
    await expect(src.ready).resolves.toBe(true);
    video.fail(4);
    await flush();
    expect(onFatal).toHaveBeenCalledWith('media');
    src.destroy();
    expect(video.src).toBe('');
  });

  it('con MSE pero hls.js sin soporte y sin nativo, falla de forma asíncrona', async () => {
    H.FakeHls.supported = false;
    const video = new FakeMedia();
    const onFatal = vi.fn();
    openVideoSource(asVideo(video), { mse: true, native: false }, { url: 'u', startPosition: 0, targetHeight: null, onFatal });
    expect(onFatal).not.toHaveBeenCalled();
    await flush();
    await flush();
    expect(onFatal).toHaveBeenCalledWith('unsupported');
  });

  it('el motor vuelve al audio si el navegador no tiene ninguna vía real', async () => {
    H.FakeHls.supported = false;
    const { p } = setup();
    p.toggle(track('a'), 'video');
    await flush();
    await flush();
    expect(p.getState().mode).toBe('audio');
    expect(p.getState().notice).toBe('VIDEO_UNSUPPORTED');
  });

  it('destroy antes de que cargue hls.js no crea la instancia', async () => {
    const video = new FakeMedia();
    const src = openVideoSource(asVideo(video), { mse: true, native: false }, {
      url: 'u',
      startPosition: 0,
      targetHeight: null,
      onFatal: () => undefined,
    });
    src.destroy();
    await expect(src.ready).resolves.toBe(false);
    expect(H.FakeHls.instances).toHaveLength(0);
  });
});
