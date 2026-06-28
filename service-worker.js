// Markonator service worker — app shell + bundled libs + bundled fonts cached
// for offline use. The app has no remote resources, so this only caches
// same-origin assets.
const VERSION = "v1";
const CACHE = `markonator-${VERSION}`;

// Precache list (all local). The bundled font woff2 files are cached on first
// use via stale-while-revalidate below.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icons/icon128.png",
  "./sample-plan.md",
  "./src/styles.css",
  "./src/app.js",
  "./vendor/marked.min.js",
  "./vendor/purify.min.js",
  "./vendor/fonts/fonts.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const res = await fetch(url);
            await cache.put(url, res);
          } catch (e) {
            // Skip entries that fail (e.g. offline during first install).
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navigations: network-first, fall back to cached app shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (e) {
          return (
            (await caches.match("./index.html")) ||
            (await caches.match(req)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return; // don't intercept cross-origin requests

  // Stale-while-revalidate for shell assets, libs, and bundled fonts.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
