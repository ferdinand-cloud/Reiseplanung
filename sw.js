// Reiseplan – Service Worker: App offline verfügbar, besuchte Kartenbereiche zwischengespeichert
const VERSION = "reiseplan-v190";
const SHELL = ["./", "./index.html", "./maplibre-gl.js", "./maplibre-gl.css", "./manifest.webmanifest", "./bus.json", "./firebase.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const TILES = "reiseplan-tiles";
const MAX_TILES = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => c.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // App-Seite: zuerst Netz (für Updates), sonst Zwischenspeicher
  if (req.mode === "navigate" || (url.origin === location.origin && url.pathname.endsWith("/index.html"))) {
    // ohne Browser-Zwischenspeicher nachfragen: GitHub Pages lässt die Seite sonst bis zu 10 Min. veraltet ausliefern
    e.respondWith(fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" })).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("./index.html", copy)); return res; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // Eigene Dateien: Zwischenspeicher zuerst
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  // Kartenkacheln, Schriften, Stil: Zwischenspeicher zuerst, im Hintergrund aktualisieren
  if (/openfreemap\.org$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) { c.put(req, res.clone()); trimTiles(); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
