import { describe, expect, it } from 'vitest';
import {
  authView,
  budgetsView,
  homeView,
  movementsView,
  settingsView,
  transactionForm,
} from '../../js/views.js';

const MXN = { id: 1, code: 'MXN', name: 'Peso mexicano', symbol: '$' };
const categories = [
  { id: 10, name: 'Comida', color: '#ef4444', transactionType: { name: 'egreso' } },
  { id: 11, name: 'Salario', color: '#22c55e', transactionType: { name: 'ingreso' } },
];
const catalog = {
  categories,
  accounts: [{ id: 20, name: 'Efectivo', currency: MXN }],
  currencies: [MXN],
  transactionTypes: [{ id: 1, name: 'egreso' }, { id: 2, name: 'ingreso' }],
  user: { id: 1, name: 'Ana', email: 'ana@test.com', base_currency: MXN },
};
const typeById = new Map(categories.map((c) => [Number(c.id), c.transactionType.name]));

const count = (html, pattern) => (html.match(pattern) ?? []).length;

describe('una sola acción primaria por vista', () => {
  it('inicio tiene exactamente un botón primario', () => {
    const html = homeView({
      month: '2026-11',
      base: 'MXN',
      summary: { income: 0, expense: 0, balance: 0, by_category: [], budgets: [], series: [] },
    });

    expect(count(html, /class="btn btn-primary"/g)).toBe(1);
  });

  it('movimientos muestra el CTA primario también cuando no hay datos', () => {
    const empty = movementsView({ month: '2026-11', items: [], catalog, typeById, baseCode: 'MXN', receiptUrl: () => '' });
    const full = movementsView({
      month: '2026-11',
      items: [{ id: 1, category_id: 10, amount: '10.00', transaction_date: '2026-11-02', account: { name: 'Efectivo' } }],
      catalog,
      typeById,
      baseCode: 'MXN',
      receiptUrl: () => '',
    });

    expect(count(empty, /class="btn btn-primary"/g)).toBe(1);
    expect(count(full, /class="btn btn-primary"/g)).toBe(1);
  });
});

describe('estados vacíos', () => {
  it('movimientos sin datos explica por qué y ofrece una acción', () => {
    const html = movementsView({ month: '2026-11', items: [], catalog, typeById, baseCode: 'MXN', receiptUrl: () => '' });

    expect(html).toMatch(/Sin movimientos en noviembre de 2026/i);
    expect(html).toContain('Registrar movimiento');
    expect(html).not.toContain('<table');
  });

  it('presupuestos sin datos no muestra tabla vacía', () => {
    const html = budgetsView({
      month: '2026-11',
      budgets: [],
      summary: { budgets: [] },
      categories,
      online: true,
    });

    expect(html).toContain('Sin presupuestos para este mes');
    expect(html).not.toContain('class="budget-list"');
  });
});

describe('seguridad y escape', () => {
  it('escapa descripciones con etiquetas HTML', () => {
    const html = movementsView({
      month: '2026-11',
      items: [{
        id: 1,
        category_id: 10,
        amount: '10.00',
        description: '<img src=x onerror="alert(1)">',
        transaction_date: '2026-11-02',
        account: { name: 'Efectivo' },
      }],
      catalog,
      typeById,
      baseCode: 'MXN',
      receiptUrl: () => '',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapa nombres de categoría en ajustes', () => {
    const html = settingsView({
      catalog: { ...catalog, categories: [{ ...categories[0], name: '<script>x</script>' }] },
      lastSync: null,
      pending: 0,
      online: true,
      notifState: 'default',
      geolocation: true,
      standalone: false,
      apiUrl: 'http://api.test/api',
    });

    expect(html).not.toContain('<script>x</script>');
  });
});

describe('registro', () => {
  it('la moneda base se envía por código (MXN), no por id', () => {
    const html = authView({ mode: 'register', currencies: [MXN, { id: 2, code: 'USD', name: 'Dólar' }] });

    expect(html).toMatch(/<option value="MXN"/);
    expect(html).toMatch(/<option value="USD"/);
    expect(html).not.toMatch(/<option value="1"/);
  });
});

describe('estados sin conexión', () => {
  it('desactiva guardar presupuesto y eliminar categorías sin conexión', () => {
    const budgets = budgetsView({ month: '2026-11', budgets: [], summary: { budgets: [] }, categories, online: false });
    const settings = settingsView({
      catalog,
      lastSync: null,
      pending: 2,
      online: false,
      notifState: 'granted',
      geolocation: true,
      standalone: true,
      apiUrl: 'http://api.test/api',
    });

    expect(budgets).toMatch(/<button class="btn btn-primary" type="submit" disabled>Guardar<\/button>/);
    expect(settings).not.toContain('data-action="confirm-delete"');
  });
});

describe('formulario de movimiento', () => {
  it('cada campo obligatorio tiene etiqueta visible y su zona de error', () => {
    const html = transactionForm({
      value: { amount: '', currency_id: 1, account_id: 20, category_id: '', transaction_date: '2026-11-10', description: '' },
      catalog,
      id: null,
    });

    expect(html).toMatch(/<label for="f-amount">Monto<\/label>/);
    expect(html).toMatch(/<small class="error" data-error="amount"><\/small>/);
    expect(html).toContain('data-form="transaction"');
  });

  it('el botón de ubicación solo aparece como quitar cuando hay coordenadas', () => {
    const without = transactionForm({ value: { amount: '1', latitude: '', longitude: '', transaction_date: '2026-11-10' }, catalog, id: null });
    const withLocation = transactionForm({ value: { amount: '1', latitude: '19.4', longitude: '-99.1', transaction_date: '2026-11-10' }, catalog, id: null });

    expect(without).not.toContain('data-action="geo-clear"');
    expect(withLocation).toContain('data-action="geo-clear"');
  });
});
