const BASE = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = 'werewolf-shell-' + encodeURIComponent(BASE) + '-';
const CACHE = CACHE_PREFIX + 'v2';
const path = (file) => BASE + file;
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([BASE, path('icon.svg'), path('manifest.webmanifest')])),
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== location.origin ||
    !url.pathname.startsWith(BASE) ||
    url.pathname.startsWith(path('api/'))
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cached) =>
              cached || (event.request.mode === 'navigate' ? caches.match(BASE) : Response.error()),
          ),
      ),
  );
});
