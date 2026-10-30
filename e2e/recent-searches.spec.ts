import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, type Page, type Route, test as base, expect } from '@playwright/test';
import type { PublicConfig, SearchItem, SearchResult } from '../src/lib/contract';
import { COMPILED_CONFIG } from '../src/lib/defaults';

// Búsquedas recientes con la API simulada: no hace falta el stack de Docker Compose ni salir a la red.
// Todo lo que la web pide a la API (`/api/...`) y las miniaturas de i.ytimg.com se responden aquí.

const KEY = 'setube_searches';
// PNG de 1×1 transparente para las miniaturas
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface MockApi {
  /** Lo que devuelve `GET /api/config`; se puede cambiar antes de recargar. */
  config: PublicConfig;
  /** Consultas que llegaron a `GET /api/search`, en orden. */
  searches: string[];
}

function resultsFor(q: string, n: number): SearchResult {
  const items: SearchItem[] = [1, 2].map((i) => ({
    videoId: `vid${String(n * 10 + i).padStart(8, '0')}`,
    title: `${q} · resultado ${i}`,
    author: 'Canal de prueba',
    duration: 180 + i,
    views: 1000 * i,
    live: false,
    thumbnail: `https://i.ytimg.com/vi/vid${String(n * 10 + i).padStart(8, '0')}/mqdefault.jpg`,
  }));
  return { query: q, items };
}

async function mockApi(context: BrowserContext): Promise<MockApi> {
  const api: MockApi = { config: { ...COMPILED_CONFIG, search: true }, searches: [] };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  await context.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await context.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config') return json(route, 200, api.config);
      if (url.pathname === '/api/search') {
        const q = url.searchParams.get('q') ?? '';
        api.searches.push(q);
        return json(route, 200, resultsFor(q, api.searches.length));
      }
      return json(route, 404, { error: { code: 'INTERNAL', message: 'sin simular' }, requestId: 'e2e' });
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

const field = (page: Page) => page.getByLabel('Busca en YouTube o pega uno o varios links');
const section = (page: Page) => page.getByRole('region', { name: 'Búsquedas recientes' });
const picks = (page: Page) => section(page).getByRole('button', { name: /^Buscar «/ });
const pick = (page: Page, q: string) => section(page).getByRole('button', { name: `Buscar «${q}»`, exact: true });
const removeButton = (page: Page, q: string) =>
  section(page).getByRole('button', { name: `Quitar «${q}» del historial`, exact: true });
const resultsHeading = (page: Page) => page.getByRole('heading', { name: /^Resultados para/ });

const stored = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { v: number; items: string[] }).items : null;
  }, KEY);

/** Guarda un historial y recarga para que la página lo lea. */
async function seed(page: Page, items: string[]) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify({ v: 1, items })] as const);
  await page.reload();
  await expect(field(page)).toBeVisible();
}

/** Busca con Enter, espera los resultados y los cierra con Esc (vacía el campo). */
async function searchFor(page: Page, typed: string, expected = typed) {
  await field(page).fill(typed);
  await field(page).press('Enter');
  await expect(resultsHeading(page)).toContainText(expected);
  await expect(section(page)).toHaveCount(0);
  await field(page).press('Escape');
  await expect(resultsHeading(page)).toHaveCount(0);
}

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

test.beforeEach(async ({ page, api }) => {
  void api; // monta las rutas simuladas antes de la primera carga
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(field(page)).toBeVisible();
});

test('guarda cada búsqueda y la conserva al recargar', async ({ page, api }) => {
  const errors = collectConsoleErrors(page);
  await expect(section(page)).toHaveCount(0);

  await field(page).fill('lofi hip hop');
  await field(page).press('Enter');
  await expect(resultsHeading(page)).toContainText('lofi hip hop');
  // con los resultados abiertos no se ve el historial
  await expect(section(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(['lofi hip hop']);

  await field(page).press('Escape');
  await expect(picks(page)).toHaveText(['lofi hip hop']);
  // escribir lo oculta y vaciar el campo lo trae de vuelta
  await field(page).fill('a');
  await expect(section(page)).toHaveCount(0);
  await field(page).fill('');
  await expect(picks(page)).toHaveText(['lofi hip hop']);

  await page.reload();
  await expect(picks(page)).toHaveText(['lofi hip hop']);
  expect(api.searches).toEqual(['lofi hip hop']);
  expect(errors).toEqual([]);
});

test('ordena de la más reciente a la más antigua, sin duplicados y con un máximo de 8', async ({ page }) => {
  await searchFor(page, 'Lofi Hip Hop');
  await searchFor(page, '  karol   g ', 'karol g');
  // repetir sin distinguir mayúsculas la sube con la última forma escrita
  await searchFor(page, 'LOFI hip hop');
  await expect(picks(page)).toHaveText(['LOFI hip hop', 'karol g']);
  expect(await stored(page)).toEqual(['LOFI hip hop', 'karol g']);

  const eight = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
  await seed(page, eight);
  await searchFor(page, 'nueva');
  await expect(picks(page)).toHaveText(['nueva', ...eight.slice(0, 7)]);
  expect(await stored(page)).toEqual(['nueva', ...eight.slice(0, 7)]);
});

test('tocar una reciente la escribe en la barra, la busca y la sube', async ({ page, api }) => {
  await seed(page, ['karol g', 'lofi hip hop']);
  await pick(page, 'lofi hip hop').click();

  await expect(field(page)).toHaveValue('lofi hip hop');
  await expect(field(page)).toBeFocused();
  await expect(resultsHeading(page)).toContainText('lofi hip hop');
  await expect(section(page)).toHaveCount(0);
  expect(api.searches).toEqual(['lofi hip hop']);
  expect(await stored(page)).toEqual(['lofi hip hop', 'karol g']);
});

test('quitar una mueve el foco a la siguiente, a la anterior o al campo', async ({ page }) => {
  await seed(page, ['a uno', 'b dos', 'c tres']);
  const live = page.locator('p[aria-live="polite"]', { hasText: /^Se quitó/ });

  await removeButton(page, 'b dos').click();
  await expect(picks(page)).toHaveText(['a uno', 'c tres']);
  await expect(pick(page, 'c tres')).toBeFocused();
  await expect(live).toHaveText('Se quitó «b dos» del historial.');

  // la última de la lista: el foco va a la anterior
  await removeButton(page, 'c tres').click();
  await expect(picks(page)).toHaveText(['a uno']);
  await expect(pick(page, 'a uno')).toBeFocused();

  // la única: desaparece la sección y el foco vuelve al campo
  await removeButton(page, 'a uno').click();
  await expect(section(page)).toHaveCount(0);
  await expect(field(page)).toBeFocused();
  await expect(live).toHaveText('Se quitó «a uno» del historial.');
  expect(await stored(page)).toEqual([]);

  // el mismo anuncio otra vez va en un nodo nuevo para que el lector de pantalla lo repita
  await live.locator('span').evaluate((el) => el.setAttribute('data-old', ''));
  await searchFor(page, 'a uno');
  await removeButton(page, 'a uno').click();
  await expect(live).toHaveText('Se quitó «a uno» del historial.');
  await expect(live.locator('span[data-old]')).toHaveCount(0);
});

test('borrar el historial enfoca el campo y «Deshacer» lo recupera', async ({ page }) => {
  await seed(page, ['a uno', 'b dos', 'c tres']);
  const toast = page.getByRole('status').filter({ hasText: 'Se borró el historial de búsqueda.' });

  await section(page).getByRole('button', { name: 'Borrar historial' }).click();
  await expect(section(page)).toHaveCount(0);
  await expect(field(page)).toBeFocused();
  expect(await stored(page)).toEqual([]);
  await toast.getByRole('button', { name: 'Deshacer' }).click();
  await expect(picks(page)).toHaveText(['a uno', 'b dos', 'c tres']);
  expect(await stored(page)).toEqual(['a uno', 'b dos', 'c tres']);

  // lo que se buscó entre borrar y deshacer queda delante de lo recuperado
  await section(page).getByRole('button', { name: 'Borrar historial' }).click();
  await searchFor(page, 'nueva');
  await toast.getByRole('button', { name: 'Deshacer' }).click();
  await expect(picks(page)).toHaveText(['nueva', 'a uno', 'b dos', 'c tres']);
});

test('se sincroniza con otra pestaña', async ({ page, context }) => {
  await seed(page, ['karol g']);
  const other = await context.newPage();
  try {
    await other.goto('/');
    await searchFor(other, 'desde otra');
    // la primera pestaña la muestra sin recargar
    await expect(picks(page)).toHaveText(['desde otra', 'karol g']);
  } finally {
    await other.close();
  }
});

test('con la búsqueda desactivada en la API no muestra el historial ni lo borra', async ({ page, api }) => {
  await seed(page, ['karol g']);
  await expect(picks(page)).toHaveText(['karol g']);

  api.config = { ...api.config, search: false };
  const config = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/config');
  await page.reload();
  await config;
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Pega uno o varios links')).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  expect(await stored(page)).toEqual(['karol g']);
});

test('teclado: Tab recorre los chips y Enter en la X quita esa', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'teclado físico solo en desktop');
  await seed(page, ['a uno', 'b dos']);

  await pick(page, 'a uno').focus();
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''));
  }
  expect(order).toEqual(['Quitar «a uno» del historial', 'Buscar «b dos»', 'Quitar «b dos» del historial', 'Borrar historial']);

  await removeButton(page, 'a uno').focus();
  await page.keyboard.press('Enter');
  await expect(picks(page)).toHaveText(['b dos']);
  await expect(pick(page, 'b dos')).toBeFocused();
});

test('axe sin violaciones serious ni critical con el historial visible, en ambos temas', async ({ page }) => {
  const long = `${'canción muy larga '.repeat(12)}fin`.slice(0, 200);
  await seed(page, [long, 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
  await expect(picks(page)).toHaveCount(8);
  await expect(pick(page, long)).toHaveAttribute('title', long);
  // la consulta larga se recorta sin desbordar la página
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await expectNoSeriousA11y(page);

  // el sitio no sigue prefers-color-scheme: el tema claro se elige en localStorage
  await page.evaluate(() => localStorage.setItem('setube_theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(picks(page)).toHaveCount(8);
  await expectNoSeriousA11y(page);
});
