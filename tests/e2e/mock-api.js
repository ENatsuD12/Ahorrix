/**
 * API simulada para pruebas e2e: responde en el navegador con datos en memoria
 * para que la PWA se pruebe sin depender de Supabase ni del servidor Laravel.
 */
export const API_ORIGIN = 'http://127.0.0.1:8000';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

function parseMultipart(raw) {
  const fields = {};
  const boundary = raw.split('\r\n')[0];
  for (const part of raw.split(boundary)) {
    const match = part.match(/name="([^"]+)"(?:; filename="[^"]*")?\r\n(?:Content-Type:[^\r]*\r\n)?\r\n([\s\S]*?)\r\n$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

export async function installMockApi(context) {
  const currencies = [
    { id: 1, code: 'MXN', name: 'Peso mexicano', symbol: '$' },
    { id: 2, code: 'USD', name: 'Dólar estadounidense', symbol: 'US$' },
  ];
  const transactionTypes = [{ id: 1, name: 'egreso' }, { id: 2, name: 'ingreso' }];
  const user = {
    id: 1,
    name: 'Ana Prueba',
    email: 'ana@ahorrix.test',
    base_currency: { id: 1, code: 'MXN', symbol: '$' },
  };
  const categories = [
    { id: 10, name: 'Comida', color: '#ef4444', transaction_type_id: 1, transactionType: { id: 1, name: 'egreso' } },
    { id: 11, name: 'Salario', color: '#22c55e', transaction_type_id: 2, transactionType: { id: 2, name: 'ingreso' } },
  ];
  const accounts = [{ id: 20, name: 'Efectivo', currency_id: 1, currency: currencies[0] }];
  const transactions = [
    {
      id: 1,
      account_id: 20,
      category_id: 11,
      currency_id: 1,
      amount: '1000.00',
      amount_base: '1000.00',
      exchange_rate: '1.000000',
      description: 'Quincena',
      transaction_date: '2026-11-01',
      category: { id: 11, name: 'Salario', color: '#22c55e' },
      account: { id: 20, name: 'Efectivo' },
      currency: currencies[0],
    },
  ];

  const log = { syncCalls: 0, creates: [] };
  let nextId = 100;

  const summaryFor = (month, months = 0) => {
    let income = 0;
    let expense = 0;
    const byCategory = new Map();
    for (const t of transactions) {
      if (!t.transaction_date.startsWith(month)) continue;
      const cat = categories.find((c) => c.id === t.category_id);
      const amount = Number(t.amount_base);
      if (cat.transactionType.name === 'ingreso') income += amount;
      else {
        expense += amount;
        byCategory.set(cat.id, (byCategory.get(cat.id) ?? 0) + amount);
      }
    }

    const summary = {
      month,
      currency: 'MXN',
      income,
      expense,
      balance: income - expense,
      by_category: [...byCategory].map(([id, total]) => {
        const c = categories.find((x) => x.id === id);
        return { category_id: id, name: c.name, color: c.color, total };
      }),
      budgets: [],
    };

    if (months) {
      const [y, m] = month.split('-').map(Number);
      summary.series = Array.from({ length: months }, (_, i) => {
        const key = new Date(y, m - 1 - (months - 1 - i), 1);
        const k = `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, '0')}`;
        const inMonth = transactions.filter((t) => t.transaction_date.startsWith(k));
        const sum = (type) => inMonth
          .filter((t) => categories.find((c) => c.id === t.category_id).transactionType.name === type)
          .reduce((acc, t) => acc + Number(t.amount_base), 0);
        return { month: k, income: sum('ingreso'), expense: sum('egreso') };
      });
    }

    return summary;
  };

  await context.route(`${API_ORIGIN}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    const method = request.method();

    const reply = (status, body = null) => route.fulfill({
      status,
      headers: CORS,
      contentType: 'application/json',
      body: body === null ? '' : JSON.stringify(body),
    });

    if (method === 'OPTIONS') return reply(204);

    const authed = (request.headers().authorization ?? '') === 'Bearer test-token';
    const needsAuth = !['/currencies', '/transaction-types', '/auth/login', '/auth/register'].includes(path);
    if (needsAuth && !authed) return reply(401, { message: 'Unauthenticated.' });

    if (method === 'GET' && path === '/currencies') return reply(200, currencies);
    if (method === 'GET' && path === '/transaction-types') return reply(200, transactionTypes);
    if (method === 'POST' && path === '/auth/login') return reply(200, { token: 'test-token', user });
    if (method === 'GET' && path === '/auth/me') return reply(200, user);
    if (method === 'POST' && path === '/auth/logout') return reply(200, { message: 'ok' });
    if (method === 'GET' && path === '/categories') return reply(200, categories);
    if (method === 'GET' && path === '/accounts') return reply(200, accounts);
    if (method === 'GET' && path === '/budgets') return reply(200, []);
    if (method === 'GET' && path === '/exchange-rates') return reply(200, { from: 'USD', to: 'MXN', rate: 18 });

    if (method === 'GET' && path === '/summary') {
      return reply(200, summaryFor(url.searchParams.get('month') ?? '2026-11', Number(url.searchParams.get('months') ?? 0)));
    }

    if (method === 'GET' && path === '/transactions') {
      const month = url.searchParams.get('month');
      const data = transactions.filter((t) => !month || t.transaction_date.startsWith(month));
      return reply(200, { data, current_page: 1, last_page: 1, total: data.length });
    }

    if (method === 'POST' && path === '/transactions') {
      const fields = parseMultipart(request.postData() ?? '');
      log.creates.push(fields);
      const cat = categories.find((c) => c.id === Number(fields.category_id));
      const acc = accounts.find((a) => a.id === Number(fields.account_id));
      const cur = currencies.find((c) => c.id === Number(fields.currency_id));
      const created = {
        id: nextId++,
        account_id: acc.id,
        category_id: cat.id,
        currency_id: cur.id,
        amount: Number(fields.amount).toFixed(2),
        amount_base: Number(fields.amount).toFixed(2),
        exchange_rate: '1.000000',
        description: fields.description ?? null,
        transaction_date: fields.transaction_date,
        category: { id: cat.id, name: cat.name, color: cat.color },
        account: { id: acc.id, name: acc.name },
        currency: cur,
      };
      transactions.push(created);
      return reply(201, created);
    }

    if (method === 'POST' && path === '/transactions/sync') {
      log.syncCalls += 1;
      const body = JSON.parse(request.postData() ?? '{}');
      const results = body.transactions.map((item) => {
        const cat = categories.find((c) => c.id === Number(item.category_id));
        const acc = accounts.find((a) => a.id === Number(item.account_id));
        const cur = currencies.find((c) => c.id === Number(item.currency_id));
        const created = {
          id: nextId++,
          account_id: acc.id,
          category_id: cat.id,
          currency_id: cur.id,
          amount: Number(item.amount).toFixed(2),
          amount_base: Number(item.amount).toFixed(2),
          exchange_rate: '1.000000',
          description: item.description ?? null,
          transaction_date: item.transaction_date,
          category: { id: cat.id, name: cat.name, color: cat.color },
          account: { id: acc.id, name: acc.name },
          currency: cur,
        };
        transactions.push(created);
        return { client_uuid: item.client_uuid, status: 'created', id: created.id };
      });
      return reply(200, { results });
    }

    const match = path.match(/^\/transactions\/(\d+)$/);
    if (match && method === 'DELETE') {
      const index = transactions.findIndex((t) => t.id === Number(match[1]));
      if (index >= 0) transactions.splice(index, 1);
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }

    return reply(404, { message: 'No encontrado en la simulación.' });
  });

  return { log, transactions };
}
