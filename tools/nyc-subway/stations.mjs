/* Fehlende U-Bahn-Stationen New York (TRANSIT.stations in index.html) aus dem MTA-GTFS ergänzen – z. B. Rockaway, Coney Island, Flushing, Jamaica.
   Aufruf:
     curl -o /tmp/subway.zip https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip && unzip -o /tmp/subway.zip stops.txt trips.txt stop_times.txt -d /tmp/gtfs_subway
     node tools/nyc-subway/stations.mjs /tmp/gtfs_subway
   Bestehende Stationen bleiben unverändert und an ihrer Stelle (Nummern werden in der App als „sub:Nummer“ verwendet); neue werden hinten angehängt.
   Eine Station gilt als vorhanden, wenn es eine gleichnamige im Umkreis von 120 m gibt. Linien je Station aus den Fahrten (stop_times);
   Express-Varianten (6X, 7X, FX) zählen zur Grundlinie, Shuttles GS/FS als „S“; H (Rockaway-Shuttle) und SI (Staten Island) gibt es in der App nicht. */
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const G = process.argv[2]; if(!G) throw new Error("GTFS-Ordner fehlt");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = path.join(ROOT, "index.html");
const LAT0 = 40.73, COS = Math.cos(LAT0*Math.PI/180), KM = 111320;
const xy = (la, lo) => [Math.round((lo+74)*COS*KM), Math.round((LAT0-la)*KM)];
function csv(f){ const t = fs.readFileSync(path.join(G, f), "utf8").split(/\r?\n/).filter(Boolean), h = t[0].split(","); return t.slice(1).map(l => { const v = l.split(","), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); }

let html = fs.readFileSync(HTML, "utf8");
const m = /^var TRANSIT = (\{.*\});$/m.exec(html); if(!m) throw new Error("TRANSIT nicht gefunden");
const T = JSON.parse(m[1]);
const ORDER = [...new Set(T.subway.map(t => t.r.replace(/X$/, "")))];          // Reihenfolge der Linien wie in der App
const MAP = r => /^(GS|FS)$/.test(r) ? "S" : r==="H" || r==="SI" ? null : r.replace(/X$/, "");

const parent = {}, st = {};
for(const s of csv("stops.txt")){ if(s.location_type==="1") st[s.stop_id] = {n:s.stop_name, la:+s.stop_lat, lo:+s.stop_lon, r:new Set()}; else if(s.parent_station) parent[s.stop_id] = s.parent_station; }
const route = {}; for(const t of csv("trips.txt")) route[t.trip_id] = MAP(t.route_id);
const rl = readline.createInterface({input:fs.createReadStream(path.join(G, "stop_times.txt"))});
let head = null, iT, iS;
for await (const line of rl){ const v = line.split(","); if(!head){ head = v; iT = v.indexOf("trip_id"); iS = v.indexOf("stop_id"); continue; }
  const r = route[v[iT]], p = parent[v[iS]] || v[iS]; if(r && st[p]) st[p].r.add(r); }

let add = 0;
Object.values(st).forEach(s => { const lines = ORDER.filter(r => s.r.has(r)); if(!lines.length) return;
  const [x, y] = xy(s.la, s.lo);
  if(T.stations.some(o => o[0]===s.n && Math.hypot(o[1]-x, o[2]-y) < 120)) return;
  T.stations.push([s.n, x, y, lines.join("")]); add++; });
html = html.replace(m[0], "var TRANSIT = "+JSON.stringify(T)+";");
fs.writeFileSync(HTML, html);
console.log("Stationen ergänzt:", add, "· jetzt", T.stations.length);
