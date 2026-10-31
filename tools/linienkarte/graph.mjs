// Liniengraph (Ansatz wie Liniennetzpläne): parallele Gleise einer Strecke (beide Richtungen, S-Bahn neben Fernbahn) werden zu einer
// gemeinsamen Mittellinie zusammengelegt. Daraus entstehen durchgehende Streckenstücke mit fester Linienmenge, die vor dem Versatz
// geglättet werden. Jede Linie liegt je Streckenstück genau einmal im Bündel, die Reihenfolge ist überall dieselbe.
//
//  1. je Gruppe (Bahn, Straßenbahn, Seilbahn, Fähre) alle Wege aller Relationen, ohne Richtungswahl
//  2. Wege verdichten (Punkt alle paar Meter); jeder Punkt rastet auf einen Knoten eines anderen Wegs ein, wenn der nah genug und gleich
//     ausgerichtet ist (vor- oder rückwärts) – sonst wird er ein neuer Knoten. Eingerastete Knoten wandern in den Schwerpunkt.
//  3. Kanten zwischen aufeinanderfolgenden Knoten tragen die Linien der Wege; Streckenstücke = Ketten zwischen Abzweigen bzw. dort,
//     wo sich die Linienmenge ändert
//  4. Richtung der Stücke: Stücke mit gemeinsamen Linien laufen am Knoten ineinander über (Ende → Anfang)
//  5. glätten (gleitendes Mittel, Enden fest), vereinfachen
//  6. je Stück und Strich (gleiche Art + Farbe) ein Objekt mit Platz o im Bündel nach fester Reihenfolge

const R = 111320;

const GP = {
  // step: Punktabstand beim Verdichten · snap: Einrastabstand · glatt: halbe Fensterbreite des gleitenden Mittels (m)
  rail: { step: 10, snap: 28, glatt: 70 },
  tram: { step: 5, snap: 13, glatt: 30 },
  funi: { step: 5, snap: 8, glatt: 15 },
  ferry: { step: 40, snap: 60, glatt: 150 },
};
const COSMIN = 0.85; // Richtungen bis ~32° gelten als parallel

export const grpOf = (m) => m === "tram" ? "tram" : m === "ferry" ? "ferry" : m === "funi" ? "funi" : "rail";

export function linienGraph({ lines, RL, W, pos, natCmp, log = () => {} }) {
  const byG = new Map();
  RL.forEach((rels, li) => {
    if (!rels.length) return;
    const g = grpOf(lines[li].m); let M = byG.get(g); if (!M) byG.set(g, M = new Map());
    rels.forEach((ws) => ws.forEach((w) => { if (!W.has(w)) return; let s = M.get(w); if (!s) M.set(w, s = new Set()); s.add(li); }));
  });
  const out = [];
  for (const [g, M] of byG) { const f = gruppe(g, M); log("Liniengraph", g, "Wege", M.size, "Objekte", f.length); for (const x of f) out.push(x); }
  return out;

  function gruppe(gname, M) {
    const P = GP[gname], cs = P.snap / R, csx = cs / 0.3;
    const cell = (x, y) => Math.floor(x / csx) * 1e7 + Math.floor(y / cs);
    // Linienmengen als Kennungen
    const LSK = new Map(), LS = [], lsId = (arr) => { const a = [...new Set(arr)].sort((x, y) => x - y), k = a.join(","); let i = LSK.get(k); if (i === undefined) { i = LS.length; LS.push(a); LSK.set(k, i); } return i; };
    const uni = new Map(), lsUnion = (a, b) => { if (a === b || b < 0) return a; if (a < 0) return b; const k = a < b ? a + "|" + b : b + "|" + a; let i = uni.get(k); if (i === undefined) { i = lsId(LS[a].concat(LS[b])); uni.set(k, i); } return i; };
    const len = (g) => { let s = 0; for (let i = 1; i < g.length; i++) s += dist(g[i - 1], g[i]); return s; };
    const ways = [...M.keys()].map((w) => ({ w, ls: lsId([...M.get(w)]), L: len(W.get(w)) }));
    ways.sort((a, b) => LS[b.ls].length - LS[a.ls].length || b.L - a.L || a.w - b.w); // Stammstrecken zuerst: Knoten entstehen auf den Hauptgleisen

    // Knoten
    const NX = [], NY = [], OX = [], OY = [], NC = [], NDX = [], NDY = [], NW = [], NI = [], CW = new Map(), GR = new Map();
    const edges = new Map(), BIG = 2 ** 26;
    const addE = (a, b, ls) => { if (a === b) return; const k = a < b ? a * BIG + b : b * BIG + a; edges.set(k, lsUnion(edges.has(k) ? edges.get(k) : -1, ls)); };
    for (const { w, ls } of ways) {
      const pts = dicht(W.get(w), P.step), seq = [], mine = [];
      CW.set(w, mine);
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], k = Math.cos(y * Math.PI / 180);
        let dx = (b[0] - a[0]) * k, dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const cx = Math.floor(x / csx), cy = Math.floor(y / cs); let best = -1, bd = Infinity;
        for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
          const arr = GR.get((cx + ix) * 1e7 + cy + iy); if (!arr) continue;
          for (const j of arr) {
            if (NW[j] === w) continue;
            if (Math.abs(NDX[j] * dx + NDY[j] * dy) < COSMIN) continue;
            // quer höchstens snap, längs höchstens ein Punktabstand; der Knoten auf gleicher Höhe gewinnt
            const ox = (NX[j] - x) * k * R, oy = (NY[j] - y) * R, al = Math.abs(ox * dx + oy * dy), la = Math.abs(ox * -dy + oy * dx);
            if (la > P.snap || al > P.step) continue;
            const d = Math.hypot(al * 3, la); if (d >= bd) continue;
            bd = d; best = j;
          }
        }
        let id = best;
        if (id < 0) {
          id = NX.length; NX.push(x); NY.push(y); OX.push(x); OY.push(y); NC.push(1); NDX.push(dx); NDY.push(dy); NW.push(w); NI.push(mine.length); mine.push(id);
          const c = cell(x, y); let arr = GR.get(c); if (!arr) GR.set(c, arr = []); arr.push(id);
        } else {
          // nur quer zur Strecke in die Mitte rücken (längs verschoben würden Knoten wandern und Enden nicht mehr treffen)
          const c = NC[id], lat = ((x - NX[id]) * k * -NDY[id] + (y - NY[id]) * NDX[id]) / (c + 1);
          NX[id] += -NDY[id] * lat / k; NY[id] += NDX[id] * lat; NC[id] = c + 1;
        }
        if (seq[seq.length - 1] !== id) seq.push(id);
      }
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1], b = seq[i];
        // beide Punkte auf demselben fremden Gleis eingerastet: dessen Knoten dazwischen mitnehmen (sonst Abkürzung als Dreieck)
        if (NW[a] === NW[b] && NW[a] !== w && Math.abs(NI[a] - NI[b]) <= 12) {
          const L = CW.get(NW[a]), s = Math.sign(NI[b] - NI[a]);
          for (let t = NI[a]; t !== NI[b]; t += s) addE(L[t], L[t + s], ls);
        } else addE(a, b, ls);
      }
    }

    // einzelne Knoten ohne Partner zwischen eingerasteten (Punktabstände passen nicht genau): Verschiebung der Nachbarn übernehmen, sonst Zickzack
    for (const L of CW.values()) {
      let last = -1;
      for (let i = 0; i < L.length; i++) {
        if (NC[L[i]] < 2) continue;
        if (last >= 0 && i - last > 1 && i - last <= 4) {
          const a = L[last], b = L[i], ax = NX[a] - OX[a], ay = NY[a] - OY[a], bx = NX[b] - OX[b], by = NY[b] - OY[b];
          for (let t = last + 1; t < i; t++) { const f = (t - last) / (i - last), j = L[t]; NX[j] = OX[j] + ax + (bx - ax) * f; NY[j] = OY[j] + ay + (by - ay) * f; }
        }
        last = i;
      }
    }

    // Nachbarn
    const ADJ = new Map(), adj = (n) => { let a = ADJ.get(n); if (!a) ADJ.set(n, a = []); return a; };
    for (const [k, ls] of edges) { const a = Math.floor(k / BIG), b = k % BIG; adj(a).push([b, ls]); adj(b).push([a, ls]); }
    const ekey = (a, b) => a < b ? a * BIG + b : b * BIG + a;
    const brk = (n) => { const a = ADJ.get(n); return !a || a.length !== 2 || a[0][1] !== a[1][1]; };

    // Streckenstücke (Ketten)
    const done = new Set(), chains = [];
    const walk = (s, nb) => {
      const ns = [s], ls = edges.get(ekey(s, nb)); let prev = s, cur = nb; done.add(ekey(s, nb));
      while (true) {
        ns.push(cur);
        if (cur === s || brk(cur)) break;
        const nx = ADJ.get(cur).find(([v]) => v !== prev && !done.has(ekey(cur, v)));
        if (!nx) break;
        done.add(ekey(cur, nx[0])); prev = cur; cur = nx[0];
      }
      chains.push({ ns, ls });
    };
    for (const n of ADJ.keys()) if (brk(n)) for (const [v] of ADJ.get(n)) if (!done.has(ekey(n, v))) walk(n, v);
    for (const n of ADJ.keys()) for (const [v] of ADJ.get(n)) if (!done.has(ekey(n, v))) walk(n, v); // reine Ringe

    // Richtung: Stücke mit gemeinsamen Linien laufen ineinander über; Bedingungen nach Zahl gemeinsamer Linien (Union-Find mit Parität)
    const par = chains.map((_, i) => i), flip = chains.map(() => 0);
    const find = (i) => { // ohne Rekursion (lange Ketten in ganz Deutschland)
      const path = []; let r = i; while (par[r] !== r) { path.push(r); r = par[r]; }
      for (let t = path.length - 1; t >= 0; t--) { const v = path[t], p = par[v]; if (p !== r) flip[v] ^= flip[p]; par[v] = r; }
      return [r, i === r ? 0 : flip[i]];
    };
    const ends = new Map(); chains.forEach((c, i) => { [[c.ns[0], 0], [c.ns[c.ns.length - 1], 1]].forEach(([n, e]) => { let a = ends.get(n); if (!a) ends.set(n, a = []); a.push([i, e]); }); });
    const cons = [];
    for (const arr of ends.values()) for (let x = 0; x < arr.length; x++) for (let y = x + 1; y < arr.length; y++) {
      const [i, ei] = arr[x], [j, ej] = arr[y]; if (i === j) continue;
      const A = LS[chains[i].ls], B = new Set(LS[chains[j].ls]); const sh = A.filter((li) => B.has(li)).length; if (!sh) continue;
      // Ende an Anfang: gleiche Richtung; Ende an Ende oder Anfang an Anfang: eins umdrehen
      cons.push([sh, i, j, ei === ej ? 1 : 0, Math.min(chains[i].ns.length, chains[j].ns.length)]);
    }
    cons.sort((a, b) => b[0] - a[0] || b[4] - a[4]);
    for (const [, i, j, need] of cons) {
      const [ri, pi] = find(i), [rj, pj] = find(j); if (ri === rj) continue;
      par[rj] = ri; flip[rj] = pi ^ pj ^ need;
    }
    // je Gruppe von Stücken die Grundrichtung am längsten Stück: grob West→Ost bzw. Süd→Nord
    const rootDir = new Map();
    chains.forEach((c, i) => { const [r] = find(i); const n = c.ns.length; if (!rootDir.has(r) || n > rootDir.get(r)[1]) rootDir.set(r, [i, n]); });
    const rev = chains.map((c, i) => { const [r, p] = find(i), [ri] = rootDir.get(r), [, pr] = find(ri), cr = chains[ri], a = cr.ns[0], b = cr.ns[cr.ns.length - 1];
      const base = (NX[b] - NX[a]) + 0.6 * (NY[b] - NY[a]) < 0 ? 1 : 0; return base ^ pr ^ p; });

    // glätten und ausgeben
    const res = [];
    chains.forEach((c, i) => {
      let g = c.ns.map((n) => [NX[n], NY[n]]); if (rev[i]) g.reverse();
      g = vereinfache(glatt(g, Math.max(1, Math.round(P.glatt / P.step))), 0.3);
      if (g.length < 2) return;
      // Striche: gleiche Art und Farbe (auch farblose) = ein Strich mit allen Nummern
      const st = new Map();
      for (const li of LS[c.ls]) { const l = lines[li], q = l.m + "|" + l.c; let e = st.get(q); if (!e) st.set(q, e = { l, ks: [], p: pos[li] }); e.ks.push(l.k); if (pos[li] < e.p) { e.p = pos[li]; e.l = l; } }
      const arr = [...st.values()].sort((a, b) => a.p - b.p), n = arr.length;
      arr.forEach((e, k) => { const ks = [...new Set(e.ks)].sort(natCmp);
        res.push({ m: e.l.m, k: e.l.k, ks: ks.length > 1 ? ks.slice(0, 6).join(" · ") + (ks.length > 6 ? " …" : "") : e.l.k, c: e.l.c, o: +(k - (n - 1) / 2).toFixed(1), n, g: g.map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]) }); });
    });
    return res;
  }
}

function dist(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * R; }

// Punkte höchstens alle step Meter (Stützpunkte bleiben)
export function dicht(g, step) {
  const out = [g[0]];
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i], d = dist(a, b), n = Math.ceil(d / step);
    for (let j = 1; j <= n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}

// gleitendes Mittel über ±h Punkte, zu den Enden hin schmaler (Enden bleiben, damit Stücke an Knoten zusammenpassen)
export function glatt(g, h) {
  if (g.length < 3) return g;
  const n = g.length, out = [g[0]];
  for (let i = 1; i < n - 1; i++) {
    const r = Math.min(h, i, n - 1 - i); let sx = 0, sy = 0, sw = 0;
    for (let j = -r; j <= r; j++) { const w = r + 1 - Math.abs(j); sx += g[i + j][0] * w; sy += g[i + j][1] * w; sw += w; }
    out.push([sx / sw, sy / sw]);
  }
  out.push(g[n - 1]);
  return out;
}

// Douglas-Peucker mit Toleranz in Metern
export function vereinfache(g, tol) {
  if (g.length < 3) return g;
  const keep = new Uint8Array(g.length); keep[0] = keep[g.length - 1] = 1;
  const st = [[0, g.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const k = Math.cos(g[a][1] * Math.PI / 180), ax = g[a][0] * k, ay = g[a][1], bx = g[b][0] * k, by = g[b][1], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    for (let i = a + 1; i < b; i++) {
      const px = g[i][0] * k - ax, py = g[i][1] - ay, t = L ? Math.max(0, Math.min(1, (px * vx + py * vy) / L)) : 0, d = Math.hypot(px - t * vx, py - t * vy) * R;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return g.filter((_, i) => keep[i]);
}
