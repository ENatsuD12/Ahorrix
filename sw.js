const VERSION = 'ahorrix-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/charts.js',
  './js/data.js',
  './js/db.js',
  './js/device.js',
  './js/domain.js',
  './js/ui.js',
  './js/views.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/**
 * Los recursos de la app se sirven desde caché (stale-while-revalidate) para
 * que la aplicación abra sin internet. Las llamadas a la API no se cachean:
 * los datos sin conexión los maneja IndexedDB desde la aplicación.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      if (request.mode === 'navigate') {
        return (await cache.match('./index.html')) ?? Response.error();
      }

      return Response.error();
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
