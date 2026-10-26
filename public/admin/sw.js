// Service worker: cache file aplikasi agar cepat dibuka & bisa dipasang. Data (API) selalu online.
const CACHE = 'toko-admin-v1';
const FILES = ['./', 'index.html', 'app.css', 'config.js', 'barcode.js', 'core.js', 'pages-sales.js', 'pages-stock.js', 'pages-admin.js', 'main.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/') || u.origin !== location.origin) return;
  // network-first: selalu ambil versi terbaru, cache hanya cadangan saat offline
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});
