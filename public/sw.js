// Offline shell. Bump V when you ship a new version so phones pick it up.
const V = 'shiftsmart-v4';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/Poppins-Bold.woff', 'fonts/Poppins-Medium.woff',
  'fonts/Inter-Regular.woff', 'fonts/Inter-Medium.woff', 'fonts/Inter-SemiBold.woff'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Serve from cache instantly, refresh the cache in the background.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  // Video uses Range requests (206 responses can't be cached), so let the network handle media.
  if (req.method !== 'GET' || u.origin !== location.origin || req.headers.has('range') || u.pathname.startsWith('/media/') && !u.pathname.endsWith('.json')) return;
  e.respondWith(caches.open(V).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
