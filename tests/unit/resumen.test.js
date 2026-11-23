import { describe, expect, it } from 'vitest';
import { computeSeries, computeSummary } from '../../js/domain.js';

const categories = [
  { id: 1, name: 'Comida', color: '#f00', transactionType: { name: 'egreso' } },
  { id: 2, name: 'Salario', color: '#0f0', transactionType: { name: 'ingreso' } },
];

describe('computeSeries', () => {
  it('devuelve un tramo continuo del más antiguo al más reciente, con ceros', () => {
    const series = computeSeries({
      transactions: [
        { category_id: 2, amount_base: '800', transaction_date: '2026-08-15' },
        { category_id: 1, amount_base: '120', transaction_date: '2026-10-02' },
        { category_id: 1, amount_base: '30', transaction_date: '2026-10-20' },
        { category_id: 2, amount_base: '900', transaction_date: '2026-11-01' },
      ],
      categories,
      month: '2026-11',
      months: 4,
    });

    expect(series.map((s) => s.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(series.map((s) => s.income)).toEqual([800, 0, 0, 900]);
    expect(series.map((s) => s.expense)).toEqual([0, 0, 150, 0]);
  });

  it('ignora movimientos fuera del tramo', () => {
    const series = computeSeries({
      transactions: [{ category_id: 1, amount_base: '50', transaction_date: '2026-01-05' }],
      categories,
      month: '2026-11',
      months: 2,
    });

    expect(series.every((s) => s.expense === 0)).toBe(true);
  });

  it('cruza el cambio de año', () => {
    const series = computeSeries({ transactions: [], categories, month: '2027-02', months: 3 });

    expect(series.map((s) => s.month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('computeSummary con serie y porcentajes', () => {
  it('agrega la serie cuando se pide con months', () => {
    const summary = computeSummary({
      transactions: [{ category_id: 1, amount_base: '10', transaction_date: '2026-11-03' }],
      categories,
      budgets: [],
      month: '2026-11',
      months: 2,
      baseCode: 'MXN',
    });

    expect(summary.series).toHaveLength(2);
    expect(summary.series[1]).toMatchObject({ month: '2026-11', expense: 10 });
  });

  it('no incluye serie cuando no se pide', () => {
    const summary = computeSummary({ transactions: [], categories, budgets: [], month: '2026-11', baseCode: 'MXN' });

    expect(summary).not.toHaveProperty('series');
  });

  it('redondea el porcentaje a un decimal, igual que el servidor', () => {
    const summary = computeSummary({
      transactions: [{ category_id: 1, amount_base: '100', transaction_date: '2026-11-03' }],
      categories,
      budgets: [{ category_id: 1, month: '2026-11-01', amount: '300' }],
      month: '2026-11',
      baseCode: 'MXN',
    });

    expect(summary.budgets[0].percent).toBe(33.3);
  });
});
