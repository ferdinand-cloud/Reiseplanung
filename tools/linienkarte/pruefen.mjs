// Prüfung der Linienkarte: findet Spitzen, Zacken und Zickzack in den gebauten Linien (de.lines.geojsonl).
// Ein Gleis ist auf 50 m nie so krumm, dass es mehr als ~5 m von der Sehne abweicht (Radius < 60 m gibt es bei S-/Fern-/Regionalbahn nicht);
// liegt eine Linie trotzdem so weit daneben, ist sie auf ein fremdes Gleis gesprungen (Spitze) oder pendelt zwischen zwei Gleisen (Zickzack).
// Geprüft wird je Strich (Linie k) über die Stückgrenzen hinweg: Stücke derselben Linie mit gemeinsamem Endpunkt werden verbunden.
// Aufruf: node pruefen.mjs <de.lines.geojsonl> [--bbox lo0,la0,lo1,la1] [--liste]
//   Ausgabe: Anzahl Stellen je Verkehrsmittel und (mit --liste) die Orte, gröbste zuerst.
import fs from "node:fs";

const R = 111320;
export const PR = { win: 50, max: 5, modes: ["sbahn", "reg", "long", "train", "light"] };

/** Stellen einer Linienkarte: [{lo, la, k, m, dev}] – dev = größte Abweichung von der Sehne (m) */
export function stellen(feats, opt = {}) {
  const P = Object.assign({}, PR, opt), out = [];
  const byK = new Map();
  for (const f of feats) {
    const p = f.properties || {};
    if (!P.modes.includes(p.m) || f.geometry?.type !== "LineString") continue;
    const k = p.m + "|" + p.k + "|" + p.c; let a = byK.get(k); if (!a) byK.set(k, a = []); a.push(f.geometry.coordinates);
  }
  for (const [key, parts] of byK) {
    const [m, k] = key.split("|");
    for (const g of ketten(parts)) pruefe(g, P, (lo, la, dev) => out.push({ lo, la, k, m, dev }));
  }
  // nahe Treffer (gleiche Linie, < 60 m) zu einer Stelle zusammenfassen
  out.sort((a, b) => b.dev - a.dev);
  const keep = [];
  for (const s of out) if (!keep.some((t) => t.k === s.k && d2([t.lo, t.la], [s.lo, s.la]) < 60)) keep.push(s);
  return keep;
}

// Stücke derselben Linie zu Ketten verbinden (Endpunkt = Anfangs- oder Endpunkt eines anderen Stücks, ≤ 2 m)
function ketten(parts) {
  const used = new Uint8Array(parts.length), out = [];
  const near = (a, b) => d2(a, b) <= 2;
  for (let i = 0; i < parts.length; i++) {
    if (used[i]) continue; used[i] = 1; let g = parts[i].slice();
    for (let grow = true; grow;) {
      grow = false;
      for (let j = 0; j < parts.length; j++) {
        if (used[j]) continue; const q = parts[j];
        if (near(g[g.length - 1], q[0])) { g = g.concat(q.slice(1)); }
        else if (near(g[g.length - 1], q[q.length - 1])) { g = g.concat(q.slice(0, -1).reverse()); }
        else if (near(g[0], q[q.length - 1])) { g = q.slice(0, -1).concat(g); }
        else if (near(g[0], q[0])) { g = q.slice(1).reverse().concat(g); }
        else continue;
        used[j] = 1; grow = true;
      }
    }
    out.push(g);
  }
  return out;
}

// gleitendes Fenster (win Meter) über die verdichtete Linie: größter Abstand eines Punkts von der Sehne Fensteranfang–Fensterende
function pruefe(g, P, hit) {
  const pts = dicht(g, 5); if (pts.length < 4) return;
  const n = Math.round(P.win / 5);
  for (let i = 0; i + n < pts.length; i += 2) {
    const a = pts[i], b = pts[i + n]; let best = 0, bj = -1;
    for (let j = i + 1; j < i + n; j++) { const d = quer(pts[j], a, b); if (d > best) { best = d; bj = j; } }
    if (best > P.max) hit(pts[bj][0], pts[bj][1], Math.round(best * 10) / 10);
  }
}
function dicht(g, step) {
  const o = [g[0]];
  for (let i = 1; i < g.length; i++) { const a = g[i - 1], b = g[i], L = d2(a, b), n = Math.max(1, Math.round(L / step)); for (let t = 1; t <= n; t++) o.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]); }
  return o;
}
function quer(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180), ax = (b[0] - a[0]) * k, ay = b[1] - a[1], px = (p[0] - a[0]) * k, py = p[1] - a[1], L = Math.hypot(ax, ay);
  if (L < 1e-9) return Math.hypot(px, py) * R;
  return Math.abs(ax * py - ay * px) / L * R;
}
function d2(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * R; }

if (process.argv[1] && process.argv[1].endsWith("pruefen.mjs")) {
  const a = process.argv.slice(2), file = a[0]; let bb = null; const liste = a.includes("--liste");
  const bi = a.indexOf("--bbox"); if (bi > 0) bb = a[bi + 1].split(",").map(Number);
  const feats = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((f) => f.geometry.type === "LineString" && (!bb || f.geometry.coordinates.some(([lo, la]) => lo >= bb[0] && lo <= bb[2] && la >= bb[1] && la <= bb[3])));
  const s = stellen(feats), by = {};
  s.forEach((x) => { by[x.m] = (by[x.m] || 0) + 1; });
  console.log("Stellen (Abweichung > " + PR.max + " m auf " + PR.win + " m):", s.length, JSON.stringify(by));
  if (liste) s.slice(0, 60).forEach((x) => console.log(x.k.padEnd(6), x.m.padEnd(6), x.dev + " m", "https://www.openstreetmap.org/#map=18/" + x.la.toFixed(5) + "/" + x.lo.toFixed(5)));
}
