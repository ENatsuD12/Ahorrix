const DB_VERSION = 1;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Almacenamiento local con IndexedDB.
 * - transactions: copia local de los movimientos (clave = id como texto)
 * - pending: cola de operaciones offline (autoincremental, conserva el orden)
 * - catalog: categorías, cuentas, monedas y presupuestos en caché
 * - meta: tokens de tipo de cambio y última sincronización
 */
export function openDatabase(name = 'ahorrix', indexedDB = globalThis.indexedDB) {
  const open = indexedDB.open(name, DB_VERSION);

  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'seq', autoIncrement: true });
    if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', { keyPath: 'name' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  };

  return req(open).then((database) => createStore(database));
}

function createStore(database) {
  const tx = (names, mode = 'readonly') => database.transaction(names, mode);

  return {
    async getTransactions() {
      const store = tx(['transactions']).objectStore('transactions');
      const rows = await req(store.getAll());
      return rows.map((row) => row.value);
    },

    async putTransactions(list) {
      const t = tx(['transactions'], 'readwrite');
      const store = t.objectStore('transactions');
      for (const item of list) store.put({ key: String(item.id), value: item });
      await done(t);
    },

    async replaceTransactions(list) {
      const t = tx(['transactions'], 'readwrite');
      const store = t.objectStore('transactions');
      store.clear();
      for (const item of list) store.put({ key: String(item.id), value: item });
      await done(t);
    },

    async deleteTransaction(id) {
      const t = tx(['transactions'], 'readwrite');
      t.objectStore('transactions').delete(String(id));
      await done(t);
    },

    async addPending(operation) {
      const t = tx(['pending'], 'readwrite');
      const seq = await req(t.objectStore('pending').add({ ...operation, createdAt: Date.now() }));
      await done(t);
      return seq;
    },

    async getPending() {
      const store = tx(['pending']).objectStore('pending');
      return req(store.getAll());
    },

    async removePending(seq) {
      const t = tx(['pending'], 'readwrite');
      t.objectStore('pending').delete(seq);
      await done(t);
    },

    async updatePending(seq, changes) {
      const t = tx(['pending'], 'readwrite');
      const store = t.objectStore('pending');
      const current = await req(store.get(seq));
      if (current) store.put({ ...current, ...changes });
      await done(t);
    },

    async setCatalog(name, value) {
      const t = tx(['catalog'], 'readwrite');
      t.objectStore('catalog').put({ name, value });
      await done(t);
    },

    async getCatalog(name, fallback = null) {
      const row = await req(tx(['catalog']).objectStore('catalog').get(name));
      return row ? row.value : fallback;
    },

    async setMeta(key, value) {
      const t = tx(['meta'], 'readwrite');
      t.objectStore('meta').put({ key, value });
      await done(t);
    },

    async getMeta(key, fallback = null) {
      const row = await req(tx(['meta']).objectStore('meta').get(key));
      return row ? row.value : fallback;
    },

    async clearAll() {
      const t = tx(['transactions', 'pending', 'catalog', 'meta'], 'readwrite');
      for (const name of ['transactions', 'pending', 'catalog', 'meta']) t.objectStore(name).clear();
      await done(t);
    },

    close() {
      database.close();
    },
  };
}
