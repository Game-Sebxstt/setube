import { afterEach, describe, expect, it } from 'vitest';
import {
  INITIAL_PLAYER_STATE,
  type PlayerState,
  type Track,
  canPreview,
  codecFor,
  createPlayer,
  neighbors,
  playerReducer,
  shouldHandleSpace,
} from '../src/lib/player';
import type { QueueItem } from '../src/lib/queue';
import { AUDIO_TYPES, FakeMedia, asAudio, flush } from './helpers/fake-media';

const track = (key: string, extra: Partial<Track> = {}): Track => ({
  key,
  videoId: `vid${key}`.padEnd(11, 'x'),
  title: `Pista ${key}`,
  author: null,
  thumbnail: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
  duration: 120,
  preview: { aac: true, opus: true },
  video: false,
  ...extra,
});

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

describe('playerReducer (modo audio)', () => {
  const loaded = (): PlayerState => playerReducer(INITIAL_PLAYER_STATE, { type: 'load', track: track('a'), codec: 'aac' });

  it('load deja la pista en carga con el códec', () => {
    const s = loaded();
    expect(s.track?.key).toBe('a');
    expect(s.codec).toBe('aac');
    expect(s.status).toBe('loading');
    expect(s.error).toBeNull();
  });

  it('status sin pista o repetido no cambia el estado', () => {
    expect(playerReducer(INITIAL_PLAYER_STATE, { type: 'status', status: 'playing' })).toBe(INITIAL_PLAYER_STATE);
    const s = playerReducer(loaded(), { type: 'status', status: 'playing' });
    expect(playerReducer(s, { type: 'status', status: 'playing' })).toBe(s);
  });

  it('un pause tardío no pisa ended ni error, y buffering no pisa una pausa', () => {
    const ended = playerReducer(loaded(), { type: 'status', status: 'ended' });
    expect(playerReducer(ended, { type: 'status', status: 'paused' })).toBe(ended);
    const failed = playerReducer(loaded(), { type: 'fail', code: 'PLAYER_ERROR' });
    expect(playerReducer(failed, { type: 'status', status: 'paused' })).toBe(failed);
    const paused = playerReducer(loaded(), { type: 'status', status: 'paused' });
    expect(playerReducer(paused, { type: 'status', status: 'buffering' })).toBe(paused);
  });

  it('fail guarda el código y close vuelve a idle', () => {
    const failed = playerReducer(loaded(), { type: 'fail', code: 'TOO_MANY_PREVIEWS' });
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('TOO_MANY_PREVIEWS');
    const closed = playerReducer(failed, { type: 'close' });
    expect(closed.track).toBeNull();
    expect(closed.status).toBe('idle');
    expect(closed.codec).toBeNull();
    expect(closed.error).toBeNull();
    expect(playerReducer(closed, { type: 'close' })).toBe(closed);
  });

  it('volume y nav iguales devuelven el mismo estado', () => {
    const s = loaded();
    expect(playerReducer(s, { type: 'volume', volume: 1, muted: false })).toBe(s);
    expect(playerReducer(s, { type: 'nav', nav: { prev: false, next: false } })).toBe(s);
    expect(playerReducer(s, { type: 'volume', volume: 0.4, muted: true }).volume).toBe(0.4);
  });
});

describe('ayudas del reproductor', () => {
  it('codecFor prefiere AAC y cae a Opus', () => {
    expect(codecFor({ aac: true, opus: true }, { aac: true, opus: true })).toBe('aac');
    expect(codecFor({ aac: true, opus: true }, { aac: false, opus: true })).toBe('opus');
    expect(codecFor({ aac: false, opus: true }, { aac: true, opus: false })).toBeNull();
    expect(codecFor(null, { aac: true, opus: true })).toBeNull();
  });

  it('canPreview exige metadata completa, duración en el límite y un códec', () => {
    const caps = { aac: true, opus: false };
    expect(canPreview(item(), 3600, caps)).toBe(true);
    expect(canPreview(item({ meta: 'quick' }), 3600, caps)).toBe(false);
    expect(canPreview(item({ duration: 4000 }), 3600, caps)).toBe(false);
    expect(canPreview(item({ duration: null }), 3600, caps)).toBe(false);
    expect(canPreview(item({ preview: { aac: false, opus: true } }), 3600, caps)).toBe(false);
  });

  it('neighbors da la anterior y la siguiente', () => {
    const list = [track('a'), track('b'), track('c')];
    expect(neighbors(list, 'b').prev?.key).toBe('a');
    expect(neighbors(list, 'b').next?.key).toBe('c');
    expect(neighbors(list, 'z')).toEqual({ prev: null, next: null });
    expect(neighbors(list, null)).toEqual({ prev: null, next: null });
  });

  it('shouldHandleSpace sin DOM deja pasar la tecla', () => {
    expect(shouldHandleSpace(null)).toBe(true);
  });
});

describe('motor en modo audio', () => {
  let detach: (() => void) | null = null;
  afterEach(() => {
    detach?.();
    detach = null;
  });

  const setup = () => {
    const audio = new FakeMedia(AUDIO_TYPES);
    const p = createPlayer();
    detach = p.attach(asAudio(audio));
    return { p, audio };
  };

  it('attach detecta códecs y control de volumen', () => {
    const { p } = setup();
    expect(p.getState().caps).toEqual({ aac: true, opus: true });
    expect(p.getState().volumeControl).toBe(true);
  });

  it('toggle carga el audio con sid y pausa en el segundo toggle', async () => {
    const { p, audio } = setup();
    const t = track('a');
    p.toggle(t);
    expect(audio.src).toMatch(/\/api\/videos\/vidaxxxxxxx\/audio\?codec=aac&sid=[0-9a-f]{32}$/);
    expect(audio.playCalls).toBe(1);
    expect(p.getState().status).toBe('loading');
    audio.fire('playing');
    expect(p.getState().status).toBe('playing');
    p.toggle(t);
    expect(audio.paused).toBe(true);
    expect(p.getState().status).toBe('paused');
    await flush();
  });

  it('un salto antes de la cabecera se aplica en loadedmetadata', () => {
    const { p, audio } = setup();
    p.toggle(track('a'));
    p.seek(42);
    expect(audio.currentTime).toBe(0);
    expect(p.getTime().current).toBe(0);
    audio.meta(120);
    expect(audio.currentTime).toBe(42);
  });

  it('un error de red recarga la misma URL y retoma en el último segundo', () => {
    const { p, audio } = setup();
    p.toggle(track('a'));
    audio.meta(120);
    audio.fire('playing');
    audio.tick(30);
    const src = audio.src;
    audio.src = '';
    audio.fail(2);
    expect(audio.src).toBe(src);
    expect(p.getState().status).toBe('loading');
    audio.error = null;
    audio.meta(120);
    expect(audio.currentTime).toBe(30);
  });

  it('NotAllowedError deja la pista en pausa', async () => {
    const { p, audio } = setup();
    audio.playReject = 'NotAllowedError';
    p.toggle(track('a'));
    await flush();
    expect(p.getState().status).toBe('paused');
  });

  it('step recorre la cola y close vacía el elemento', () => {
    const { p, audio } = setup();
    const list = [track('a'), track('b')];
    p.setQueue(list);
    p.toggle(list[0]!);
    expect(p.getState().nav).toEqual({ prev: false, next: true });
    p.step(1);
    expect(p.getState().track?.key).toBe('b');
    expect(audio.src).toContain('/vidbxxxxxxx/');
    p.close();
    expect(p.getState().track).toBeNull();
    expect(audio.src).toBe('');
    expect(audio.loadCalls).toBeGreaterThan(0);
  });

  it('setVolume guarda el valor y quita el silencio', () => {
    const { p, audio } = setup();
    audio.muted = true;
    p.setVolume(0.3);
    expect(audio.volume).toBe(0.3);
    expect(audio.muted).toBe(false);
  });
});
