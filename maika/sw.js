// マイカー管理 (GitHub Pages版) の自動更新用 Service Worker
// 方針: ネットワーク優先。オンラインなら常に最新のファイルを取得し、
// オフライン時のみキャッシュにフォールバックする。
// これにより、ホーム画面に追加したPWAが古いファイルを握り続けず、
// アプリを開くだけで最新版になる。
const CACHE = 'maika-cache-v1';

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
      const res = await fetch(req);
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
