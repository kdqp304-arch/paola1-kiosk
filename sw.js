/* PAOLA-1 touch screen: keeps the page, photos, icons and fonts on the device so it opens without a connection,
   and shows a new version as soon as the device is online. */
const CACHE = 'paola1v2-11216566';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'pretendard-subset.woff2'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PAGE_WAIT = 2500;   // ms to wait for the newest page before opening the saved one

self.addEventListener('install', (e) => {
  // straight from the server, never the browser's 10-minute copy, so a new version cannot save old files
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const older = (await caches.keys()).filter((k) => k.startsWith('paola1') && k !== CACHE);
    await Promise.all(older.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (older.some((k) => k.startsWith('paola1-'))) reopenOldScreens();
  })());
});

// screens opened by a build from before this update logic cannot refresh themselves: reopen them once.
// Not awaited on purpose: this worker answers the reopened page, and it can only do that once activation is over.
function reopenOldScreens() {
  self.clients.matchAll({ type: 'window' })
    .then((wins) => wins.forEach((w) => { try { w.navigate(w.url).catch(() => {}); } catch (err) {} }))
    .catch(() => {});
}

// the page itself: the newest copy from the server when online, the saved copy when offline or slow
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
    if (!res.ok || res.redirected) throw new Error('unusable');
    cache.put('index.html', res.clone());
    return res;
  });
  let timer;
  const slow = new Promise((_, no) => { timer = setTimeout(() => no(new Error('slow')), PAGE_WAIT); });
  try {
    return await Promise.race([net, slow]);
  } catch (err) {
    net.catch(() => {});   // a late answer still refreshes the saved copy for next time
    return (await cache.match('index.html')) || (await cache.match('./')) || fetch(req);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !FONT_HOSTS.includes(url.hostname)) return;
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  // photos, icons, fonts: the saved copy answers at once; the network refreshes it for next time
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      const net = (same ? fetch(req, { cache: 'no-cache' }) : fetch(req)).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;
    })
  );
});
