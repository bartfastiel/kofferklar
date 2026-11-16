// Service worker: the app works offline (hashed files cache-first, the page network-first; never the API).
const CACHE = 'kofferklar-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.indexOf('kofferklar-') === 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  if (req.mode === 'navigate') {
    const saved = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./'));
    const net = fetch(req).then((res) => {
      // only real app pages, not the redirect to the sign-in page
      if (res.ok && !res.redirected) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
    // weak Wi-Fi: after 3 s the saved page opens (the network answer still refreshes the cache); no saved page → wait on
    const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(saved);
    e.respondWith(
      Promise.race([net.catch(saved), slow.then((hit) => hit || net)]).then((res) => res || net),
    );
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
