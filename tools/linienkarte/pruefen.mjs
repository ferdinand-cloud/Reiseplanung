// Prüfung der Linienkarte: findet Spitzen, Zacken und Zickzack in den gebauten Linien (de.lines.geojsonl).
// Ein Gleis ist auf 50 m nie so krumm, dass es mehr als ~5 m von der Sehne abweicht (Radius < 60 m gibt es bei S-/Fern-/Regionalbahn nicht);
// liegt eine Linie trotzdem so weit daneben, ist sie auf ein fremdes Gleis gesprungen (Spitze) oder pendelt zwischen zwei Gleisen (Zickzack).
// Geprüft wird je Strich (Linie k) über die Stückgrenzen hinweg: Stücke derselben Linie mit gemeinsamem Endpunkt werden verbunden.
// Doppelt (02.11.): dieselbe Linie zweimal nebeneinander (zwei Bündel, je Fahrtrichtung eins – Ostbahnhof, Friedrichstraße): Stücke derselben
// Linie, die ≥ 60 m lang ≤ 25 m nebeneinander und gleich ausgerichtet laufen. Anschlüsse aufeinanderfolgender Stücke (10 m über den Knoten) zählen nicht.
// Aufruf: node pruefen.mjs <de.lines.geojsonl> [--bbox lo0,la0,lo1,la1] [--liste]
//   Ausgabe: Anzahl Stellen je Verkehrsmittel, doppelte Meter und (mit --liste) die Orte, gröbste zuerst.
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
export function dicht(g, step) {
  const o = [g[0]];
  for (let i = 1; i < g.length; i++) { const a = g[i - 1], b = g[i], L = d2(a, b), n = Math.max(1, Math.round(L / step)); for (let t = 1; t <= n; t++) o.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]); }
  return o;
}
function quer(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180), ax = (b[0] - a[0]) * k, ay = b[1] - a[1], px = (p[0] - a[0]) * k, py = p[1] - a[1], L = Math.hypot(ax, ay);
  if (L < 1e-9) return Math.hypot(px, py) * R;
  return Math.abs(ax * py - ay * px) / L * R;
}
export const DP = { win: 25, run: 60, rand: 15, step: 10 };
/** doppelte Striche: [{lo, la, k, m, len}] je zusammenhängender Strecke (len = Meter doppelt) */
export function doppelt(feats, opt = {}) {
  const P = Object.assign({}, DP, opt), C = 0.0004, byK = new Map(), out = [];
  feats.forEach((f, i) => { const p = f.properties || {}; if (!PR.modes.includes(p.m) || f.geometry?.type !== "LineString") return;
    const k = p.m + "|" + p.k + "|" + p.c; let a = byK.get(k); if (!a) byK.set(k, a = []); a.push(f.geometry.coordinates); });
  for (const [key, raw] of byK) {
    if (raw.length < 2) continue;
    const parts = ketten(raw), grid = new Map(); // Rampen-Stückchen (≤ 0,2 Plätze, oft nur wenige Meter) erst zu Ketten verbinden
    parts.forEach((g, pi) => { for (let i = 0; i + 1 < g.length; i++) { const a = g[i], b = g[i + 1];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / C); gx <= Math.floor(Math.max(a[0], b[0]) / C); gx++) for (let gy = Math.floor(Math.min(a[1], b[1]) / C); gy <= Math.floor(Math.max(a[1], b[1]) / C); gy++) {
        const c = gx + "|" + gy; let e = grid.get(c); if (!e) grid.set(c, e = []); e.push([pi, a, b]); } } });
    // Proben je Stück (ohne die Enden), Treffer = anderes Stück derselben Linie nah und parallel
    const hits = [];
    parts.forEach((g, pi) => { const pts = dicht(g, P.step), L = pts.length;
      let run = [];
      const fin = () => { if (run.length * P.step >= P.run) { const m = run[Math.floor(run.length / 2)]; hits.push({ lo: m[0], la: m[1], len: run.length * P.step }); } run = []; };
      for (let j = 1; j < L - 1; j++) {
        if (j * P.step < P.rand || (L - 1 - j) * P.step < P.rand) { fin(); continue; }
        const q = pts[j], a = pts[j - 1], b = pts[j + 1], k = Math.cos(q[1] * Math.PI / 180), ux = (b[0] - a[0]) * k, uy = b[1] - a[1], uh = Math.hypot(ux, uy) || 1;
        let hit = false;
        for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (const [pj, s0, s1] of grid.get((Math.floor(q[0] / C) + dx) + "|" + (Math.floor(q[1] / C) + dy)) || []) {
          if (pj === pi) continue; const vx = (s1[0] - s0[0]) * k, vy = s1[1] - s0[1], vh = Math.hypot(vx, vy); if (!vh) continue;
          if (Math.abs(ux * vx + uy * vy) / (uh * vh) < 0.85) continue;
          // nur echte Parallelstücke: Abstand quer, und nicht nur die Verlängerung am Knoten (Probe muss seitlich neben dem Abschnitt liegen)
          const t = ((q[0] - s0[0]) * k * vx + (q[1] - s0[1]) * vy) / (vh * vh); if (t < 0 || t > 1) continue;
          const dq = quer(q, s0, s1); if (dq > 2 && dq <= P.win) { hit = true; break; } } // deckungsgleich (Anschluss über den Knoten, gleicher Verlauf) ist kein sichtbarer Doppelstrich
        if (hit) run.push(q); else fin(); }
      fin(); });
    // beide Stücke melden dieselbe Stelle: zusammenfassen (< 80 m), Länge einmal
    const [m, k] = key.split("|"), keep = [];
    hits.sort((a, b) => b.len - a.len).forEach((h) => { if (!keep.some((x) => d2([x.lo, x.la], [h.lo, h.la]) < 80)) keep.push(h); });
    keep.forEach((h) => out.push({ lo: h.lo, la: h.la, k, m, len: h.len }));
  }
  return out.sort((a, b) => b.len - a.len);
}
/** versetzte Lücken: Kette derselben Linie endet, eine andere beginnt 3–30 m daneben (Bündel bricht ab und geht versetzt weiter, Friedrichstraße) */
export function luecken(feats) {
  const byK = new Map(), out = [];
  feats.forEach((f) => { const p = f.properties || {}; if (!PR.modes.includes(p.m) || f.geometry?.type !== "LineString") return;
    const k = p.m + "|" + p.k + "|" + p.c; let a = byK.get(k); if (!a) byK.set(k, a = []); a.push(f.geometry.coordinates); });
  for (const [key, raw] of byK) { const ch = ketten(raw), E = []; ch.forEach((g, i) => { E.push([g[0], i]); E.push([g[g.length - 1], i]); });
    // frei = Ende liegt nicht auf einer anderen Kette derselben Linie (Verlängerung 10 m über den Knoten liegt auf dem Nachbarn → kein freies Ende)
    const frei = (e) => !ch.some((g, i) => i !== e[1] && g.some((q, j) => j && quer(e[0], g[j - 1], q) <= 3 && segIn(e[0], g[j - 1], q)));
    const F = E.filter(frei);
    for (let a = 0; a < F.length; a++) for (let b = a + 1; b < F.length; b++) { if (F[a][1] === F[b][1]) continue; const d = d2(F[a][0], F[b][0]);
      if (d > 3 && d <= 30) { const E2 = F; const [m, k] = key.split("|"); out.push({ lo: E2[a][0][0], la: E2[a][0][1], k, m, d: Math.round(d) }); } } }
  const keep = []; out.forEach((h) => { if (!keep.some((x) => x.k === h.k && d2([x.lo, x.la], [h.lo, h.la]) < 40)) keep.push(h); });
  return keep;
}
function segIn(p, a, b) { const k = Math.cos(p[1] * Math.PI / 180), vx = (b[0] - a[0]) * k, vy = b[1] - a[1], L = vx * vx + vy * vy; if (!L) return false; const t = ((p[0] - a[0]) * k * vx + (p[1] - a[1]) * vy) / L; return t >= -0.05 && t <= 1.05; }
function d2(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * R; }

if (process.argv[1] && process.argv[1].endsWith("pruefen.mjs")) {
  const a = process.argv.slice(2), file = a[0]; let bb = null; const liste = a.includes("--liste");
  const bi = a.indexOf("--bbox"); if (bi > 0) bb = a[bi + 1].split(",").map(Number);
  const feats = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((f) => f.geometry.type === "LineString" && (!bb || f.geometry.coordinates.some(([lo, la]) => lo >= bb[0] && lo <= bb[2] && la >= bb[1] && la <= bb[3])));
  const s = stellen(feats), by = {};
  s.forEach((x) => { by[x.m] = (by[x.m] || 0) + 1; });
  console.log("Stellen (Abweichung > " + PR.max + " m auf " + PR.win + " m):", s.length, JSON.stringify(by));
  const dp = doppelt(feats), dm = dp.reduce((x, y) => x + y.len, 0);
  console.log("Doppelt (dieselbe Linie zweimal nebeneinander ≥ " + DP.run + " m):", dp.length, "Stellen,", Math.round(dm), "m");
  const lu = luecken(feats); console.log("Versetzte Lücken (Linie endet, geht 3–30 m daneben weiter):", lu.length);
  if (liste) lu.slice(0, 30).forEach((x) => console.log("luecke", x.k.padEnd(6), x.m.padEnd(6), x.d + " m", "https://www.openstreetmap.org/#map=18/" + x.la.toFixed(5) + "/" + x.lo.toFixed(5)));
  if (liste) dp.slice(0, 40).forEach((x) => console.log("doppelt", x.k.padEnd(6), x.m.padEnd(6), x.len + " m", "https://www.openstreetmap.org/#map=18/" + x.la.toFixed(5) + "/" + x.lo.toFixed(5)));
  if (liste) s.slice(0, 60).forEach((x) => console.log(x.k.padEnd(6), x.m.padEnd(6), x.dev + " m", "https://www.openstreetmap.org/#map=18/" + x.la.toFixed(5) + "/" + x.lo.toFixed(5)));
}
