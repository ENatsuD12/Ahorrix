import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApiClient } from '../../js/api.js';
import { createDataLayer } from '../../js/data.js';
import { openDatabase } from '../../js/db.js';

const MXN = { id: 1, code: 'MXN', name: 'Peso mexicano', symbol: '$' };

function fakeApi(overrides = {}) {
  return {
    categories: vi.fn(async () => []),
    accounts: vi.fn(async () => []),
    currencies: vi.fn(async () => []),
    transactionTypes: vi.fn(async () => []),
    createTransaction: vi.fn(async (payload) => ({ id: 100, ...payload })),
    updateTransaction: vi.fn(async (id, payload) => ({ id, ...payload })),
    deleteTransaction: vi.fn(async () => null),
    syncTransactions: vi.fn(async (items) => ({
      results: items.map((i) => ({ client_uuid: i.client_uuid, status: 'created', id: 500 })),
    })),
    exchangeRate: vi.fn(async () => ({ rate: 1 })),
    allTransactions: vi.fn(async () => []),
    summary: vi.fn(async () => ({ month: '2026-11', series: [] })),
    budgets: vi.fn(async () => []),
    ...overrides,
  };
}

const payload = (overrides = {}) => ({
  account_id: '20',
  category_id: '10',
  currency_id: '1',
  amount: '50',
  description: 'Café',
  transaction_date: '2026-11-10',
  latitude: '',
  longitude: '',
  ...overrides,
});

let db;

beforeEach(async () => {
  db = await openDatabase(`opt-${Math.random()}`, new IDBFactory());
  await db.setCatalog('currencies', [MXN]);
  await db.setCatalog('accounts', [{ id: 20, name: 'Efectivo', currency: MXN }]);
  await db.setCatalog('categories', [{ id: 10, name: 'Comida', color: '#ef4444', transactionType: { name: 'egreso' } }]);
  await db.setCatalog('user', { id: 1, name: 'Ana', base_currency: MXN });
  await db.setMeta('pulledMonths', ['2026-11']);
});

describe('resumen: una sola petición en línea', () => {
  it('pide al servidor el resumen con la serie y no solicita presupuestos aparte', async () => {
    const api = fakeApi({ summary: vi.fn(async () => ({ month: '2026-11', series: [{ month: '2026-11' }] })) });
    const data = createDataLayer({ api, db, isOnline: () => true });

    const summary = await data.getSummary('2026-11', 6);

    expect(api.summary).toHaveBeenCalledWith('2026-11', 6);
    expect(api.budgets).not.toHaveBeenCalled();
    expect(summary.series).toEqual([{ month: '2026-11' }]);
  });

  it('con cambios pendientes calcula el resumen localmente aunque haya conexión', async () => {
    const api = fakeApi();
    await createDataLayer({ api, db, isOnline: () => false }).createTransaction(payload());

    const summary = await createDataLayer({ api, db, isOnline: () => true }).getSummary('2026-11', 2);

    expect(api.summary).not.toHaveBeenCalled();
    expect(summary.series).toHaveLength(2);
    expect(summary.expense).toBe(50);
  });

  it('sin conexión genera la serie desde la caché local', async () => {
    await db.putTransactions([{ id: 1, category_id: 10, amount_base: 75, transaction_date: '2026-10-04' }]);
    const data = createDataLayer({ api: fakeApi(), db, isOnline: () => false });

    const summary = await data.getSummary('2026-11', 2);

    expect(summary.series).toEqual([
      { month: '2026-10', income: 0, expense: 75 },
      { month: '2026-11', income: 0, expense: 0 },
    ]);
  });
});

describe('sincronización: conteo y errores', () => {
  it('un movimiento que ya existía en el servidor cuenta como enviado', async () => {
    const api = fakeApi({
      syncTransactions: vi.fn(async (items) => ({
        results: items.map((i) => ({ client_uuid: i.client_uuid, status: 'exists', id: 9 })),
      })),
    });
    await createDataLayer({ api, db, isOnline: () => false }).createTransaction(payload());

    const report = await createDataLayer({ api, db, isOnline: () => true }).sync();

    expect(report).toMatchObject({ sent: 1, failed: 0 });
    expect(await db.getPending()).toEqual([]);
  });

  it('conserva el mensaje de error del servidor en el informe', async () => {
    const api = fakeApi({
      syncTransactions: vi.fn(async (items) => ({
        results: items.map((i) => ({ client_uuid: i.client_uuid, status: 'error', message: 'Sin tipo de cambio.' })),
      })),
    });
    await createDataLayer({ api, db, isOnline: () => false }).createTransaction(payload());

    const report = await createDataLayer({ api, db, isOnline: () => true }).sync();

    expect(report.errors).toEqual(['Sin tipo de cambio.']);
  });
});

describe('cliente de API: paginación y resumen', () => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  it('pide páginas de 100 movimientos', async () => {
    const fetch = vi.fn(async () => json({ data: [], last_page: 1 }));
    globalThis.fetch = fetch;
    const api = createApiClient({ baseUrl: 'http://api.test/api', getToken: () => 'x' });

    await api.allTransactions('2026-11');

    expect(fetch.mock.calls[0][0]).toContain('per_page=100');
  });

  it('envía el número de meses de la serie solo como parámetro', async () => {
    const fetch = vi.fn(async () => json({ month: '2026-11' }));
    globalThis.fetch = fetch;
    const api = createApiClient({ baseUrl: 'http://api.test/api', getToken: () => 'x' });

    await api.summary('2026-11', 6);

    expect(fetch.mock.calls[0][0]).toBe('http://api.test/api/summary?month=2026-11&months=6');
  });

  it('propaga el error de validación del servidor como ApiError', async () => {
    globalThis.fetch = vi.fn(async () => json({ message: 'Inválido', errors: { amount: ['Monto inválido.'] } }, 422));
    const api = createApiClient({ baseUrl: 'http://api.test/api', getToken: () => 'x' });

    const error = await api.createTransaction({ amount: '0' }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(NetworkError);
  });
});
