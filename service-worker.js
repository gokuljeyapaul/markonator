// Marginalia service worker — app shell + bundled libs + web fonts cached for offline use.
const VERSION = "v1";
const CACHE = `md-reviewer-${VERSION}`;

// Precache list. Cross-origin CDN entries are fetched with `no-cors` so the
// opaque responses are cacheable and servable to <script> tags offline.
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
];

// Google Fonts (rendered content font) — cached best-effort for offline use.
const FONT_URLS = [
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Lora:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap",
];
const CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await Promise.all(
                SHELL.map(async (url) => {
                    const crossOrigin = /^https?:\/\//.test(url);
                    try {
                        const res = await fetch(
                            url,
                            crossOrigin ? { mode: "no-cors" } : {},
                        );
                        // no-cors gives an opaque response (status 0); still cacheable.
                        await cache.put(url, res);
                    } catch (e) {
                        // Skip entries that fail (e.g. offline during first install).
                    }
                }),
            );
            // Cache web fonts best-effort (opaque, no-cors) so chosen content
            // fonts still render offline after the first online load.
            await Promise.all(
                FONT_URLS.map(async (url) => {
                    try {
                        const res = await fetch(url, { mode: "no-cors" });
                        await cache.put(url, res);
                    } catch (e) {}
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
    const isCDN = CDN_HOSTS.includes(url.host);
    if (!sameOrigin && !isCDN) return; // don't intercept unrelated cross-origin

    // Stale-while-revalidate for shell assets and CDN libs.
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(req);
            const network = fetch(req)
                .then((res) => {
                    if (res && (res.ok || res.type === "opaque")) {
                        cache.put(req, res.clone());
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })(),
    );
});
