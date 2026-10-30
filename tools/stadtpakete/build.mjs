// Stadtpakete: ÖPNV einer Stadt aus den offiziellen Fahrplandaten fertig aufbereiten (wie die eingebauten New-York-Daten).
// Berlin (VBB) und Paris (IDFM) aus GTFS, London aus der TfL-API (TfL veröffentlicht kein GTFS) plus Busse aus dem DfT-Datensatz (BODS).
// Ergebnis je Stadt: <id>.json (Bahnen, Trams, Fähren, Seilbahnen) und <id>-bus.json (Busse) mit
//   L Linien [Verkehrsmittel, Name, langer Name, Farbe, Textfarbe] · H Richtungen · S Stationen [Name, Breite·1e5, Länge·1e5]
//   E Fahrten zwischen zwei Stationen, flach je 6 Zahlen [von, nach, Linie, Richtung, Sekunden, Tage (1 Mo–Fr, 2 Sa, 4 So)]
//   W mittlere Wartezeit je Linie und Tag [Mo–Fr, Sa, So] in Sekunden · G Streckenverläufe je Linie (Polyline, Genauigkeit 5)
//   D Stationen für die Karte [Station, Verkehrsmittel …]
// Aufruf: node build.mjs [stadt …] [--out dir] [--zip stadt=datei.zip]
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const V = 1;
const MDB = (id) => "https://storage.googleapis.com/storage/v1/b/mdb-latest/o/" + id + ".zip?alt=media"; // Spiegel der Mobility Database, falls der Anbieter nicht antwortet
const CITIES = {
  berlin: { n: "Berlin", src: "VBB", lic: "CC BY 4.0", type: "gtfs", tz: "Europe/Berlin",
    url: ["https://www.vbb.de/vbbgtfs", "https://unternehmen.vbb.de/fileadmin/user_upload/VBB/Dokumente/API-Datensaetze/gtfs-mastscharf/GTFS.zip", MDB("de-berlin-verkehrsverbund-berlin-brandenburg-gtfs-782")],
    bb: [12.88, 52.29, 13.82, 52.71], ext: [12.55, 52.12, 14.15, 52.88], bus: [12.95, 52.33, 13.77, 52.68],
    strip: /\s*\((Berlin|Potsdam)\)$/, col: { tram: "#BE1414", bus: "#A5027D", ferry: "#0080BA" } },
  paris: { n: "Paris", src: "Île-de-France Mobilités", lic: "ODbL", type: "gtfs", tz: "Europe/Paris",
    url: ["https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip", "https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bca93433756d6a340d1/download/", MDB("fr-paris-ile-de-france-mobilite-gtfs-1026")],
    bb: [1.95, 48.62, 2.82, 49.08], ext: [1.45, 48.12, 3.55, 49.25], bus: [2.20, 48.78, 2.50, 48.95] },
  london: { n: "London", src: "Transport for London", lic: "Powered by TfL Open Data", type: "tfl", tz: "Europe/London",
    bb: [-0.62, 51.28, 0.34, 51.72], ext: [-0.75, 51.22, 0.45, 51.78], bus: [-0.35, 51.40, 0.10, 51.62],
    bodsUrl: ["https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/london/"] },
};

const args = process.argv.slice(2);
let OUT = "out", ZIP = {};
const want = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") OUT = args[++i];
  else if (args[i] === "--zip") { const [k, v] = args[++i].split("="); ZIP[k] = v; }
  else want.push(args[i]);
}
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stadt-"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- Hilfen ---------- */
function splitCsv(line) {
  if (line.indexOf('"') < 0) return line.split(",");
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
// Datei aus dem ZIP Zeile für Zeile lesen: fn(Felder als Objekt-Zugriff über Spaltenindex)
async function eachRow(zip, file, fn) {
  const p = spawn("unzip", ["-p", zip, file]);
  const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
  let H = null, n = 0;
  for await (let line of rl) {
    if (!H) { line = line.replace(/^﻿/, ""); H = {}; splitCsv(line).forEach((h, i) => { H[h.trim()] = i; }); continue; }
    if (!line) continue;
    fn(splitCsv(line), H); n++;
  }
  return n;
}
async function hasFile(zip, file) {
  return new Promise((res) => { const p = spawn("unzip", ["-l", zip]); let s = ""; p.stdout.on("data", (d) => { s += d; }); p.on("close", () => res(new RegExp("\\s" + file.replace(".", "\\.") + "\\s*$", "m").test(s))); });
}
async function download(urls, file) {
  for (const u of urls) {
    try {
      log("lade", u);
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(600000), headers: { "user-agent": "Reiseplan-Stadtpakete/1 (github.com/ferdinand-cloud/Reiseplanung)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 10000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("keine ZIP-Datei (" + buf.length + " Bytes)");
      fs.writeFileSync(file, buf); log("  ok", (buf.length / 1e6).toFixed(1) + " MB"); return u;
    } catch (e) { log("  fehlgeschlagen:", e.message); }
  }
  throw new Error("keine Quelle erreichbar");
}
const inBB = (bb, la, lo) => lo >= bb[0] && lo <= bb[2] && la >= bb[1] && la <= bb[3];
const tSec = (s) => { if (!s) return NaN; const p = s.split(":"); return +p[0] * 3600 + +p[1] * 60 + +(p[2] || 0); };
function distM(la1, lo1, la2, lo2) { const x = (lo2 - lo1) * Math.cos((la1 + la2) / 2 * Math.PI / 180) * 111320, y = (la2 - la1) * 110540; return Math.sqrt(x * x + y * y); }
function okCol(c) { c = String(c || "").trim(); return /^#?[0-9a-f]{6}$/i.test(c) ? ("#" + c.replace("#", "")).toUpperCase() : ""; }
// Douglas-Peucker auf [lat, lon]
function simp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length), st = [[0, pts.length - 1]]; keep[0] = keep[pts.length - 1] = 1;
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = pts[a][1], ay = pts[a][0], bx = pts[b][1], by = pts[b][0], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1], py = pts[i][0]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function polyEnc(pts) {
  let o = "", pla = 0, plo = 0;
  const e1 = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); if (a === pla && b === plo && o) continue; o += e1(a - pla) + e1(b - plo); pla = a; plo = b; }
  return o;
}
// Teilstücke innerhalb eines Rechtecks (mit einem Punkt Überstand, damit die Linie bis zum Rand reicht)
function clipRuns(pts, bb) {
  const out = []; let cur = null;
  pts.forEach((p, i) => {
    const ins = inBB(bb, p[0], p[1]);
    if (ins) { if (!cur) { cur = i > 0 ? [pts[i - 1]] : []; } cur.push(p); }
    else if (cur) { cur.push(p); out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out.filter((r) => r.length > 1);
}

/* Verkehrsmittel der App aus GTFS-Typ (Grund- und Erweiterungstypen) und Namen */
function railCls(k, rt) {
  const RT = { 101: "long", 102: "long", 105: "long", 103: "reg", 106: "reg", 107: "reg", 109: "sbahn" };
  if (RT[rt]) return RT[rt];
  const n = String(k || "").toUpperCase().trim();
  if (/^(ICE|ICD|IC|EC|ECE|EN|NJ|RJX?|TGV|THA|EST|FR|FA|FB|AVE|ALVIA|WB|FLX)(\s?\d|$)|FLIX|SLEEPER|EUROSTAR|NIGHTJET|INTERCITY|EUROCITY|OUIGO/.test(n)) return "long";
  if (/^S\s?\d|^S-?BAHN|^RER/.test(n)) return "sbahn";
  if (/^(RE|RB|IRE|RS|FEX|MEX|REX|IR|TER|RX|R)(\s?\d|$)|REGIO/.test(n)) return "reg";
  return "train";
}
function modeOf(rt, k, ln, ag, city) {
  rt = +rt;
  if (city === "paris" && rt === 2) return ag === "IDFM:71" ? "sbahn" : "reg"; // RER = S-Bahn, Transilien und TER = Regionalverkehr
  if (/^(ORLYVAL|CDG ?VAL)$/i.test(k)) return "light";
  if (rt === 0 || (rt >= 900 && rt < 1000)) return "tram";
  if (rt === 1 || (rt >= 400 && rt < 500)) return "metro";
  if (rt === 12 || rt === 405) return "light";
  if (rt === 2 || (rt >= 100 && rt < 200)) { const c = railCls(k, rt); return c === "train" && ln ? railCls(ln, rt) : c; }
  if (rt === 3 || rt === 11 || (rt >= 700 && rt < 900) || (rt >= 200 && rt < 300)) return "bus";
  if (rt === 4 || rt === 1000 || rt === 1200) return "ferry";
  if (rt === 5 || rt === 6 || rt === 7 || (rt >= 1300 && rt < 1500)) return "funi";
  return "";
}
const RAILY = { metro: 1, light: 1, sbahn: 1, reg: 1, long: 1, train: 1, funi: 1, ferry: 1, tram: 1 };

/* Tage: je ein typischer Werktag, Samstag, Sonntag im Gültigkeitszeitraum (der mit den meisten Fahrten unter den nächsten vier) */
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function pickDays(cal, cdt, tripsBySvc, start, end) {
  const today = process.env.TODAY ? new Date(process.env.TODAY + "T12:00:00Z") : new Date(); today.setUTCHours(12, 0, 0, 0); // TODAY=2026-06-10 für alte Testdaten
  const first = new Date(Math.max(today.getTime(), Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8), 12)));
  const active = (d) => { const s = ymd(d), wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getUTCDay()], out = new Set();
    for (const [id, c] of cal) if (c[wd] && c.start <= s && c.end >= s) out.add(id);
    for (const [id, e] of cdt.get(s) || []) { if (e === 1) out.add(id); else out.delete(id); }
    return out; };
  const res = {};
  [[1, [3]], [2, [6]], [4, [0]]].forEach(([bit, wds]) => {
    let best = null, bestN = -1;
    for (let k = 0, found = 0; k < 60 && found < 4; k++) {
      const d = new Date(first.getTime() + k * 86400000); if (!wds.includes(d.getUTCDay())) continue;
      if (ymd(d) > end) break; found++;
      const a = active(d); let n = 0; for (const s of a) n += tripsBySvc.get(s) || 0;
      if (n > bestN) { bestN = n; best = { d: ymd(d), svc: a }; }
    }
    if (best) res[bit] = best;
  });
  return res;
}

/* ---------- GTFS → Netz ---------- */
async function buildGtfs(id, C, zip, opt) {
  opt = opt || {};
  const onlyBus = !!opt.onlyBus;
  // Linien
  const R = new Map();
  await eachRow(zip, "routes.txt", (f, H) => {
    const k0 = (f[H.route_short_name] || "").trim(), ln = (f[H.route_long_name] || "").trim(), k = (k0 || ln).slice(0, 40);
    const m = modeOf(f[H.route_type], k, ln, f[H.agency_id] || "", id);
    if (!m || !k || (onlyBus && m !== "bus")) return;
    R.set(f[H.route_id], { m, k, n: ln && ln !== k ? ln.slice(0, 80) : "", c: okCol(f[H.route_color]), tc: okCol(f[H.route_text_color]) });
  });
  log(id, "Linien", R.size);
  // Kalender
  const cal = new Map(), cdt = new Map(); let start = "99999999", end = "00000000";
  if (await hasFile(zip, "calendar.txt")) await eachRow(zip, "calendar.txt", (f, H) => {
    const o = { start: f[H.start_date], end: f[H.end_date] }; ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach((d) => { o[d] = f[H[d]] === "1"; });
    cal.set(f[H.service_id], o); if (o.start < start) start = o.start; if (o.end > end) end = o.end;
  });
  if (await hasFile(zip, "calendar_dates.txt")) await eachRow(zip, "calendar_dates.txt", (f, H) => {
    const d = f[H.date]; if (!cdt.has(d)) cdt.set(d, []); cdt.get(d).push([f[H.service_id], +f[H.exception_type]]);
    if (d < start) start = d; if (d > end) end = d;
  });
  // Fahrten
  const T = new Map(), tripsBySvc = new Map();
  await eachRow(zip, "trips.txt", (f, H) => {
    const r = f[H.route_id]; if (!R.has(r)) return;
    const s = f[H.service_id]; tripsBySvc.set(s, (tripsBySvc.get(s) || 0) + 1);
    T.set(f[H.trip_id], { r, s, d: f[H.direction_id] || "", h: (f[H.trip_headsign] || "").trim(), sh: f[H.shape_id] || "", m: 0 });
  });
  const DAYS = pickDays(cal, cdt, tripsBySvc, start, end);
  log(id, "Tage", Object.keys(DAYS).map((b) => b + ":" + DAYS[b].d).join(" "), "Gültig", start, "–", end);
  for (const [tid, t] of T) { let m = 0; for (const b of [1, 2, 4]) if (DAYS[b] && DAYS[b].svc.has(t.s)) m |= b; if (!m) T.delete(tid); else t.m = m; }
  log(id, "Fahrten an den gewählten Tagen", T.size);
  // Haltestellen → Stationen (Elternstation, sonst gleicher Name in der Nähe)
  const SP = new Map(), par = new Map();
  await eachRow(zip, "stops.txt", (f, H) => {
    const la = +f[H.stop_lat], lo = +f[H.stop_lon]; if (!isFinite(la) || !isFinite(lo)) return;
    let n = (f[H.stop_name] || "").trim(); if (C.strip) n = n.replace(C.strip, "");
    SP.set(f[H.stop_id], { n, la, lo, p: (f[H.parent_station] || "").trim(), lt: +(f[H.location_type] || 0) });
  });
  const ST = [], stKey = new Map(), byName = new Map();
  function stationOf(sid) {
    if (stKey.has(sid)) return stKey.get(sid);
    const s = SP.get(sid); if (!s) { stKey.set(sid, -1); return -1; }
    let base = s; if (s.p && SP.has(s.p)) base = SP.get(s.p);
    const pk = s.p && SP.has(s.p) ? "p:" + s.p : "";
    let idx = pk && stKey.has(pk) ? stKey.get(pk) : -1;
    if (idx < 0) {
      for (const j of byName.get(base.n) || []) { if (distM(ST[j].la, ST[j].lo, base.la, base.lo) < 250) { idx = j; break; } }
      if (idx < 0) { idx = ST.length; ST.push({ n: base.n, la: base.la, lo: base.lo, m: {} }); if (!byName.has(base.n)) byName.set(base.n, []); byName.get(base.n).push(idx); }
      if (pk) stKey.set(pk, idx);
    }
    stKey.set(sid, idx); return idx;
  }
  // Fahrzeiten: je Fahrtmuster (Linie, Richtung, Haltfolge) Takt und mittlere Fahrzeit je Abschnitt
  const PAT = new Map(); let curT = null, buf = [], seen = new Set(), rows = 0;
  const flush = () => {
    if (!curT) return;
    const t = T.get(curT); curT = null; if (!t || buf.length < 2) { buf = []; return; }
    buf.sort((a, b) => a[0] - b[0]);
    const r = R.get(t.r), bb = r.m === "bus" ? C.bus : C.ext;
    const st = [], dep = [];
    for (const [, sid, a, d] of buf) {
      const s = SP.get(sid); if (!s) continue;
      const idx = inBB(bb, s.la, s.lo) ? stationOf(sid) : -1;
      if (st.length && st[st.length - 1] === idx && idx >= 0) { dep[dep.length - 1] = isNaN(d) ? a : d; continue; }
      st.push(idx); dep.push(isNaN(d) ? a : d);
    }
    buf = [];
    if (st.filter((x) => x >= 0).length < 2) return;
    const key = t.r + "|" + t.d + "|" + st.join(",");
    let P = PAT.get(key);
    if (!P) { P = { r: t.r, d: t.d, st, n: { 1: 0, 2: 0, 4: 0 }, day: { 1: 0, 2: 0, 4: 0 }, sum: new Float64Array(st.length), cnt: new Uint32Array(st.length), h: new Map(), sh: new Map() }; PAT.set(key, P); }
    const t0 = dep.find((x, i) => st[i] >= 0);
    for (const b of [1, 2, 4]) if (t.m & b) { P.n[b]++; if (t0 >= 7 * 3600 && t0 < 20 * 3600) P.day[b]++; }
    for (let i = 0; i + 1 < st.length; i++) { const dt = dep[i + 1] - dep[i]; if (dt >= 0 && dt < 7200) { P.sum[i] += dt; P.cnt[i]++; } }
    if (t.h) P.h.set(t.h, (P.h.get(t.h) || 0) + 1);
    if (t.sh) P.sh.set(t.sh, (P.sh.get(t.sh) || 0) + 1);
  };
  await eachRow(zip, "stop_times.txt", (f, H) => {
    const tid = f[H.trip_id];
    if (tid !== curT) { flush(); if (!T.has(tid)) { curT = null; return; } if (seen.has(tid)) log("  Warnung: Fahrt nicht zusammenhängend", tid); seen.add(tid); curT = tid; }
    if (!curT) return;
    buf.push([+f[H.stop_sequence], f[H.stop_id], tSec(f[H.arrival_time]), tSec(f[H.departure_time])]); rows++;
  });
  flush();
  log(id, "Halte", rows, "Muster", PAT.size, "Stationen", ST.length);
  return { R, T, PAT, ST, DAYS, start, end, SP };
}

/* Netz aus Mustern zusammensetzen: Linien gleichen Namens zusammenfassen, Richtungen, Fahrten, Takte, Streckenverläufe */
async function assemble(id, C, net, bus, zip, shapesOf) {
  const { R, PAT, ST } = net, bb = bus ? C.bus : C.bb;
  const LI = new Map(), L = [], lineOf = (r) => { const x = R.get(r), k = x.m + ":" + x.k; if (!LI.has(k)) { LI.set(k, L.length); L.push({ m: x.m, k: x.k, n: x.n, c: x.c, tc: x.tc, pats: [] }); } const l = L[LI.get(k)]; if (!l.c && x.c) { l.c = x.c; l.tc = x.tc; } if (!l.n && x.n) l.n = x.n; return LI.get(k); };
  for (const P of PAT.values()) {
    const x = R.get(P.r); if ((x.m === "bus") !== bus) continue;
    const tot = P.n[1] + P.n[2] + P.n[4]; if (tot < 2) continue; // Einzelfahrten (Betriebsfahrten, Ersatzverkehr) weglassen
    const ins = P.st.filter((s) => s >= 0 && inBB(bb, ST[s].la, ST[s].lo)).length;
    if (bus ? ins < Math.max(2, P.st.filter((s) => s >= 0).length * 0.5) : ins < 1) continue;
    L[lineOf(P.r)].pats.push(P);
  }
  const keep = L.filter((l) => l.pats.length);
  log(id, bus ? "Buslinien" : "Linien", keep.length);
  // Stationen neu nummerieren (nur benutzte)
  const SI = new Map(), S = [], sIdx = (s) => { if (!SI.has(s)) { SI.set(s, S.length); S.push(ST[s]); } return SI.get(s); };
  const H = [], HI = new Map(), hIdx = (h) => { if (!HI.has(h)) { HI.set(h, H.length); H.push(h); } return HI.get(h); };
  const E = new Map(), W = [], G = [], Lout = [];
  const needShapes = new Set();
  keep.forEach((l, li) => {
    // Richtung: GTFS direction_id, sonst Endstation; Name = häufigstes Fahrtziel
    const dirs = new Map();
    l.pats.forEach((P) => { const last = P.st.filter((s) => s >= 0).pop(); const dk = P.d !== "" ? P.d : "e" + last; if (!dirs.has(dk)) dirs.set(dk, { pats: [], h: new Map() }); const D = dirs.get(dk); D.pats.push(P);
      const tot = P.n[1] + P.n[2] + P.n[4]; if (P.h.size) for (const [h, n] of P.h) D.h.set(h, (D.h.get(h) || 0) + n); else { const nm = ST[last].n; D.h.set(nm, (D.h.get(nm) || 0) + tot); } });
    const w = [0, 0, 0];
    for (const D of dirs.values()) {
      let hn = [...D.h.entries()].sort((a, b) => b[1] - a[1])[0][0]; if (C.strip) hn = hn.replace(C.strip, "");
      const hd = hIdx(hn.slice(0, 60));
      D.pats.forEach((P) => {
        const mask = (P.n[1] >= 2 ? 1 : 0) | (P.n[2] >= 2 ? 2 : 0) | (P.n[4] >= 2 ? 4 : 0); if (!mask) return;
        for (let i = 0; i + 1 < P.st.length; i++) {
          const a = P.st[i], b = P.st[i + 1]; if (a < 0 || b < 0 || a === b || !P.cnt[i]) continue;
          const secs = Math.max(30, Math.round(P.sum[i] / P.cnt[i]));
          const k = sIdx(a) + "|" + sIdx(b) + "|" + li + "|" + hd;
          const o = E.get(k); if (o) { o.mask |= mask; o.s += secs * P.cnt[i]; o.c += P.cnt[i]; } else E.set(k, { a: sIdx(a), b: sIdx(b), l: li, h: hd, mask, s: secs * P.cnt[i], c: P.cnt[i] });
          ST[a].m[l.m] = 1; ST[b].m[l.m] = 1;
        }
      });
      // Takt tagsüber (7–20 Uhr) je Tag: Fahrten aller Muster dieser Richtung
      [1, 2, 4].forEach((b, j) => { const n = D.pats.reduce((x, P) => x + P.day[b], 0); w[j] = Math.max(w[j], n); });
    }
    W.push(w.map((n) => n ? Math.max(60, Math.min(1800, Math.round(13 * 3600 / n / 2))) : 0)); // mittlere Wartezeit = halber Takt
    // Streckenverläufe: häufigste Muster zuerst, weitere nur, wenn sie neue Abschnitte abdecken (Äste, Linienwege)
    const cov = new Set(), shp = [];
    l.pats.slice().sort((a, b) => (b.n[1] + b.n[2] + b.n[4]) - (a.n[1] + a.n[2] + a.n[4])).forEach((P) => {
      const segs = []; for (let i = 0; i + 1 < P.st.length; i++) if (P.st[i] >= 0 && P.st[i + 1] >= 0) segs.push(Math.min(P.st[i], P.st[i + 1]) + "-" + Math.max(P.st[i], P.st[i + 1]));
      const nw = segs.filter((s) => !cov.has(s)).length; if (!nw || shp.length >= (bus ? 4 : 14)) return;
      if (shp.length && nw < 2 && segs.length > 3) return;
      segs.forEach((s) => cov.add(s));
      const sh = P.sh.size ? [...P.sh.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
      shp.push({ sh, st: P.st }); if (sh) needShapes.add(sh);
    });
    l.shp = shp;
    Lout.push([l.m, l.k, l.n, l.c || (C.col && C.col[l.m]) || "", l.tc || ""]);
  });
  // Streckenverläufe lesen
  const SH = await shapesOf(needShapes);
  const straight = []; // je Linie: Verlauf (teils) nur als Luftlinie zwischen Stationen → später durch OpenStreetMap-Gleise ersetzen
  keep.forEach((l) => {
    const tol = bus ? 0.00008 : 0.00004, out = []; let st = false;
    l.shp.forEach((x) => {
      let pts = x.sh && SH.get(x.sh);
      // Verlauf vorhanden, aber grob (VBB/IDFM: manche Shapes sind gerade Linien zwischen weit entfernten Halten) → ebenfalls ersetzen
      if (pts && pts.length >= 2 && maxSeg(pts) > (SEGMAX[l.m] || 3)) st = true;
      if (!pts || pts.length < 2) { st = true; if (C.noStraight) return; pts = x.st.filter((s) => s >= 0).map((s) => [ST[s].la, ST[s].lo]); } // ohne Streckenverlauf: Stationsfolge (London-Busse: keine Luftlinien, Verlauf kommt aus OpenStreetMap)
      clipRuns(pts, C.ext).forEach((r) => out.push(polyEnc(simp(r, tol))));
    });
    G.push([...new Set(out)]); straight.push(st);
  });
  const Ef = []; for (const e of E.values()) Ef.push(e.a, e.b, e.l, e.h, Math.round(e.s / e.c), e.mask);
  const D = [];
  if (!bus) S.forEach((s, i) => { const ms = Object.keys(s.m).filter((m) => m !== "tram" && m !== "bus" && m !== "ferry"); if (ms.length && inBB(C.bb, s.la, s.lo)) D.push([i].concat(ms)); });
  return { L: Lout, H, S: S.map((s) => [s.n, Math.round(s.la * 1e5), Math.round(s.lo * 1e5)]), E: Ef, W, G, D, _st: straight };
}

async function shapesFromZip(zip, need) {
  const SH = new Map(); if (!need.size || !(await hasFile(zip, "shapes.txt"))) return SH;
  const tmp = new Map();
  await eachRow(zip, "shapes.txt", (f, H) => { const s = f[H.shape_id]; if (!need.has(s)) return; if (!tmp.has(s)) tmp.set(s, []); tmp.get(s).push([+f[H.shape_pt_sequence], +f[H.shape_pt_lat], +f[H.shape_pt_lon]]); });
  for (const [s, a] of tmp) SH.set(s, a.sort((x, y) => x[0] - y[0]).map((p) => [p[1], p[2]]));
  log("  Streckenverläufe", SH.size, "von", need.size);
  return SH;
}

function write(id, part, meta, d) {
  const o = Object.assign({ v: V, id, part }, meta, d); delete o._st;
  const f = path.join(OUT, id + (part === "bus" ? "-bus" : "") + ".json");
  fs.writeFileSync(f, JSON.stringify(o));
  log("geschrieben", f, (fs.statSync(f).size / 1e6).toFixed(2) + " MB", "Linien", d.L.length, "Stationen", d.S.length, "Fahrten", d.E.length / 6);
}

async function gtfsCity(id, C) {
  const zip = ZIP[id] || path.join(TMP, id + ".zip");
  const from = ZIP[id] ? zip : await download(C.url, zip);
  const net = await buildGtfs(id, C, zip);
  const meta = { n: C.n, src: C.src, lic: C.lic, tz: C.tz, at: new Date().toISOString().slice(0, 10), valid: [net.start, net.end], days: Object.fromEntries(Object.entries(net.DAYS).map(([b, x]) => [b, x.d])), bb: C.bb, url: from.startsWith("http") ? from : "" };
  const sh = (need) => shapesFromZip(zip, need);
  // Ohne Streckenverläufe im GTFS (VBB, IDFM) wären Linien Luftlinien zwischen Stationen („falsche Verbindungen“) → Gleise aus OpenStreetMap
  const rail = await assemble(id, C, net, false, zip, sh);
  try { const n = osmFill(rail, await osmRoutes(C.ext, "subway|light_rail|train|tram|ferry|funicular"), false); if (n) { meta.src = C.src + " · Verläufe © OpenStreetMap"; meta.lic = C.lic + ", ODbL"; } }
  catch (e) { log("  OSM-Verläufe Bahn fehlgeschlagen:", e.message); }
  write(id, "rail", meta, rail);
  const bus = await assemble(id, C, net, true, zip, sh);
  try { osmFill(bus, await osmRoutes(C.bus, "bus|trolleybus"), true); } catch (e) { log("  OSM-Verläufe Bus fehlgeschlagen:", e.message); }
  write(id, "bus", meta, bus);
  if (!ZIP[id]) fs.rmSync(zip, { force: true });
}

/* ---------- London: TfL-API (Bahnen) + BODS (Busse) ---------- */
const TFLMODE = { tube: "metro", dlr: "light", overground: "sbahn", "elizabeth-line": "sbahn", tram: "tram", "cable-car": "funi", "river-bus": "ferry" };
// TfL-Linienfarben (TfL Colour Standard; die API liefert keine Farben)
const TFLCOL = { bakerloo: "#B36305", central: "#E32017", circle: "#FFD300", district: "#00782A", "hammersmith-city": "#F3A9BB", jubilee: "#A0A5A9", metropolitan: "#9B0056", northern: "#000000",
  piccadilly: "#003688", victoria: "#0098D4", "waterloo-city": "#95CDBA", dlr: "#00A4A7", elizabeth: "#6950A1", tram: "#5FB526", "london-cable-car": "#E21836",
  liberty: "#676767", lioness: "#FAA61A", mildmay: "#437EC1", suffragette: "#5BBD72", weaver: "#823A62", windrush: "#ED1B00" };
const TFLDARK = { circle: 1, "hammersmith-city": 1, "waterloo-city": 1, lioness: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tfl(p) {
  const u = "https://api.tfl.gov.uk" + p;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "Reiseplan-Stadtpakete/1" } }).catch((e) => ({ ok: false, status: e.message }));
    if (r.ok) { await sleep(250); return r.json(); }
    if (r.status === 404) throw new Error("TfL " + p + " 404"); // gibt es nicht (z. B. Fahrplan der Overground): nicht wiederholen
    log("  TfL", p, r.status); await sleep(r.status === 429 ? 30000 : 3000);
  }
  throw new Error("TfL " + p);
}
async function londonRail(C) {
  const lines = await tfl("/Line/Mode/" + Object.keys(TFLMODE).join(","));
  const ST = [], SK = new Map(), stIdx = (sp) => {
    const key = sp.topMostParentId || sp.stationId || sp.parentId || sp.id;
    if (SK.has(key)) return SK.get(key);
    const nm = String(sp.name || sp.commonName || "").replace(/\s+(Underground|Rail|DLR|Elizabeth line|Tram|Overground)?\s*Station$/i, "").replace(/\s*\((London|Dock|Pier|Tram Stop)\)$/i, "").trim();
    for (let j = 0; j < ST.length; j++) if (ST[j].n === nm && distM(ST[j].la, ST[j].lo, sp.lat, sp.lon) < 400) { SK.set(key, j); return j; }
    SK.set(key, ST.length); ST.push({ n: nm, la: sp.lat, lo: sp.lon, m: {} }); return ST.length - 1;
  };
  const L = [], H = [], HI = new Map(), hIdx = (h) => { if (!HI.has(h)) { HI.set(h, H.length); H.push(h); } return HI.get(h); };
  const E = new Map(), W = [], G = [];
  for (const ln of lines) {
    const m = TFLMODE[ln.modeName]; if (!m) continue;
    const li = L.length, col = TFLCOL[ln.id] || "", seg = [];
    let w = [0, 0, 0], any = false;
    for (const dir of ["outbound", "inbound"]) {
      let sq; try { sq = await tfl("/Line/" + ln.id + "/Route/Sequence/" + dir + "?excludeCrowding=true"); } catch (e) { log("  ohne Linienweg", ln.id, dir); continue; }
      (sq.lineStrings || []).forEach((s) => { try { JSON.parse(s).forEach((r) => { if (dir === "outbound" || !seg.length) seg.push(r.map((p) => [p[1], p[0]])); }); } catch (e) {} });
      for (const br of sq.stopPointSequences || []) {
        const sps = br.stopPoint || []; if (sps.length < 2) continue;
        const idx = sps.map(stIdx), last = ST[idx[idx.length - 1]].n, hd = hIdx(last.slice(0, 60));
        // Fahrzeiten aus dem Fahrplan ab der ersten Station des Asts, sonst geschätzt (Strecke / Reisegeschwindigkeit)
        let tt = null, sched = null;
        try {
          const tj = await tfl("/Line/" + ln.id + "/Timetable/" + sps[0].id + "?direction=" + dir);
          const rt = tj && tj.timetable && tj.timetable.routes && tj.timetable.routes[0];
          if (rt) {
            const want = sps.map((s) => s.id), iv = (rt.stationIntervals || []).map((x) => x.intervals || []).sort((a, b) => b.length - a.length)[0] || [];
            const at = new Map(iv.map((x) => [x.stopId, x.timeToArrival * 60])); at.set(sps[0].id, 0);
            if (want.filter((s) => at.has(s)).length >= want.length * 0.6) tt = want.map((s) => at.has(s) ? at.get(s) : NaN);
            sched = rt.schedules || [];
          }
        } catch (e) {}
        const v = { metro: 9, light: 8, sbahn: 11, tram: 6, funi: 8, ferry: 7 }[m]; // m/s inkl. Halt
        for (let i = 0; i + 1 < idx.length; i++) {
          if (idx[i] === idx[i + 1]) continue;
          let secs = tt && isFinite(tt[i]) && isFinite(tt[i + 1]) && tt[i + 1] > tt[i] ? tt[i + 1] - tt[i] : NaN;
          if (!isFinite(secs)) secs = distM(ST[idx[i]].la, ST[idx[i]].lo, ST[idx[i + 1]].la, ST[idx[i + 1]].lo) / v + 30;
          const k = idx[i] + "|" + idx[i + 1] + "|" + li + "|" + hd;
          if (!E.has(k)) E.set(k, { a: idx[i], b: idx[i + 1], l: li, h: hd, s: Math.round(Math.max(30, secs)), mask: 7 });
          ST[idx[i]].m[m] = 1; ST[idx[i + 1]].m[m] = 1; any = true;
        }
        // Takt aus bekannten Abfahrten 7–20 Uhr je Fahrplan (Montag–Freitag, Samstag, Sonntag)
        (sched || []).forEach((s) => { const nm = String(s.name || "").toLowerCase(), j = /sunday/.test(nm) && !/monday/.test(nm) ? 2 : /saturday/.test(nm) && !/monday/.test(nm) ? 1 : /monday|weekday/.test(nm) ? 0 : -1; if (j < 0) return;
          const n = (s.knownJourneys || []).filter((x) => +x.hour >= 7 && +x.hour < 20).length; w[j] = Math.max(w[j], n); });
      }
    }
    if (!any) continue;
    const name = ln.modeName === "tube" || ln.modeName === "overground" || ln.id === "elizabeth" ? ln.name : ln.name;
    L.push([m, name.slice(0, 40), "", col, col ? (TFLDARK[ln.id] ? "#111111" : "#FFFFFF") : ""]);
    W.push(w.map((n, j) => n ? Math.max(60, Math.min(1800, Math.round(13 * 3600 / n / 2))) : (m === "metro" ? 180 : ln.id === "elizabeth" ? 240 : 450)));
    G.push([...new Set(seg.flatMap((r) => clipRuns(r, C.ext)).map((r) => polyEnc(simp(r, 0.00004))))]);
    log("  ", ln.id, m, "Stationen bisher", ST.length);
  }
  const Ef = []; for (const e of E.values()) Ef.push(e.a, e.b, e.l, e.h, e.s, e.mask);
  const D = []; ST.forEach((s, i) => { const ms = Object.keys(s.m).filter((m) => m !== "tram" && m !== "ferry"); if (ms.length && inBB(C.bb, s.la, s.lo)) D.push([i].concat(ms)); });
  return { L, H, S: ST.map((s) => [s.n, Math.round(s.la * 1e5), Math.round(s.lo * 1e5)]), E: Ef, W, G, D };
}
/* Streckenverläufe aus OpenStreetMap (TfL liefert nur grobe Linien von Station zu Station, BODS-Busse gar keine):
   je Linien-Relation die Wege mit Geometrie; Schlüssel = Relation (Name, ref, Verkehrsmittel) */
async function overpass(q) {
  for (const u of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Reiseplan-Stadtpakete/1" }, signal: AbortSignal.timeout(200000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json(); if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark);
        return j;
      } catch (e) { log("  Overpass", u, e.message); await sleep(15000); }
    }
  }
  throw new Error("Overpass nicht erreichbar");
}
/* große Gebiete (Berlin/Paris mit Umland) schafft Overpass nicht in einer Abfrage (502/504):
   je Verkehrsmittel und Kachel einzeln abfragen und zusammenführen */
async function osmRoutes(bb, routes, nt = 2) {
  const W = new Map(), RM = new Map(); let ok = 0, err = null;
  for (const rt of routes.split("|")) for (let ix = 0; ix < nt; ix++) for (let iy = 0; iy < nt; iy++) {
    const w = (bb[2] - bb[0]) / nt, h = (bb[3] - bb[1]) / nt, t = [bb[0] + ix * w, bb[1] + iy * h, bb[0] + (ix + 1) * w, bb[1] + (iy + 1) * h];
    const b = [t[1], t[0], t[3], t[2]].map((x) => x.toFixed(4)).join(",");
    try {
      const j = await overpass("[out:json][timeout:180][maxsize:1000000000];rel[type=route][route=" + rt + "](" + b + ")->.r;.r out body;way(r.r)(" + b + ");out skel geom;");
      (j.elements || []).forEach((e) => { if (e.type === "way" && e.geometry) W.set(e.id, e.geometry.filter(Boolean).map((p) => [p.lat, p.lon])); else if (e.type === "relation") RM.set(e.id, e); });
      ok++;
    } catch (e) { err = e; log("  OpenStreetMap", rt, "Kachel", ix, iy, "fehlgeschlagen"); }
  }
  if (!ok) throw err || new Error("Overpass nicht erreichbar");
  const R = [];
  RM.forEach((e) => { const t = e.tags || {}; R.push({ route: t.route, ref: String(t.ref || "").trim(), name: String(t.name || ""), ways: (e.members || []).filter((m) => m.type === "way" && W.has(m.ref) && !/platform|stop/.test(m.role || "")).map((m) => m.ref) }); }); // Bahnsteige/Haltepunkte sind keine Strecke
  log("  OpenStreetMap", routes, "Relationen", R.length, "Wege", W.size, "Abfragen ok", ok);
  return { W, R };
}
// längstes gerades Stück eines Verlaufs in km; Grenze je Verkehrsmittel, ab der es keine echte Strecke mehr sein kann
const SEGMAX = { tram: 0.7, light: 0.9, funi: 0.9, metro: 1.4, ferry: 50, sbahn: 2.5, bus: 1.0 };
function maxSeg(pts) { let m = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], dy = (b[0] - a[0]) * 111.2, dx = (b[1] - a[1]) * 111.2 * Math.cos(a[0] * Math.PI / 180); m = Math.max(m, Math.hypot(dx, dy)); } return m; }
/* Linien mit Luftlinien-Verlauf: Wege der OSM-Relationen mit gleicher Liniennummer und passendem Verkehrsmittel.
   Busse ohne Treffer verlieren die Luftlinie (lieber kein Verlauf als ein falscher), Bahnen behalten sie. */
const OSMRT = { metro: ["subway", "light_rail"], light: ["light_rail", "subway", "tram"], sbahn: ["train", "light_rail"], reg: ["train"], long: ["train"], train: ["train"], tram: ["tram", "light_rail"], funi: ["funicular"], ferry: ["ferry"], bus: ["bus", "trolleybus"] };
const refNorm = (x) => String(x || "").toLowerCase().replace(/bis\b/, "b").replace(/[^a-z0-9]+/g, "");
function osmFill(d, O, bus) {
  const by = new Map(); O.R.forEach((r) => { const k = refNorm(r.ref); if (!k) return; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  let n = 0, miss = [];
  d.L.forEach((l, i) => {
    if (!d._st || !d._st[i]) return;
    const rt = OSMRT[l[0]] || (bus ? OSMRT.bus : []), rels = (by.get(refNorm(l[1])) || []).filter((r) => rt.includes(r.route));
    const g = rels.length ? osmGeo(O, rels, bus ? 0.00008 : 0.00004) : [];
    if (g.length) { d.G[i] = g; n++; } else { miss.push(l[1]); if (bus) d.G[i] = []; }
  });
  log("  OSM-Verläufe", bus ? "Bus" : "Bahn", n, "ersetzt, ohne Treffer:", miss.length, miss.slice(0, 30).join(" "));
  return n;
}
function osmGeo(O, rels, tol) { const ids = new Set(); rels.forEach((r) => r.ways.forEach((w) => ids.add(w))); return [...ids].map((w) => polyEnc(simp(O.W.get(w), tol))).filter((x) => x.length > 4); }
async function londonCity(id, C) {
  const meta = { n: C.n, src: C.src, lic: C.lic, tz: C.tz, at: new Date().toISOString().slice(0, 10), bb: C.bb, url: "https://api.tfl.gov.uk" };
  const rail = await londonRail(C);
  try {
    const O = await osmRoutes(C.ext, "subway|light_rail|train|tram|ferry", 1);
    const RT = { metro: ["subway"], light: ["light_rail"], sbahn: ["train"], tram: ["tram"], ferry: ["ferry"] };
    rail.L.forEach((l, i) => {
      const nm = l[1].toLowerCase().replace(/ line$/, ""), rt = RT[l[0]]; if (!rt) return;
      const norm = (x) => " " + String(x).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim() + " ";
      const rels = O.R.filter((r) => rt.includes(r.route) && (l[0] === "tram" ? true : nm === "dlr" ? /dlr|docklands/i.test(r.name) : norm(r.name).includes(norm(nm)) || r.ref.toLowerCase() === l[1].toLowerCase()));
      const g = osmGeo(O, rels, 0.00004); if (g.length) { rail.G[i] = g; meta.src = C.src + " · Verläufe © OpenStreetMap"; log("   OSM-Verlauf", l[1], rels.length, "Relationen"); } });
  } catch (e) { log("  OSM-Verläufe Bahn fehlgeschlagen:", e.message); }
  write(id, "rail", meta, rail);
  // Busse: BODS-GTFS für London (Department for Transport); scheitert das, bleiben die Busse bei Transitland/OpenStreetMap
  try {
    const zip = ZIP[id + "-bus"] || path.join(TMP, id + "-bus.zip");
    if (!ZIP[id + "-bus"]) await download(C.bodsUrl, zip);
    const net = await buildGtfs(id, C, zip, { onlyBus: true });
    const bus = await assemble(id, Object.assign({}, C, { noStraight: true }), net, true, zip, (need) => shapesFromZip(zip, need));
    try {
      const O = await osmRoutes(C.bus, "bus|trolleybus", 1), by = new Map();
      O.R.forEach((r) => { if (r.ref) { const k = r.ref.toUpperCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(r); } });
      let n = 0; bus.L.forEach((l, i) => { if (bus.G[i] && bus.G[i].length) return; const rels = by.get(String(l[1]).toUpperCase()) || []; const g = osmGeo(O, rels, 0.00008); if (g.length) { bus.G[i] = g; n++; } });
      log("  Busverläufe aus OpenStreetMap", n, "von", bus.L.length);
    } catch (e) { log("  OSM-Verläufe Bus fehlgeschlagen:", e.message); }
    write(id, "bus", Object.assign({}, meta, { src: "Transport for London · Bus Open Data Service (DfT) · Verläufe © OpenStreetMap", lic: "OGL v3, ODbL", valid: [net.start, net.end] }), bus);
  } catch (e) { log("London-Busse nicht gebaut:", e.message); }
}

const list = want.length ? want : Object.keys(CITIES);
let fail = 0;
for (const id of list) {
  const C = CITIES[id]; if (!C) { log("unbekannte Stadt", id); fail++; continue; }
  try { if (C.type === "gtfs") await gtfsCity(id, C); else await londonCity(id, C); }
  catch (e) { log("FEHLER", id, e.stack || e.message); fail++; }
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ v: V, at: new Date().toISOString(), cities: fs.readdirSync(OUT).filter((f) => /\.json$/.test(f) && f !== "index.json").sort().map((f) => ({ f, b: fs.statSync(path.join(OUT, f)).size })) }));
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail === list.length ? 1 : 0);
