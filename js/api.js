export class NetworkError extends Error {
  constructor(message = 'Sin conexión con el servidor.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  get fieldErrors() {
    return this.data?.errors ?? {};
  }
}

function firstError(data) {
  const errors = data?.errors;
  if (!errors) return null;
  const first = Object.values(errors)[0];
  return Array.isArray(first) ? first[0] : null;
}

function toFormData(payload, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === '') continue;
    form.append(key, String(value));
  }
  if (file) form.append('receipt', file, file.name || 'ticket.jpg');
  return form;
}

export function createApiClient({ baseUrl, getToken, onUnauthorized } = {}) {
  async function request(path, { method = 'GET', body, form, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    const token = getToken?.();

    if (auth && token) headers.Authorization = `Bearer ${token}`;

    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
    } catch {
      throw new NetworkError();
    }

    if (response.status === 401 && auth) onUnauthorized?.();

    const data = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
      const message = data?.message || firstError(data) || `Error ${response.status} del servidor.`;
      throw new ApiError(response.status, message, data);
    }

    return data;
  }

  // Los archivos (multipart) no soportan PUT en Laravel; se usa POST con _method.
  function update(path, payload, file) {
    if (file) {
      return request(path, {
        method: 'POST',
        form: toFormData({ ...payload, _method: 'PUT' }, file),
      });
    }
    return request(path, { method: 'PUT', body: payload });
  }

  return {
    register: (data) => request('/auth/register', { method: 'POST', body: data, auth: false }),
    login: (data) => request('/auth/login', { method: 'POST', body: data, auth: false }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),

    currencies: () => request('/currencies', { auth: false }),
    transactionTypes: () => request('/transaction-types', { auth: false }),
    exchangeRate: (from, to) => request(`/exchange-rates?from=${from}&to=${to}`),

    categories: () => request('/categories'),
    createCategory: (data) => request('/categories', { method: 'POST', body: data }),
    updateCategory: (id, data) => request(`/categories/${id}`, { method: 'PUT', body: data }),
    deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

    accounts: () => request('/accounts'),
    createAccount: (data) => request('/accounts', { method: 'POST', body: data }),
    updateAccount: (id, data) => request(`/accounts/${id}`, { method: 'PUT', body: data }),
    deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),

    budgets: (month) => request(`/budgets?month=${month}`),
    createBudget: (data) => request('/budgets', { method: 'POST', body: data }),
    updateBudget: (id, data) => request(`/budgets/${id}`, { method: 'PUT', body: data }),
    deleteBudget: (id) => request(`/budgets/${id}`, { method: 'DELETE' }),

    summary: (month, months = 1) => request(`/summary?month=${month}&months=${months}`),

    async transactionsPage(month, page = 1, perPage = 100) {
      return request(`/transactions?month=${month}&page=${page}&per_page=${perPage}`);
    },

    async allTransactions(month) {
      const items = [];
      let page = 1;
      let last = 1;
      do {
        const data = await this.transactionsPage(month, page);
        items.push(...data.data);
        last = data.last_page;
        page += 1;
      } while (page <= last);
      return items;
    },

    createTransaction: (payload, file) => request('/transactions', {
      method: 'POST',
      form: toFormData(payload, file),
    }),
    updateTransaction: (id, payload, file) => update(`/transactions/${id}`, payload, file),
    deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),
    syncTransactions: (transactions) => request('/transactions/sync', {
      method: 'POST',
      body: { transactions },
    }),
  };
}
