/* Qist Wasooli service worker — pages hamesha taaza (network pehle), data hamesha network se */
const CACHE = 'qw-v4';
const SHELL = ['/', '/home.html', '/index.html', '/owner.html', '/style.css', '/app.js', '/owner.js',
  '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // data hamesha network se
  const isPage = e.request.mode === 'navigate' || url.pathname === '/' ||
    url.pathname.endsWith('.html') || url.pathname === '/app' || url.pathname === '/owner';
  if (isPage) {
    // Pages: pehle network — taake naya number/design hamesha foran dikhe.
    // Internet na ho to purani copy chalegi.
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match('/index.html')))
  );
});
