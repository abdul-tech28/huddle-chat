const CACHE_NAME = 'huddle-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/backend.js',
  '/supabase-config.js',
  '/manifest.webmanifest',
  '/icons/huddle-192.png',
  '/icons/huddle-512.png',
  '/icons/huddle-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('huddle-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Authentication and Supabase data requests stay network-only.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!SHELL_FILES.includes(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          return (await caches.match('/index.html')) || Response.error();
        }
        return Response.error();
      })
  );
});
