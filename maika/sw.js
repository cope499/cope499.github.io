// マイカー管理 (GitHub Pages版) の自動更新用 Service Worker
// 方針: ネットワーク優先。GitHub Pages は Cache-Control: max-age=600 を付けるため、
// 通常の fetch ではブラウザの HTTP キャッシュが最大10分間古い版を返しうる。
// そのため取得時は cache: 'no-store' で HTTP キャッシュを迂回し、常に最新を取りに行く。
// オフライン時のみキャッシュにフォールバックする。
const CACHE = 'maika-cache-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
