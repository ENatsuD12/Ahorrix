import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../js/api.js';
import { OfflineConversionError, createDataLayer } from '../../js/data.js';
import { openDatabase } from '../../js/db.js';

const MXN = { id: 1, code: 'MXN', name: 'Peso mexicano', symbol: '$' };
const USD = { id: 2, code: 'USD', name: 'Dólar', symbol: 'US$' };

function fakeApi(overrides = {}) {
  return {
    categories: vi.fn(async () => []),
    accounts: vi.fn(async () => []),
    currencies: vi.fn(async () => []),
    transactionTypes: vi.fn(async () => []),
    createTransaction: vi.fn(async (payload) => ({ id: 100, ...payload, amount_base: payload.amount })),
    updateTransaction: vi.fn(async (id, payload) => ({ id, ...payload })),
    deleteTransaction: vi.fn(async () => null),
    syncTransactions: vi.fn(async (items) => ({
      results: items.map((i) => ({ client_uuid: i.client_uuid, status: 'created', id: 500 })),
    })),
    exchangeRate: vi.fn(async () => ({ rate: 17.5 })),
    allTransactions: vi.fn(async () => []),
    summary: vi.fn(),
    budgets: vi.fn(async () => []),
    ...overrides,
  };
}

async function seedCatalog(db) {
  await db.setCatalog('currencies', [MXN, USD]);
  await db.setCatalog('accounts', [{ id: 20, name: 'Efectivo', currency: MXN }]);
  await db.setCatalog('categories', [
    { id: 10, name: 'Comida', color: '#ef4444', transactionType: { name: 'egreso' } },
    { id: 11, name: 'Salario', color: '#22c55e', transactionType: { name: 'ingreso' } },
  ]);
  await db.setCatalog('transactionTypes', [{ id: 1, name: 'ingreso' }, { id: 2, name: 'egreso' }]);
  await db.setCatalog('user', { id: 1, name: 'Ana', base_currency: MXN });
  await db.setMeta('pulledMonths', ['2026-11']);
}

const offline = () => false;
const online = () => true;

const payload = (overrides = {}) => ({
  account_id: '20',
  category_id: '10',
  currency_id: '1',
  amount: '120.5',
  description: 'Tacos',
  transaction_date: '2026-11-10',
  latitude: '',
  longitude: '',
  ...overrides,
});

let db;

beforeEach(async () => {
  db = await openDatabase(`data-${Math.random()}`, new IDBFactory());
  await seedCatalog(db);
});

describe('capa de datos: modo sin conexión', () => {
  it('guarda el movimiento localmente y lo encola sin llamar a la API', async () => {
    const api = fakeApi();
    const data = createDataLayer({ api, db, isOnline: offline });

    const local = await data.createTransaction(payload());

    expect(api.createTransaction).not.toHaveBeenCalled();
    expect(local.local).toBe(true);
    expect(local.amount_base).toBe(120.5);
    expect(local.account.name).toBe('Efectivo');

    const pending = await db.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ op: 'create', id: String(local.id) });
    expect(pending[0].payload.client_uuid).toBe(local.client_uuid);
    expect((await db.getTransactions())).toHaveLength(1);
  });

  it('convierte con el tipo de cambio guardado en caché', async () => {
    await db.setMeta('rate:USD:MXN', { rate: 18 });
    const data = createDataLayer({ api: fakeApi(), db, isOnline: offline });

    const local = await data.createTransaction(payload({ currency_id: '2', amount: '10' }));

    expect(local.exchange_rate).toBe(18);
    expect(local.amount_base).toBe(180);
  });

  it('no permite registrar moneda extranjera sin tipo de cambio en caché', async () => {
    const data = createDataLayer({ api: fakeApi(), db, isOnline: offline });

    await expect(data.createTransaction(payload({ currency_id: '2' })))
      .rejects.toBeInstanceOf(OfflineConversionError);
    expect(await db.getPending()).toEqual([]);
  });

  it('editar un movimiento pendiente combina los cambios en la misma operación', async () => {
    const data = createDataLayer({ api: fakeApi(), db, isOnline: offline });
    const local = await data.createTransaction(payload());

    await data.updateTransaction(local.id, payload({ amount: '50', description: 'Cena' }));

    const pending = await db.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].op).toBe('create');
    expect(pending[0].payload.amount).toBe('50.00');
    expect(pending[0].payload.description).toBe('Cena');
  });

  it('eliminar un movimiento que solo existe localmente no deja rastro', async () => {
    const api = fakeApi();
    const data = createDataLayer({ api, db, isOnline: offline });
    const local = await data.createTransaction(payload());

    await data.deleteTransaction(local.id);

    expect(await db.getPending()).toEqual([]);
    expect(await db.getTransactions()).toEqual([]);
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });

  it('eliminar un movimiento del servidor sin conexión se encola como borrado', async () => {
    await db.putTransactions([{ id: 7, transaction_date: '2026-11-03', amount_base: 10, category_id: 10 }]);
    const data = createDataLayer({ api: fakeApi(), db, isOnline: offline });

    await data.deleteTransaction(7);

    expect(await db.getTransactions()).toEqual([]);
    expect(await db.getPending()).toEqual([expect.objectContaining({ op: 'delete', id: '7' })]);
  });

  it('calcula el resumen del mes con los datos locales', async () => {
    await db.putTransactions([
      { id: 1, category_id: 10, amount_base: 300, transaction_date: '2026-11-02' },
      { id: 2, category_id: 11, amount_base: 1000, transaction_date: '2026-11-01' },
    ]);
    await db.setCatalog('budgets:2026-11', [{ category_id: 10, month: '2026-11-01', amount: '250' }]);
    const data = createDataLayer({ api: fakeApi(), db, isOnline: offline });

    const summary = await data.getSummary('2026-11');

    expect(summary).toMatchObject({ income: 1000, expense: 300, balance: 700, currency: 'MXN' });
    expect(summary.budgets[0]).toMatchObject({ exceeded: true, spent: 300 });
  });
});

describe('capa de datos: modo en línea', () => {
  it('crea el movimiento directamente en la API', async () => {
    const api = fakeApi();
    const data = createDataLayer({ api, db, isOnline: online });

    const saved = await data.createTransaction(payload());

    expect(api.createTransaction).toHaveBeenCalledOnce();
    expect(saved.id).toBe(100);
    expect(await db.getPending()).toEqual([]);
    expect((await db.getTransactions()).map((t) => t.id)).toEqual([100]);
  });

  it('si la red falla al crear, guarda y encola el movimiento', async () => {
    const api = fakeApi({ createTransaction: vi.fn(async () => { throw new NetworkError(); }) });
    const data = createDataLayer({ api, db, isOnline: online });

    const local = await data.createTransaction(payload());

    expect(local.local).toBe(true);
    expect(await db.getPending()).toHaveLength(1);
  });

  it('los errores de validación del servidor no se encolan', async () => {
    const api = fakeApi({
      createTransaction: vi.fn(async () => { throw new ApiError(422, 'Datos inválidos.'); }),
    });
    const data = createDataLayer({ api, db, isOnline: online });

    await expect(data.createTransaction(payload())).rejects.toBeInstanceOf(ApiError);
    expect(await db.getPending()).toEqual([]);
  });

  it('carga el mes desde la API y lo guarda en caché', async () => {
    const api = fakeApi({
      allTransactions: vi.fn(async () => [
        { id: 3, category_id: 10, amount_base: '45.00', transaction_date: '2026-11-04' },
      ]),
    });
    const data = createDataLayer({ api, db, isOnline: online });

    const items = await data.loadMonth('2026-11');

    expect(api.allTransactions).toHaveBeenCalledWith('2026-11');
    expect(items.map((t) => t.id)).toEqual([3]);
  });
});

describe('capa de datos: sincronización', () => {
  it('envía los movimientos pendientes en lote y limpia la cola', async () => {
    const api = fakeApi();
    const data = createDataLayer({ api, db, isOnline: offline });
    await data.createTransaction(payload());
    await data.createTransaction(payload({ description: 'Café' }));

    const connected = createDataLayer({ api, db, isOnline: online });
    const report = await connected.sync();

    expect(api.syncTransactions).toHaveBeenCalledOnce();
    expect(api.syncTransactions.mock.calls[0][0]).toHaveLength(2);
    expect(report).toMatchObject({ sent: 2, failed: 0 });
    expect(await db.getPending()).toEqual([]);
    expect(api.allTransactions).toHaveBeenCalledWith('2026-11');
  });

  it('aplica borrados y ediciones pendientes contra el servidor', async () => {
    await db.putTransactions([{ id: 7, category_id: 10, amount_base: 10, transaction_date: '2026-11-03' }]);
    const api = fakeApi();
    const offlineLayer = createDataLayer({ api, db, isOnline: offline });
    await offlineLayer.deleteTransaction(7);

    const report = await createDataLayer({ api, db, isOnline: online }).sync();

    expect(api.deleteTransaction).toHaveBeenCalledWith('7');
    expect(report.sent).toBe(1);
  });

  it('si no hay red durante la sincronización conserva la cola', async () => {
    const api = fakeApi({ syncTransactions: vi.fn(async () => { throw new NetworkError(); }) });
    const data = createDataLayer({ api, db, isOnline: offline });
    await data.createTransaction(payload());

    await expect(createDataLayer({ api, db, isOnline: online }).sync()).rejects.toBeInstanceOf(NetworkError);
    expect(await db.getPending()).toHaveLength(1);
  });

  it('reporta los errores del servidor sin bloquear la cola', async () => {
    const api = fakeApi({
      syncTransactions: vi.fn(async (items) => ({
        results: items.map((i) => ({ client_uuid: i.client_uuid, status: 'error', message: 'Tipo de cambio no disponible.' })),
      })),
    });
    const data = createDataLayer({ api, db, isOnline: offline });
    await data.createTransaction(payload());

    const report = await createDataLayer({ api, db, isOnline: online }).sync();

    expect(report.failed).toBe(1);
    expect(report.errors).toEqual(['Tipo de cambio no disponible.']);
    expect(await db.getPending()).toEqual([]);
  });

  it('reutiliza la misma sincronización si se llama varias veces a la vez', async () => {
    const api = fakeApi();
    const data = createDataLayer({ api, db, isOnline: offline });
    await data.createTransaction(payload());

    const connected = createDataLayer({ api, db, isOnline: online });
    const [a, b] = await Promise.all([connected.sync(), connected.sync()]);

    expect(a).toBe(b);
    expect(api.syncTransactions).toHaveBeenCalledOnce();
  });
});
