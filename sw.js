// Service Worker — стратегія NETWORK-FIRST для нашого коду.
// Чому: застосунок працює онлайн (потрібен LLM API), тож завжди беремо свіжий код із
// мережі, а кеш — лише офлайн-фолбек. Це усуває «стару версію після деплою» (раніше
// була stale-while-revalidate, через що доводилось перезавантажувати двічі).
// ⚠️ Піднімай CACHE_NAME при кожному релізі, щоб старий кеш гарантовано очистився.
const CACHE_NAME = 'kpt-vct-v0.4.2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  // legacy-контролер і клієнти
  './app.js',
  './storage.js',
  './api.js',
  './speech.js',
  // модульне ядро (src/)
  './src/engine/engine.js',
  './src/engine/params.js',
  './src/clinic/case.js',
  './src/clinic/intake.js',
  './src/clinic/assessment.js',
  './src/clinic/profile.js',
  './src/clinic/templates.js',
  './src/clinic/scripted.js',
  './src/clinic/inbox.js',
  './src/clinic/caseExport.js',
  './src/prompts/prompts.js',
  './src/net/fetchRetry.js',
  './src/usage/usage.js',
  // іконки
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Встановлення: прекеш оболонки застосунку; одразу активуємось.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Активація: чистимо старі кеші й перебираємо контроль над сторінками.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first для НАШИХ GET-запитів; усе інше (POST, крос-домен API) — повз SW.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;                       // POST до API не чіпаємо
  if (!e.request.url.startsWith(self.location.origin)) return;  // api.openai/anthropic — повз

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Свіжа відповідь → оновлюємо кеш (для офлайну) і віддаємо її.
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        }
        return networkResponse;
      })
      .catch(() =>
        // Мережа недоступна → офлайн-фолбек із кешу.
        caches.match(e.request).then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' }))
      )
  );
});
