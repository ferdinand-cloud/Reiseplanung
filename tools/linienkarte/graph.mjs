// Liniengraph (Ansatz wie Liniennetzpläne): parallele Gleise einer Strecke (beide Richtungen, S-Bahn neben Fernbahn) werden zu einer
// gemeinsamen Mittellinie zusammengelegt. Daraus entstehen durchgehende Streckenstücke mit fester Linienmenge, die vor dem Versatz
// geglättet werden. Jede Linie liegt je Streckenstück genau einmal im Bündel; die Reihenfolge folgt den Abzweigen (rechts abbiegend = rechts).
//
//  1. je Gruppe (Bahn, Straßenbahn, Seilbahn, Fähre) alle Wege aller Relationen, ohne Richtungswahl
//  2. Wege verdichten (Punkt alle paar Meter); jeder Punkt rastet auf einen Knoten eines anderen Wegs ein, wenn der nah genug und gleich
//     ausgerichtet ist (vor- oder rückwärts) – sonst wird er ein neuer Knoten. Eingerastete Knoten wandern in den Schwerpunkt.
//  3. Kanten zwischen aufeinanderfolgenden Knoten tragen die Linien der Wege; Streckenstücke = Ketten zwischen Abzweigen bzw. dort,
//     wo sich die Linienmenge ändert
//  4. Richtung der Stücke: Stücke mit gemeinsamen Linien laufen am Knoten ineinander über (Ende → Anfang)
//  5. glätten (gleitendes Mittel, Enden fest), vereinfachen
//  6. je Stück und Strich (gleiche Art + Farbe) ein Objekt mit Platz o im Bündel nach fester Reihenfolge
//  7. Übergänge (Ferdinand 01.11.): über Knoten hinweg geglättet; an Knoten gleitet der Platz über 60 m auf den des Nachbarstücks; jeder Strich
//     reicht 10 m über den Knoten; Ausgabe in Stücken ≤ 400 m bzw. ≤ 0,2 Plätze; lose kurze Stummel und Inseln neben der eigenen Linie fallen weg; Reihenfolge im Bündel aus den Abzweigen,
//     Seitenzweige mittig auf ihrem Gleis; U-Bahn als eigene Gruppe.
//     Kacheln ohne Abschneiden (build.mjs --no-clipping): abgeschnittene Enden mit Versatz knickten quer übers Bündel

const R = 111320;

const GP = {
  // step: Punktabstand beim Verdichten · snap: Einrastabstand · glatt: halbe Fensterbreite des gleitenden Mittels (m)
  rail: { step: 10, snap: 28, glatt: 70 },
  metro: { step: 10, snap: 28, glatt: 70 },
  sbahn: { step: 10, snap: 28, glatt: 70 },
  tram: { step: 5, snap: 13, glatt: 30 },
  funi: { step: 5, snap: 8, glatt: 15 },
  ferry: { step: 40, snap: 60, glatt: 150 },
};
const COSMIN = 0.85;
const LKPEEL = process.env.LKPEEL !== "0", MINRUN = +(process.env.LKMINRUN || 150); // Meter: kürzer nebeneinander laufende Gleise werden nicht zusammengelegt (flache Kreuzungen, Weichenfelder) // Richtungen bis ~32° gelten als parallel

// U-Bahn eigene Gruppe: fährt nie auf Eisenbahngleisen, rastete aber an parallelen Strecken ein (U8 am Alexanderplatz hing schräg im S-Bahn-Bündel)
// S-Bahn eigene Gruppe (02.11., Variante A): rastete auf die 12–35 m entfernten Fern-/Regionalgleise ein – mal ja, mal nein. Jeder Wechsel
// verschob Mittellinie, Bündelmitte und Reihenfolge (Knick Hauptbahnhof, Fächer Ostbahnhof, Lücke Friedrichstraße). Gleise, die S-Bahn UND
// Regional-/Fernzüge befahren (München-Außenäste, Rhein-Main), bleiben in der Bahngruppe – dort liegen alle Linien in einem Bündel.
const SBF = new Set(["sbahn", "light"]);
export const grpOf = (m) => m === "tram" ? "tram" : m === "ferry" ? "ferry" : m === "funi" ? "funi" : m === "metro" ? "metro" : SBF.has(m) ? "sbahn" : "rail";
// Gruppe eines Wegs aus allen Linien darauf: S-Bahn nur, wenn ausschließlich S-Bahn fährt
const grpWay = (ms) => { const g = new Set(ms.map(grpOf)); return g.size === 2 && g.has("sbahn") && g.has("rail") ? "rail" : [...g][0]; };

/* Je Linie eine Fahrtrichtung (02.11.): In OSM hat jede Linie meist zwei Relationen (Hin/Rück) mit eigenem Gleis, an Bahnhöfen und
   Gleisfächern 4–65 m auseinander. Beide im Graphen → wo sie nicht zusammenrasten, liegt dieselbe Linie zweimal nebeneinander (doppelte
   Bündel Ostbahnhof/Friedrichstraße, Linse am Hauptbahnhof). Erst eine vollständige Relation; von weiteren Relationen nur die Abschnitte, die mehr als
   RW.nah Meter von schon behaltenen Wegen der Linie entfernt liegen (Äste, Varianten, nur in einer Richtung befahrene Abschnitte). */
export const RW = { nah: 40, min: 3, step: 20 }; // min: freie Punkte (je step m) für ein eigenes Teilstück
let SUB = 0;
export function eineRichtung(RL, W) {
  const lenW = (w) => { const g = W.get(w); let s = 0; for (let i = 1; i < g.length; i++) s += dist(g[i - 1], g[i]); return s; };
  // Richtung je Linie abgestimmt: Linien mit vielen Wegen zuerst; jede weitere nimmt unter ihren (fast) vollständigen Relationen die, die am meisten
  // schon gewählte Gleise anderer Linien mitbenutzt – sonst fuhr RE1 auf dem Gleis der einen, RE2 auf dem der anderen Richtung und das Bündel
  // zerfiel in zwei (Nord-Süd-Tunnel Potsdamer Platz, Gesundbrunnen 02.11.)
  const GK = new Set(), LW = new Map(), lw = (w) => { let v = LW.get(w); if (v === undefined) LW.set(w, v = W.has(w) ? lenW(w) : 0); return v; };
  const OUT = new Array(RL.length);
  RL.map((rels, li) => [li, rels.reduce((x, ws) => x + ws.length, 0)]).sort((a, b) => b[1] - a[1]).forEach(([li]) => {
    const r = one(RL[li]); r.forEach((ws) => ws.forEach((w) => GK.add(w))); OUT[li] = r; });
  return OUT;
  function one(rels) {
    if (rels.length < 2) return rels;
    const C = RW.nah / R, grid = new Map(), keep = new Set(), out = [];
    const add = (w) => { keep.add(w); for (const q of dicht(W.get(w), RW.step)) { const k = Math.floor(q[0] / C * Math.cos(q[1] * Math.PI / 180)) + "|" + Math.floor(q[1] / C); let e = grid.get(k); if (!e) grid.set(k, e = []); e.push(q); } };
    const nah = (q) => { const kx = Math.floor(q[0] / C * Math.cos(q[1] * Math.PI / 180)), ky = Math.floor(q[1] / C);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of grid.get((kx + dx) + "|" + (ky + dy)) || []) if (dist(p, q) <= RW.nah) return true; return false; };
    const ord = rels.map((ws) => ws.filter((w) => W.has(w))).map((ws) => ({ ws, L: ws.reduce((x, w) => x + lw(w), 0), S: ws.reduce((x, w) => x + (GK.has(w) ? lw(w) : 0), 0) }));
    const Lmax = Math.max(...ord.map((o) => o.L)), voll = (o) => o.L >= Lmax * 0.8;
    ord.sort((a, b) => voll(b) - voll(a) || b.S - a.S || b.L - a.L);
    ord.forEach(({ ws }, i) => {
      if (!i) { ws.forEach(add); out.push(ws); return; }
      // nur die freien Teile eines Wegs: ganze Wege nahmen auch ihre Abschnitte dicht neben dem behaltenen Gleis mit (doppelte Striche
      // im Nord-Süd-Tunnel, 02.11.). Teilstücke bekommen neue (negative) Kennungen, je Seite einen Punkt Überlappung zum Anschluss.
      const mine = [];
      for (const w of ws) { if (keep.has(w)) continue; const pts = dicht(W.get(w), RW.step), far = pts.map((q) => !nah(q)), nf = far.filter(Boolean).length;
        if (nf === pts.length) { mine.push(w); continue; }
        if (nf < RW.min) continue;
        for (let a = 0; a < pts.length;) { if (!far[a]) { a++; continue; } let b = a; while (b < pts.length && far[b]) b++;
          if (b - a >= RW.min) { const id = --SUB, g = pts.slice(Math.max(0, a - 1), Math.min(pts.length, b + 1)).map((q) => [q[0], q[1]]); W.set(id, g); mine.push(id); }
          a = b; } }
      mine.forEach(add); if (mine.length) out.push(mine); });
    return out;
  }
}

export function linienGraph({ lines, RL, W, pos, natCmp, log = () => {} }) {
  const byG = new Map(), WL = new Map();
  const RL1 = eineRichtung(RL, W);
  log("Eine Richtung je Linie: Wege", RL.reduce((s, r) => s + r.reduce((x, w) => x + w.length, 0), 0), "→", RL1.reduce((s, r) => s + r.reduce((x, w) => x + w.length, 0), 0));
  RL1.forEach((rels, li) => rels.forEach((ws) => ws.forEach((w) => { if (!W.has(w)) return; let s = WL.get(w); if (!s) WL.set(w, s = new Set()); s.add(li); })));
  // Gruppe je Weg (S-Bahn nur auf reinen S-Bahn-Gleisen)
  for (const [w, ls] of WL) { const all = [...ls], fam = new Map();
    all.forEach((li) => { const g0 = grpOf(lines[li].m), f = g0 === "sbahn" ? "rail" : g0; let a = fam.get(f); if (!a) fam.set(f, a = []); a.push(li); });
    for (const [, lis] of fam) { const g = grpWay(lis.map((li) => lines[li].m)); let M = byG.get(g); if (!M) byG.set(g, M = new Map()); M.set(w, new Set(lis)); } }
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
      const cand = new Int32Array(pts.length).fill(-1), LA = new Float64Array(pts.length), DX = new Float64Array(pts.length), DY = new Float64Array(pts.length);
      let prevW = -1;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], k = Math.cos(y * Math.PI / 180);
        let dx = (b[0] - a[0]) * k, dy = b[1] - a[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; DX[i] = dx; DY[i] = dy;
        const cx = Math.floor(x / csx), cy = Math.floor(y / cs); let best = -1, bd = Infinity, bla = 0;
        for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
          const arr = GR.get((cx + ix) * 1e7 + cy + iy); if (!arr) continue;
          for (const j of arr) {
            if (NW[j] === w) continue;
            if (Math.abs(NDX[j] * dx + NDY[j] * dy) < COSMIN) continue;
            // quer höchstens snap, längs höchstens ein Punktabstand; der Knoten auf gleicher Höhe gewinnt, das bisherige Gleis bevorzugt
            const ox = (NX[j] - x) * k * R, oy = (NY[j] - y) * R, al = Math.abs(ox * dx + oy * dy), la = Math.abs(ox * -dy + oy * dx), same = NW[j] === prevW;
            if (la > P.snap * (same ? 1.4 : 1) || al > P.step) continue;
            const d = Math.hypot(al * 3, la) * (same ? 0.7 : 1); if (d >= bd) continue;
            bd = d; best = j; bla = la;
          }
        }
        if (fix[i] >= 0) { best = fix[i]; bla = 0; }
        LA[i] = bla; cand[i] = best; prevW = best < 0 ? -1 : NW[best];
      }
      // 2. Läufe glätten: kurze Lücken zwischen zwei Stellen am selben Gleis überspringen (das fremde Gleis trägt durch),
      //    kurze eingerastete Stücke lösen (sonst Zickzack zwischen zwei Gleisen und Schlaufen im Bündel)
      //    Nur Gleise, die länger nebeneinander laufen, werden zusammengelegt (Ferdinand 01.11.: Spitzen an flach kreuzenden Gleisen – A100, Freiheit –
      //    und Zickzack zwischen S-Bahn- und Ferngleisen – Westhafen): eingerastete Läufe unter MINRUN Metern lösen sich wieder.
      //    Laufenden aufrollen: wo die Gleise schon auseinanderlaufen (quer > PEEL), bleibt der Punkt auf seinem eigenen Gleis – sonst hielt die
      //    Hysterese die Linie bis ~40 m Abstand im Bündel und sie sprang dann mit Knick hinüber (Bornholmer Straße).
      const K = 4, KB = Math.round(200 / P.step), KR = Math.max(K, Math.round(MINRUN / P.step)), PEEL = P.snap * 0.45, skip = new Uint8Array(pts.length);
      for (let i = 0; i < pts.length;) {
        if (cand[i] >= 0) { i++; continue; }
        let j = i; while (j < pts.length && cand[j] < 0) j++;
        if (i > 0 && j < pts.length && j - i <= KB && NW[cand[i - 1]] === NW[cand[j]]) for (let t = i; t < j; t++) skip[t] = 1; // auch Bahnhofsbereiche, wo die Gleise kurz auseinanderlaufen (Friedrichstraße)
        i = j;
      }
      for (let i = 0; i < pts.length;) {
        if (cand[i] < 0 || skip[i]) { i++; continue; }
        let j = i; while (j < pts.length && (cand[j] >= 0 || skip[j])) j++;
        // Laufenden mit freiem Ende (nicht Weganfang/-ende) aufrollen, solange die Gleise dort schon weiter als PEEL auseinander liegen
        // aufgerollt wird nur, wo sich die Gleise wirklich trennen (danach mindestens MINRUN frei), nicht in Lücken, die das Bündel überbrückt
        let a = i, b = j, pv = i - 1, nx = j;
        while (pv >= 0 && cand[pv] < 0) pv--;
        while (nx < pts.length && cand[nx] < 0) nx++;
        const freeA = LKPEEL && i - 1 - pv >= KR, freeB = LKPEEL && nx - j >= KR;
        if (a > 0 && freeA) while (a < b && fix[a] < 0 && (skip[a] || LA[a] > PEEL)) a++;
        if (b < pts.length && freeB) while (b > a && fix[b - 1] < 0 && (skip[b - 1] || LA[b - 1] > PEEL)) b--;
        for (let t = i; t < a; t++) if (fix[t] < 0) { cand[t] = -1; skip[t] = 0; }
        for (let t = b; t < j; t++) if (fix[t] < 0) { cand[t] = -1; skip[t] = 0; }
        if (b - a < KR && b - a < pts.length) for (let t = a; t < b; t++) if (fix[t] < 0) { cand[t] = -1; skip[t] = 0; }
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
          // eingerasteter OSM-Knoten: merken, damit später kommende (kürzere) Wege dort anschließen – sonst fehlte ihr Anschluss und das
          // Stück fiel als Insel weg (S3/5/7/9 am Zoo: 16 m Lücke, 02.11.)
          if (pts[i].v && !VK.has(x + "," + y)) VK.set(x + "," + y, id);
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
        // lose Stummel: kurzes Stück mit einem freien Ende, dessen Linien am anderen Knoten ohnehin durchfahren (Abstellgleis, Gleiswechsel in einer Relation)
        { const at3 = new Map(); CH.forEach((c, i) => { [c.ns[0], c.ns[c.ns.length - 1]].forEach((n) => { let x = at3.get(n); if (!x) at3.set(n, x = []); x.push(i); }); });
          const stub = new Set();
          CH.forEach((c, i) => { if (c.L >= 150) return; const a = c.ns[0], b = c.ns[c.ns.length - 1]; if (a === b) return;
            const da = at3.get(a).length, db = at3.get(b).length; if ((da === 1) === (db === 1)) return; const n = da === 1 ? b : a;
            const oth = at3.get(n).filter((j) => j !== i && !stub.has(j));
            if (LS[c.ls].every((li) => oth.filter((j) => LS[CH[j].ls].includes(li)).length >= 2)) stub.add(i); });
          // Inseln: kurzes Stück ohne Anschluss an beiden Enden, dessen Linien gleich daneben (≤ 250 m) auf anderen Stücken fahren
          // (zweite Ebene eines Bahnhofs, nicht eingerastetes Parallelgleis) – sonst lose Enden quer übers Bündel
          const byL = new Map(); CH.forEach((c, i) => { for (const li of LS[c.ls]) { let x = byL.get(li); if (!x) byL.set(li, x = []); x.push(i); } });
          CH.forEach((c, i) => { if (c.L >= 800 || stub.has(i)) return; const a = c.ns[0], b = c.ns[c.ns.length - 1]; if (a === b || at3.get(a).length !== 1 || at3.get(b).length !== 1) return;
            const pts = [c.ns[0], c.ns[c.ns.length >> 1], c.ns[c.ns.length - 1]].map((n) => [NX[n], NY[n]]);
            if (LS[c.ls].every((li) => byL.get(li).some((j) => j !== i && !stub.has(j) && pts.every((q) => nearPoly(q, CH[j]) < 250)))) stub.add(i); });
          // kurze Schleifen (Anfang = Ende, Gleisdreieck/Wendeschleife im Bahnhof), deren Linien auch anderswo fahren: geglättet würden sie zu Querstrichen
          CH.forEach((c, i) => { if (c.L >= 800 || stub.has(i) || c.ns[0] !== c.ns[c.ns.length - 1]) return;
            if (LS[c.ls].every((li) => byL.get(li).some((j) => j !== i && !stub.has(j)))) stub.add(i); });
          // lose Doppel: Stück mit einem freien Ende, das bis zum Ende dicht neben einem anderen Stück derselben Linie(n) läuft (ein Gleis eingerastet, das andere nicht)
          CH.forEach((c, i) => { if (c.L >= 800 || stub.has(i)) return; const a = c.ns[0], b = c.ns[c.ns.length - 1]; if (a === b) return;
            const da = at3.get(a).length, db = at3.get(b).length; if ((da === 1) === (db === 1)) return;
            const pts = [da === 1 ? a : b, c.ns[c.ns.length >> 1]].map((n) => [NX[n], NY[n]]);
            if (LS[c.ls].every((li) => byL.get(li).some((j) => j !== i && !stub.has(j) && pts.every((q) => nearPoly(q, CH[j]) < 2.5 * P.snap)))) stub.add(i); });
          if (stub.size) { CH = CH.filter((_, i) => !stub.has(i)); ch = true; } }
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
    // Reihenfolge je Stück aus der Geometrie (Ferdinand 01.11.: systematisch statt fester Reihenfolge): für je zwei Striche den gemeinsamen Weg
    // in Fahrtrichtung verfolgen, bis sie sich trennen – wer dort nach rechts abbiegt, liegt rechts. Ohne Trennung vorn entscheidet die Trennung hinten
    // (gespiegelt); ohne beides die feste Reihenfolge. Benachbarte Stücke sehen dieselben Trennungen und ordnen gleich – Kreuzungen nur, wo sie
    // unvermeidbar sind (dann am Zusammenfluss).
    const QS = SA.map((a) => new Set(a.map((e) => e.q)));
    const onn = (c, d) => { const a = rev[c] ? chains[c].ns.slice().reverse() : chains[c].ns; return d ? a.slice().reverse() : a; };
    const vecAt = (ns, fromEnd) => { const k = Math.cos(NY[ns[0]] * Math.PI / 180), m = ns.length;
      const p0 = fromEnd ? ns[m - 1] : ns[0]; let p1 = p0;
      for (let t = 1; t < m; t++) { p1 = fromEnd ? ns[m - 1 - t] : ns[t]; if (Math.hypot((NX[p1] - NX[p0]) * k, NY[p1] - NY[p0]) * R > 80) break; }
      const vx = (NX[p1] - NX[p0]) * k, vy = NY[p1] - NY[p0]; return fromEnd ? [-vx, -vy] : [vx, vy]; };
    const cLen = (c) => chains[c].ns.length * P.step;
    const nexts = (c, d) => { const n = d ? hd(c) : tl(c); return (at2.get(n) || []).filter(([j]) => j !== c).map(([j, e]) => [j, e]); };
    const best = (arr, c) => { let b = arr[0], bs = -1; for (const x of arr) { let s = 0; for (const q of QS[x[0]]) if (QS[c].has(q)) s++; if (s > bs) { bs = s; b = x; } } return b; };
    const side = (i, d, a, b) => { let c = i, dd = d, L = 0;
      for (let st = 0; st < 60 && L < 15000; st++) {
        const nx = nexts(c, dd), ca = nx.filter(([j]) => QS[j].has(a)), cb = nx.filter(([j]) => QS[j].has(b)), both = ca.filter(([j]) => QS[j].has(b));
        // eigener Abzweig einer Linie (Linie teilt sich oder liegt auf einem Nachbargleis) entscheidet vor dem gemeinsamen Weiterweg
        if (!ca.length || !cb.length) return 0;
        const ea = ca.filter(([j]) => !QS[j].has(b)), eb = cb.filter(([j]) => !QS[j].has(a));
        if (!ea.length && !eb.length) { if (!both.length) return 0; const [j, e] = best(both, c); c = j; dd = e; L += cLen(j); continue; }
        const vi = vecAt(onn(c, dd), true), ang = ([j, e]) => { const v = vecAt(onn(j, e), false); return Math.atan2(vi[0] * v[1] - vi[1] * v[0], vi[0] * v[0] + vi[1] * v[1]); };
        const da = ang(best(ea.length ? ea : ca, c)), db = ang(best(eb.length ? eb : cb, c));
        return Math.abs(da - db) < 0.02 ? 0 : da < db ? 1 : -1; // kleinerer Winkel = weiter rechts
      }
      return 0; };
    SA.forEach((arr, i) => { if (arr.length < 2) return;
      const memo = new Map(), r = (a, b) => { const k = a.q + "\n" + b.q; if (!memo.has(k)) { const f = side(i, 0, a.q, b.q); memo.set(k, f || -side(i, 1, a.q, b.q)); } return memo.get(k); };
      const out = []; // Einfügen: Abstand zur festen Reihenfolge so klein wie möglich, Geometrie hat Vorrang
      for (const e of arr) { let at = out.length; while (at > 0) { const v = r(out[at - 1], e); if (v > 0 || (v === 0 && out[at - 1].p > e.p)) at--; else break; } out.splice(at, 0, e); }
      SA[i] = out; });
    const ordr = chains.map((_, i) => i).sort((x, y) => SA[y].length - SA[x].length || chains[y].ns.length - chains[x].ns.length);
    const mainOf = (i, n, ei) => { let b = -1, bs = 0, bl = 0;
      for (const [j, ej] of at2.get(n) || []) { if (j === i || ej === ei) continue; let s = 0; for (const q of QS[j]) if (QS[i].has(q)) s++;
        if (s > bs || (s === bs && s > 0 && SA[j].length > bl)) { b = j; bs = s; bl = SA[j].length; } }
      return b; };
    for (const s0 of ordr) {
      if (!isNaN(CEN[s0])) continue;
      CEN[s0] = (SA[s0].length - 1) / 2; const q = [s0];
      while (q.length) {
        const i = q.shift(), oi = new Map(); SA[i].forEach((e, k) => oi.set(e.q, k - CEN[i]));
        for (const [n, ei] of [[hd(i), 0], [tl(i), 1]]) for (const [j, ej] of at2.get(n) || []) {
          if (j === i || !isNaN(CEN[j]) || ei === ej) continue; // nur Übergänge in Fahrtrichtung (Ende → Anfang)
          if (mainOf(i, n, ei) !== j) continue; // nur die Hauptfortsetzung behält die Plätze; Seitenzweige liegen mittig auf ihrem eigenen Gleis
          let so = 0, sk = 0, c = 0; SA[j].forEach((e, k) => { if (oi.has(e.q)) { so += oi.get(e.q); sk += k; c++; } });
          if (!c) continue;
          const mid = (SA[j].length - 1) / 2; CEN[j] = Math.max(mid - 1.5, Math.min(mid + 1.5, sk / c - so / c)); q.push(j);
        }
      }
    }
    // Platz jedes Strichs an den Enden: Mitte zwischen dem eigenen und dem des anschließenden Stücks (gleiche Linie). Stücke in Gegenrichtung zählen gespiegelt.
    const oOf = (i) => { const arr = SA[i], n = arr.length, cen = isNaN(CEN[i]) ? (n - 1) / 2 : CEN[i], m = new Map(); arr.forEach((e, k) => m.set(e.q, k - cen)); return m; };
    const OO = chains.map((_, i) => oOf(i));
    // Nachbarn am Knoten, Durchfahrt zuerst (Anfang ← Ende bzw. Ende → Anfang). Geschwister, die am selben Knoten in dieselbe Richtung abgehen
    // (Abzweig neben der Hauptstrecke), erst danach – sonst übernahm ein Abzweig den gespiegelten Platz des Geschwisters und lief quer übers Bündel
    // (S1 Gesundbrunnen, 01.11.)
    const thru = (i, head) => { const all = (at2.get(head ? hd(i) : tl(i)) || []).filter(([j]) => j !== i), sm = (ej) => head ? ej === 1 : ej === 0;
      return all.filter(([, ej]) => sm(ej)).concat(all.filter(([, ej]) => !sm(ej))); };
    const endO = (i, q, head) => { const own = OO[i].get(q);
      for (const [j, ej] of thru(i, head)) { if (!OO[j].has(q)) continue; const same = head ? ej === 1 : ej === 0; return (own + (same ? OO[j].get(q) : -OO[j].get(q))) / 2; }
      return own; };
    // glätten und ausgeben: je Strich durchgehend; an den Enden gleitet der Platz über RAMP Meter vom gemeinsamen Wert am Knoten auf den eigenen.
    // Ausgabe in Stücken (höchstens STK Meter, auf den Rampen je ≤ 0,2 Plätze), jedes Stück reicht einen Abschnitt in das nächste hinein (keine Kerben an den Nahtstellen)
    const RAMP = 60, STK = 400, EXT = 10, res = [];
    // Glätten über die Knoten hinweg: jedes Stück wird zusammen mit dem Anfang/Ende des Nachbarstücks geglättet, mit dem es die meisten Linien teilt.
    // So bleibt die Mittellinie am Knoten ohne Knick (sonst Schlaufen und Sprünge der versetzten Linien)
    const RAW = chains.map((c, i) => { const g = c.ns.map((n) => [NX[n], NY[n]]); if (rev[i]) g.reverse(); return g; });
    const HG = Math.max(1, Math.round(P.glatt / P.step));
    const bestNb = (i, head) => { let b = null, bs = 0;
      for (const [j, ej] of thru(i, head)) { const sm = head ? ej === 1 : ej === 0; let sh = 0; for (const q of OO[i].keys()) if (OO[j].has(q)) sh++; if (sm) sh += 1000; if (sh > bs && sh !== 1000) { bs = sh; b = [j, ej]; } }
      return b; };
    const GG = chains.map((c, i) => {
      const g = RAW[i], h = bestNb(i, true), t = bestNb(i, false), K = HG + 2;
      const pre = !h ? [] : h[1] === 1 ? RAW[h[0]].slice(-K - 1, -1) : RAW[h[0]].slice(1, K + 1).reverse();
      const post = !t ? [] : t[1] === 0 ? RAW[t[0]].slice(1, K + 1) : RAW[t[0]].slice(-K - 1, -1).reverse();
      return glatt(pre.concat(g, post), HG).slice(pre.length, pre.length + g.length); });
    // Knoten nach dem Glätten an einer gemeinsamen Stelle: die des Stücks mit den meisten Linien; die anderen Stücke laufen über HG Punkte dorthin
    // (sonst endet jedes Stück an einer etwas anderen Stelle – Versatzsprung zwischen Hauptstrecke und Abzweig)
    const KN = new Map();
    chains.forEach((c, i) => { const g = GG[i]; [[hd(i), g[0]], [tl(i), g[g.length - 1]]].forEach(([n, p]) => { const x = KN.get(n); if (!x || SA[i].length > x[1]) KN.set(n, [p, SA[i].length]); }); });
    GG.forEach((g, i) => { const m = g.length; if (m < 2) return;
      for (const [n, head] of [[hd(i), true], [tl(i), false]]) { const p = KN.get(n)[0], e = head ? g[0] : g[m - 1], dx = p[0] - e[0], dy = p[1] - e[1]; if (!dx && !dy) continue;
        const K = Math.min(HG, m - 1); for (let t = 0; t <= K; t++) { const w = 1 - t / (K + 1), j = head ? t : m - 1 - t; g[j] = [g[j][0] + dx * w, g[j][1] + dy * w]; } } });
    GG.forEach((g, i) => { GG[i] = vereinfache(g, 0.3); });
    // Fortsetzung am Knoten: Punkte des anschließenden Stücks mit derselben Linie (bis EXT Meter), vom Knoten weg geordnet.
    // Der Strich reicht so über den Knoten hinaus – die Ecke am Knoten liegt innerhalb eines Strichs (runde Ecke statt gespreizter Enden)
    const ext = (i, q, head) => {
      for (const [j, ej] of thru(i, head)) { if (!OO[j].has(q) || GG[j].length < 2) continue;
        const g = ej === 1 ? GG[j].slice().reverse() : GG[j], out = []; let L = 0; // ej 1: j endet am Knoten → rückwärts lesen
        // genau bis EXT: nach dem Vereinfachen sind Abschnitte oft 50–200 m lang – ganze Abschnitte ließen Striche weit ins Nachbarstück
        // hineinragen (Bündel doppelt übereinander, Gesundbrunnen 01.11.)
        for (let t = 1; t < g.length && L < EXT; t++) { const l = dist(g[t - 1], g[t]);
          if (L + l > EXT) { const f = (EXT - L) / l; out.push([[g[t - 1][0] + (g[t][0] - g[t - 1][0]) * f, g[t - 1][1] + (g[t][1] - g[t - 1][1]) * f], EXT]); break; }
          L += l; out.push([g[t], L]); }
        // nur in Fortsetzung der eigenen Richtung (sonst kehrt der Strich am Knoten um: Querstrich übers Bündel)
        const o = GG[i], e0 = head ? o[0] : o[o.length - 1], e1 = head ? o[Math.min(1, o.length - 1)] : o[Math.max(0, o.length - 2)];
        if (out.length) { const k = Math.cos(e0[1] * Math.PI / 180), ux = (e0[0] - e1[0]) * k, uy = e0[1] - e1[1], vx = (out[0][0][0] - e0[0]) * k, vy = out[0][0][1] - e0[1];
          if (ux * vx + uy * vy <= 0.5 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) return []; } // mehr als 60° Knick: nicht verlängern
        return out; }
      return []; };
    chains.forEach((c, i) => {
      const g = GG[i]; if (g.length < 2) return;
      const D = [0]; for (let t = 1; t < g.length; t++) D.push(D[t - 1] + dist(g[t - 1], g[t])); const T = D[D.length - 1], TZ = Math.min(RAMP, T / 2);
      if (T < 2 * EXT) return; // winzige Stücke (Weichen, Knotenpaare): die Nachbarn reichen mit ihrer Fortsetzung darüber; eigene Striche wären nur Querstriche
      const arr = SA[i], n = arr.length;
      arr.forEach((e) => { const ks = [...new Set(e.ks)].sort(natCmp), own = OO[i].get(e.q), oh = endO(i, e.q, true), ot = endO(i, e.q, false);
        const oAt = (d) => { d = Math.max(0, Math.min(T, d)); return own + (TZ > 0 ? (oh - own) * Math.max(0, 1 - d / TZ) + (ot - own) * Math.max(0, 1 - (T - d) / TZ) : 0); };
        // Punkte: Fortsetzung davor, Stützpunkte + Teilungen auf den Rampen (alle 8 m), Fortsetzung danach
        const pts = ext(i, e.q, true).reverse().map(([p, L]) => [p, -L]).concat([[g[0], 0]]);
        for (let t = 1; t < g.length; t++) { const a = g[t - 1], b = g[t], l = D[t] - D[t - 1];
          const inR = (oh !== own && D[t - 1] < TZ) || (ot !== own && D[t] > T - TZ), m = inR ? Math.max(1, Math.ceil(l / 8)) : 1;
          for (let j = 1; j < m; j++) { const f = j / m; pts.push([[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], D[t - 1] + l * f]); }
          pts.push([b, D[t]]); }
        ext(i, e.q, false).forEach(([p, L]) => pts.push([p, T + L]));
        // in Stücke teilen
        const prop = { m: e.l.m, k: e.l.k, ks: ks.length > 1 ? ks.slice(0, 6).join(" · ") + (ks.length > 6 ? " …" : "") : e.l.k, c: e.l.c, n };
        let s0 = 0;
        while (s0 < pts.length - 1) {
          const o0 = oAt(pts[s0][1]); let s1 = s0 + 1;
          const cut = (a, b) => (oh !== own && a < TZ - 0.5 && b > TZ + 0.5) || (ot !== own && a < T - TZ - 0.5 && b > T - TZ + 0.5); // Rampe und Gerade getrennt
          while (s1 < pts.length - 1 && pts[s1 + 1][1] - pts[s0][1] <= STK && Math.abs(oAt(pts[s1 + 1][1]) - o0) <= 0.2 && !cut(pts[s0][1], pts[s1 + 1][1])) s1++;
          const o = oAt((pts[s0][1] + pts[s1][1]) / 2), seg = pts.slice(s0, Math.min(pts.length, s1 + 2)).map((x) => [+x[0][0].toFixed(6), +x[0][1].toFixed(6)]);
          res.push({ ...prop, o: Math.round(o * 20) / 20, g: seg });
          s0 = s1;
        }
      });
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
