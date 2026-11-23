import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../js/db.js';

let db;

beforeEach(async () => {
  db = await openDatabase(`test-${Math.random()}`, new IDBFactory());
});

describe('IndexedDB: transacciones', () => {
  it('guarda y recupera movimientos', async () => {
    await db.putTransactions([{ id: 1, amount: '10.00' }, { id: 'uuid-2', amount: '5.00' }]);

    const list = await db.getTransactions();

    expect(list.map((t) => String(t.id)).sort()).toEqual(['1', 'uuid-2']);
  });

  it('replaceTransactions reemplaza todo el contenido', async () => {
    await db.putTransactions([{ id: 1 }, { id: 2 }]);
    await db.replaceTransactions([{ id: 3 }]);

    expect((await db.getTransactions()).map((t) => t.id)).toEqual([3]);
  });

  it('elimina un movimiento por id', async () => {
    await db.putTransactions([{ id: 1 }, { id: 2 }]);
    await db.deleteTransaction(1);

    expect((await db.getTransactions()).map((t) => t.id)).toEqual([2]);
  });
});

describe('IndexedDB: cola pendiente', () => {
  it('conserva el orden de inserción', async () => {
    await db.addPending({ op: 'create', id: 'a' });
    await db.addPending({ op: 'update', id: 'b' });
    await db.addPending({ op: 'delete', id: 'c' });

    const ops = (await db.getPending()).map((p) => p.op);

    expect(ops).toEqual(['create', 'update', 'delete']);
  });

  it('permite actualizar y quitar operaciones', async () => {
    const seq = await db.addPending({ op: 'create', id: 'a', payload: { amount: '1.00' } });

    await db.updatePending(seq, { payload: { amount: '2.00' } });
    expect((await db.getPending())[0].payload.amount).toBe('2.00');

    await db.removePending(seq);
    expect(await db.getPending()).toEqual([]);
  });
});

describe('IndexedDB: catálogos y metadatos', () => {
  it('usa el valor por defecto cuando no hay datos', async () => {
    expect(await db.getCatalog('categories', [])).toEqual([]);
    expect(await db.getMeta('lastSync', 'nunca')).toBe('nunca');
  });

  it('guarda catálogos y metadatos', async () => {
    await db.setCatalog('currencies', [{ code: 'MXN' }]);
    await db.setMeta('rate:USD:MXN', { rate: 17.5 });

    expect(await db.getCatalog('currencies')).toEqual([{ code: 'MXN' }]);
    expect(await db.getMeta('rate:USD:MXN')).toEqual({ rate: 17.5 });
  });

  it('clearAll vacía todos los almacenes', async () => {
    await db.putTransactions([{ id: 1 }]);
    await db.addPending({ op: 'delete', id: '1' });
    await db.setCatalog('user', { id: 1 });
    await db.setMeta('lastSync', 1);

    await db.clearAll();

    expect(await db.getTransactions()).toEqual([]);
    expect(await db.getPending()).toEqual([]);
    expect(await db.getCatalog('user')).toBeNull();
    expect(await db.getMeta('lastSync')).toBeNull();
  });
});
