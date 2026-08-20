const CACHE_NAME = 'rago-v2.2.0';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/three.module.js',
  './vendor/three.core.js',
  './src/app.js',
  './src/data/species.js',
  './src/game/catch.js',
  './src/game/economy.js',
  './src/game/spawns.js',
  './src/companion/evolution.js',
  './src/lib/allele.js',
  './src/lib/creature.js',
  './src/lib/geo.js',
  './src/lib/moment.js',
  './src/lib/rapp.js',
  './src/lib/rng.js',
  './src/services/places.js',
  './src/services/storage.js',
  './src/services/weather.js',
  './src/ui/canvas-map.js',
  './src/ui/creature-renderer.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const update = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || update;
    })
  );
});
