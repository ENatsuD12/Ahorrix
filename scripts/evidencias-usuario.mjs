/**
 * Recorre Ahorrix como lo haría una persona real (registro, movimientos,
 * presupuestos, modo sin conexión, ajustes) contra la API levantada en
 * 127.0.0.1:8000 y guarda una captura por paso en docs/evidencias/pruebas-usuario.
 *
 * Uso: con la API en :8000 y la PWA en :4173 (npm start),
 *      node scripts/evidencias-usuario.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'docs', 'evidencias', 'pruebas-usuario');
const APP = 'http://localhost:4173/';
const email = `usuario.${Date.now()}@ahorrix.test`;
const password = 'clave-segura-2026';
const desktop = { viewport: { width: 1280, height: 800 } };

const results = [];
let shotIndex = 0;

async function step(title, fn) {
  shotIndex += 1;
  const id = String(shotIndex).padStart(2, '0');
  const result = { id, title, ok: true, note: '' };
  try {
    result.note = (await fn(id)) ?? '';
  } catch (error) {
    result.ok = false;
    result.note = error.message.split('\n')[0];
    await page.screenshot({ path: path.join(outDir, `${id}-fallo.png`) }).catch(() => {});
  }
  results.push(result);
  console.log(`${result.ok ? 'OK ' : 'FALLÓ'} ${id} ${title}${result.note ? ` — ${result.note}` : ''}`);
}

async function shot(page, id, name) {
  const file = `${id}-${name}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
  return file;
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext(desktop);
await context.grantPermissions(['geolocation'], { origin: APP.slice(0, -1) });
await context.setGeolocation({ latitude: 19.4326, longitude: -99.1332 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

const screenshots = {};

await page.goto(APP);
await page.waitForSelector('#auth-form');

await step('Pantalla de acceso', async (id) => {
  screenshots.acceso = await shot(page, id, 'acceso');
  return 'Se muestra el formulario de inicio de sesión';
});

await step('Validación al entrar sin datos', async (id) => {
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('[data-error="email"]:not(:empty)');
  screenshots.validacionAcceso = await shot(page, id, 'validacion-acceso');
  return 'Errores en línea junto a cada campo';
});

await step('Cambiar a “Crear cuenta” y validar', async (id) => {
  await page.getByRole('button', { name: 'Crear cuenta' }).first().click();
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await page.waitForSelector('[data-error="name"]:not(:empty)');
  screenshots.validacionRegistro = await shot(page, id, 'validacion-registro');
  return 'Nombre, correo, contraseña y moneda requeridos';
});

await step('Registro de usuario nuevo', async (id) => {
  await page.fill('input[name="name"]', 'Ana Prueba');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.selectOption('select[name="base_currency_code"]', 'MXN');
  await page.getByRole('button', { name: 'Crear cuenta' }).last().click();
  await page.waitForSelector('#nav:not([hidden])');
  await page.waitForSelector('.empty');
  screenshots.inicioVacio = await shot(page, id, 'inicio-vacio');
  return `Cuenta creada: ${email}`;
});

await step('Nuevo movimiento: validación', async (id) => {
  await page.getByRole('button', { name: 'Registrar movimiento' }).or(page.getByRole('button', { name: 'Nuevo movimiento' })).first().click();
  const drawer = page.locator('#drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.waitForSelector('#drawer [data-error="amount"]:not(:empty)');
  screenshots.validacionMovimiento = await shot(page, id, 'validacion-movimiento');
  return 'Monto y categoría requeridos, sin cerrar el cajón';
});

await step('Registrar un ingreso', async (id) => {
  const drawer = page.locator('#drawer');
  await drawer.locator('input[name="amount"]').fill('15000');
  await drawer.locator('select[name="category_id"]').selectOption({ label: 'Salario' });
  await drawer.locator('input[name="description"]').fill('Nómina noviembre');
  await drawer.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await page.waitForSelector('#geo-status:has-text("Lat")');
  screenshots.cajonIngreso = await shot(page, id, 'cajon-ingreso-con-ubicacion');
  await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.waitForSelector('#drawer', { state: 'hidden' });
  await page.waitForSelector('#toast:has-text("guardado")');
  return 'Ingreso de $15,000.00 con ubicación';
});

await step('Registrar un gasto con ticket', async (id) => {
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click();
  const drawer = page.locator('#drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.locator('input[name="amount"]').fill('350.50');
  await drawer.locator('select[name="category_id"]').selectOption({ label: 'Alimentación' });
  await drawer.locator('input[name="description"]').fill('Tacos del viernes');
  await drawer.locator('input[name="receipt"]').setInputFiles(path.join(root, 'pwa', 'icons', 'icon-192.png'));
  await page.waitForSelector('#receipt-preview:not([hidden])');
  screenshots.cajonGasto = await shot(page, id, 'cajon-gasto-con-ticket');
  await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.waitForSelector('#drawer', { state: 'hidden' });
  await page.waitForSelector('#toast:has-text("guardado")');
  return 'Gasto de $350.50 con foto del ticket';
});

await step('Movimientos del mes', async (id) => {
  await page.goto(`${APP}#/movimientos`);
  await page.waitForSelector('text=Tacos del viernes');
  screenshots.movimientos = await shot(page, id, 'movimientos');
  return 'Lista con ingreso y gasto';
});

await step('Inicio con datos del mes', async (id) => {
  await page.goto(`${APP}#/inicio`);
  await page.waitForSelector('.ledger-cell.is-expense .figure:has-text("350.50")');
  await page.waitForTimeout(500);
  screenshots.inicioConDatos = await shot(page, id, 'inicio-con-datos');
  return 'Ingresos $15,000.00 · gastos $350.50';
});

await step('Definir un presupuesto que se excede', async (id) => {
  await page.goto(`${APP}#/presupuestos`);
  await page.waitForSelector('#budget-form');
  await page.locator('#budget-form select[name="category_id"]').selectOption({ label: 'Alimentación' });
  await page.locator('#budget-form input[name="amount"]').fill('300');
  await page.locator('#budget-form').getByRole('button', { name: 'Guardar' }).click();
  await page.waitForSelector('.state.is-exceeded');
  screenshots.presupuesto = await shot(page, id, 'presupuesto-excedido');
  return 'Presupuesto de $300.00 superado con $350.50';
});

await step('Editar un movimiento', async (id) => {
  await page.goto(`${APP}#/movimientos`);
  const row = page.locator('tr', { hasText: 'Tacos del viernes' });
  await row.getByRole('button', { name: /Editar/ }).click();
  const drawer = page.locator('#drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.locator('input[name="amount"]').fill('120');
  await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.waitForSelector('#drawer', { state: 'hidden' });
  await page.waitForSelector('tr:has-text("Tacos del viernes") >> text=120.00');
  screenshots.editado = await shot(page, id, 'movimiento-editado');
  return 'Monto cambiado de $350.50 a $120.00';
});

await step('Eliminar pide confirmación en la fila', async (id) => {
  const row = page.locator('tr', { hasText: 'Tacos del viernes' });
  await row.getByRole('button', { name: 'Eliminar Tacos del viernes' }).click();
  await row.getByText('¿Eliminar?').waitFor();
  screenshots.confirmarEliminar = await shot(page, id, 'confirmar-eliminar');
  await row.getByRole('button', { name: 'Sí, eliminar' }).click();
  await page.waitForSelector('text=Tacos del viernes', { state: 'detached' });
  return 'Se borra solo después de confirmar';
});

await step('Agregar una categoría en Ajustes', async (id) => {
  await page.goto(`${APP}#/ajustes`);
  await page.waitForSelector('#category-form');
  await page.locator('#category-form input[name="name"]').fill('Mascotas');
  await page.locator('#category-form select[name="transaction_type_id"]').selectOption({ label: 'Gasto' });
  await page.locator('#category-form').getByRole('button', { name: 'Agregar categoría' }).click();
  await page.waitForSelector('text=Mascotas');
  screenshots.ajustes = await shot(page, id, 'ajustes');
  return 'Categoría “Mascotas” creada';
});

await step('Sin conexión: registrar un gasto', async (id) => {
  await context.setOffline(true);
  await page.goto(`${APP}#/inicio`);
  await page.waitForSelector('#connection:has-text("Sin conexión")');
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click();
  const drawer = page.locator('#drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.locator('input[name="amount"]').fill('42');
  await drawer.locator('select[name="category_id"]').selectOption({ label: 'Alimentación' });
  await drawer.locator('input[name="description"]').fill('Café sin internet');
  await drawer.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.waitForSelector('#pending:not([hidden])');
  screenshots.offline = await shot(page, id, 'sin-conexion-pendiente');
  return 'Se guarda en el dispositivo y queda en cola';
});

await step('Volver a la conexión y sincronizar', async (id) => {
  await context.setOffline(false);
  await page.waitForSelector('#pending', { state: 'hidden', timeout: 15000 });
  await page.goto(`${APP}#/movimientos`);
  await page.waitForSelector('text=Café sin internet');
  await page.waitForSelector('text=Pendiente de sincronizar', { state: 'detached' });
  screenshots.sincronizado = await shot(page, id, 'sincronizado');
  return 'La cola se envió y el movimiento ya no está pendiente';
});

await step('Cerrar sesión', async (id) => {
  await page.goto(`${APP}#/ajustes`);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForSelector('#auth-form');
  screenshots.cerrarSesion = await shot(page, id, 'cerrar-sesion');
  return 'Regresa a la pantalla de acceso';
});

await step('Contraseña incorrecta', async (id) => {
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'otra-clave-equivocada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('[data-error="email"]:not(:empty)');
  screenshots.claveIncorrecta = await shot(page, id, 'clave-incorrecta');
  return 'Mensaje claro, sin revelar qué campo falló';
});

await step('Iniciar sesión de nuevo', async (id) => {
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('#nav:not([hidden])');
  await page.waitForSelector('.ledger');
  screenshots.reingreso = await shot(page, id, 'reingreso');
  return 'Los datos siguen en la cuenta';
});

// Versión móvil del mismo recorrido
const mobile = await browser.newContext(devices['Pixel 7']);
await mobile.grantPermissions(['geolocation'], { origin: APP.slice(0, -1) });
await step('Móvil: inicio con datos', async (id) => {
  const p = await mobile.newPage();
  await p.goto(APP);
  await p.getByLabel('Correo electrónico').fill(email);
  await p.getByLabel('Contraseña').fill(password);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForSelector('#nav:not([hidden])');
  await p.waitForSelector('.ledger');
  await p.waitForTimeout(500);
  screenshots.movilInicio = await shot(p, id, 'movil-inicio');
  await p.goto(`${APP}#/movimientos`);
  await p.getByRole('button', { name: 'Nuevo movimiento' }).click();
  await p.waitForSelector('#drawer', { state: 'visible' });
  screenshots.movilCajon = await shot(p, `${id}b`, 'movil-cajon');
  await p.close();
  return 'Vista de teléfono: navegación inferior y hoja de registro';
});

await browser.close();
await mobile.close();

const lines = [
  '# Evidencias de pruebas de usuario',
  '',
  `Recorrido real en el navegador contra la API (\`api/\`) y la PWA (\`pwa/\`). Usuario de prueba: \`${email}\`.`,
  '',
  `Generado con \`pwa/scripts/evidencias-usuario.mjs\` el ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.`,
  '',
  '| # | Paso | Resultado | Captura |',
  '|---|---|---|---|',
  ...results.map((r) => {
    const file = Object.values(screenshots).find((f) => f.startsWith(`${r.id}`));
    const ok = r.ok ? '✅' : '❌';
    return `| ${r.id} | ${r.title} | ${ok} ${r.note} | ${file ? `![${r.title}](./${file})` : '—'} |`;
  }),
  '',
  `**Resultado:** ${results.filter((r) => r.ok).length} de ${results.length} pasos correctos.`,
  '',
];

await writeFile(path.join(outDir, 'README.md'), lines.join('\n'));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} pasos correctos. Evidencias en ${outDir}`);
