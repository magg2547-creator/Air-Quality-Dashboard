// sw.js â€” Optimized Service Worker
const BUILD_VERSION = '20260311-FIX1'; 
const CACHE_NAME = `aqm-v${BUILD_VERSION}`;
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './charts.js',
  './script.js',
  './notifications.js',
  './export.js',
  './manifest.json',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API Calls: Network Only (à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸”à¹ƒà¸«à¸¡à¹ˆà¹€à¸ªà¸¡à¸­)
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // 2. Local Assets: Stale-While-Revalidate (à¹€à¸£à¹‡à¸§à¸—à¸µà¹ˆà¸ªà¸¸à¸”)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      });
    })
  );
});
