import { ApiError, NetworkError } from './api.js';
import { computeSummary, monthKey, round2, uuid } from './domain.js';

const TX_FIELDS = [
  'account_id',
  'category_id',
  'currency_id',
  'amount',
  'description',
  'transaction_date',
  'latitude',
  'longitude',
];

export class OfflineConversionError extends Error {
  constructor(code) {
    super(`Se necesita conexión para convertir ${code} a tu moneda base.`);
    this.name = 'OfflineConversionError';
  }
}

function pickTransaction(input) {
  const out = {};
  for (const field of TX_FIELDS) {
    const value = input[field];
    out[field] = value === '' || value === undefined ? null : value;
  }
  out.account_id = Number(out.account_id);
  out.category_id = Number(out.category_id);
  out.currency_id = Number(out.currency_id);
  out.amount = Number(out.amount).toFixed(2);
  out.latitude = out.latitude === null ? null : Number(out.latitude);
  out.longitude = out.longitude === null ? null : Number(out.longitude);
  return out;
}

/**
 * Capa de datos "offline first": si hay conexión llama a la API; si no, guarda
 * localmente en IndexedDB y encola la operación para sincronizarla después.
 */
export function createDataLayer({ api, db, isOnline = () => navigator.onLine }) {
  let syncing = null;

  async function getCatalogs() {
    return {
      categories: await db.getCatalog('categories', []),
      accounts: await db.getCatalog('accounts', []),
      currencies: await db.getCatalog('currencies', []),
      transactionTypes: await db.getCatalog('transactionTypes', []),
      user: await db.getCatalog('user', null),
    };
  }

  async function refreshCatalogs() {
    const [categories, accounts, currencies, transactionTypes] = await Promise.all([
      api.categories(),
      api.accounts(),
      api.currencies(),
      api.transactionTypes(),
    ]);
    await db.setCatalog('categories', categories);
    await db.setCatalog('accounts', accounts);
    await db.setCatalog('currencies', currencies);
    await db.setCatalog('transactionTypes', transactionTypes);
  }

  async function loadCatalogs() {
    if (isOnline()) {
      try {
        await refreshCatalogs();
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }
    return getCatalogs();
  }

  async function localRate(currency, base) {
    if (!currency || !base || currency.id === base.id) return 1;

    const cached = await db.getMeta(`rate:${currency.code}:${base.code}`);
    if (cached) return cached.rate;

    throw new OfflineConversionError(currency.code);
  }

  async function ensureRate(currency, base) {
    if (!currency || !base || currency.id === base.id || !isOnline()) return;

    try {
      const { rate } = await api.exchangeRate(currency.code, base.code);
      await db.setMeta(`rate:${currency.code}:${base.code}`, { rate, at: Date.now() });
    } catch (error) {
      if (!(error instanceof NetworkError) && !(error instanceof ApiError)) throw error;
    }
  }

  async function buildLocal(id, payload, catalog) {
    const currency = catalog.currencies.find((c) => c.id === payload.currency_id);
    const category = catalog.categories.find((c) => c.id === payload.category_id);
    const account = catalog.accounts.find((a) => a.id === payload.account_id);
    const rate = await localRate(currency, catalog.user?.base_currency);

    return {
      id,
      client_uuid: payload.client_uuid ?? null,
      local: true,
      ...payload,
      exchange_rate: rate,
      amount_base: round2(Number(payload.amount) * rate),
      category: category ? { id: category.id, name: category.name, color: category.color } : null,
      categoryType: category?.transactionType?.name ?? null,
      account: account ? { id: account.id, name: account.name } : null,
      currency: currency ? { id: currency.id, code: currency.code, symbol: currency.symbol } : null,
    };
  }

  async function createTransaction(input, receipt = null) {
    const catalog = await getCatalogs();
    const payload = { ...pickTransaction(input), client_uuid: uuid() };

    if (isOnline()) {
      const currency = catalog.currencies.find((c) => c.id === payload.currency_id);
      await ensureRate(currency, catalog.user?.base_currency);

      try {
        const saved = await api.createTransaction(payload, receipt);
        await db.putTransactions([saved]);
        return saved;
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }

    const local = await buildLocal(payload.client_uuid, payload, catalog);
    await db.putTransactions([local]);
    await db.addPending({ op: 'create', id: String(payload.client_uuid), payload, receipt });
    return local;
  }

  async function updateTransaction(id, input, receipt = null) {
    const catalog = await getCatalogs();
    const all = await db.getTransactions();
    const existing = all.find((t) => String(t.id) === String(id));

    if (!existing) throw new ApiError(404, 'Movimiento no encontrado.');

    const payload = {
      ...pickTransaction({ ...existing, ...input }),
      ...(existing.client_uuid ? { client_uuid: existing.client_uuid } : {}),
    };

    const pending = (await db.getPending()).filter((p) => p.id === String(id) && p.op !== 'delete');
    const pendingCreate = pending.find((p) => p.op === 'create');

    if (isOnline() && !pendingCreate && pending.length === 0) {
      try {
        const saved = await api.updateTransaction(id, payload, receipt);
        await db.putTransactions([saved]);
        return saved;
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }

    const local = await buildLocal(existing.id, payload, catalog);
    await db.putTransactions([local]);

    if (pending.length) {
      for (const op of pending) {
        await db.updatePending(op.seq, {
          payload: { ...op.payload, ...payload },
          receipt: receipt ?? op.receipt,
        });
      }
    } else {
      await db.addPending({ op: 'update', id: String(id), payload, receipt });
    }

    return local;
  }

  async function deleteTransaction(id) {
    const pending = (await db.getPending()).filter((p) => p.id === String(id));
    const wasLocalOnly = pending.some((p) => p.op === 'create');

    await db.deleteTransaction(id);

    for (const op of pending) await db.removePending(op.seq);
    if (wasLocalOnly) return;

    if (isOnline()) {
      try {
        await api.deleteTransaction(id);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        if (!(error instanceof NetworkError)) throw error;
      }
    }

    await db.addPending({ op: 'delete', id: String(id) });
  }

  async function pullMonth(month) {
    const serverItems = await api.allTransactions(month);
    const pending = await db.getPending();
    const pendingIds = new Set(pending.map((p) => p.id));
    const deletedIds = new Set(pending.filter((p) => p.op === 'delete').map((p) => p.id));

    const kept = (await db.getTransactions()).filter((t) => {
      const inMonth = String(t.transaction_date).startsWith(month);
      return !inMonth || pendingIds.has(String(t.id));
    });

    const incoming = serverItems.filter((t) => !deletedIds.has(String(t.id)));
    await db.replaceTransactions([...kept, ...incoming]);

    const months = new Set(await db.getMeta('pulledMonths', []));
    months.add(month);
    await db.setMeta('pulledMonths', [...months]);
  }

  async function loadMonth(month) {
    if (isOnline()) {
      try {
        await pullMonth(month);
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }

    const all = await db.getTransactions();
    return all
      .filter((t) => String(t.transaction_date).startsWith(month))
      .sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1));
  }

  async function loadBudgets(month) {
    if (isOnline()) {
      try {
        const budgets = await api.budgets(month);
        await db.setCatalog(`budgets:${month}`, budgets);
        return budgets;
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }
    return db.getCatalog(`budgets:${month}`, []);
  }

  /**
   * Resumen del mes. Con `months` > 1 incluye la serie mensual para las gráficas.
   * En línea lo calcula el servidor en una sola petición; sin conexión (o con
   * cambios pendientes) lo calcula localmente.
   */
  async function getSummary(month, months = 1) {
    const pending = await db.getPending();

    if (isOnline() && pending.length === 0) {
      try {
        return await api.summary(month, months);
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
      }
    }

    const catalog = await getCatalogs();
    return computeSummary({
      transactions: await db.getTransactions(),
      categories: catalog.categories,
      budgets: await loadBudgets(month),
      month,
      months,
      baseCode: catalog.user?.base_currency?.code ?? 'MXN',
    });
  }

  async function pushPending() {
    const pending = (await db.getPending()).sort((a, b) => a.seq - b.seq);
    const report = { sent: 0, failed: 0, errors: [] };

    const batch = pending.filter((p) => p.op === 'create' && !p.receipt);
    if (batch.length) {
      const { results } = await api.syncTransactions(batch.map((p) => p.payload));
      for (const result of results) {
        const op = batch.find((p) => p.id === result.client_uuid);
        if (!op) continue;

        await db.removePending(op.seq);
        await db.deleteTransaction(op.id);

        if (result.status === 'error') {
          report.failed += 1;
          report.errors.push(result.message);
          continue;
        }

        report.sent += 1;
      }
    }

    for (const op of pending) {
      if (op.op === 'create' && !op.receipt) continue;

      try {
        if (op.op === 'create') {
          await api.createTransaction(op.payload, op.receipt);
          await db.deleteTransaction(op.id);
        } else if (op.op === 'update') {
          await api.updateTransaction(op.id, op.payload, op.receipt);
        } else if (op.op === 'delete') {
          await api.deleteTransaction(op.id);
        }
        await db.removePending(op.seq);
        report.sent += 1;
      } catch (error) {
        if (error instanceof NetworkError) throw error;
        if (error instanceof ApiError && error.status === 404 && op.op !== 'create') {
          await db.removePending(op.seq);
          continue;
        }
        await db.removePending(op.seq);
        report.failed += 1;
        report.errors.push(error.message);
      }
    }

    return report;
  }

  /**
   * Envía la cola pendiente, actualiza catálogos y vuelve a descargar los meses
   * cargados. Si ya hay una sincronización en curso, reutiliza esa promesa.
   */
  function sync() {
    if (!syncing) {
      syncing = (async () => {
        const report = await pushPending();
        await refreshCatalogs();

        const months = await db.getMeta('pulledMonths', [monthKey()]);
        for (const month of months) await pullMonth(month);

        await db.setMeta('lastSync', Date.now());
        return report;
      })().finally(() => {
        syncing = null;
      });
    }
    return syncing;
  }

  async function pendingCount() {
    return (await db.getPending()).length;
  }

  return {
    getCatalogs,
    loadCatalogs,
    refreshCatalogs,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    loadMonth,
    loadBudgets,
    getSummary,
    sync,
    pendingCount,
    ensureRate,
  };
}
