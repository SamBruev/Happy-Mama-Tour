/**
 * Стратегия: stale-while-revalidate для своих файлов.
 * Страница открывается мгновенно из кэша, а свежая версия подтягивается фоном —
 * поэтому правки в data.js доходят до телефона со следующего открытия,
 * а не «никогда», как при чистом cache-first.
 */
const VERSION = "v3";
const CACHE = `happy-mama-${VERSION}`;

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./tour.js",
  "./data.js",
  "./manifest.json",
  "./media/karelia-bg.webp",
  "./media/karelia-bg-sm.jpg",
  "./media/icon-192.png",
  "./media/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Один недоступный файл не должен ронять всю установку.
      Promise.all(
        CORE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Тайлы карты, Leaflet и шрифты — мимо кэша: объём непредсказуем.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached || caches.match("./index.html"));

        // Есть копия — отдаём сразу, обновление докачивается фоном.
        if (cached) {
          event.waitUntil(network.catch(() => null));
          return cached;
        }
        return network;
      }),
    ),
  );
});
