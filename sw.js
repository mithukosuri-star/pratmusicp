/* PratMusic — offline-first service worker.
   Precaches the app shell, library metadata, cover art and all bundled audio
   so the whole player works with the network (and the server) fully offline.
   Supports HTTP Range requests out of the cache so audio seeking works offline. */
const VERSION = 'pratmusic-v2';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './js/db.js', './js/app.js', './library.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    try {
      const res = await fetch('./library.json', { cache: 'no-store' });
      const lib = await res.json();
      const urls = [];
      for (const t of lib) { urls.push('./' + t.file, './' + t.cover); }
      await cache.addAll(urls.map((u) => new Request(u, { cache: 'reload' })));
    } catch (err) { console.warn('[sw] media precache partial:', err); }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

async function rangedResponse(cached, headers) {
  const range = headers.get('range');
  if (!range) return cached;
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return cached;
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? buf.byteLength - 1 : parseInt(m[2], 10);
  if (m[1] === '' && m[2] !== '') { start = buf.byteLength - parseInt(m[2], 10); end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  const slice = buf.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(slice.byteLength),
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg'
    }
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      // Keep audio/media fresh-forever from cache but answer range requests properly.
      if (req.headers.has('range')) {
        try { return await rangedResponse(hit, req.headers); } catch (err) { /* fall through */ }
      }
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok && url.origin === self.location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const fallback = await cache.match(req, { ignoreSearch: true });
      if (fallback) return fallback;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
