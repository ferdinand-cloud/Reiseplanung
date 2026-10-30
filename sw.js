// Reiseplan – Service Worker: App offline verfügbar, besuchte Kartenbereiche zwischengespeichert
const VERSION = "reiseplan-v468";
const SHELL = ["./", "./index.html", "./maplibre-gl.js", "./maplibre-gl.css", "./manifest.webmanifest", "./bus.json", "./firebase.js", "./pmtiles.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const TILES = "reiseplan-tiles";
const MAX_TILES = 3000;
const CITY = "reiseplan-stadt"; // Stadtpakete (ÖPNV Berlin, Paris, London)

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES && k !== CITY && !k.startsWith("reiseplan-offline-")).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => c.delete(k)));
}
// Aufräumen höchstens alle 30 s statt nach jeder Kachel: beim Rauszoomen kommen Dutzende Kacheln gleichzeitig,
// und jedes Auflisten von 3000 Einträgen hält den Service Worker (und damit alle Kacheln) auf
let trimT = 0;
function trimSoon() { if (!trimT) trimT = setTimeout(() => { trimT = 0; trimTiles(); }, 30000); }
// Vektorkacheln haben eine Version im Pfad und ändern sich nicht: aus dem Speicher ohne erneute Netzabfrage.
// Transitland-Kacheln nach 14 Tagen auffrischen; Stil, Schriften, TileJSON wie bisher im Hintergrund aktualisieren
const TILEAGE = 14 * 864e5;
async function stamp(res) { const b = await res.blob(); const h = new Headers(); h.set("content-type", res.headers.get("content-type") || "application/x-protobuf"); h.set("x-sw-at", String(Date.now())); return new Response(b, { status: 200, headers: h }); }
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Linienkarte (PMTiles): Teil-Abrufe per Range, nicht zwischenspeichern (Cache API kennt keine Teilantworten)
  if (req.headers.has("range") || url.pathname.endsWith(".pmtiles")) return;

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
  // Stadtpakete: sofort aus dem Speicher (auch offline), im Hintergrund aktualisieren
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.includes("/stadtpakete/")) {
    e.respondWith(caches.open(CITY).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
      return hit || net;
    }));
    return;
  }
  // Kartenkacheln, Schriften, Stil: Zwischenspeicher zuerst, im Hintergrund aktualisieren
  // dazu die ÖPNV-Kacheln von Transitland (Linien, Haltestellen)
  if (/openfreemap\.org$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || (url.hostname === "transit.land" && url.pathname.startsWith("/api/v2/tiles/"))) {
    const tile = /\.(pbf|mvt)(\?|$)/.test(url.pathname + url.search) || url.hostname === "transit.land";
    e.respondWith(caches.open(TILES).then(async (c) => {
      // zuerst die vorab geladene Offline-Karte einer Reise, dann besuchte Kacheln
      const hit = await caches.match(req);
      if (tile && hit) { const at = +hit.headers.get("x-sw-at") || 0; if (url.hostname !== "transit.land" || Date.now() - at < TILEAGE) return hit; }
      const net = fetch(req).then(async (res) => { if (res.ok && res.type !== "opaque") { const r = tile ? await stamp(res.clone()) : res.clone(); c.put(req, r); trimSoon(); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
