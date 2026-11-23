import { describe, expect, it } from 'vitest';
import {
  computeSummary,
  escapeHtml,
  formatMoney,
  monthRange,
  round2,
  shiftMonth,
  todayISO,
  typeOf,
  validateAccount,
  validateBudget,
  validateCategory,
  validateCredentials,
  validateTransaction,
} from '../../js/domain.js';

const refs = { accountIds: [1, 2], categoryIds: [10, 11], currencyIds: [3] };
const valid = {
  account_id: '1',
  category_id: '10',
  currency_id: '3',
  amount: '120.50',
  description: 'Super',
  transaction_date: '2026-11-10',
  latitude: '',
  longitude: '',
};

describe('fechas', () => {
  it('monthRange devuelve primer y último día del mes', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('shiftMonth cruza el cambio de año', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 2)).toBe('2027-01');
  });

  it('todayISO usa la fecha local', () => {
    expect(todayISO(new Date(2026, 10, 22, 23, 59))).toBe('2026-11-22');
  });
});

describe('formato y utilidades', () => {
  it('formatMoney aplica separadores y moneda', () => {
    expect(formatMoney(1234.5, 'MXN')).toContain('1,234.50');
  });

  it('formatMoney tolera valores vacíos', () => {
    expect(formatMoney(null, 'MXN')).toContain('0.00');
  });

  it('escapeHtml neutraliza caracteres peligrosos', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;'
    );
  });

  it('round2 redondea a centavos', () => {
    expect(round2(10.126)).toBe(10.13);
    expect(round2('3.333')).toBe(3.33);
  });

  it('typeOf lee el tipo desde ambas formas de relación', () => {
    expect(typeOf({ transactionType: { name: 'egreso' } })).toBe('egreso');
    expect(typeOf({ transaction_type: { name: 'ingreso' } })).toBe('ingreso');
    expect(typeOf(null)).toBeNull();
  });
});

describe('validateTransaction', () => {
  it('acepta un movimiento válido', () => {
    expect(validateTransaction(valid, refs, '2026-11-22')).toEqual({});
  });

  it('rechaza montos no positivos o con más de 2 decimales', () => {
    expect(validateTransaction({ ...valid, amount: '0' }, refs)).toHaveProperty('amount');
    expect(validateTransaction({ ...valid, amount: '12.345' }, refs)).toHaveProperty('amount');
    expect(validateTransaction({ ...valid, amount: 'abc' }, refs)).toHaveProperty('amount');
    expect(validateTransaction({ ...valid, amount: '-5' }, refs)).toHaveProperty('amount');
  });

  it('rechaza montos fuera del límite de la base de datos', () => {
    expect(validateTransaction({ ...valid, amount: '99999999999' }, refs)).toHaveProperty('amount');
  });

  it('rechaza fechas futuras', () => {
    const errors = validateTransaction({ ...valid, transaction_date: '2026-11-23' }, refs, '2026-11-22');
    expect(errors.transaction_date).toMatch(/futura/);
  });

  it('rechaza referencias que no pertenecen al usuario', () => {
    const errors = validateTransaction({ ...valid, account_id: '99', category_id: '999' }, refs);
    expect(errors.account_id).toBeDefined();
    expect(errors.category_id).toBeDefined();
  });

  it('valida descripción, latitud y longitud', () => {
    const errors = validateTransaction(
      { ...valid, description: 'x'.repeat(256), latitude: '91', longitude: '-200' },
      refs
    );
    expect(errors).toHaveProperty('description');
    expect(errors).toHaveProperty('latitude');
    expect(errors).toHaveProperty('longitude');
  });
});

describe('validateCategory, validateAccount y validateBudget', () => {
  it('categoría requiere nombre, tipo válido y color hexadecimal', () => {
    expect(validateCategory({ name: '  ', transaction_type_id: '2' }, [1, 2])).toHaveProperty('name');
    expect(validateCategory({ name: 'Ocio', transaction_type_id: '9' }, [1, 2])).toHaveProperty('transaction_type_id');
    expect(validateCategory({ name: 'Ocio', transaction_type_id: '2', color: 'rojo' }, [1, 2])).toHaveProperty('color');
    expect(validateCategory({ name: 'Ocio', transaction_type_id: '2', color: '#ff0000' }, [1, 2])).toEqual({});
  });

  it('cuenta acepta saldo negativo y rechaza formatos inválidos', () => {
    expect(validateAccount({ name: 'Banco', currency_id: '3', initial_balance: '-50' }, [3])).toEqual({});
    expect(validateAccount({ name: 'Banco', currency_id: '3', initial_balance: '1.234' }, [3])).toHaveProperty('initial_balance');
    expect(validateAccount({ name: 'Banco', currency_id: '9', initial_balance: '' }, [3])).toHaveProperty('currency_id');
  });

  it('presupuesto solo acepta categorías de gasto', () => {
    const errors = validateBudget({ category_id: '5', month: '2026-11', amount: '100' }, [10]);
    expect(errors).toHaveProperty('category_id');
    expect(validateBudget({ category_id: '10', month: '2026-11', amount: '100' }, [10])).toEqual({});
  });
});

describe('validateCredentials', () => {
  it('exige nombre solo al registrarse', () => {
    const base = { email: 'ana@mail.com', password: '12345678' };
    expect(validateCredentials({ ...base, name: '', mode: 'register' })).toHaveProperty('name');
    expect(validateCredentials({ ...base, name: '', mode: 'login' })).toEqual({});
  });

  it('valida correo y longitud de contraseña', () => {
    const errors = validateCredentials({ name: 'A', email: 'correo-malo', password: '123', mode: 'register' });
    expect(errors).toHaveProperty('email');
    expect(errors).toHaveProperty('password');
  });
});

describe('computeSummary', () => {
  const categories = [
    { id: 1, name: 'Comida', color: '#f00', transactionType: { name: 'egreso' } },
    { id: 2, name: 'Salario', color: '#0f0', transactionType: { name: 'ingreso' } },
  ];

  const transactions = [
    { category_id: 1, amount_base: '100.00', transaction_date: '2026-11-05' },
    { category_id: 1, amount_base: 50, transaction_date: '2026-11-06' },
    { category_id: 2, amount_base: '1000', transaction_date: '2026-11-01' },
    { category_id: 1, amount_base: 20, transaction_date: '2026-10-30' },
  ];

  it('calcula ingresos, gastos, balance y gasto por categoría del mes', () => {
    const summary = computeSummary({
      transactions,
      categories,
      budgets: [],
      month: '2026-11',
      baseCode: 'MXN',
    });

    expect(summary.income).toBe(1000);
    expect(summary.expense).toBe(150);
    expect(summary.balance).toBe(850);
    expect(summary.by_category).toEqual([
      { category_id: 1, name: 'Comida', color: '#f00', total: 150 },
    ]);
  });

  it('marca presupuestos excedidos con su porcentaje', () => {
    const summary = computeSummary({
      transactions,
      categories,
      budgets: [{ category_id: 1, month: '2026-11-01', amount: '120' }],
      month: '2026-11',
      baseCode: 'MXN',
    });

    expect(summary.budgets).toHaveLength(1);
    expect(summary.budgets[0]).toMatchObject({
      category_id: 1,
      budget: 120,
      spent: 150,
      percent: 125,
      exceeded: true,
    });
  });

  it('ignora presupuestos de otros meses', () => {
    const summary = computeSummary({
      transactions,
      categories,
      budgets: [{ category_id: 1, month: '2026-10-01', amount: '10' }],
      month: '2026-11',
      baseCode: 'MXN',
    });
    expect(summary.budgets).toEqual([]);
  });
});
