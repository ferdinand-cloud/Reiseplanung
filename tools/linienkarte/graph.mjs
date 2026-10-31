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
    const edges = new Map(), VK = new Map(), BIG = 2 ** 26;
    const addE = (a, b, ls) => { if (a === b) return; const k = a < b ? a * BIG + b : b * BIG + a; edges.set(k, lsUnion(edges.has(k) ? edges.get(k) : -1, ls)); };
    for (const { w, ls } of ways) {
      const pts = dicht(W.get(w), P.step), seq = [], mine = [];
      // gemeinsame OSM-Knoten (Wegenden, Abzweige) sind immer derselbe Knoten – sonst reißt der Graph an jeder Weggrenze
      const fix = new Int32Array(pts.length).fill(-1);
      for (let i = 0; i < pts.length; i++) if (pts[i].v) { const j = VK.get(pts[i][0] + "," + pts[i][1]); if (j !== undefined) fix[i] = j; }
      CW.set(w, mine);
      // 1. Durchgang: Kandidat je Punkt (Knoten eines anderen Gleises auf gleicher Höhe). Wer schon an einem Gleis hängt, bleibt etwas länger dran (Hysterese).
      const cand = new Int32Array(pts.length).fill(-1), DX = new Float64Array(pts.length), DY = new Float64Array(pts.length);
      let prevW = -1;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], k = Math.cos(y * Math.PI / 180);
        let dx = (b[0] - a[0]) * k, dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; DX[i] = dx; DY[i] = dy;
        const cx = Math.floor(x / csx), cy = Math.floor(y / cs); let best = -1, bd = Infinity;
        for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
          const arr = GR.get((cx + ix) * 1e7 + cy + iy); if (!arr) continue;
          for (const j of arr) {
            if (NW[j] === w) continue;
            if (Math.abs(NDX[j] * dx + NDY[j] * dy) < COSMIN) continue;
            // quer höchstens snap, längs höchstens ein Punktabstand; der Knoten auf gleicher Höhe gewinnt, das bisherige Gleis bevorzugt
            const ox = (NX[j] - x) * k * R, oy = (NY[j] - y) * R, al = Math.abs(ox * dx + oy * dy), la = Math.abs(ox * -dy + oy * dx), same = NW[j] === prevW;
            if (la > P.snap * (same ? 1.4 : 1) || al > P.step) continue;
            const d = Math.hypot(al * 3, la) * (same ? 0.7 : 1); if (d >= bd) continue;
            bd = d; best = j;
          }
        }
        if (fix[i] >= 0) best = fix[i];
        cand[i] = best; prevW = best < 0 ? -1 : NW[best];
      }
      // 2. Läufe glätten: kurze Lücken zwischen zwei Stellen am selben Gleis überspringen (das fremde Gleis trägt durch),
      //    kurze eingerastete Stücke lösen (sonst Zickzack zwischen zwei Gleisen und Schlaufen im Bündel)
      const K = 4, skip = new Uint8Array(pts.length);
      for (let i = 0; i < pts.length;) {
        if (cand[i] >= 0) { i++; continue; }
        let j = i; while (j < pts.length && cand[j] < 0) j++;
        if (i > 0 && j < pts.length && j - i <= K && NW[cand[i - 1]] === NW[cand[j]]) for (let t = i; t < j; t++) skip[t] = 1;
        i = j;
      }
      for (let i = 0; i < pts.length;) {
        if (cand[i] < 0 || skip[i]) { i++; continue; }
        let j = i; while (j < pts.length && (cand[j] >= 0 || skip[j])) j++;
        if (j - i < K && j - i < pts.length) for (let t = i; t < j; t++) if (fix[t] < 0) { cand[t] = -1; skip[t] = 0; }
        i = j;
      }
      for (let i = 0; i < pts.length; i++) {
        if (skip[i] && fix[i] < 0) continue;
        const [x, y] = pts[i], k = Math.cos(y * Math.PI / 180), dx = DX[i], dy = DY[i];
        let id = cand[i];
        if (id < 0) {
          id = NX.length; NX.push(x); NY.push(y); OX.push(x); OY.push(y); NC.push(1); NDX.push(dx); NDY.push(dy); NW.push(w); NI.push(mine.length); mine.push(id);
          const c = cell(x, y); let arr = GR.get(c); if (!arr) GR.set(c, arr = []); arr.push(id);
          if (pts[i].v) VK.set(x + "," + y, id);
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
    const done = new Set(); let chains = [];
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

    chains = aufraeumen(chains);

    // Aufräumen auf Ebene der Streckenstücke (Bahnhöfe, Weichenfelder):
    //  - Blasen: zwei Stücke zwischen denselben Knoten, ähnlich lang und nah beieinander (Gleise um einen Bahnsteig, mehr als snap auseinander) → eins mit allen Linien
    //  - Kurze Stücke zwischen Abzweigen (unter LMIN) → beide Enden zu einem Knoten
    //  - danach Stücke mit gleicher Linienmenge an Knoten mit genau zwei Enden wieder verbinden
    function aufraeumen(CH) {
      const LMIN = P.snap * 2.2, cl = (c) => { let t = 0; for (let i = 1; i < c.ns.length; i++) t += dist([NX[c.ns[i - 1]], NY[c.ns[i - 1]]], [NX[c.ns[i]], NY[c.ns[i]]]); return t; };
      const nearPoly = (q, c) => { let m = Infinity; for (let i = 1; i < c.ns.length; i++) m = Math.min(m, segM(q, [NX[c.ns[i - 1]], NY[c.ns[i - 1]]], [NX[c.ns[i]], NY[c.ns[i]]])); return m; };
      for (let it = 0; it < 8; it++) {
        let ch = false;
        CH.forEach((c) => { c.L = cl(c); });
        // Blasen
        const pair = new Map();
        CH.forEach((c, i) => { const a = c.ns[0], b = c.ns[c.ns.length - 1]; if (a === b) return; const k = a < b ? a + "," + b : b + "," + a; let x = pair.get(k); if (!x) pair.set(k, x = []); x.push(i); });
        const gone = new Set();
        for (const ids of pair.values()) {
          if (ids.length < 2) continue;
          ids.sort((x, y) => LS[CH[y].ls].length - LS[CH[x].ls].length || CH[y].L - CH[x].L);
          const base = CH[ids[0]];
          for (const j of ids.slice(1)) {
            const o = CH[j]; if (o.L > base.L * 1.5 + LMIN || base.L > o.L * 1.5 + LMIN) continue;
            const mid = o.ns[o.ns.length >> 1]; if (nearPoly([NX[mid], NY[mid]], base) > Math.max(3 * P.snap, base.L * 0.25)) continue;
            base.ls = lsUnion(base.ls, o.ls); gone.add(j); ch = true;
          }
        }
        CH = CH.filter((_, i) => !gone.has(i));
        // kurze Stücke zusammenziehen
        const deg = new Map(), dg = (n) => deg.get(n) || 0;
        CH.forEach((c) => { deg.set(c.ns[0], dg(c.ns[0]) + 1); deg.set(c.ns[c.ns.length - 1], dg(c.ns[c.ns.length - 1]) + 1); });
        const rep = new Map(), rf = (n) => { while (rep.has(n)) n = rep.get(n); return n; }, drop = new Set();
        CH.forEach((c, i) => {
          const a = rf(c.ns[0]), b = rf(c.ns[c.ns.length - 1]); if (a === b || c.L >= LMIN) return;
          if ((dg(a) < 2 || dg(b) < 2) && c.L > LMIN / 3) return; // Enden von Linien behalten
          const m = c.ns[c.ns.length >> 1]; NX[a] = NX[m]; NY[a] = NY[m]; rep.set(b, a); drop.add(i); ch = true;
        });
        if (drop.size) {
          CH = CH.filter((_, i) => !drop.has(i));
          CH.forEach((c) => { c.ns[0] = rf(c.ns[0]); c.ns[c.ns.length - 1] = rf(c.ns[c.ns.length - 1]); });
          CH = CH.filter((c) => c.ns.length > 2 || c.ns[0] !== c.ns[1]);
        }
        // wieder verbinden
        const at = new Map(); CH.forEach((c, i) => { [0, 1].forEach((e) => { const n = e ? c.ns[c.ns.length - 1] : c.ns[0]; let x = at.get(n); if (!x) at.set(n, x = []); x.push([i, e]); }); });
        const dead = new Set();
        for (const [n, x] of at) {
          if (x.length !== 2) continue;
          let [[i, ei], [j, ej]] = x; if (i === j || dead.has(i) || dead.has(j)) continue;
          const A = CH[i], B = CH[j]; if (A.ls !== B.ls) continue;
          // A so drehen, dass es bei n endet, B so, dass es bei n beginnt
          if (ei === 0) A.ns.reverse(); if (ej === 1) B.ns.reverse();
          if (A.ns[A.ns.length - 1] !== n || B.ns[0] !== n) continue;
          A.ns = A.ns.concat(B.ns.slice(1)); dead.add(j); ch = true;
          // Enden von B gehören jetzt A
          const e2 = at.get(B.ns[B.ns.length - 1]); if (e2) e2.forEach((q) => { if (q[0] === j) { q[0] = i; q[1] = 1; } });
        }
        CH = CH.filter((_, i) => !dead.has(i));
        if (!ch) break;
      }
      return CH;
    }

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

    // Striche je Stück: gleiche Art und Farbe (auch farblose) = ein Strich mit allen Nummern, feste Reihenfolge
    const SA = chains.map((c) => {
      const st = new Map();
      for (const li of LS[c.ls]) { const l = lines[li], q = l.m + "|" + l.c; let e = st.get(q); if (!e) st.set(q, e = { q, l, ks: [], p: pos[li] }); e.ks.push(l.k); if (pos[li] < e.p) { e.p = pos[li]; e.l = l; } }
      return [...st.values()].sort((x, y) => x.p - y.p);
    });
    // Mitte des Bündels je Stück: durchgehende Linien behalten ihren Platz (sonst springt bei jedem Abzweig das ganze Bündel um einen halben Platz).
    // Vom größten Bündel aus weitergereicht, höchstens 1,5 Plätze neben der Mitte.
    const CEN = new Float64Array(chains.length).fill(NaN), hd = (i) => chains[i].ns[rev[i] ? chains[i].ns.length - 1 : 0], tl = (i) => chains[i].ns[rev[i] ? 0 : chains[i].ns.length - 1];
    const at2 = new Map(), put2 = (n, x) => { let a = at2.get(n); if (!a) at2.set(n, a = []); a.push(x); };
    chains.forEach((_, i) => { put2(hd(i), [i, 0]); put2(tl(i), [i, 1]); });
    const ordr = chains.map((_, i) => i).sort((x, y) => SA[y].length - SA[x].length || chains[y].ns.length - chains[x].ns.length);
    for (const s0 of ordr) {
      if (!isNaN(CEN[s0])) continue;
      CEN[s0] = (SA[s0].length - 1) / 2; const q = [s0];
      while (q.length) {
        const i = q.shift(), oi = new Map(); SA[i].forEach((e, k) => oi.set(e.q, k - CEN[i]));
        for (const [n, ei] of [[hd(i), 0], [tl(i), 1]]) for (const [j, ej] of at2.get(n) || []) {
          if (j === i || !isNaN(CEN[j]) || ei === ej) continue; // nur Übergänge in Fahrtrichtung (Ende → Anfang)
          let so = 0, sk = 0, c = 0; SA[j].forEach((e, k) => { if (oi.has(e.q)) { so += oi.get(e.q); sk += k; c++; } });
          if (!c) continue;
          const mid = (SA[j].length - 1) / 2; CEN[j] = Math.max(mid - 1.5, Math.min(mid + 1.5, sk / c - so / c)); q.push(j);
        }
      }
    }
    // glätten und ausgeben
    const res = [];
    chains.forEach((c, i) => {
      let g = c.ns.map((n) => [NX[n], NY[n]]); if (rev[i]) g.reverse();
      g = vereinfache(glatt(g, Math.max(1, Math.round(P.glatt / P.step))), 0.3);
      if (g.length < 2) return;
      const arr = SA[i], n = arr.length, cen = isNaN(CEN[i]) ? (n - 1) / 2 : CEN[i];
      arr.forEach((e, k) => { const ks = [...new Set(e.ks)].sort(natCmp);
        res.push({ m: e.l.m, k: e.l.k, ks: ks.length > 1 ? ks.slice(0, 6).join(" · ") + (ks.length > 6 ? " …" : "") : e.l.k, c: e.l.c, o: +(k - cen).toFixed(1), n, g: g.map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]) }); });
    });
    return res;
  }
}

function segM(p, a, b) { const k = Math.cos(p[1] * Math.PI / 180), ax = (b[0] - a[0]) * k, ay = b[1] - a[1], px = (p[0] - a[0]) * k, py = p[1] - a[1], L = ax * ax + ay * ay;
  const t = L ? Math.max(0, Math.min(1, (px * ax + py * ay) / L)) : 0; return Math.hypot(px - t * ax, py - t * ay) * R; }
function dist(a, b) { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * R; }

// Punkte höchstens alle step Meter (Stützpunkte bleiben)
export function dicht(g, step) {
  const v = (q) => { const p = [q[0], q[1]]; p.v = 1; return p; }, out = [v(g[0])]; // v: echter OSM-Punkt
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    out.push(v(b));
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
