// 改動任何靜態檔案後，把版本號 +1，手機就會自動更新
const CACHE_NAME = "osh-quiz-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Supabase API 不快取（資料快取由 app 自己用 localStorage 處理）
  if (req.url.includes(".supabase.co/")) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp.ok) caches.open(CACHE_NAME).then((c) => c.put(req, resp.clone()));
          return resp;
        })
        .catch(() => cached);
      return cached || network; // 有快取先用快取（離線可用），背景同步更新
    })
  );
});
