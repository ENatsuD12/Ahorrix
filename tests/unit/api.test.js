import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApiClient } from '../../js/api.js';

const BASE = 'http://api.test/api';

function json(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(...responses) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  globalThis.fetch = fn;
  return fn;
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createApiClient', () => {
  it('envía el token Bearer en rutas protegidas', async () => {
    const fetch = mockFetch(json({ id: 1, name: 'Ana' }));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'abc123' });

    await api.me();

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/auth/me`);
    expect(opts.headers.Authorization).toBe('Bearer abc123');
    expect(opts.headers.Accept).toBe('application/json');
  });

  it('no envía token en login ni en catálogo público', async () => {
    const fetch = mockFetch(json({ token: 't', user: {} }), json([]));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'abc123' });

    await api.login({ email: 'a@a.com', password: 'x' });
    await api.currencies();

    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('expone los errores de validación del servidor por campo', async () => {
    mockFetch(json({
      message: 'The given data was invalid.',
      errors: { email: ['El correo ya está registrado.'] },
    }, 422));
    const api = createApiClient({ baseUrl: BASE });

    const error = await api.register({}).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.fieldErrors.email).toEqual(['El correo ya está registrado.']);
  });

  it('convierte fallas de red en NetworkError', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const api = createApiClient({ baseUrl: BASE });

    await expect(api.categories()).rejects.toBeInstanceOf(NetworkError);
  });

  it('avisa cuando el token ya no es válido (401)', async () => {
    mockFetch(json({ message: 'Unauthenticated.' }, 401));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x', onUnauthorized });

    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('acepta respuestas 204 sin cuerpo', async () => {
    mockFetch(new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x' });

    await expect(api.deleteTransaction(4)).resolves.toBeNull();
  });

  it('recorre todas las páginas de movimientos', async () => {
    const fetch = mockFetch(
      json({ data: [{ id: 1 }], last_page: 2 }),
      json({ data: [{ id: 2 }], last_page: 2 })
    );
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x' });

    const items = await api.allTransactions('2026-11');

    expect(items.map((t) => t.id)).toEqual([1, 2]);
    expect(fetch.mock.calls[0][0]).toContain('month=2026-11&page=1');
    expect(fetch.mock.calls[1][0]).toContain('page=2');
  });

  it('envía movimientos con foto como multipart y omite campos vacíos', async () => {
    const fetch = mockFetch(json({ id: 9 }, 201));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x' });
    const file = new File(['img'], 'ticket.jpg', { type: 'image/jpeg' });

    await api.createTransaction({ amount: '10.00', description: '', latitude: null }, file);

    const body = fetch.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('amount')).toBe('10.00');
    expect(body.has('description')).toBe(false);
    expect(body.has('latitude')).toBe(false);
    expect(body.get('receipt')).toBeInstanceOf(File);
  });

  it('actualiza con foto usando POST y _method=PUT', async () => {
    const fetch = mockFetch(json({ id: 9 }));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x' });
    const file = new File(['img'], 'ticket.png', { type: 'image/png' });

    await api.updateTransaction(9, { amount: '5.00' }, file);

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body.get('_method')).toBe('PUT');
  });

  it('actualiza sin foto usando PUT con JSON', async () => {
    const fetch = mockFetch(json({ id: 9 }));
    const api = createApiClient({ baseUrl: BASE, getToken: () => 'x' });

    await api.updateTransaction(9, { amount: '5.00' });

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ amount: '5.00' });
  });
});
