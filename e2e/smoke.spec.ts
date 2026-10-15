import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const BATCH_VIDEOS = ['jNQXAC9IVRw', 'dQw4w9WgXcQ', '9bZkp7q19f0'];

// Lee el tema de <html> en DOMContentLoaded, antes de hidratar.
async function recordThemeAtDcl(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __themeAtDcl?: string }).__themeAtDcl = document.documentElement.dataset.theme;
    });
  });
}
const themeAtDcl = (page: Page) => page.evaluate(() => (window as unknown as { __themeAtDcl?: string }).__themeAtDcl);

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function addLink(page: Page, url: string) {
  const input = page.getByLabel('Pega uno o varios links');
  await input.fill(url);
  await input.press('Enter');
}

async function expectNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('carga en español sin errores de consola y con tema oscuro antes de hidratar', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await recordThemeAtDcl(page);
  const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await res?.text()).toContain('data-theme="dark"');
  expect(await themeAtDcl(page)).toBe('dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1, name: 'Convierte links de YouTube' })).toBeVisible();
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).not.toContain("'unsafe-eval'");
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('el toggle de tema tiene etiqueta fija, cambia a claro y persiste sin flash', async ({ page }, testInfo) => {
  await recordThemeAtDcl(page);
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Tema oscuro' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Tema oscuro' })).toHaveAttribute('aria-pressed', 'false');

  await page.reload({ waitUntil: 'domcontentloaded' });
  // el ThemeScript inline ya aplicó el claro en el primer pintado
  expect(await themeAtDcl(page)).toBe('light');
  await testInfo.attach('primer-frame-claro', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.getByRole('button', { name: 'Tema oscuro' })).toHaveAttribute('aria-pressed', 'false');
});

test('pegar un link crea una fila con miniatura', async ({ page }) => {
  await addLink(page, VIDEO);
  const row = page.locator('#contenido li').filter({ has: page.locator('img[src*="i.ytimg.com/vi/jNQXAC9IVRw"]') });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole('progressbar', { name: /Progreso de/ })).toHaveCount(1);
});

test('axe sin violaciones serious ni critical en ambos temas', async ({ page }) => {
  await addLink(page, VIDEO);
  await expect(page.locator('img[src*="jNQXAC9IVRw"]')).toHaveCount(1);
  await expectNoSeriousA11y(page);
  await page.getByRole('button', { name: 'Tema oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectNoSeriousA11y(page);
});

test('navegación por teclado: chips, Convertir y acciones de fila', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'teclado físico solo en desktop');
  await addLink(page, VIDEO);
  await expect(page.locator('img[src*="jNQXAC9IVRw"]')).toHaveCount(1);
  await page.locator('body').click({ position: { x: 1, y: 1 } });

  const reached = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      if (el instanceof HTMLInputElement && el.type === 'radio') return `radio:${el.name}`;
      return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    });
    reached.add(label);
  }
  expect(reached).toContain('radio:kind');
  expect(reached).toContain('radio:format');
  expect(reached).toContain('radio:quality');
  expect([...reached].some((l) => l.startsWith('Convertir'))).toBe(true);
  expect(reached).toContain('Descargar');
  expect(reached).toContain('Quitar');

  // las flechas cambian el radio dentro del grupo
  await page.getByRole('radio', { name: 'Audio' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Video' })).toBeChecked();
});

test('tres descargas seguidas desde las filas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'se documenta en Chromium desktop');
  test.slow();
  for (const id of BATCH_VIDEOS) await addLink(page, `https://youtu.be/${id}`);
  await expect(page.locator('#contenido li img[src*="i.ytimg.com"]')).toHaveCount(3);

  let downloads = 0;
  page.on('download', () => {
    downloads++;
  });
  const buttons = page.getByRole('button', { name: 'Descargar', exact: true });
  for (let i = 0; i < 3; i++) await buttons.nth(0).click();

  // cada fila termina en una descarga real o en el copy DOWNLOAD_BLOCKED, nunca colgada
  const blocked = page.getByText('Tu navegador pudo bloquear la descarga. Permite las descargas múltiples para este sitio.');
  await expect
    .poll(async () => downloads + (await blocked.count()), { timeout: 90_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(3);
  testInfo.annotations.push({ type: 'descargas', description: `descargas=${downloads}, bloqueadas=${await blocked.count()}` });
});
