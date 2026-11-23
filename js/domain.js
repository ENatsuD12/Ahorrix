export const TYPES = Object.freeze({ INCOME: 'ingreso', EXPENSE: 'egreso' });

export const LIMITS = Object.freeze({
  maxAmount: 9999999999.99,
  maxName: 60,
  maxDescription: 255,
  minPassword: 8,
  maxReceiptMb: 5,
});

const pad = (n) => String(n).padStart(2, '0');

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatMoney(amount, code = 'MXN', locale = 'es-MX') {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export function formatDate(iso, locale = 'es-MX') {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMonth(month, locale = 'es-MX') {
  const [y, m] = month.split('-').map(Number);
  const text = new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function round1(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

export function typeOf(category) {
  return category?.transactionType?.name ?? category?.transaction_type?.name ?? category?.type ?? null;
}

const isPositiveAmount = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return false;
  const n = Number(text);
  return n > 0 && n <= LIMITS.maxAmount;
};

export function validateTransaction(input, refs, today = todayISO()) {
  const errors = {};

  if (!refs.accountIds.includes(Number(input.account_id))) errors.account_id = 'Selecciona una cuenta.';
  if (!refs.categoryIds.includes(Number(input.category_id))) errors.category_id = 'Selecciona una categoría.';
  if (!refs.currencyIds.includes(Number(input.currency_id))) errors.currency_id = 'Selecciona una moneda.';

  if (!isPositiveAmount(input.amount)) {
    errors.amount = 'Ingresa un monto mayor a 0 con máximo 2 decimales.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transaction_date ?? '')) {
    errors.transaction_date = 'Ingresa una fecha válida.';
  } else if (input.transaction_date > today) {
    errors.transaction_date = 'La fecha no puede ser futura.';
  }

  if ((input.description ?? '').length > LIMITS.maxDescription) {
    errors.description = `La descripción no puede superar ${LIMITS.maxDescription} caracteres.`;
  }

  if (input.latitude !== '' && input.latitude != null) {
    const lat = Number(input.latitude);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) errors.latitude = 'Latitud inválida.';
  }

  if (input.longitude !== '' && input.longitude != null) {
    const lng = Number(input.longitude);
    if (Number.isNaN(lng) || lng < -180 || lng > 180) errors.longitude = 'Longitud inválida.';
  }

  return errors;
}

export function validateCategory(input, typeIds) {
  const errors = {};
  const name = (input.name ?? '').trim();

  if (!name) errors.name = 'El nombre es obligatorio.';
  else if (name.length > LIMITS.maxName) errors.name = `Máximo ${LIMITS.maxName} caracteres.`;

  if (!typeIds.includes(Number(input.transaction_type_id))) errors.transaction_type_id = 'Selecciona un tipo.';

  if (input.color && !/^#[0-9A-Fa-f]{6}$/.test(input.color)) errors.color = 'Color inválido.';

  return errors;
}

export function validateAccount(input, currencyIds) {
  const errors = {};
  const name = (input.name ?? '').trim();

  if (!name) errors.name = 'El nombre es obligatorio.';
  else if (name.length > LIMITS.maxName) errors.name = `Máximo ${LIMITS.maxName} caracteres.`;

  if (!currencyIds.includes(Number(input.currency_id))) errors.currency_id = 'Selecciona una moneda.';

  const balance = input.initial_balance === '' || input.initial_balance == null ? '0' : String(input.initial_balance);
  if (!/^-?\d+(\.\d{1,2})?$/.test(balance)) errors.initial_balance = 'Saldo inicial inválido.';

  return errors;
}

export function validateBudget(input, expenseCategoryIds) {
  const errors = {};

  if (!expenseCategoryIds.includes(Number(input.category_id))) errors.category_id = 'Selecciona una categoría de gasto.';
  if (!/^\d{4}-\d{2}$/.test(input.month ?? '')) errors.month = 'Selecciona un mes válido.';
  if (!isPositiveAmount(input.amount)) errors.amount = 'Ingresa un monto mayor a 0.';

  return errors;
}

export function validateCredentials({ name, email, password, mode }) {
  const errors = {};
  const mail = (email ?? '').trim();

  if (mode === 'register' && !(name ?? '').trim()) errors.name = 'Escribe tu nombre.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) errors.email = 'Correo electrónico inválido.';
  if ((password ?? '').length < LIMITS.minPassword) {
    errors.password = `La contraseña debe tener al menos ${LIMITS.minPassword} caracteres.`;
  }

  return errors;
}

/**
 * Totales de ingreso y gasto por mes, del más antiguo al más reciente,
 * terminando en `month`. Los meses sin movimientos aparecen con 0.
 */
export function computeSeries({ transactions, categories, month, months }) {
  const typeById = new Map(categories.map((c) => [Number(c.id), typeOf(c)]));
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    buckets.push({ month: shiftMonth(month, -i), income: 0, expense: 0 });
  }
  const byMonth = new Map(buckets.map((b) => [b.month, b]));

  for (const t of transactions) {
    const bucket = byMonth.get(String(t.transaction_date).slice(0, 7));
    if (!bucket) continue;

    const type = typeById.get(Number(t.category_id));
    if (type === TYPES.INCOME) bucket.income += Number(t.amount_base);
    else if (type === TYPES.EXPENSE) bucket.expense += Number(t.amount_base);
  }

  return buckets.map((b) => ({ month: b.month, income: round2(b.income), expense: round2(b.expense) }));
}

export function computeSummary({ transactions, categories, budgets, month, baseCode, months }) {
  const typeById = new Map(categories.map((c) => [Number(c.id), typeOf(c)]));
  const categoryById = new Map(categories.map((c) => [Number(c.id), c]));

  let income = 0;
  let expense = 0;
  const spent = new Map();

  for (const t of transactions) {
    if (!String(t.transaction_date).startsWith(month)) continue;

    const type = typeById.get(Number(t.category_id));
    const amount = Number(t.amount_base);

    if (type === TYPES.INCOME) {
      income += amount;
    } else if (type === TYPES.EXPENSE) {
      expense += amount;
      spent.set(Number(t.category_id), (spent.get(Number(t.category_id)) ?? 0) + amount);
    }
  }

  const byCategory = [...spent.entries()]
    .map(([categoryId, total]) => {
      const category = categoryById.get(categoryId);
      return {
        category_id: categoryId,
        name: category?.name ?? 'Sin categoría',
        color: category?.color ?? '#6b7280',
        total: round2(total),
      };
    })
    .sort((a, b) => b.total - a.total);

  const budgetRows = budgets
    .filter((b) => String(b.month).startsWith(month))
    .map((b) => {
      const categoryId = Number(b.category_id);
      const categorySpent = spent.get(categoryId) ?? 0;
      const amount = Number(b.amount);
      const category = categoryById.get(categoryId);

      return {
        category_id: categoryId,
        name: b.category?.name ?? category?.name ?? 'Sin categoría',
        color: b.category?.color ?? category?.color ?? '#6b7280',
        budget: round2(amount),
        spent: round2(categorySpent),
        percent: amount > 0 ? round1((categorySpent / amount) * 100) : 0,
        exceeded: categorySpent > amount,
      };
    });

  const summary = {
    month,
    currency: baseCode,
    income: round2(income),
    expense: round2(expense),
    balance: round2(income - expense),
    by_category: byCategory,
    budgets: budgetRows,
  };

  if (months) {
    summary.series = computeSeries({ transactions, categories, month, months });
  }

  return summary;
}
