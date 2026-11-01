// Busse auf der Straße: Fahrtrichtung je OSM-Weg aus der Relation, gerichtete Stücke mit Fahrbahnseite (eigenes Modul, damit Tests es ohne Bau laden können)
export function busRichtung(O, rels) {
  const eq = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7, dirs = new Map();
  rels.forEach((r) => {
    const ws = r.ways.filter((w) => O.W.has(w)); let end = null;
    ws.forEach((w, k) => {
      const g = O.W.get(w), a = g[0], b = g[g.length - 1]; let d = 0;
      if (end) d = eq(end, a) ? 1 : eq(end, b) ? -1 : 0;
      if (!d && k + 1 < ws.length) { const n = O.W.get(ws[k + 1]), na = n[0], nb = n[n.length - 1]; d = eq(b, na) || eq(b, nb) ? 1 : eq(a, na) || eq(a, nb) ? -1 : 0; }
      end = d > 0 ? b : d < 0 ? a : null;
      dirs.set(w, (dirs.get(w) || 0) | (d > 0 ? 1 : d < 0 ? 2 : 4));
    });
  });
  // gerichtete Stücke [Punkte, GD]; aufeinanderfolgende gleicher Seite zu durchgehenden Strichen verketten (glatter Versatz in der App)
  const pc = [];
  dirs.forEach((m, w) => {
    const g = O.W.get(w), ow = O.OW && O.OW.has(w), rv = g.slice().reverse();
    if (m & 4 || !(m & 3)) { pc.push([g, 0, w]); return; }
    if (m & 1) pc.push([g, ow ? 0 : 1, w]);
    if (m & 2) pc.push([rv, ow ? 0 : 1, w]);
  });
  // Nachfolger: Stück gleicher Seite, das am Ende beginnt – nicht die Gegenrichtung desselben Wegs (Wende); nur wenn eindeutig in beide Richtungen
  const key = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6), starts = new Map(), ends = new Map();
  pc.forEach((x, i) => { const a = x[1] + "|" + key(x[0][0]), b = x[1] + "|" + key(x[0][x[0].length - 1]); (starts.get(a) || starts.set(a, []).get(a)).push(i); (ends.get(b) || ends.set(b, []).get(b)).push(i); });
  const nxt = (i) => { const k = pc[i][1] + "|" + key(pc[i][0][pc[i][0].length - 1]), c = (starts.get(k) || []).filter((j) => pc[j][2] !== pc[i][2]); return c.length === 1 && (ends.get(k) || []).filter((j) => pc[j][2] !== pc[c[0]][2]).length === 1 ? c[0] : -1; };
  const prv = new Int32Array(pc.length).fill(-1); pc.forEach((_, i) => { const j = nxt(i); if (j >= 0) prv[j] = i; });
  const used = new Uint8Array(pc.length), out = [];
  const chain = (i) => { let g = pc[i][0].slice(); used[i] = 1;
    for (let j = nxt(i); j >= 0 && !used[j]; j = nxt(j)) { used[j] = 1; g = g.concat(pc[j][0].slice(1)); }
    out.push([g, pc[i][1]]); };
  // Anfänge zuerst (Stücke ohne eindeutigen Vorgänger), dann Reste (Ringe)
  pc.forEach((_, i) => { if (!used[i] && prv[i] < 0) chain(i); });
  pc.forEach((_, i) => { if (!used[i]) chain(i); });
  return out;
}
