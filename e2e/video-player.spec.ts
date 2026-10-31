import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, type Page, type Route, test as base, devices, expect } from '@playwright/test';
import type { PublicConfig, ResolveRequest, ResolveResult, VideoMeta } from '../src/lib/contract';
import { COMPILED_CONFIG } from '../src/lib/defaults';

// Video en streaming de extremo a extremo con la API simulada (sin YouTube ni la API real).
// Las fixtures de `e2e/fixtures/video/` son MP4 fragmentados con sidx como los de YouTube (360p y 720p avc1 y audio
// AAC, 10 s) y sus playlists, generados con el mismo código que la API. Cómo se regeneran: README.md de esa carpeta.
// Aquí se sirven `/api/config`, `/api/resolve`, `/api/videos/:id`, los playlists y `/media/:formatId` con Range.

const FIXTURES = new URL('./fixtures/video/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, FIXTURES));
const MEDIA: Record<string, { body: Buffer; type: string }> = {
  '134': { body: read('134.mp4'), type: 'video/mp4' },
  '136': { body: read('136.mp4'), type: 'video/mp4' },
  '140': { body: read('140.m4a'), type: 'audio/mp4' },
};
const PLAYLISTS: Record<string, string> = Object.fromEntries(
  ['master', '134', '136', '140'].map((n) => [n, read(`${n}.m3u8`).toString('utf8')]),
);
const VIDEO_FORMATS = new Set(['134', '136']);

/** Rangos del init (EXT-X-MAP) y de los segmentos (EXT-X-BYTERANGE) de un media playlist. */
function byteRanges(formatId: string): { init: string; segments: { start: number; end: number }[] } {
  const text = PLAYLISTS[formatId] as string;
  const map = /BYTERANGE="(\d+)@0"/.exec(text);
  const segments = [...text.matchAll(/#EXT-X-BYTERANGE:(\d+)@(\d+)/g)].map(([, size, offset]) => ({
    start: Number(offset),
    end: Number(offset) + Number(size) - 1,
  }));
  return { init: `bytes=0-${Number(map?.[1]) - 1}`, segments };
}
/** Primer byte del segundo segmento de cada variante: desde ahí se puede retener el video. */
const SECOND_SEGMENT_START = Object.fromEntries([...VIDEO_FORMATS].map((id) => [id, byteRanges(id).segments[1]?.start ?? Infinity]));
const rangeStart = (range: string | null) => Number(/^bytes=(\d+)-/.exec(range ?? '')?.[1] ?? 0);

const VIDEO_ID = 'vidE2Etest1';
const BROKEN_ID = 'vidE2Ebrok1';
const TITLES: Record<string, string> = {
  [VIDEO_ID]: 'Fixture de video en streaming',
  [BROKEN_ID]: 'Fixture con el video roto',
};
const DURATION = 10;

// PNG de 1×1 transparente para las miniaturas
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface MediaRequest {
  videoId: string;
  formatId: string;
  sid: string | null;
  range: string | null;
}

interface MockApi {
  config: PublicConfig;
  /** Peticiones a los playlists (`master` o el formato), en orden. */
  playlists: { videoId: string; name: string; sid: string | null }[];
  media: MediaRequest[];
  audio: MediaRequest[];
  /**
   * Si está puesto, los segmentos de video a partir del segundo esperan a que se resuelva y después responden 502.
   * Simula que googlevideo deja de servir el video a mitad de la reproducción.
   */
  holdVideo: Promise<void> | null;
}

function metaFor(videoId: string): VideoMeta {
  return {
    videoId,
    title: TITLES[videoId] ?? 'Fixture',
    author: 'ffmpeg',
    duration: DURATION,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    description: 'Fixture generada con ffmpeg.',
    live: false,
    audio: { sourceCodec: 'mp4a.40.2', sourceAbrKbps: 64, m4aNative: true, preview: { aac: true, opus: false } },
    videoQualities: [360, 720],
    estimatedBytes: { mp3: { '128': 160_000, '192': 240_000, '320': 400_000 }, m4a: 84_170, wav: 1_764_000, mp4: { '360': 290_000, '720': 460_000 } },
    limits: { audioOk: true, videoOk: true },
  };
}

function rangeOf(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!m) return 'invalid';
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

const cors = (route: Route) => {
  const origin = route.request().headers().origin;
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-expose-headers': 'content-range, accept-ranges, content-length',
    vary: 'origin',
  };
};

async function mockApi(context: BrowserContext): Promise<MockApi> {
  const api: MockApi = {
    config: { ...COMPILED_CONFIG, preview: true, previewVideo: true },
    playlists: [],
    media: [],
    audio: [],
    holdVideo: null,
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', headers: { ...cors(route), 'cache-control': 'no-store' }, body: JSON.stringify(body) });
  const apiError = (route: Route, status: number, code: string) =>
    json(route, status, { error: { code, message: code }, requestId: 'e2e' });

  /** Responde como el proxy de la API: 206 con Range, 200 sin él y 416 fuera de rango. */
  const serveBytes = (route: Route, file: { body: Buffer; type: string }) => {
    const size = file.body.length;
    const r = rangeOf(route.request().headers().range, size);
    const headers = { ...cors(route), 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=0' };
    if (r === 'invalid') return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    if (!r) return route.fulfill({ status: 200, contentType: file.type, headers, body: file.body });
    return route.fulfill({
      status: 206,
      contentType: file.type,
      headers: { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${size}` },
      body: file.body.subarray(r.start, r.end + 1),
    });
  };

  await context.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await context.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const sid = url.searchParams.get('sid');
      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: { ...cors(route), 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type, range' },
        });
      }
      if (path === '/api/config') return json(route, 200, api.config);
      if (path === '/api/resolve') {
        const body = req.postDataJSON() as ResolveRequest;
        const results: ResolveResult[] = body.items.map((it) => {
          const videoId = new URL(it.url).searchParams.get('v') ?? '';
          return {
            id: it.id,
            url: it.url,
            kind: 'video',
            videoId,
            title: TITLES[videoId] ?? null,
            author: 'ffmpeg',
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            status: 'ok',
          };
        });
        return json(route, 200, { results });
      }

      const m = /^\/api\/videos\/([\w-]{11})(?:\/(audio|hls\/([\w-]+)\.m3u8|media\/([\w-]+)))?$/.exec(path);
      if (!m) return apiError(route, 404, 'INTERNAL');
      const [, videoId, sub, playlist, formatId] = m as unknown as [string, string, string | undefined, string | undefined, string | undefined];
      if (!(videoId in TITLES)) return apiError(route, 404, 'VIDEO_UNAVAILABLE');
      if (!sub) return json(route, 200, metaFor(videoId));

      if (sub === 'audio') {
        api.audio.push({ videoId, formatId: '140', sid, range: req.headers().range ?? null });
        return serveBytes(route, MEDIA['140'] as { body: Buffer; type: string });
      }

      if (playlist) {
        api.playlists.push({ videoId, name: playlist, sid });
        if (!sid) return apiError(route, 400, 'INVALID_INPUT');
        // el info JSON no trae video aunque la metadata lo anuncie: la API responde 422
        if (videoId === BROKEN_ID) return apiError(route, 422, 'FORMAT_UNAVAILABLE');
        const text = PLAYLISTS[playlist];
        if (!text) return apiError(route, 404, 'FORMAT_UNAVAILABLE');
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { ...cors(route), 'cache-control': 'private, max-age=600' },
          body: text.replaceAll('sid=SID', `sid=${encodeURIComponent(sid)}`),
        });
      }

      const id = formatId as string;
      const range = req.headers().range ?? null;
      api.media.push({ videoId, formatId: id, sid, range });
      const file = MEDIA[id];
      if (!sid) return apiError(route, 400, 'INVALID_INPUT');
      if (!file) return apiError(route, 404, 'FORMAT_UNAVAILABLE');
      if (api.holdVideo && VIDEO_FORMATS.has(id) && rangeStart(range) >= (SECOND_SEGMENT_START[id] as number)) {
        await api.holdVideo;
        // como la API cuando YouTube sigue rechazando el formato tras su escalera de reintentos
        return apiError(route, 502, 'UPSTREAM_FORBIDDEN');
      }
      return serveBytes(route, file);
    },
  );
  return api;
}

const test = base.extend<{ api: MockApi }>({
  // «provide» y no «use»: la regla de hooks de React confunde el callback de Playwright con el hook use()
  api: async ({ context }, provide) => {
    await provide(await mockApi(context));
  },
});

// El Chromium de Playwright no trae H.264 ni AAC: este spec va en Google Chrome
test.use({ channel: 'chrome' });

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function expectNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const field = (page: Page) => page.getByLabel('Pega uno o varios links');
const watchRow = (page: Page, videoId: string) =>
  page.getByRole('button', { name: `Ver video de ${TITLES[videoId] as string}`, exact: true });
const bar = (page: Page) => page.getByRole('region', { name: 'Reproductor' });
const barVideo = (page: Page) => bar(page).getByRole('button', { name: 'Ver video', exact: true });
const panel = (page: Page) => page.locator('.video-panel');
const audioOnly = (page: Page) => panel(page).getByRole('button', { name: 'Solo audio', exact: true });

async function addVideos(page: Page, ...ids: string[]) {
  await field(page).fill(ids.map((id) => `https://www.youtube.com/watch?v=${id}`).join('\n'));
  await field(page).press('Enter');
  for (const id of ids) await expect(watchRow(page, id)).toBeVisible();
}

interface MediaSnapshot {
  t: number;
  paused: boolean;
  width: number;
  height: number;
}
const videoState = (page: Page) =>
  page.locator('.video-panel video').evaluate((v: HTMLVideoElement): MediaSnapshot => ({
    t: v.currentTime,
    paused: v.paused,
    width: v.videoWidth,
    height: v.videoHeight,
  }));
const audioState = (page: Page) =>
  page.locator('audio').evaluate((a: HTMLAudioElement) => ({ t: a.currentTime, paused: a.paused, src: a.currentSrc }));

/** Espera a que el <video> tenga imagen y pase de `sec`. */
async function waitVideoPast(page: Page, sec: number) {
  await expect
    .poll(async () => {
      const v = await videoState(page);
      return v.width > 0 && !v.paused && v.t > sec;
    }, { timeout: 15_000 })
    .toBe(true);
}
async function waitAudioPast(page: Page, sec: number) {
  await expect
    .poll(async () => {
      const a = await audioState(page);
      return !a.paused && a.t > sec;
    }, { timeout: 15_000 })
    .toBe(true);
}

type Tagged = Window & { __playingAt?: number | null };

/**
 * Guarda el segundo en el que vuelve a sonar `selector` (primer `playing`) y devuelve dónde está ahora el otro
 * elemento, `from`, justo antes de cambiar. Así se compara el punto de arranque y no lo que avanzó después.
 */
async function armPlaying(page: Page, selector: string, from: string): Promise<number> {
  return page.evaluate(
    ([sel, src]) => {
      const el = document.querySelector(sel) as HTMLMediaElement;
      (window as Tagged).__playingAt = null;
      el.addEventListener('playing', () => ((window as Tagged).__playingAt = el.currentTime), { once: true });
      return (document.querySelector(src) as HTMLMediaElement).currentTime;
    },
    [selector, from] as const,
  );
}
async function playingAt(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => (window as Tagged).__playingAt ?? null), { timeout: 15_000 }).not.toBeNull();
  return page.evaluate(() => (window as Tagged).__playingAt as number);
}

async function rectOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
  });
}

test.beforeEach(async ({ page, api }) => {
  void api; // monta las rutas simuladas antes de la primera carga
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(field(page)).toBeVisible();
});

test('«Ver video» reproduce imagen y sonido por HLS con el mismo sid en todas las peticiones', async ({ page, api }) => {
  const errors = collectConsoleErrors(page);
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();

  await expect(panel(page)).toHaveAttribute('data-open', 'true');
  await waitVideoPast(page, 1);
  const v = await videoState(page);
  expect([640, 1280]).toContain(v.width);
  await expect(watchRow(page, VIDEO_ID)).toHaveAttribute('aria-pressed', 'true');
  await expect(barVideo(page)).toHaveAttribute('aria-pressed', 'true');
  // el <audio> no suena a la vez
  expect((await audioState(page)).paused).toBe(true);
  // el sonido va dentro del <video> (grupo de audio del HLS)
  await expect
    .poll(() => page.locator('.video-panel video').evaluate((el) => (el as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0))
    .toBeGreaterThan(0);

  const names = api.playlists.map((p) => p.name);
  expect(names[0]).toBe('master');
  expect(names).toContain('140');
  expect(names.some((n) => VIDEO_FORMATS.has(n))).toBe(true);
  const sids = new Set([...api.playlists, ...api.media].map((r) => r.sid));
  expect(sids.size).toBe(1);
  expect([...sids][0]).toMatch(/^[0-9a-f]{32}$/);
  // init y segmentos por rangos de bytes, del video y del audio
  expect(api.media.every((r) => r.range !== null && /^bytes=\d+-\d+$/.test(r.range))).toBe(true);
  expect(api.media.some((r) => r.formatId === '140')).toBe(true);
  // los rangos son los del playlist: el init y segmentos enteros
  const video = api.media.filter((r) => VIDEO_FORMATS.has(r.formatId));
  expect(video.some((r) => r.range === byteRanges(r.formatId).init)).toBe(true);
  for (const r of api.media) {
    const { init, segments } = byteRanges(r.formatId);
    const ranges = [init, ...segments.map((s) => `bytes=${s.start}-${s.end}`)];
    expect(ranges).toContain(r.range);
  }
  expect(api.audio).toEqual([]);
  expect(errors).toEqual([]);
});

test('el salto lleva el video al segundo elegido y sigue reproduciendo', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();
  await waitVideoPast(page, 0.3);

  // la barra de posición va de 5 en 5 s
  await bar(page).getByRole('slider', { name: 'Posición' }).fill('5');
  await expect.poll(async () => (await videoState(page)).t, { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
  const before = (await videoState(page)).t;
  await waitVideoPast(page, before + 0.5);
  expect((await videoState(page)).t).toBeLessThan(DURATION);
  expect(errors).toEqual([]);
});

test('«Solo audio» y vuelta a «Ver video» siguen en el mismo segundo y devuelven el foco a la barra', async ({ page, api }) => {
  const errors = collectConsoleErrors(page);
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();
  await waitVideoPast(page, 1.5);

  const atVideo = await armPlaying(page, 'audio', '.video-panel video');
  await audioOnly(page).click();
  await expect(panel(page)).toHaveAttribute('data-open', 'false');
  await expect(barVideo(page)).toHaveAttribute('aria-pressed', 'false');
  // el foco no se pierde en <body> al cerrarse el panel
  await expect(barVideo(page)).toBeFocused();
  // el audio arranca donde estaba el video (lo que tarda el clic en llegar, como mucho)
  const audioFrom = await playingAt(page);
  expect(audioFrom).toBeGreaterThanOrEqual(atVideo - 0.25);
  expect(audioFrom).toBeLessThan(atVideo + 1);
  await waitAudioPast(page, audioFrom + 0.3);
  expect((await audioState(page)).src).toContain(`/api/videos/${VIDEO_ID}/audio?codec=aac&sid=`);
  expect((await videoState(page)).paused).toBe(true);
  expect(api.audio.length).toBeGreaterThan(0);

  const atAudio = await armPlaying(page, '.video-panel video', 'audio');
  await barVideo(page).click();
  await expect(panel(page)).toHaveAttribute('data-open', 'true');
  const videoFrom = await playingAt(page);
  expect(videoFrom).toBeGreaterThanOrEqual(atAudio - 0.25);
  expect(videoFrom).toBeLessThan(atAudio + 1);
  await waitVideoPast(page, videoFrom + 0.3);
  expect((await audioState(page)).paused).toBe(true);
  expect(errors).toEqual([]);
});

test('si la API rechaza el video, vuelve al audio con un aviso', async ({ page, api }) => {
  const errors = collectConsoleErrors(page);
  await addVideos(page, BROKEN_ID);
  await watchRow(page, BROKEN_ID).click();

  await expect(page.getByRole('status').filter({ hasText: 'No se pudo reproducir el video. Cambiamos a solo audio.' })).toBeVisible();
  await waitAudioPast(page, 0.3);
  await expect(panel(page)).toHaveAttribute('data-open', 'false');
  await expect(barVideo(page)).toHaveAttribute('aria-pressed', 'false');
  expect(api.playlists.map((p) => p.name)).toEqual(['master']);
  // el único error de consola es el 422 del master que registra el navegador
  expect(errors.filter((e) => !e.includes('status of 422'))).toEqual([]);
});

test('si el video deja de servirse a mitad, sigue en audio desde el mismo segundo', async ({ page, api }, testInfo) => {
  let release = () => undefined as void;
  api.holdVideo = new Promise<void>((resolve) => {
    release = resolve;
  });
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();
  // el primer segmento (0–4 s) se sirve; el segundo queda retenido
  await waitVideoPast(page, 1.5);
  const at = await armPlaying(page, 'audio', '.video-panel video');
  release();
  const released = Date.now();

  // hls.js reintenta el segmento ~3,5 s (fragLoadPolicy; con la de serie eran ~30 s) y el reproductor vuelve al audio
  await expect(page.getByRole('status').filter({ hasText: 'No se pudo reproducir el video. Cambiamos a solo audio.' })).toBeVisible({
    timeout: 15_000,
  });
  const fallbackMs = Date.now() - released;
  testInfo.annotations.push({ type: 'vuelta al audio', description: `${fallbackMs} ms` });
  expect(fallbackMs).toBeLessThan(8000);
  await expect(panel(page)).toHaveAttribute('data-open', 'false');
  // retoma donde se quedó la imagen: entre el segundo de la retención y el punto donde se para sin el segundo
  // segmento (fin del primero, 4 s, o hasta ~5 s si hls.js salta el hueco con el audio ya cargado)
  const audioFrom = await playingAt(page);
  expect(audioFrom).toBeGreaterThanOrEqual(at - 0.25);
  expect(audioFrom).toBeLessThanOrEqual(5.1);
  await waitAudioPast(page, audioFrom + 0.3);
  expect(api.media.some((r) => VIDEO_FORMATS.has(r.formatId) && rangeStart(r.range) >= (SECOND_SEGMENT_START[r.formatId] as number))).toBe(true);
});

test('axe sin violaciones serious ni critical con el panel de video abierto, en ambos temas', async ({ page }) => {
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();
  await waitVideoPast(page, 0.3);
  await expectNoSeriousA11y(page);

  await page.getByRole('button', { name: 'Tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(panel(page)).toHaveAttribute('data-open', 'true');
  await expectNoSeriousA11y(page);
});

test('pantalla completa: entra y sale, y «Solo audio» dentro devuelve el foco a la barra', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'la pantalla completa del contenedor se prueba en escritorio');
  const errors = collectConsoleErrors(page);
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).click();
  await waitVideoPast(page, 0.3);

  await page.locator('.video-frame').hover();
  await panel(page).getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-video-frame') ?? false)).toBe(true);
  // la tecla f sale
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.mouse.move(400, 300);
  await audioOnly(page).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(panel(page)).toHaveAttribute('data-open', 'false');
  await expect(barVideo(page)).toBeFocused();
  await waitAudioPast(page, 0.3);
  expect(errors).toEqual([]);
});

test('móvil: el panel no tapa la barra ni la cola, también en horizontal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'disposición de móvil');
  const errors = collectConsoleErrors(page);
  await addVideos(page, VIDEO_ID);
  await watchRow(page, VIDEO_ID).tap();
  await waitVideoPast(page, 0.3);

  const check = async () => {
    const p = await rectOf(page, '.video-panel');
    const b = await rectOf(page, '.player-bar');
    const vp = page.viewportSize() as { width: number; height: number };
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.bottom).toBeLessThanOrEqual(b.top + 1);
    expect(b.bottom).toBeLessThanOrEqual(vp.height + 1);
    // los botones del panel se pueden tocar
    await expect(audioOnly(page)).toBeInViewport();
    // la cola deja debajo hueco para el panel y las barras: su última fila se puede subir por encima de ellos
    const pad = await page.locator('.dock-pad').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(pad).toBeGreaterThanOrEqual(vp.height - Math.min(p.top, b.top));
    return { p, vp };
  };

  const portrait = await check();
  // en vertical, a todo el ancho
  expect(portrait.p.width).toBeGreaterThanOrEqual(portrait.vp.width - 1);

  // en horizontal (poca altura) flota a un lado y deja a la vista buena parte de la página
  const landscape = devices['Pixel 7 landscape']?.viewport ?? { width: 863, height: 360 };
  await page.setViewportSize(landscape);
  await expect.poll(async () => (await rectOf(page, '.video-panel')).width).toBeLessThanOrEqual(landscape.width * 0.5);
  const side = await check();
  expect(side.p.right).toBeGreaterThan(side.vp.width * 0.9);
  // con el scroll arriba, el panel empieza por debajo de la cabecera: el botón del tema se puede tocar entero
  await page.evaluate(() => window.scrollTo(0, 0));
  const header = await rectOf(page, 'header');
  expect((await rectOf(page, '.video-panel')).top).toBeGreaterThanOrEqual(header.bottom);
  const themeCovered = await page.getByRole('button', { name: 'Tema oscuro' }).evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
    ];
    return points.some(([x, y]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      return !(hit && btn.contains(hit));
    });
  });
  expect(themeCovered).toBe(false);
  expect((await videoState(page)).paused).toBe(false);
  expect(errors).toEqual([]);
});
