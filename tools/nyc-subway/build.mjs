/* U-Bahn- und Buslinien New York (TRANSIT.subway / TRANSIT.bus in index.html) aus dem MTA-GTFS neu bauen: jede Linie von Endstation zu Endstation, ohne Lücken.
   Aufruf (Linienauswahl bleibt wie in index.html, nur die Verläufe werden ersetzt):
     for f in subway m b; do curl -o /tmp/$f.zip https://rrgtfsfeeds.s3.amazonaws.com/gtfs_$f.zip && unzip -o /tmp/$f.zip shapes.txt trips.txt -d /tmp/gtfs_$f; done
     node tools/nyc-subway/build.mjs /tmp/gtfs_subway /tmp/gtfs_m /tmp/gtfs_b
   Vorgehen je Linie: alle Fahrwege (shapes) der Linie nach Anzahl Fahrten; der häufigste zuerst, von jedem weiteren nur die noch nicht abgedeckten
   Abschnitte (> 25 m neben dem Bisherigen). Ein neuer Abschnitt beginnt/endet exakt auf der bisherigen Linie (Lot-Fußpunkt) → Abzweige ohne Lücke.
   Koordinaten wie in der App: x = (lon+74)·cos(40,73°)·111320 m, y = (40,73−lat)·111320 m, ganze Meter, Differenzen kodiert. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const GS = process.argv.slice(2); if(!GS.length) throw new Error("GTFS-Ordner fehlt (erst U-Bahn, dann Bus)");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = path.join(ROOT, "index.html");
const LAT0 = 40.73, COS = Math.cos(LAT0*Math.PI/180), KM = 111320;
const TOL = 4, NEAR = 25, MINRUN = 60;   // Vereinfachung (m), Abstand „schon abgedeckt“ (m), kürzester neuer Abschnitt (m)

function csv(G, f){ const t = fs.readFileSync(path.join(G, f), "utf8").split(/\r?\n/).filter(Boolean), h = t[0].split(","); return t.slice(1).map(l => { const v = l.split(","), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); }
const xy = (la, lo) => [(lo+74)*COS*KM, (LAT0-la)*KM];
function dp(pts, tol){ if(pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length-1] = 1; const st = [[0, pts.length-1]];
  while(st.length){ const [a, b] = st.pop(); let md = 0, mi = -1; for(let i = a+1; i < b; i++){ const d = segD(pts[i], pts[a], pts[b]).d; if(d > md){ md = d; mi = i; } } if(md > tol){ keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  return pts.filter((_, i) => keep[i]); }
function segD(p, a, b){ const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx+dy*dy; let t = L ? ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L : 0; t = Math.max(0, Math.min(1, t)); const q = [a[0]+t*dx, a[1]+t*dy]; return {d:Math.hypot(p[0]-q[0], p[1]-q[1]), q}; }
function near(p, lines){ let best = {d:1e9, q:null}; for(const L of lines) for(let i = 1; i < L.length; i++){ const r = segD(p, L[i-1], L[i]); if(r.d < best.d) best = r; } return best; }
const len = L => L.reduce((s, p, i) => i ? s + Math.hypot(p[0]-L[i-1][0], p[1]-L[i-1][1]) : 0, 0);

// je Ordner eigene Fahrwege (shape-IDs der Feeds können sich überschneiden): Schlüssel = Ordnernummer + ID; Buslinien stehen in mehreren Feeds (MTA Bus Co.) → zusammengeführt
const shapes = {}, use = {}, dir = {};
GS.forEach((G, gi) => {
  for(const r of csv(G, "shapes.txt")) (shapes[gi+":"+r.shape_id] = shapes[gi+":"+r.shape_id] || []).push([+r.shape_pt_sequence, xy(+r.shape_pt_lat, +r.shape_pt_lon)]);
  for(const t of csv(G, "trips.txt")){ const k = gi+":"+t.shape_id; if(!t.shape_id || !shapes[k]) continue; const u = use[(gi ? "bus:" : "")+t.route_id] = use[(gi ? "bus:" : "")+t.route_id] || {}; u[k] = (u[k]||0) + 1; dir[k] = t.direction_id; }
});
Object.keys(shapes).forEach(k => { if(typeof shapes[k][0][0]==="number") shapes[k] = shapes[k].sort((a, b) => a[0]-b[0]).map(x => x[1]); });

function build(rid){
  const u = use[rid]; if(!u) throw new Error("Linie fehlt im GTFS: "+rid);
  let ids = Object.keys(u).sort((a, b) => u[b]-u[a] || shapes[b].length-shapes[a].length), out = [];
  // Bus: nur eine Fahrtrichtung (die des häufigsten Fahrwegs) – sonst doppelte Linien auf Einbahnstraßen-Paaren; Zweige derselben Richtung bleiben
  if(/^bus:/.test(rid)) ids = ids.filter(k => dir[k]===dir[ids[0]]);
  for(const id of ids){
    const S = shapes[id], cov = S.map(p => out.length ? near(p, out) : {d:1e9});
    if(!out.length){ out.push(S.slice()); continue; }
    let i = 0;
    while(i < S.length){
      if(cov[i].d <= NEAR){ i++; continue; }
      let j = i; while(j+1 < S.length && cov[j+1].d > NEAR) j++;
      const run = S.slice(i, j+1);
      if(i > 0) run.unshift(cov[i-1].q);            // Anschluss vorn: Fußpunkt auf der bisherigen Linie
      if(j < S.length-1) run.push(cov[j+1].q);       // Anschluss hinten
      run.a = i > 0; run.b = j < S.length-1;
      if(len(run) >= MINRUN) out.push(run);
      i = j+1;
    }
  }
  // vereinfachen, dann Anschlüsse erneut auf die (vereinfachten) früheren Stücke setzen – sonst bis zu TOL Meter Versatz am Abzweig
  const res = [];
  out.forEach(L => { const s = dp(L, TOL).map(p => [Math.round(p[0]), Math.round(p[1])]);
    if(res.length){ if(L.a) s[0] = near(s[0], res).q.map(Math.round); if(L.b) s[s.length-1] = near(s[s.length-1], res).q.map(Math.round); }
    res.push(s); });
  return res;
}
const enc = L => { const a = [L[0][0], L[0][1]]; for(let i = 1; i < L.length; i++){ const dx = L[i][0]-L[i-1][0], dy = L[i][1]-L[i-1][1]; if(dx || dy) a.push(dx, dy); } return a; };

let html = fs.readFileSync(HTML, "utf8");
const m = /^var TRANSIT = (\{.*\});$/m.exec(html); if(!m) throw new Error("TRANSIT nicht gefunden");
const T = JSON.parse(m[1]);
// App-Namen → GTFS: „S“ gibt es zweimal (Franklin Av Shuttle FS, 42 St Shuttle GS) – Zuordnung über die Lage des alten Startpunkts (y > 5000 = Brooklyn)
// Endstation hinter dem Ende des Fahrwegs (z. B. 96 St/2 Av: Fahrweg endet ~100 m davor): Linie bis zur Station verlängern
function toStations(r, Ls){
  T.stations.filter(st => String(st[3]||"").split("").includes(r)).forEach(st => { const p = [st[1], st[2]];
    if(near(p, Ls).d <= 15) return;
    Ls.forEach(L => { [0, L.length-1].forEach(e => { if(Math.hypot(L[e][0]-p[0], L[e][1]-p[1]) < 150){ if(e) L.push(p); else L.unshift(p); } }); }); });
  return Ls;
}
T.subway.forEach(t => { const rid = t.r!=="S" ? t.r : (t.l[0][1] > 5000 ? "FS" : "GS"); t.l = toStations(t.r, build(rid)).map(enc); });
if(GS.length > 1) T.bus.forEach(b => { b.l = build("bus:"+b.r).map(enc); });
html = html.replace(m[0], "var TRANSIT = "+JSON.stringify(T)+";");
fs.writeFileSync(HTML, html);
console.log(T.subway.concat(T.bus).map(t => t.r+":"+t.l.length+"/"+t.l.reduce((s, a) => s + a.length/2, 0)).join(" "), "·", JSON.stringify(T.subway).length, "+", JSON.stringify(T.bus).length, "Zeichen");
