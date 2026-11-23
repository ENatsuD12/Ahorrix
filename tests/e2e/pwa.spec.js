import { expect, test } from '@playwright/test';
import { installMockApi } from './mock-api.js';

const AUTH_TOKEN_SCRIPT = () => {
  localStorage.setItem('ahorrix.token', 'test-token');
  localStorage.setItem('ahorrix.apiUrl', 'http://127.0.0.1:8000/api');
};

async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

test.describe('instalabilidad y Service Worker', () => {
  test('el manifest cumple los requisitos de instalación', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const res = await fetch(link.href);
      return res.json();
    });

    expect(manifest.name).toContain('Ahorrix');
    expect(manifest.short_name).toBe('Ahorrix');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('registra el Service Worker y guarda el app shell en caché', async ({ page }) => {
    await page.goto('/');
    await waitForServiceWorker(page);

    const cached = await page.evaluate(async () => {
      const cache = await caches.open('ahorrix-v2');
      const keys = await cache.keys();
      return keys.map((r) => new URL(r.url).pathname);
    });

    expect(cached).toEqual(expect.arrayContaining(['/js/app.js', '/js/views.js', '/js/ui.js', '/css/styles.css', '/index.html']));
  });

  test('la aplicación abre sin conexión después de la primera visita', async ({ page, context }) => {
    await page.goto('/');
    await waitForServiceWorker(page);
    await page.waitForTimeout(300);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Ahorrix', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('validación de formularios', () => {
  test('muestra errores en el acceso si los datos son inválidos', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.locator('[data-error="email"]')).toHaveText('Correo electrónico inválido.');
    await expect(page.locator('[data-error="password"]')).toContainText('al menos 8');
    await expect(page.locator('input[name="email"]')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('diseño responsivo', () => {
  test.beforeEach(async ({ context }) => {
    await installMockApi(context);
  });

  test('no hay desbordamiento horizontal y la navegación se adapta al dispositivo', async ({ page }) => {
    await page.addInitScript(AUTH_TOKEN_SCRIPT);
    await page.goto('/#/inicio');
    await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const viewport = page.viewportSize();
    const nav = await page.locator('#nav').boundingBox();

    if (viewport.width < 900) {
      expect(nav.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(nav.y).toBeGreaterThan(viewport.height - 120);
    } else {
      expect(nav.x).toBeLessThanOrEqual(1);
      expect(nav.width).toBeLessThanOrEqual(240);
      expect(nav.y).toBeLessThanOrEqual(120);
    }
  });

  test('las tarjetas de resumen muestran los totales del mes', async ({ page }) => {
    await page.addInitScript(AUTH_TOKEN_SCRIPT);
    await page.goto('/#/inicio');

    await expect(page.locator('.ledger-cell.is-income .figure')).toContainText('1,000.00');
    await expect(page.locator('.ledger-cell.is-expense .figure')).toContainText('0.00');
  });
});

test.describe('edición de movimientos', () => {
  test('eliminar pide confirmación dentro de la fila antes de borrar', async ({ page, context }) => {
    await installMockApi(context);
    await page.addInitScript(AUTH_TOKEN_SCRIPT);
    await page.goto('/#/movimientos');
    await expect(page.getByText('Quincena')).toBeVisible();

    const row = page.locator('tr', { hasText: 'Quincena' });
    await row.getByRole('button', { name: 'Eliminar Quincena' }).click();
    await expect(row.getByText('¿Eliminar?')).toBeVisible();

    await row.getByRole('button', { name: 'Cancelar' }).click();
    await expect(row.getByText('¿Eliminar?')).toBeHidden();

    await row.getByRole('button', { name: 'Eliminar Quincena' }).click();
    await row.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByText('Quincena')).toHaveCount(0);
  });
});

test.describe('flujo offline completo', () => {
  test('registra un gasto sin conexión y lo sincroniza al volver', async ({ page, context }) => {
    const api = await installMockApi(context);
    await page.addInitScript(AUTH_TOKEN_SCRIPT);
    await page.goto('/#/inicio');
    await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await expect(page.locator('#connection')).toHaveText('Sin conexión');

    await page.getByRole('button', { name: 'Nuevo movimiento' }).click();
    const drawer = page.locator('#drawer');
    await expect(drawer).toBeVisible();

    await drawer.locator('input[name="amount"]').fill('35.50');
    await drawer.locator('select[name="category_id"]').selectOption({ label: 'Comida' });
    await drawer.locator('input[name="description"]').fill('Tacos');
    await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();

    await expect(page.locator('#toast')).toContainText('Se sincronizará');
    await expect(page.locator('#pending')).toHaveText('1 por sincronizar');
    expect(api.log.creates).toHaveLength(0);

    await page.goto('/#/movimientos');
    await expect(page.getByText('Pendiente de sincronizar')).toBeVisible();
    await expect(page.getByText('Tacos')).toBeVisible();

    await context.setOffline(false);

    await expect(page.locator('#pending')).toBeHidden({ timeout: 10000 });
    await expect.poll(() => api.log.syncCalls).toBeGreaterThan(0);
    await expect(page.locator('#connection')).toHaveText('En línea');
  });

  test('valida el monto antes de guardar el movimiento', async ({ page, context }) => {
    await installMockApi(context);
    await page.addInitScript(AUTH_TOKEN_SCRIPT);
    await page.goto('/#/movimientos');
    await expect(page.getByRole('heading', { name: 'Movimientos', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Nuevo movimiento' }).click();
    const drawer = page.locator('#drawer');
    await drawer.locator('input[name="amount"]').fill('0');
    await drawer.locator('select[name="category_id"]').selectOption({ label: 'Comida' });
    await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();

    await expect(drawer.locator('[data-error="amount"]')).toContainText('mayor a 0');
    await expect(drawer.locator('input[name="amount"]')).toHaveAttribute('aria-describedby', 'transaction-amount-error');
    await expect(drawer).toBeVisible();
  });
});
