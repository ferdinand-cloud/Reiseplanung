// Bündel wie Apple Karten (Ferdinand 02.11.2026): Linien auf derselben Strecke laufen in Kurven als gleichmäßig versetzte (konzentrische) Bögen.
// Ursache der Schwankungen: jede Linie hat ihren eigenen Fahrplan-Verlauf (Ecken verschieden abgeschnitten, einige Meter daneben). Die App versetzt
// mit line-offset den EIGENEN Verlauf jeder Linie → Abstände schwanken, Linien kreuzen sich in der Kurve, Ränder blitzen als graue Geisterlinie durch.
// Lösung: gemeinsame Grundlinie. Linien nacheinander (längste zuerst); läuft eine Linie ≥ SH.run m neben schon gelegten Linien (≤ SH.tol m, gleiche
// Richtung), übernimmt sie deren Punkte (samt Ecken). Gleicher Verlauf → line-offset gibt überall denselben Abstand. Kurze Berührungen (flache
// Kreuzungen) bleiben unberührt (Lehre aus Berlin, 01.11.). Doppelte Stücke derselben Linie (Hin-/Rückrichtung) fallen weg.
// Plätze: Linien, die ≥ 100 m teilen, bekommen verschiedene Plätze (0, −1, +1, −2 …), je zusammenhängendem Bündel mittig verschoben.
export const SH = { tol: 12, run: 40, step: 6, cos: 0.5, gap: 80 };
const R = 111320;
const dd = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * R; };

/** L: [{id, g:[[[lo,la],…],…]}] – g wird ersetzt. Rückgabe: geteilte Meter je Paar {id:{id2:m}} */
export function lnShare(L, opt = {}) {
  const P = Object.assign({}, SH, opt), C = 0.0003, grid = new Map(), base = [];
  const addBase = (id, p) => { const bi = base.length, cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dd(p[i - 1], p[i])); base.push({ id, p, cum });
    for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1], x0 = Math.floor(Math.min(a[0], b[0]) / C), x1 = Math.floor(Math.max(a[0], b[0]) / C), y0 = Math.floor(Math.min(a[1], b[1]) / C), y1 = Math.floor(Math.max(a[1], b[1]) / C);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) continue;
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx + "|" + gy; let e = grid.get(k); if (!e) grid.set(k, e = []); e.push([bi, i]); } } };
  const near = (q, dir) => { const kx = Math.floor(q[0] / C), ky = Math.floor(q[1] / C), cx = Math.cos(q[1] * Math.PI / 180); let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const e of grid.get((kx + dx) + "|" + (ky + dy)) || []) {
      const p = base[e[0]].p, a = p[e[1]], b = p[e[1] + 1], ax = (a[0] - q[0]) * cx, ay = a[1] - q[1], vx = (b[0] - a[0]) * cx, vy = b[1] - a[1], L2 = vx * vx + vy * vy; if (!L2) continue;
      const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)), d = Math.hypot(ax + t * vx, ay + t * vy) * R; if (d > P.tol) continue;
      const cs = Math.abs(vx * dir[0] + vy * dir[1]) / Math.sqrt(L2); if (d > 3 && cs < P.cos) continue; // quer: nicht übernehmen (an Ecken ganz nah: Richtung egal)
      if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && (e[0] < best.b || (e[0] === best.b && e[1] < best.s)))) best = { b: e[0], s: e[1], t, d }; } // gleich weit: älteste Grundlinie
    return best; };
  const len = (l) => { let s = 0; l.g.forEach((r) => { for (let i = 1; i < r.length; i++) s += dd(r[i - 1], r[i]); }); return s; };
  for (const l of L.slice().sort((a, b) => len(b) - len(a))) {
    const out = []; let nb = 0;
    for (const r of l.g) {
      const q = [r[0]]; for (let i = 1; i < r.length; i++) { const n = Math.max(1, Math.ceil(dd(r[i - 1], r[i]) / P.step)); for (let t = 1; t <= n; t++) q.push([r[i - 1][0] + (r[i][0] - r[i - 1][0]) * t / n, r[i - 1][1] + (r[i][1] - r[i - 1][1]) * t / n]); }
      const m = q.map((p, j) => { const a = q[Math.max(0, j - 1)], b = q[Math.min(q.length - 1, j + 1)], k = Math.cos(p[1] * Math.PI / 180), vx = (b[0] - a[0]) * k, vy = b[1] - a[1], h = Math.hypot(vx, vy) || 1; return near(p, [vx / h, vy / h]); });
      const pos = (e) => { const B = base[e.b]; return B.cum[e.s] + (B.cum[e.s + 1] - B.cum[e.s]) * e.t; };
      // Läufe: aufeinanderfolgende Punkte nahe an gelegten Linien (Lücken bis 2 Punkte überbrückt); zu kurz → eigener Verlauf
      let j = 0; const runs = [];
      while (j < q.length) { if (!m[j]) { j++; continue; } const j0 = j; let j1 = j, gap = 0;
        // Lücke überbrücken: bis 2 Punkte immer; längere (bis SH.gap m, z. B. stärker abgeschnittene Ecke) nur, wenn danach dieselbe Grundlinie
        // an passender Stelle weitergeht – dann übernimmt die Linie auch die Ecke
        for (let x = j + 1; x < q.length; x++) { if (m[x]) { const a = m[j1]; let w = 0; for (let u = j1 + 1; u <= x; u++) w += dd(q[u - 1], q[u]);
            if (gap > 2 && !(m[x].b === a.b && w <= P.gap && Math.abs(pos(m[x]) - pos(a)) <= w * 2 + 15)) break; j1 = x; gap = 0; }
          else if (++gap > Math.ceil(P.gap / P.step)) break; }
        let lm = 0; for (let x = j0 + 1; x <= j1; x++) lm += dd(q[x - 1], q[x]);
        if (lm >= P.run || (j0 === 0 && j1 === q.length - 1)) runs.push([j0, j1]); else for (let x = j0; x <= j1; x++) m[x] = null;
        j = j1 + 1; }
      // Richtung: line-offset versetzt nach rechts der Zeichenrichtung. Übernommene Abschnitte laufen daher immer in Richtung der Grundlinie
      // (gegenläufige werden umgedreht und als eigenes Stück ausgegeben) – sonst landen Linien gleicher Plätze auf verschiedenen Seiten (Chicago Loop)
      let cur = [], cdir = 0;
      const flush = () => { if (cur.length > 1) out.push(cdir < 0 ? cur.reverse() : cur); cur = []; cdir = 0; };
      const push = (p) => { const z = cur[cur.length - 1]; if (!z || z[0] !== p[0] || z[1] !== p[1]) cur.push(p); };
      const turn = (dir) => { if (!dir || dir === cdir) return; if (cdir === 0 && dir > 0) { cdir = dir; return; } const z = cur[cur.length - 1]; flush(); if (z) cur.push(z); cdir = dir; };
      const at = (e) => { const p = base[e.b].p, a = p[e.s], c = p[e.s + 1]; return [a[0] + (c[0] - a[0]) * e.t, a[1] + (c[1] - a[1]) * e.t]; };
      let ri = 0;
      for (j = 0; j < q.length;) { const rn = runs[ri];
        if (rn && j === rn[0]) { ri++;
          // Teilläufe je Grundlinie: Anfang, deren Punkte (Ecken!), Ende
          let x = rn[0];
          while (x <= rn[1]) { while (x <= rn[1] && !m[x]) x++; if (x > rn[1]) break; const b = m[x].b, e0 = m[x]; let e1 = e0, y = x;
            // nur zusammenhängend weiter: die Stelle auf der Grundlinie rückt so weit vor wie die Linie selbst (sonst Sprung auf einen anderen Teil
            // derselben Grundlinie, z. B. die Gegenrichtung einer Schleife – das Dazwischen würde sonst als Umweg mitkopiert)
            for (let z = x + 1; z <= rn[1]; z++) { if (!m[z]) continue; if (m[z].b !== b) break; let w = 0; for (let u = y + 1; u <= z; u++) w += dd(q[u - 1], q[u]);
              if (Math.abs(pos(m[z]) - pos(e1)) > w * 1.5 + 15) break; e1 = m[z]; y = z; }
            if (base[b].id === l.id) flush(); // eigenes Stück (andere Fahrtrichtung): nicht doppelt
            else { const bp = base[b].p, dir = pos(e1) > pos(e0) + 0.01 ? 1 : pos(e1) < pos(e0) - 0.01 ? -1 : 0; turn(dir); push(at(e0)); if (e0.s < e1.s) for (let v = e0.s + 1; v <= e1.s; v++) push(bp[v]); else if (e0.s > e1.s) for (let v = e0.s; v > e1.s; v--) push(bp[v]); push(at(e1)); }
            x = y + 1; }
          j = rn[1] + 1; continue; }
        if (cdir < 0) { const z = cur[cur.length - 1]; flush(); if (z) cur.push(z); } // eigener Verlauf nach gegenläufigem Abschnitt: neues Stück in eigener Richtung
        push(q[j]); j++; }
      flush();
      // gleich als Grundlinie: das nächste Stück derselben Linie (Gegenrichtung) erkennt sich so als doppelt
      for (let i = nb; i < out.length; i++) { out[i] = glatt(out[i]); if (out[i].length > 1) addBase(l.id, out[i]); } nb = out.length;
    }
    l.g = out.filter((r) => r.length > 1);
  }
  return teilen(L);
}

/** geteilte Meter je Linienpaar: Punkte alle 10 m, die ≤ 2 m neben einer anderen Linie in gleicher Richtung liegen (nach lnShare = gleiche Grundlinie) */
// Zwischenpunkte der Verdichtung auf geraden Abschnitten weg (< 0,3 m daneben)
function glatt(r) { if (r.length < 3) return r; const o = [r[0]]; for (let i = 1; i < r.length - 1; i++) { const a = o[o.length - 1], p = r[i], b = r[i + 1], k = Math.cos(p[1] * Math.PI / 180), vx = (b[0] - a[0]) * k, vy = b[1] - a[1], h = Math.hypot(vx, vy);
  if (!h || Math.abs(vx * (p[1] - a[1]) - vy * (p[0] - a[0]) * k) / h * R > 0.3) o.push(p); } o.push(r[r.length - 1]); return o; }

export function teilen(L) {
  const C = 0.0002, grid = new Map(), sh = {};
  L.forEach((l) => l.g.forEach((r) => { for (let i = 0; i + 1 < r.length; i++) { const a = r[i], b = r[i + 1], x0 = Math.floor(Math.min(a[0], b[0]) / C), x1 = Math.floor(Math.max(a[0], b[0]) / C), y0 = Math.floor(Math.min(a[1], b[1]) / C), y1 = Math.floor(Math.max(a[1], b[1]) / C);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) continue;
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx + "|" + gy; let e = grid.get(k); if (!e) grid.set(k, e = []); e.push([l.id, a, b]); } } }));
  for (const l of L) for (const r of l.g) for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i], L1 = dd(a, b), n = Math.max(1, Math.round(L1 / 10)), k = Math.cos(a[1] * Math.PI / 180), ux = (b[0] - a[0]) * k / (L1 / R || 1), uy = (b[1] - a[1]) / (L1 / R || 1);
    for (let t = 0; t < n; t++) { const q = [a[0] + (b[0] - a[0]) * (t + 0.5) / n, a[1] + (b[1] - a[1]) * (t + 0.5) / n], kx = Math.floor(q[0] / C), ky = Math.floor(q[1] / C), hit = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [id, p0, p1] of grid.get((kx + dx) + "|" + (ky + dy)) || []) {
        if (id === l.id || hit.has(id)) continue; const ax = (p0[0] - q[0]) * k, ay = p0[1] - q[1], vx = (p1[0] - p0[0]) * k, vy = p1[1] - p0[1], L2 = vx * vx + vy * vy; if (!L2) continue;
        const tt = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)); if (Math.hypot(ax + tt * vx, ay + tt * vy) * R > 2) continue;
        if (Math.abs(vx * ux + vy * uy) / Math.sqrt(L2) < 0.7) continue; hit.add(id); }
      for (const id of hit) { sh[l.id] = sh[l.id] || {}; sh[l.id][id] = (sh[l.id][id] || 0) + L1 / n; } } }
  return sh;
}

/** Plätze: {id: Platz}; ids = alle Linien (Reihenfolge = Vorrang bei Gleichstand) */
export function plaetze(ids, sh, minM = 100) {
  const o = {}, ord = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
  const tot = (id) => Object.values(sh[id] || {}).reduce((s, x) => s + x, 0);
  ids.slice().sort((a, b) => tot(b) - tot(a)).forEach((id) => { const used = new Set(); for (const [k, m] of Object.entries(sh[id] || {})) if (m >= minM && o[k] !== undefined) used.add(o[k]);
    o[id] = ord.find((s) => !used.has(s)) ?? 0; });
  const seen = new Set();
  for (const id of ids) { if (seen.has(id)) continue; const comp = [id], q = [id]; seen.add(id);
    while (q.length) for (const [k, m] of Object.entries(sh[q.pop()] || {})) if (m >= minM && o[k] !== undefined && !seen.has(k)) { seen.add(k); comp.push(k); q.push(k); }
    const v = comp.map((k) => o[k]), mid = (Math.min(...v) + Math.max(...v)) / 2; comp.forEach((k) => { o[k] -= mid; }); }
  return o;
}

// Polyline (Genauigkeit 1e-5, Punkte [la, lo]) wie build.mjs
function dec(s) { const o = []; let i = 0, la = 0, lo = 0; const d1 = () => { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < s.length) { la += d1(); lo += d1(); o.push([la / 1e5, lo / 1e5]); } return o; }
function enc(pts) { let o = "", pla = 0, plo = 0; const e1 = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); if (a === pla && b === plo && o) continue; o += e1(a - pla) + e1(b - plo); pla = a; plo = b; } return o; }

/** Paket (Bahn): G je Linie auf gemeinsame Grundlinie, O = Platz je Linie. Getrennt: Gleis (Bahnen) und Straße (Tram); Fähren/Busse unverändert.
 *  Rückgabe: Zahl der Linien, die eine Strecke mit anderen teilen */
export function buendel(d) {
  const grp = {}, idx = {};
  d.L.forEach((l, i) => { if (l[0] === "ferry" || l[0] === "bus" || !(d.G[i] || []).length) return; const k = l[0] === "tram" ? "tram" : "rail", id = l[0] + ":" + l[1] + ":" + i; idx[id] = i;
    (grp[k] = grp[k] || []).push({ id, g: d.G[i].map((s) => dec(s).map(([la, lo]) => [lo, la])) }); });
  d.O = d.L.map(() => 0); let n = 0;
  for (const L of Object.values(grp)) {
    const sh = lnShare(L), o = plaetze(L.map((l) => l.id), sh);
    L.forEach((l) => { const i = idx[l.id]; d.G[i] = l.g.map((r) => enc(r.map(([lo, la]) => [la, lo]))).filter((x) => x.length > 4); d.O[i] = o[l.id]; if (Object.keys(sh[l.id] || {}).length) n++; });
  }
  return n;
}
