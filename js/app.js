import { ApiError, NetworkError, createApiClient } from './api.js';
import { openDatabase } from './db.js';
import { createDataLayer, OfflineConversionError } from './data.js';
import {
  LIMITS,
  TYPES,
  formatMoney,
  formatMonth,
  monthKey,
  shiftMonth,
  todayISO,
  typeOf,
  validateAccount,
  validateBudget,
  validateCategory,
  validateCredentials,
  validateTransaction,
} from './domain.js';
import { drawBars, drawDonut } from './charts.js';
import {
  canShare,
  getPosition,
  hasGeolocation,
  hasNotifications,
  isStandalone,
  listenInstallPrompt,
  notify,
  requestNotificationPermission,
  shareSummary,
} from './device.js';
import {
  $,
  applyErrors,
  closeDrawer,
  formValues,
  openDrawer,
  setBusy,
  toast,
} from './ui.js';
import * as views from './views.js';

const config = window.AHORRIX_CONFIG ?? {};
const TOKEN_KEY = 'ahorrix.token';
const API_KEY = 'ahorrix.apiUrl';
const ALERT_KEY = 'ahorrix.alerts';
const ROUTES = ['inicio', 'movimientos', 'presupuestos', 'ajustes'];
const MAX_RECEIPT_BYTES = LIMITS.maxReceiptMb * 1024 * 1024;
const HISTORY_MONTHS = 6;

const view = $('#view');
const drawer = $('#drawer');

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  apiUrl: localStorage.getItem(API_KEY) || config.apiUrl || '/api',
  user: null,
  month: monthKey(),
  installPrompt: null,
  authMode: 'login',
};

let db;
let api;
let data;
let renderToken = 0;

/* ---------- utilidades ---------- */

const monthShort = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'short' }).replace('.', '');
};

function errorMessage(error) {
  if (error instanceof NetworkError) return 'Sin conexión. Los cambios se guardarán en este dispositivo.';
  if (error instanceof OfflineConversionError) return error.message;
  return error?.message || 'Ocurrió un error inesperado.';
}

function currentRoute() {
  const route = location.hash.replace('#/', '') || 'inicio';
  return ROUTES.includes(route) ? route : 'inicio';
}

function receiptUrl(path) {
  const origin = new URL(state.apiUrl, location.href).origin;
  return `${origin}/storage/${path}`;
}

function isOnline() {
  return navigator.onLine;
}

/**
 * Pinta la vista solo si sigue siendo la más reciente. Evita que una respuesta
 * lenta sobrescriba una navegación posterior.
 */
function paint(html, token, after) {
  if (token !== renderToken) return false;
  view.innerHTML = html;
  view.dataset.route = currentRoute();
  after?.();
  return true;
}

/* ---------- arranque, rutas y estado de conexión ---------- */

async function loadCurrencies() {
  let currencies = await db.getCatalog('currencies', []);
  if (!currencies.length && isOnline()) {
    try {
      currencies = await api.currencies();
      await db.setCatalog('currencies', currencies);
    } catch {
      currencies = [];
    }
  }
  return currencies;
}

async function render() {
  const nav = $('#nav');
  nav.hidden = !state.user;
  document.body.classList.toggle('is-authenticated', Boolean(state.user));

  const token = ++renderToken;

  if (!state.user) {
    view.dataset.route = 'auth';
    view.innerHTML = views.authView({ mode: state.authMode, currencies: await loadCurrencies() });
    return;
  }

  const route = currentRoute();
  document.querySelectorAll('[data-route]').forEach((link) => {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${views.routeTitle(route)} · Ahorrix`;

  const renderers = {
    inicio: renderHome,
    movimientos: renderMovements,
    presupuestos: renderBudgets,
    ajustes: renderSettings,
  };
  const skeletons = {
    inicio: views.homeSkeleton,
    movimientos: views.movementsSkeleton,
    presupuestos: views.budgetsSkeleton,
    ajustes: views.settingsSkeleton,
  };

  if (view.dataset.route !== route) view.innerHTML = skeletons[route]();

  try {
    await renderers[route](token);
  } catch (error) {
    if (token !== renderToken) return;
    view.innerHTML = views.emptyState({
      title: 'No pudimos cargar esta sección',
      text: errorMessage(error),
    });
  }
}

function updateConnection() {
  const online = isOnline();
  const badge = $('#connection');
  badge.textContent = online ? 'En línea' : 'Sin conexión';
  badge.classList.toggle('is-online', online);
  badge.classList.toggle('is-offline', !online);
}

async function updatePending() {
  if (!db || !data) return;
  const count = await data.pendingCount();
  const badge = $('#pending');
  badge.hidden = count === 0;
  badge.textContent = `${count} por sincronizar`;
}

async function refreshBadges() {
  updateConnection();
  await updatePending();
}

async function runSync({ silent = false } = {}) {
  if (!state.user || !isOnline()) return;

  try {
    const report = await data.sync();
    await refreshBadges();

    const changed = report.sent > 0 || report.failed > 0;
    if (!silent || report.failed > 0) {
      const detail = report.errors[0] ? ` ${report.errors[0]}` : '';
      const text = report.failed
        ? `Sincronizado: ${report.sent} enviado(s), ${report.failed} con error.${detail}`
        : `Sincronizado: ${report.sent} enviado(s).`;
      toast(text, { error: report.failed > 0 });
    }
    if (changed) await render();
  } catch (error) {
    if (!silent || !(error instanceof NetworkError)) toast(errorMessage(error), { error: true });
  } finally {
    await refreshBadges();
  }
}

function handleSessionExpired() {
  if (!state.token) return;
  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  toast('Tu sesión expiró. Inicia sesión de nuevo.', { error: true });
  render();
}

async function boot() {
  db = await openDatabase();
  api = createApiClient({
    baseUrl: state.apiUrl,
    getToken: () => state.token,
    onUnauthorized: handleSessionExpired,
  });
  data = createDataLayer({ api, db, isOnline });

  registerServiceWorker();
  setupInstall();

  if (state.token) {
    try {
      state.user = await api.me();
      await db.setCatalog('user', state.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        state.token = null;
        localStorage.removeItem(TOKEN_KEY);
      } else {
        // Sin red o con error del servidor: se usa la copia local del usuario.
        state.user = await db.getCatalog('user', null);
      }
    }
  }

  if (state.user) {
    try {
      await data.loadCatalogs();
    } catch (error) {
      if (!(error instanceof NetworkError)) console.warn('No se pudieron cargar los catálogos:', error);
    }
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('online', async () => {
    updateConnection();
    toast('Conexión restablecida. Sincronizando…');
    await runSync({ silent: true });
  });
  window.addEventListener('offline', () => {
    updateConnection();
    toast('Sin conexión. Puedes seguir registrando movimientos.');
    render();
  });

  await refreshBadges();
  if (!location.hash) location.hash = '#/inicio';
  await render();
  runSync({ silent: true });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('Service Worker no registrado:', error);
  });
}

function setupInstall() {
  const button = $('#btn-install');
  if (isStandalone()) return;

  listenInstallPrompt(
    (prompt) => {
      state.installPrompt = prompt;
      button.hidden = false;
    },
    () => {
      button.hidden = true;
      toast('Ahorrix se instaló correctamente.');
    }
  );

  button.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    const outcome = await state.installPrompt();
    if (outcome === 'accepted') button.hidden = true;
  });
}

/* ---------- autenticación ---------- */

async function handleAuth(form) {
  const values = formValues(form);
  const errors = validateCredentials({ ...values, mode: values.mode });

  if (values.mode === 'register' && !values.base_currency_code) {
    errors.base_currency_code = 'Selecciona una moneda base.';
  }

  const firstInvalid = applyErrors(form, errors);
  if (Object.keys(errors).length) {
    firstInvalid?.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true, values.mode === 'register' ? 'Creando cuenta…' : 'Entrando…');

  try {
    const response = values.mode === 'register'
      ? await api.register({
        name: values.name,
        email: values.email,
        password: values.password,
        base_currency_code: values.base_currency_code,
      })
      : await api.login({ email: values.email, password: values.password });

    state.token = response.token;
    state.user = response.user;
    localStorage.setItem(TOKEN_KEY, response.token);
    await db.setCatalog('user', response.user);
    await data.loadCatalogs();

    toast(`Bienvenido, ${response.user.name}`);
    location.hash = '#/inicio';
    await render();
    runSync({ silent: true });
  } catch (error) {
    if (error instanceof ApiError) applyErrors(form, { ...error.fieldErrors, form: error.message });
    else applyErrors(form, { form: errorMessage(error) });
  } finally {
    setBusy(submit, false);
  }
}

/* ---------- inicio ---------- */

async function renderHome(token) {
  const catalog = await data.getCatalogs();
  const summary = await data.getSummary(state.month, HISTORY_MONTHS);
  const base = catalog.user?.base_currency?.code ?? 'MXN';
  const money = (value) => formatMoney(value, base);

  const painted = paint(views.homeView({ month: state.month, summary, base }), token, () => {
    drawDonut($('#donut'), summary.by_category.map((s) => ({ label: s.name, value: s.total, color: s.color })), {
      centerLabel: 'Gastos',
      centerValue: money(summary.expense),
    });
    drawBars($('#bars'), summary.series.map((s) => ({
      label: monthShort(s.month),
      income: s.income,
      expense: s.expense,
    })));
  });

  if (painted) await checkBudgetAlerts(summary, money);
}

async function checkBudgetAlerts(summary, money) {
  const seen = JSON.parse(localStorage.getItem(ALERT_KEY) || '[]');
  const exceeded = summary.budgets.filter((b) => b.exceeded);

  for (const b of exceeded) {
    const key = `${summary.month}:${b.category_id}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    await notify('Presupuesto excedido', `${b.name}: llevas ${money(b.spent)} de ${money(b.budget)}.`, { tag: key });
    toast(`Excediste el presupuesto de ${b.name}.`, { error: true });
  }

  localStorage.setItem(ALERT_KEY, JSON.stringify(seen.slice(-200)));
}

async function shareMonth() {
  const catalog = await data.getCatalogs();
  const summary = await data.getSummary(state.month);
  const base = catalog.user?.base_currency?.code ?? 'MXN';
  const text = `Resumen de ${formatMonth(state.month)}: ingresos ${formatMoney(summary.income, base)}, gastos ${formatMoney(summary.expense, base)}, balance ${formatMoney(summary.balance, base)}.`;

  try {
    if (canShare() && await shareSummary({ title: 'Ahorrix', text })) return;
    await navigator.clipboard?.writeText(text);
    toast('Resumen copiado al portapapeles.');
  } catch (error) {
    if (error?.name !== 'AbortError') toast('No se pudo compartir el resumen.', { error: true });
  }
}

/* ---------- movimientos ---------- */

async function renderMovements(token) {
  const catalog = await data.getCatalogs();
  const items = await data.loadMonth(state.month);
  const typeById = new Map(catalog.categories.map((c) => [Number(c.id), typeOf(c)]));
  const baseCode = catalog.user?.base_currency?.code ?? 'MXN';

  paint(views.movementsView({ month: state.month, items, catalog, typeById, baseCode, receiptUrl }), token);
}

async function openTransactionForm(id = null) {
  const catalog = await data.getCatalogs();
  const existing = id ? (await db.getTransactions()).find((t) => String(t.id) === String(id)) : null;

  if (id && !existing) {
    toast('No se encontró el movimiento.', { error: true });
    return;
  }

  const base = catalog.user?.base_currency;
  const value = existing ?? {
    amount: '',
    currency_id: base?.id ?? '',
    account_id: catalog.accounts[0]?.id ?? '',
    category_id: '',
    transaction_date: todayISO(),
    description: '',
    latitude: '',
    longitude: '',
  };

  openDrawer(id ? 'Editar movimiento' : 'Nuevo movimiento', views.transactionForm({ value, catalog, id }));

  const geo = drawer.querySelector('[data-action="geo"]');
  if (geo && !hasGeolocation()) geo.disabled = true;

  drawer.querySelector('#f-amount')?.focus();
}

async function saveTransaction(form) {
  const catalog = await data.getCatalogs();
  const values = formValues(form);
  const file = form.elements.namedItem('receipt').files[0] ?? null;
  const refs = {
    accountIds: catalog.accounts.map((a) => Number(a.id)),
    categoryIds: catalog.categories.map((c) => Number(c.id)),
    currencyIds: catalog.currencies.map((c) => Number(c.id)),
  };

  const errors = validateTransaction(values, refs);
  if (file && !file.type.startsWith('image/')) errors.receipt = 'El archivo debe ser una imagen.';
  if (file && file.size > MAX_RECEIPT_BYTES) errors.receipt = `La imagen supera los ${LIMITS.maxReceiptMb} MB.`;

  const firstInvalid = applyErrors(form, errors);
  if (Object.keys(errors).length) {
    firstInvalid?.focus();
    return;
  }

  const id = form.dataset.id;
  const payload = {
    account_id: values.account_id,
    category_id: values.category_id,
    currency_id: values.currency_id,
    amount: values.amount,
    description: values.description,
    transaction_date: values.transaction_date,
    latitude: values.latitude,
    longitude: values.longitude,
  };

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true);

  try {
    if (id) await data.updateTransaction(id, payload, file);
    else await data.createTransaction(payload, file);

    closeDrawer();
    toast(isOnline() ? 'Movimiento guardado.' : 'Guardado en este dispositivo. Se sincronizará al volver la conexión.');
    await refreshBadges();
    await render();
  } catch (error) {
    if (error instanceof ApiError) applyErrors(form, { ...error.fieldErrors, form: error.message });
    else applyErrors(form, { form: errorMessage(error) });
  } finally {
    setBusy(submit, false);
  }
}

async function deleteTransaction(id) {
  try {
    await data.deleteTransaction(id);
    toast('Movimiento eliminado.');
    await refreshBadges();
    await render();
  } catch (error) {
    toast(errorMessage(error), { error: true });
  }
}

async function useLocation(form) {
  const status = form.querySelector('#geo-status');
  status.textContent = 'Obteniendo ubicación…';
  try {
    const { latitude, longitude } = await getPosition();
    form.elements.namedItem('latitude').value = latitude;
    form.elements.namedItem('longitude').value = longitude;
    status.textContent = `Lat ${latitude}, Lng ${longitude}`;
    if (!form.querySelector('[data-action="geo-clear"]')) {
      form.querySelector('[data-action="geo"]').insertAdjacentHTML(
        'afterend',
        '<button class="btn btn-ghost" type="button" data-action="geo-clear">Quitar</button>'
      );
    }
  } catch (error) {
    status.textContent = 'Sin ubicación asignada.';
    toast(error.message, { error: true });
  }
}

function previewReceipt(input) {
  const preview = document.querySelector('#receipt-preview');
  const file = input.files[0];
  if (!file || !file.type.startsWith('image/')) {
    preview.hidden = true;
    preview.removeAttribute('src');
    return;
  }
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  preview.dataset.url = URL.createObjectURL(file);
  preview.src = preview.dataset.url;
  preview.hidden = false;
}

/* ---------- presupuestos ---------- */

async function renderBudgets(token) {
  const catalog = await data.getCatalogs();
  const summary = await data.getSummary(state.month);
  const budgets = await data.loadBudgets(state.month);

  paint(views.budgetsView({
    month: state.month,
    budgets,
    summary,
    categories: catalog.categories,
    online: isOnline(),
  }), token);
}

async function saveBudget(form) {
  const catalog = await data.getCatalogs();
  const values = formValues(form);
  const expenseIds = catalog.categories.filter((c) => typeOf(c) === TYPES.EXPENSE).map((c) => Number(c.id));
  const errors = validateBudget({ ...values, month: state.month }, expenseIds);

  const firstInvalid = applyErrors(form, errors);
  if (Object.keys(errors).length) {
    firstInvalid?.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true);

  try {
    await api.createBudget({ category_id: values.category_id, month: state.month, amount: values.amount });
    await db.setCatalog(`budgets:${state.month}`, await api.budgets(state.month));
    toast('Presupuesto guardado.');
    await render();
  } catch (error) {
    if (error instanceof ApiError) applyErrors(form, { ...error.fieldErrors, form: error.message });
    else applyErrors(form, { form: errorMessage(error) });
  } finally {
    setBusy(submit, false);
  }
}

async function deleteBudget(id) {
  try {
    await api.deleteBudget(id);
    toast('Presupuesto eliminado.');
    await render();
  } catch (error) {
    toast(errorMessage(error), { error: true });
  }
}

/* ---------- ajustes ---------- */

async function renderSettings(token) {
  const catalog = await data.getCatalogs();
  const lastSync = await db.getMeta('lastSync', null);
  const pending = await data.pendingCount();
  const notifState = hasNotifications() ? Notification.permission : 'unsupported';

  paint(views.settingsView({
    catalog,
    lastSync,
    pending,
    online: isOnline(),
    notifState,
    geolocation: hasGeolocation(),
    standalone: isStandalone(),
    apiUrl: state.apiUrl,
  }), token);
}

async function saveCategory(form) {
  const catalog = await data.getCatalogs();
  const values = formValues(form);
  const errors = validateCategory(values, catalog.transactionTypes.map((t) => Number(t.id)));

  const firstInvalid = applyErrors(form, errors);
  if (Object.keys(errors).length) {
    firstInvalid?.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true);

  try {
    await api.createCategory({ name: values.name, transaction_type_id: values.transaction_type_id, color: values.color });
    await data.refreshCatalogs();
    toast('Categoría creada.');
    await render();
  } catch (error) {
    if (error instanceof ApiError) applyErrors(form, { ...error.fieldErrors, form: error.message });
    else applyErrors(form, { form: errorMessage(error) });
  } finally {
    setBusy(submit, false);
  }
}

async function saveAccount(form) {
  const catalog = await data.getCatalogs();
  const values = formValues(form);
  const errors = validateAccount(values, catalog.currencies.map((c) => Number(c.id)));

  const firstInvalid = applyErrors(form, errors);
  if (Object.keys(errors).length) {
    firstInvalid?.focus();
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true);

  try {
    await api.createAccount({
      name: values.name,
      currency_id: values.currency_id,
      initial_balance: values.initial_balance || 0,
    });
    await data.refreshCatalogs();
    toast('Cuenta creada.');
    await render();
  } catch (error) {
    if (error instanceof ApiError) applyErrors(form, { ...error.fieldErrors, form: error.message });
    else applyErrors(form, { form: errorMessage(error) });
  } finally {
    setBusy(submit, false);
  }
}

async function deleteCatalogItem(kind, id) {
  try {
    if (kind === 'category') await api.deleteCategory(id);
    else await api.deleteAccount(id);
    await data.refreshCatalogs();
    toast('Eliminado.');
    await render();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : errorMessage(error), { error: true });
  }
}

async function logout() {
  const pending = await data.pendingCount();
  if (pending && !window.confirm(`Tienes ${pending} cambio(s) sin sincronizar que se perderán. ¿Cerrar sesión?`)) return;

  try {
    if (isOnline()) await api.logout();
  } catch {
    // Si el servidor no responde, igual se cierra la sesión local.
  }

  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  await db.clearAll();
  location.hash = '#/inicio';
  await render();
  await refreshBadges();
  toast('Sesión cerrada.');
}

/* ---------- eventos ---------- */

function markRow(target, state) {
  const row = target.closest('[data-deletable]');
  if (!row) return null;
  row.dataset.state = state;
  return row;
}

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const { action } = target.dataset;

  try {
    switch (action) {
      case 'auth-mode':
        state.authMode = target.dataset.mode;
        await render();
        break;
      case 'month':
        state.month = shiftMonth(state.month, Number(target.dataset.delta));
        await render();
        break;
      case 'new-tx':
        await openTransactionForm();
        break;
      case 'edit-tx':
        await openTransactionForm(target.dataset.id);
        break;
      case 'close-drawer':
        closeDrawer();
        break;
      case 'geo':
        await useLocation(target.closest('form'));
        break;
      case 'geo-clear': {
        const form = target.closest('form');
        form.elements.namedItem('latitude').value = '';
        form.elements.namedItem('longitude').value = '';
        form.querySelector('#geo-status').textContent = 'Sin ubicación asignada.';
        target.remove();
        break;
      }
      case 'share-summary':
        await shareMonth();
        break;
      case 'edit-budget': {
        const form = $('#budget-form');
        form.elements.namedItem('category_id').value = target.dataset.category;
        form.elements.namedItem('amount').value = target.dataset.amount;
        form.elements.namedItem('amount').focus();
        break;
      }
      case 'ask-delete': {
        const row = markRow(target, 'confirm');
        row?.querySelector('[data-action="confirm-delete"]')?.focus();
        break;
      }
      case 'cancel-delete': {
        const row = markRow(target, '');
        row?.querySelector('[data-action="ask-delete"]')?.focus();
        break;
      }
      case 'confirm-delete': {
        const { kind, id } = target.dataset;
        if (kind === 'transaction') await deleteTransaction(id);
        else if (kind === 'budget') await deleteBudget(id);
        else await deleteCatalogItem(kind, id);
        break;
      }
      case 'sync':
        target.disabled = true;
        await runSync();
        break;
      case 'enable-notifications': {
        const result = await requestNotificationPermission();
        toast(result === 'granted' ? 'Notificaciones activadas.' : 'Las notificaciones no fueron permitidas.', { error: result !== 'granted' });
        await render();
        break;
      }
      case 'logout':
        await logout();
        break;
      default:
        break;
    }
  } catch (error) {
    toast(errorMessage(error), { error: true });
  }
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  switch (form.dataset.form) {
    case 'auth':
      await handleAuth(form);
      break;
    case 'transaction':
      await saveTransaction(form);
      break;
    case 'budget':
      await saveBudget(form);
      break;
    case 'category':
      await saveCategory(form);
      break;
    case 'account':
      await saveAccount(form);
      break;
    case 'server': {
      const values = formValues(form);
      try {
        const url = new URL(values.apiUrl);
        localStorage.setItem(API_KEY, url.toString().replace(/\/$/, ''));
        location.reload();
      } catch {
        applyErrors(form, { apiUrl: 'Escribe una URL válida, por ejemplo https://tu-tunel.trycloudflare.com/api' });
      }
      break;
    }
    default:
      break;
  }
}

function onChange(event) {
  if (event.target.matches('input[type="file"][name="receipt"]')) {
    previewReceipt(event.target);
  }
}

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) closeDrawer();
});
$('#drawer-close').addEventListener('click', closeDrawer);

boot().catch((error) => {
  view.innerHTML = views.emptyState({
    title: 'No se pudo iniciar Ahorrix',
    text: error.message,
  });
});
