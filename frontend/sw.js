const CACHE = 'obraexpress-v6';
const urls = ['/', '/loja/', '/entregador/', '/admin/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(urls)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  );
});
