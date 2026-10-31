// Linienkarte: ÖPNV-Linien eines Landes aus OpenStreetMap als Vektorkacheln (PMTiles) – für alle Orte ohne Stadtpaket.
// Wie Apple Karten: Linien liegen auf den echten Gleisen, Linien auf gemeinsamer Strecke sauber nebeneinander.
// Dafür wird nicht je Linie ein eigener Verlauf gespeichert (das kreuzt sich, Gegenrichtung spiegelt sich), sondern je Gleis-Weg
// aus OSM ein Abschnitt pro Linie mit festem Platz (o) – alle Linien eines Wegs haben dieselbe Geometrie und Richtung.
// Ablauf: Geofabrik-Auszug → osmium (Linien-Relationen, Wege mit Koordinaten, Bahnhöfe) → GeoJSON-Zeilen → tippecanoe → <land>.pmtiles
// Aufruf: node build.mjs <land> [--out dir]   (Länder: siehe LAENDER)
import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const G = "https://download.geofabrik.de/";
const LAENDER = {
  de: { n: "Deutschland", pbf: G + "europe/germany-latest.osm.pbf" },
  at: { n: "Österreich", pbf: G + "europe/austria-latest.osm.pbf" },
  ch: { n: "Schweiz", pbf: G + "europe/switzerland-latest.osm.pbf" },
  nl: { n: "Niederlande", pbf: G + "europe/netherlands-latest.osm.pbf" },
  be: { n: "Belgien", pbf: G + "europe/belgium-latest.osm.pbf" },
  lu: { n: "Luxemburg", pbf: G + "europe/luxembourg-latest.osm.pbf" },
  fr: { n: "Frankreich", pbf: G + "europe/france-latest.osm.pbf" },
  it: { n: "Italien", pbf: G + "europe/italy-latest.osm.pbf" },
  es: { n: "Spanien", pbf: G + "europe/spain-latest.osm.pbf" },
  pt: { n: "Portugal", pbf: G + "europe/portugal-latest.osm.pbf" },
  gb: { n: "Großbritannien", pbf: G + "europe/united-kingdom-latest.osm.pbf" },
  ie: { n: "Irland", pbf: G + "europe/ireland-and-northern-ireland-latest.osm.pbf" },
  dk: { n: "Dänemark", pbf: G + "europe/denmark-latest.osm.pbf" },
  se: { n: "Schweden", pbf: G + "europe/sweden-latest.osm.pbf" },
  no: { n: "Norwegen", pbf: G + "europe/norway-latest.osm.pbf" },
  fi: { n: "Finnland", pbf: G + "europe/finland-latest.osm.pbf" },
  pl: { n: "Polen", pbf: G + "europe/poland-latest.osm.pbf" },
  cz: { n: "Tschechien", pbf: G + "europe/czech-republic-latest.osm.pbf" },
  hu: { n: "Ungarn", pbf: G + "europe/hungary-latest.osm.pbf" },
  gr: { n: "Griechenland", pbf: G + "europe/greece-latest.osm.pbf" },
};

const args = process.argv.slice(2);
if (args[0] === "--list") { console.log(JSON.stringify(Object.keys(LAENDER))); process.exit(0); }
let OUT = "out"; const want = [];
for (let i = 0; i < args.length; i++) { if (args[i] === "--out") OUT = args[++i]; else want.push(args[i]); }
fs.mkdirSync(OUT, { recursive: true });
const TMP = process.env.LKTMP || fs.mkdtempSync(path.join(os.tmpdir(), "lk-"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const run = (cmd, a) => new Promise((res, rej) => { log(" ", cmd, a.join(" ").slice(0, 160)); const p = spawn(cmd, a, { stdio: ["ignore", "inherit", "pipe"] }); let e = ""; p.stderr.on("data", (d) => { e += d; if (e.length > 4000) e = e.slice(-2000); }); p.on("error", rej); p.on("close", (c) => c ? rej(new Error(cmd + " " + c + " " + e.slice(-500))) : res()); });
const oplDec = (v) => v.replace(/%([0-9a-fA-F]+)%/g, (m, h) => String.fromCodePoint(parseInt(h, 16)));
function oplTags(T) { const t = {}; (T || "").split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) t[oplDec(kv.slice(0, i))] = oplDec(kv.slice(i + 1)); }); return t; }

/* Verkehrsmittel wie in der App (railCls/DMODES) */
const RAILSV = { high_speed: "long", long_distance: "long", night: "long", regional: "reg", commuter: "sbahn", suburban: "sbahn" };
function railCls(k, sv) {
  if (RAILSV[sv || ""]) return RAILSV[sv];
  const n = String(k || "").toUpperCase().trim();
  if (/^(ICE|ICD|IC|EC|ECE|EN|NJ|RJX?|TGV|THA|EST|FR|FA|FB|AVE|ALVIA|WB|FLX)(\s?\d|$)|FLIX|SLEEPER|EUROSTAR|NIGHTJET|INTERCITY|EUROCITY|OUIGO/.test(n)) return "long";
  if (/^S\s?\d|^S-?BAHN|^RER/.test(n)) return "sbahn";
  if (/^(RE|RB|IRE|RS|FEX|MEX|REX|IR|TER|RX|R)(\s?\d|$)|REGIO/.test(n)) return "reg";
  return "train";
}
const ROUTE = { subway: "metro", light_rail: "light", monorail: "light", tram: "tram", funicular: "funi", ferry: "ferry", train: "train" };
const RANK = { long: 0, reg: 1, sbahn: 2, train: 3, metro: 4, light: 5, tram: 6, funi: 7, ferry: 8 };
// erste Zoomstufe, ab der eine Art in den Kacheln steht (die App blendet nach ihrer eigenen Tabelle MZ ein)
const MINZ = { long: 5, reg: 7, sbahn: 7, train: 7, metro: 8, light: 9, ferry: 9, tram: 10, funi: 11 };
const okCol = (c) => { c = String(c || "").trim(); if (/^#?[0-9a-f]{6}$/i.test(c)) return ("#" + c.replace("#", "")).toUpperCase(); if (/^#[0-9a-f]{3}$/i.test(c)) return ("#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase(); return ""; };
const natCmp = (a, b) => String(a).localeCompare(String(b), "de", { numeric: true });

// Ecken abrunden (Bogen mit höchstens 25 m Halbmesser): grob gezeichnete Gleise wirken sonst kantig, mit Versatz nebeneinander noch mehr
function rund(g) {
  if (g.length < 3) return g;
  const M = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320; };
  const out = [g[0]];
  for (let i = 1; i < g.length - 1; i++) {
    const a = g[i - 1], p = g[i], b = g[i + 1], la = M(a, p), lb = M(p, b);
    if (!la || !lb) { out.push(p); continue; }
    const k = Math.cos(p[1] * Math.PI / 180), ux = (p[0] - a[0]) * k / la, uy = (p[1] - a[1]) / la, vx = (b[0] - p[0]) * k / lb, vy = (b[1] - p[1]) / lb;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (turn < 0.12) { out.push(p); continue; } // unter 7°: nichts zu runden
    const d = Math.min(25, 0.45 * la, 0.45 * lb), s = [p[0] - (p[0] - a[0]) * d / la, p[1] - (p[1] - a[1]) * d / la], e = [p[0] + (b[0] - p[0]) * d / lb, p[1] + (b[1] - p[1]) * d / lb];
    for (let j = 0; j <= 4; j++) { const t = j / 4, u = 1 - t; out.push([+(u * u * s[0] + 2 * u * t * p[0] + t * t * e[0]).toFixed(6), +(u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]).toFixed(6)]); }
  }
  out.push(g[g.length - 1]);
  return out;
}

async function pbfGet(url) {
  const f = path.join(TMP, path.basename(url));
  if (fs.existsSync(f) && fs.statSync(f).size > 1e6) return f;
  await run("curl", ["-sSfL", "--retry", "3", "-o", f, url]);
  log("  ok", (fs.statSync(f).size / 1e6).toFixed(0) + " MB");
  return f;
}

async function land(id, L) {
  const src = process.env.LKPBF || await pbfGet(L.pbf); // LKPBF: lokaler Auszug zum Ausprobieren
  const rf = path.join(TMP, id + ".r.pbf"), rl = path.join(TMP, id + ".rl.pbf"), op = path.join(TMP, id + ".opl");
  const sf = path.join(TMP, id + ".s.pbf"), so = path.join(TMP, id + ".s.opl");
  // Linien-Relationen mit ihren Wegen (Knoten nur für die Koordinaten der Wege)
  await run("osmium", ["tags-filter", src, "r/route=train,subway,light_rail,monorail,tram,funicular,ferry", "-o", rf, "--overwrite"]);
  await run("osmium", ["add-locations-to-ways", rf, "-n", "-o", rl, "--overwrite"]);
  await run("osmium", ["cat", rl, "-t", "way", "-t", "relation", "-f", "opl,locations_on_ways=true,add_metadata=false", "-o", op, "--overwrite"]);
  const W = new Map(), R = [];
  for await (const line of readline.createInterface({ input: fs.createReadStream(op), crlfDelay: Infinity })) {
    const t = line[0], sp = line.indexOf(" "), id = +line.slice(1, sp), F = {};
    line.slice(sp + 1).split(" ").forEach((x) => { F[x[0]] = x.slice(1); });
    if (t === "w" && F.N) {
      const g = []; F.N.split(",").forEach((n) => { const ix = n.indexOf("x"), iy = n.indexOf("y"); if (ix > 0 && iy > ix) g.push([+(+n.slice(ix + 1, iy)).toFixed(6), +(+n.slice(iy + 1)).toFixed(6)]); });
      if (g.length > 1) W.set(id, g);
    } else if (t === "r") {
      const tg = oplTags(F.T); if (tg.type && tg.type !== "route" || !ROUTE[tg.route]) continue;
      const ways = (F.M || "").split(",").filter((m) => m[0] === "w").map((m) => { const i = m.indexOf("@"); return [+m.slice(1, i), oplDec(m.slice(i + 1))]; })
        .filter((x) => !/platform|stop|station|entrance/.test(x[1])).map((x) => x[0]);
      R.push({ tg, ways });
    }
  }
  log(id, "Relationen", R.length, "Wege", W.size);
  // Linien: beide Richtungen und Varianten einer Linie (gleiche Art + Nummer + Verbund) zusammenfassen
  const LI = new Map(), lines = [], byWay = new Map();
  R.forEach(({ tg, ways }) => {
    let m = ROUTE[tg.route]; const k = String(tg.ref || tg.name || "").trim().slice(0, 40); if (!k) return;
    if (m === "train") m = railCls(tg.ref ? k : "", tg.service) === "train" && tg.name ? railCls(tg.name, tg.service) : railCls(k, tg.service);
    const key = m + ":" + k + "|" + (tg.network || tg.operator || "");
    if (!LI.has(key)) { LI.set(key, lines.length); lines.push({ m, k, c: okCol(tg.colour || tg.color), n: String(tg.name || "").slice(0, 80) }); }
    const li = LI.get(key), l = lines[li]; if (!l.c) l.c = okCol(tg.colour || tg.color);
    ways.forEach((w) => { if (!W.has(w)) return; let s = byWay.get(w); if (!s) byWay.set(w, s = new Set()); s.add(li); });
  });
  log(id, "Linien", lines.length, "Wege mit Linien", byWay.size);
  // Nacht-/Verstärkerlinien ohne eigene Farbe (N4, 4S, 6E) bekommen die Farbe ihrer Grundlinie – sie werden dann mit ihr zu einem Strich (wie Apple Karten)
  const byK = new Map(); lines.forEach((l) => { if (l.c) byK.set(l.m + ":" + l.k, l.c); });
  lines.forEach((l) => { if (l.m === "long") l.c = ""; }); // Fernverkehr einheitlich (OSM-Farben je IC/ICE sind zufällig) → ein Strich je Gleis statt bunter Bündel
  lines.forEach((l) => { if (l.c || l.m === "long" || l.m === "reg") return; const b = l.k.replace(/^N(?=\d)/, "").replace(/(?<=\d)[A-Z]$/, ""); if (b !== l.k && byK.has(l.m + ":" + b)) l.c = byK.get(l.m + ":" + b); });
  // Eine Linie auf zwei Gleisen (je Richtung ein Gleis, zweigleisige Straßenbahn) = ein Strich: liegt ein Weg einer Linie fast ganz neben einem anderen Weg
  // derselben Linie (Straßenbahn bis 25 m, Bahn bis 40 m), fällt die Linie dort weg. Vorrang hat der Weg mit mehr Linien (Stammstrecke), dann die kleinere Kennung.
  {
    const byLine = new Map(); for (const [w, set] of byWay) for (const li of set) { let a = byLine.get(li); if (!a) byLine.set(li, a = []); a.push(w); }
    const BB = new Map(), bbOf = (w) => { let b = BB.get(w); if (b) return b; b = [180, 90, -180, -90]; for (const q of W.get(w)) { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1]; } BB.set(w, b); return b; };
    const prio = (a, b) => (byWay.get(b).size - byWay.get(a).size) || (a - b); // < 0: a hat Vorrang
    const segD = (p, a, b, k) => { const ax = (b[0] - a[0]) * k, ay = b[1] - a[1], px = (p[0] - a[0]) * k, py = p[1] - a[1], L = ax * ax + ay * ay; const t = L ? Math.max(0, Math.min(1, (px * ax + py * ay) / L)) : 0; return Math.hypot(px - t * ax, py - t * ay) * 111320; };
    const near = (p, g, lim) => { const k = Math.cos(p[1] * Math.PI / 180); for (let i = 1; i < g.length; i++) if (segD(p, g[i - 1], g[i], k) <= lim) return true; return false; };
    const samples = (g) => { const out = []; let len = 0; const d = []; for (let i = 1; i < g.length; i++) { const k = Math.cos(g[i][1] * Math.PI / 180); const x = Math.hypot((g[i][0] - g[i - 1][0]) * k, g[i][1] - g[i - 1][1]) * 111320; d.push(x); len += x; }
      const n = Math.max(3, Math.min(12, Math.round(len / 25))); for (let j = 0; j < n; j++) { let t = (j + .5) / n * len, i = 0; while (i < d.length - 1 && t > d[i]) { t -= d[i]; i++; } const f = d[i] ? t / d[i] : 0; out.push([g[i][0] + (g[i + 1][0] - g[i][0]) * f, g[i][1] + (g[i + 1][1] - g[i][1]) * f]); } return out; };
    const drop = []; let nd = 0;
    for (const [li, ws] of byLine) {
      if (ws.length < 2) continue;
      const lim = lines[li].m === "tram" || lines[li].m === "funi" ? 25 : 40, dg = lim / 111320 * 1.8;
      for (const w of ws) {
        const b = bbOf(w), better = ws.filter((v) => v !== w && prio(v, w) < 0 && (() => { const c = bbOf(v); return !(c[0] > b[2] + dg || c[2] < b[0] - dg || c[1] > b[3] + dg || c[3] < b[1] - dg); })());
        if (!better.length) continue;
        const sm = samples(W.get(w)); let hit = 0;
        for (const p of sm) if (better.some((v) => near(p, W.get(v), lim))) hit++;
        if (hit >= sm.length * .8) { drop.push([w, li]); nd++; }
      }
    }
    for (const [w, li] of drop) { const set = byWay.get(w); set.delete(li); if (!set.size) byWay.delete(w); }
    log(id, "Doppelgleise zusammengefasst", nd, "Wege mit Linien", byWay.size);
  }
  // feste Reihenfolge aller Linien (Art, dann Nummer): auf jedem Weg liegen Linien so in derselben Reihenfolge nebeneinander
  const order = lines.map((_, i) => i).sort((a, b) => RANK[lines[a].m] - RANK[lines[b].m] || natCmp(lines[a].k, lines[b].k)), pos = new Int32Array(lines.length);
  order.forEach((li, i) => { pos[li] = i; });
  const gj = path.join(TMP, id + ".lines.geojsonl"), out = fs.createWriteStream(gj), bb = [180, 90, -180, -90]; let nf = 0;
  const wr = (o) => new Promise((res) => { if (out.write(JSON.stringify(o) + "\n")) res(); else out.once("drain", res); });
  for (const [w, set] of byWay) {
    let g = W.get(w);
    g.forEach((q) => { if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; });
    // einheitliche Richtung (grob West→Ost bzw. Süd→Nord): Nachbarwege, die gegenläufig gezeichnet sind, vertauschen sonst die Seiten
    const a = g[0], b = g[g.length - 1]; if ((b[0] - a[0]) + 0.6 * (b[1] - a[1]) < 0) g = g.slice().reverse();
    // Gruppen auf eigenen Gleisen: Straßenbahn getrennt von Bahnen
    const grp = { rail: [], tram: [], ferry: [] };
    [...set].forEach((li) => { const m = lines[li].m; (m === "tram" ? grp.tram : m === "ferry" ? grp.ferry : grp.rail).push(li); });
    g = rund(g);
    for (const arr0 of Object.values(grp)) {
      arr0.sort((x, y) => pos[x] - pos[y]);
      // gleiche Art und Farbe (auch Linien ohne Farbe) = ein Strich mit allen Nummern; sonst lägen gleichfarbige Striche als breites Band nebeneinander
      const arr = [], seen = new Map();
      arr0.forEach((li) => { const l = lines[li], q = l.m + "|" + l.c; if (seen.has(q)) seen.get(q).ks.push(l.k); else { const e = { l, ks: [l.k] }; seen.set(q, e); arr.push(e); } });
      for (let i = 0; i < arr.length; i++) {
        const { l, ks } = arr[i];
        await wr({ type: "Feature", tippecanoe: { layer: "lines" }, properties: { m: l.m, k: l.k, ks: ks.length > 1 ? ks.slice(0, 6).join(" · ") + (ks.length > 6 ? " …" : "") : l.k, c: l.c, o: +(i - (arr.length - 1) / 2).toFixed(1), n: arr.length }, geometry: { type: "LineString", coordinates: g } });
        nf++;
      }
    }
  }
  // Bahnhöfe und Haltestellen (Name, Art, Bedeutung): Fern-/Regionalbahnhof 3, sonst Zahl der Linien folgt in der App
  await run("osmium", ["tags-filter", src, "n/railway=station,halt,tram_stop", "n/public_transport=station", "-o", sf, "--overwrite"]);
  await run("osmium", ["cat", sf, "-t", "node", "-f", "opl,add_metadata=false", "-o", so, "--overwrite"]);
  let ns = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(so), crlfDelay: Infinity })) {
    const F = {}; line.split(" ").forEach((x) => { F[x[0]] = x.slice(1); }); if (!F.x || !F.y) continue;
    const tg = oplTags(F.T); if (!tg.name || tg.disused || tg["disused:railway"]) continue;
    const st = tg.station || (tg.railway === "tram_stop" ? "tram" : ""), m = st === "subway" ? "metro" : st === "light_rail" ? "light" : st === "tram" ? "tram" : st === "funicular" ? "funi" : st === "ferry" ? "ferry" : "train";
    const r = m === "train" && tg.railway === "station" ? 3 : m === "tram" ? 0 : 1;
    await wr({ type: "Feature", tippecanoe: { layer: "st" }, properties: { n: tg.name.slice(0, 60), m, r }, geometry: { type: "Point", coordinates: [+F.x, +F.y] } });
    ns++;
  }
  await new Promise((res) => out.end(res));
  log(id, "Abschnitte", nf, "Stationen", ns, (fs.statSync(gj).size / 1e6).toFixed(0) + " MB GeoJSON");
  const pm = path.join(OUT, id + ".pmtiles");
  // Zoomstufe je Art als Filter (eine minzoom je Objekt ließ tippecanoe deckungsgleiche Abschnitte zusammenwerfen – Linien fehlten)
  const zf = ["any"]; Object.keys(MINZ).forEach((m) => zf.push(["all", ["==", "m", m], [">=", "$zoom", MINZ[m]]]));
  const jf = JSON.stringify({ lines: zf, st: ["any", ["all", ["==", "r", 3], [">=", "$zoom", 9]], ["all", ["==", "m", "tram"], [">=", "$zoom", 13]], ["all", ["!=", "m", "tram"], [">=", "$zoom", 11]]] });
  await run("tippecanoe", ["-o", pm, "--force", "-Z5", "-z14", "-P", "--no-tile-size-limit", "--simplification=4", "--no-simplification-of-shared-nodes", "-j", jf,
    "-n", "Linienkarte " + L.n, "-A", "© OpenStreetMap-Mitwirkende", gj]);
  log("geschrieben", pm, (fs.statSync(pm).size / 1e6).toFixed(1) + " MB");
  if (!process.env.LKKEEP) [rf, rl, op, sf, so, gj].forEach((f) => fs.rmSync(f, { force: true }));
  // Gebiet höchstens so groß wie der Auszug: lange Fähr-/Fernzug-Wege (Travemünde–Helsinki) zogen den Rahmen bis Finnland → App lud fremde Länder mit
  try { const hb = /(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(execFileSync("osmium", ["fileinfo", "-g", "header.boxes", src], { encoding: "utf8" }));
    if (hb) { const h = hb.slice(1, 5).map(Number); bb[0] = Math.max(bb[0], h[0]); bb[1] = Math.max(bb[1], h[1]); bb[2] = Math.min(bb[2], h[2]); bb[3] = Math.min(bb[3], h[3]); log(id, "Rahmen", bb.join()); } } catch (e) { log(id, "kein Rahmen im Auszug", e.message); }
  return { id, n: L.n, b: fs.statSync(pm).size, bb: bb.map((x) => +x.toFixed(3)), at: new Date().toISOString().slice(0, 10) };
}

const list = want.length ? want : Object.keys(LAENDER);
let fail = 0;
for (const id of list) {
  if (!LAENDER[id]) { log("unbekanntes Land", id); fail++; continue; }
  try { const r = await land(id, LAENDER[id]); fs.writeFileSync(path.join(OUT, id + ".json"), JSON.stringify(r)); }
  catch (e) { log("FEHLER", id, e.stack || e.message); fail++; }
}
process.exit(fail === list.length ? 1 : 0);
