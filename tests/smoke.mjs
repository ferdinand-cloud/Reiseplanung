/* Automatischer Klicktest der Reiseplan-App im iPhone-Format.
   Start:  cd tests && npm install && node smoke.mjs
   Die App wird lokal ausgeliefert, alle externen Anfragen (Firebase, Kartenkacheln, Google) sind gesperrt.
   Über ?rptest stellt die App window.__rp(code) bereit, um Testdaten anzulegen und den Zustand zu prüfen. */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { chromium as pw } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";            // Ordner für Screenshots (optional)
const ONLY = process.argv[2] || "";               // nur Tests, deren Name das enthält
const VP0 = (process.env.VP || "390x844").split("x").map(Number);   // VP=844x390 → alle Tests im Querformat
const SHARD = process.env.SHARD ? process.env.SHARD.split("/").map(Number) : null;   // intern: [i, n] = dieser Prozess macht jeden n-ten Test

/* Parallel: der Hauptprozess startet JOBS Prozesse (Standard: je CPU-Kern einer, höchstens 4), jeder übernimmt jeden JOBS-ten Test.
   JOBS=1 → alles nacheinander in einem Prozess. */
if(!SHARD){
  const jobs = Math.max(1, Number(process.env.JOBS) || Math.min(4, os.cpus().length));
  if(jobs > 1){
    const t0 = Date.now(), file = fileURLToPath(import.meta.url);
    const ch = await chromePath();   // Chromium einmal hier entpacken und den Prozessen mitgeben, sonst entpacken alle gleichzeitig (spawn ETXTBSY)
    const parts = await Promise.all(Array.from({length:jobs}, (_, i) => new Promise(res => {
      let out = "";
      const c = spawn(process.execPath, [file, ...process.argv.slice(2)], { env: {...process.env, SHARD: i+"/"+jobs, CHROME: ch.exe, CHROME_ARGS: JSON.stringify(ch.args)}, stdio: ["ignore", "pipe", "inherit"] });
      c.stdout.on("data", d => { out += d; if(process.env.VERBOSE) process.stdout.write(String(d).split("\n").filter(l => l && !l.startsWith("@@")).map(l => l+"\n").join("")); });
      c.on("close", () => { const l = out.split("\n").find(x => x.startsWith("@@")); res(l ? JSON.parse(l.slice(2)) : [{name:"Prozess "+i, idx:-1, ok:false, ms:0, err:"abgestürzt"}]); });
    })));
    report(parts.flat().sort((a, b) => a.idx - b.idx), Date.now() - t0);
  }
}
function report(results, ms){
  const bad = results.filter(r => !r.ok), flaky = results.filter(r => r.ok && r.retry);
  for(const r of results) console.log((r.ok ? "✓" : "✗")+" "+r.name+(r.ok ? "" : "\n    → "+r.err)+(r.retry ? "\n    (erst im 2. Versuch bestanden: "+r.retry+")" : "")+`  (${r.ms} ms)`);
  console.log(`\n${results.length - bad.length} von ${results.length} Tests bestanden`+(flaky.length ? `, ${flaky.length} davon erst im 2. Versuch` : "")+(ms ? `  (${Math.round(ms/1000)} s)` : ""));
  process.exit(bad.length ? 1 : 0);
}

async function chromePath(){
  if(process.env.CHROME) return { exe: process.env.CHROME, args: process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [] };
  try { const c = (await import("@sparticuz/chromium")).default; return { exe: await c.executablePath(), args: c.args }; }
  catch(e){ throw new Error("Kein Chromium gefunden: CHROME=/pfad/zu/chrome setzen oder @sparticuz/chromium installieren"); }
}

const TYPES = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".webmanifest":"application/json", ".png":"image/png", ".svg":"image/svg+xml"};
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0])); if(f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, d) => { if(e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": TYPES[path.extname(f)] || "application/octet-stream"}); r.end(d); });
}).listen(0);
const URL0 = `http://127.0.0.1:${srv.address().port}/index.html?rptest`;

const { exe, args } = await chromePath();
let browser = null;
const results = [];
let page, errs = [], OSRMREQ = [];

async function newPage(vp, safe){
  // je Test ein frischer Browser (das mitgelieferte Chromium läuft als ein Prozess; mehrere Karten-Seiten nacheinander blockieren sonst)
  browser = await pw.launch({ executablePath: exe, args, headless: true });
  const ctx = await browser.newContext({ viewport: vp || {width:VP0[0], height:VP0[1]}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "de-DE", timezoneId: "America/New_York" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, rt => {
    const u = rt.request().url();
    if(u.includes("gbfs.lyft.com") && u.includes("station_information")) return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({data:{stations:[
      {station_id:"S1", name:"Ludlow St & E Houston St", lat:40.7226, lon:-73.9881, capacity:30},
      {station_id:"S2", name:"Washington Sq E", lat:40.7311, lon:-73.9966, capacity:40},
      {station_id:"S3", name:"W 53 St & 6 Ave", lat:40.7612, lon:-73.9772, capacity:25}]}}) });
    if(u.includes("gbfs.lyft.com") && u.includes("station_status")) return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({data:{stations:[
      {station_id:"S1", num_bikes_available:5, num_ebikes_available:2, num_docks_available:20, is_installed:1, is_renting:1, is_returning:1},
      {station_id:"S2", num_bikes_available:0, num_ebikes_available:0, num_docks_available:7, is_installed:1, is_renting:1, is_returning:1},
      {station_id:"S3", num_bikes_available:2, num_ebikes_available:0, num_docks_available:0, is_installed:1, is_renting:1, is_returning:1}]}}) });
    if(u.includes("routed-bike/route") || (u.includes("routed-car/route") && !u.includes("steps=true"))){ OSRMREQ.push(u); const pts = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map(x => x.split(",").map(Number));
      const coords = []; pts.forEach((p, i) => { if(i){ const q = pts[i-1]; coords.push([q[0] + (p[0]-q[0])*0.5 + 0.0008, q[1] + (p[1]-q[1])*0.5]); } coords.push(p); });
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:1800, duration:u.includes("routed-car") ? 420 : undefined, geometry:{type:"LineString", coordinates:coords}}]}) }); }
    if(u.includes("routed-foot/nearest") && globalThis.FOOTMOCK){ const p = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(",").map(Number);
      // „Anleger“ (Längengrad -74.0100): die vier nächsten Punkte liegen auf Fährlinien, erst der fünfte an Land
      // (wie Pier 79: alle Punkte in der Nähe liegen auf der Anleger-Plattform, erst weiter Richtung Ziel geht es an Land)
      const ws = Math.abs(p[0] + 74.01) < 0.0002 ? [0, 1, 2, 3, 4].map(i => ({location:[p[0] + 0.00003*i, p[1] + 0.00003*i], distance:3*i})) : [{location:p, distance:0}];
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", waypoints:ws}) }); }
    if(u.includes("routed-foot/route") && !u.includes("continue_straight") && globalThis.FOOTMOCK){ OSRMREQ.push(u);
      const pts = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map(x => x.split(",").map(Number));
      // vom „Anleger“ aus: OSRM rastet auf der Fährlinie ein und fährt erst weit mit der Fähre
      if(Math.abs(pts[0][0] + 74.01) < 0.0002){ const A = pts[0], B = pts[pts.length-1], F = [A[0] - 0.01, A[1] - 0.04];
        return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:9500, geometry:{type:"LineString", coordinates:[A, F, B]},
          legs:[{steps:[{mode:"walking", distance:20}, {mode:"ferry", distance:4500}, {mode:"walking", distance:5000}, {mode:"walking", distance:0}]}]}]}) }); }
      // „Wasser“-Punkt (Längengrad -73.9690): kein Weg
      if(pts.some(p => Math.abs(p[0] + 73.969) < 0.0002)) return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"NoRoute", routes:[]}) });
      const A = pts[0], B = pts[pts.length-1], M = [A[0], B[1]], co = [A, [(A[0]+M[0])/2, (A[1]+M[1])/2], M, B];
      const dm = Math.abs(A[0]-B[0])*84000 + Math.abs(A[1]-B[1])*111000;
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:dm, geometry:{type:"LineString", coordinates:co}}]}) }); }
    if((u.includes("routed-foot/route") || u.includes("routed-car/route")) && u.includes("steps=true") && (u.includes("continue_straight") || u.includes("routed-car"))){ OSRMREQ.push(u); const pts = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map(x => x.split(",").map(Number));
      const A = pts[0], B = pts[pts.length-1], M = [A[0], B[1]], co = [];
      for(let i = 0; i <= 10; i++) co.push([A[0], A[1] + (M[1]-A[1])*i/10]); for(let i = 1; i <= 10; i++) co.push([M[0] + (B[0]-M[0])*i/10, M[1]]);
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:1200, duration:900, geometry:{type:"LineString", coordinates:co},
        legs:[{steps:[{name:"Bowery", maneuver:{type:"depart", location:A}}, {name:"Bleecker Street", maneuver:{type:"turn", modifier:"right", location:M}}, {name:"", maneuver:{type:"arrive", location:B}}]}]}]}) }); }
    if(u.includes("photon.komoot.io/api")){ const q = new URL(u).searchParams; globalThis.PHOTONREQ = (globalThis.PHOTONREQ||[]).concat([u]);
      const feats = q.get("q").toLowerCase().includes("brooklyn") ? [{geometry:{coordinates:[-73.9442, 40.6782]}, properties:{name:"Brooklyn", city:"New York", country:"USA"}}]
        : [{geometry:{coordinates:[-73.9900, 40.7500]}, properties:{name:"On Store Midtown", osm_value:"shoes", street:"W 34th St", city:"New York"}},
           {geometry:{coordinates:[-73.6000, 40.9000]}, properties:{name:"On Store Rye", osm_value:"shoes", city:"Rye"}},
           {geometry:{coordinates:[101.6900, 3.1400]}, properties:{name:"On Store Malaysia", osm_value:"convenience", city:"Kuala Lumpur"}}];
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({features:feats}) }); }
    if(u.includes("openfreemap.org/styles")) return rt.fulfill({ contentType: "application/json", body: JSON.stringify({version:8, sources:{}, layers:[{id:"bg", type:"background", paint:{"background-color":"#dde"}}]}) });
    return rt.abort();
  });
  const p = await ctx.newPage();
  // Notch/abgerundete Ecken nachbilden: safe-area-inset-* (links, rechts, oben, unten), z. B. iPhone quer {left:47, right:47, bottom:21}
  safe = safe || (process.env.SAFE ? (([l, r, t, b]) => ({left:l, right:r, top:t, bottom:b}))(process.env.SAFE.split(",").map(Number)) : null);
  if(safe) await (await ctx.newCDPSession(p)).send("Emulation.setSafeAreaInsetsOverride", {insets:Object.assign({top:0, left:0, right:0, bottom:0}, safe)});
  p.setDefaultTimeout(6000);
  errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(URL0);
  await p.waitForFunction(() => typeof window.__rp === "function" && window.__rp("mapReady"), null, { timeout: 20000 });
  await p.waitForTimeout(400);
  return p;
}
const rp = (code) => page.evaluate(c => window.__rp(c), code);
function ok(cond, msg){ if(!cond) throw new Error(msg); }
async function shot(name){ if(!SHOTS) return; fs.mkdirSync(SHOTS, {recursive:true}); await page.screenshot({ path: path.join(SHOTS, name+".png"), timeout: 15000 }).catch(e => console.log("  (Screenshot "+name+" übersprungen)")); }
async function visible(sel){ return page.evaluate(s => { const e = document.querySelector(s); if(!e || e.hidden) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility!=="hidden" && cs.display!=="none"; }, sel); }
async function click(sel){ const n = await page.locator(sel).count(); ok(n > 0, "Element fehlt: "+sel); await page.locator(sel).first().click(); await page.waitForTimeout(250); }
async function insideViewport(sel){ return page.evaluate(s => { const e = document.querySelector(s); if(!e) return false; const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }, sel); }

/* Testreise: 2 Tage zurück bis 3 Tage voraus, Stopps gestern (erledigt, mit Fotos) und heute, Wünsche */
async function seed(){
  await rp(`(function(){
    function dk(o){ var d = new Date(); d.setDate(d.getDate()+o); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
    var Y = dk(-1), H = dk(0);
    var t = newTripObj({id:"t_test", name:"Testreise", start:dk(-2), end:dk(3), hotels:[{id:"h1", n:"Hotel Test", la:40.7561, lo:-73.9930, from:dk(-2), to:dk(3)}], orte:[{id:"o1", n:"New York", la:NYC.la, lo:NYC.lo, from:dk(-2), to:dk(3)}]});
    var P0 = [["p1","Katz Deli","essen",40.7223,-73.9874],["p2","Washington Square Park","park",40.7308,-73.9973],["p3","MoMA","kultur",40.7614,-73.9776],
              ["p4","Brooklyn Bridge","sight",40.7061,-73.9969],["p5","Fotospot Village","sight",40.7336,-74.0027],["p6","Joe's Pizza","essen",40.7306,-74.0021],["p7","High Line","park",40.7480,-74.0048]];
    P0.forEach(function(r){ t.places[r[0]] = {id:r[0], n:r[1], c:CATNAME[r[2]] ? r[2] : "sight", la:r[3], lo:r[4], list:"l_main", note:"", addr:"Teststraße 1"}; });
    t.order[H] = ["p1","p2","p3"]; t.order[Y] = ["p4","p5"]; t.done = {p4:1, p5:1};
    t.photos = {p4:["ph_a","ph_b"], p5:["ph_c"]};
    var c = document.createElement("canvas"); c.width = 320; c.height = 240; var g = c.getContext("2d");
    ["#c33","#3a3","#36c"].forEach(function(col, i){ g.fillStyle = col; g.fillRect(0, 0, 320, 240); g.fillStyle = "#fff"; g.font = "60px sans-serif"; g.fillText(String(i+1), 140, 140); PHC[["ph_a","ph_b","ph_c"][i]] = c.toDataURL("image/jpeg", .7); });
    acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; fbDb = null; acct.state = "ok"; lsSet("rp-dcdemo", "0"); DCSIG = "";
    S = {trips:{t_test:t}, cur:"t_test"}; cur = H; tab = "day"; sel = null; finEd = ""; finM = "";
    FR.friends = [{uid:"u_anna", name:"anna"},{uid:"u_ludwig", name:"Ludwig"},{uid:"u_clara", name:"Clara"}];
    renderGate(); renderAll();
    return {Y:Y, H:H};
  })()`);
}

let testNo = -1;
async function test(name, fn, opt){
  if(ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const idx = ++testNo; if(SHARD && idx % SHARD[1] !== SHARD[0]) return;
  const t0 = Date.now(); if(process.env.VERBOSE) console.log("… "+name);
  // ein fehlgeschlagener Test läuft einmal neu; besteht er dann, wird er als „erst im 2. Versuch“ gemeldet (Hinweis auf wackeligen Test)
  let err = "";
  for(let run = 0; run < 2; run++){
    try {
      page = await newPage(opt && opt.vp, opt && opt.safe);
      await fn();
      ok(!errs.length, "JavaScript-Fehler: "+errs.join(" | "));
      results.push({name, idx, ok:true, ms:Date.now()-t0, retry:err}); return;
    } catch(e){
      err = (e.message||String(e)).split("\n")[0]+(errs.length ? " | JS: "+errs.join(" | ") : "");
      if(run) await shot("FEHLER-"+name.replace(/[^\w]+/g, "_")).catch(()=>{});
    } finally { if(browser) await browser.close().catch(()=>{}); browser = null; globalThis.FOOTMOCK = false; }
  }
  results.push({name, idx, ok:false, ms:Date.now()-t0, err});
}

/* ------------------------------------------------------------------ Tests */
await test("Start ohne Reise: Hinweis statt „Meine Reise“", async () => {
  ok(await rp(`liveIds().length`)===0, "Platzhalter-Reise erscheint als Reise");
  ok(await rp(`noTrip()`), "noTrip() ist falsch");
  ok(await rp(`noTripHTML().indexOf("Noch keine eigene Reise erstellt") > -1`), "Hinweistext fehlt");
});

await test("Wunsch-Pop-up → Zur Planung: Tagesauswahl vollständig im Bild", async () => {
  await seed(); await rp(`select("p6")`); await page.waitForTimeout(200);
  ok(await visible("#card"), "Orts-Pop-up nicht sichtbar");
  await click("#card [data-act=planpick]");
  ok(await visible("#planPop"), "Einplanen-Pop-up nicht sichtbar");
  ok(await insideViewport("#planPop .plan-card"), "Einplanen-Pop-up ragt aus dem Bild");
  await shot("einplanen");
  await click("#planPop [data-act=plancancel]");
  ok(!(await visible("#planPop")), "Einplanen-Pop-up schließt nicht");
});

await test("Tag wählen: „Alle Tage anzeigen“ zeigt die gesamte Reise auf der Karte", async () => {
  await seed();
  const k = await rp(`(function(){ var ds = days(); T().order[ds[3].key] = ["p6"]; renderAll(); return {Y:ds[1].key, H:ds[2].key, M:ds[3].key}; })()`);
  await click("#rail [data-act=daypop]");
  ok(await visible("#catPop .dayall"), "Knopf „Alle Tage anzeigen“ fehlt");
  ok(await rp(`$("catPop").querySelector(".daylist button").classList.contains("dayall")`), "„Alle Tage“ steht nicht oben");
  await shot("alle-tage-pop");
  await click("#catPop .dayall");
  ok(await rp(`allOn()`), "Gesamtansicht nicht aktiv");
  ok(!(await visible("#catPop")), "Pop-up bleibt offen");
  ok(await rp(`$("rail").textContent.indexOf("Alle") > -1`), "Tageskreis zeigt nicht „Alle“");
  ok(await rp(`$("body").textContent.indexOf("Alle Tage") > -1 && $("body").querySelectorAll(".adj [data-act=day]").length===days().length && !$("body").querySelector(".daylist")`), "Blatt zeigt kein Tagebuch aller Tage");
  ok(await rp(`!!$("body").querySelector(".adj .jcard[data-pid=p4][data-day='${k.Y}']")`), "Tagebuch aller Tage: besuchter Ort von gestern fehlt");
  await page.waitForTimeout(300);
  ok(await rp(`(function(){ var h = $("ov").innerHTML; return h.indexOf(dayColor("${k.M}")) > -1 && h.indexOf(dayColor("${k.H}")) > -1; })()`), "Karte zeigt nicht die Stopps aller Tage");
  await shot("alle-tage-karte");
  // erneut öffnen: „Alle Tage“ markiert, kein einzelner Tag
  await click("#rail [data-act=daypop]");
  ok(await rp(`$("catPop").querySelector(".dayall").getAttribute("aria-pressed")==="true" && !$("catPop").querySelector("[data-act=daypick][aria-pressed=true]")`), "Markierung im Pop-up falsch");
  await click("#catPop [data-act=daypick][data-day='"+k.Y+"']");
  ok(!(await rp(`allOn()`)) && await rp(`cur`)===k.Y, "Tag wählen beendet die Gesamtansicht nicht");
  // Ansichtsmodus (abgeschlossene Reise) bietet sie ebenso an; Verschieben-Pop-up nicht
  await rp(`T().fin = 1; finEd = ""; renderAll(); true`);
  ok(await rp(`isRO()`), "Reise nicht im Ansichtsmodus");
  await click("#rail [data-act=daypop]");
  ok(await visible("#catPop .dayall"), "Ansichtsmodus: „Alle Tage“ fehlt");
  await click("#catPop .dayall"); ok(await rp(`allOn()`), "Ansichtsmodus: Gesamtansicht nicht aktiv");
  await rp(`T().fin = 0; allD = ""; renderAll(); openDayPop("p1", true); true`);
  ok(!(await rp(`!!$("catPop").querySelector(".dayall")`)), "Verschieben-Pop-up zeigt „Alle Tage“");
});

await test("Karte mit gewähltem Tag: nur dessen Orte, Filter „Alle Orte der Reise“ zeigt alle", async () => {
  await seed(); await rp(`map.jumpTo({center:[-73.995, 40.72], zoom:12}); true`); await page.waitForTimeout(400);
  ok(await rp(`PHMK.length`)===0, "Fotos anderer Tage erscheinen ohne Filter: "+await rp(`PHMK.join()`));
  await click("#layersBtn");
  ok(await visible("#lAllP"), "Filter „Alle Orte der Reise“ fehlt");
  ok(!(await page.locator("#lAllP").isChecked()), "Filter ist standardmäßig an");
  await page.locator("#lAllP").check(); await page.waitForTimeout(300);
  ok(await rp(`lsGet("rp-l-allp")`)==="1", "Einstellung wird nicht gespeichert");
  ok(await rp(`PHMK.indexOf("p4") > -1 && PHMK.indexOf("p5") > -1`), "Orte anderer Tage erscheinen nicht: "+await rp(`PHMK.join()`));
});

await test("Karte mit gewähltem Tag: besuchte Orte des Tages auch bei „Erledigte ausblenden“ und im Ansichtsmodus", async () => {
  await seed();
  const Y = await rp(`(function(){ var ds = days(); hideDone = true; cur = ds[1].key; renderAll(); map.jumpTo({center:[-73.995, 40.72], zoom:12}); return cur; })()`);
  await page.waitForTimeout(400);
  const seen = () => rp(`mapDays().indexOf(cur) > -1 && ord(cur).indexOf("p4") > -1 && !mapHid("p4") && !mapHid("p5")`);
  ok(await seen(), "Bearbeiten: besuchte Orte des Tages fehlen auf der Karte");
  await rp(`T().fin = 1; finEd = ""; hideDone = true; renderAll(); true`); await page.waitForTimeout(400);
  ok(await rp(`isRO()`) && await seen(), "Ansichtsmodus: besuchte Orte des Tages fehlen auf der Karte");
  await rp(`hideDone = false; true`);
});

await test("Wunschliste-Plus: fragt Tag und Position, Abbrechen bleibt an derselben Stelle", async () => {
  await seed(); await rp(`select(null); cur = todayKey(); tab = "wish"; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  const b = page.locator("#sheet .wplan[data-pid=p6]");
  ok(await b.count()===1, "Plus für Joe's Pizza fehlt");
  await b.click();
  const sc0 = await rp(`$("sheet").querySelector(".wplan[data-pid=p6]").getBoundingClientRect().top`);
  ok(await visible("#planPop"), "Wunschliste-Plus öffnet die Einplanen-Frage nicht");
  ok(await page.locator("#planPop [data-act=plankday]").count() > 1, "Tagesauswahl fehlt");
  ok(await page.locator("#planPop [data-act=planins]").count()===1, "„Dazwischen einschieben“ fehlt");
  ok(await rp(`!dayOf("p6")`), "Ort wurde ohne Rückfrage eingeplant");
  await click("#planPop [data-act=plancancel]");
  ok(!(await visible("#planPop")), "Abbrechen schließt nicht");
  ok(await rp(`tab==="wish" && !dayOf("p6")`), "Abbrechen verlässt die Wunschliste oder plant ein");
  const sc1 = await rp(`$("sheet").querySelector(".wplan[data-pid=p6]").getBoundingClientRect().top`);
  ok(Math.abs(sc1 - sc0) < 2, "Wunschliste springt nach Abbrechen ("+sc0+" → "+sc1+")");
  // anderer Tag, ans Ende
  await b.click();
  const k2 = await rp(`days()[days().length-1].key`);
  await click(`#planPop [data-act=plankday][data-day="${k2}"]`);
  await click("#planPop [data-act=planend]");
  ok(await rp(`dayOf("p6")===${JSON.stringify(k2)} && ord(${JSON.stringify(k2)}).slice(-1)[0]==="p6"`), "Nicht am gewählten Tag am Ende eingeplant");
  // dazwischen: heute zwischen Stopp 1 und 2
  await page.locator("#sheet .wplan[data-pid=p7]").click();
  await click("#planPop [data-act=planins]");
  await page.waitForSelector("#catPop [data-act=planinspick]");
  await click("#catPop [data-act=planinspick][data-i=\"1\"]"); await click("#catPop [data-act=planinspick][data-i=\"2\"]");
  ok(await rp(`ord(todayKey()).indexOf("p7")===1`), "Dazwischen einschieben aus der Wunschliste klappt nicht");
});

await test("Neuer Ort (POI): Kacheln, Freunde/Öffentlich, keine Weg-Zeile", async () => {
  await seed();
  await rp(`poiSel = {n:"Test Café", cls:"cafe", sub:"cafe", c:"cafe", la:40.7290, lo:-74.0010, addr:"Bleecker St 1"}; sel = null; select("poi"); poiSel = poiSel || null; renderCard();`);
  ok(await visible("#card"), "POI-Pop-up nicht sichtbar");
  const tiles = await page.locator("#card .jp-tile").allInnerTexts();
  ["Zur Planung","Wunschliste","Route","Mehr"].forEach(x => ok(tiles.some(t => t.includes(x)), "Kachel fehlt: "+x));
  ok(await page.locator("#card .rvchips").count()===1, "Freunde/Öffentlich fehlt");
  const rvTxt = await page.locator("#card .rvc").allInnerTexts();
  ok(rvTxt.length===2 && !rvTxt.some(t => /Freunde|Öffentlich/.test(t)), "Bewertungs-Kapseln zeigen noch Text statt nur Symbol: "+rvTxt.join(" | "));
  ok(await page.locator("#card .rvc[data-v=friends] .rvi svg").count()===1 && await page.locator("#card .rvc[data-v=public] .rvi svg").count()===1, "Symbol in Bewertungs-Kapsel fehlt");
  ok(await page.locator("#card .mecard").count()===0, "Weg-Zeile ist wieder da");
  await click("#card [data-act=poimore]");
  ok(await visible("#jpMenu"), "Mehr-Menü öffnet nicht");
  await rp(`closeJpMore()`); await page.waitForTimeout(150);
  ok(await visible("#card"), "POI-Pop-up schließt beim Menü");
  await click("#card [data-act=planpick]");
  ok(await visible("#planPop"), "Einplanen aus POI öffnet nicht");
  await shot("poi");
});

await test("Foto-Ansicht: Leiste links, ⋯-Menü, Zuordnen zeigt aktuellen Ort, Löschen mit Rückfrage", async () => {
  await seed();
  await rp(`openJPop("p4", dayOf("p4"), "ph_a")`); await page.waitForTimeout(300);
  ok(await visible("#pvLayer"), "Foto-Ansicht nicht sichtbar");
  for(const a of ["phmap","phsend","phmore"]) ok(await page.locator(`#pvLayer .pv-side [data-act=${a}]`).count()===1, "Button fehlt in der Leiste: "+a);
  for(const a of ["phsave","phdel","phmovepop"]) ok(await page.locator(`#pvLayer .pv-side [data-act=${a}]`).count()===0, "Gehört ins ⋯-Menü: "+a);
  ok((await page.locator("#pvLayer .pv-vis").innerText()).trim()==="", "Sichtbarkeits-Button hat Text");
  await shot("foto-ansicht");
  await click("#pvLayer [data-act=phmore]");
  ok(await page.locator("#jpMenu [data-act=phmovepop], #jpMenu [data-act=phsave], #jpMenu [data-act=phdel]").count()===3, "⋯-Menü unvollständig");
  await click("#jpMenu [data-act=phmovepop]");
  ok(await visible("#catPop .phmv-cur"), "Zuordnen zeigt aktuellen Ort nicht");
  ok((await page.locator("#catPop .phmv-cur").innerText()).includes("Brooklyn Bridge"), "Falscher aktueller Ort");
  await click("#catPop [data-act=catclose]");
  await click("#pvLayer [data-act=phmore]");
  await click("#jpMenu [data-act=phdel]");
  ok(await visible("#cfPop"), "Rückfrage zum Löschen fehlt");
  await click("#cfPop .cf-ok"); await page.waitForTimeout(300);
  ok(await rp(`(T().photos.p4||[]).length`)===1, "Foto wurde nicht gelöscht");
  ok(!(await visible("#cfPop")), "Rückfrage bleibt offen");
});

await test("Foto-Ansicht als Beobachter: kein Sichern, kein ⋯", async () => {
  await seed();
  await rp(`isRO = function(){ return true; }; openJPop("p4", dayOf("p4"), "ph_a")`); await page.waitForTimeout(300);
  ok(await page.locator("#pvLayer [data-act=phmore], #pvLayer [data-act=phsave]").count()===0, "Beobachter kann Fotos herunterladen");
  ok(await page.locator("#pvLayer [data-act=phmap]").count()===1, "Karten-Button fehlt für Beobachter");
});

await test("Chat: nach rechts wischen führt zurück zur Übersicht, Position und Chat bleiben erhalten", async () => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; CH.byId = {}; CH.list = []; CH.got = true;
    for(var i = 0; i < 14; i++){ var id = "u_me_u"+i; CH.byId[id] = {id:id, members:["u_me","u"+i], names:{["u"+i]:"Freund"+i}, at:1000 - i, last:{t:"Hallo "+i, from:"u"+i, at:1000 - i}}; CH.list.push(CH.byId[id]); }
    openChPage(); true`);
  await page.waitForTimeout(300);
  const row = '#chView [data-act=chopen][data-v="u_me_u9"]';
  await page.evaluate(() => { document.getElementById("chView").scrollTop = 260; });
  const sc0 = await page.evaluate(() => document.getElementById("chView").scrollTop);
  ok(sc0 > 100, "Übersicht lässt sich nicht scrollen: "+sc0);
  await page.tap(row); await page.waitForTimeout(300);
  ok(await rp(`chOpen==="u_me_u9" && history.state && history.state.rpch==="u_me_u9"`), "Chat nicht geöffnet oder kein Verlaufseintrag");
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (pts) => { await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:pts[0][0], y:pts[0][1]}]});
    for(const p of pts.slice(1)){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:p[0], y:p[1]}]}); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); };
  // senkrecht wischen: bleibt im Chat
  await swipe([[200, 400], [205, 450], [208, 520], [210, 600]]); await page.waitForTimeout(350);
  ok(await rp(`chOpen==="u_me_u9"`), "Senkrechtes Wischen verlässt den Chat");
  // kurz nach rechts und zurück: bleibt im Chat, nichts verschoben
  await swipe([[100, 400], [130, 402], [150, 404], [120, 404]]); await page.waitForTimeout(350);
  ok(await rp(`chOpen==="u_me_u9" && !document.querySelector("#chView .ch-under") && !document.querySelector("#chView .ch-conv").style.translate`), "Abgebrochenes Wischen lässt Reste zurück");
  // während des Wischens folgt der Chat dem Finger, darunter die Übersicht
  await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:60, y:400}]});
  for(const x of [80, 110, 150, 200]){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x, y:405}]}); await page.waitForTimeout(16); }
  const mid = await page.evaluate(() => { const c = document.querySelector("#chView .ch-conv"); return {x:Math.round(c.getBoundingClientRect().left), under:!!document.querySelector("#chView .ch-under .ch-list")}; });
  ok(mid.x > 100 && mid.under, "Chat folgt dem Finger nicht oder keine Übersicht darunter: "+JSON.stringify(mid));
  await shot("chat-zurueckwischen");
  for(const x of [260, 320]){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x, y:405}]}); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); await page.waitForTimeout(500);
  const st = await page.evaluate(r => { const v = document.getElementById("chView"), e = document.querySelector(r), b = e && e.getBoundingClientRect();
    return {sc:v.scrollTop, ret:!!e && e.classList.contains("ch-ret"), foc:document.activeElement===e, vis:!!b && b.top >= 0 && b.bottom <= innerHeight}; }, row);
  ok(await rp(`chPage && !chOpen && !!document.querySelector("#chView .ch-list")`), "Wischen führt nicht zur Übersicht");
  ok(Math.abs(st.sc - sc0) <= 2, "Scrollposition der Übersicht nicht erhalten: "+sc0+" → "+st.sc);
  ok(st.ret && st.foc && st.vis, "Chat, aus dem man kam, nicht sichtbar/markiert/fokussiert: "+JSON.stringify(st));
  ok(await rp(`!(history.state && history.state.rpch)`), "Verlaufseintrag des Chats bleibt stehen");
  // Safari-Zurück (Rand-Wischen) = Verlauf zurück: ebenfalls zur Übersicht
  await page.tap(row); await page.waitForTimeout(300);
  await page.evaluate(() => history.back()); await page.waitForTimeout(400);
  ok(await rp(`chPage && !chOpen && !!document.querySelector("#chView .ch-list")`), "Safari-Zurück führt nicht zur Übersicht");
  // Zurück-Knopf: gleiche Wiederherstellung
  await page.tap(row); await page.waitForTimeout(300); await page.tap("#chView [data-act=chback]"); await page.waitForTimeout(400);
  ok(await rp(`!chOpen && document.querySelector('#chView [data-v="u_me_u9"]').classList.contains("ch-ret")`), "Zurück-Knopf markiert den Chat nicht");
  await cdp.detach(); await rp(`closeChPage(); CH.byId = {}; CH.list = []; true`);
});

await test("Chat: Plus öffnet neuen Chat mit Empfängerfeld, bekannter Name zeigt Verlauf, neuer Name beginnt Chat", async () => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; FR.friends = [{uid:"u1", name:"anna"}, {uid:"u2", name:"bert"}, {uid:"u3", name:"annika"}];
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], names:{u1:"anna"}, at:1000, last:{t:"Hallo alt", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true;
    window.__subs = []; chSubMsgs = function(cid){ window.__subs.push(cid); chMsgs = cid==="u1_u_me" ? [{id:"m1", from:"u1", t:"Hallo alt", at:Date.now()}] : []; renderChMsgs(true); };
    openChPage(); true`);
  await page.waitForTimeout(250);
  ok(await page.locator("#chView .ch-newbox, #chView input[type=search]").count()===0, "Übersicht zeigt noch eine Suchleiste");
  await page.tap("#chView [data-act=chnewtog]"); await page.waitForTimeout(250);
  ok(await rp(`chNewOn && !chOpen && $("chView").classList.contains("conv") && document.activeElement===$("chNewIn")`), "Plus öffnet nicht direkt den Chat mit fokussiertem Empfängerfeld");
  ok((await page.locator("#chView .ch-to label").innerText()).trim()==="An:", "Empfängerfeld ohne „An:“");
  ok(await page.locator("#chIn").count()===1, "Nachrichtenfeld fehlt im neuen Chat");
  const head0 = await page.evaluate(() => document.querySelector("#chView .ch-head").getBoundingClientRect().top);
  await page.evaluate(() => { window.__inp = document.getElementById("chNewIn"); });
  await page.keyboard.type("ann"); await page.waitForTimeout(150);
  ok(await rp(`!chOpen && document.querySelectorAll("#chNewRes [data-act=chnew]").length===2 && $("chMsgs").hidden`), "Vorschläge für „ann“ falsch");
  await page.keyboard.type("a"); await page.waitForTimeout(150);
  ok(await rp(`chOpen==="u1_u_me" && $("chNewRes").hidden && !$("chMsgs").hidden && $("chMsgs").textContent.includes("Hallo alt")`), "Bestehender Chat: Verlauf erscheint nicht sofort");
  await shot("chat-neu-empfaenger");
  await page.keyboard.press("Control+A"); await page.keyboard.type("Bert"); await page.waitForTimeout(150);
  ok(await rp(`chOpen==="u2_u_me" && window.__subs.join()==="u1_u_me,u2_u_me" && !!document.querySelector("#chMsgs .ch-empty")`), "Neuer Name beginnt keinen leeren Chat");
  ok(await page.evaluate(() => document.activeElement===window.__inp && document.getElementById("chNewIn")===window.__inp), "Empfängerfeld wurde beim Tippen neu gezeichnet (Fokus verloren)");
  ok(Math.abs(await page.evaluate(() => document.querySelector("#chView .ch-head").getBoundingClientRect().top) - head0) <= 1, "Kopf springt beim Tippen");
  // Vorschlag antippen: Name übernommen, weiter zur Nachricht
  await page.keyboard.press("Control+A"); await page.keyboard.type("anni"); await page.waitForTimeout(150);
  await page.tap("#chNewRes [data-act=chnew]"); await page.waitForTimeout(150);
  ok(await rp(`chOpen==="u3_u_me" && $("chNewIn").value==="annika" && document.activeElement===$("chIn")`), "Vorschlag übernimmt Namen nicht oder springt nicht zur Nachricht");
  // ohne Empfänger wird nichts gesendet
  await rp(`$("chNewIn").value = "xyz"; chNewQ = "xyz"; renderChNew(); $("chIn").value = "Hi"; chSend(); true`);
  ok(await rp(`chNewOn && !chOpen && !chSending`), "Senden ohne Empfänger");
  // Zurück: wieder die Übersicht an derselben Stelle
  await page.tap("#chView [data-act=chback]"); await page.waitForTimeout(300);
  ok(await rp(`chPage && !chNewOn && !chOpen && !!document.querySelector("#chView .ch-list") && !(history.state && history.state.rpch)`), "Zurück führt nicht zur Übersicht");
  await page.tap("#chView [data-act=chnewtog]"); await page.waitForTimeout(200);
  await page.evaluate(() => history.back()); await page.waitForTimeout(400);
  ok(await rp(`chPage && !chNewOn && !!document.querySelector("#chView .ch-list")`), "Safari-Zurück führt nicht zur Übersicht");
  await rp(`closeChPage(); CH.byId = {}; CH.list = []; FR.friends = []; true`);
});

await test("Chat: öffnet erst mit geladenem Verlauf, Aktualisieren hält die gelesene Stelle", async () => {
  await seed();
  await rp(`window.__gets = []; window.__M = []; for(var i = 0; i < 40; i++) __M.push({id:"m"+String(i).padStart(2,"0"), from:i % 3 ? "u1" : "u_me", t:"Nachricht "+i, at:Date.now() - (40 - i)*60000});
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return Object.assign({}, m); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(){}, update:function(){}, commit:function(){ return new Promise(function(){}); }}; }, collection:function(){ return {doc:function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, update:function(){ return Promise.resolve(); },
      collection:function(){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; },
        get:function(o){ __gets.push(cid+(o && o.source ? ":"+o.source : "")); return new Promise(function(r){ setTimeout(function(){ r(qs()); }, 500); }); },
        onSnapshot:function(cb){ window.__snap = function(){ cb(qs()); }; setTimeout(__snap, 0); return function(){}; }}; return q; }}; }}; }};
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, read:{u_me:Date.now()}, last:{t:"Nachricht 39", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true;
    openChPage(); true`);
  await page.waitForTimeout(250);
  await page.tap('#chView [data-act=chopen][data-v="u1_u_me"]'); await page.waitForTimeout(150);
  ok(await rp(`!chOpen && !document.querySelector("#chView .ch-conv") && document.querySelector('#chView [data-v="u1_u_me"]').classList.contains("ld")`), "Chat geht vor dem Laden leer auf oder zeigt kein Laden");
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me"`), null, {timeout:4000});
  const st = () => page.evaluate(() => { const b = document.getElementById("chMsgs"); return {n:b.querySelectorAll(".ch-msg").length, end:b.scrollHeight - b.scrollTop - b.clientHeight, top:b.scrollTop}; });
  let s = await st(); ok(s.n===40 && s.end < 5, "Verlauf nicht sofort vollständig unten: "+JSON.stringify(s));
  // hochscrollen und aktualisieren: bleibt an der Stelle
  await page.evaluate(() => { document.getElementById("chMsgs").scrollTop = 0; }); await page.waitForTimeout(100);
  await rp(`chRefresh(); true`); await page.waitForTimeout(800);
  s = await st(); ok(await rp(`__gets.indexOf("u1_u_me:server") > -1`), "Aktualisieren holt nichts vom Server");
  ok(s.top < 5, "Aktualisieren springt zur neuesten Nachricht: "+JSON.stringify(s));
  // fremde neue Nachricht: Stelle bleibt; eigene neue Nachricht: nach unten
  await page.evaluate(() => { document.getElementById("chMsgs").scrollTop = 120; });
  await rp(`__M.push({id:"m40", from:"u1", t:"Neu", at:Date.now()}); __snap(); true`); await page.waitForTimeout(100);
  s = await st(); ok(Math.abs(s.top - 120) <= 2, "Fremde Nachricht verschiebt die Lesestelle: "+JSON.stringify(s));
  await rp(`chProf("u_x"); renderCh(); true`); await page.waitForTimeout(100);
  s = await st(); ok(Math.abs(s.top - 120) <= 2, "Neuzeichnen (Profilbild) springt nach unten: "+JSON.stringify(s));
  await rp(`__M.push({id:"m41", from:"u_me", t:"Meins", at:Date.now()}); __snap(); true`); await page.waitForTimeout(100);
  s = await st(); ok(s.end < 5, "Eigene Nachricht scrollt nicht nach unten: "+JSON.stringify(s));
  // erneut öffnen: sofort aus dem Speicher, ohne neues Laden
  await page.tap("#chView [data-act=chback]"); await page.waitForTimeout(300);
  const n0 = await rp(`__gets.length`);
  await page.tap('#chView [data-act=chopen][data-v="u1_u_me"]'); await page.waitForTimeout(60);
  ok(await rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===42 && __gets.length===${n0}`), "Bekannter Chat öffnet nicht sofort aus dem Speicher");
  await shot("chat-geladen");
});

await test("Chat: Nachricht zur Mitte ziehen markiert sie zum Antworten, Zitat springt zur Originalnachricht", async () => {
  await seed();
  await rp(`window.__sent = []; window.__M = []; for(var i = 0; i < 30; i++) __M.push({id:"m"+String(i).padStart(2,"0"), from:i % 3 ? "u1" : "u_me", t:"Nachricht "+i, at:Date.now() - (30 - i)*60000});
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(r, d){ if(d && d.from && d.at) __sent.push(d); }, update:function(){}, commit:function(){ return Promise.resolve(); }}; }, collection:function(){ return {doc:function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, update:function(){ return Promise.resolve(); },
      collection:function(n){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, doc:function(){ return {}; }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ if(n!=="msgs" || cid!=="u1_u_me") return function(){}; window.__snap = function(){ cb(qs()); }; setTimeout(__snap, 0); return function(){}; }}; return q; }}; }}; }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; acct.user.uid = "u_me";
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, names:{u1:"Anna"}, read:{u_me:Date.now()}, last:{t:"Nachricht 29", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true; CHPROF.u1 = {name:"Anna"};
    CHMC.u1_u_me = null; delete CHMC.u1_u_me; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===30`), null, {timeout:4000});
  const cdp = await page.context().newCDPSession(page);
  const tStart = (x, y) => cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x, y}]});
  const tMove = async (x, y) => { await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x, y}]}); await page.waitForTimeout(16); };
  const tEnd = () => cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
  const box0 = (id) => page.evaluate(id => { const b = document.querySelector('#chMsgs .ch-msg[data-mid="'+id+'"] .ch-bub').getBoundingClientRect(); return {l:b.left, r:b.right, y:(b.top + b.bottom) / 2}; }, id);
  // erst messen, wenn der Verlauf still steht (Neuzeichnen/Scrollen nach dem Öffnen)
  const box = async (id) => { let a = "", b = null; for(let k = 0; k < 25; k++){ b = await box0(id); const v = JSON.stringify(b); if(v===a) break; a = v; await page.waitForTimeout(60); } return b; };
  // fremde Nachricht nach rechts ziehen: folgt dem Finger, Antwort-Symbol erscheint, federt zurück, Zitatleiste über der Eingabe
  let b = await box("m28"), x = b.l + 20;
  // mittendrin zeichnet der Verlauf neu (neue Daten vom Server): Geste läuft auf der neuen Nachricht weiter
  await tStart(x, b.y); for(const d of [6, 14, 30]) await tMove(x + d, b.y + 2); await rp(`__snap(); true`); for(const d of [50, 70, 95]) await tMove(x + d, b.y + 2);
  const mid = await page.evaluate(() => { const m = document.querySelector('#chMsgs .ch-msg[data-mid="m28"]'), i = m.querySelector(".ch-reic"); return {tx:new DOMMatrix(getComputedStyle(m).transform).m41, op:i ? +i.style.opacity : 0, on:!!i && i.classList.contains("on")}; });
  ok(mid.tx > 50 && mid.tx < 95 && mid.op > 0.95 && mid.on, "Nachricht folgt dem Finger nicht gebremst oder kein Antwort-Symbol: "+JSON.stringify(mid));
  await shot("chat-antworten-ziehen");
  await tEnd(); await page.waitForTimeout(450);
  ok(await rp(`chOpen==="u1_u_me" && !document.querySelector("#chView .ch-under") && !document.querySelector("#chView .ch-conv").style.translate`), "Ziehen nach rechts auf fremder Nachricht löst Zurück aus");
  ok(await rp(`var m = document.querySelector('#chMsgs .ch-msg[data-mid="m28"]'); !m.style.transform && !m.querySelector(".ch-reic") && !m.classList.contains("rsw")`), "Nachricht federt nicht zurück oder Reste bleiben");
  ok(await rp(`chRe && chRe.id==="m28" && !$("chReBox").hidden && $("chReBox").textContent.includes("Antwort an @Anna") && $("chReBox").textContent.includes("Nachricht 28")`), "Zitatleiste fehlt oder falsch");
  ok(await rp(`document.activeElement===$("chIn")`), "Eingabefeld nicht fokussiert");
  ok(await rp(`var r = $("chReBox").getBoundingClientRect(), c = document.querySelector("#chView .ch-comp").getBoundingClientRect(); r.bottom <= c.top + 1 && r.height > 20`), "Zitatleiste nicht direkt über der Eingabe");
  await shot("chat-antworten-leiste");
  await page.tap("#chReBox [data-act=chrex]"); await page.waitForTimeout(100);
  ok(await rp(`!chRe && $("chReBox").hidden`), "X schließt die Zitatleiste nicht");
  // kurz ziehen (unter der Schwelle): nichts markiert
  b = await box("m28"); x = b.l + 20;
  await tStart(x, b.y); for(const d of [6, 14, 24, 30]) await tMove(x + d, b.y); await tEnd(); await page.waitForTimeout(400);
  ok(await rp(`!chRe && chOpen==="u1_u_me"`), "Kurzes Ziehen markiert schon zum Antworten");
  // senkrecht über eine Nachricht wischen: kein Antworten
  await tStart(x, b.y); for(const d of [8, 20, 40, 70]) await tMove(x + 3, b.y - d); await tEnd(); await page.waitForTimeout(400);
  ok(await rp(`!chRe && chOpen==="u1_u_me"`), "Senkrechtes Wischen markiert zum Antworten");
  // eigene Nachricht nach links ziehen
  b = await box("m27"); x = b.r - 15;
  await tStart(x, b.y); for(const d of [6, 14, 30, 50, 75, 90]) await tMove(x - d, b.y + 1); await tEnd(); await page.waitForTimeout(450);
  ok(await rp(`chRe && chRe.id==="m27" && $("chReBox").textContent.includes("Antwort an dich selbst")`), "Eigene Nachricht nach links markiert nicht zum Antworten");
  // Antwort senden: Zitat wird mitgeschickt, Leiste verschwindet
  await page.fill("#chIn", "Meine Antwort"); await page.tap("#chView [data-act=chsend]"); await page.waitForTimeout(150);
  ok(await rp(`var s = __sent[__sent.length-1]; !!s && s.t==="Meine Antwort" && s.re && s.re.id==="m27" && s.re.t==="Nachricht 27" && s.re.from==="u_me"`), "Antwort ohne Zitat gesendet: "+JSON.stringify(await rp(`__sent`)));
  ok(await rp(`!chRe && $("chReBox").hidden`), "Zitatleiste bleibt nach dem Senden");
  // gesendete Antwort zeigt das Zitat; Antippen springt zur Originalnachricht
  await rp(`__M.push(Object.assign({id:"m30"}, __sent[__sent.length-1])); __M.push({id:"m31", from:"u1", t:"Fremde Antwort", at:Date.now(), re:{id:"m01", from:"u1", t:"Nachricht 1"}}); __snap(); true`); await page.waitForTimeout(150);
  ok(await rp(`var q = document.querySelector('#chMsgs .ch-msg[data-mid="m30"] .ch-rq'); !!q && q.textContent.includes("Du hast dir selbst geantwortet") && q.textContent.includes("Nachricht 27")`), "Eigene Antwort zeigt kein Zitat");
  ok(await rp(`var q = document.querySelector('#chMsgs .ch-msg[data-mid="m31"] .ch-rq'); !!q && q.textContent.includes("@Anna hat sich selbst geantwortet")`), "Fremde Antwort zeigt kein Zitat");
  await shot("chat-antworten-zitat");
  await page.evaluate(() => { const b = document.getElementById("chMsgs"); b.scrollTop = b.scrollHeight; });
  await page.tap('#chMsgs .ch-msg[data-mid="m31"] .ch-rq'); await page.waitForTimeout(900);
  const j = await page.evaluate(() => { const bx = document.getElementById("chMsgs").getBoundingClientRect(), m = document.querySelector('#chMsgs .ch-msg[data-mid="m01"]'), r = m.getBoundingClientRect(); return {vis:r.top >= bx.top - 1 && r.bottom <= bx.bottom + 1, hl:m.classList.contains("rhl"), t:r.top, bt:bx.top, bb:bx.bottom, st:document.getElementById("chMsgs").scrollTop}; });
  ok(j.vis && j.hl, "Antippen des Zitats springt nicht zur Originalnachricht: "+JSON.stringify(j));
  // eigene Nachricht nach rechts ziehen = weiterhin Zurück (Chat folgt dem Finger, Übersicht darunter)
  b = await box("m03"); x = b.l + 10;
  await tStart(x, b.y); for(const d of [15, 35, 70]) await tMove(x + d, b.y);
  ok(await rp(`parseFloat(document.querySelector("#chView .ch-conv").style.translate) > 20 && !!document.querySelector("#chView .ch-under") && !chRe && !document.querySelector("#chMsgs .ch-reic")`), "Eigene Nachricht nach rechts ziehen löst nicht mehr Zurück aus");
  await tEnd(); await page.waitForTimeout(400);
  await cdp.detach(); await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});

await test("Chat: Nachricht gedrückt halten – Reaktionen, Antworten, Fixieren, Weiterleiten, Für dich löschen", async () => {
  await seed();
  await rp(`window.__sent = []; window.__upd = []; window.__M = []; for(var i = 0; i < 30; i++) __M.push({id:"m"+String(i).padStart(2,"0"), from:i % 3 ? "u1" : "u_me", t:"Nachricht "+i, at:Date.now() - (30 - i)*60000});
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(r, d){ if(d && d.from && d.at) __sent.push(d); }, update:function(){}, commit:function(){ return Promise.resolve(); }}; },
      collection:function(){ return {doc:function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, update:function(o){ __upd.push([cid, o]); return Promise.resolve(); },
      collection:function(n){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, doc:function(id){ return {update:function(o){ __upd.push([id, o]); return Promise.resolve(); }}; }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ if(n!=="msgs" || cid!=="u1_u_me") return function(){}; window.__snap = function(){ cb(qs()); }; setTimeout(__snap, 0); return function(){}; }}; return q; }}; }}; }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; acct.user.uid = "u_me"; FR.friends = [{uid:"u1", name:"Anna"}, {uid:"u2", name:"Bert"}];
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, names:{u1:"Anna"}, read:{u_me:Date.now()}, last:{t:"Nachricht 29", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true; CHPROF.u1 = {name:"Anna"}; CHPROF.u2 = {name:"Bert"};
    delete CHMC.u1_u_me; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===30`), null, {timeout:4000});
  const cdp = await page.context().newCDPSession(page);
  const box = (id) => page.evaluate(id => { const e = document.querySelector('#chMsgs .ch-msg[data-mid="'+id+'"] .ch-bub'); if(!e) return null; const b = e.getBoundingClientRect(); return {x:(b.left + b.right) / 2, y:(b.top + b.bottom) / 2}; }, id);
  const hold = async (id, ms = 650) => { await page.evaluate(id => { const e = document.querySelector('#chMsgs .ch-msg[data-mid="'+id+'"]'), bx = document.getElementById("chMsgs"), r = e.getBoundingClientRect(); if(r.top < 300 || r.bottom > bx.getBoundingClientRect().bottom - 20) bx.scrollTop += r.top - 420; }, id);
    let st = -1; for(let k = 0; k < 20; k++){ await page.waitForTimeout(60); const v = JSON.stringify(await box(id)); if(v===st) break; st = v; }
    const b = await box(id); await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:b.x, y:b.y}]}); await page.waitForTimeout(ms); await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); await page.waitForTimeout(300);
    if(!(await rp(`!!$("chAct")`))) throw new Error("Gedrückt halten auf "+id+" öffnet kein Menü"); };
  const tp = async (sel) => { try { await page.tap(sel, {timeout:3000}); } catch(e){ throw new Error("Antippen fehlgeschlagen: "+sel+" – "+e.message.split("\n")[0]); } };
  const cha = (k) => tp('#chAct [data-cha="'+k+'"]');
  // kurz antippen: kein Menü; gedrückt halten: Leiste darüber, Nachricht, Menü darunter
  const b0 = await box("m28"); await page.touchscreen.tap(b0.x, b0.y); await page.waitForTimeout(600);
  ok(!(await rp(`!!$("chAct")`)), "Kurzes Antippen öffnet das Menü");
  await hold("m28");
  const L = await page.evaluate(() => { const a = document.getElementById("chAct"); if(!a) return null; const r = (s) => a.querySelector(s).getBoundingClientRect();
    return {on:a.classList.contains("on"), n:a.querySelectorAll(".cha-rx button").length, rxB:r(".cha-rx").bottom, mT:r(".cha-msg").top, mB:r(".cha-msg").bottom, mnT:r(".cha-menu").top, mnB:r(".cha-menu").bottom, H:innerHeight,
      menu:a.querySelector(".cha-menu").textContent, hid:document.querySelector('#chMsgs .ch-msg[data-mid="m28"]').style.visibility, blur:getComputedStyle(a).backdropFilter}; });
  ok(L && L.on && L.n===7, "Reaktionsleiste fehlt: "+JSON.stringify(L));
  ok(L.rxB <= L.mT + 12 && L.mnT >= L.mB - 2 && L.mnB <= L.H, "Leiste/Menü nicht über/unter der Nachricht: "+JSON.stringify(L));
  ok(["Antworten", "Kopieren", "Weiterleiten", "Fixieren", "Sticker hinzufügen", "Für dich löschen"].every(w => L.menu.includes(w)), "Menüpunkte fehlen: "+L.menu);
  ok(L.hid==="hidden" && /blur/.test(L.blur), "Original nicht ausgeblendet oder Hintergrund nicht unscharf");
  await shot("chat-gedrueckt-halten");
  // keine iOS-Textauswahl: Verlauf, Menü und (solange offen) die ganze Seite nicht markierbar, Auswahlbeginn wird verhindert
  ok(await rp(`var us = function(q){ var e = document.querySelector(q); return getComputedStyle(e).webkitUserSelect || getComputedStyle(e).userSelect; };
    var ev = new Event("selectstart", {bubbles:true, cancelable:true}); document.querySelector("#chAct .cha-menu button").dispatchEvent(ev);
    us("#chMsgs .ch-bub")==="none" && us("#chMsgs .ch-tm")==="none" && us("#chAct .cha-menu button span")==="none" && us(".top")==="none" && document.body.classList.contains("chact") && ev.defaultPrevented && String(getSelection())===""`), "Gedrückthalten erlaubt Textauswahl");
  // Herz: gespeichert als rx.u_me, klein an der Nachricht; Antippen der Reaktion entfernt sie
  await cha("rx"); await page.waitForTimeout(300);
  ok(await rp(`!$("chAct") && document.querySelector('#chMsgs .ch-msg[data-mid="m28"]').style.visibility===""`), "Menü schließt nach Reaktion nicht");
  ok(await rp(`!document.body.classList.contains("chact") && getComputedStyle($("chIn")).userSelect!=="none"`), "Nach dem Schließen bleibt die Seite unmarkierbar oder Eingabe gesperrt");
  ok(await rp(`var p = document.querySelector('#chMsgs .ch-msg[data-mid="m28"] .ch-rxs'); !!p && p.classList.contains("mine") && !/3\.5px/.test(getComputedStyle(p).boxShadow) && getComputedStyle(p).outlineStyle==="none"`), "Eigene Reaktion hat noch einen Rand");
  ok(await rp(`JSON.stringify(__upd[__upd.length-1])===JSON.stringify(["m28", {"rx.u_me":"❤️"}])`), "Reaktion nicht gespeichert: "+await rp(`JSON.stringify(__upd)`));
  ok(await rp(`var p = document.querySelector('#chMsgs .ch-msg[data-mid="m28"] .ch-rxs'); !!p && p.textContent.includes("❤️")`), "Reaktion nicht an der Nachricht");
  await tp('#chMsgs .ch-msg[data-mid="m28"] .ch-rxs'); await page.waitForTimeout(200);
  ok(await rp(`!document.querySelector('#chMsgs .ch-msg[data-mid="m28"] .ch-rxs') && __upd[__upd.length-1][1]["rx.u_me"]===""`), "Antippen entfernt eigene Reaktion nicht");
  // Reaktion des anderen kommt über den Verlauf
  await rp(`__M[28].rx = {u1:"😂"}; __snap(); true`); await page.waitForTimeout(150);
  ok(await rp(`document.querySelector('#chMsgs .ch-msg[data-mid="m28"] .ch-rxs').textContent.includes("😂")`), "Reaktion des anderen nicht sichtbar");
  // Plus: weitere Reaktionen
  await hold("m28"); await cha("more"); await page.waitForTimeout(150);
  ok(await rp(`document.querySelectorAll("#chAct .cha-rx.grid button").length > 25`), "Plus zeigt keine weiteren Reaktionen");
  await tp('#chAct [data-e="🔥"]'); await page.waitForTimeout(250);
  ok(await rp(`__upd[__upd.length-1][1]["rx.u_me"]==="🔥"`), "Weitere Reaktion nicht gespeichert");
  // Hintergrund antippen: schließt, nichts passiert
  const n0 = await rp(`__upd.length`); await hold("m25"); await page.touchscreen.tap(380, 150); await page.waitForTimeout(300);
  ok(await rp(`!$("chAct") && __upd.length===${n0} && chOpen==="u1_u_me"`), "Antippen des Hintergrunds schließt nicht sauber");
  // Antworten = gleiche Funktion wie Wischen
  await hold("m25"); await cha("reply"); await page.waitForTimeout(250);
  ok(await rp(`chRe && chRe.id==="m25" && !$("chReBox").hidden`), "Antworten aus dem Menü markiert nicht");
  await page.click("#chReBox [data-act=chrex]"); await rp(`document.activeElement.blur(); true`); await page.waitForTimeout(500);
  // Fixieren: Leiste oben, Antippen springt hin; erneut = lösen
  await hold("m25"); await cha("pin"); await page.waitForTimeout(250);
  ok(await rp(`var u = __upd[__upd.length-1]; u[0]==="u1_u_me" && u[1].pin && u[1].pin.id==="m25" && !$("chPinBox").hidden && $("chPinBox").textContent.includes("Nachricht 25")`), "Fixieren zeigt keine Leiste");
  await shot("chat-fixiert");
  await page.evaluate(() => { const b = document.getElementById("chMsgs"); b.scrollTop = b.scrollHeight; });
  await tp("#chPinBox"); await page.waitForTimeout(800);
  ok(await rp(`document.querySelector('#chMsgs .ch-msg[data-mid="m25"]').classList.contains("rhl")`), "Fixierte Leiste springt nicht zur Nachricht");
  await hold("m25"); ok((await page.locator("#chAct .cha-menu").innerText()).includes("Fixierung lösen"), "Fixierte Nachricht bietet kein Lösen"); await cha("pin"); await page.waitForTimeout(250);
  ok(await rp(`$("chPinBox").hidden && __upd[__upd.length-1][1].pin===null`), "Fixierung lösen geht nicht");
  // Weiterleiten an Freund
  await hold("m27"); await cha("fwd"); await page.waitForTimeout(250);
  ok(await visible("#catPop .frs"), "Weiterleiten zeigt keine Freunde-Auswahl");
  await tp('#catPop .frs-row[data-uid="u2"]'); await page.waitForTimeout(250);
  ok(await rp(`var s = __sent[__sent.length-1]; !!s && s.t==="Nachricht 27" && s.fwd===true && $("catPop").hidden`), "Weiterleiten sendet nicht: "+await rp(`JSON.stringify(__sent)`));
  // Sticker: noch nicht verfügbar
  await hold("m27"); await cha("sticker"); await page.waitForTimeout(200);
  ok((await page.locator("#toast").innerText()).includes("noch nicht verfügbar"), "Sticker ohne Hinweis");
  // Für dich löschen: mit Bestätigung, dann ausgeblendet
  await page.touchscreen.tap(380, 150); await page.waitForTimeout(250);
  await hold("m27"); await cha("del"); await page.waitForTimeout(200);
  ok(await visible("#cfPop"), "Löschen ohne Bestätigung");
  await tp("#cfPop .cf-ok"); await page.waitForTimeout(250);
  ok(await rp(`!document.querySelector('#chMsgs .ch-msg[data-mid="m27"]') && __upd[__upd.length-1][1]["hide.u_me.m27"]===true`), "Für dich löschen blendet nicht aus");
  // Halten mit Bewegung (Scrollen) öffnet nichts
  const b1 = await box("m25"); await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:b1.x, y:b1.y}]});
  for(const d of [10, 25, 40]){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:b1.x, y:b1.y - d}]}); await page.waitForTimeout(20); }
  await page.waitForTimeout(600); await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); await page.waitForTimeout(200);
  ok(!(await rp(`!!$("chAct")`)), "Scrollen öffnet das Menü");
  await cdp.detach(); await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; FR.friends = []; true`);
});

await test("Anmeldung: Reisen aus dem Gerätespeicher sofort, reine Server-Bestätigung (ohne Änderung) wird übernommen", async () => {
  await seed();
  await rp(`window.__T = S.trips.t_test; window.__applied = [];
    var mk = function(cache, changes){ return {size:1, metadata:{fromCache:cache, hasPendingWrites:false}, docChanges:function(){ return changes ? [1] : []; },
      docs:[{id:"t_test", data:function(){ return {json:JSON.stringify(__T), members:["u_me"], owner:"u_me", updatedAt:1}; }}]}; };
    window.__mk = mk; var never = new Promise(function(){}), P = function(){ return new Proxy(function(){}, {get:function(t, k){ if(k==="then" || k==="catch" || k==="finally") return never[k].bind(never); return function(){ return k==="onSnapshot" ? function(){} : P(); }; }, apply:function(){ return P(); }}); };
    fbDb = P(); renameLocal = function(){}; invWatch = function(){}; pvGate = function(){ return Promise.resolve(); };
    myTrips = function(){ return {onSnapshot:function(o, cb){ window.__opts = o; window.__cb = cb; return function(){}; }}; };
    var aa = acctApply; acctApply = function(r){ __applied.push(r.length); aa(r); };
    fbUnsub = null; S = fresh(); renderAll(); bootWait({metadata:{creationTime:"2025-01-01T00:00:00Z"}}); renderGate(); acctLive(); true`);
  ok(await rp(`!!(__opts && __opts.includeMetadataChanges)`), "Abruf ohne includeMetadataChanges – Server-Bestätigung käme nie an");
  await rp(`__cb(__mk(true, true)); true`); await page.waitForTimeout(200);
  ok(await rp(`!acct.boot && $("gate").hidden && !noTrip() && __applied.length===1`), "Reisen aus dem Speicher öffnen die Startseite nicht sofort");
  await rp(`__cb(__mk(false, false)); true`); await page.waitForTimeout(200);
  ok(await rp(`__applied.length===2`), "Server-Bestätigung ohne Änderung wird nicht übernommen");
  await rp(`__cb(__mk(false, false)); true`); await page.waitForTimeout(200);
  ok(await rp(`__applied.length===2`), "Reine Statusänderung löst erneutes Übernehmen aus");
});

await test("Anmeldung: erst Reisen laden, dann Startseite – kein „Noch keine Reise“ dazwischen", async () => {
  await seed();
  await rp(`acct.user = {uid:"u_me", email:"me@test.de"}; bootWait(); renderGate(); true`);
  await page.waitForTimeout(150);
  ok(await visible("#gate .gate-load .ldspin") && await rp(`document.body.classList.contains("gated")`), "Keine Ladeanzeige nach der Anmeldung");
  ok(await page.evaluate(() => { const e = document.elementFromPoint(innerWidth/2, innerHeight/2); return !!(e && e.closest("#gate")); }), "Startseite scheint durch die Ladeanzeige");
  const h0 = await page.evaluate(() => document.getElementById("gate").innerHTML);
  await rp(`renderGate(); true`);
  ok(await page.evaluate(h => document.getElementById("gate").innerHTML===h, h0), "Ladeanzeige wird neu gezeichnet (Flackern)");
  // Verbindungsfehler (z. B. Token noch nicht bestätigt) und leerer Serverstand beenden das Warten nicht sofort
  await rp(`window.__t0 = S.trips; S = {trips:{}, cur:null}; acctApply([]); true`); await page.waitForTimeout(300);
  ok(await rp(`acct.boot && !$("gate").hidden`), "Leerer Zwischenstand beendet die Ladeanzeige");
  // Reisen kommen an: Ladeanzeige weg, Startseite mit Reise (kein „Noch keine Reise“)
  await rp(`acctApply([{id:"t_test", data:__t0.t_test, updated_at:new Date().toISOString()}]); true`); await page.waitForTimeout(150);
  ok(await rp(`$("gate").hidden && !document.body.classList.contains("gated") && !acct.boot && !noTrip()`), "Nach dem Laden bleibt die Ladeanzeige stehen oder keine Reise");
  ok(await page.locator("#sheet .notrip, .notrip h2").count()===0, "„Noch keine Reise“ erscheint trotz geladener Reise");
  // neues Konto ohne Reisen: nach kurzem Warten „Noch keine Reise“
  // bestehendes Konto, Server meldet (noch) nichts: Ladeanzeige bleibt, nach einer Weile „Ohne Reisen fortfahren“ mit Protokoll
  await rp(`bootWait({metadata:{creationTime:"2025-01-01T00:00:00Z"}}); renderGate(); S = {trips:{}, cur:null}; acctApply([]); true`); await page.waitForTimeout(4400);
  ok(await rp(`acct.boot && !$("gate").hidden`), "Leerer Serverstand bei bestehendem Konto zeigt „Noch keine Reise“");
  await rp(`bootSlow(); true`); await page.waitForTimeout(100);
  ok(await visible("#gate [data-act=bootgo]") && await rp(`$("gateLog").textContent.includes("Warten auf Reisen")`), "Kein „Ohne Reisen fortfahren“/Protokoll bei langer Ladezeit");
  await shot("anmeldung-dauert");
  await page.tap("#gate [data-act=bootgo]"); await page.waitForTimeout(150);
  ok(await rp(`!acct.boot && $("gate").hidden`), "„Ohne Reisen fortfahren“ wirkt nicht");
  // neues Konto ohne Reisen: nach kurzem Warten „Noch keine Reise“
  await rp(`bootWait({metadata:{creationTime:new Date().toISOString()}}); renderGate(); S = {trips:{}, cur:null}; acctApply([]); true`); await page.waitForTimeout(4400);
  ok(await rp(`!acct.boot && $("gate").hidden`), "Neues Konto ohne Reisen bleibt in der Ladeanzeige hängen");
});

await test("Foto im Chat schicken: Freunde-Suche filtert, Menü bleibt offen", async () => {
  await seed();
  await rp(`openJPop("p4", dayOf("p4"), "ph_a")`); await page.waitForTimeout(300);
  await click("#pvLayer [data-act=phsend]");
  ok(await visible("#jpMenu .frp-q"), "Suchzeile fehlt");
  await page.locator("#jpMenu .frp-q").click(); await page.waitForTimeout(150);
  ok(await visible("#jpMenu"), "Tipp ins Suchfeld schließt das Menü");
  await page.locator("#jpMenu .frp-q").fill("lu"); await page.waitForTimeout(100);
  const n = await page.locator("#jpMenu [data-frn]:not([hidden])").count();
  ok(n===1, "Suche filtert nicht (sichtbar: "+n+")");
  await shot("freunde-suche");
});

await test("Rückblick: Foto öffnet normale Ansicht über alle Tagesfotos, Escape führt zurück", async () => {
  await seed();
  await rp(`openRecap(dayOf("p4"))`); await page.waitForTimeout(900);
  ok(await visible("#rc"), "Rückblick nicht sichtbar");
  await page.locator("#rc [data-rc=ph]").first().scrollIntoViewIfNeeded();
  await click("#rc [data-rc=ph]");
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !!L && !L.hidden; }), "Foto-Ansicht öffnet nicht");
  ok((await page.locator("#pvFsN").innerText()).includes("/ 3"), "Nicht alle Fotos des Tages im Vollbild");
  ok(await page.locator("#pvLayer .pv-side [data-act=phmore]").count()===1, "Optionen fehlen im Rückblick-Vollbild");
  ok(await page.locator("#pvLayer .pv-side [data-act=rclbopen]").count()===0, "Alter ⋯-Umweg ist noch da");
  await shot("rueckblick-foto");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }), "Foto-Ansicht schließt nicht");
  ok(await visible("#rc"), "Nach dem Schließen nicht im Rückblick");
});

await test("Rückblick: Foto nach unten wegziehen schließt und bleibt im Rückblick", async () => {
  await seed();
  await rp(`openRecap(dayOf("p4"))`); await page.waitForTimeout(900);
  await page.locator("#rc [data-rc=ph]").first().scrollIntoViewIfNeeded();
  await click("#rc [data-rc=ph]"); await page.waitForTimeout(400);
  await page.evaluate(() => {
    const tg = document.querySelector("#pvLayer .pv-slide img") || document.querySelector("#pvLayer .pv-slide");
    const T = (x, y) => new Touch({identifier:2, target:tg, clientX:x, clientY:y});
    tg.dispatchEvent(new TouchEvent("touchstart", {bubbles:true, cancelable:true, touches:[T(200, 300)], changedTouches:[T(200, 300)]}));
    [340, 420, 520].forEach(y => tg.dispatchEvent(new TouchEvent("touchmove", {bubbles:true, cancelable:true, touches:[T(202, y)], changedTouches:[T(202, y)]})));
    tg.dispatchEvent(new TouchEvent("touchend", {bubbles:true, cancelable:true, touches:[], changedTouches:[T(202, 520)]}));
  });
  await page.waitForFunction(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }, null, {timeout:4000}).catch(() => {});
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }), "Wegziehen schließt das Foto nicht");
  ok(await visible("#rc"), "Nach dem Wegziehen nicht im Rückblick");
});

await test("Rückblick: seitlich wischen wechselt den Tag", async () => {
  await seed();
  const Y = await rp(`dayOf("p4")`);
  await rp(`openRecap("${Y}")`);
  // warten, bis die Einblendung (Deckkraft/Zoom) fertig ist – unter Last dauert das länger als die nominalen 0,5 s
  await page.waitForFunction(() => { const el = document.getElementById("rc"), cs = el && getComputedStyle(el); return el && el.classList.contains("on") && cs.opacity==="1" && cs.transform==="none" && !el.getAnimations({subtree:false}).length; }, null, {timeout:10000});
  await page.evaluate(() => {
    const el = document.getElementById("rc"), tg = el.querySelector(".rc-hero") || el;
    const T = (x, y) => new Touch({identifier:1, target:tg, clientX:x, clientY:y});
    tg.dispatchEvent(new TouchEvent("touchstart", {bubbles:true, touches:[T(300, 500)], changedTouches:[T(300, 500)]}));
    tg.dispatchEvent(new TouchEvent("touchmove", {bubbles:true, touches:[T(200, 503)], changedTouches:[T(200, 503)]}));
    tg.dispatchEvent(new TouchEvent("touchmove", {bubbles:true, touches:[T(120, 505)], changedTouches:[T(120, 505)]}));
    window.__rcMid = {op: getComputedStyle(el).opacity, tf: el.style.transform || "", pg: (el.querySelector(".rc-pg") || {style:{}}).style.transform || ""};
    tg.dispatchEvent(new TouchEvent("touchend", {bubbles:true, touches:[], changedTouches:[T(120, 505)]}));
  });
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => window.__rcMid);
  ok(mid.op==="1" && !mid.tf, "Rückblick selbst wird beim Wischen verschoben/ausgeblendet (App blitzt durch)");
  ok(mid.pg.includes("translateX"), "Inhalt folgt dem Finger nicht");
  await page.waitForTimeout(80);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("rc")).opacity)==="1", "Rückblick wird beim Tageswechsel ausgeblendet");
  const k = await rp(`RC.key`);
  ok(k > Y, "Wischen nach links wechselt nicht zum nächsten Tag ("+k+")");
});

async function dayHeadOk(where){
  await rp(`(function(){ sugOpen = false; select(null); setSheet("full"); renderSheet(); })()`); await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const q = s => { const e = document.querySelector("#body .dhx "+s); if(!e) return null; const b = e.getBoundingClientRect(); return {t:b.top, b:b.bottom, l:b.left, r:b.right}; };
    const row = document.querySelector("#body .dhx").getBoundingClientRect(), body = document.getElementById("body").getBoundingClientRect();
    return {row:{t:row.top, b:row.bottom, h:row.height, r:row.right}, body:{r:body.right}, day:q(".dhd"), rc:q("[data-act=recap]"), sug:q("[data-act=sugtoggle]"), ring:!!document.querySelector("#body .dhx .dring[role=progressbar]"), old:!!document.querySelector("#body .fold[data-act=sugtoggle]")}; });
  ok(r.day && r.rc && r.sug, where+": Tag, Vorschau oder Vorschläge fehlen in der Zeile "+JSON.stringify(r));
  ok(r.row.h <= 64, where+": Tageskopf zu hoch ("+Math.round(r.row.h)+" px)");
  ok(Math.abs((r.rc.t+r.rc.b)/2 - (r.sug.t+r.sug.b)/2) < 2 && r.rc.t >= r.row.t - 1 && r.sug.b <= r.row.b + 1, where+": Knöpfe nicht in einer Zeile "+JSON.stringify(r));
  ok(r.day.r <= r.rc.l && r.rc.r <= r.sug.l && r.sug.r <= r.body.r + 1, where+": Reihenfolge/Überlappung falsch "+JSON.stringify(r));
  ok(r.ring && !r.old, where+": Fortschrittsring fehlt oder alte Vorschlagszeile noch da");
  await click("#body .dhx [data-act=sugtoggle]"); await page.waitForTimeout(200);
  ok(await page.locator("#body .dsugs .sug").count() > 0, where+": Vorschläge klappen nicht auf");
  ok(await page.evaluate(() => document.querySelector("#body .dhx [data-act=sugtoggle]").getAttribute("aria-expanded"))==="true", where+": Vorschlagsknopf nicht als offen markiert");
  await shot("tageskopf-"+where);
  await click("#body .dhx [data-act=sugtoggle]"); await page.waitForTimeout(200);
  ok(await page.locator("#body .dsugs").count()===0, where+": Vorschläge klappen nicht zu");
  await click("#body .dhx [data-act=recap]"); await page.waitForTimeout(400);
  ok(await visible("#rc"), where+": Tagesvorschau öffnet nicht");
}
await test("Tageskopf: Tag, Tagesvorschau und Vorschläge in einer Zeile (hoch)", async () => { await seed(); await dayHeadOk("hoch"); });
await test("Tageskopf: Tag, Tagesvorschau und Vorschläge in einer Zeile (quer)", async () => { await seed(); await dayHeadOk("quer"); }, {vp:{width:844, height:390}, safe:{left:47, right:47, bottom:21}});
await test("Kartenebenen: Besuchte Orte & Fotospots ausblenden", async () => {
  await seed();
  await click("#layersBtn");
  ok(await visible("#layers"), "Ebenen-Menü öffnet nicht");
  await page.locator("#lVis").uncheck(); await page.waitForTimeout(200);
  ok(await rp(`lsGet("nyc-l-vis")`)==="0", "Einstellung wird nicht gespeichert");
  ok(await rp(`visOn()`)===false, "Filter greift nicht");
});

await test("Entdecken: Foto öffnet Vollbild mit allen Fotos, ohne Sichern", async () => {
  await seed();
  await rp(`(function(){ var u = PHC.ph_a, u2 = PHC.ph_b; var r = {key:"u_anna/r1", by:"u_anna", fname:"anna", n:"Katz Deli", c:"essen", la:40.7223, lo:-73.9874, photos:[u, u2], note:"Bestes Pastrami", cm:[], at:Date.now()};
    DC.items = [r]; DC.byKey = {}; DC.byKey[r.key] = r; DC.at = Date.now(); dcScope = "all"; openDcPage(); })()`);
  await page.waitForTimeout(300);
  await click("#dcView .dc-reel .dc-ph img");
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }), "Antippen im Feed öffnet Vollbild");
  ok(!(await visible("#dcView .dc-more")), "„mehr anzeigen“ bei kurzem Text");
  await rp(`DC.byKey["u_anna/r1"].note = "Bestes Pastrami der Stadt. Früh kommen, sonst lange Schlange – und unbedingt die Pickles probieren, die gibt es gratis dazu."; DCSIG = ""; renderDc(); true`); await page.waitForTimeout(200);
  const nh = async () => page.locator("#dcView .dc-note").evaluate(e => e.getBoundingClientRect().height);
  const h0 = await nh();
  ok(await visible("#dcView .dc-more"), "„mehr anzeigen“ fehlt bei langem Text (über 2 Zeilen)");
  ok(h0 < 45, "Eingeklappt mehr als 2 Zeilen: "+h0);
  await click("#dcView .dc-more"); await page.waitForTimeout(100);
  ok((await nh()) > h0 + 5 && (await page.locator("#dcView .dc-more").innerText()).includes("weniger"), "Text klappt nicht auf");
  await click("#dcView .dc-more"); await page.waitForTimeout(100);
  ok(Math.abs((await nh()) - h0) < 2 && (await page.locator("#dcView .dc-more").innerText()).includes("mehr anzeigen"), "Text klappt nicht wieder ein");
  await rp(`dcFull("u_anna/r1", 0); true`); await page.waitForTimeout(200);
  ok(await page.locator("#pvLayer .pv-slide").count()===2, "Nicht alle Fotos des Spots im Vollbild");
  ok(await page.locator("#pvLayer [data-act=dcvsave], #pvLayer [data-act=phsave]").count()===0, "Fotos von Freunden lassen sich herunterladen");
  ok(await page.locator("#pvLayer .pv-side [data-act=dcvcm]").count()===1, "Kommentare fehlen");
  await shot("entdecken-vollbild");
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }), "Vollbild schließt nicht");
});

await test("Entdecken: Reels-Feed mit Auswahl Reise/Ziel/Inspiration, Like, Übernehmen, Bewertungen", async () => {
  await seed();
  await rp(`window.__log = []; var mk = function(path){ var o = {collection:function(n){ return mk(path+"/"+n); }, doc:function(id){ return mk(path+"/"+id); },
      set:function(d){ window.__log.push([path, d]); return Promise.resolve(); }, delete:function(){ window.__log.push([path, "del"]); return Promise.resolve(); },
      where:function(){ return o; }, orderBy:function(){ return o; }, limit:function(){ return o; }, onSnapshot:function(){ return function(){}; },
      get:function(){ return Promise.resolve((path.indexOf("/spots/s")===0 && path.split("/").length===3) ? {exists:true, data:function(){ return {likes:4, adds:7}; }} : {docs:[], exists:false, data:function(){ return {}; }}); }};
      return o; };
    fbDb = Object.assign(mk(""), {batch:function(){ var ops = []; return {set:function(r, d){ ops.push(function(){ return r.set(d); }); }, delete:function(r){ ops.push(function(){ return r.delete(); }); }, commit:function(){ ops.forEach(function(f){ f(); }); return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }});
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; FR.friends = [{uid:"u_anna", name:"anna"}, {uid:"u_ludwig", name:"Ludwig"}];
    var z = zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); save();
    var mk2 = function(k, by, fn, n, la, lo, rt, note, cm){ return {key:by+"/"+k, by:by, fname:fn, n:n, c:"essen", la:la, lo:lo, rating:rt, photos:k==="a" ? [PHC.ph_a, PHC.ph_b] : [], note:note||"", cm:cm||[], at:Date.now()}; };
    DC.items = [mk2("a", "u_anna", "anna", "Kiosk Zett", 40.7223, -73.9874, 1, "Bestes Pastrami", [{name:"Ludwig", text:"Stimmt!"}]), mk2("b", "u_ludwig", "Ludwig", "Kiosk Zett", 40.7224, -73.9875, 3, "Teuer, aber gut"),
      mk2("c", "u_anna", "anna", "Time Out Market", 38.7069, -9.1459, 2, "")];
    DC.byKey = {}; DC.items.forEach(function(r){ DC.byKey[r.key] = r; }); DC.at = Date.now(); dcSrc = "friends"; dcScope = "here"; PUB.items = []; openDcPage(); true`);
  await page.waitForTimeout(400);
  ok(await page.locator("#dcView .dc-reel").count()===1, "Reise-Filter zeigt nicht nur Vorschläge rund um New York");
  const fd = await page.evaluate(() => { const f = document.getElementById("dcFeed"), r = f.querySelector(".dc-reel").getBoundingClientRect(), b = f.getBoundingClientRect();
    return {snap:getComputedStyle(f).scrollSnapType, h:r.height, fh:b.height, bottom:b.bottom, vh:innerHeight}; });
  ok(fd.snap.includes("y") && fd.h >= fd.fh - 1 && fd.fh > 500, "Kein Vollbild-Feed: "+JSON.stringify(fd));
  ok(await page.evaluate(() => document.querySelector("#dcView .dc-tgt").getBoundingClientRect().right <= document.querySelector("#dcView .dc-src").getBoundingClientRect().left), "Auswahl Reise/Ziel steht nicht links");
  ok(fd.bottom <= fd.vh - 8, "Feed reicht bis an den unteren Rand: "+JSON.stringify(fd));
  ok(await page.locator("#dcView .dc-reel .dc-ph img").count()===2, "Fotos des sichtbaren Vorschlags fehlen");
  ok((await page.locator("#dcView .dc-avg").innerText()).includes("Must Have"), "Durchschnittsbewertung falsch (Outstanding + Nice ≈ Must Have)");
  await page.waitForTimeout(300);
  ok((await page.locator("#dcView .dc-like").innerText()).trim()==="4" && (await page.locator("#dcView .dc-take").innerText()).trim()==="7", "Like-/Übernahme-Zähler nicht geladen");
  await shot("entdecken-reels");
  await click("#dcView [data-act=dclike]"); await page.waitForTimeout(150);
  ok(await rp(`window.__log.some(function(x){ return (x[0].indexOf("/spots/s")===0 && x[0].slice(-11)==="/likes/u_me"); }) && window.__log.some(function(x){ return (x[0].indexOf("/spots/s")===0 && x[0].split("/").length===3) && x[1].likes; })`), "Like nicht gespeichert");
  ok(await page.locator("#dcView .dc-like.on").count()===1 && (await page.locator("#dcView .dc-like").innerText()).trim()==="5", "Like nicht angezeigt");
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(T().places).some(function(k){ var p = T().places[k]; return p.n==="Kiosk Zett" && p.rec; })`), "Nicht in die Wunschliste der Reise übernommen");
  ok(await rp(`window.__log.some(function(x){ return (x[0].slice(-10)==="/adds/u_me"); })`) && (await page.locator("#dcView .dc-take").innerText()).trim()==="8", "Übernahme nicht gezählt");
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(150);
  ok(await rp(`!Object.keys(T().places).some(function(k){ return T().places[k].n==="Kiosk Zett"; })`) && (await page.locator("#dcView .dc-take").innerText()).trim()==="7", "Erneutes Tippen nimmt die Übernahme nicht zurück");
  ok(await rp(`window.__log.some(function(x){ return x[0].slice(-10)==="/adds/u_me" && x[1]==="del"; })`), "Übernahme-Merker nicht gelöscht");
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(T().places).some(function(k){ return T().places[k].n==="Kiosk Zett"; })`), "Zweites Übernehmen klappt nicht");
  await rp(`var k = Object.keys(T().places).filter(function(k){ return T().places[k].n==="Kiosk Zett"; })[0]; T().order[days()[1].key] = (T().order[days()[1].key]||[]).concat([k]); $("toast").hidden = true; true`);
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(T().places).some(function(k){ return T().places[k].n==="Kiosk Zett"; })`) && (await page.locator("#toast").innerText()).includes("eingeplant"), "Eingeplanter Ort wird ohne Rückfrage entfernt");
  await click("#dcView .dc-avg");
  const rt = await page.locator("#catPop .dc-rpop").innerText();
  ok(rt.includes("@anna") && rt.includes("@Ludwig") && rt.includes("Outstanding") && rt.includes("Nice") && rt.includes("Stimmt!") && rt.includes("Teuer"), "Einzelbewertungen/Kommentare fehlen: "+rt);
  await shot("entdecken-bewertungen");
  await rp(`closeCatPop(); $("toast").hidden = true; true`);
  await click("#dcView [data-act=dctgt]");
  ok((await page.locator("#jpMenu").innerText()).includes("Inspiration") && await page.locator("#jpMenu [data-act=scopepop][data-k=z]").count()===1, "Auswahl ohne Inspiration oder Ziele-Knopf");
  await click("#jpMenu [data-act=scopepop][data-k=z]");
  await page.locator("#catPop [data-act=scopeset]", {hasText:"Lissabon"}).click(); await page.waitForTimeout(250);
  ok((await page.locator("#dcView .dc-reel").innerText()).includes("Time Out") && await page.locator("#dcView .dc-reel").count()===1, "Ziel-Filter greift nicht");
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(S.trips[zielIds()[0]].places).some(function(k){ return S.trips[zielIds()[0]].places[k].n==="Time Out Market"; })`), "Nicht ins gewählte Ziel übernommen");
  await rp(`$("toast").hidden = true; true`);
  await click("#dcView [data-act=dctgt]");
  await page.locator("#jpMenu [data-act=dcscopeset][data-v=all]").click(); await page.waitForTimeout(250);
  ok(await page.locator("#dcView .dc-reel").count()===2 && (await page.locator("#dcView .dc-tgt").innerText()).includes("Inspiration"), "Inspiration zeigt nicht alle Vorschläge");
  await rp(`document.getElementById("dcFeed").scrollTop = document.getElementById("dcFeed").clientHeight; true`); await page.waitForTimeout(300);
  ok(await rp(`DCI===1`), "Feed rastet nicht auf den nächsten Vorschlag");
  await rp(`dcSrc = "all"; DCSIG = ""; renderDc(); true`); await page.waitForTimeout(200);
  await page.locator("#dcView [data-act=dcdemo]").scrollIntoViewIfNeeded(); await click("#dcView [data-act=dcdemo]"); await page.waitForTimeout(250);
  ok(await page.locator("#dcView .dc-reel .dc-demo").count() >= 10, "Beispiel-Vorschläge fehlen oder sind nicht markiert");
  await rp(`window.__log = []; document.getElementById("dcFeed").scrollTop = 0; true`); await page.waitForTimeout(250);
  const dk = await rp(`DCL.filter(function(r){ return r.demo; })[0].key`);
  await page.locator("#dcView .dc-reel[data-k='"+dk+"'] [data-act=dclike]").click(); await page.waitForTimeout(150);
  ok(await rp(`window.__log.length===0`), "Beispiel-Like geht an den Server");
  await shot("entdecken-beispiele");
  const hl = await rp(`DCL.filter(function(r){ return r.demo && r.n==="The High Line"; })[0].key`), R = "#dcView .dc-reel[data-k='"+hl+"']";
  await page.evaluate((k) => { const el = [...document.querySelectorAll("#dcView .dc-reel")].find(e => e.getAttribute("data-k")===k); el.scrollIntoView(); }, hl); await page.waitForTimeout(400);
  ok(await page.locator(R+" .dc-more").isVisible(), "„mehr anzeigen“ fehlt, obwohl weitere Bewertungen mit Text da sind");
  await page.locator(R+" .dc-more").click(); await page.waitForTimeout(150);
  const ex = await page.locator(R+" .dc-info").innerText();
  ok(ex.includes("weniger anzeigen") && ex.includes("Schön, am Wochenende") && ex.includes("Chelsea Market"), "Aufgeklappt fehlen Texte oder „weniger anzeigen“: "+ex);
  await shot("entdecken-aufgeklappt");
  await page.locator(R+" .dc-more").click(); await page.waitForTimeout(150);
  ok((await page.locator(R+" .dc-more").innerText()).includes("mehr anzeigen"), "Einklappen klappt nicht");
  await rp(`lsSet("rp-dcdemo", "0"); true`);
  await rp(`fbDb = null; dcScope = "here"; closeDcPage(); true`);
});

await test("Symbole: gleiche Funktion = gleiches Symbol (Schicken, Karte, Merken), keine Emojis in Menüs", async () => {
  await seed();
  const IC = await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; FR.friends = [{uid:"u_anna", name:"anna"}]; IC`);
  const norm = (s) => page.evaluate((h) => { const d = document.createElement("div"); d.innerHTML = "<svg>"+h+"</svg>"; return d.firstChild.innerHTML; }, s);
  const svgOf = (sel) => page.evaluate((q) => { const e = document.querySelector(q+" svg"); return e ? e.innerHTML : null; }, sel);
  const emo = (sel) => page.evaluate((q) => { const e = document.querySelector(q); return e ? (e.textContent.match(/\p{Extended_Pictographic}/gu) || []).join("") : "fehlt"; }, sel);
  const SEND = await norm(IC.send), MAP = await norm(IC.map);
  // Entdecken „⋯“
  await rp(`var r = {key:"u_anna/x", by:"u_anna", fname:"anna", n:"Kiosk", c:"essen", la:40.72, lo:-73.98, rating:1, photos:[], note:"", cm:[], also:[], at:Date.now()};
    DC.byKey[r.key] = r; dcMore(r.key, document.querySelector(".tabbar button")); true`);
  ok(await svgOf("#jpMenu [data-act=dcsend]")===SEND, "Entdecken: „Im Chat schicken“ ohne Papierflieger");
  ok(await svgOf("#jpMenu [data-act=dcmap]")===MAP, "Entdecken: „Auf der Karte zeigen“ ohne Karten-Symbol");
  ok(await emo("#jpMenu")==="", "Emoji im Entdecken-Menü: "+await emo("#jpMenu"));
  await shot("symbole-entdecken-menue");
  await rp(`closeJpMore(); true`);
  // Ort „⋯“
  await rp(`var id = Object.keys(T().places).filter(function(k){ var p = P(k); return hasLoc(p) && p.k!=="hotel"; })[0]; openJpMore(id, document.querySelector(".tabbar button")); true`);
  ok(await svgOf("#jpMenu [data-act=chshare]")===SEND && (await page.locator("#jpMenu [data-act=chshare]").innerText()).includes("Im Chat schicken"), "Ort: „Im Chat schicken“ uneinheitlich");
  ok(await emo("#jpMenu")==="", "Emoji im Ort-Menü: "+await emo("#jpMenu"));
  await shot("symbole-ort-menue");
  // Foto-Vollbild und Entdecken-Leiste nutzen dieselben Symbole
  ok(await rp(`var h = dcSideHTML(DC.byKey["u_anna/x"]); h.indexOf(IC.like) > -1 && h.indexOf(IC.save) > -1 && h.indexOf(IC.comment) > -1 && h.indexOf(IC.more) > -1`), "Entdecken-Leiste nutzt nicht die zentralen Symbole");
  await rp(`closeJpMore(); openLsPage(); true`); await page.waitForTimeout(250);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("#lsView [data-act=lstab]")].map(b => { const s = b.querySelector("svg"); return s ? s.innerHTML : ""; }));
  ok(tabs.length===3 && tabs[0]===await norm(IC.pin) && tabs[1]===await norm(IC.star) && tabs[2]===await norm(IC.camera), "Liste: Umschalter Orte/Highlights/Fotos ohne passende Symbole");
  ok(await page.evaluate(() => [...document.querySelectorAll("#lsView [data-act=lstab]")].every(b => b.scrollWidth <= b.clientWidth + 1)), "Liste: Umschalter-Text abgeschnitten");
  await shot("symbole-liste-umschalter");
  await rp(`closeLsPage(); true`);
  ok(await rp(`[MAPICO, MAPGO].every(function(s){ return s===ic("map"); }) && visIco("pub")===ic("friends") && visIco("all")===ic("globe") && visIco("trip")===ic("trip")`), "Karten-/Sichtbarkeits-Symbole uneinheitlich");
});

await test("App-Demo: Einstieg mit Ziel und Nutzen, Kapitel, alle Schritte durchklickbar", async () => {
  await seed();
  await rp(`openDemo("trav")`); await page.waitForTimeout(200);
  ok(await visible("#demo .dm-role"), "Rollenauswahl oben fehlt");
  ok(await page.locator("#demo .m-bar .bi svg").count() >= 6, "Symbole in der Leiste fehlen");
  // Einstieg: erst Ziel und Nutzen (Kapitel „Willkommen“ mit eigenen Bildschirmen), dann die Bedienung
  const intro = await rp(`DM_ROLES.trav.filter(function(s){ return s.ch==="start"; }).map(function(s){ return s.s; })`);
  ok(intro.join()==="hero,why,pillars", "Einstieg zeigt nicht Ziel und Nutzen: "+intro);
  ok(await visible("#demo .ms[data-sc=hero].cur") && (await page.locator("#demo .dm-ey").innerText()).includes("WILLKOMMEN"), "Willkommens-Bildschirm fehlt");
  const chs = await rp(`dmChapters().map(function(c){ return c.c; })`);
  ok(chs.join()==="start,plan,go,share,comm,end", "Kapitel der Reisenden-Demo: "+chs);
  ok(await page.locator("#demo .dm-prog button").count()===chs.length, "Fortschritt zeigt nicht je Kapitel einen Abschnitt");
  await page.locator("#demo .dm-prog button").nth(4).click(); await page.waitForTimeout(80);
  ok(await rp(`DM_STEPS_NOW()[dmI].ch`)==="comm" && await rp(`DM_STEPS_NOW()[dmI-1].ch`)==="share", "Tipp auf Kapitel springt nicht zum Kapitelanfang");
  await rp(`dmShow(0)`);
  const nT = await rp(`DM_STEPS_NOW().length`), seen = new Set();
  for(let i = 0; i < nT - 1; i++){
    const s = await page.locator("#demo .dm-mock").getAttribute("data-s"); seen.add(s);
    if(s && await page.locator("#demo .ms[data-sc='"+s+"']").count()) ok(await visible("#demo .ms[data-sc='"+s+"'].cur"), "Bildschirm nicht sichtbar: "+s);
    await page.locator("#demo .dm-next").click(); await page.waitForTimeout(40);
  }
  ["hero","why","pillars","trips","opt","stay","card","tk","lay","bike","off","photo","comment","vis","send","chat","recap","share","reels","insp","fol","grp","prof"].forEach(x => ok(seen.has(x), "Reisende-Demo zeigt Bildschirm nicht: "+x));
  ok((await page.locator("#demo .dm-next").innerText()).includes("Los"), "Letzter Schritt ohne „Los geht’s“");
  await page.locator("#demo .dm-role [data-r=obs]").click(); await page.waitForTimeout(150);
  const nO = await rp(`DM_STEPS_NOW().length`);
  ok(nO !== nT && await rp(`dmI`)===0, "Beobachter-Demo startet nicht von vorn");
  ok(await page.locator("#demo .dm-role [data-r=obs][aria-selected=true]").count()===1, "Rollenauswahl nicht markiert");
  for(let i = 0; i < nO - 1; i++){ await page.locator("#demo .dm-next").click(); await page.waitForTimeout(40); }
  await rp(`dmShow(DM_STEPS_NOW().findIndex(function(s){ return s.s==="photo"; }))`);
  ok(!(await visible("#demo .ms-more")), "Beobachter-Demo zeigt ⋯ (Herunterladen/Löschen)");
  await rp(`dmShow(DM_STEPS_NOW().length-1)`); await page.locator("#demo .dm-next").click(); await page.waitForTimeout(150);
  ok(await page.locator("#demo").count()===0, "Demo schließt am Ende nicht");
});

await test("App-Demo: jeder Schritt zeigt auf ein echtes Bedienelement („In der App zeigen“)", async () => {
  await seed();
  await rp(`ntBadge(); openProfile(); true`); await page.waitForTimeout(150);
  for(const role of ["trav", "obs"]){
    await rp(`openDemo("${role}")`); await page.waitForTimeout(120);
    const L = await rp(`DM_STEPS_NOW().map(function(s){ return {ch:s.ch, t:s.t, real:s.real||null}; })`);
    for(let i = 0; i < L.length; i++){
      const st = L[i];
      if(st.ch==="start") continue;
      ok(st.real && st.real.el, role+": Schritt ohne echtes Bedienelement: "+st.t);
      await rp(`dmShow(${i})`);
      ok(await visible("#demo .dm-real"), role+": „In der App zeigen“ fehlt: "+st.t);
      await page.locator("#demo .dm-real").click(); await page.waitForTimeout(260);
      ok(await page.locator("#dmSpot").count()===1, role+": Element nicht gefunden für „"+st.t+"“: "+st.real.el);
      const r = await page.evaluate(sel => { const e = document.querySelector(sel); if(!e) return null; const b = e.getBoundingClientRect(); return {w:b.width, h:b.height, l:b.left, t:b.top, r:b.right, b:b.bottom}; }, st.real.el);
      ok(r && r.w > 0 && r.h > 0 && r.b > 0 && r.t < 844 && r.r > 0 && r.l < 390, role+": Element nicht im Bild für „"+st.t+"“: "+JSON.stringify(r));
      ok(await page.locator("#demo").isHidden(), role+": Demo verdeckt das Element");
      ok(await insideViewport("#dmSpot .dm-tip"), role+": Hinweis „Zurück zur Demo“ nicht im Bild bei „"+st.t+"“");
      await page.locator("#dmSpot .dm-tip button").click(); await page.waitForTimeout(160);
      ok(await page.locator("#dmSpot").count()===0 && await visible("#demo .dm-card"), role+": Zurück zur Demo klappt nicht bei „"+st.t+"“");
      ok(await rp(`dmI`)===i, role+": Demo steht nach dem Zurückkehren nicht am selben Schritt");
      ok(await rp(`profOpen && !jp && $("layers").hidden && $("acctPop").hidden && $("tripMenu").hidden && tab==="day"`), role+": Vorherige Ansicht nicht wiederhergestellt nach „"+st.t+"“");
    }
    await rp(`closeDemo()`);
  }
});

await test("App-Demo quer: Mini-Handy links, Text rechts, nichts überlappt", async () => {
  await seed();
  await rp(`openDemo("trav"); dmShow(4); true`);
  await page.waitForFunction(() => [".dm-card", ".dm-stage"].every(s => !document.querySelector("#demo "+s).getAnimations().length), null, {polling:100, timeout:15000});   // Einblenden/Hereingleiten fertig
  ok(await insideViewport("#demo .dm-card"), "Demo-Fenster ragt quer aus dem Bild");
  const g = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const m = r("#demo .dm-mock"), t = r("#demo .dm-txt"), n = r("#demo .dm-nav"); return {m, t, n}; });
  ok(g.m.right <= g.t.left + 1 && g.m.right <= g.n.left + 1, "Mini-Handy überlappt Text oder Navigation: "+JSON.stringify(g));
  ok(g.m.bottom <= 390 && g.n.bottom <= 390, "Mini-Handy oder Navigation unten abgeschnitten");
  await shot("demo-quer");
}, {vp:{width:844, height:390}});

await test("App-Demo: Mini-Bildschirme entsprechen den echten Ansichten", async () => {
  await seed();
  await rp(`openDemo("trav")`); await page.waitForTimeout(150);
  const mock = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim()), sel);
  // Ort-Karte: dieselben Kacheln wie die echte Karte eines Wunschorts
  const mt = await mock("#demo .ms-card .mc-t > span");
  await rp(`closeDemo(); select("p6"); true`); await page.waitForTimeout(250);
  const rt = await page.evaluate(() => [...document.querySelectorAll("#card .jp-tile")].map(e => e.innerText.trim()));
  ok(mt.join("|")===rt.join("|"), "Ort-Karte in der Demo: "+mt.join("|")+" statt "+rt.join("|"));
  // Foto-Vollbild: gleiche Knöpfe links wie die echte Ansicht (mit Likes/Kommentaren)
  await rp(`sel = null; renderCard(); phSocial = function(){ return true; }; openJPop("p4", dayOf("p4"), "ph_a"); true`); await page.waitForTimeout(350);
  const pv = await page.evaluate(() => [...document.querySelectorAll("#pvLayer .pv-side .pvi")].map(e => e.getAttribute("data-act")));
  ok(pv.join()==="phlike,pvcm,phmap,itemvispick,phsend,phmore", "Echte Foto-Knöpfe haben sich geändert: "+pv);
  await rp(`closeJPop(); openDemo("trav"); true`); await page.waitForTimeout(150);
  ok(await page.locator("#demo .ms-side .ms-b").count()===pv.length, "Foto-Knöpfe in der Demo passen nicht zur App");
  // Sichtbarkeit: alle vier Stufen
  const vis = await mock("#demo .ms-vispop p b");
  ok(vis.join()===await rp(`[VISLBL.priv, VISLBL.trip, VISLBL.pub, VISLBL.all].join()`), "Sichtbarkeitsstufen in der Demo: "+vis);
  // Reise-Status wie in der App
  const stt = await mock("#demo .mzt-menu em");
  ok(stt.join()===await rp(`[TSTAT.now, TSTAT.plan, TSTAT.opt, TSTAT.done].join()`), "Reise-Status in der Demo: "+stt);
  const pst = await mock("#demo .mzq-tiles em");
  ok(pst.join()===stt.join(), "Status-Plaketten im Profil der Demo: "+pst);
  // Entdecken: vier Knöpfe rechts wie im echten Feed
  ok(await page.locator("#demo .ms[data-sc=reels] .mzr-c").first().locator(".mzr-side > span").count()===await rp(`(dcSideHTML(dcDemo()[0]).match(/class="dc-sb/g)||[]).length`), "Entdecken-Knöpfe in der Demo passen nicht zum Feed");
  // Bezeichnungen aus der Demo, die es in der App (außerhalb der Demo) geben muss
  const src = await page.evaluate(() => { const s = [...document.scripts].map(x => x.textContent).join("\n"), a = s.indexOf("/* ---------- App-Demo"), b = s.indexOf("// Neues Konto (höchstens"); return s.slice(0, a)+s.slice(b); });
  for(const w of ["Gruppen", "Anfragen zum Folgen", "Annehmen", "Ticket hinterlegen", "Tickets in der App buchen", "Noch nicht verfügbar", "Als Hotel der Reise übernehmen", "Unterkünfte", "Offline verfügbar", "Bike Share", "Metro / U-Bahn", "Tram", "Seilbahnen", "Navigieren", "So geht’s", "Aktualisieren", "Inspiration – aus aller Welt", "Noch nicht fest? Ohne Termin anlegen", "Neue Reise anlegen", "Beobachtet", "Follower", "Gefolgt", "Zur Planung"])
    ok(src.includes(w) || (await page.evaluate(() => document.body.innerHTML)).includes(w), "Begriff aus der Demo gibt es in der App nicht: "+w);
  await rp(`closeDemo()`);
});

await test("Profil: Reise über ⋯ abschließen und wieder öffnen (vor dem Enddatum, bleibt bearbeitbar)", async () => {
  await seed();
  await rp(`(function(){ S.trips.t_mal = newTripObj({id:"t_mal", name:"Mallorca", start:"2027-05-01", end:"2027-05-05"}); PROF = {name:"tester"}; save(); openProfile(); })()`);
  await page.waitForTimeout(300);
  ok(await rp(`tripStatus(T())`)==="now", "Ausgangslage: Testreise nicht aktuell");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  ok((await page.locator("#jpMenu [data-act=pffin]").innerText()).includes("Reise abschließen"), "„Reise abschließen“ fehlt im ⋯-Menü");
  await shot("reise-abschliessen-menue");
  await click("#jpMenu [data-act=pffin]");
  ok(await rp(`T().fin===1 && tripStatus(T())==="done" && TSTAT[tripStatus(T())]==="Abgeschlossen"`), "Reise nicht abgeschlossen");
  ok(await rp(`scopePast("map").indexOf("t_test") > -1 && scopeNow("map").indexOf("t_test") < 0`), "Abgeschlossene Reise steht nicht unter „Vergangene Reisen“");
  ok(await rp(`T().start <= todayKey() && T().end >= todayKey()`), "Zeitraum wurde verändert");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  ok(await page.locator("#jpMenu [data-act=pfedit]").count()===1, "Abgeschlossene Reise nicht mehr bearbeitbar");
  ok((await page.locator("#jpMenu [data-act=pffin]").innerText()).includes("Wieder öffnen"), "„Wieder öffnen“ fehlt");
  await click("#jpMenu [data-act=pffin]");
  ok(await rp(`!T().fin && tripStatus(T())==="now"`), "Wieder öffnen klappt nicht");
  // Reise mit vergangenem Enddatum: kein „abschließen“ nötig
  await rp(`S.trips.t_alt = newTripObj({id:"t_alt", name:"Alt", start:"2020-05-01", end:"2020-05-05"}); save(); renderProfile(); true`); await page.waitForTimeout(200);
  await page.locator("#profView [data-act=pfmore][data-trip=t_alt]").click();
  ok(await page.locator("#jpMenu [data-act=pffin]").count()===0, "Bereits abgeschlossene Reise bietet „abschließen“ an");
});

await test("Beobachtete Reisen: eigener Knopf, kein Ansicht/Bearbeiten-Umschalter, erkennbar mit Auge und Besitzer", async () => {
  await seed();
  await rp(`(function(){ var o = newTripObj({id:"t_own", name:"Eigene Reise", start:"2027-03-01", end:"2027-03-05"}); S.trips.t_own = o;
    META.t_test = {owner:"u_o", members:["u_o"], memberEmails:{}, invites:[], viewers:["u_me"], viewInvites:[]}; OWNN.u_o = "ferdinand";
    T().fin = 1; renderAll(); return true; })()`); await page.waitForTimeout(150);
  ok(await rp(`isViewer() && !ownTrip() && finRow()===""`), "Beobachter gilt als eigene Reise");
  ok(await rp(`finJ() && $("tabDay").textContent==="Tagebuch" && $("sheetOpen").textContent.trim()==="Tagebuch"`), "Beobachter einer abgeschlossenen Reise sieht nicht „Tagebuch“");
  ok(await page.locator("#body ol.plan").count()===0 && await page.locator("#body .rhead").count()===0, "Beobachter sieht Stopps statt nur Tagebuch");
  await click("#tripBtn"); await page.waitForTimeout(150);
  ok(await page.locator("#tripMenu .tm-mode").count()===0, "Umschalter Ansicht/Bearbeiten für Beobachter sichtbar");
  const top = await page.locator("#tripMenu .tm-cur").innerText();
  ok(await page.locator("#tripMenu .tm-cur.tm-obs svg").count()===1 && top.includes("Beobachtet · von @ferdinand"), "Gewählte beobachtete Reise nicht erkennbar: "+top);
  ok(await page.locator("#tripBtn .tb-obs svg").isVisible(), "Reise-Knopf zeigt kein Auge für beobachtete Reise");
  await shot("beobachtet-menue");
  ok(await page.locator("#tripMenu [data-act=scopepop][data-k=obs]").count()===1, "Knopf „Beobachtete Reisen“ fehlt");
  ok(await page.locator("#tripMenu [data-act=scopepop][data-k=past]").count()===0, "Beobachtete Reise zählt bei „Vergangene Reisen“");
  // zur eigenen Reise wechseln: beobachtete steht nicht zwischen den eigenen, nur hinter dem Knopf
  await click("#tripMenu [data-act=trip][data-trip=t_own]"); await page.waitForTimeout(200);
  ok(await rp(`S.cur==="t_own" && !isViewer() && ownTrip()`), "Wechsel zur eigenen Reise klappt nicht");
  await click("#tripBtn"); await page.waitForTimeout(150);
  ok(await page.locator("#tripMenu .tm-mode").count()===1 && await page.locator("#tripMenu .tm-obs").count()===0, "Eigene Reise sieht aus wie beobachtete");
  ok(await page.locator("#tripMenu [data-act=trip][data-trip=t_test]").count()===0, "Beobachtete Reise steht zwischen den eigenen");
  await click("#tripMenu [data-act=scopepop][data-k=obs]"); await page.waitForTimeout(150);
  ok((await page.locator("#catPop .scpop h4").innerText()).includes("Beobachtete Reisen"), "Pop-up „Beobachtete Reisen“ fehlt");
  ok((await page.locator("#catPop [data-act=scopeset][data-v=t_test]").innerText()).includes("von @ferdinand"), "Besitzer fehlt im Pop-up");
  await click("#catPop [data-act=scopeset][data-v=t_test]"); await page.waitForTimeout(200);
  ok(await rp(`S.cur==="t_test" && isViewer()`), "Auswahl der beobachteten Reise klappt nicht");
  // Rollen kommen später vom Server: Menü und Leseschutz müssen sich anpassen
  await rp(`META.t_own = {owner:"u_x", members:["u_x"], memberEmails:{}, invites:[], viewers:["u_me"], viewInvites:[]}; S.cur = "t_own"; renderAll(); delete META.t_own; metaSig = ""; true`);
  ok(await rp(`acctApply.toString().indexOf("metaSig = ms; renderAll()") > -1`), "Rollenänderung baut Reise-Menü nicht neu");
  // Entdecken: eigener Knopf auch dort
  await rp(`S.cur = "t_own"; renderAll(); true`);
  ok(await rp(`scopeBtns("dc").indexOf("data-k=\\"obs\\"") > -1 && scopeNow("dc").indexOf("t_test") < 0`), "Entdecken trennt beobachtete Reisen nicht");
});
await test("Beobachter-Ansicht: abgeschlossene beobachtete Reise wie eigene Ansicht (Tagebuch, Details, ×, Kommentare, Alle Tage, Filter, Blatt halbhoch)", async () => {
  await seed();
  await rp(`META.t_test = {owner:"u_o", members:["u_o"], memberEmails:{}, invites:[], viewers:["u_me"], viewInvites:[]}; OWNN.u_o = "ferdinand"; KNOWN.t_test = 1; T().fin = 1; renderAll(); true`); await page.waitForTimeout(200);
  ok(await rp(`isViewer() && isRO() && finJ() && document.body.classList.contains("ro")`), "Beobachter nicht in der Ansicht");
  ok(await rp(`$("sheetOpen").textContent.trim()==="Tagebuch" && $("tabDay").textContent==="Tagebuch"`), "Beobachter: Knopf/Reiter heißen nicht „Tagebuch“");
  ok(await page.locator("#body ol.plan").count()===0 && await page.locator("#body .rhead").count()===0, "Beobachter: Stopps sichtbar");
  await rp(`cur = Object.keys(T().order).filter(function(k){ return (T().order[k]||[]).some(function(x){ return T().done[x]; }); })[0]; renderSheet(); true`);
  ok(await page.locator("#body .jcard").count() > 0 && await page.locator("#body .jc-t.empty").count()===0, "Beobachter: Tagebuch fehlt oder zeigt Notiz-Hinweis");
  ok(await page.locator("#tabWish").isHidden(), "Beobachter: Wunschliste sichtbar");
  // Details-Knopf, × und Kommentare
  await rp(`sel = "p4"; renderCard(); true`); await page.waitForTimeout(200);
  ok(await page.locator("#card [data-act=jpedit]").isVisible(), "Beobachter: Knopf „Details“ fehlt");
  await click("#card [data-act=jpedit]");
  ok(await rp(`!!jp && jp.pid==="p4"`), "Beobachter: „Details“ öffnet nicht");
  ok(await page.locator("#jPop .jp-wrap > .ag-x").isVisible(), "Beobachter: × am Detail-Fenster fehlt");
  ok(await page.locator("#jPop #cmIn").count()===1, "Beobachter: Kommentarfeld fehlt");
  ok(await rp(`!$("jPop").querySelector("textarea#nText:not([readonly])")`), "Beobachter: Notiz bearbeitbar");
  ok(await page.locator("#jPop .vis-ro, #jPop [data-act=vis]").count()===0, "Beobachter sieht Sichtbarkeit (bewusst nur Besitzer/Mitreisende)");
  await click("#jPop .jp-wrap > .ag-x"); ok(await rp(`!jp`), "Beobachter: × schließt nicht");
  await rp(`sel = null; renderCard(); setSheet("min"); true`); await page.waitForTimeout(300);
  await click("#sheetOpen"); await page.waitForTimeout(400);
  ok(await rp(`sheetState==="mid"`), "Beobachter: Knopf unten öffnet nicht halbhoch");
  // Alle Tage und Filter „Alle Orte der Reise“
  await click("#rail [data-act=daypop]");
  ok(await visible("#catPop .dayall"), "Beobachter: „Alle Tage anzeigen“ fehlt");
  await click("#catPop .dayall"); ok(await rp(`allOn()`), "Beobachter: Gesamtansicht nicht aktiv");
  ok(await rp(`$("body").querySelectorAll(".adj .jcard").length > 0`), "Beobachter: Tagebuch aller Tage fehlt");
  await click("#layersBtn");
  ok(await visible("#lAllP"), "Beobachter: Filter „Alle Orte der Reise“ fehlt");
  // Bezirk-Karte: keine Wünsche/Wunschliste in der Ansicht
  await rp(`closeMenus(); sel = "nb:"+NB[0].n; renderCard(); true`); await page.waitForTimeout(150);
  ok(await rp(`var c = $("card").textContent; c.indexOf("Wunschliste")<0 && !$("card").querySelector("[data-act=nbshow]") && !!$("card").querySelector("[data-act=nbtoggle]")`), "Bezirk zeigt Wünsche/Wunschliste in der Ansicht");
  await rp(`sel = null; renderCard(); true`);
  // 3D: Beobachter wird nicht mehr zwangsweise gekippt, gleiche Regeln wie alle (Knopf ab Zoom 15)
  ok(await rp(`applyRO.toString().indexOf("rp-vdef-") < 0`), "Beobachter-Sonderweg für 3D noch aktiv");
});
await test("Abgeschlossene Reise: Ansicht wie Beobachter, „Reise bearbeiten“ öffnet die volle Planung", async () => {
  await seed();
  ok(await rp(`!isRO() && !document.body.classList.contains("ro") && tripMode()==="edit"`), "Laufende Reise startet nicht im Bearbeitungsmodus");
  await rp(`T().fin = 1; save(); renderAll(); true`); await page.waitForTimeout(200);
  ok(await rp(`isRO() && finRO() && !isViewer() && document.body.classList.contains("ro")`), "Abgeschlossene Reise nicht in der Beobachter-Ansicht");
  ok(await page.locator("#body .finbar").count()===0, "Leiste „Reise bearbeiten“ steht noch im Tagesplan");
  ok(await page.locator("#body [data-act=done]:visible").count()===0, "Abhaken in der Ansicht sichtbar");
  ok(await page.locator("#body ol.plan").count()===0 && await page.locator("#body .rhead").count()===0, "Stopps im Ansichtsmodus sichtbar (nur Tagebuch gewünscht)");
  await rp(`cur = Object.keys(T().order).filter(function(k){ return (T().order[k]||[]).some(function(x){ return T().done[x]; }); })[0]; renderSheet(); true`);
  ok(await page.locator("#body .jcard").count() > 0, "Tagebuch fehlt im Ansichtsmodus");
  ok(await page.locator("#body .jc-t.empty").count()===0, "Hinweis „Tippen, um Notizen … hinzuzufügen“ im Ansichtsmodus");
  ok(await page.locator("#body [data-act=rtoggle]").count()===0, "Routen-Schalter in der Ansicht sichtbar");
  ok(await page.locator("#tabWish").isHidden(), "Wunschliste in der Ansicht sichtbar");
  // Ort-Karte im Ansichtsmodus: Knopf „Details“ bleibt, öffnet das Detail-Fenster
  await rp(`sel = "p4"; renderCard(); true`); await page.waitForTimeout(200);
  ok(await page.locator("#card [data-act=jpedit]").isVisible(), "Knopf „Details“ fehlt im Ansichtsmodus");
  await click("#card [data-act=jpedit]");
  ok(await rp(`!!jp && jp.pid==="p4"`), "„Details“ öffnet im Ansichtsmodus nicht");
  ok(await rp(`!$("jPop").querySelector("textarea#nText:not([readonly])")`), "Notiz im Ansichtsmodus bearbeitbar");
  // × bleibt beim Scrollen sichtbar
  await rp(`var c = $("jPop").querySelector(".ag-card"); c.style.maxHeight = "320px"; c.scrollTop = c.scrollHeight; true`); await page.waitForTimeout(150);
  ok(await rp(`var c = $("jPop").querySelector(".ag-card"), x = $("jPop").querySelector(".ag-x").getBoundingClientRect(), r = c.getBoundingClientRect(); c.scrollTop > 0 && x.top < r.top && x.bottom > r.top && x.right > r.right && x.left < r.right && x.top >= 0 && x.right <= innerWidth`), "× sitzt nicht fest halb über der oberen rechten Ecke");
  await shot("detail-x");
  await click("#jPop .ag-x"); ok(await rp(`!jp`), "× schließt das Detail-Fenster nicht");
  await rp(`sel = null; renderCard(); true`);
  // Ort-Detail im Ansichtsmodus: Sichtbarkeit nur anzeigen, leere Notiz kompakt
  await rp(`T().notes = {p5:"Toller Blick"}; openJPop("p4", dayOf("p4")); true`); await page.waitForTimeout(250);
  ok(await page.locator("#jPop .jp-lbl .vis-ro").count() > 0 && await page.locator("#jPop [data-act=vis]").count()===0, "Sichtbarkeit im Ansichtsmodus nicht (nur lesend) zu sehen");
  ok(await page.locator("#jPop textarea#nText").count()===0 && await page.locator("#jPop .jp-nonote").isVisible(), "Leere Notiz im Ansichtsmodus nicht kompakt");
  ok(await page.locator("#jPop .jp-strip [data-act=phview]").count() > 0, "Fotos fehlen");
  await shot("abgeschlossen-ort");
  await rp(`closeJPop(); openJPop("p5", dayOf("p5")); true`); await page.waitForTimeout(250);
  ok(await page.locator("#jPop textarea#nText[readonly]").count()===1 && await page.locator("#jPop .jp-lbl .vis-ro").count()===2, "Notiz-Sichtbarkeit im Ansichtsmodus fehlt");
  await rp(`closeJPop(); true`);
  ok(await rp(`$("sheetOpen").textContent.trim()==="Tagebuch" && $("tabDay").textContent==="Tagebuch"`), "Knopf unten/Reiter heißen im Ansichtsmodus nicht „Tagebuch“");
  // Knopf unten öffnet das Blatt direkt halbhoch
  await rp(`setSheet("min"); true`); await page.waitForTimeout(300);
  await click("#sheetOpen"); await page.waitForTimeout(400);
  ok(await rp(`sheetState==="mid"`), "Knopf unten öffnet das Blatt nicht halbhoch: "+await rp(`sheetState`));
  await click("#tripBtn");
  ok(await rp(`var m = $("tripMenu"), a = m.children[0], b = m.children[1]; a.classList.contains("tm-cur") && a.getAttribute("aria-current")==="true" && a.textContent.indexOf("Testreise") > -1 && a.textContent.indexOf("✓") > -1 && b.classList.contains("tm-mode")`), "Gewählte Reise (mit Haken) nicht oben, Umschalter nicht direkt darunter");
  ok(await rp(`$("tripMenu").querySelector("[data-act=tripmode][data-v=view]").getAttribute("aria-pressed")==="true"`) && await page.locator("#tripMenu [data-act=tripedit]").count()===0, "Umschalter zeigt nicht „Ansicht“");
  ok(await page.locator("#tripMenu .sc-b.on").count()===0, "„Vergangene Reisen“ ist noch hervorgehoben");
  await shot("abgeschlossen-ansicht");
  // Bearbeiten: volle Ansicht wie bei aktiven Reisen
  await click("#tripMenu [data-act=tripmode][data-v=edit]");
  ok(await rp(`!isRO() && tripMode()==="edit" && !document.body.classList.contains("ro")`), "Bearbeiten öffnet nicht die volle Ansicht");
  // nach dem Wechsel bleibt die Kopfzeile bedienbar: Liste öffnen und zurück zur Karte
  await page.locator("[data-act=navlist]").first().click({timeout:3000}); await page.waitForTimeout(250);
  ok(await rp(`lsPage && !$("lsView").hidden`), "Liste lässt sich nach dem Wechsel in den Bearbeitungsmodus nicht öffnen");
  await page.locator("[data-act=navmap]").first().click({timeout:3000}).catch(() => {}); await rp(`closeLsPage && closeLsPage(); true`);
  // Wechsel aus dem Reise-Fenster: Fenster schließt, Kopfzeile bleibt bedienbar
  await rp(`setTripMode("view"); tab = "trip"; renderAll(); true`); await page.waitForTimeout(300);
  await click("#tripPop [data-act=finedit]"); await page.waitForTimeout(300);
  ok(await rp(`tab!=="trip" && $("tripPop").hidden && tripMode()==="edit"`), "Reise-Fenster bleibt nach dem Wechsel offen");
  ok(await page.evaluate(() => { const b = document.querySelector("[data-act=navlist]"), q = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(q.x+q.width/2, q.y+q.height/2)); }), "Listen-Knopf nach dem Wechsel verdeckt");
  await rp(`pickDefaultDay(); renderSheet(); true`);
  ok(await page.locator("#body [data-act=rtoggle]").count()===1, "Routen-Schalter fehlt beim Bearbeiten");
  ok(await page.locator("#body ol.plan").count()===1, "Stopps fehlen beim Bearbeiten");
  ok(await page.locator("#tabWish").isVisible(), "Wunschliste fehlt beim Bearbeiten");
  ok(await rp(`$("sheetOpen").textContent.trim()==="Tagesplan & Wunschliste"`), "Knopf unten nennt beim Bearbeiten nicht die Wunschliste");
  ok(await rp(`$("tabDay").textContent==="Tagesplan"`), "Reiter heißt beim Bearbeiten nicht „Tagesplan“");
  await click("#tripBtn");
  ok(await rp(`$("tripMenu").querySelector("[data-act=tripmode][data-v=edit]").getAttribute("aria-pressed")==="true"`) && await page.locator("#tripMenu [data-act=tripedit]").count()===1, "Umschalter zeigt nicht „Bearbeiten“");
  await shot("abgeschlossen-bearbeiten");
  // Beenden: zurück zur Ansicht; andere Reise und zurück: wieder Ansicht
  await click("#tripMenu [data-act=tripmode][data-v=view]");
  ok(await rp(`isRO() && finRO()`), "Umschalter „Ansicht“ führt nicht zurück zur Ansicht");
  await rp(`setTripMode("edit"); renderAll(); true`);
  await rp(`S.trips.t_mal = newTripObj({id:"t_mal", name:"Mallorca", start:"2027-05-01", end:"2027-05-05"}); tripSwitch("t_mal"); tripSwitch("t_test"); true`);
  ok(await rp(`finRO()`), "Nach Reisewechsel bleibt die abgeschlossene Reise im Bearbeiten-Modus");
  // Liste: Moduswechsel in der Reise-Auswahl, keine Leiste
  await rp(`S.trips.t_mal.fin = 0; openLsPage(); true`); await page.waitForTimeout(200);
  ok(await page.locator("#lsView .finbar").count()===0, "Leiste „Reise bearbeiten“ steht noch in der Liste");
  await click("#lsView [data-act=lstrippick]");
  ok(await page.locator("#jpMenu .tm-mode [data-v=edit]").isVisible(), "Umschalter fehlt in der Reise-Auswahl der Liste");
  ok(await rp(`var c = $("jpMenu").querySelector(".tm-cur"); !!c && c.textContent.indexOf("Testreise") > -1 && c.compareDocumentPosition($("jpMenu").querySelector(".tm-mode")) & 4`), "Gewählte Reise steht in der Liste nicht über dem Umschalter");
  await rp(`closeJpMore(); true`);
  // aktive Reise: startet im Bearbeiten, Ansicht wählbar (ohne Tagebuch-Umbau)
  await rp(`T().fin = 0; finEd = ""; finM = ""; renderAll(); true`);
  ok(await rp(`tripMode()==="edit" && !isRO()`), "Aktive Reise startet nicht im Bearbeitungsmodus");
  await rp(`setTripMode("view"); renderAll(); true`);
  ok(await rp(`isRO() && !finJ() && $("tabDay").textContent==="Tagesplan"`) && await page.locator("#body ol.plan").count()===1, "Ansichtsmodus einer aktiven Reise falsch");
  ok(await page.locator("#jpMenu .sc-b.on").count()===0, "„Vergangene Reisen“ in der Liste noch hervorgehoben");
});

await test("Profil: Kacheln mit ⋯-Menü, Titelbild wählen, Neue Reise als Kachel", async () => {
  await seed();
  await rp(`(function(){ S.trips.t_mal = newTripObj({id:"t_mal", name:"Mallorca", start:"2027-05-01", end:"2027-05-05"}); PROF = {name:"tester"}; openProfile(); })()`);
  await page.waitForTimeout(300);
  ok(await page.locator("#profView .pf-share").count()===0, "Einladen-Symbol sitzt noch direkt auf der Kachel");
  ok(await page.locator("#profView .pf-tw .pf-more").count()===2, "⋯ fehlt auf den Kacheln");
  ok(await page.locator("#profView .pf-new").count()===1, "Neue Reise ist keine Kachel");
  ok(await page.locator("#profView .pf-cov.lt i").first().innerText()==="M", "Buchstaben-Kachel ohne Initialen");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  ok(await page.locator("#jpMenu [data-act=pfshare]").count()===1, "Mitreisende & Beobachter fehlt im ⋯-Menü");
  ok(await page.locator("#jpMenu [data-act=pfedit]").count()===1, "Reise bearbeiten fehlt im ⋯-Menü");
  ok(await page.locator("#jpMenu [data-act=pfopen]").count()===0, "„Reise öffnen“ steht noch im ⋯-Menü");
  ok(await page.locator("#jpMenu [data-act=pfcvopen]").count()===1 && await page.locator("#jpMenu [data-act=pfcover]").count()===0, "Titelbild nicht als ein Eintrag „Titelbild ändern“");
  await click("#jpMenu [data-act=pfcvopen]");
  ok(await page.locator("#cvPop .cv-seg [data-act=cvmode]").count()===3, "Titelbild-Pop-up ohne die drei Optionen");
  await shot("titelbild-popup");
  await click("#cvPop [data-act=cvmode][data-v=photo]");
  ok(await visible("#cvPop .cv-grid"), "Foto-Auswahl öffnet nicht");
  await page.locator("#cvPop [data-act=cvph]").last().click(); await page.waitForTimeout(200);
  ok(!!(await rp(`S.trips.t_test.cover && S.trips.t_test.cover.ph`)), "Titelbild wird nicht gespeichert");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcvopen]");
  ok(await page.locator("#cvPop .cv-grid button.on").count()===1, "Gewähltes Foto nicht markiert");
  await click("#cvPop [data-act=cvmode][data-v=letters]");
  await page.locator("#cvPop [data-act=cvcol]").nth(2).click();
  await click("#cvPop [data-act=cvletters]");
  ok(await rp(`!!(S.trips.t_test.cover && S.trips.t_test.cover.txt)`), "Buchstaben-Modus wird nicht gespeichert");
  ok(await page.locator("#profView .pf-tw:has([data-trip=t_test]) .pf-cov.lt").count()===1, "Kachel zeigt nach Buchstaben-Wahl noch ein Foto");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcvopen]");
  await click("#cvPop [data-act=cvmode][data-v=auto]");
  await click("#cvPop .cv-ok[data-act=cvauto]");
  ok(await rp(`!S.trips.t_test.cover`), "Automatisch setzt nicht zurück");
  // Mitreisende & Beobachter als eigenes Pop-up
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfshare]"); await page.waitForTimeout(150);
  ok(await visible("#shPop .share"), "Mitreisende & Beobachter öffnet kein eigenes Pop-up");
  await click("#shPop [data-act=shclose]"); ok(!(await visible("#shPop")), "Pop-up schließt nicht");
  // Reise bearbeiten aus dem Menü: Knopf statt Liste, Schließen führt zurück zum Profil
  await page.locator("#profView [data-act=pfmore][data-trip=t_mal]").click();
  await click("#jpMenu [data-act=pfedit]"); await page.waitForTimeout(200);
  ok(await visible("#tripPop #tForm") && await rp(`S.cur==="t_mal" && tdraft.mode==="edit"`), "Reise bearbeiten öffnet nicht für diese Reise");
  ok(await page.locator("#tripPop .share").count()===0 && await page.locator("#tripPop [data-act=shopen]").count()===1, "Bearbeiten zeigt die Liste statt des Knopfs");
  await click("#tripPop [data-act=shopen]"); await page.waitForTimeout(150);
  ok(await visible("#shPop .share"), "Knopf in „Reise bearbeiten“ öffnet das Pop-up nicht");
  await click("#shPop [data-act=shclose]");
  await click("#tripPop [data-act=tcancel]"); await page.waitForTimeout(200);
  ok(!(await visible("#tripPop")) && await visible("#profView"), "Abbrechen führt nicht zurück zum Profil");
  for(const how of ["#tripPop [data-act=tripclose]", "backdrop"]){
    await page.locator("#profView [data-act=pfmore][data-trip=t_mal]").click(); await click("#jpMenu [data-act=pfedit]"); await page.waitForTimeout(200);
    if(how==="backdrop"){ await page.mouse.click(5, 5); await page.waitForTimeout(150); ok(await visible("#tripPop #tForm"), "Tipp daneben verwirft das Formular"); await click("#tripPop [data-act=tripclose]"); } else await click(how);
    await page.waitForTimeout(200);
    ok(!(await visible("#tripPop")) && await visible("#profView") && await rp(`profTab`)==="mine", how+": nicht zurück zum Profil");
  }
  // Neue Reise aus dem Profil: Abbrechen zurück ins Profil, Anlegen springt zur Karte
  await click("#profView [data-act=pfnew]"); await page.waitForTimeout(200);
  ok(await visible("#tripPop #tForm"), "Neue Reise öffnet nicht");
  await click("#tripPop [data-act=tcancel]"); await page.waitForTimeout(200);
  ok(!(await visible("#tripPop")) && await visible("#profView"), "Neue Reise abbrechen führt nicht zurück zum Profil");
  await click("#profView [data-act=pfnew]"); await page.waitForTimeout(200);
  await rp(`tdraft.name = "Porto"; tdraft.start = "2027-06-01"; tdraft.end = "2027-06-03"; tdraft.orte = [{n:"Porto", loc:"41.1500, -8.6100", from:"", to:""}]; document.getElementById("tForm").requestSubmit(); true`); await page.waitForTimeout(600);
  ok(!(await visible("#profView")) && await rp(`T().name==="Porto"`), "Nach dem Anlegen nicht auf der Karte");
});

await test("Titelbild-Auswahl: viele Fotos als sauberes Raster, nur sichtbare geladen", async () => {
  await seed();
  await rp(`(function(){ var t = S.trips.t_test, ids = []; for(var i = 0; i < 90; i++){ var id = "phx"+i; ids.push(id); PHC[id] = PHC["ph_"+["a","b","c"][i%3]]; } t.photos.p4 = t.photos.p4.concat(ids); PROF = {name:"tester"}; openProfile(); })()`);
  await page.waitForTimeout(300);
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcvopen]"); await click("#cvPop [data-act=cvmode][data-v=photo]");
  await page.waitForTimeout(900);
  const g = await page.evaluate(() => { const b = [...document.querySelectorAll("#cvPop .cv-grid button")].slice(0, 6).map(x => x.getBoundingClientRect());
    return {n: document.querySelectorAll("#cvPop .cv-grid button").length, w: b[0].width, h: b[0].height, row2: b[3].top - b[0].top, loaded: document.querySelectorAll("#cvPop .cv-grid img[src]").length}; });
  ok(g.n >= 90, "Nicht alle Fotos im Raster ("+g.n+")");
  ok(Math.abs(g.w - g.h) < 2 && g.h > 40, "Kacheln nicht quadratisch ("+Math.round(g.w)+"×"+Math.round(g.h)+")");
  ok(g.row2 >= g.h, "Kacheln überlappen sich");
  ok(g.loaded > 0 && g.loaded < 40, "Vorschaubilder werden nicht gestaffelt geladen ("+g.loaded+")");
});

await test("Ebenen: ÖPNV-Gruppe aufklappbar, farbige Karte und 3D ohne Schalter", async () => {
  await seed();
  await rp(`["lSub","lBus","lFerry","lBike"].forEach(function(id){ $(id).checked = false; $(id).dispatchEvent(new Event("change")); });`);
  await click("#layersBtn"); await page.waitForTimeout(150);
  ok(await page.locator("#lColor").count()===0 && await page.locator("#l3d").count()===0, "Farbige Karte / 3D-Gebäude noch als Schalter im Menü");
  ok(await rp(`colorOn && b3dOn`), "Farbige Karte oder 3D-Gebäude nicht standardmäßig an");
  ok(await visible("#lTr") || await page.locator("label:has(#lTr)").isVisible(), "ÖPNV-Schalter fehlt");
  ok(!(await page.locator("#lTrGrp").isVisible()), "ÖPNV-Auswahl ist nicht eingeklappt");
  ok((await page.locator("#layers").innerText()).indexOf("Citi Bike")===-1, "Bike Share heißt noch Citi Bike");
  await click("#lTrBtn"); await page.waitForTimeout(100);
  ok(await page.locator("#lTrGrp").isVisible() && (await page.locator("#lTrGrp").innerText()).includes("Bike Share"), "ÖPNV-Auswahl klappt nicht auf");
  // Hauptschalter an: zuletzt gewählte (Standard U-Bahn) Verkehrsmittel an
  await page.locator("label:has(#lTr)").click(); await page.waitForTimeout(150);
  ok(await rp(`layers.sub && !layers.bus && $("lTr").checked && $("lTr").indeterminate`), "ÖPNV-Hauptschalter schaltet die U-Bahn nicht ein");
  await page.locator("#lBus").check(); await page.waitForTimeout(100);
  await shot("ebenen-oepnv");
  ok(await rp(`layers.sub && layers.bus`), "Einzelnes Verkehrsmittel lässt sich nicht zuschalten");
  // aus und wieder an: Auswahl bleibt
  await page.locator("label:has(#lTr)").click(); await page.waitForTimeout(100);
  ok(await rp(`!layers.sub && !layers.bus && !layers.ferry && !layers.bike && !$("lTr").checked`), "ÖPNV-Hauptschalter schaltet nicht alles aus");
  await page.locator("label:has(#lTr)").click(); await page.waitForTimeout(100);
  ok(await rp(`layers.sub && layers.bus && !layers.ferry`), "Auswahl geht beim Aus- und Einschalten verloren");
  // Linienauswahl von U-Bahn und Bus je für sich auf- und zuklappbar, jeweils mit Alle/Keine
  ok(!(await page.locator("#subLines").isVisible()) && !(await page.locator("#busLines").isVisible()), "Linienauswahl ist nicht eingeklappt");
  ok(await page.locator("#lnBtn-sub").isVisible() && await page.locator("#lnBtn-bus").isVisible() && !(await page.locator("#lnBtn-ferry").count()), "Aufklappknöpfe bei U-Bahn/Bus fehlen");
  await click("#lnBtn-sub"); await page.waitForTimeout(100);
  ok(await page.locator("#subLines").isVisible() && await page.locator("#subLines [data-act=lsuball]").isVisible() && await page.locator("#subLines [data-act=lsubnone]").isVisible(), "U-Bahn-Linien klappen nicht mit Alle/Keine auf");
  await click("#subLines [data-act=lsubnone]"); await page.waitForTimeout(100);
  await click("#lnBtn-sub"); await page.waitForTimeout(100);
  ok(!(await page.locator("#subLines").isVisible()) && /0 von/.test(await page.locator("#lnN-sub").innerText()), "U-Bahn-Linien klappen nicht zu oder Zähler fehlt");
  await rp(`(function(){ offSub = {}; applyLines(); })()`);
  await click("#lnBtn-bus"); await page.waitForTimeout(100);
  ok(await page.locator("#busLines").isVisible() && await page.locator("#busLines [data-act=lbusall]").isVisible() && await page.locator("#busLines [data-act=lbusnone]").isVisible(), "Buslinien klappen nicht mit Alle/Keine auf");
  await click("#lnBtn-bus"); await page.waitForTimeout(100);
  ok(!(await page.locator("#busLines").isVisible()), "Buslinien klappen nicht zu");
  await click("#lnBtn-bus"); await page.waitForTimeout(100); await shot("ebenen-linien"); await click("#lnBtn-bus"); await page.waitForTimeout(100);
  ok((await page.locator("#layers").innerText()).indexOf("Tagesroute")===-1, "Tagesroute steht noch im Ebenen-Menü");
  await click("#lTrBtn"); await page.waitForTimeout(100);
  ok(!(await page.locator("#lTrGrp").isVisible()), "ÖPNV-Auswahl klappt nicht wieder zu");
});

await test("Kartenebenen je Reiseziel: ÖPNV-Linien und Bezirke aus OpenStreetMap (Lissabon)", async () => {
  const OVQ = [];
  const sq = (lo, la, d) => [{lat:la, lon:lo}, {lat:la, lon:lo+d}, {lat:la+d, lon:lo+d}, {lat:la+d, lon:lo}];
  const adm = (id, n, lo, la) => { const p = sq(lo, la, 0.01); return {type:"relation", id, tags:{name:n, admin_level:"8", boundary:"administrative"},
    members:[{type:"way", ref:id*10, role:"outer", geometry:[p[0], p[1], p[2]]}, {type:"way", ref:id*10+1, role:"outer", geometry:[p[0], p[3], p[2]]}]}; };
  await page.route(/overpass-api\.de/, rt => { const q = decodeURIComponent((rt.request().postData()||"").replace(/^data=/, "").replace(/\+/g, " ")); OVQ.push(q);
    let el = [];
    if(q.includes("is_in(")) el = [{type:"relation", id:100, tags:{name:"Lisboa", admin_level:"7", boundary:"administrative"}, bounds:{minlat:38.69, minlon:-9.23, maxlat:38.80, maxlon:-9.09}},
      {type:"relation", id:101, tags:{name:"Santa Maria Maior", admin_level:"8", boundary:"administrative"}, bounds:{minlat:38.709, minlon:-9.14, maxlat:38.716, maxlon:-9.13}},
      {type:"relation", id:1, tags:{name:"Portugal", admin_level:"2", boundary:"administrative"}, bounds:{minlat:36, minlon:-10, maxlat:42, maxlon:-6}}];
    else if(q.includes("out tags bb")) el = [201, 202, 203].map((id, i) => ({type:"relation", id, tags:{name:["Estrela","Misericórdia","Alfama"][i], admin_level:"8"}, bounds:{minlat:38.70, minlon:-9.20+i*0.02, maxlat:38.71, maxlon:-9.19+i*0.02}}))
      .concat([{type:"relation", id:300, tags:{name:"Oeiras-Nachbar", admin_level:"8"}, bounds:{minlat:38.68, minlon:-9.30, maxlat:38.72, maxlon:-9.20}}]);
    else if(q.includes("rel(id:")) el = [adm(201, "Estrela", -9.20, 38.70), adm(202, "Misericórdia", -9.18, 38.70), adm(203, "Alfama", -9.16, 38.70)];
    else if(q.includes("subway")) el = [
      {type:"relation", id:1, tags:{type:"route", route:"subway", ref:"A", name:"Linha Azul", colour:"#0072CE"}, members:[{type:"way", ref:11}]},
      {type:"relation", id:2, tags:{type:"route", route:"tram", ref:"28E", name:"Elétrico 28", colour:"#FFCC00"}, members:[{type:"way", ref:12}]},
      {type:"relation", id:3, tags:{type:"route", route:"tram", ref:"15E", name:"Elétrico 15"}, members:[{type:"way", ref:14}]},
      {type:"way", id:11, tags:{railway:"subway"}, geometry:[{lat:38.71, lon:-9.14}, {lat:38.72, lon:-9.15}]},
      {type:"way", id:12, tags:{railway:"tram"}, geometry:[{lat:38.711, lon:-9.13}, {lat:38.715, lon:-9.135}]},
      {type:"way", id:14, tags:{railway:"tram"}, geometry:[{lat:38.70, lon:-9.17}, {lat:38.70, lon:-9.20}]},
      {type:"way", id:13, tags:{railway:"funicular", name:"Elevador da Glória"}, geometry:[{lat:38.7155, lon:-9.1430}, {lat:38.7165, lon:-9.1440}]},
      {type:"node", id:21, lat:38.7106, lon:-9.1420, tags:{railway:"station", station:"subway", name:"Baixa-Chiado"}},
      {type:"node", id:22, lat:38.7120, lon:-9.1400, tags:{amenity:"bicycle_rental", name:"Gira 101"}},
      {type:"count", id:0, tags:{relations:"1"}}];
    else if(q.includes("trolleybus")) el = [{type:"relation", id:5, tags:{type:"route", route:"bus", ref:"758", name:"Cais do Sodré – Portas de Benfica"}, members:[{type:"way", ref:31}]},
      {type:"way", id:31, tags:{highway:"primary"}, geometry:[{lat:38.706, lon:-9.145}, {lat:38.75, lon:-9.19}]}];
    return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({elements:el}) }); });
  await seed();
  ok(await rp(`DEST===null && !document.body.classList.contains("dyn")`), "New York gilt nicht als eingebautes Ziel");
  await rp(`(function(){ var t = newTripObj({id:"t_lis", name:"Lissabon", start:"2026-11-02", end:"2026-11-06", hotels:[{id:"h9", n:"Hotel Lisboa", la:38.7150, lo:-9.1400, from:"2026-11-02", to:"2026-11-06"}], orte:[{id:"o9", n:"Lissabon", la:38.7223, lo:-9.1393, from:"2026-11-02", to:"2026-11-06"}]});
    S.trips.t_lis = t; S.cur = "t_lis"; DL = {}; renderAll(); })()`);
  ok(await rp(`!!DEST && document.body.classList.contains("dyn")`), "Lissabon wird nicht als eigenes Ziel erkannt");
  ok(!OVQ.length, "Overpass wird schon ohne Bedarf gefragt");
  await click("#layersBtn"); await click("#lTrBtn");
  await page.waitForFunction(() => window.__rp("!!(DEST && DEST.tr && DEST.nb)"), null, {timeout:5000});
  const grp = await page.locator("#lTrGrp").innerText();
  ok(grp.includes("Metro") && grp.includes("Tram") && grp.includes("Seilbahnen") && grp.includes("Busse") && grp.includes("Bike Share"), "Verkehrsmittel des Ziels fehlen: "+grp);
  ok(!grp.includes("Subway") && !(await page.locator("#lSub").isVisible()) && !grp.includes("Fähren"), "New-York-Verkehrsmittel stehen noch im Menü: "+grp);
  ok((await page.locator("#layers").textContent()).includes("Bezirke") && (await page.locator("#layers").textContent()).includes("Bezirk hervorheben"), "Ebene heißt nicht „Bezirke“");
  // Hauptschalter ÖPNV → erstes Verkehrsmittel (Metro)
  await page.locator("label:has(#lTr)").click(); await page.waitForTimeout(150);
  ok(await rp(`DL.metro && !DL.tram && $("lTr").indeterminate && map.getLayoutProperty("dtr","visibility")==="visible"`), "ÖPNV-Hauptschalter schaltet die Metro nicht ein");
  ok(await rp(`map.getSource("dtr")._data.features.length===4 && map.getLayoutProperty("sub","visibility")==="none"`), "Linien des Ziels nicht auf der Karte");
  // Unterkategorie Tram → einzelne Linien
  await page.locator("#ld-tram").check(); await page.waitForTimeout(100);
  await click("[data-act=dfold][data-m=tram]");
  ok(await page.locator("#dLines-tram [data-id='tram:28E']").isVisible() && await page.locator("#dLines-tram [data-id='tram:15E']").isVisible(), "Tram-Linien fehlen");
  await shot("ziel-oepnv");
  await click("#dLines-tram [data-id='tram:28E']");
  ok(await rp(`DOFF["tram:28E"] && JSON.stringify(map.getFilter("dtr")).indexOf("tram:28E") > -1`), "Linie lässt sich nicht ausblenden");
  ok(/1 von 2/.test(await page.locator("label:has(#ld-tram)").innerText()), "Zähler der Tram-Linien fehlt");
  // Busse erst bei Bedarf laden
  ok(!OVQ.some(q => q.includes("trolleybus)$\"](") && !q.includes("subway")), "Busse werden ohne Bedarf geladen");
  await page.locator("#ld-bus").check(); await click("[data-act=dfold][data-m=bus]");
  await page.waitForFunction(() => window.__rp("!!(DEST && DEST.bus)"), null, {timeout:5000}); await page.waitForTimeout(100);
  ok(await page.locator("#dLines-bus [data-id='bus:758']").isVisible(), "Buslinie fehlt");
  // Bezirke des Ziels: Liste, Hervorheben, Umgebung (Nachbarort) nicht dabei
  ok(await rp(`NB.length===3 && nbByName("Estrela") > -1 && nbByName("Oeiras-Nachbar") < 0 && map.getSource("nb")._data.features.length===3`), "Bezirke falsch: "+await rp(`NB.map(function(x){ return x.n; }).join(",")`));
  ok(await rp(`NB[0].r[0].length >= 8`), "Bezirks-Umriss nicht zusammengesetzt");
  ok(await rp(`nbOf({la:38.705, lo:-9.175})`)==="Misericórdia", "Ort wird keinem Bezirk zugeordnet");
  await page.locator("#nbAdd").selectOption("Alfama"); await page.waitForTimeout(150);
  ok(await rp(`nbHi.Alfama && JSON.parse(lsGet("rp-nb-hi-"+DEST.k)).indexOf("Alfama") > -1 && JSON.parse(lsGet("nyc-nb-hi")||"[]").indexOf("Alfama") < 0`), "Bezirk wird nicht je Ziel hervorgehoben");
  // zurück nach New York: eingebaute Daten; wieder Lissabon: aus dem Speicher, ohne neue Abfrage
  const n0 = OVQ.length;
  await rp(`S.cur = "t_test"; renderAll(); true`); await page.waitForTimeout(150);
  ok(await rp(`DEST===null && NB.length > 50 && !nbHi.Alfama`), "New York bekommt die Daten nicht zurück");
  ok(await page.locator("#lSub").isVisible() && !(await page.locator("#lTrDyn").isVisible()), "New-York-Menü kommt nicht zurück");
  await rp(`S.cur = "t_lis"; renderAll(); true`);
  await page.waitForFunction(() => window.__rp("!!(DEST && DEST.tr && DEST.nb && NB.length===3)"), null, {timeout:5000});
  ok(OVQ.length===n0 && await rp(`nbHi.Alfama && DL.metro`), "Ziel wird nicht aus dem Speicher geladen ("+(OVQ.length-n0)+" neue Abfragen)");
});

await test("Kartenebenen je Reiseziel: Zeitlimit und Fehler statt endlosem Laden (Tokio)", async () => {
  let mode = "hang", n = 0;
  await page.route(/overpass-api\.de|overpass\.kumi/, rt => { n++;
    if(mode==="hang") return; // Server antwortet nie
    if(mode==="remark") return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({elements:[{type:"relation", id:1, tags:{type:"route", route:"subway", ref:"G"}, members:[]}], remark:"runtime error: Query timed out in \"query\" at line 1 after 41 seconds."}) });
    const q = decodeURIComponent((rt.request().postData()||"").replace(/^data=/, "").replace(/\+/g, " "));
    const el = q.includes("subway") ? [{type:"relation", id:1, tags:{type:"route", route:"subway", ref:"G", colour:"#F39700"}, members:[{type:"way", ref:11}]}, {type:"way", id:11, geometry:[{lat:35.67, lon:139.70}, {lat:35.68, lon:139.76}]}] : [];
    return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({elements:el}) }); });
  await seed();
  await rp(`(function(){ OVTO = 1200; var t = newTripObj({id:"t_tyo", name:"Tokio", start:"2026-11-02", end:"2026-11-06", orte:[{id:"o8", n:"Tokio", la:35.6812, lo:139.7671, from:"2026-11-02", to:"2026-11-06"}]});
    S.trips.t_tyo = t; S.cur = "t_tyo"; DL = {}; renderAll(); })()`);
  ok(await rp(`!!DEST && DEST.r <= 10000`), "Suchradius zu groß");
  await click("#layersBtn"); await click("#lTrBtn");
  ok((await page.locator("#lTrDyn").innerText()).includes("wird geladen"), "Ladehinweis fehlt");
  await page.waitForFunction(() => window.__rp("DEST.st.tr==='err' && DEST.st.nb==='err'"), null, {timeout:8000});
  ok(n >= 4, "Ersatzserver wird nicht versucht ("+n+" Abfragen)");
  ok(await page.locator("#lTrDyn [data-act=dretry]").isVisible() && await page.locator("#nbErr [data-act=dretry]").isVisible(), "Fehlermeldung mit „Erneut versuchen“ fehlt");
  await shot("ziel-fehler");
  // abgebrochene Abfrage mit unvollständigen Daten: Fehler, nichts gespeichert
  mode = "remark"; await click("#lTrDyn [data-act=dretry]");
  await page.waitForFunction(() => window.__rp("DEST.st.tr==='err'"), null, {timeout:5000});
  ok(await rp(`!DEST.tr && !DMEM[DEST.k+":tr"]`), "Unvollständige Daten wurden übernommen");
  // erneut versuchen, Server antwortet
  mode = "ok"; await click("#lTrDyn [data-act=dretry]");
  await page.waitForFunction(() => window.__rp("!!DEST.tr"), null, {timeout:5000}); await page.waitForTimeout(100);
  ok((await page.locator("#lTrDyn").innerText()).includes("Metro"), "Nach „Erneut versuchen“ keine Linien");
});

await test("Citi Bike: Stationen als Ebene, Stations-Infos, Etappe mit dem Rad", async () => {
  await seed();
  await click("#layersBtn"); await click("#lTrBtn");
  await page.locator("#lBike").check(); await page.waitForTimeout(900);
  await click("#layersBtn");
  ok(await rp(`layers.bike && lsGet("nyc-l-bike")==="1"`), "Ebene wird nicht eingeschaltet");
  ok(await rp(`CB.st.length`)===3, "Stationen nicht geladen ("+await rp(`CB.st.length + " " + CB.err`)+")");
  ok(await rp(`map.getSource("cb")._data.features.length`)===3, "Stationen nicht auf der Karte");
  ok(await rp(`typeof map.getPaintProperty("cb","circle-color")==="string"`), "Stationspunkte haben nicht eine einheitliche Füllfarbe");
  ok(await rp(`Array.isArray(map.getPaintProperty("cb","circle-stroke-color"))`), "Verfügbarkeit wird nicht über den Ring gezeigt");
  await rp(`select("cb:S1")`); await page.waitForTimeout(150);
  const card = await page.locator("#card").innerText();
  ok(card.includes("Ludlow") && card.includes("7") && card.includes("freie Plätze"), "Stations-Karte unvollständig: "+card.slice(0, 120));
  await rp(`select(null); legsList = true; setSheet("full"); renderSheet();`); await page.waitForTimeout(150);
  ok(await page.locator("[data-act=lmpick]").count() > 0, "Umschalter für das Verkehrsmittel fehlt");
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p1" && L[i][1] && L[i][1].id==="p2") return i; } return -1; })()`);
  ok(li > -1, "Etappe Katz Deli → Washington Square nicht gefunden");
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=lmode]").count()===5, "Menü bietet nicht Zu Fuß / U-Bahn / Fähre / Auto / Citi Bike");
  ok((await page.locator("#jpMenu [data-mode=bike]").innerText()).includes("Min."), "Citi Bike ohne Zeitangabe im Menü");
  await page.locator("#jpMenu [data-act=lmode][data-mode=bike]").click(); await page.waitForTimeout(250);
  const leg = await page.locator(".leg.lbk").first().innerText();
  ok(leg.includes("Min.") && leg.includes("Ludlow") && leg.includes("Washington Sq E"), "Rad-Etappe falsch: "+leg.slice(0, 160));
  ok(await page.evaluate(() => document.querySelector(".leg.lbk .tsum").getBoundingClientRect().width > 80), "Zusammenfassung der Rad-Etappe ist nicht sichtbar");
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1])`)==="bike", "Rad-Modus wird nicht gespeichert");
});

await test("Leihrad am Ziel: System aus dem GBFS-Katalog finden, Live-Verfügbarkeit (Lissabon)", async () => {
  const REQ = [], J = (rt, b) => rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify(b) });
  await page.route(/overpass-api\.de|overpass\.kumi/, rt => J(rt, {elements:[{type:"node", id:22, lat:38.7120, lon:-9.1400, tags:{amenity:"bicycle_rental", name:"OSM-Station"}}]}));
  await page.route(/raw\.githubusercontent\.com\/MobilityData/, rt => { REQ.push(rt.request().url()); return rt.fulfill({ contentType:"text/plain", headers:{"access-control-allow-origin":"*"}, body:
    "Country Code,Name,Location,System ID,URL,Auto-Discovery URL,Supported Versions,Authentication Info URL,Authentication Type,Authentication Parameter Name\n"+
    "PT,Bird Lisbon,Lisbon,bird-lisbon,https://www.bird.co,https://bird.example/gbfs.json,2.3,,,\n"+
    "PT,Gira,Lisbon,gira,https://www.gira-bicicletasdelisboa.pt/,https://gira.example/gbfs.json,2.3 ; 3.0,,,\n"+
    "PT,\"Gira, Porto\",Porto,gira_porto,https://example.org,https://porto.example/gbfs.json,2.3,,,\n"+
    "US,Lisbon Bikes,\"Lisbon, ME\",lisbon_me,https://example.org,https://me.example/gbfs.json,2.3,,,\n" }); });
  await page.route(/photon\.komoot\.io\/reverse/, rt => { const u = rt.request().url(), faro = u.includes("lat=37.0");
    return J(rt, {features:[{properties:{osm_key:"place", type:"city", name:faro ? "Faro" : u.includes("lang=en") ? "Lisbon" : "Lisboa", city:faro ? "Faro" : u.includes("lang=en") ? "Lisbon" : "Lisboa", countrycode:"PT"}}]}); });
  await page.route(/\.example\//, rt => { const u = rt.request().url(); REQ.push(u);
    if(u.includes("gira.example/gbfs.json")) return J(rt, {data:{pt:{feeds:[{name:"station_information", url:"https://gira.example/si.json"}, {name:"station_status", url:"https://gira.example/ss.json"}, {name:"vehicle_types", url:"https://gira.example/vt.json"}]}}});
    if(u.includes("gira.example/vt.json")) return J(rt, {data:{vehicle_types:[{vehicle_type_id:"e", form_factor:"bicycle", propulsion_type:"electric_assist"}]}});
    if(u.includes("gira.example/si.json")) return J(rt, {data:{stations:[
      {station_id:"101", name:[{text:"Cais do Sodré", language:"pt"}], lat:38.7060, lon:-9.1440, capacity:20},
      {station_id:"102", name:"Rossio", lat:38.7139, lon:-9.1394, capacity:15},
      {station_id:"103", name:"Alfama", lat:38.7118, lon:-9.1300, capacity:12},
      {station_id:"900", name:"Weit weg", lat:41.15, lon:-8.61, capacity:10}]}});
    if(u.includes("gira.example/ss.json")) return J(rt, {data:{stations:[
      {station_id:"101", num_vehicles_available:4, num_docks_available:16, is_installed:true, is_renting:true, is_returning:true},
      {station_id:"102", num_bikes_available:0, num_docks_available:15, is_installed:true, is_renting:true, is_returning:true},
      {station_id:"103", num_bikes_available:3, num_docks_available:9, is_installed:true, is_renting:true, is_returning:true}]}});
    return rt.abort(); });
  await seed();
  await rp(`(function(){ var t = newTripObj({id:"t_lis", name:"Lissabon", start:"2026-11-02", end:"2026-11-06", hotels:[{id:"h9", n:"Hotel Lisboa", la:38.7150, lo:-9.1400, from:"2026-11-02", to:"2026-11-06"}], orte:[{id:"o9", n:"Lissabon", la:38.7223, lo:-9.1393, from:"2026-11-02", to:"2026-11-06"}]});
    S.trips.t_lis = t; S.cur = "t_lis"; layers.bike = true; renderAll(); cbLoad(); })()`);
  await page.waitForFunction(() => window.__rp("CB.sys.length > 0 && CB.st.length > 0 && CB.statAt > 0"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`CB.sys.length===1 && CB.sys[0].n==="Gira" && CB.st.length===3`), "System am Ziel nicht gefunden: "+await rp(`JSON.stringify(CB.sys)+" "+CB.st.length+" "+CB.err`));
  ok(!REQ.some(u => u.includes("bird.example") || u.includes("porto.example") || u.includes("me.example")), "Falsche Systeme abgefragt (Roller, andere Stadt, anderes Land): "+REQ.join(" "));
  ok(await rp(`map.getLayoutProperty("cb","visibility")==="visible" && map.getLayoutProperty("dbike","visibility")==="none" && map.getSource("cb")._data.features.length===3`), "Live-Stationen statt OSM-Stationen nicht auf der Karte");
  const id = await rp(`CB.st.filter(function(s){ return s.n==="Cais do Sodré"; })[0].id`);
  await rp(`select("cb:${id}")`); await page.waitForTimeout(150);
  const card = await page.locator("#card").innerText();
  ok(card.includes("Cais do Sodré") && card.includes("Gira Station") && card.includes("4") && card.includes("16") && card.includes("Daten: Gira") && !card.includes("Citi"), "Stations-Karte am Ziel falsch: "+card.slice(0, 200));
  ok(await rp(`LMNAME.bike`)==="Gira", "Verkehrsmittel heißt nicht nach dem System am Ziel");
  // aus dem Speicher: kein neuer Katalog-Abruf beim Wechsel zurück
  const n0 = REQ.filter(u => u.includes("MobilityData")).length;
  await rp(`select(null); S.cur = "t_test"; renderAll(); true`); await page.waitForTimeout(150);
  ok(await rp(`CB.sys[0].n==="Citi Bike" && LMNAME.bike==="Citi Bike"`), "New York bekommt Citi Bike nicht zurück");
  await rp(`S.cur = "t_lis"; renderAll(); cbLoad(); true`);
  await page.waitForFunction(() => window.__rp("CB.sys.length > 0 && CB.st.length===3"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`CB.sys.length && CB.sys[0].n==="Gira"`) && REQ.filter(u => u.includes("MobilityData")).length===n0, "Ergebnis wird nicht je Ziel gemerkt");
  // Ziel ohne bekanntes System: OSM-Stationen bleiben, Rad-Etappe sagt es klar
  await rp(`(function(){ var t = newTripObj({id:"t_faro", name:"Faro", start:"2026-11-02", end:"2026-11-06", hotels:[{id:"h8", n:"Hotel Faro", la:37.0170, lo:-7.9350, from:"2026-11-02", to:"2026-11-06"}], orte:[{id:"o8", n:"Faro", la:37.0194, lo:-7.9304, from:"2026-11-02", to:"2026-11-06"}]});
    S.trips.t_faro = t; S.cur = "t_faro"; renderAll(); cbLoad(); })()`);
  await page.waitForFunction(() => window.__rp("cbState()==='nosys'"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`cbState()==="nosys" && map.getLayoutProperty("cb","visibility")==="none" && map.getLayoutProperty("dbike","visibility")==="visible"`), "Ohne System sollen die OSM-Stationen bleiben");
  ok(await rp(`bikeRoute({la:37.017, lo:-7.935}, {la:37.019, lo:-7.930}).nosys===true`), "Rad-Etappe wartet endlos statt „kein System“");
});

await test("Fähre als Verkehrsmittel einer Etappe (Menü, Tagesplan, Navigation)", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  ok(await rp(`busReady`), "Fahrpläne (bus.json) nicht geladen");
  // Etappe Kips Bay → Domino Park (Williamsburg): Fähre über den East River sinnvoll
  await rp(`(function(){ var t = T(); t.places.p8 = {id:"p8", n:"Domino Park", c:"park", la:40.7144, lo:-73.9680, list:"l_main", note:"", addr:"River St"}; t.places.p9 = {id:"p9", n:"Kips Bay", c:"sight", la:40.7470, lo:-73.9760, list:"l_main", note:"", addr:"2nd Ave"}; t.order[cur] = ["p9","p8","p3"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  await page.waitForTimeout(200);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p9" && L[i][1] && L[i][1].id==="p8") return i; } return -1; })()`);
  ok(li > -1, "Etappe Kips Bay → Domino Park nicht gefunden");
  ok(await rp(`(function(){ var L = dayLegs(cur)[${li}], f = ferryAlts(L[0], L[1], cur); return !!(f && f.length && hasFerry(f[0])); })()`), "Keine Fährverbindung gefunden");
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  const fm = await page.locator("#jpMenu [data-mode=ferry]").innerText();
  ok(fm.includes("Fähre") && fm.includes("Min.") && fm.includes("East River"), "Fähre im Menü ohne Zeit/Linie: "+fm);
  // unsinniger Umweg (Katz Deli → Domino Park: Fähre wäre dreimal so lang) wird nicht angeboten
  ok(await rp(`(ferryAlts(P("p1"), P("p8"), cur)||[1]).length===0`), "Unsinnige Fährverbindung wird angeboten");
  await page.locator("#jpMenu [data-act=lmode][data-mode=ferry]").click(); await page.waitForTimeout(250);
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1])`)==="ferry", "Fähren-Modus wird nicht gespeichert");
  ok(await rp(`hasFerry(legRoute(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1], cur))`), "Etappe nutzt keine Fähre");
  ok(await page.locator(`li.tleg [data-act=lmpick][data-leg="${li}"] svg`).count()===1, "Symbol der Etappe fehlt");
  ok(await page.locator("li.tleg .bul.ferry").count() > 0, "Etappe zeigt die Fährlinie nicht");
  await shot("etappe-faehre");
  // Navigation mit der Fähre
  await rp(`me = {la:40.7470, lo:-73.9760, acc:8}; navStart(P("p8"), "ferry");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.segs && NAV.segs.some(function(sg){ return sg.kind==="ride" && sg.ride.bus; }))`), "Navigation nutzt keine Fähre");
});

await test("Fähre fährt übers Wasser (Fährlinien der Karte statt Luftlinie)", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  const r = await rp(`(function(){
    var a = {la:40.7470, lo:-73.9760}, b = {la:40.7144, lo:-73.9680}, f = ferryAlts(a, b, cur), l = f[0].legs.filter(function(x){ return x.t==="ride" && isFerry(x.r); })[0];
    var A = stLL(l.stops[0]), B = stLL(l.stops[1]);
    // ohne Kacheln: Luftlinie, später neuer Versuch
    ferryGeoSrc = function(){ return []; }; FG = null; RIDEC = {}; FERRYP = {}; ferryMiss = false;
    var p0 = ridePath(l), miss = ferryMiss;
    // Fährlinie mit Knick über den Fluss (wie in den OSM-Kacheln, in zwei Teilen wie an Kachelgrenzen)
    var K = {la:(A.la+B.la)/2, lo:Math.max(A.lo, B.lo) + 0.01};
    ferryGeoSrc = function(){ return [{type:"LineString", coordinates:[[A.lo+0.0003, A.la], [(A.lo+K.lo)/2, (A.la+K.la)/2], [K.lo, K.la]]}, {type:"LineString", coordinates:[[K.lo+0.00005, K.la], [B.lo+0.0003, B.la]]}]; };
    FG = null; ferryRetry();
    var p1 = ridePath(l), hasK = p1.some(function(q){ return dist(q, K) < 30; });
    return {n0:p0.length, miss:miss, n1:p1.length, hasK:hasK, saved:!!FERRYP[NET.s[l.stops[0]][0]+">"+NET.s[l.stops[1]][0]], stops:l.stops.length};
  })()`);
  ok(r.n0===r.stops && r.miss, "Ohne Kacheln sollte Luftlinie mit neuem Versuch kommen: "+JSON.stringify(r));
  ok(r.hasK && r.n1 > r.stops, "Fährweg folgt nicht der Fährlinie: "+JSON.stringify(r));
  ok(r.saved, "Fährweg wird nicht gemerkt");
});

await test("Routenoptionen je Etappe: Zeit (Abfahrt/Ankunft) und bevorzugte Verkehrsmittel", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  await rp(`(function(){ var t = T(); t.places.p8 = {id:"p8", n:"Domino Park", c:"park", la:40.7144, lo:-73.9680, list:"l_main", note:"", addr:"River St"}; t.places.p9 = {id:"p9", n:"Kips Bay", c:"sight", la:40.7470, lo:-73.9760, list:"l_main", note:"", addr:"2nd Ave"}; t.order[cur] = ["p9","p8","p3"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  await page.waitForTimeout(200);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p9" && L[i][1] && L[i][1].id==="p8") return i; } return -1; })()`);
  ok(li > -1, "Etappe nicht gefunden");
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1])`)==="oepnv", "Etappe sollte U-Bahn & Bus sein");
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  await click("#jpMenu [data-act=loptopen]");
  ok(await visible("#catPop .lopt"), "Optionen-Fenster fehlt");
  ok(await page.locator("#catPop [data-act=loptp]").count()===3, "Bus / U-Bahn / Fähre fehlen");
  await click("#catPop [data-act=loptp][data-v=ferry]");
  await click("#catPop [data-act=loptt][data-v=dep]");
  ok(await visible("#loTm"), "Uhrzeit-Feld fehlt");
  await page.locator("#loTm").fill("10:00");
  await shot("routenoptionen");
  await click("#catPop [data-act=loptsave]");
  ok(await page.locator("#catPop").isHidden(), "Fenster schließt nicht");
  const o = await rp(`JSON.stringify(legOptOf(dayLegs(cur)[${li}][1]))`);
  ok(o==='{"t":"dep","tm":"10:00","p":["ferry"]}', "Optionen nicht gespeichert: "+o);
  ok(await rp(`(function(){ var L = dayLegs(cur)[${li}]; return hasFerry(legRoute(L[0], L[1], cur)); })()`), "Fähre bevorzugt, aber Verbindung ohne Fähre");
  ok(await rp(`(function(){ var L = dayLegs(cur)[${li}], r = legRoute(L[0], L[1], cur); return legCtx(L[0], L[1], r).base; })()`)===36000, "Abfahrtszeit wird nicht verwendet");
  // Bus bevorzugt: Verbindung ohne Fähre
  await rp(`legSet("legOpt", dayLegs(cur)[${li}][1], {p:["sub"]}); ALTCACHE = {}; renderSheet();`);
  ok(await rp(`(function(){ var L = dayLegs(cur)[${li}]; return !hasFerry(legRoute(L[0], L[1], cur)); })()`), "U-Bahn bevorzugt, aber Fähre gewählt");
  // Ankunft bis 12:00: Abfahrt so, dass man rechtzeitig ankommt
  await rp(`legSet("legOpt", dayLegs(cur)[${li}][1], {t:"arr", tm:"12:00"}); ALTCACHE = {}; renderSheet();`);
  const ar = await rp(`(function(){ var L = dayLegs(cur)[${li}], r = legRoute(L[0], L[1], cur), c = legCtx(L[0], L[1], r); return {b:c.base, s:r.secs}; })()`);
  ok(ar.b < 43200 && ar.b > 43200 - ar.s - 3600, "Abfahrt für Ankunft 12:00 unplausibel: "+JSON.stringify(ar));
  // keine Optionen-Zeile in der aufgeklappten Etappe; Zusammenfassung im Verkehrsmittel-Menü, Zurücksetzen
  await rp(`legOpen[cur+"|${li}"] = true; renderSheet();`); await page.waitForTimeout(100);
  ok(await page.locator(".lo-chip").count()===0, "Optionen-Knopf sollte nicht in der Etappe stehen");
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  ok((await page.locator("#jpMenu [data-act=loptopen]").innerText()).includes("Ankunft bis 12:00"), "Optionen im Menü nicht sichtbar");
  await click("#jpMenu [data-act=loptopen]"); await click("#catPop [data-act=loptreset]"); await click("#catPop [data-act=loptsave]");
  ok(await rp(`legGet("legOpt", dayLegs(cur)[${li}][1])===undefined`), "Zurücksetzen löscht die Optionen nicht");
});

await test("ÖPNV über NYC hinaus (Transitous): Etappe zum Flughafen Newark mit NJ Transit und AirTrain", async () => {
  await seed();
  // Polyline (Google-Kodierung, Genauigkeit 6) wie bei MOTIS
  const enc = (pts) => { let o = "", pla = 0, plo = 0; const e1 = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while(v >= 32){ s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    pts.forEach(([la, lo]) => { const a = Math.round(la*1e6), b = Math.round(lo*1e6); o += e1(a - pla) + e1(b - plo); pla = a; plo = b; }); return o; };
  const REQ = [];
  await page.route(/api\.transitous\.org/, rt => { const u = new URL(rt.request().url()); REQ.push(u.toString());
    const t0 = Date.parse(u.searchParams.get("time")), iso = (m) => new Date(t0 + m*60000).toISOString();
    const P = (n, la, lo, x) => Object.assign({name:n, lat:la, lon:lo, tz:"America/New_York"}, x||{});
    const it = {duration:3600, startTime:iso(5), endTime:iso(65), transfers:1, id:"i1", legs:[
      {mode:"WALK", from:P("Start", 40.7561, -73.9930), to:P("New York Penn Station", 40.7506, -73.9935), startTime:iso(5), endTime:iso(15), duration:600, distance:650, legGeometry:{points:enc([[40.7561,-73.9930],[40.7506,-73.9935]]), precision:6}},
      {mode:"REGIONAL_RAIL", routeShortName:"NEC", routeLongName:"Northeast Corridor", routeColor:"EF3E42", routeTextColor:"FFFFFF", headsign:"Trenton", agencyName:"NJ Transit",
       from:P("New York Penn Station", 40.7506, -73.9935), to:P("Newark Airport", 40.7046, -74.1906), startTime:iso(15), endTime:iso(42), duration:1620,
       intermediateStops:[P("Secaucus Junction", 40.7612, -74.0758), P("Newark Penn Station", 40.7347, -74.1644)],
       legGeometry:{points:enc([[40.7506,-73.9935],[40.7540,-74.0300],[40.7612,-74.0758],[40.7450,-74.1200],[40.7347,-74.1644],[40.7200,-74.1800],[40.7046,-74.1906]]), precision:6}},
      {mode:"OTHER", routeShortName:"AirTrain", routeColor:"", headsign:"Terminal C", agencyName:"Port Authority",
       from:P("Newark Airport", 40.7046, -74.1906), to:P("Terminal C", 40.6950, -74.1770), startTime:iso(50), endTime:iso(60), duration:600, intermediateStops:[P("Terminal A", 40.6890, -74.1820)],
       legGeometry:{points:enc([[40.7046,-74.1906],[40.6980,-74.1880],[40.6890,-74.1820],[40.6950,-74.1770]]), precision:6}},
      {mode:"WALK", from:P("Terminal C", 40.6950, -74.1770), to:P("Ziel", 40.6895, -74.1745), startTime:iso(60), endTime:iso(65), duration:300, distance:300}]};
    return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({itineraries:[it], direct:[]}) }); });
  await rp(`(function(){ var t = T(); t.places.pe = {id:"pe", n:"Flughafen Newark", c:"sight", la:40.6895, lo:-74.1745, list:"l_main", note:"", addr:"EWR"}; t.order[cur] = ["p1","p2","pe"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][1] && L[i][1].id==="pe") return i; } return -1; })()`);
  ok(li > -1, "Etappe zum Flughafen fehlt");
  ok(await rp(`extWanted(P("p2"), P("pe")) && !extWanted(P("p1"), P("p2"))`), "Zuständigkeit falsch: Newark muss über Transitous, Manhattan nicht");
  // Abfahrt 10:00 als Routenoption: Abfrage mit dieser Ortszeit
  await rp(`legSet("legOpt", P("pe"), {t:"dep", tm:"10:00"}); ALTCACHE = {}; renderSheet();`);
  await page.waitForFunction(i => window.__rp("(function(){ var L = dayLegs(cur)["+i+"]; return !!legRoute(L[0], L[1], cur).ext; })()"), li, {timeout:6000});
  const q = REQ.filter(u => u.includes("toPlace=40.689500,-74.174500")).pop() || "";
  ok(q.includes("/api/v5/plan?fromPlace=40.730800,-73.997300"), "Abfrage falsch: "+REQ.join(" "));
  ok(await rp(`tzSecs(Date.parse(new URL(${JSON.stringify(q)}).searchParams.get("time")), "America/New_York")`)===36000, "Abfragezeit ist nicht 10:00 Ortszeit");
  ok(!REQ.some(u => u.includes("toPlace=40.730800,-73.997300")), "Transitous für eine Manhattan-Etappe gefragt");
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], P("pe"))`)==="oepnv", "Etappe sollte ÖPNV sein");
  const r = await rp(`(function(){ var L = dayLegs(cur)[${li}], r = legRoute(L[0], L[1], cur), rd = r.legs.filter(function(l){ return l.t==="ride"; });
    return {n:rd.map(function(l){ return lineName(l.r); }), col:NET.r[rd[0].r][1], from:NET.s[rd[0].from][0], stops:rd[0].stops.length, path:ridePath(rd[0]).length, secs:r.secs, kind:extKind(rd[0].r)}; })()`);
  ok(r.n.join(">")==="NEC>AirTrain" && r.col==="#EF3E42" && r.from==="New York Penn Station" && r.kind==="Zug", "Verbindung falsch übernommen: "+JSON.stringify(r));
  ok(r.stops===4 && r.path===7, "Streckenverlauf nicht übernommen (Luftlinie?): "+JSON.stringify(r));
  ok(r.secs===3600, "Dauer falsch: "+r.secs);
  // NYC-Etappe bleibt beim eingebauten Netz
  ok(await rp(`!legRoute(P("p1"), P("p2"), cur).ext`), "Manhattan-Etappe nutzt Transitous");
  // Tagesplan: Linien, Abfahrt, Wegbeschreibung mit Fahrplanzeiten und Quelle
  await rp(`legOpen[cur+"|${li}"] = true; renderSheet();`); await page.waitForTimeout(150);
  const tx = await page.locator("li.tleg.lt").filter({hasText:"NEC"}).first().innerText();
  ok(tx.includes("AirTrain") && tx.includes("60 Min.") && tx.includes("10:15"), "Etappe zeigt Verbindung/Abfahrt nicht: "+tx.replace(/\n/g, " | "));
  ok(tx.includes("Newark Airport") && tx.includes("2 Stationen"), "Wegbeschreibung ohne Haltestellen: "+tx.replace(/\n/g, " | "));
  ok(tx.includes("10:42") && tx.includes("Zug Richtung Trenton"), "Ankunft/Richtung fehlt: "+tx.replace(/\n/g, " | "));
  ok(await page.locator("li.tleg.lt a[href*='transitous.org']").count()===1, "Quellenangabe Transitous fehlt");
  await shot("etappe-newark");
  // „Fahrt … zeigen“: Strecke auf der Karte, Karte und Ebenen bleiben deckungsgleich
  await page.locator("li.tleg.lt [data-act=lnmenu]").first().click(); await page.waitForTimeout(200);
  ok((await page.locator("#jpMenu [data-act=lineVshow]").innerText()).includes("Fahrt NEC zeigen"), "Menüpunkt „Fahrt zeigen“ fehlt");
  await page.locator("#jpMenu [data-act=lineVshow]").click(); await page.waitForTimeout(900);
  const lv = await rp(`(function(){ var E = []; try { lineVSvg(); } catch(e){ E.push(e.message); } return {lv:!!LINEV, e:E, txt:($("lineV")||{}).textContent||""}; })()`);
  ok(lv.lv && !lv.e.length, "Fahrt zeigen fehlerhaft: "+JSON.stringify(lv));
  // Karte: Fahrt mit Liniensymbol, Navigation nutzt die Verbindung
  await rp(`scheduleOverlay()`); await page.waitForTimeout(300);
  await rp(`me = {la:40.7308, lo:-73.9973, acc:8}; navStart(P("pe"), "oepnv");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.segs && NAV.segs.some(function(sg){ return sg.kind==="ride" && sg.ride.from==="New York Penn Station"; }))`), "Navigation nutzt die Verbindung nicht");
});

await test("Tickets: Fahrkarte je Etappe und Event-Ticket je Ort hinterlegen (Buchen noch nicht verfügbar)", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  await rp(`(function(){ var t = T(); t.places.p8 = {id:"p8", n:"Domino Park", c:"park", la:40.7144, lo:-73.9680, list:"l_main", note:"", addr:"River St"}; t.places.p9 = {id:"p9", n:"Kips Bay", c:"sight", la:40.7470, lo:-73.9760, list:"l_main", note:"", addr:"2nd Ave"}; t.order[cur] = ["p9","p8","p3"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  await page.waitForTimeout(200);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p9" && L[i][1] && L[i][1].id==="p8") return i; } return -1; })()`);
  ok(li > -1, "Etappe nicht gefunden");
  await rp(`(function(){ var L = dayLegs(cur)[${li}]; setLegMode(L[0], L[1], "oepnv"); renderSheet(); })()`);
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  await click("#jpMenu [data-act=tkleg]");
  ok(await visible("#catPop .tkpop"), "Ticket-Fenster fehlt");
  ok((await page.locator("#catPop a.tkbook").getAttribute("href")).indexOf("omny.info") > -1, "OMNY-Link fehlt");
  await click("#catPop [data-act=tkna]");
  ok((await page.locator("#toast").innerText()).includes("noch nicht verfügbar"), "Hinweis „noch nicht verfügbar“ fehlt");
  await click("#catPop [data-act=tknew]");
  await page.locator("#tkN").fill("7-Tage-Pass"); await page.locator("#tkC").fill("ABC123"); await page.locator("#tkU").fill("omny.info");
  await click("#catPop [data-act=tkst][data-v=ok]");
  ok(await page.locator("#tkN").inputValue()==="7-Tage-Pass", "Eingabe geht beim Statuswechsel verloren");
  await page.mouse.click(5, 5);
  ok(await visible("#catPop .tkform"), "Tippen daneben verwirft das Formular");
  await shot("ticket-form");
  await click("#catPop [data-act=tksave]");
  ok(await visible("#catPop .tkrow.ok"), "Gespeichertes Ticket fehlt in der Liste");
  ok((await page.locator("#catPop a.tkopen").getAttribute("href"))==="https://omny.info", "Link zum Ticket fehlt");
  const tk = await rp(`JSON.stringify(tkOn(tkLegOn(dayLegs(cur)[${li}][1])).map(function(x){ return [x.k, x.n, x.code, x.st, x.d===cur]; }))`);
  ok(tk===JSON.stringify([["transit","7-Tage-Pass","ABC123","ok",true]]), "Ticket falsch gespeichert: "+tk);
  ok(await rp(`privOf(T()) && pubOf(T()).tickets===undefined`), "Tickets dürfen nicht im öffentlichen Teil der Reise stehen");
  await click("#catPop [data-act=tkclose]");
  ok(await page.locator("#catPop").isHidden(), "Fenster schließt nicht");
  ok(await page.locator(`[data-act=lmpick][data-leg="${li}"].tk`).count()===1, "Etappe zeigt nicht, dass ein Ticket hinterlegt ist");
  // Ort: Event-Ticket über „Mehr“
  await rp(`(function(){ setSheet("mid"); select("p3"); })()`); await page.waitForTimeout(250);
  await click("#card [data-act=cardmore]");
  await click("#jpMenu [data-act=tkplace]");
  ok(await page.locator("#catPop a.tkbook").count()===0, "Bei Orten keine ÖPNV-Links");
  await click("#catPop [data-act=tknew]");
  await page.locator("#tkN").fill("Eintritt"); await page.locator("#tkT").fill("14:00");
  await click("#catPop [data-act=tksave]");
  ok(await rp(`tkOn("p:p3").length===1 && tkOn("p:p3")[0].k==="event" && tkOn("p:p3")[0].tm==="14:00"`), "Event-Ticket nicht gespeichert");
  // Abbrechen führt zur Liste zurück, Löschen mit Rückfrage
  await click("#catPop [data-act=tkedit]");
  await click("#catPop .pf-acts [data-act=tkback]");
  ok(await visible("#catPop [data-act=tknew]"), "Abbrechen führt nicht zur Liste zurück");
  await click("#catPop [data-act=tkedit]"); await click("#catPop [data-act=tkdel]");
  await click("#cfPop .cf-ok");
  ok(await rp(`tkOn("p:p3").length===0 && tkOn(tkLegOn(dayLegs(cur)[${li}][1])).length===1`), "Löschen entfernt das falsche Ticket");
  ok(await visible("#catPop .tkempty"), "Leere Liste nach dem Löschen fehlt");
  await shot("ticket-liste");
});

await test("Events: Ticketmaster-Termine am Ort und am Tag, Einplanen mit Uhrzeit und Ticket", async () => {
  await seed();
  const H = await rp(`cur`), N = await rp(`addD(cur, 1)`), REQ = [];
  await rp(`(function(){ tmKey = ""; EVC = {}; try { localStorage.removeItem("rp-tmkey"); } catch(e){} })()`);
  const ev = (id, n, d, tm, vn, la, lo, seg, x) => Object.assign({id, name:n, url:"https://www.ticketmaster.com/event/"+id, dates:{start:{localDate:d, localTime:tm+":00"}, status:{code:"onsale"}},
    classifications:[{segment:{name:seg}, genre:{name:"Rock"}}], priceRanges:[{type:"standard", currency:"USD", min:45.5, max:120}],
    _embedded:{venues:[{name:vn, location:{latitude:String(la), longitude:String(lo)}, address:{line1:"Teststraße 2"}, city:{name:"New York"}}]}}, x||{});
  await page.route(/app\.ticketmaster\.com/, rt => { const u = rt.request().url(); REQ.push(u);
    if(!u.includes("apikey=gut")) return rt.fulfill({ status:401, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:"{}" });
    return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body: JSON.stringify({_embedded:{events:[
      ev("E1", "Konzert im MoMA", H, "19:30", "MoMA", 40.7613, -73.9777, "Music"),
      ev("E3", "Abgesagte Show", H, "21:00", "Irgendwo", 40.7590, -73.9850, "Arts & Theatre", {dates:{start:{localDate:H, localTime:"21:00:00"}, status:{code:"cancelled"}}}),
      ev("E2", "Knicks – Celtics", N, "20:00", "Madison Square Garden", 40.7505, -73.9934, "Sports")]}}) }); });
  await rp(`(function(){ select(null); setSheet("full"); renderSheet(); })()`); await page.waitForTimeout(200);
  // ohne Schlüssel: Erklärung und Eingabe direkt im Fenster, falscher Schlüssel wird abgelehnt
  await click(".dh [data-act=evday]");
  ok(await visible("#catPop .evpop #evKeyIn"), "Schlüssel-Eingabe fehlt");
  await page.locator("#evKeyIn").fill("falsch"); await click("#catPop [data-act=evkeysave]");
  await page.waitForFunction(() => /lehnt/.test(document.querySelector("#catPop").innerText), null, {timeout:5000});
  await page.locator("#evKeyIn").fill("gut"); await click("#catPop [data-act=evkeysave]");
  await page.waitForSelector("#catPop .evrow", {timeout:5000});
  ok(await rp(`tmKey==="gut" && lsGet("rp-tmkey")==="gut"`), "Schlüssel nicht gespeichert");
  const q = new URL(REQ[REQ.length-1]);
  ok(q.searchParams.get("geoPoint") && q.searchParams.get("radius")==="5" && /T00:00:00Z$/.test(q.searchParams.get("startDateTime")), "Abfrage falsch: "+q.search);
  // Tag: nur Events dieses Tages, abgesagte durchgestrichen und nicht einplanbar
  ok(await page.locator("#catPop .evrow").count()===2, "Tagesliste zeigt Events anderer Tage");
  ok(await page.locator("#catPop .evrow.off [data-act=evplan]").count()===0, "Abgesagtes Event ist einplanbar");
  ok((await page.locator("#catPop .evrow").first().innerText()).includes("19:30"), "Uhrzeit fehlt");
  ok((await page.locator("#catPop .evrow a.tkopen").first().getAttribute("href"))==="https://www.ticketmaster.com/event/E1", "Link zu Ticketmaster fehlt");
  await shot("events-tag");
  // Einplanen: MoMA ist schon geplant → Uhrzeit setzen + geplantes Ticket, kein doppelter Ort
  const np = await rp(`Object.keys(T().places).length`);
  await click("#catPop .evrow [data-act=evplan]");
  ok(await rp(`timeOf("p3")==="19:30"`), "Uhrzeit nicht übernommen");
  ok(await rp(`Object.keys(T().places).length===${np}`), "Vorhandener Ort wurde doppelt angelegt");
  const tk = await rp(`JSON.stringify(tkOn("p:p3").map(function(x){ return [x.k, x.n, x.tm, x.st, x.ev, x.prov]; }))`);
  ok(tk===JSON.stringify([["event","Konzert im MoMA","19:30","plan","E1","Ticketmaster"]]), "Ticket falsch: "+tk);
  ok(await page.locator("#catPop .evrow.ok [data-act=evplan][aria-pressed=true]").count()===1, "Eingeplant wird nicht angezeigt");
  ok(await rp(`pubOf(T()).tickets===undefined`), "Event-Ticket im öffentlichen Teil");
  await click("#catPop [data-act=evclose]");
  ok(await page.locator("#catPop").isHidden(), "Fenster schließt nicht");
  // Ort → Mehr → Events: nur Termine an diesem Ort, im ganzen Reisezeitraum
  await rp(`(function(){ setSheet("mid"); select("p3"); })()`); await page.waitForTimeout(250);
  await click("#card [data-act=cardmore]"); await click("#jpMenu [data-act=evplace]");
  await page.waitForSelector("#catPop .evrow", {timeout:5000});
  ok(await page.locator("#catPop .evrow").count()===1 && (await page.locator("#catPop .evrow").innerText()).includes("Konzert im MoMA"), "Ort zeigt fremde Events");
  ok(await page.locator("#catPop .evpop .nt-sec").count()===1, "Datumsüberschrift fehlt");
  await shot("events-ort");
  await click("#catPop [data-act=evclose]");
  // neuer Veranstaltungsort: wird als Ort angelegt und am Event-Tag mit Uhrzeit eingeplant
  await rp(`(function(){ select(null); cur = "${N}"; setSheet("full"); renderAll(); })()`); await page.waitForTimeout(200);
  await click(".dh [data-act=evday]"); await page.waitForSelector("#catPop .evrow", {timeout:5000});
  await click("#catPop .evrow [data-act=evplan]");
  const msg = await rp(`(function(){ var o = ord("${N}"), id = o.filter(function(x){ return P(x).n==="Madison Square Garden"; })[0]; return id ? [P(id).c, timeOf(id), tkOn("p:"+id).length].join("|") : ""; })()`);
  ok(msg==="erlebnis|20:00|1", "Neuer Ort nicht richtig eingeplant: "+msg);
  ok((await page.locator("#toast").innerText()).includes("20:00"), "Hinweis mit Uhrzeit fehlt");
  await click("#toast [data-act=undo]");
  ok(await rp(`!ord("${N}").some(function(x){ return P(x) && P(x).n==="Madison Square Garden"; }) && !Object.keys(T().places).some(function(x){ return P(x).n==="Madison Square Garden"; })`), "Rückgängig lässt den neuen Ort stehen");
});

await test("Linie wählen: bei mehreren möglichen Linien (z. B. A/C/E) eine bestimmte festlegen", async () => {
  await seed();
  await rp(`(function(){ T().order[cur] = ["p2"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  await page.waitForTimeout(200);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][1] && L[i][1].id==="p2") return i; } return -1; })()`);
  ok(li > -1, "Etappe Hotel → Washington Square nicht gefunden");
  ok(await rp(`legHasChoice(legRoute(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1], cur))`), "Testetappe hat keine Fahrt mit mehreren Linien");
  await rp(`legOpen[cur+"|${li}"] = true; renderSheet();`); await page.waitForTimeout(150);
  // gewählte Verbindung nochmals antippen (oder die Linien in der Wegbeschreibung)
  if(await page.locator(`[data-act=legalt][data-leg="${li}"][aria-pressed=true]`).count()) await click(`[data-act=legalt][data-leg="${li}"][aria-pressed=true]`);
  else { await click(`[data-act=lnmenu][data-leg="${li}"]`); await click("#jpMenu [data-act=lnpick]"); await page.waitForTimeout(100); }
  const n = await page.locator("#jpMenu [data-act=lnset]").count();
  ok(n >= 3, "Linienauswahl fehlt ("+n+")");
  await shot("linie-waehlen");
  const nm = await page.locator("#jpMenu [data-act=lnset]").nth(2).getAttribute("data-v");
  await page.locator("#jpMenu [data-act=lnset]").nth(2).click(); await page.waitForTimeout(250);
  const r = await rp(`(function(){ var L = dayLegs(cur)[${li}], r = legRoute(L[0], L[1], cur), l = r.legs.filter(function(x){ return x.t==="ride" && x.lines0; })[0]; return l ? {n:lineName(l.r), alt:l.alt.length, all:l.lines0.length} : null; })()`);
  ok(r && r.n===nm && r.alt===1 && r.all > 1, "Linie nicht übernommen: "+JSON.stringify(r)+" erwartet "+nm);
  const sum = await page.locator(`li.tleg [data-act=legsel][data-leg="${li}"] .bul`).allInnerTexts();
  ok(sum.length===1 && sum[0]===nm, "Zusammenfassung zeigt nicht nur die gewählte Linie: "+sum.join(","));
  ok(await rp(`(function(){ var L = dayLegs(cur)[${li}], l = legRoute(L[0], L[1], cur).legs.filter(function(x){ return x.t==="ride" && x.lines0; })[0]; drawOverlay(); return ov.innerHTML.indexOf(NET.r[l.r][1]) > -1; })()`), "Karte zeigt die gewählte Linie nicht in ihrer Farbe");
  // zurück auf „Jede dieser Linien“
  await click(`[data-act=lnmenu][data-leg="${li}"]`); await click("#jpMenu [data-act=lnpick]"); await page.waitForTimeout(100);
  ok(await page.locator("#jpMenu [data-act=lnset]").count() >= 3, "Linie ändern aus dem Linien-Menü öffnet die Auswahl nicht");
  await page.locator("#jpMenu [data-act=lnset][data-v='']").click(); await page.waitForTimeout(200);
  ok(await rp(`legGet("legLine", dayLegs(cur)[${li}][1])===undefined`), "Auswahl lässt sich nicht zurücksetzen");
});

await test("Ganze Linie zeigen: Linie in der Wegbeschreibung antippen, Strecke von Endstation zu Endstation", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  await rp(`(function(){ T().order[cur] = ["p2"]; legsList = true; select(null); setSheet("full"); renderSheet(); })()`);
  await page.waitForTimeout(200);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][1] && L[i][1].id==="p2") return i; } return -1; })()`);
  ok(li > -1, "Etappe nicht gefunden");
  await rp(`legOpen[cur+"|${li}"] = true; renderSheet();`); await page.waitForTimeout(150);
  await click(`[data-act=lnmenu][data-leg="${li}"]`);
  ok(await page.locator("#jpMenu [data-act=lineVshow]").count() >= 1, "Menüpunkt „Ganze Linie zeigen“ fehlt");
  await click("#jpMenu [data-act=lineVshow]");
  const v = await rp(`(function(){ var r = legRoute(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1], cur), l = r.legs.filter(function(x){ return x.t==="ride"; })[0]; return LINEV ? {n:LINEV.st.length, ride:l.stops.length, inc:LINEV.st.indexOf(l.from) > -1 && LINEV.st.indexOf(l.to) > LINEV.st.indexOf(l.from)} : null; })()`);
  ok(v && v.inc && v.n > v.ride + 5, "Nicht die ganze Linie: "+JSON.stringify(v));
  ok(await visible("#lineV"), "Hinweis „Ganze Linie“ fehlt");
  ok((await page.locator("#lineV").innerText()).includes("Ganze Linie"), "Hinweistext fehlt");
  ok(await rp(`(drawOverlay(), ov.querySelectorAll(".lv circle").length > 3)`), "Stationen der Linie nicht auf der Karte");
  await shot("ganze-linie");
  await click("#lineV [data-act=lineVclose]");
  ok(await rp(`LINEV===null && !document.getElementById("lineV")`), "Ganze Linie lässt sich nicht ausblenden");
});

await test("Plus auf der Karte: Menü geht einmal auf und zuckt danach nicht erneut", async () => {
  await seed();
  await rp(`openAddPop(); true`);
  ok(await rp(`!document.getElementById("addMenu").hidden`), "Plus-Menü geht nicht auf");
  await page.waitForTimeout(500);   // fx-in ist entfernt – danach darf keine zweite Einblendung starten
  const st = await rp(`(function(){ var m = document.getElementById("addMenu"); return {cls:m.classList.contains("fx-in"), anim:getComputedStyle(m).animationName, run:m.getAnimations().length}; })()`);
  ok(!st.cls && st.anim==="none" && st.run===0, "Menü startet nach dem Aufgehen eine zweite Einblendung: "+JSON.stringify(st));
});

await test("Suche: Kategorien lassen sich direkt nach dem Öffnen (Tastatur offen) wischen", async () => {
  await seed();
  await rp(`openSearch(); true`); await page.waitForTimeout(150);
  ok(await rp(`document.activeElement && document.activeElement.id==="srchIn"`), "Eingabefeld nicht aktiv");
  // iOS nimmt das Wischen hier teils nicht an – dann wischt die App selbst. Nachgestellt mit Touch-Ereignissen ohne eigenes Scrollen des Browsers.
  const l = await rp(`(function(){ var el = document.getElementById("srCats"), r = el.getBoundingClientRect(), y = r.top + r.height/2, x0 = r.right - 30;
    function ev(type, x){ var t = new Touch({identifier:1, target:el, clientX:x, clientY:y}); el.dispatchEvent(new TouchEvent(type, {touches: type==="touchend" ? [] : [t], changedTouches:[t], bubbles:true, cancelable:true})); }
    el.scrollLeft = 0; ev("touchstart", x0); for(var i = 1; i <= 10; i++) ev("touchmove", x0 - i*15); ev("touchend", x0 - 150);
    return el.scrollLeft; })()`);
  ok(l > 60, "Kategorien lassen sich nicht wischen: scrollLeft "+l);
  ok(await rp(`document.activeElement && document.activeElement.id==="srchIn"`), "Wischen nimmt der Eingabe den Fokus");
});

await test("Suche: Ort und Umkreis einstellbar, weit entfernte Treffer ausgeblendet", async () => {
  await seed();
  globalThis.PHOTONREQ = [];
  await rp(`map.jumpTo({center:[-73.985, 40.758], zoom:13}); lsSet("rp-sr-rad", "10000"); srch.rad = 10000; srch.loc = {k:"map"}; openSearch();`); await page.waitForTimeout(150);
  ok(await visible("#srLoc [data-act=srlocpick]") && await visible("#srLoc [data-act=srradpick]"), "Ort/Umkreis-Auswahl fehlt");
  ok((await page.locator("#srLoc").innerText()).includes("10 km"), "Umkreis wird nicht angezeigt");
  await page.locator("#srchIn").fill("on store"); await page.waitForTimeout(900);
  let res = await page.locator("#srchRes").innerText();
  ok(res.includes("On Store Midtown") && !res.includes("Malaysia") && !res.includes("Rye"), "Treffer außerhalb von 10 km sichtbar: "+res.slice(0, 200));
  ok(PHOTONREQ.some(u => u.includes("bbox=")), "Websuche nutzt keinen Umkreis");
  // Umkreis 50 km: Rye (ca. 40 km) erscheint, Malaysia nicht
  await click("#srLoc [data-act=srradpick]"); await click("#jpMenu [data-act=srradset][data-v='50000']"); await page.waitForTimeout(900);
  res = await page.locator("#srchRes").innerText();
  ok(res.includes("Rye") && !res.includes("Malaysia"), "Umkreis 50 km wirkt nicht: "+res.slice(0, 200));
  ok(await rp(`lsGet("rp-sr-rad")`)==="50000", "Umkreis wird nicht gemerkt");
  // Anderer Ort: Brooklyn
  await click("#srLoc [data-act=srlocpick]");
  ok(await page.locator("#jpMenu [data-act=srlocset]").count() >= 3, "Kartenmitte / Mein Standort / Hotel fehlen");
  await page.locator("#srLocQ").fill("Brooklyn"); await page.waitForTimeout(800);
  await shot("suche-ort");
  await click("#jpMenu [data-act=srlocq]");
  ok((await page.locator("#srLoc").innerText()).includes("Brooklyn"), "Anderer Ort nicht übernommen");
  const c = await rp(`JSON.stringify(srchCenter())`);
  ok(c.includes("40.678") && c.includes("-73.944"), "Suchmitte nicht Brooklyn: "+c);
  // Hotel als Suchort
  await click("#srLoc [data-act=srlocpick]");
  await page.locator("#jpMenu [data-act=srlocset]", {hasText:"Hotel Test"}).click(); await page.waitForTimeout(200);
  ok(await rp(`srch.loc.k==="hotel" && Math.abs(srchCenter().la - 40.7561) < 1e-4`), "Hotel als Suchort funktioniert nicht");
  await rp(`lsSet("rp-sr-loc", ""); lsSet("rp-sr-rad", "")`);
});

await test("Wegpunkte lenken auch U-Bahn & Bus: Route führt durch den Wegpunkt", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p2" && L[i][1] && L[i][1].id==="p3") return i; } return -1; })()`);
  ok(li > -1, "Etappe Washington Square → MoMA nicht gefunden");
  // Wegpunkt am Barclays Center (Brooklyn): die Fahrt muss dorthin und wieder zurück
  const r = await rp(`(function(){ var L = dayLegs(cur)[${li}]; setLegMode(L[0], L[1], "oepnv"); var r0 = legRoute(L[0], L[1], cur);
    setLegVia(L[0], L[1], [[40.6826, -73.9754]]); ALTCACHE = {}; var r = legRoute(L[0], L[1], cur), W = {la:40.6826, lo:-73.9754};
    var wp = r.legs.filter(function(l){ return l.wp===1; })[0], rides = r.legs.filter(function(l){ return l.t==="ride"; });
    var near = rides.some(function(l){ return dist(stLL(l.to), W) < 800; }) && rides.some(function(l){ return dist(stLL(l.from), W) < 800; });
    legsList = true; legOpen[cur+"|${li}"] = true; renderSheet(); drawOverlay();
    return {walk:r.walk, wp:!!(wp && wp.pt), near:near, rides:rides.length, s0:r0.secs, s1:r.secs}; })()`);
  ok(!r.walk && r.wp && r.near && r.rides >= 2, "Route führt nicht durch den Wegpunkt: "+JSON.stringify(r));
  ok(r.s1 > r.s0 + 600, "Umweg über den Wegpunkt fehlt in der Dauer: "+JSON.stringify(r));
  ok((await page.locator(".rt .rt-wp").first().innerText()).includes("Wegpunkt 1"), "Wegpunkt fehlt in der Wegbeschreibung");
  await shot("oepnv-wegpunkt");
});

await test("Auto als Verkehrsmittel: Etappe mit Fahrweg, Karte, Navigation", async () => {
  await seed();
  OSRMREQ.length = 0;
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p2" && L[i][1] && L[i][1].id==="p3") return i; } return -1; })()`);
  ok(li > -1, "Etappe nicht gefunden");
  await rp(`legsList = true; select(null); setSheet("full"); renderSheet();`); await page.waitForTimeout(150);
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=lmode][data-mode=car]").count()===1, "Auto fehlt im Menü");
  await page.locator("#jpMenu [data-act=lmode][data-mode=car]").click(); await page.waitForTimeout(900);
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1])`)==="car", "Auto-Modus nicht gespeichert");
  ok(OSRMREQ.some(u => u.includes("routed-car/route")), "Fahrweg wird nicht berechnet");
  const leg = await page.locator(".leg.lcar").first().innerText();
  ok(leg.includes("7 Min.") && leg.includes("mit dem Auto"), "Auto-Etappe falsch: "+leg);
  ok(await rp(`(drawOverlay(), ov.innerHTML.length > 0) && !!carPath(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1], [])`), "Fahrweg nicht übernommen");
  await rp(`me = {la:40.7308, lo:-73.9973, acc:8}; navStart(P("p3"), "car");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.segs && NAV.segs[0].kind==="car")`), "Navigation mit dem Auto fehlt");
  ok(OSRMREQ.some(u => u.includes("routed-car/route") && u.includes("steps=true")), "Navigation nutzt nicht den Auto-Router");
});

await test("3D-Navigation: geneigte Karte, Weg unter den Gebäuden, 3D-Pfeil, Schalter 2D/3D, ÖPNV flach", async () => {
  await seed();
  await rp(`lsSet("rp-nav-3d", "1"); nav3d = true; me = {la:40.7215, lo:-73.9890, acc:8}; navStart({la:40.7280, lo:-73.9960, n:"Bleecker"}, "walk");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  await rp(`NAV.follow = true; navFollow(true);`); await page.waitForFunction(() => window.__rp("map.getPitch() > 40 && !map.isMoving()"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`nav3dOn()`), "3D nicht aktiv beim Gehen");
  ok(await rp(`map.getPitch()`) > 40, "Karte nicht geneigt: "+await rp(`map.getPitch()`));
  ok(await rp(`map.getSource("nv3-rt") && map.getSource("nv3-rt")._data.geometry.coordinates.length > 2`), "Weg nicht als Kartenebene");
  ok(await rp(`navSvg()===""`), "Flacher Weg wird im 3D-Modus zusätzlich gezeichnet");
  // nah an der Abbiegung: 3D-Pfeil erscheint
  await rp(`(function(){ var t = NAV.steps.filter(function(x){ return x.turn; })[0]; var q = navAt(NAV, NAV.cum[t.i] - 30); me = {la:q.la, lo:q.lo, acc:5}; navOnPos(); })()`);
  await page.waitForTimeout(800);
  ok(await rp(`NAV.arrowFor!=null && map.getSource("nv3-arrow")._data.geometry.type==="Polygon"`), "3D-Pfeil fehlt vor der Abbiegung");
  await page.waitForFunction(() => window.__rp(`map.getPaintProperty("nv3-arrow", "fill-extrusion-height") > 1`), null, {timeout:4000}).catch(() => {});
  ok(await rp(`map.getPaintProperty("nv3-arrow", "fill-extrusion-height") > 1`), "3D-Pfeil wächst nicht heraus");
  const sd = await rp(`(function(){ var t = NAV.steps.filter(function(x){ return x.turn; })[0]; return NAV.cum[t.i] - NAV.s; })()`);
  ok(sd > 20 && sd < 40, "Position entlang des Wegs ungenau ("+sd+" m vor der Kurve, erwartet ca. 30)");
  await shot("nav-3d");
  // Schalter: 2D
  ok(await page.locator("#navUi [data-act=nav3d]").count()===1, "2D/3D-Schalter fehlt");
  await click("#navUi [data-act=nav3d]");
  await page.waitForFunction(() => window.__rp("map.getPitch() < 5 && !map.isMoving()"), null, {timeout:5000}).catch(() => {});
  ok(!(await rp(`nav3dOn()`)) && await rp(`map.getPitch()`) < 5, "2D schaltet nicht zurück");
  ok(await rp(`lsGet("rp-nav-3d")`)==="0", "Wahl wird nicht gemerkt");
  await click("#navUi [data-act=nav3d]"); await page.waitForTimeout(300);
  // ÖPNV: kein 3D
  await rp(`navStart({la:40.7680, lo:-73.9819, n:"Columbus Circle"}, "oepnv");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  ok(!(await rp(`nav3dOn()`)) && await page.locator("#navUi [data-act=nav3d]").count()===0, "ÖPNV sollte flach bleiben");
  await rp(`navEnd(true)`); await page.waitForFunction(() => window.__rp("map.getPitch() < 5 && !map.isMoving()"), null, {timeout:10000}).catch(() => {});
  ok(await rp(`map.getPitch()`) < 5, "Nach dem Ende bleibt die Karte geneigt");
});

await test("Chat: Sprachnachricht gedrückt halten, links abbrechen, oben feststellen, abspielen mit Wellenform", async () => {
  await seed();
  // Mikrofon nachbilden: Ton aus einem Oszillator; Firestore nachbilden: gesendete Dokumente in __set, Ton-Dokumente per get
  await rp(`window.__set = []; window.__M = [{id:"m1", from:"u1", t:"Hallo", at:Date.now() - 60000}];
    navigator.mediaDevices.getUserMedia = function(){ var c = new AudioContext(), o = c.createOscillator(), g = c.createGain(), d = c.createMediaStreamDestination(); o.frequency.value = 330; g.gain.value = 0.6; o.connect(g); g.connect(d); o.start(); return Promise.resolve(d.stream); };
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; }, n = 0;
    var ref = function(id){ return {id:id, get:function(){ var x = __set.filter(function(s){ return s.id===id; })[0]; return Promise.resolve({exists:!!x, data:function(){ return x && x.d; }}); }, update:function(){ return Promise.resolve(); }}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ var L = []; return {set:function(r, d){ L.push({id:r.id, d:d}); }, update:function(){}, commit:function(){ __set = __set.concat(L); return Promise.resolve(); }}; },
      collection:function(){ return {doc:function(cid){ var r = ref(cid); r.collection = function(nm){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, doc:function(id){ return ref(id || "d"+(++n)); }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ if(nm!=="msgs" || cid!=="u1_u_me") return function(){}; window.__snap = function(){ cb(qs()); }; setTimeout(__snap, 0); return function(){}; }}; return q; }; return r; }}; }};
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, names:{u1:"Anna"}, read:{u_me:Date.now()}, last:{t:"Hallo", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true; CHPROF.u1 = {name:"Anna"};
    delete CHMC.u1_u_me; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===1`), null, {timeout:4000});
  // leer: Aufnahme-Knopf statt Senden; mit Text: Senden
  ok(await visible("#chView .ch-rec") && !(await visible("#chView .ch-send")), "Leere Eingabe zeigt nicht den Aufnahme-Knopf");
  ok(await rp(`var d = document.createElement("div"); d.innerHTML = ic("voice", "vi"); document.querySelector("#chView .ch-rec svg.vi").outerHTML===d.firstChild.outerHTML`), "Aufnahme-Knopf nutzt nicht das Symbol IC.voice");
  await page.fill("#chIn", "Text"); ok(await visible("#chView .ch-send") && !(await visible("#chView .ch-rec")), "Mit Text bleibt der Aufnahme-Knopf statt Senden");
  await page.fill("#chIn", ""); ok(await visible("#chView .ch-rec"), "Nach dem Löschen kein Aufnahme-Knopf");
  const cdp = await page.context().newCDPSession(page);
  const tStart = (x, y) => cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x, y}]});
  const tMove = async (x, y) => { await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x, y}]}); await page.waitForTimeout(30); };
  const tEnd = () => cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
  await rp(`document.activeElement && document.activeElement.blur(); true`);
  // Eingabezeile gleitet nach dem Schließen der Tastatur zurück: warten, bis der Knopf unten still steht
  let rb = null;
  for(let i = 0; i < 60; i++){ await page.waitForTimeout(150);
    const r = await page.evaluate(() => { const r = document.querySelector("#chView .ch-rec").getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2, b:r.bottom > innerHeight - 70}; });
    if(rb && r.b && r.x===rb.x && r.y===rb.y) break; rb = r; }
  const vos = () => rp(`__set.filter(function(s){ return s.d && s.d.vo; }).length`);
  // 1) gedrückt halten → Aufnahme läuft (Zeit, Live-Wellenform, Abbrechen-Hinweis), loslassen → gesendet
  await tStart(rb.x, rb.y);
  await page.waitForFunction(() => window.__rp(`!!VR && VR.st==="rec"`), null, {timeout:8000, polling:100}).catch(async e => { throw new Error("Warten 1: "+e.message); });
  await page.waitForTimeout(1600);
  ok(await visible("#chVRec") && await rp(`$("chVRec").querySelectorAll(".ch-vlive i").length > 5 && /0:0[1-4]/.test($("chVRec").querySelector(".ch-vtm").textContent) && $("chVRec").textContent.includes("Abbrechen")`), "Aufnahme-Leiste fehlt oder ohne Zeit/Wellenform: "+await rp(`$("chVRec").textContent`));
  ok(await visible("#chView .ch-vlk"), "Hinweis zum Feststellen fehlt");
  await shot("sprachnachricht-aufnahme");
  await tEnd();
  await page.waitForFunction(() => window.__rp(`__set.some(function(s){ return s.d && s.d.vo; })`), null, {timeout:4000});
  const sent = await rp(`var m = __set.filter(function(s){ return s.d && s.d.vo; })[0].d, a = __set.filter(function(s){ return s.id===m.vo.id; })[0], c = __set.filter(function(s){ return s.d && s.d.last; })[0].d;
    ({d:m.vo.d, n:m.vo.n, wv:m.vo.wv, mt:m.vo.mt, at:!!m.at, from:m.from, aud:a && a.d.aud.slice(0, 11), audAt:a && ("at" in a.d), audFrom:a && a.d.from, last:c.last.t, idle:!VR && $("chVRec").hidden})`);
  ok(sent.d >= 1.3 && sent.d < 4 && sent.n===1 && /^[0-9]{18,40}$/.test(sent.wv) && /[5-9]/.test(sent.wv) && /^audio\//.test(sent.mt) && sent.at && sent.from==="u_me", "Nachricht falsch: "+JSON.stringify(sent));
  ok(sent.aud==="data:audio/" && sent.audAt===false && sent.audFrom==="u_me", "Ton-Dokument falsch (ohne „at“, mit from): "+JSON.stringify(sent));
  ok(/^Sprachnachricht · 0:0\d$/.test(sent.last) && sent.idle, "Chat-Übersicht/Zustand nach dem Senden falsch: "+JSON.stringify(sent));
  // 2) nach links ziehen → verworfen
  await tStart(rb.x, rb.y); await page.waitForFunction(() => window.__rp(`!!VR && VR.st==="rec"`), null, {timeout:8000, polling:100}).catch(e => { throw new Error("Warten 2: "+e.message); }); await page.waitForTimeout(900);
  for(const d of [20, 50, 90, 130]) await tMove(rb.x - d, rb.y);
  await tEnd(); await page.waitForTimeout(500);
  ok(await vos()===1 && await rp(`!VR && $("chVRec").hidden`), "Nach links ziehen verwirft die Aufnahme nicht");
  // 3) nach oben ziehen → festgestellt, läuft nach dem Loslassen weiter; Knopf sendet
  await tStart(rb.x, rb.y); await page.waitForFunction(() => window.__rp(`!!VR && VR.st==="rec"`), null, {timeout:8000, polling:100}).catch(e => { throw new Error("Warten 3: "+e.message); }); await page.waitForTimeout(400);
  for(const d of [20, 50, 90]) await tMove(rb.x, rb.y - d);
  await tEnd(); await page.waitForTimeout(800);
  ok(await rp(`!!VR && VR.st==="lock" && document.querySelector("#chView .ch-comp").classList.contains("vlock") && !!$("chVRec").querySelector("[data-act=vrdel]")`), "Nach oben ziehen stellt die Aufnahme nicht fest");
  await shot("sprachnachricht-festgestellt");
  await tStart(rb.x, rb.y); await tEnd();
  await page.waitForFunction(() => window.__rp(`__set.filter(function(s){ return s.d && s.d.vo; }).length===2`), null, {timeout:4000});
  ok(await rp(`!VR && $("chVRec").hidden`), "Senden im festgestellten Zustand beendet die Aufnahme nicht");
  // 4) kurz tippen: nichts gesendet, Hinweis
  await tStart(rb.x, rb.y); await page.waitForTimeout(150); await tEnd(); await page.waitForTimeout(500);
  ok(await vos()===2 && await rp(`!VR`), "Kurzes Tippen sendet oder hängt");
  await cdp.detach();
  // 5) Abspielen: Sprachnachricht von Anna (Ton nicht im Speicher → aus Firestore), Wellenform, Dauer, Stelle wählen
  await rp(`var m = __set.filter(function(s){ return s.d && s.d.vo; })[0].d; __set.push({id:"vo_anna", d:{from:"u1", aud:__set.filter(function(s){ return s.id===m.vo.id; })[0].d.aud, i:0, n:1, mt:m.vo.mt}});
    __M.push({id:"m2", from:"u1", t:"", at:Date.now(), vo:{id:"vo_anna", n:1, d:m.vo.d, mt:m.vo.mt, wv:"1357975311357975"}}); __snap(); true`);
  await page.waitForTimeout(200);
  const v = '#chMsgs .ch-msg[data-mid="m2"] .ch-vo';
  ok(await rp(`var e = document.querySelector('${v}'); !!e && e.querySelectorAll(".ch-vw i").length===16 && /^0:0\\d$/.test(e.querySelector(".ch-vt").textContent)`), "Sprachnachricht ohne Wellenform/Dauer");
  await page.tap(v+" .ch-vp");
  await page.waitForFunction(() => window.__rp(`VP.mid==="m2" && VP.ok && !VP.el.paused`), null, {timeout:4000});
  await page.waitForTimeout(500);
  ok(await rp(`document.querySelector('${v}').classList.contains("pl") && document.querySelectorAll('${v} .ch-vw i.on').length > 0`), "Abspielen zeigt keinen Fortschritt");
  await shot("sprachnachricht-abspielen");
  await page.tap(v+" .ch-vp"); await page.waitForTimeout(150);
  ok(await rp(`VP.el.paused && !document.querySelector('${v}').classList.contains("pl")`), "Anhalten geht nicht");
  ok(await rp(`chReText(chMsgs.filter(function(m){ return m.id==="m2"; })[0]).indexOf("Sprachnachricht")===0`), "Antworten-Zitat einer Sprachnachricht falsch");
  ok(!errs.length, "Fehler: "+errs.join(" | "));
  await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: geteiltes Foto öffnet Ort und Foto, auch wenn Reise-Kennung nicht passt", async () => {
  await seed();
  // Nachricht mit fremder Reise-Kennung und veralteter Orts-Kennung, Foto liegt aber in der Reise
  const r = await rp(`(function(){ CHPH.k1 = {ph:"ph_a", pid:"pX", gid:"t_alt_123", n:"Brooklyn Bridge", trip:"Testreise"};
    CHPH.k2 = {ph:"ph_zz", pid:"pY", gid:gidFor("t_test"), n:"MoMA", trip:"Testreise"};
    var a = chFindPh(CHPH.k1), b = chFindPh(CHPH.k2), c = chFindPh({ph:"nix", pid:"nix", gid:"x", n:"Gibt es nicht"});
    return {a:a && a.pid, b:b && b.pid, c:c}; })()`);
  ok(r.a==="p4" && r.b==="p3" && r.c===null, "Zuordnung falsch: "+JSON.stringify(r));
  await rp(`chPhOpen("k1")`); await page.waitForTimeout(250);
  ok(await rp(`sel`)==="p4", "Ort öffnet nicht auf der Karte");
  await rp(`chPhOpen("k1", true)`); await page.waitForTimeout(300);
  ok(await rp(`!!($("chPvImg") && $("chPvImg").src.indexOf("data:image") === 0)`), "Foto öffnet nicht");
  ok(!(await page.locator("#chPhView").innerText()).includes("nicht mit dir geteilt"), "Falscher Hinweis „nicht geteilt“");
  // als Foto gespeicherter Ort (Vorschaubild in .ph, ältere Version): wird als Ort angezeigt, kein Fehler
  const fx = await rp(`(function(){ var m = chNorm({id:"m9", photo:{ph:"data:image/jpeg;base64,AAA//BBB", n:"Katz Deli", c:"essen", la:40.7223, lo:-73.9874, trip:"Testreise"}});
    var h = (m.photo ? chPhotoCard(m.photo, "m9") : "")+(m.place ? chPlaceCard(m.place, "m9") : "");
    return {place:!!m.place, photo:!!m.photo, img:h.indexOf("data-ph=") < 0, isPh:chIsPhoto({ph:"ph_a", pid:"p4"}), draftPl:chIsPhoto({ph:"data:image/png;base64,x", n:"A"})}; })()`);
  ok(fx.place && !fx.photo && fx.img && fx.isPh && !fx.draftPl, "Ort mit Vorschaubild wird als Foto behandelt: "+JSON.stringify(fx));
  // Vorschau ohne Daumennagel lädt das Foto nach
  const h = await rp(`chPhotoCard({ph:"ph_b", n:"Brooklyn Bridge", c:"sight"}, "k3")`);
  ok(h.includes('data-ph="ph_b"'), "Foto ohne Vorschaubild wird nicht nachgeladen");
});

await test("Chat: Foto einer Ort-Karte öffnet die Fotogalerie des Orts, Wischen folgt dem Finger", async () => {
  await seed();
  // gesendete Karte trägt Kennungen der sichtbaren Fotos, private Fotos nicht
  const pl = await rp(`(function(){ T().privPh = {ph_b:1}; return chPlaceFrom(S.cur, "p4").then(function(pl){ delete T().privPh; return pl; }); })()`);
  ok(pl.pid==="p4" && JSON.stringify(pl.phs)==='["ph_a"]' && !!pl.ph, "Karte ohne Foto-Kennungen oder mit privatem Foto: "+JSON.stringify({pid:pl.pid, phs:pl.phs}));
  // Karte im Chat antippen: Galerie mit allen Fotos des Orts aus der Reise, blättern per Knopf
  await rp(`(function(){ CHPL.m5 = {n:"Brooklyn Bridge", c:"sight", la:P("p4").la, lo:P("p4").lo, pid:"p4", gid:gidFor(S.cur), phs:["ph_b"], ph:PHC.ph_b, trip:"Testreise"};
    var d = document.createElement("div"); d.id = "tstCh"; d.style.cssText = "position:fixed;left:0;top:60px;z-index:95"; d.innerHTML = chPlaceCard(CHPL.m5, "m5"); document.body.appendChild(d); })()`);
  await click("#tstCh .ch-plimg");
  await page.waitForFunction(() => window.__rp(`!$("chPhView").hidden && !!$("chPvImg").src`), null, {timeout:3000}).catch(() => {});
  ok(await rp(`!$("chPhView").hidden && CHGAL && CHGAL.list.join()==="ph_a,ph_b" && CHGAL.i===1`), "Galerie öffnet nicht mit beiden Fotos beim geschickten Foto: "+JSON.stringify(await rp(`CHGAL && {l:CHGAL.list, i:CHGAL.i}`)));
  ok((await page.locator("#chPhView .chpv-cap").innerText()).includes("2 / 2"), "Zähler fehlt");
  ok(await rp(`document.querySelector("#chPhView .chpv-nav.n").hidden && document.querySelectorAll("#chPhView .chpv-sl img").length===2`), "Am letzten Foto: Weiter-Pfeil oder Nachbarfoto falsch");
  // Wischen folgt dem Finger: mitten im Ziehen sind beide Fotos zu sehen, beim Loslassen rastet das vorherige ein
  const mid = await page.evaluate(() => { const el = document.getElementById("chPhView");
    const T = (x) => new Touch({identifier:1, target:el, clientX:x, clientY:400});
    el.dispatchEvent(new TouchEvent("touchstart", {touches:[T(100)], changedTouches:[T(100)], bubbles:true}));
    el.dispatchEvent(new TouchEvent("touchmove", {touches:[T(120)], changedTouches:[T(120)], bubbles:true}));
    el.dispatchEvent(new TouchEvent("touchmove", {touches:[T(260)], changedTouches:[T(260)], bubbles:true}));
    const ims = [...el.querySelectorAll(".chpv-sl img")].map(i => { const r = i.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; });
    const tf = el.querySelector(".chpv-row").style.transform;
    el.dispatchEvent(new TouchEvent("touchend", {touches:[], changedTouches:[T(260)], bubbles:true}));
    return {vis:ims.filter(Boolean).length, tf}; });
  ok(mid.vis===2 && mid.tf.includes("160px"), "Beim Ziehen nicht beide Fotos sichtbar: "+JSON.stringify(mid));
  await page.waitForFunction(() => window.__rp(`CHGAL && CHGAL.i===0 && !CHGAL.anim`), null, {timeout:3000}).catch(() => {});
  ok(await rp(`CHGAL.i===0 && $("chPvImg").src===PHC.ph_a && !$("chPhView").hidden && (document.querySelector("#chPhView .chpv-cap").textContent||"").includes("1 / 2")`), "Wischen rastet nicht beim vorherigen Foto ein");
  // Pfeil: zurück zum zweiten Foto
  await click("#chPhView .chpv-nav.n");
  await page.waitForFunction(() => window.__rp(`CHGAL.i===1 && !CHGAL.anim`), null, {timeout:3000}).catch(() => {});
  ok(await rp(`CHGAL.i===1 && $("chPvImg").src===PHC.ph_b`), "Pfeil blättert nicht");
  await click("#chPhView .chpv-x"); ok(await rp(`$("chPhView").hidden`), "Schließen geht nicht");
  // Ort nicht in eigenen Reisen, Foto nicht freigegeben: nur das Vorschaubild der Karte
  await rp(`CHPL.m6 = {n:"Fremder Ort", c:"essen", la:1, lo:1, pid:"pQ", gid:"t_fremd", phs:["ph_geheim"], ph:PHC.ph_c, trip:"Andere Reise"}; $("tstCh").innerHTML = chPlaceCard(CHPL.m6, "m6");`);
  await click("#tstCh .ch-plimg"); await page.waitForTimeout(300);
  ok(await rp(`!$("chPhView").hidden && $("chPvImg").src===PHC.ph_c && !document.querySelector("#chPhView .chpv-nav")`), "Nicht freigegebenes Foto: Vorschaubild fehlt");
  await click("#chPhView .chpv-x"); await rp(`$("tstCh").remove()`);
  // Entwurf (noch nicht gesendet) ist nicht antippbar
  ok(!(await rp(`chPlaceCard(CHPL.m5, "", true)`)).includes("chplph"), "Entwurf sollte keine Galerie öffnen");
});

await test("Privat, aber für einzelne Beobachter freigegeben", async () => {
  await seed();
  await rp(`(function(){ META.t_test = {owner:"u_me", members:["u_me","u_anna","u_ludwig"], memberEmails:{u_anna:"anna@test.de", u_ludwig:"ludwig@test.de"}, invites:[], viewers:["u_anna","u_ludwig"], viewInvites:[]};
    var t = T(); t.privP = {p1:1}; t.photos.p1 = ["ph_c1"]; t.notes = t.notes || {}; t.notes.p1 = "Geheimtipp"; t.notes.p2 = "Nur für Anna"; t.privN = {p2:1}; save(); })()`);
  // Menü am privaten Ort: Liste der Beobachter
  await rp(`openPlaceVis("p1", document.querySelector("#sheet") || document.body)`); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=privto]").count()===2, "Beobachter-Auswahl fehlt im Sichtbarkeits-Menü");
  await shot("privat-freigabe");
  await page.locator("#jpMenu [data-act=privto][data-uid=u_anna]").click(); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu").count()===1, "Menü schließt beim Ankreuzen");
  ok(await rp(`JSON.stringify(T().privTo)`)==='{"p:p1":["u_anna"]}', "Freigabe nicht gespeichert: "+await rp(`JSON.stringify(T().privTo)`));
  ok(await rp(`JSON.stringify(phShareTo("ph_c1"))`)==='["u_anna"]', "Foto des freigegebenen Orts nicht für Anna lesbar");
  // im Orts-Fenster direkt unter „Sichtbarkeit“
  await rp(`closeJpMore(); openJPop("p1", cur);`); await page.waitForTimeout(250);
  ok(await page.locator("#jPop [data-act=privtopick]").count()===1, "Dropdown „Freigegeben für“ fehlt im Orts-Fenster");
  ok((await page.locator("#jPop [data-act=privtopick]").innerText()).includes("@anna"), "Bestehende Freigabe nicht angezeigt");
  ok((await page.locator("#jPop [data-act=privtopick]").boundingBox()).height < 60, "Freigabe-Zeile zu hoch (soll eine Zeile sein)");
  await click("#jPop [data-act=privtopick]");
  ok(await page.locator("#jpMenu [data-act=privto]").count()===2, "Dropdown zeigt nicht alle Beobachter");
  await page.locator("#jpMenu [data-act=privto][data-uid=u_ludwig]").click(); await page.waitForTimeout(200);
  ok(await page.locator("#jpMenu").count()===1, "Dropdown schließt beim Ankreuzen (Mehrfachauswahl)");
  ok(await rp(`JSON.stringify(T().privTo["p:p1"])`)==='["u_anna","u_ludwig"]', "Freigabe im Dropdown wirkt nicht");
  ok((await page.locator("#jPop [data-act=privtopick]").innerText()).includes("2 Beobachtern"), "Zeile zeigt Auswahl nicht an");
  await shot("privat-freigabe-dropdown");
  await page.locator("#jpMenu [data-act=privto][data-uid=u_ludwig]").click(); await page.waitForTimeout(200);
  ok(await rp(`JSON.stringify(T().privTo["p:p1"])`)==='["u_anna"]', "Freigabe lässt sich nicht zurücknehmen");
  await rp(`closeJpMore()`);
  // ⋯-Menü: kein doppelter Privat-Schalter mehr (Sichtbarkeit steht im Fenster)
  await click("#jPop [data-act=jpmore]");
  ok(await page.locator("#jpMenu [data-act=privp]").count()===0 && await page.locator("#jpMenu [data-act=grppick]").count()===1, "⋯-Menü sollte Gruppe, aber keinen Privat-Schalter zeigen");
  await rp(`closeJpMore()`);
  // „Auch öffentlich“ als Schalter: Aus-Zustand klar erkennbar
  await rp(`var t = T(), r = rootOf("p1"); (t.privP||{})[r] = false; t.pubP = t.pubP || {}; t.pubP[r] = true; t.pubA = t.pubA || {}; delete t.pubA[r]; openJPop("p1", cur);`); await page.waitForTimeout(250);
  const va = page.locator("#jPop .vis-all");
  ok(await va.count()===1 && await va.getAttribute("role")==="switch" && await va.getAttribute("aria-checked")==="false", "„Auch öffentlich“ ist kein Schalter im Aus-Zustand");
  ok((await va.innerText()).includes("Aus") && await page.locator("#jPop .vis-all .sw-mini:not(.on)").count()===1, "Aus-Zustand von „Auch öffentlich“ nicht erkennbar");
  await rp(`T().pubA[rootOf("p1")] = true; openJPop("p1", cur);`); await page.waitForTimeout(250);
  ok(await page.locator("#jPop .vis-all.on[aria-checked=true] .sw-mini.on").count()===1 && (await page.locator("#jPop .vis-all").innerText()).includes("An"), "An-Zustand von „Auch öffentlich“ fehlt");
  await rp(`var t = T(), r = rootOf("p1"); delete t.pubA[r]; delete t.pubP[r]; closeJPop && closeJPop();`);
  await rp(`closeJPop ? closeJPop() : ($("jPop").hidden = true)`);
  // Notiz-Freigabe auf öffentlichem Ort
  await rp(`closeJpMore(); setPrivTo("n", "p2", "u_ludwig", true);`);
  const r = await rp(`(function(){ var M = T(), pub = pubOf(M), a = shareFor(M, "u_anna"), l = shareFor(M, "u_ludwig"), x = shareFor(M, "u_x");
    var ma = shareMerge(pub, a), ml = shareMerge(pub, l), dk = Object.keys(M.order).filter(function(k){ return (M.order[k]||[]).indexOf("p1") > -1; })[0];
    return {pubHas:!!pub.places.p1, pubTo:!!pub.privTo, pubNote:pub.notes && pub.notes.p2!=null,
      annaP1:!!ma.places.p1, annaNote:ma.notes.p1, annaPh:(ma.photos.p1||[]).length, annaOrder:(ma.order[dk]||[]).indexOf("p1") > -1, annaP2note:ma.notes.p2!=null,
      ludP1:!!ml.places.p1, ludNote:ml.notes.p2, none:x===null}; })()`);
  ok(!r.pubHas && !r.pubTo && !r.pubNote, "Privates gelangt in den öffentlichen Stand: "+JSON.stringify(r));
  ok(r.annaP1 && r.annaNote==="Geheimtipp" && r.annaPh===1 && r.annaOrder && !r.annaP2note, "Anna bekommt den Ort nicht richtig: "+JSON.stringify(r));
  ok(!r.ludP1 && r.ludNote==="Nur für Anna", "Ludwig bekommt falsche Inhalte: "+JSON.stringify(r));
  ok(r.none, "Nicht freigegebener Beobachter bekommt etwas");
});

await test("Fußweg mit Wegpunkten: echter Weg auch wenn ein Teilstück fehlt, beim Gehen kein Rückfall auf Luftlinie", async () => {
  globalThis.FOOTMOCK = true;
  try {
    await seed();
    OSRMREQ.length = 0;
    // Etappe mit zwei Wegpunkten, einer davon „im Wasser“ (kein Weg dorthin)
    const r = await rp(`(function(){ var a = {la:40.7215, lo:-73.9890, id:"me"}, b = {la:40.7300, lo:-73.9950}, v = [[40.7240, -73.9900], [40.7270, -73.9690]];
      WALKC = {}; SEGW = {}; LASTW = {}; window.__wt = {a:a, b:b, v:v}; return walkPath(a, b, v).length; })()`);
    ok(r===4, "Erst Luftlinie erwartet (Weg wird berechnet)");
    await page.waitForFunction(() => window.__rp(`walkPath(__wt.a, __wt.b, __wt.v).length > 6`), null, {timeout:5000}).catch(() => {});
    const n1 = await rp(`walkPath(__wt.a, __wt.b, __wt.v).length`);
    ok(n1 > 6, "Ein fehlendes Teilstück macht die ganze Etappe zur Luftlinie ("+n1+" Punkte)");
    // eigener Standort bewegt sich: sofort der bisherige Weg, nur das erste Teilstück wird neu geholt
    const before = OSRMREQ.length;
    const n2 = await rp(`(function(){ var a2 = {la:40.7218, lo:-73.9892, id:"me"}; return walkPath(a2, __wt.b, __wt.v).length; })()`);
    ok(n2 > 6, "Nach Bewegung des Standorts wieder Luftlinie ("+n2+" Punkte)");
    await page.waitForTimeout(800);
    ok(OSRMREQ.length - before === 1, "Es sollten nicht alle Teilstücke neu berechnet werden ("+(OSRMREQ.length - before)+" Anfragen)");
    // Start am Fähranleger: kein „Fußweg“ über die Fährlinie, sondern ab dem nächsten Punkt an Land
    const fy = await rp(`(function(){ WALKC = {}; SEGW = {}; LASTW = {}; window.__fa = {la:40.7600, lo:-74.0100}; window.__fb = {la:40.7561, lo:-73.9930}; return walkPath(__fa, __fb, []).length; })()`);
    await page.waitForFunction(() => window.__rp(`!!(WALKC[wKey(__fa, __fb, [])] || {}).p`), null, {timeout:5000}).catch(() => {});
    const fp = await rp(`(function(){ var c = WALKC[wKey(__fa, __fb, [])] || {}; return {p:!!c.p, south:(c.p||[]).some(function(q){ return q[0] < 40.75; }), lo:c.p && c.p[0] && c.p[0][1]}; })()`);
    ok(fp.p && !fp.south && fp.lo > -74.0099 && fp.lo < -74.0080, "Fußweg vom Anleger fährt mit der Fähre: "+JSON.stringify(fp));
    // auf dem Gerät gemerkter alter Fährumweg wird einmal neu berechnet
    await rp(`(function(){ var k = wKey(__fa, __fb, []); SEGW = {}; WALKC[k] = {p:[[40.7600,-74.0100],[40.7200,-74.0200],[40.7561,-73.9930]], d:9500, sv:2}; walkPath(__fa, __fb, []); })()`);
    await page.waitForFunction(() => window.__rp(`!((WALKC[wKey(__fa, __fb, [])] || {}).p || [[0]]).some(function(q){ return q[0] < 40.75; })`), null, {timeout:5000}).catch(() => {});
    const fo = await rp(`(function(){ var c = WALKC[wKey(__fa, __fb, [])] || {}; return !!c.p && !c.p.some(function(q){ return q[0] < 40.75; }); })()`);
    ok(fo, "Gemerkter Fährumweg wird nicht neu berechnet");
    // anderer, weit entfernter Start zum selben Ziel (z. B. neuer Stopp davor): nicht den alten Weg von dort zeigen
    const far = await rp(`(function(){ var a3 = {la:40.7600, lo:-74.0035}, p = walkPath(a3, __wt.b, __wt.v); return {n:p.length, la:p[1].la}; })()`);
    ok(far.n === 4 && Math.abs(far.la - 40.7240) < 1e-6, "Weg von entferntem Start übernimmt alten Weg eines anderen Starts ("+far.n+" Punkte)");
    // am ersten Wegpunkt vorbeigegangen: der Weg ab dem Standort führt nicht mehr dorthin zurück
    const pv = await rp(`(function(){ PASSV = {day:nyNow().key, v:{}}; var near = {la:40.7241, lo:-73.9901, id:"me"}; viaAhead(near, __wt.b, __wt.v);
      var later = {la:40.7255, lo:-73.9850, id:"me"}; return {a:JSON.stringify(viaAhead(later, __wt.b, __wt.v)), keep:viaAhead({la:40.7, lo:-73.98}, __wt.b, __wt.v).length, saved:!!lsGet("rp-passv")}; })()`);
    ok(pv.a==='[[40.727,-73.969]]', "Passierter Wegpunkt wird nicht übersprungen: "+pv.a);
    ok(pv.keep===2, "Wegpunkte für feste Etappen (nicht ab Standort) dürfen nicht wegfallen");
    ok(pv.saved, "Passierte Wegpunkte werden nicht gemerkt");
  } finally { globalThis.FOOTMOCK = false; }
});

await test("Gruppen: ein Ort in mehreren Gruppen (alte Einzel-Zuordnung bleibt gültig)", async () => {
  await seed();
  const id = await rp(`Object.keys(T().places).filter(function(k){ var p = P(k); return !p.of && p.k!=="hotel"; })[0]`);
  // alter Stand: eine Gruppe als einzelne ID
  await rp(`(function(){ var t = T(); t.groups = {ga:{n:"Central Park"}, gb:{n:"Abends"}}; T().places["${id}"].g = "ga"; save(); })()`);
  ok(await rp(`gidsOf(P("${id}")).join()==="ga" && grpNames(P("${id}"))==="Central Park"`), "Alte Einzel-Zuordnung nicht erkannt");
  await rp(`openGrpPop("${id}")`);
  ok(await visible("#catPop .glist"), "Gruppen-Auswahl öffnet nicht");
  await click('#catPop [data-act=grpset][data-g="gb"]');
  ok(await visible("#catPop .glist"), "Auswahl schließt nach dem ersten Tipp – Mehrfachauswahl nicht möglich");
  ok(await rp(`JSON.stringify(P("${id}").g)==='["ga","gb"]'`), "Nicht in beiden Gruppen: "+await rp(`JSON.stringify(P("${id}").g)`));
  ok(await rp(`document.querySelectorAll('#catPop [data-act=grpset][aria-pressed=true]').length===2`), "Beide Gruppen nicht als gewählt markiert");
  ok(await rp(`grpNames(P("${id}"))==="Abends, Central Park"`), "Namen falsch: "+await rp(`grpNames(P("${id}"))`));
  ok(await rp(`(grpSel = "ga", grpOk(P("${id}"))) && (grpSel = "gb", grpOk(P("${id}"))) && (grpSel = "none", !grpOk(P("${id}")))`), "Filter nach Gruppe findet den Ort nicht in beiden");
  await rp(`grpSel = ""`);
  // neue Gruppe anlegen fügt hinzu statt zu ersetzen
  await page.fill("#grpNewIn", "Regentag"); await click("#grpNew [type=submit]");
  ok(await rp(`gidsOf(P("${id}")).length===3`), "Neue Gruppe ersetzt die bisherigen");
  // abwählen bis zur einzelnen ID; Löschen einer Gruppe nimmt nur sie heraus
  await click('#catPop [data-act=grpset][data-g="gb"]');
  await rp(`(function(){ var g = Object.keys(T().groups).filter(function(k){ return T().groups[k].n==="Regentag"; })[0]; setGroup("${id}", g); })()`);
  ok(await rp(`P("${id}").g==="ga"`), "Bei einer Gruppe nicht als Einzelwert gespeichert: "+await rp(`JSON.stringify(P("${id}").g)`));
  await rp(`setGroup("${id}", "gb")`);
  await click('#catPop [data-act=grpedit][data-g="ga"]'); await click('#catPop [data-act=grpdel][data-g="ga"]');
  ok(await rp(`P("${id}").g==="gb"`), "Gruppe löschen entfernt falsch: "+await rp(`JSON.stringify(P("${id}").g)`));
  await rp(`openGrpPop("${id}")`); await click('#catPop [data-act=grpset][data-g=""]');
  ok(await rp(`P("${id}").g===undefined`), "„Keine Gruppe“ leert die Zuordnung nicht");
});

await test("Ort-Menü (Mehr): Gruppen Planen/Zuordnen/Infos, einzeilige Zeilen, Löschen unten in voller Breite mit Rückfrage", async () => {
  await seed();
  const id = await rp(`Object.keys(T().places).filter(function(k){ return dayOf(k)===cur && P(k).k!=="hotel" && !T().done[k]; })[0]`);
  ok(!!id, "Kein geplanter Ort am Tag");
  // langer Hotelname: Zeile muss gekürzt werden statt das Menü zu verbreitern
  await rp(`(function(){ var h = dayByKey(cur).hotel; if(h) h.n = "Voco Times Square South Hotel Manhattan New York"; })()`);
  await rp(`(function(){ setSheet("mid"); select("${id}"); })()`); await page.waitForTimeout(250);
  await click("#card [data-act=cardmore]");
  ok(await visible("#jpMenu"), "Menü öffnet nicht");
  await page.waitForFunction(() => { const el = document.querySelector("#jpMenu"); return el && !el.getAnimations().some(a => a.playState==="running"); }, null, {timeout:3000}).catch(() => {});
  const m = await page.evaluate(() => { const el = document.querySelector("#jpMenu"), r = el.getBoundingClientRect(), kids = [...el.children];
    const rows = kids.filter(x => x.tagName==="BUTTON" && !x.classList.contains("cm-del")), del = el.querySelector(".cm-del");
    return { heads: [...el.querySelectorAll(".cm-h")].map(x => x.textContent), last: kids[kids.length-1]===del, delAct: del && del.getAttribute("data-act"),
      // Layout-Maße (offset/client) statt getBoundingClientRect: das Pop-up skaliert beim Aufgehen kurz
      delFull: del ? Math.abs(del.offsetWidth - (el.clientWidth - 12)) < 3 : false, delW: del && del.offsetWidth, cw: el.clientWidth,
      over: kids.filter(x => x.offsetWidth > el.clientWidth - 12 + 1).length + (el.scrollWidth > el.clientWidth + 1 ? 1 : 0),
      maxH: Math.max(...rows.map(x => x.offsetHeight)), subs: el.querySelectorAll(".cm-t small").length,
      inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      first: kids[0].classList.contains("cm-h"), order: rows.map(x => x.getAttribute("data-act")) }; });
  ok(/^Planen\|Zuordnen(\|Teilen)?\|Infos$/.test(m.heads.join("|")), "Gruppen-Überschriften falsch: "+m.heads.join("|"));
  ok(m.first, "Menü beginnt nicht mit einer Überschrift");
  ok(m.last && m.delAct==="moredel" && m.delFull, "Löschen steht nicht ganz unten in voller Breite: "+JSON.stringify([m.last, m.delAct, m.delW, m.cw]));
  ok(m.over===0, "Zeilen ragen aus dem Menü (lange Texte ohne Kürzung)");
  ok(m.subs===0 && m.maxH <= 42, "Zeilen nicht einzeilig (Höhe "+m.maxH+", Untertitel "+m.subs+")");
  ok(m.inView, "Menü ragt aus dem Bild");
  ok(m.order.indexOf("unplan") > -1 && m.order.indexOf("unplan") < m.order.indexOf("grppick") && m.order.indexOf("grppick") < m.order.indexOf("gmopen"), "Reihenfolge der Gruppen falsch: "+m.order.join(","));
  ok(await page.evaluate(() => getComputedStyle(document.querySelector("#jpMenu .cm-del")).color)!==await page.evaluate(() => getComputedStyle(document.querySelector("#jpMenu [data-act=gmopen]")).color), "Löschen nicht rot abgesetzt");
  await shot("ort-menue");
  await click("#jpMenu .cm-del");
  ok(await visible("#cfPop"), "Rückfrage zum Löschen fehlt");
  await click("#cfPop .cf-no"); await page.waitForTimeout(200);
  ok(await rp(`!!P("${id}") && sel==="${id}"`), "Abbrechen hat gelöscht oder den Ort abgewählt");
  ok(await visible("#card"), "Nach Abbrechen ist die Ort-Karte weg");
});

await test("Ort-Menü: „Mehr“ an der Karte und „⋯“ im Detail zeigen dieselben Punkte, Beobachter ohne Bearbeiten/Löschen", async () => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de", emailVerified:true}; true`);
  const id = await rp(`Object.keys(T().places).filter(function(k){ return dayOf(k)===cur && P(k).k!=="hotel" && !T().done[k] && hasLoc(P(k)); })[0]`);
  ok(!!id, "Kein geplanter Ort am Tag");
  const acts = () => page.evaluate(() => [...document.querySelectorAll("#jpMenu [data-act]")].map(x => x.getAttribute("data-act")).join(","));
  const heads = () => page.evaluate(() => [...document.querySelectorAll("#jpMenu .cm-h")].map(x => x.textContent).join("|"));
  await rp(`(function(){ setSheet("mid"); select("${id}"); })()`); await page.waitForTimeout(250);
  await click("#card [data-act=cardmore]");
  const a1 = await acts(), h1 = await heads();
  ok(a1.includes("chshare") && a1.includes("grppick") && a1.includes("gmopen") && a1.includes("moredel"), "Karten-Menü unvollständig: "+a1);
  await rp(`closeJpMore(); openJPop("${id}", dayOf("${id}")); true`); await page.waitForTimeout(300);
  ok(await page.locator("#jPop a[aria-label='Infos in Google Maps']").count()===0, "Google-Maps-Knopf doppelt (steht im ⋯-Menü)");
  await click("#jPop [data-act=jpmore]");
  const a2 = await acts(), h2 = await heads();
  ok(a1===a2 && h1===h2, "Menüs unterschiedlich: Karte "+a1+" / Detail "+a2);
  await shot("ort-menue-detail");
  // Löschen aus dem Detail schließt das Fenster und entfernt den Ort
  await click("#jpMenu .cm-del"); ok(await visible("#cfPop"), "Rückfrage zum Löschen fehlt");
  await click("#cfPop .cf-ok"); await page.waitForTimeout(300);
  ok(await rp(`!P("${id}") && $("jPop").hidden`), "Löschen aus dem Detail-Menü wirkt nicht");
  // Beobachter: ⋯ vorhanden, aber ohne Gruppe/Löschen/Einplanen
  const id2 = await rp(`Object.keys(T().places).filter(function(k){ return P(k).k!=="hotel" && hasLoc(P(k)); })[0]`);
  await rp(`window.__isRO0 = isRO; isRO = function(){ return true; }; openJPop("${id2}", dayOf("${id2}")); true`); await page.waitForTimeout(300);
  await click("#jPop [data-act=jpmore]");
  const a3 = await acts();
  ok(a3.includes("gmopen") && !/moredel|grppick|wpark|tovia|tkplace|staymark/.test(a3), "Beobachter-Menü falsch: "+a3);
  await rp(`closeJpMore(); closeJPop(); isRO = window.__isRO0; true`);
});

await test("Fürs nächste Mal merken: besuchter Ort und Wunschliste-Ort aus der Reise im Ziel, Ziel bietet sie bei neuer Reise an", async () => {
  await seed();
  await rp(`zielNew("New York", {id:"o1", n:"New York", la:40.75, lo:-73.98, r:30000}); save(); true`);
  const vis = await rp(`(function(){ var k = Object.keys(T().places).filter(function(k){ return dayOf(k) && P(k).k!=="hotel" && hasLoc(P(k)); })[0]; T().done[k] = true; save(); return k; })()`);
  const wish = await rp(`Object.keys(T().places).filter(function(k){ return !dayOf(k) && P(k).k!=="hotel" && hasLoc(P(k)); })[0]`);
  ok(!!vis && !!wish, "Kein besuchter oder Wunschliste-Ort im Testplan");
  for(const id of [vis, wish]){
    await rp(`(function(){ setSheet("mid"); select("${id}"); })()`); await page.waitForTimeout(250);
    await click("#card [data-act=cardmore]");
    ok(await page.locator("#jpMenu [data-act=pmerk]").count()===1, "„Fürs nächste Mal merken“ fehlt im Ort-Menü");
    if(id===vis) await shot("naechstes-mal-menue");
    await click("#jpMenu [data-act=pmerk]"); await page.waitForTimeout(200);
    ok((await page.locator("#toast").innerText()).includes("gemerkt in „New York“"), "Hinweis nach dem Merken fehlt");
    ok(await rp(`(function(){ var a = (P("${id}").zl||"").split("/"), z = Z(a[0]); return !!(z && z.name==="New York" && z.places[a[1]] && z.places[a[1]].n===P("${id}").n); })()`), "Ort nicht mit dem Ziel verknüpft");
    await click("#card [data-act=cardmore]");
    ok(await page.locator("#jpMenu [data-act=pmerk]").count()===0 && (await page.locator("#jpMenu [data-act=pzopen]").innerText()).includes("New York"), "Menü zeigt nicht „Gemerkt · New York“");
    await rp(`closeJpMore(); true`);
  }
  const zid = await rp(`zielIds()[0]`);
  ok(await rp(`Object.keys(Z("${zid}").places).length`)===2, "Ziel hat nicht genau zwei gemerkte Orte");
  ok(await rp(`zStatus("${zid}", Z("${zid}").places[P("${vis}").zl.split("/")[1]]).done`), "Besuch erscheint nicht im Ziel");
  ok(await rp(`zVisited("${zid}").every(function(x){ return x.p.id!=="${vis}"; })`), "Schon vor dem Merken besuchter Ort steht unter „Besucht“ statt „Gemerkt“");
  ok(await rp(`zOpenPl("${zid}").length`)===2, "Fürs nächste Mal gemerkter besuchter Ort fehlt unter „Gemerkt“");
  // Pop-up öffnet das Ziel
  await rp(`select("${vis}")`); await page.waitForTimeout(200);
  await click("#card [data-act=cardmore]"); await click("#jpMenu [data-act=pzopen]"); await page.waitForTimeout(300);
  ok(await page.locator("#zPop .zrow").count()===2, "Ziel zeigt die gemerkten Orte nicht");
  await shot("naechstes-mal");
  // neue Reise dorthin bietet beide an
  const nt = await rp(`(function(){ var t = newTripObj({id:"tNeu", name:"NY 2027", start:"2027-05-01", end:"2027-05-04", orte:[{n:"New York", la:40.75, lo:-73.98}]}); S.trips[t.id] = t; return zOfferItems(t.id).length; })()`);
  ok(nt===2, "Neue Reise bietet die gemerkten Orte nicht an ("+nt+")");
});

await test("Unterkunftsliste: Ort als Unterkunft vormerken, eigene Liste, als Hotel übernehmen, Abbrechen führt zurück", async () => {
  await seed();
  // Park aus der Suche: keine Unterkunft-Option; selbst gesetzter Ort (z. B. Ferienwohnung): Option da
  await rp(`select("p7")`); await page.waitForTimeout(200);
  await click("#card [data-act=cardmore]");
  ok(await page.locator("#jpMenu [data-act=staymark]").count()===0, "Park bietet „Als Unterkunft vormerken“ an");
  ok(await rp(`!canStay(T().places.p7) && canStay({c:"hotel"}) && canStay({c:"essen", own:1}) && !canStay({c:"cafe"}) && !canStay({c:"sight", own:1, k:"photo"})`), "canStay-Regel falsch");
  await rp(`closeJpMore(); T().places.p7.own = 1; select(null); select("p7")`); await page.waitForTimeout(200);
  await click("#card [data-act=cardmore]");
  await click("#jpMenu [data-act=staymark]"); await page.waitForTimeout(200);
  ok(await rp(`T().places.p7.c==="hotel" && T().places.p7.c0==="park"`), "Ort wird nicht als Unterkunft markiert");
  await rp(`select(null); tab = "wish"; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  ok(await rp(`document.querySelector("#body .fchips .fchip").getAttribute("data-k")==="list"`), "Listen-Kachel (Unterkünfte) steht nicht ganz links");
  await click("#body .fchip[data-k=list]");
  ok(await visible("#catPop [data-act=wlist][data-l=stay]"), "Liste „Unterkünfte“ fehlt in der Listenauswahl");
  await click("#catPop [data-act=wlist][data-l=stay]"); await page.waitForTimeout(200);
  await shot("unterkunftsliste");
  ok(await rp(`activeList==="stay" && document.querySelectorAll("#wishRes li.wi").length===1 && !!document.querySelector('#wishRes li[data-id="p7"]')`), "Unterkunftsliste zeigt nicht nur die Unterkunft");
  ok((await page.locator("#body .wadd").getAttribute("aria-label")).includes("Unterkunft"), "+ legt keine Unterkunft an");
  ok(await rp(`CATS.some(function(c){ return c[0]==="hotel" && c[1]==="Unterkunft"; })`), "Kategorie Unterkunft fehlt");
  await click("#wishRes li[data-id=p7] [data-act=stay2h]"); await page.waitForTimeout(300);
  ok(await rp(`tab==="trip" && tdraft && tdraft.hotels.some(function(h){ return h.src==="p7" && h.n==="High Line"; })`), "Als Hotel übernehmen füllt das Reise-Fenster nicht");
  await click("#tripPop [data-act=tcancel]"); await page.waitForTimeout(250);
  ok(await rp(`tab==="wish" && activeList==="stay" && !T().hotels.some(function(h){ return h.src==="p7"; })`), "Abbrechen führt nicht zur Unterkunftsliste zurück");
  await click("#wishRes li[data-id=p7] [data-act=stay2h]"); await page.waitForTimeout(300);
  await rp(`document.getElementById("tForm").requestSubmit()`); await page.waitForTimeout(500);
  ok(await rp(`T().hotels.some(function(h){ return h.src==="p7" && h.n==="High Line"; }) && T().hotels.some(function(h){ return h.id==="h1"; })`), "Unterkunft wurde nicht als Hotel gespeichert");
  await rp(`tab = "wish"; activeList = "stay"; renderSheet();`); await page.waitForTimeout(200);
  await shot("unterkunft-gewaehlt");
  ok(await visible("#wishRes li[data-id=p7] .wsel") && await page.locator("#wishRes li[data-id=p7] [data-act=stay2h]").count()===0, "Gewählte Unterkunft nicht als Hotel der Reise gekennzeichnet");
  await rp(`stayMark("p7")`);
  ok(await rp(`T().places.p7.c==="park" && !T().places.p7.c0`), "Markierung lässt sich nicht zurücknehmen");
});

await test("Ebene Wünsche aus: nach Listenwechsel und Einklappen keine Wunsch-Pins", async () => {
  await seed();
  await rp(`layers.wish = false; select(null); tab = "wish"; setSheet("mid"); renderSheet(); fitPoints(wishes()); drawOverlay();`);
  for(let i=0; i<30 && !(await rp(`WISHN>0`)); i++) await page.waitForTimeout(100);
  ok(await rp(`WISHN>0`), "Offene Wunschliste zeigt keine Wünsche auf der Karte");
  await click("#body .fchip[data-k=list]");
  await click("#catPop [data-act=wlist][data-l=stay]"); await page.waitForTimeout(200);
  await click("#body .fchip[data-k=list]");
  await click("#catPop [data-act=wlist][data-l=open]"); await page.waitForTimeout(200);
  await rp(`setSheet("min")`); await page.waitForTimeout(300);
  ok(await rp(`activeList==="open" && WISHN===0`), "Eingeklappt mit Ebene „Wünsche“ aus werden Wünsche gezeigt");
  await rp(`setSheet("mid"); fitPoints(wishes());`);
  for(let i=0; i<30 && !(await rp(`WISHN>0`)); i++) await page.waitForTimeout(100);
  ok(await rp(`WISHN>0`), "Nach Ausklappen fehlen die Wünsche der Liste auf der Karte");
});

await test("Wunschliste: kleine Abstände Suche → Filter-Chips → Kacheln; Tageskopf → Route", async () => {
  await seed();
  await rp(`T().places.p6.park = 1; select(null); tab = "wish"; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  const g = await rp(`(function(){ var r = function(s){ return document.querySelector("#body "+s).getBoundingClientRect(); }; var a = r(".wtop"), b = r(".fchips"), c = r("#wishRes .wtiles"); return {g1: b.top - a.bottom, g2: c.top - b.bottom}; })()`);
  ok(g.g1 >= 4 && g.g1 <= 12, "Abstand Suche → Chips zu groß/klein: "+g.g1);
  ok(g.g2 >= 4 && g.g2 <= 12, "Abstand Chips → Kacheln zu groß/klein: "+g.g2);
  await rp(`tab = "day"; renderSheet();`); await page.waitForTimeout(300);
  const d = await rp(`(function(){ var h = document.querySelector("#body > .dh"), s = h && h.nextElementSibling; return s ? s.getBoundingClientRect().top - h.getBoundingClientRect().bottom : -1; })()`);
  ok(d >= 4 && d <= 14, "Abstand Tageskopf → Route zu groß/klein: "+d);
});

await test("Wünsche zurückstellen, ein-/ausblenden, zurückholen, weiterhin löschbar", async () => {
  await seed();
  await rp(`select("p6")`); await page.waitForTimeout(200);
  await click("#card [data-act=cardmore]");
  await click("#jpMenu [data-act=wpark]"); await page.waitForTimeout(200);
  ok(await rp(`T().places.p6.park===1 && wishes().every(function(w){ return w.id!=="p6"; })`), "Wunsch wird nicht zurückgestellt");
  ok(await rp(`!!T().places.p6`), "Zurückstellen hat den Wunsch gelöscht");
  await rp(`select(null); tab = "wish"; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  ok(!(await visible("#wishRes li[data-id=p6]")), "Zurückgestellter Wunsch steht noch in der Wunschliste");
  const pt = await page.locator("#wishRes .wtiles [data-act=wparked]").innerText();
  ok(pt.includes("Zurückgestellt") && pt.includes("1"), "Kachel „Zurückgestellt“ fehlt");
  ok(await rp(`(function(){ var w = document.querySelector("#wishRes .wtiles"), l = document.querySelector("#wishRes li.wi"); return !!w && !!l && w.getBoundingClientRect().bottom <= l.getBoundingClientRect().top; })()`), "Kacheln stehen nicht oben über der Liste");
  ok(await page.locator("#wishRes .fold").count()===0, "Alte Zeilen unten in der Wunschliste noch da");
  await click("#wishRes .wtiles [data-act=wplanned]"); await page.waitForTimeout(150);
  ok(await rp(`(function(){ var ids = Object.keys(T().places).filter(function(k){ return !P(k).of && dayOf(k); }); return ids.length > 0 && ids.every(function(k){ return !!document.querySelector('#wishRes li[data-id="'+k+'"]'); }); })()`), "Kachel „Eingeplant“ zeigt die eingeplanten Orte nicht");
  ok(await page.locator("#wishRes .wtiles [data-act=wplanned]").getAttribute("aria-pressed")==="true", "Kachel „Eingeplant“ nicht aktiv");
  await shot("wunsch-kacheln-eingeplant");
  await click("#wishRes .wtiles [data-act=wplanned]"); await page.waitForTimeout(150);
  await click("#wishRes [data-act=wparked]"); await page.waitForTimeout(150);
  ok(await visible("#wishRes li.parked[data-id=p6]"), "Zurückgestellte lassen sich nicht einblenden");
  await click("#wishRes li[data-id=p6] [data-act=wunpark]"); await page.waitForTimeout(200);
  ok(await rp(`!T().places.p6.park && wishes().some(function(w){ return w.id==="p6"; })`), "Zurückholen funktioniert nicht");
  await rp(`setPark("p6", true); setSheet("mid"); select("p6");`); await page.waitForTimeout(300);
  await click("#card [data-act=cardmore]");
  ok(await page.locator("#jpMenu [data-act=moredel]").count()===1 && await page.locator("#jpMenu [data-act=wunpark]").count()===1, "Zurückgestellter Wunsch lässt sich nicht löschen oder zurückholen");
  await rp(`closeJpMore(); wParkedOpen = false; renderSheet();`);
  ok(!(await visible("#wishRes li[data-id=p6]")), "Ausblenden der Zurückgestellten funktioniert nicht");
});

await test("Dunkler Modus: Texte bleiben hell und lesbar", async () => {
  await page.emulateMedia({colorScheme: "dark"});
  await seed();
  const ink = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());
  const col = await page.evaluate(() => getComputedStyle(document.querySelector("#tripBtn")).color);
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); return (m[0]*299 + m[1]*587 + m[2]*114) / 1000; };
  ok(lum(col) > 150, "Reise-Knopf im dunklen Modus zu dunkel: "+col+" (--ink "+ink+")");
  await page.emulateMedia({colorScheme: "light"});
  const col2 = await page.evaluate(() => getComputedStyle(document.querySelector("#tripBtn")).color);
  ok(lum(col2) < 100, "Reise-Knopf im hellen Modus zu hell: "+col2);
});

await test("Citi Bike: Radweg folgt den Wegpunkten, keine Luftlinie", async () => {
  await seed();
  await rp(`layers.bike = true; cbLoad(true);`); await page.waitForTimeout(800);
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p1" && L[i][1] && L[i][1].id==="p2") return i; } return -1; })()`);
  OSRMREQ.length = 0;
  await rp(`(function(){ var L = dayLegs(cur)[${li}]; setLegVia(L[0], L[1], [[40.7268, -73.9925]]); setLegMode(L[0], L[1], "bike"); legsList = true; renderSheet(); bikeRoute(L[0], L[1]); })()`);
  await page.waitForTimeout(900);
  ok(OSRMREQ.some(u => u.includes("-73.992500,40.726800")), "Radweg wird nicht über den Wegpunkt berechnet");
  const r = await rp(`(function(){ var L = dayLegs(cur)[${li}], b = bikeRoute(L[0], L[1]); return {exact:b.exact, n:(b.path||[]).length, via:b.via}; })()`);
  ok(r.exact && r.n > 4 && r.via===1, "Radweg nicht als echte Strecke übernommen: "+JSON.stringify(r));
  ok(await page.locator(".leg.lbk .viab").count()===1, "Wegpunkte-Knopf fehlt bei der Rad-Etappe");
  // ohne Antwort vom Routing-Dienst: keine Luftlinie
  await rp(`(function(){ var L = dayLegs(cur)[${li}]; setLegVia(L[0], L[1], [[40.7290, -73.9900]]); })()`);
  await page.route(/routed-bike/, rt => rt.abort());
  const r2 = await rp(`(function(){ var L = dayLegs(cur)[${li}], b = bikeRoute(L[0], L[1]); return {exact:b.exact, path:b.path}; })()`);
  ok(!r2.exact && r2.path===null, "Ohne berechneten Weg wird trotzdem eine Linie geliefert");
});

await test("ÖPNV-Navigation: in der Bahn bleibt die Verbindung samt Ausstieg, neu nur bei echtem Abweichen", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; navStart({la:40.7680, lo:-73.9819, n:"Columbus Circle"}, "oepnv");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:8000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.segs && NAV.segs.some(function(sg){ return sg.kind==="ride"; }))`), "ÖPNV-Navigation ohne Fahrt");
  await rp(`window.__pts = NAV.pts; window.__sg = NAV.segs.filter(function(sg){ return sg.kind==="ride"; })[0]; NAV.rt = 0;`);
  // in der Bahn: Standorte neben der Linie (ungenaue Ortung unterirdisch, 150 m daneben), schnell unterwegs
  for(const f of [0.2, 0.4, 0.6]){
    await rp(`(function(){ var sg = window.__sg, k = sg.o + Math.floor((sg.n - 1) * ${f}), q = NAV.pts[k]; me = {la:q.la, lo:q.lo + 0.0018, acc:30, spd:9}; navOnPos(); })()`);
    await page.waitForTimeout(60);
  }
  ok(await rp(`NAV.pts===window.__pts && !NAV.busy`), "Route wird während der Fahrt neu berechnet");
  ok(await rp(`NAV.pi >= window.__sg.o && NAV.pi < window.__sg.o + window.__sg.n && !!NAV.inRide`), "Fortschritt folgt nicht der Linie");
  const row = await page.locator("#navUi .nav-line").innerText().catch(() => "");
  ok(row.includes("Aussteigen an"), "Ausstiegshaltestelle fehlt während der Fahrt: " + row);
  ok(!(await page.locator("#navUi .nav-off").count()) && !(await rp(`NAV.wrongWay`)), "In der Bahn erscheint „Vom Weg abgekommen“/„Falsche Richtung“");
  // echtes Abweichen (2 km weg von der Linie): nach mehreren klaren Meldungen neuer Weg
  for(let i = 0; i < 5; i++){ await rp(`me = {la:40.7000, lo:-73.9500, acc:10, spd:1}; navOnPos();`); await page.waitForTimeout(40); }
  ok(await rp(`NAV.pts!==window.__pts || NAV.busy`), "Bei echtem Abweichen wird nicht neu berechnet");
  await rp(`navEnd(true)`);
});
await test("Tagesplan unterwegs: Etappe ab Standort behält Bus/Bahn und Ausstieg während der Fahrt", async () => {
  await seed();
  await page.waitForFunction(() => window.__rp("busReady"), null, {timeout:15000}).catch(() => {});
  const r0 = await rp(`(function(){ var t = T(); t.places.p8 = {id:"p8", n:"Museum of Natural History", c:"kultur", la:40.7813, lo:-73.9740, list:"l_main", note:"", addr:"W 79th St"}; t.order[cur] = ["p8"]; t.done = {};
    legSet("legMode", P("p8"), "oepnv"); legSet("legOpt", P("p8"), {p:["bus"]}); me = {la:40.7735, lo:-73.9515, acc:10}; meA = null; var a = meAnchor(), lg = dayLegs(cur)[0], r = legRoute(lg[0], lg[1], cur);
    var rides = r && !r.walk ? r.legs.filter(function(l){ return l.t==="ride"; }) : []; window.__a = a; window.__rd = rides[rides.length - 1];
    return {from:lg[0]===a, rides:rides.length, bus:rides.some(function(l){ return isBus(l.r); }), exit:rides.length ? NET.s[rides[rides.length-1].to][0] : ""}; })()`);
  ok(r0.from && r0.rides > 0, "Etappe ab Standort ohne Fahrt: " + JSON.stringify(r0));
  ok(r0.bus, "Testetappe sollte einen Bus nutzen: " + JSON.stringify(r0));
  // in der Bahn/im Bus: mehrere Meldungen entlang der Fahrt, 100 m neben der Linie, langsam
  for(const f of [0.3, 0.5, 0.7]){
    const r = await rp(`(function(){ var P0 = ridePath(window.__rd), q = P0[Math.floor((P0.length - 1) * ${f})]; me = {la:q.la, lo:q.lo + 0.0012, acc:30, spd:3};
      var a = meAnchor(), lg = dayLegs(cur)[0], r = legRoute(lg[0], lg[1], cur), rides = r.legs.filter(function(l){ return l.t==="ride"; });
      return {same:a===window.__a, exit:NET.s[rides[rides.length-1].to][0]}; })()`);
    ok(r.same, "Etappe wird während der Fahrt vom neuen Standort aus neu berechnet");
    ok(r.exit===r0.exit, "Ausstieg geht während der Fahrt verloren: " + r.exit + " statt " + r0.exit);
  }
  // nach dem Ausstieg: Weg ab Standort
  ok(await rp(`(function(){ var q = stLL(window.__rd.to); me = {la:q.la + 0.0003, lo:q.lo, acc:10}; return meAnchor()!==window.__a; })()`), "Nach dem Ausstieg zählt der Standort nicht wieder");
  // echtes Abweichen: 2 km weg
  await rp(`me = {la:40.7735, lo:-73.9515, acc:10}; meA = window.__a;`);
  ok(await rp(`(function(){ me = {la:40.7000, lo:-73.9500, acc:10}; return meAnchor()!==window.__a; })()`), "Bei echtem Abweichen wird nicht neu berechnet");
});
await test("Navigation aus dem Ort-Pop-up: Pop-up und Listen schließen beim Start", async () => {
  await seed();
  await rp(`nav3d = false; me = {la:40.7215, lo:-73.9890, acc:8}; openLsPage(); openJPop("p2", dayOf("p2"));`); await page.waitForTimeout(250);
  ok(await visible("#jPop"), "Ort-Pop-up nicht offen");
  await click("#jPop [data-act=go]"); await page.waitForTimeout(200);
  await click("#catPop [data-act=navstart][data-mode=walk]");
  await page.waitForFunction(() => window.__rp("!!NAV"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`!!NAV`), "Navigation nicht gestartet");
  ok(await rp(`$("jPop").hidden && !jp`), "Ort-Pop-up bleibt nach dem Navi-Start offen");
  ok(await rp(`!lsPage && $("lsView").hidden`), "Liste bleibt nach dem Navi-Start offen");
  ok(await rp(`$("catPop").hidden`), "Routen-Pop-up bleibt offen");
  // auch über das Verkehrsmittel-Menü (Hotel, Station, Kartenpunkt)
  await rp(`navEnd(true); openJPop("p2", dayOf("p2")); navPick({la:40.75, lo:-73.99, n:"Test"}, document.querySelector("#jPop [data-act=go]"));`); await page.waitForTimeout(250);
  await click("[data-act=navgo][data-mode=walk]");
  ok(await rp(`!!NAV && $("jPop").hidden`), "Pop-up bleibt beim Start über das Verkehrsmittel-Menü offen");
  await rp(`navEnd(true)`);
});

await test("Navigation in der App: starten, Hinweise, ausblenden, ankommen, abhaken", async () => {
  await seed();
  await rp(`nav3d = false; me = {la:40.7215, lo:-73.9890, acc:8}; openGo("p2");`); await page.waitForTimeout(200); // prüft die flache 2D-Ansicht
  ok(await page.locator("#catPop .gp-nav [data-act=navstart]").count()===5, "Navigation in der App fehlt im Routen-Pop-up");
  await click("#catPop [data-act=navstart][data-mode=walk]");
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts)"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.pts && NAV.pts.length > 5)`), "Weg für die Navigation nicht berechnet");
  ok(await visible("#navUi .nav-hero") && await visible("#navUi .nav-foot"), "Navigationsanzeige fehlt");
  const t1 = await page.locator("#navUi .nav-hero").innerText();
  ok(t1.includes("Rechts abbiegen") && t1.includes("Bleecker"), "Abbiegehinweis fehlt: "+t1);
  ok(await rp(`document.body.classList.contains("navon")`), "Obere Leiste wird während der Navigation nicht ausgeblendet");
  await page.evaluate(() => { window.__hero = document.querySelector("#navUi .nav-hero"); });
  for(let i = 0; i < 4; i++){ await rp(`me = {la:40.7215 + ${i}*0.00002, lo:-73.9890, acc:8}; navOnPos();`); await page.waitForTimeout(80); }
  ok(await page.evaluate(() => window.__hero === document.querySelector("#navUi .nav-hero")), "Kacheln werden bei jeder Standortmeldung neu aufgebaut (zucken)");
  // neues Aussehen: Kreuzungsskizze aus der Weggeometrie, Annäherungsring, fließende Punkte auf dem Weg
  // Kartenknöpfe liegen unter den Navi-Kacheln und über der Fußleiste, nichts wird verdeckt
  const noCover = async () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll("#navUi .nav-hero, #navUi .nav-then, #navOri:not([hidden]), #navUi .nav-foot")].map(e => e.getBoundingClientRect()).filter(r => r.height > 0);
    const btns = [...document.querySelectorAll("#ctrl button, #navTools button")].filter(b => b.offsetParent).map(b => b.getBoundingClientRect());
    return btns.length > 5 && btns.every(b => boxes.every(r => b.bottom <= r.top || b.top >= r.bottom || b.right <= r.left || b.left >= r.right));
  });
  await page.waitForTimeout(400);
  ok(await noCover(), "Navi-Kacheln verdecken Kartenknöpfe");
  // Suche, Hinzufügen und KI bleiben während der Navigation erreichbar (linke Leiste)
  ok(await page.locator("#navTools button:visible").count()===3, "Suche, Plus und KI fehlen im Navigationsmodus");
  await click("#navAdd"); await page.waitForTimeout(150);
  ok(await visible("#addMenu") && await page.evaluate(() => { const m = document.querySelector("#addMenu").getBoundingClientRect(), h = document.querySelector("#navUi .nav-hero").getBoundingClientRect(); return (m.top >= h.bottom || m.left >= h.right) && m.left > 50 && m.right <= innerWidth; }), "Plus-Menü erscheint nicht neben der Leiste");
  await click("#navAdd"); await page.waitForTimeout(100);
  await click("#navTools [data-act=srchopen]"); await page.waitForTimeout(200);
  ok(await visible("#srchPop"), "Suche lässt sich während der Navigation nicht öffnen");
  await rp(`closeSearch()`);
  ok(await page.locator("#navUi .nav-hero .nh-gl").count()===1, "Kreuzungsskizze fehlt in der Hauptkachel");
  ok(await page.locator("#navUi .nav-hero .nh-ap .fg").count()===1, "Annäherungsring fehlt");
  ok(await rp(`navSvg().indexOf("nv-flow")>-1`), "Fließende Richtungspunkte auf dem Weg fehlen");
  // ÖPNV-Navigation: Fußweg (Punkte ohne durchgehendes Band) klar unterscheidbar von der Fahrt (durchgehende Linie in Linienfarbe) mit Stationspunkten
  ok(await rp(`(function(){ var N0 = NAV, P = [{la:40.750,lo:-73.993},{la:40.752,lo:-73.992},{la:40.754,lo:-73.991},{la:40.760,lo:-73.988},{la:40.762,lo:-73.987}];
    NAV = {tgt:P[4], pts:P, pi:0, mode:"oepnv", segs:[{o:0,n:2,kind:"walk"},{o:2,n:2,kind:"ride",col:"#0062cf"},{o:4,n:1,kind:"walk"}], hidden:false};
    var sv = navSvg(); NAV = N0;
    var walkBand = /stroke="#fff" stroke-width="10"[^>]*opacity/.test(sv.split("nv-ride")[0]);
    return sv.indexOf("nv-walk")>-1 && sv.indexOf("nv-ride")>-1 && (sv.match(/nv-st/g)||[]).length===2 && !walkBand && sv.indexOf('stroke="#0062cf" stroke-width="9"')>-1; })()`), "Fußweg und U-Bahn-Fahrt sind in der Navigation nicht klar unterscheidbar");
  // an der Kurve nicht zu früh umspringen: kurz davor und kurz danach bleibt der Hinweis, erst 20 m danach kommt der nächste
  const at = (k) => `(function(){ var st = NAV.next, c = NAV.pts[st.i], o = NAV.pts[st.i + (${k} < 0 ? -1 : 1)], d = dist(c, o), t = Math.abs(${k})/d; me = {la:c.la + (o.la - c.la)*t, lo:c.lo + (o.lo - c.lo)*t, acc:8}; window.__st = st; navOnPos(); return NAV.next===st; })()`;
  await rp(`(function(){ var st = NAV.next, c = NAV.pts[st.i - 1]; me = {la:c.la, lo:c.lo, acc:8}; navOnPos(); })()`);
  ok(await rp(at(-6)), "Hinweis springt schon vor der Kurve um");
  ok(await rp(`(function(){ var st = window.__st, c = NAV.pts[st.i], o = NAV.pts[st.i + 1], t = 5/dist(c, o); me = {la:c.la + (o.la - c.la)*t, lo:c.lo + (o.lo - c.lo)*t, acc:8}; navOnPos(); return NAV.next===st; })()`), "Hinweis springt direkt in der Kurve um");
  ok(await rp(`(function(){ var st = window.__st, c = NAV.pts[st.i], o = NAV.pts[st.i + 1], t = 20/dist(c, o); me = {la:c.la + (o.la - c.la)*t, lo:c.lo + (o.lo - c.lo)*t, acc:8}; navOnPos(); return NAV.next!==st; })()`), "Nach der Kurve kommt der nächste Hinweis nicht");
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; NAV.pi = 0; navProgress(); navRender();`);
  // Karte in Soll-Gehrichtung per Knopf, dreht an der Kurve mit
  ok(await page.locator("#navUi [data-act=navrot]").count()===1, "Knopf „Karte in Gehrichtung“ fehlt");
  await click("#navUi [data-act=navrot]"); await page.waitForTimeout(800);
  ok(await rp(`navRotOn`), "Gehrichtung lässt sich nicht einschalten");
  const b1 = await rp(`Math.round(map.getBearing())`);
  await rp(`(function(){ var q = NAV.pts[14]; me = {la:q.la, lo:q.lo, acc:8}; navOnPos(); })()`); await page.waitForTimeout(400);
  ok(Math.abs(await rp(`map.getBearing()`) - b1) < 60, "Karte springt an der Kurve sofort um statt weich zu drehen"); await page.waitForTimeout(1500);
  const b2 = await rp(`Math.round(map.getBearing())`);
  ok(Math.abs(b1) < 10 && Math.abs(Math.abs(b2) - 90) < 15, "Karte dreht sich nicht mit der Kurve mit ("+b1+" → "+b2+")");
  await click("#navUi [data-act=navrot]"); await page.waitForFunction(() => window.__rp("Math.abs(map.getBearing()) < 2 && !map.isMoving()"), null, {timeout:4000}).catch(() => {});
  ok(Math.abs(await rp(`map.getBearing()`)) < 2, "Norden oben stellt die Karte nicht zurück");
  await rp(`(function(){ var q = NAV.pts[1]; me = {la:40.7215, lo:-73.9890, acc:8}; NAV.pi = 0; navProgress(); navRender(); })()`);
  // Ausrichtung: kurzes Wegdrehen des Handys löst nichts aus, dauerhafte Abweichung schon
  const feed = async (c, ms, extra) => { const n = Math.ceil(ms/200); for(let i = 0; i < n; i++){ await rp(`compass = ${c}; ${extra||""} navOrient();`); await page.waitForTimeout(200); } };
  await feed(2, 600);
  await feed(130, 1200);
  ok(!(await visible("#navOri")), "Kurzes Wegdrehen löst sofort einen Dreh-Hinweis aus");
  await feed(2, 1000);
  await feed(180, 4200);
  ok(await visible("#navOri") && (await page.locator("#navOri").innerText()).includes("Umdrehen"), "Dauerhaft falsche Ausrichtung zeigt keine Kachel „Umdrehen“");
  ok(await page.evaluate(() => /rotate\(/.test(document.querySelector("#navOri .no-arr").style.transform)), "Pfeil dreht sich nicht mit");
  await page.waitForTimeout(400);
  ok(await noCover(), "Ausrichtungs-Hinweis verdeckt Kartenknöpfe");
  await feed(2, 2400);
  ok(!(await visible("#navOri .no-arr")), "Kachel verschwindet nicht, wenn die Richtung wieder stimmt");
  // beim Gehen in die richtige Richtung (GPS) zählt nicht, wohin das Handy zeigt
  await feed(180, 3600, "me.spd = 1.3; me.hd = 0;");
  ok(!(await visible("#navOri .no-arr")), "Dreh-Hinweis trotz richtiger Gehrichtung");
  await rp(`me.spd = null; me.hd = null;`);
  ok(await page.locator("#navUi .nav-then").count() <= 1, "Folgeschritte zu präsent");
  await click("#navUi [data-act=navhide]");
  ok(await visible("#navUi .nav-pill") && !(await visible("#navUi .nav-hero")), "Ausblenden funktioniert nicht");
  ok(!(await rp(`document.body.classList.contains("navon")`)), "Leisten bleiben beim Ausblenden sichtbar");
  ok(await rp(`navSvg().indexOf("<path")>-1`), "Beim Ausblenden verschwindet der Navigationsweg (stattdessen anderer Weg)");
  await click("#navUi [data-act=navshow]");
  ok(await visible("#navUi .nav-hero"), "Einblenden funktioniert nicht");
  await rp(`me = {la:NAV.tgt.la, lo:NAV.tgt.lo, acc:8}; navOnPos();`); await page.waitForTimeout(150);
  ok((await page.locator("#navUi .nav-hero").innerText()).includes("Angekommen"), "Ankunft wird nicht erkannt");
  await click("#navUi [data-act=navdone]");
  ok(await rp(`!!T().done.p2 && NAV===null`), "Abhaken bei Ankunft funktioniert nicht");
});

await test("ÖPNV-Navigation: Linie(n) zum Einsteigen sichtbar (Kachel, Fußleiste, Karte)", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; navStart({la:40.7680, lo:-73.9819, n:"Columbus Circle"}, "oepnv");`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts && !NAV.busy)"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.segs && NAV.segs.some(function(sg){ return sg.kind==="ride"; }))`), "Keine Fahrt im ÖPNV-Weg");
  ok(await page.locator("#navUi .nav-foot .nav-line .bul").count() > 0, "Fußleiste zeigt nicht, welche Linie man nehmen muss");
  const ft = await page.locator("#navUi .nav-line").innerText();
  ok(/Nimm diese Linie|Nimm eine dieser Linien/.test(ft) && ft.includes("Einsteigen an"), "Linienzeile unvollständig: "+ft);
  ok(await rp(`(function(){ var sg = NAV.segs.filter(function(x){ return x.ride; })[0]; return sg.ride.lines.length === document.querySelectorAll("#navUi .nav-line .nl-b .bul").length; })()`), "Nicht alle passenden Linien angezeigt");
  ok(await rp(`navSvg().indexOf("nv-bul")>-1`), "Liniensymbol an der Einstiegsstation fehlt auf der Karte");
  await shot("nav-oepnv-linie");
  // Hinweis „Einsteigen“: Liniensymbole in der Hauptkachel
  await rp(`(function(){ var st = NAV.steps.filter(function(x){ return x.ride; })[0]; NAV.next = st; NAV.heroKey = null; navRender(); })()`);
  ok(await page.locator("#navUi .nav-hero .nh-lines .bul").count() > 0, "Hauptkachel zeigt beim Einsteigen keine Linie");
  // während der Fahrt: Aussteigen-Hinweis
  await rp(`(function(){ var sg = NAV.segs.filter(function(x){ return x.ride; })[0]; NAV.pi = sg.o + 1; navRender(); })()`);
  ok((await page.locator("#navUi .nav-line").innerText()).includes("Aussteigen an"), "Während der Fahrt fehlt der Ausstiegshinweis");
});

await test("ÖPNV-Wegbeschreibung: Route je Teilschritt starten, Ein-/Ausstieg auf der Karte antippbar", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; window.__trt = transit({la:40.7215, lo:-73.9890, id:"me"}, {la:40.7680, lo:-73.9819, n:"Columbus Circle"}, todayKey());
    var d = document.createElement("div"); d.id = "rtTest"; d.innerHTML = transitSteps(__trt, {la:40.7215, lo:-73.9890, id:"me"}, {la:40.7680, lo:-73.9819, n:"Columbus Circle"}, {day:todayKey()}); document.body.appendChild(d);`);
  ok(await rp(`!__trt.walk`), "Testverbindung ohne Fahrt");
  const nSteps = await rp(`__trt.legs.filter(function(l){ return l.t==="walk" || l.t==="xfer" || l.t==="ride"; }).length`);
  ok(await page.locator("#rtTest .rt-go").count()===nSteps, "Nicht jeder Teilschritt hat einen Route-Knopf");
  // erster Schritt: zu Fuß zur Einstiegsstation
  const st = await rp(`(function(){ var l = __trt.legs.filter(function(x){ return x.t==="ride"; })[0]; return NET.s[l.from][0]; })()`);
  await page.locator("#rtTest .rt-walk .rt-go").first().dispatchEvent("click"); await page.waitForTimeout(150);
  ok(await rp(`!!NAV && NAV.mode==="walk" && NAV.tgt.n===${JSON.stringify(st)}`), "Fußroute zur Einstiegsstation startet nicht: "+await rp(`NAV && NAV.mode+" "+NAV.tgt.n`));
  await rp(`navEnd(true)`);
  await page.locator("#rtTest .rt-ride .rt-go").first().dispatchEvent("click"); await page.waitForTimeout(150);
  ok(await rp(`!!NAV && (NAV.mode==="oepnv" || NAV.mode==="ferry")`), "Fahrt-Schritt startet keine ÖPNV-Route");
  await rp(`navEnd(true); document.getElementById("rtTest").remove();`);
  // Karte: Ein-/Ausstieg einer ÖPNV-Etappe antippen → Karte mit „Navigieren“
  await rp(`cur = todayKey(); tab = "day"; layers.route = true; var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ var r0 = transit(L[i][0], L[i][1], cur); if(!r0.walk){ setLegMode(L[i][0], L[i][1], "oepnv"); window.__li = i; break; } } renderAll(); fitPoints([L[__li][0], L[__li][1]], 1); scheduleOverlay();`);
  await page.waitForFunction(() => window.__rp("RTMK.length > 0"), null, {timeout:4000}).catch(() => {});
  ok(await rp(`RTMK.length > 0`), "Keine antippbaren Ein-/Ausstiegspunkte auf der Karte");
  await rp(`legOpen[cur+"|"+__li] = true; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  ok(await page.locator("#sheet ol.rt .rt-go").count() > 1, "Route-Knöpfe fehlen in der Wegbeschreibung im Tagesplan");
  await rp(`(function(){ var e = document.querySelector("#sheet ol.rt"); if(e) e.scrollIntoView({block:"center"}); })()`); await shot("rt-teilschritte");
  await rp(`setSheet("min"); scheduleOverlay();`); await page.waitForTimeout(300);
  await rp(`var m = RTMK[0]; tap(m.x, m.y);`); await page.waitForTimeout(200);
  ok(await rp(`sel==="rtst" || /^sub:/.test(sel || "")`), "Antippen des Einstiegs öffnet keine Stationskarte: "+await rp(`sel`));
  const nb = page.locator("#card [data-act=navpick]");
  ok(await nb.count()===1, "Stationskarte ohne „Navigieren“");
  await nb.click(); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=navgo][data-mode=walk]").count()===1, "Navigieren-Menü fehlt");
  await page.locator("#jpMenu [data-act=navgo][data-mode=walk]").click(); await page.waitForTimeout(150);
  ok(await rp(`!!NAV && NAV.mode==="walk"`), "Route zur Station startet nicht");
  await rp(`navEnd(true)`);
});

await test("Tagesplan: alles erledigt und ausgeblendet – Weg zum Hotel bleibt mit Details", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; meA = null; T().done.p1 = 1; T().done.p2 = 1; T().done.p3 = 1; hideDone = true; cur = todayKey(); tab = "day"; renderSheet();`); await page.waitForTimeout(200);
  ok(await rp(`dayLegs(todayKey()).length===1`), "Weg zum Hotel fehlt in der Route");
  ok(await page.locator("li.tleg").count()===1, "Weg zum Hotel fehlt im Tagesplan, wenn alle Stopps erledigt und ausgeblendet sind");
  ok(await page.locator("li.tleg [data-act=lmpick]").count()===1, "Verkehrsmittel-Wahl fehlt beim Weg zum Hotel");
  const det = page.locator("li.tleg [data-act=legopen]");
  if(await det.count()){ await det.first().click(); await page.waitForTimeout(200); ok(await page.locator("li.tleg .rt").count()===1, "Wegbeschreibung zum Hotel lässt sich nicht aufklappen"); }
  ok(await rp(`(function(){ var el = document.querySelector("li.tleg"), hd = document.querySelector("[data-act=hidedone]"); return !!(el && hd && (hd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)); })()`), "Weg zum Hotel steht nicht nach dem Hinweis auf die ausgeblendeten Stopps");
});

await test("Hotel-Pop-up: Zwischenstopp einplanen, beliebig oft, kein Knopf mehr im Tagesplan", async () => {
  await seed();
  await rp(`cur = todayKey(); tab = "day"; renderAll();`); await page.waitForTimeout(200);
  ok(await page.locator(".rhead [data-act=hotelstopadd]").count()===0, "Zwischenstopp-Knopf steht noch im Tagesplan");
  const n0 = await rp(`ord(cur).filter(function(x){ return P(x) && P(x).k==="hotel"; }).length`);
  for(let i = 0; i < 3; i++){
    await rp(`select("h1")`); await page.waitForTimeout(150);
    const b = page.locator("#card [data-act=hotelstopadd]");
    ok(await b.count()===1, "Zwischenstopp fehlt im Hotel-Pop-up");
    await b.click(); await page.waitForTimeout(200);
  }
  ok(await rp(`ord(cur).filter(function(x){ return P(x) && P(x).k==="hotel"; }).length`)===n0+3, "Nicht jeder Zwischenstopp wurde eingeplant");
  ok(await rp(`!sel`), "Hotel-Pop-up bleibt nach dem Einplanen offen");
  ok(await page.locator("#sheet li", {hasText:"Zwischenstopp im Hotel"}).count() >= 3, "Zwischenstopps fehlen im Tagesplan");
});

await test("Tagesplan: Hotel verschieben – Ziele nach dem Hotel, Vorlage zurück", async () => {
  await seed();
  await rp(`me = null; meA = null; cur = todayKey(); tab = "day"; renderAll();`); await page.waitForTimeout(200);
  ok(await page.locator("ol.plan li.hx .grip").count()===2, "Start- und End-Hotel lassen sich nicht ziehen");
  await shot("hotel-vorlage");
  ok(await rp(`(function(){ var L = dayLegs(cur); return L[0][0]===dayByKey(cur).hotel && L[L.length-1][1]===dayByKey(cur).hotel; })()`), "Vorlage: Hotel ist nicht Start und Ende");
  // End-Hotel per Pfeiltaste vor MoMA ziehen
  await page.locator("ol.plan li.hx[data-id='@he'] .grip").focus(); await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200);
  ok(await rp(`hFree(cur)`), "Tag ist nach dem Verschieben nicht frei");
  await shot("hotel-frei");
  ok(await rp(`(function(){ var o = ord(cur); return o.length===5 && isHStop(o[0]) && o[1]==="p1" && o[2]==="p2" && isHStop(o[3]) && o[4]==="p3"; })()`), "Reihenfolge falsch: "+await rp(`ord(cur).map(function(x){ return isHStop(x) ? "H" : x; }).join(",")`));
  ok(await rp(`(function(){ var L = dayLegs(cur), last = L[L.length-1]; return L.length===4 && last[0].k==="hotel" && last[1].id==="p3"; })()`), "Route endet nicht am Ziel nach dem Hotel");
  ok(await page.locator("ol.plan li.hx").count()===0 && await page.locator("#sheet li.st", {hasText:"Start im Hotel"}).count()===1, "Hotel-Stopps fehlen im Tagesplan");
  // neues Ziel landet am Ende (nach dem Hotel steht schon MoMA)
  await rp(`plan("p6", cur); renderAll();`); await page.waitForTimeout(150);
  ok(await rp(`ord(cur)[ord(cur).length-1]==="p6"`), "Neues Ziel nicht am Ende");
  // Erledigt: Start-Hotel davor gilt als verlassen
  await rp(`T().done.p1 = true; doneMove("p1", cur); renderAll();`); await page.waitForTimeout(150);
  ok(await rp(`!!T().done[ord(cur)[0]] && isHStop(ord(cur)[0])`), "Start-Hotel nicht als verlassen markiert");
  // zurück zur Vorlage: Hotel vorn und hinten → wieder normales Start-/End-Hotel
  await rp(`(function(){ var t = T(), hs = ord(cur).filter(isHStop); delete t.done.p1; delete t.done[hs[0]]; t.order[cur] = [hs[0], "p1", "p2", "p3", hs[1], "p6"]; renderAll(); })()`); await page.waitForTimeout(150);
  await page.locator("ol.plan li.st[data-id='p6'] .grip").focus(); await page.keyboard.press("ArrowUp"); await page.waitForTimeout(200);
  ok(await rp(`!hFree(cur) && ord(cur).join(",")==="p1,p2,p3,p6" && !Object.keys(T().places).some(function(k){ return T().places[k].k==="hotel"; })`), "Vorlage nicht wiederhergestellt: "+await rp(`ord(cur).join(",")`));
  ok(await page.locator("ol.plan li.hx").count()===2, "Start-/End-Hotel fehlen nach dem Zurückschieben");
});

await test("Liste: besuchte Orte nach Sichtbarkeit filtern", async () => {
  await seed();
  // gestern besucht: p4, p5; p4 privat, p5 für Freunde; dazu heute p1 besucht (Reise)
  await rp(`T().done.p1 = 1; T().privP = {p4:1}; T().pubP = {p5:1}; openLsPage();`); await page.waitForTimeout(250);
  const rows = async () => page.evaluate(() => [...document.querySelectorAll(".ls-row[data-pid]")].map(e => e.getAttribute("data-pid")).join(","));
  ok(await page.locator(".ls-dds .ls-dd").count()===2 && await page.locator(".ls-vfilt, .ls-filt").count()===0, "Filter sollen zwei Dropdowns in einer Zeile sein");
  const box = await page.evaluate(() => { var a = document.querySelectorAll(".ls-dds .ls-dd"); return Math.abs(a[0].getBoundingClientRect().top - a[1].getBoundingClientRect().top); });
  ok(box < 4, "Dropdowns nicht in einer Zeile");
  const vis = async (v) => { await click("[data-act=lsvispick]"); await click("#jpMenu [data-act=lsvis][data-v="+v+"]"); await page.waitForTimeout(150); };
  ok((await rows()).split(",").length===3, "Ohne Filter nicht alle besuchten Orte: "+await rows());
  await click("[data-act=lsvispick]"); ok(await page.locator("#jpMenu [data-act=lsvis]").count()===4, "Sichtbarkeits-Dropdown unvollständig"); await shot("liste-sichtbarkeit");
  await click("#jpMenu [data-act=lsvis][data-v=priv]"); await page.waitForTimeout(150);
  ok((await page.locator("[data-act=lsvispick]").innerText()).includes("Privat"), "Dropdown zeigt Auswahl nicht");
  ok(await rows()==="p4", "Filter Privat zeigt falsche Orte: "+await rows());
  await vis("pub");
  ok(await rows()==="p5", "Filter Freunde zeigt falsche Orte: "+await rows());
  await vis("trip");
  ok(await rows()==="p1", "Filter Reise zeigt falsche Orte: "+await rows());
  // kombinierbar mit „Noch nicht bewertet“
  await rp(`T().rating = {p1:3}; renderLs();`); await page.waitForTimeout(100);
  await click("[data-act=lsfiltpick]"); await click("#jpMenu [data-act=lsfilt][data-v=unrated]"); await page.waitForTimeout(150);
  ok(await rows()==="" && (await page.locator(".nt-empty").first().innerText()).includes("Reise"), "Kombination mit „Noch nicht bewertet“ falsch");
  await vis("all");
  ok((await rows()).split(",").sort().join(",")==="p4,p5", "Filter Alle setzt nicht zurück: "+await rows());
});

await test("Routen-Pop-up: ein Knopf „In anderer App navigieren“ mit Auswahl Apple Karten / Google Maps", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; openGo("p2");`); await page.waitForTimeout(200);
  ok(await page.locator("#catPop .gp-modes, #catPop .gp-app, #catPop [data-act=goin]").count()===0, "Alte Verkehrsmittel-Kacheln / App-Wahl / U-Bahn-Weg-Knopf noch da");
  ok(await page.locator("#catPop [data-act=navstart]").count()===5, "In-App-Navigation fehlt");
  ok(await visible("#catPop [data-act=goext]"), "Knopf „In anderer App navigieren“ fehlt");
  await click("#catPop [data-act=goext]"); await page.waitForTimeout(250);
  await shot("route-andere-app");
  const links = await page.evaluate(() => [...document.querySelectorAll("#catPop .gp-sh a")].map(a => a.textContent+"|"+a.getAttribute("href")));
  ok(links.length===2 && /^Apple Karten\|https:\/\/maps\.apple\.com\/directions\?destination=/.test(links[0]) && /^Google Maps\|https:\/\/www\.google\.com\/maps\/dir\//.test(links[1]), "Auswahl Apple Karten / Google Maps falsch: "+links.join(" ; "));
  ok(links.every(l => !/mode=|travelmode=/.test(l)), "Verkehrsmittel sollte in der anderen App gewählt werden: "+links.join(" ; "));
  ok(await page.evaluate(() => { const r = document.querySelector("#catPop .gp-sh a").getBoundingClientRect(); return r.width > 200 && r.bottom <= innerHeight; }), "Auswahl ist nicht voll sichtbar");
  await click("#catPop .gp-sh-x"); await page.waitForTimeout(150);
  ok(await page.locator("#catPop .gp-sheet").count()===0 && await visible("#catPop [data-act=goext]"), "Abbrechen schließt die Auswahl nicht");
});

await test("Navigation zu U-Bahn- und Citi-Bike-Stationen", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; layers.sub = true; layers.bike = true; cbLoad(true);`); await page.waitForTimeout(800);
  const si = await rp(`TRANSIT.stations.findIndex(function(st){ return /Bleecker/.test(st[0]); })`);
  ok(si > -1, "Teststation nicht gefunden");
  await rp(`select("sub:${si}")`); await page.waitForTimeout(150);
  ok((await page.locator("#card").innerText()).includes("U-Bahn-Station"), "Stations-Pop-up fehlt");
  await click("#card [data-act=navpick]");
  ok(await page.locator("#jpMenu [data-act=navgo]").count()===3, "Menü zur Station sollte Zu Fuß, Citi Bike und Auto bieten");
  await page.waitForSelector("#jpMenu [data-act=navgo][data-mode=walk]"); await rp(`document.querySelector("#jpMenu [data-act=navgo][data-mode=walk]").click()`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts)"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`NAV && /Bleecker/.test(NAV.tgt.n) && !!NAV.pts`), "Navigation zur U-Bahn-Station startet nicht");
  await rp(`navEnd(true)`); await page.waitForFunction(() => window.__rp("!map.isMoving()"), null, {timeout:5000}).catch(() => {});
  await rp(`select("cb:S2")`); await page.waitForTimeout(150);
  await click("#card [data-act=navpick]");
  await page.waitForSelector("#jpMenu [data-act=navgo][data-mode=walk]"); await rp(`document.querySelector("#jpMenu [data-act=navgo][data-mode=walk]").click()`);
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts)"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`NAV && /Washington Sq E/.test(NAV.tgt.n)`), "Navigation zur Citi-Bike-Station startet nicht");
  await rp(`navEnd(true); select("p1"); trOpen = true; renderCard();`); await page.waitForTimeout(150);
  ok(await page.locator("#card [data-act=navsub]").count()===1, "„Hinlaufen“ zur nächsten U-Bahn fehlt im Orts-Pop-up");
});

await test("Routen-Pop-up bleibt bei Standort-Updates ruhig", async () => {
  await seed();
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; openGo("p2");`); await page.waitForTimeout(300);
  await page.evaluate(() => { window.__pc = document.querySelector("#catPop .pop-card"); });
  for(let i = 0; i < 5; i++){ await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; renderGo(true);`); await page.waitForTimeout(60); }
  ok(await page.evaluate(() => window.__pc === document.querySelector("#catPop .pop-card")), "Pop-up wird bei jedem Standort-Update neu aufgebaut (zuckt)");
  await rp(`me = {la:40.7000, lo:-73.9890, acc:8}; renderGo(true);`); await page.waitForTimeout(60);
  // entweder gar nicht neu aufgebaut (nichts hängt vom Standort ab) oder neu aufgebaut ohne Einblend-Animation
  ok(await page.evaluate(() => { const c = document.querySelector("#catPop .pop-card"); return !!c && (c===window.__pc || getComputedStyle(c).animationName==="none"); }), "Aktualisierung spielt die Einblend-Animation erneut ab");
});

await test("Tagesplan: Privat-Plakette sichtbar", async () => {
  await seed();
  await rp(`T().privP = {p2:1}; renderSheet();`);
  ok(await page.locator(".privmk").count() >= 1, "Privat-Plakette fehlt");
});

/* ---------- Ziele: Orte ohne Reise merken ---------- */
async function noTripUser(){
  await rp(`acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; fbDb = null; acct.state = "ok"; S = fresh(); renderGate(); renderAll(); true`);
}
await test("Ziele: ohne Reise merken legt Ziel an, keine Reise entsteht", async () => {
  await noTripUser();
  await rp(`poiSel = {n:"Trattoria Roma", c:"essen", la:41.9000, lo:12.5000, addr:"Via del Corso 1, Rom"}; sel = null; select("poi");`); await page.waitForTimeout(200);
  ok(await page.locator("#card [data-act=poimerk]").count()===1, "Merken-Kachel fehlt ohne Reise");
  ok(await page.locator("#card [data-act=poiadd]").count()===0, "Wunschliste-Kachel ohne Reise");
  await shot("ziel-poi");
  await click("#card [data-act=poimerk]");
  await page.waitForFunction(() => window.__rp("zielIds().length===1"), null, {timeout:4000});
  ok(await rp(`S.trips[zielIds()[0]].name`)==="Rom", "Ziel heißt nicht nach der Stadt");
  ok(await rp(`noTrip() && liveIds().length===0`), "Ziel zählt als Reise");
  ok((await page.locator("#toast").innerText()).includes("gemerkt in „Rom“"), "Hinweis nach dem Merken fehlt");
  await rp(`poiSel = {n:"Pantheon", c:"sight", la:41.8986, lo:12.4769, addr:"Piazza della Rotonda, Rom"}; sel = null; select("poi");`); await page.waitForTimeout(150);
  await click("#card [data-act=poimerk]"); await page.waitForTimeout(200);
  ok(await rp(`zielIds().length===1 && Object.keys(S.trips[zielIds()[0]].places).length===2`), "Zweiter Ort landet nicht im selben Ziel");
  ok(await page.locator("#card [data-act=planpick]").count()===0, "„Zur Planung“ ohne Reise");
  await rp(`select(null); lpShow({la:41.8902, lo:12.4922})`); await page.waitForTimeout(300);
  ok(await page.locator("#catPop [data-act=lpmerk]").count()===1 && await page.locator("#catPop [data-act=lpwish], #catPop [data-act=lphotel]").count()===0, "Langes Drücken ohne Reise bietet nicht nur Merken");
  await click("#catPop [data-act=lpmerk]"); await page.waitForTimeout(200);
  ok(await rp(`zielIds().length===1 && Object.keys(S.trips[zielIds()[0]].places).length===3`), "Markierter Punkt nicht im Ziel gemerkt");
  ok(await page.locator("#card .zgem").count()===1, "Pop-up zeigt nicht „Gemerkt in …“");
  await rp(`select(null); openZiele()`); await page.waitForTimeout(200);
  ok(await page.locator("#profView .pf-trip.zt").count()===1, "Ziel fehlt im Profil");
  await shot("ziele-liste");
  await click("#profView .pf-trip.zt");
  ok(await page.locator("#zPop .zrow").count()===3, "Gemerkte Orte fehlen im Ziel");
  await shot("ziel-detail");
});
await test("Ziele: neue Reise bietet gemerkte Orte an, Besuch erscheint sofort im Ziel", async () => {
  await noTripUser();
  await rp(`var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); zielAdd(z, {n:"Trattoria Roma", c:"essen", la:41.9, lo:12.5}); zielAdd(z, {n:"Pantheon", c:"sight", la:41.8986, lo:12.4769}); save(); true`);
  await rp(`(function(){ function dk(o){ var d = new Date(); d.setDate(d.getDate()+o); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
    tdraft = {mode:"new", name:"Rom im Frühling", start:dk(0), end:dk(3), arr:"", dep:"", hotels:[{n:"", loc:"", from:"", to:""}], orte:[{n:"Rom", loc:"41.9000, 12.5000", from:"", to:""}], err:""}; tab = "trip"; renderSheet(); })()`);
  await page.waitForTimeout(150);
  await rp(`document.getElementById("tForm").requestSubmit()`); await page.waitForTimeout(800);
  ok(await visible("#cfPop"), "Frage zum Übernehmen fehlt");
  ok((await page.locator("#cfPop").innerText()).includes("2 gemerkte Orte"), "Falsche Anzahl im Angebot");
  ok((await page.locator("#cfPop .cf-no").innerText()).includes("Erstmal nicht") && (await page.locator("#cfPop .cf-no").innerText()).includes("später noch möglich"), "„Erstmal nicht“ mit Hinweis fehlt");
  ok(await page.locator("#cfPop .cf-ok").evaluate(e => { const m = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number); return !(m[0] > m[1] + 60 && m[0] > m[2] + 60); }), "„Übernehmen“ ist rot (rot nur für Löschen)");
  // „Erstmal nicht“: später in der Wunschliste übernehmen
  await click("#cfPop .cf-no"); await page.waitForTimeout(150);
  await rp(`tab = "wish"; renderSheet(); true`); await page.waitForTimeout(150);
  const zt = await page.locator("#body .wtiles [data-act=zoffer]").innerText();
  ok(zt.includes("2") && zt.includes("Gemerkt"), "Kachel „Gemerkt“ in der Wunschliste fehlt");
  await shot("wunsch-kacheln");
  await click("#body [data-act=zoffer]"); await page.waitForTimeout(150);
  await click("#cfPop .cf-ok"); await page.waitForTimeout(200);
  ok(await page.locator("#body [data-act=zoffer]:not([disabled])").count()===0, "Angebot bleibt nach dem Übernehmen stehen");
  ok(await rp(`Object.keys(T().places).filter(function(k){ return T().places[k].zl; }).length`)===2, "Orte nicht übernommen");
  ok(await rp(`!T().ziel && !noTrip()`), "Neue Reise ist nicht aktiv");
  await rp(`var k = Object.keys(T().places).filter(function(k){ return T().places[k].n==="Pantheon"; })[0], d = days()[0].key; T().order[d] = [k]; T().done[k] = true; T().rating = {}; T().rating[k] = 2; save(); openZiele(zielIds()[0]);`);
  await page.waitForTimeout(200);
  const txt = await page.locator("#zPop .zdpop").innerText();
  ok(/Besucht auf Reisen · 1/i.test(txt) && txt.includes("Must Have") && /Gemerkt · 1/i.test(txt), "Besuchter gemerkter Ort steht nicht unter „Besucht auf Reisen“: "+txt.replace(/\n/g, " / "));
  ok(await page.locator("#zPop .zrow").count()===1 && !(await page.locator("#zPop .zrow").innerText()).includes("Pantheon"), "Besuchter Ort steht noch unter „Gemerkt“");
  ok(await rp(`Object.keys(S.trips[zielIds()[0]].places).length`)===2, "Besuchter Ort wurde aus dem Ziel entfernt");
  ok(txt.includes("Wunschliste"), "Übernommener, noch offener Ort zeigt keinen Stand");
  await shot("ziel-besucht");
  // Kategorie-Filter wirkt auf „Gemerkt“ und „Besucht auf Reisen“
  await click("#zPop [data-act=zcatpop]");
  ok(await visible("#catPop [data-act=zcat][data-cat=sight]") && await visible("#catPop [data-act=zcat][data-cat=essen]"), "Kategorie-Auswahl im Ziel fehlt");
  await click("#catPop [data-act=zcat][data-cat=essen]");
  await shot("ziel-filter-pop");
  await click("#catPop .btn[data-act=catclose]");
  let ft = await page.locator("#zPop .zdpop").innerText();
  ok(ft.includes("Trattoria Roma") && !ft.includes("Pantheon") && /Besucht auf Reisen · 0 von 1/i.test(ft), "Filter Essen wirkt nicht auf beide Abschnitte: "+ft.replace(/\n/g, " / "));
  ok((await page.locator("#zPop [data-act=zcatpop]").innerText()).includes(await rp(`CATNAME.essen`)), "Filter-Knopf zeigt die Kategorie nicht");
  await shot("ziel-filter");
  await click("#zPop [data-act=zcatreset]");
  ft = await page.locator("#zPop .zdpop").innerText();
  ok(ft.includes("Trattoria Roma") && ft.includes("Pantheon"), "Filter zurücksetzen wirkt nicht");
  ok(await rp(`zOfferItems(S.cur).length`)===0, "Bereits übernommene Orte würden erneut angeboten");
});
await test("Ziele: „Reise planen“ öffnet Formular ohne Datumswähler", async () => {
  await noTripUser();
  await rp(`var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); save(); openZiele(z); true`); await page.waitForTimeout(200);
  await click("#zPop [data-act=zplan]"); await page.waitForTimeout(200);
  ok(await page.locator("[data-f=start]").count()===1, "Reiseformular nicht geöffnet");
  ok(await rp(`!document.activeElement || document.activeElement.type!=="date"`), "Datumsfeld hat sofort den Fokus (iOS öffnet den Datumswähler)");
});

await test("Neue Reise: Zeitraum kompakt mit Datum/Uhrzeit nebeneinander und Nächten", async () => {
  await noTripUser();
  await rp(`var z = zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); save(); openZiele(z); true`); await page.waitForTimeout(200);
  await click("#zPop [data-act=zplan]"); await page.waitForTimeout(200);
  ok(await page.locator("#tForm .tf-span").count()===2, "Zeitraum nicht in zwei Zeilen");
  ok((await page.locator("#tForm .tf-pill.t").first().innerText()).trim()==="Uhrzeit", "Platzhalter Uhrzeit fehlt");
  // Zeitraum-Kalender: erster Tipp Anreise, zweiter Tipp Abreise
  const [k1, k2, k0] = await rp(`(function(){ var d = new Date(); function k(n){ return rngKey(new Date(d.getFullYear(), d.getMonth(), n, 12)); } return [k(10), k(14), k(5)]; })()`);
  await click("#tForm [data-act=rngopen][data-f=start]"); await page.waitForTimeout(150);
  ok(await visible("#rngPop .rng"), "Kalender öffnet nicht");
  ok(await rp(`document.activeElement.type!=="date"`), "Natives Datumsfeld statt Kalender");
  await click(`#rngPop [data-r="${k1}"]`); await page.waitForTimeout(80);
  ok(await visible("#rngPop .rng"), "Kalender schließt schon nach dem ersten Tipp");
  await click(`#rngPop [data-r="${k2}"]`); await page.waitForTimeout(500);
  ok(!(await visible("#rngPop")), "Kalender schließt nach dem zweiten Tipp nicht");
  ok(await rp(`tdraft.start==="${k1}" && tdraft.end==="${k2}"`), "Zeitraum nicht übernommen");
  // erneut öffnen: Bereich markiert; früheres Datum als 2. Tipp wird neue Anreise
  await click("#tForm [data-act=rngopen][data-f=start]"); await page.waitForTimeout(150);
  ok(await page.locator("#rngPop .rng-d.in").count()===3, "Bereich zwischen An- und Abreise nicht markiert");
  await shot("zeitraum-kalender");
  await page.setViewportSize({width:844, height:390}); await page.waitForTimeout(400);
  ok(await rp(`(function(){ var r = document.querySelector("#rngPop .rng").getBoundingClientRect(), b = document.querySelector("#rngPop .rng-ok").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && b.bottom <= r.bottom; })()`), "Kalender passt quer nicht ins Bild");
  await shot("zeitraum-kalender-quer");
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(400);
  await click(`#rngPop [data-r="${k2}"]`); await click(`#rngPop [data-r="${k0}"]`); await click(`#rngPop [data-r="${k1}"]`); await page.waitForTimeout(500);
  ok(await rp(`tdraft.start==="${k0}" && tdraft.end==="${k1}"`), "Früheres Datum nicht als neue Anreise genommen");
  await click("#tForm [data-act=rngopen][data-f=start]"); await click(`#rngPop [data-r="${k1}"]`); await click(`#rngPop [data-r="${k2}"]`); await page.waitForTimeout(500);
  await page.fill("[data-f=arr]", "14:30");
  ok((await page.locator("#tForm .tf-pill.d").first().innerText()).includes("10."), "Datum nicht lesbar angezeigt");
  ok((await page.locator("#tForm .tf-pill.t").first().innerText()).trim()==="14:30", "Uhrzeit nicht angezeigt");
  ok((await page.locator("#tfNights").innerText()).includes("4 Nächte"), "Nächte fehlen");
  ok(await rp(`tdraft.arr==="14:30"`), "Uhrzeit nicht übernommen");
  await shot("neue-reise-zeitraum");
});

await test("Reise-Status und Option: abgeschlossen/aktuell/in Planung, Option ohne Termin anlegen", async () => {
  await seed();
  ok(await rp(`(function(){ var tk = todayKey(); function k(n){ return addD(tk, n); }
    return tripStatus({start:k(-9), end:k(-1)})==="done" && tripStatus({start:k(-2), end:k(0)})==="now" && tripStatus({start:k(1), end:k(5)})==="plan" && tripStatus({opt:true, start:"", end:""})==="opt"; })()`), "Status falsch berechnet");
  // Neue Reise als Option: ohne Zeitraum und Hotels, Name + Ort nötig
  await rp(`closeMenus(); tdraft = {mode:"new", name:"", start:"", end:"", arr:"", dep:"", hotels:[{n:"", loc:"", from:"", to:""}], orte:[{n:"", loc:"", from:"", to:""}], err:""}; tab = "trip"; renderSheet(); true`); await page.waitForTimeout(200);
  ok(await rp(`(function(){ var o = document.querySelector("#tForm .tf-opt"), n = document.querySelector("#tForm [data-f=name]"); return !!o && !!(o.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), "Schieberegler Option fehlt oder nicht am Anfang");
  await click("#tForm [data-act=topt]"); await page.waitForTimeout(150);
  ok(await page.locator("#tForm [data-act=topt][aria-checked=true]").count()===1, "Option nicht eingeschaltet");
  ok(await page.locator("#tForm .tf-span").count()===0 && await page.locator("#tForm [data-path=hotels]").count()===0, "Zeitraum/Hotels bei Option noch sichtbar");
  await shot("neue-reise-option");
  await page.fill("#tForm [data-f=name]", "Lissabon irgendwann");
  await page.locator("#tForm [type=submit]").click(); await page.waitForTimeout(200);
  ok((await page.locator("#tForm .err").innerText()).includes("mindestens einen Ort"), "Ort wird bei Option nicht verlangt");
  await rp(`tdraft.orte[0].n = "Lissabon"; tdraft.orte[0].loc = "38.72, -9.14"; true`);
  await page.locator("#tForm [type=submit]").click(); await page.waitForTimeout(400);
  ok(await rp(`T().name==="Lissabon irgendwann" && T().opt===true && !T().start && !T().end && T().orte.length===1 && days().length===0`), "Option-Reise nicht angelegt");
  ok(await rp(`$("tripBtn").textContent.includes("Option")`), "Kopfzeile zeigt nicht „Option“: "+await rp(`$("tripBtn").textContent+" / "+getComputedStyle($("tripBtn")).display`));
  ok(await rp(`lsTripSub(T())==="Option" && lsTripIds()[1]===S.cur`), "Liste: Reise-Auswahl zeigt Status nicht");
  await click("#tripBtn"); await page.waitForTimeout(150);
  ok((await page.locator("#tripMenu").innerText()).includes("Option") && (await page.locator("#tripMenu .tst").count()) >= 2, "Reise-Menü zeigt den Status nicht");
  await shot("reise-status-menue");
  await rp(`closeMenus(); true`);
  // Bearbeiten: Option aus → Zeitraum wieder da, ohne Datum Fehler; mit Datum wird es eine geplante Reise
  await rp(`tdraft = tripToDraft(T(), "edit"); tab = "trip"; renderSheet(); true`); await page.waitForTimeout(150);
  ok(await page.locator("#tForm [data-act=topt][aria-checked=true]").count()===1, "Option beim Bearbeiten nicht gesetzt");
  await click("#tForm [data-act=topt]"); await page.waitForTimeout(150);
  ok(await page.locator("#tForm .tf-span").count()===2, "Zeitraum nach Ausschalten nicht da");
  await page.locator("#tForm [type=submit]").click(); await page.waitForTimeout(200);
  ok((await page.locator("#tForm .err").innerText()).includes("An- und Abreise"), "Ohne Option kein Datum verlangt");
  await rp(`tdraft.start = addD(todayKey(), 10); tdraft.end = addD(todayKey(), 13); true`);
  await page.locator("#tForm [type=submit]").click(); await page.waitForTimeout(400);
  ok(await rp(`!T().opt && tripStatus(T())==="plan" && days().length===4`), "Aus Option wird keine geplante Reise");
  // Profil: Status als Plakette auf der Kachel, Filter nach Status (Mehrfachauswahl)
  await rp(`var o = newTripObj({name:"Irgendwann Japan", start:"", end:"", orte:[{id:"o_j", n:"Tokio", la:35.68, lo:139.69}], opt:true}); S.trips[o.id] = o; save(); pfStat = {}; openProfile(); true`); await page.waitForTimeout(300);
  ok(await page.locator("#profView .pf-trip .pf-st").count()===3, "Status-Plakette fehlt auf den Kacheln");
  ok(await page.locator("#profView .pf-trip .pf-st.pfs-opt").count()===1, "Option-Plakette fehlt");
  ok(await page.locator("#profView .pf-trip").first().locator(".pfs-now").count()===1, "Aktuelle Reise steht nicht oben links");
  ok(await rp(`(function(){ var ids = liveIds(), sorted = ids.map(function(k){ return S.trips[k]; }).sort(tripCmp); return tripStatus(sorted[0])==="now" && tripStatus(S.trips[lsTripIds()[0]])==="now"; })()`), "Aktuelle Reise nicht zuerst in Menü/Liste");
  await shot("profil-status");
  await click("#profView [data-act=pfstatpick]"); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=pfstat]").count()===5, "Status-Filter hat nicht Alle + 4 Status");
  await click("#jpMenu [data-act=pfstat][data-v=opt]"); await page.waitForTimeout(150);
  ok(await visible("#jpMenu"), "Filter-Menü schließt bei Mehrfachauswahl");
  ok(await page.locator("#profView .pf-trip").count()===1, "Filter Option zeigt nicht nur die Option-Reise");
  await click("#jpMenu [data-act=pfstat][data-v=now]"); await page.waitForTimeout(150);
  ok(await page.locator("#profView .pf-trip").count()===2 && await rp(`pfStatSel().length===2`), "Mehrfachauswahl im Status-Filter geht nicht");
  ok((await page.locator("#profView [data-act=pfstatpick]").innerText()).includes("2 Status"), "Filter-Knopf zeigt Auswahl nicht");
  await shot("profil-status-filter");
  await click("#jpMenu [data-act=pfstat][data-v='']"); await page.waitForTimeout(150);
  ok(await page.locator("#profView .pf-trip").count()===3, "„Alle“ setzt den Filter nicht zurück");
});

await test("Reise bearbeiten: „Reise löschen“ ganz unten, volle Breite, gedämpft rot", async () => {
  await seed();
  await rp(`acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; META[S.cur] = {owner:"u_me", members:["u_me"], roles:{u_me:"owner"}}; tdraft = tripToDraft(T(), "edit"); tab = "trip"; renderSheet(); true`); await page.waitForTimeout(200);
  ok(await page.locator("#tripPop [data-act=deltrip]").count()===1, "Reise löschen fehlt");
  ok(await rp(`(function(){ var b = document.querySelector("#tripPop [data-act=deltrip]"), all = document.querySelectorAll("#tripPop button, #tripPop input, #tripPop select"), last = all[all.length-1]; return last===b || b.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING; })()`), "Reise löschen steht nicht ganz unten");
  ok(await rp(`(function(){ var b = document.querySelector("#tripPop [data-act=deltrip]").getBoundingClientRect(), f = document.querySelector("#tripPop .tf-foot").getBoundingClientRect(); return b.width >= f.width - 50; })()`), "Reise löschen nicht über die volle Breite");
  ok(await page.locator("#tripPop [data-act=deltrip]").evaluate(e => { const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g).map(Number); return m.length===4 && m[3] < 0.5; }), "Reise löschen knallrot statt gedämpft");
  await page.locator("#tripPop [data-act=deltrip]").scrollIntoViewIfNeeded(); await shot("reise-loeschen-unten");
});

await test("Mitreisende & Beobachter: Einladen steht vor der Liste der Personen", async () => {
  await seed();
  await rp(`acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; META[S.cur] = {owner:"u_me", members:["u_me","u_b"], memberEmails:{u_b:"b@test.de"}, invites:["c@test.de"], viewers:[]}; shOpen(S.cur); true`); await page.waitForTimeout(200);
  ok(await rp(`(function(){ var f = document.querySelector("#shPop #invForm"), l = document.querySelector("#shPop .mlist"); return !!(f && l) && !!(f.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), "Einladen steht nicht vor der Liste");
  ok(await rp(`(function(){ var r = document.querySelector("#shPop [data-act=invrole]"), l = document.querySelector("#shPop .mlist"); return !!(r.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), "„Einladen als“ steht nicht vor der Liste");
  await shot("mitreisende-popup");
  await rp(`shClose(); true`);
});

await test("Neue Reise: Von/Bis bei Ort und Hotel über den Kalender, Eingaben bleiben erhalten", async () => {
  await noTripUser();
  await rp(`tdraft = {mode:"new", name:"Lissabon", start:"2026-11-02", end:"2026-11-08", arr:"", dep:"", hotels:[{n:"Hotel Avenida", loc:"", from:"", to:""}], orte:[{n:"Lissabon", loc:"38.7200, -9.1400", from:"", to:""}], err:"", ok:"orte.0"}; tab = "trip"; renderSheet(); true`); await page.waitForTimeout(150);
  ok(await page.locator("#tripPop input[type=date]").count()===0, "Noch native Datumsfelder im Formular");
  ok((await page.locator("#tripPop [data-act=rngopen][data-f='orte.0.from']").innerText()).includes("Reisebeginn"), "Von zeigt keinen Platzhalter");
  await click("#tripPop [data-act=rngopen][data-f='orte.0.from']"); await page.waitForTimeout(150);
  ok(await rp(`rng.m===10 && rng.y===2026`), "Kalender startet nicht im Reisemonat");
  ok((await page.locator("#rngPop .rng-top").innerText()).includes("Von"), "Kalender nennt nicht Von/Bis");
  await click(`#rngPop [data-r="2026-11-03"]`); await click(`#rngPop [data-r="2026-11-05"]`); await page.waitForTimeout(500);
  ok(await rp(`tdraft.orte[0].from==="2026-11-03" && tdraft.orte[0].to==="2026-11-05" && tdraft.start==="2026-11-02" && tdraft.name==="Lissabon" && tdraft.hotels[0].n==="Hotel Avenida"`), "Zeitraum des Orts nicht übernommen oder andere Eingaben verloren");
  ok(await visible("#tripPop #tForm"), "Formular nach dem Kalender geschlossen");
  // nur innerhalb der Reise wählbar; verkürzte Reise zieht Ortsdaten mit
  await click("#tripPop [data-act=rngopen][data-f='orte.0.to']"); await page.waitForTimeout(150);
  ok(await rp(`document.querySelector('#rngPop [data-r="2026-11-01"]').disabled && document.querySelector('#rngPop [data-r="2026-11-09"]').disabled && !document.querySelector('#rngPop [data-r="2026-11-08"]').disabled`), "Tage außerhalb der Reise wählbar");
  await rp(`rngClose(false); true`);
  await click("#tripPop [data-act=rngopen][data-f=start]"); await click(`#rngPop [data-r="2026-11-04"]`); await click(`#rngPop [data-r="2026-11-06"]`); await page.waitForTimeout(500);
  ok(await rp(`tdraft.orte[0].from==="2026-11-04" && tdraft.orte[0].to==="2026-11-05"`), "Ortsdaten nicht an verkürzte Reise angepasst: "+await rp(`JSON.stringify(tdraft.orte[0])`));
  // Fehltipp: Finger setzt im Formular auf, lässt auf dem Hintergrund los – Formular bleibt
  await rp(`document.querySelector("#tripPop [data-f='orte.0.n']").dispatchEvent(new PointerEvent("pointerdown", {bubbles:true})); document.getElementById("tripPop").click(); true`);
  await page.mouse.click(5, 5); await page.waitForTimeout(200);
  ok(await visible("#tripPop #tForm") && await rp(`tdraft && tdraft.name==="Lissabon"`), "Tipp neben das Formular verwirft die Eingaben");
  await shot("ort-von-bis");
});

await test("Neue Reise: Hotel „noch unklar“ ohne Fehler, später nachtragbar", async () => {
  await noTripUser();
  await rp(`tdraft = {mode:"new", name:"Lissabon", start:"2026-11-02", end:"2026-11-06", arr:"", dep:"", hotels:[{n:"", loc:"", from:"", to:""}], orte:[{n:"Lissabon", loc:"38.7200, -9.1400", from:"", to:""}], err:"", ok:"hotels.0"}; tab = "trip"; renderSheet(); true`); await page.waitForTimeout(150);
  await click("#tForm [data-act=htbd]"); await page.waitForTimeout(100);
  const tx = await page.locator("#tForm .tf-item.tbd").innerText();
  ok(tx.includes("noch unklar") && !(await page.locator("#tForm .tf-item.tbd .miss").count()), "„Noch unklar“ fehlt oder zeigt „Lage fehlt“");
  await shot("hotel-unklar");
  await rp(`document.getElementById("tForm").requestSubmit()`); await page.waitForTimeout(600);
  ok(await rp(`!noTrip() && T().name==="Lissabon" && T().hotels.length===0`), "Reise mit unklarem Hotel nicht angelegt");
});

await test("Ziele: „Reise planen“ schließen (× oder Abbrechen) führt zurück zum Ziel", async () => {
  await seed(); // mit bestehender Reise: Abbrechen darf nicht deren Bearbeiten zeigen
  await rp(`var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); save(); openZiele(z); true`); await page.waitForTimeout(200);
  for(const how of ["#tripPop [data-act=tripclose]", "#tripPop [data-act=tcancel]"]){
    await click("#zPop [data-act=zplan]"); await page.waitForTimeout(200);
    ok(await visible("#tripPop #tForm"), "Reiseformular nicht offen");
    await click(how); await page.waitForTimeout(250);
    ok(!(await visible("#tripPop")), how+": Reise-Pop-up bleibt offen (z. B. andere Reise)");
    ok(await visible("#profView") && await visible("#zPop .zdpop"), how+": nicht zurück zum Ziel-Pop-up");
  }
});

await test("Ziele: Ziel mit eigenem Namen und Gebiet anlegen, Merken aus Reise und Entdecken", async () => {
  await seed();
  await rp(`openZiele()`); await page.waitForTimeout(150);
  await click("#profView [data-act=znew]");
  ok(await visible("#catPop .zpop"), "„Neues Ziel“ öffnet kein Pop-up");
  await page.locator("#zName").fill("Brooklyn-Wochenende");
  await page.locator("#zQ").fill("Brooklyn"); await page.waitForTimeout(700);
  await shot("ziel-neu");
  await click("#catPop [data-act=zarea]");
  ok((await page.locator("#zName").inputValue())==="Brooklyn-Wochenende", "Name nach Gebietswahl verloren");
  await click("#catPop [data-act=zsave]");
  ok(!(await visible("#catPop")), "Pop-up bleibt nach dem Anlegen offen");
  ok(await rp(`zielIds().length===1 && S.trips[zielIds()[0]].name==="Brooklyn-Wochenende" && S.trips[zielIds()[0]].orte.length===1`), "Ziel mit Gebiet nicht angelegt");
  ok(await rp(`liveIds().length===1 && T().id==="t_test"`), "Ziel stört die Reisen");
  await rp(`closeProfile(); poiSel = {n:"Peter Luger", c:"essen", la:40.7099, lo:-73.9622, addr:"Broadway 178"}; sel = null; select("poi");`); await page.waitForTimeout(150);
  ok(await page.locator("#card [data-act=poiadd]").count()===1, "In der Nähe der Reise fehlt die Wunschliste-Kachel");
  await click("#card [data-act=poimore]");
  await click("#jpMenu [data-act=poimerk]"); await page.waitForTimeout(200);
  ok(await rp(`Object.keys(S.trips[zielIds()[0]].places).length===1`), "Ort landet nicht im Ziel mit passendem Gebiet");
  await rp(`select(null); var r = {key:"u_anna/r9", by:"u_anna", fname:"anna", n:"Di Fara Pizza", c:"essen", la:40.6250, lo:-73.9615, photos:[], note:"", cm:[], at:Date.now()};
    DC.items = [r]; DC.byKey = {}; DC.byKey[r.key] = r; DC.at = Date.now(); dcScope = "all"; openDcPage();`); await page.waitForTimeout(250);
  await click("#dcView [data-act=dctake]"); await page.waitForTimeout(200);
  ok(await rp(`Object.keys(S.trips[zielIds()[0]].places).some(function(k){ var p = S.trips[zielIds()[0]].places[k]; return p.n==="Di Fara Pizza" && p.rec && p.rec.name==="anna"; })`), "Empfehlung nicht gemerkt");
  ok(await page.locator("#dcView .dc-take.on").count()===1, "Übernehmen-Knopf zeigt den Stand nicht");
  await shot("ziel-entdecken");
  await rp(`openZiele(zielIds()[0])`); await page.waitForTimeout(150);
  await click("#zPop [data-act=zedit]");
  await click("#catPop [data-act=zdel]");
  ok(await visible("#cfPop"), "Löschen ohne Rückfrage");
  await click("#cfPop .cf-ok"); await page.waitForTimeout(150);
  ok(await rp(`zielIds().length===0 && !!S.trips.t_test`), "Ziel nicht gelöscht oder Reise betroffen");
});

await test("Löschen/Entfernen ist rötlich markiert (Ziel bearbeiten)", async () => {
  await noTripUser();
  await rp(`var z = zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); save(); openZiele(z); true`); await page.waitForTimeout(200);
  await click("#zPop [data-act=zedit]"); await page.waitForTimeout(150);
  const red = async sel => page.locator(sel).first().evaluate(e => { const m = getComputedStyle(e).color.match(/\d+/g).map(Number); return m[0] > m[1] + 60 && m[0] > m[2] + 60; });
  ok(await red("#catPop [data-act=zdel]"), "„Ziel löschen“ nicht rot");
  ok(await red("#catPop [data-act=zareadel]"), "Gebiet „Entfernen“ nicht rot");
  ok(!(await red("#catPop [data-act=zsave]")), "Speichern fälschlich rot");
  await shot("loeschen-rot");
});

await test("Ziele: Ort über Google-Maps-Link, Instagram-Link oder Namen merken", async () => {
  await noTripUser();
  await rp(`var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); save(); openZiele(z); true`); await page.waitForTimeout(200);
  ok(await page.locator("#zPop #zLink").count()===1, "Feld für Link/Name fehlt im Ziel");
  await page.locator("#zLink").fill("https://www.google.com/maps/place/Trevi+Fountain/@41.9009,12.4833,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d41.900932!4d12.483313"); await page.waitForTimeout(600);
  ok((await page.locator("#zPop .zlres").innerText()).includes("Trevi Fountain"), "Ort aus Google-Link nicht erkannt");
  await click("#zPop [data-act=zlkadd]"); await page.waitForTimeout(200);
  ok(await rp(`var z = S.trips[zielIds()[0]], p = Object.keys(z.places).map(function(k){ return z.places[k]; })[0]; !!p && p.n==="Trevi Fountain" && Math.abs(p.la-41.900932) < 1e-5 && /google/.test(p.src)`), "Ort aus Link nicht mit Lage und Quelle gemerkt");
  ok(await page.locator("#zPop .zrow a.zsrc").count()===1, "Quelle lässt sich nicht öffnen");
  await page.locator("#zLink").fill("https://www.instagram.com/p/C0abc123/ On Store"); await page.waitForTimeout(800);
  ok((await page.locator("#zPop .zlres").innerText()).includes("Instagram"), "Hinweis zu Instagram fehlt");
  ok(await page.locator("#zPop [data-act=zlkadd]").count() >= 1, "Namenssuche nach Instagram-Link liefert nichts");
  await shot("ziel-link");
  await page.locator("#zPop [data-act=zlkadd]").first().click(); await page.waitForTimeout(200);
  ok(await rp(`var z = S.trips[zielIds()[0]]; Object.keys(z.places).some(function(k){ return /instagram/.test(z.places[k].src||""); })`), "Instagram-Link nicht als Quelle gespeichert");
  ok(await rp(`var a = zLinkParse("https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffelturm"), b = zLinkParse("https://maps.app.goo.gl/xyz"); a.n==="Eiffelturm" && Math.abs(a.la-48.8584) < 1e-6 && !!b.msg`), "Apple-Maps-Link oder Kurzlink falsch erkannt");
});
await test("Ziele: mit Freunden teilen, Tipps von Freunden erkennbar", async () => {
  await seed();
  await rp(`window.__zup = null; tripRef = function(){ return {update:function(u){ window.__zup = u; return Promise.resolve(); }}; };
    if(!(window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue)){ window.firebase = window.firebase || {}; window.firebase.firestore = window.firebase.firestore || {}; window.firebase.firestore.FieldValue = {arrayUnion:function(x){ return {u:x}; }, arrayRemove:function(x){ return {r:x}; }, delete:function(){ return {d:1}; }}; }
    FR.friends[1].email = "ludwig@test.de";
    var z = zielNew("Japan", {id:"o1", n:"Tokio", la:35.68, lo:139.76, r:60000});
    S.trips[z].places.w1 = {id:"w1", n:"Ichiran", c:"essen", la:35.66, lo:139.70, list:"l_main", by:"u_anna", byn:"anna"};
    META[z] = {owner:"u_me", members:["u_me","u_anna"], memberEmails:{u_anna:"anna@test.de"}, invites:[], viewers:[], viewInvites:[]};
    save(); openZiele(z); true`); await page.waitForTimeout(200);
  const txt = await page.locator("#zPop .zdpop").innerText();
  ok(/mit freunden teilen/i.test(txt) && txt.includes("@anna"), "Teilen-Bereich oder Mitglied fehlt");
  ok(txt.includes("Tipp von @anna"), "Tipp eines Freundes nicht erkennbar");
  ok(await page.locator("#zPop .frs-in").count()===0, "Suchfeld steht noch direkt im Ziel");
  await click("#zPop [data-act=zinvpop]"); await page.waitForTimeout(200);
  ok(await visible("#catPop .frs-pop .frs-big"), "Pop-up zum Einladen fehlt");
  await page.fill("#catPop .frs-in", "lud"); await page.waitForTimeout(150);
  await click("#catPop [data-act=zinv][data-name=Ludwig]"); await page.waitForTimeout(300);
  ok(await page.locator("#catPop [data-act=zinv][data-name=Ludwig]").count()===0, "Eingeladener steht noch in der Auswahl");
  await rp(`closeCatPop(); true`);
  ok(await rp(`!!(window.__zup && window.__zup.invites)`), "Einladung nicht gespeichert");
  ok((await page.locator("#zPop .zdpop").innerText()).includes("eingeladen"), "Einladung nicht angezeigt");
  await shot("ziel-teilen");
  await rp(`META[zielIds()[0]].owner = "u_anna"; zEdit = zEditFrom(zielIds()[0]); zRenderEdit(true);`); await page.waitForTimeout(150);
  ok((await page.locator("#catPop [data-act=zdel]").innerText()).includes("verlassen"), "Geteiltes fremdes Ziel bietet Löschen statt Verlassen");
});
/* Querformat: iPhone quer (844×390) mit Notch-Rändern links/rechts und Home-Leiste unten */
const QUER = {vp:{width:844, height:390}, safe:{left:47, right:47, bottom:21}};
// prüft: alle sichtbaren Bedienelemente über der Karte liegen im Bild, außerhalb der Notch-Ränder und neben der Planung
async function mapCtrlsOk(where){
  const bad = await page.evaluate(() => {
    const out = [], W = innerWidth, H = innerHeight, side = window.__rp("desktop.matches && sideOpen") ? document.getElementById("sheet").getBoundingClientRect().right : 0;
    const sa = (() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"; document.body.appendChild(d); const c = getComputedStyle(d), r = {l:parseFloat(c.paddingLeft), r:parseFloat(c.paddingRight)}; d.remove(); return r; })();
    document.querySelectorAll("#tabbar, .toprow > button, #rail, #ctrl > button, #card").forEach(e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if(!r.width || !r.height || cs.visibility==="hidden" || cs.display==="none" || e.closest("[hidden]")) return;
      const n = e.id || e.className;
      if(r.top < -1 || r.bottom > H + 1) out.push(n+" ragt oben/unten heraus");
      if(r.right > W - sa.r + 1) out.push(n+" unter dem rechten Rand ("+Math.round(r.right)+" > "+(W - sa.r)+")");
      if(r.left < Math.max(sa.l, side) - 1) out.push(n+" unter Notch/Planung ("+Math.round(r.left)+" < "+Math.max(sa.l, side)+")");
    });
    return out;
  });
  ok(!bad.length, where+": "+bad.join(", "));
}
// Kopfleiste quer: eine Zeile, Reise links am Rand, Plus rechts am Rand, Knopfspalte darunter
async function oneRow(where){
  const r = await page.evaluate(() => { const g = id => document.getElementById(id).getBoundingClientRect(), sh = document.getElementById("sheet").getBoundingClientRect();
    const side = window.__rp("sideOpen") ? sh.right : 0, d = document.createElement("div"); d.style.cssText = "position:fixed;padding:0 env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)"; document.body.appendChild(d);
    const c = getComputedStyle(d), L = parseFloat(c.paddingLeft), R = parseFloat(c.paddingRight); d.remove();
    return {tb:g("tabbar"), tr:g("tripBtn"), sr:g("srchBtn"), cam:g("camBtn"), ctrl:g("ctrl"), left:Math.max(L, side), right:innerWidth - R}; });
  const cy = b => b.top + b.height/2;
  ok([r.tr, r.sr, r.cam].every(b => Math.abs(cy(b) - cy(r.tb)) < 4), where+": Kopfleiste nicht in einer Zeile");
  ok(r.tr.right <= r.tb.left && r.tb.right <= r.sr.left && r.sr.right <= r.cam.left, where+": Kopfleiste überlappt");
  ok(r.tr.left - r.left < 20, where+": Reise-Auswahl nicht am linken Rand ("+Math.round(r.tr.left)+" / "+Math.round(r.left)+")");
  ok(r.right - r.cam.right < 20, where+": Plus nicht am rechten Rand ("+Math.round(r.cam.right)+" / "+Math.round(r.right)+")");
  ok(r.ctrl.top >= r.tb.bottom, where+": Knopfspalte ragt in die Kopfleiste");
}
await test("Querformat: Planung als Seitenleiste, Kartenknöpfe neben der Leiste und außerhalb der Notch", async () => {
  await seed(); await page.waitForTimeout(300);
  ok(await rp(`desktop.matches`), "Querformat nutzt nicht die Seitenleiste");
  const sh = await page.evaluate(() => { const r = document.getElementById("sheet").getBoundingClientRect(); return {l:r.left, r:r.right, t:r.top, b:r.bottom}; });
  ok(sh.l === 0 && sh.t <= 0 && sh.b >= 389 && sh.r > 300 && sh.r < 430, "Planung ist keine schmale Leiste links: "+JSON.stringify(sh));
  ok(await page.evaluate(() => { const b = document.querySelector("#body .dh"); return b && b.getBoundingClientRect().left >= 47; }), "Inhalt der Planung liegt unter der Notch");
  await mapCtrlsOk("Start"); await oneRow("Start");
  await shot("quer-start");
  await rp(`select("p1")`); await page.waitForTimeout(400);
  ok(await visible("#card"), "Orts-Pop-up fehlt"); await mapCtrlsOk("Orts-Pop-up");
  await shot("quer-ort");
  await rp(`select(null)`);
  await click("#layersBtn"); ok(await visible("#layers"), "Kartenebenen öffnen nicht"); ok(await insideViewport("#layers"), "Kartenebenen ragen aus dem Bild");
  await shot("quer-ebenen"); await click("#layersBtn");
  await click("#edgeBtn"); await page.waitForTimeout(400);
  ok(await rp(`!sideOpen`), "Planung klappt nicht ein"); await mapCtrlsOk("Planung eingeklappt"); await oneRow("Planung eingeklappt");
  await shot("quer-eingeklappt");
  await click("#edgeBtn"); await page.waitForTimeout(400);
  // Drehen: hochkant → Blatt unten, Knöpfe rechts; zurück quer → wieder Seitenleiste
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(500);
  ok(await rp(`!desktop.matches`), "Hochkant bleibt Seitenleiste");
  ok(await page.evaluate(() => document.getElementById("sheet").getBoundingClientRect().width === innerWidth), "Hochkant: Blatt nicht über die ganze Breite");
  await mapCtrlsOk("Hochkant nach Drehen");
  await page.setViewportSize({width:844, height:390}); await page.waitForTimeout(500);
  ok(await rp(`desktop.matches`), "Zurück quer: keine Seitenleiste"); await mapCtrlsOk("Quer nach Drehen");
  // alle Symbole der Leiste liegen auf ihrem Hintergrund (Safari maß die Leiste zu schmal)
  const inBar = async () => page.evaluate(() => { const b = document.getElementById("tabbar").getBoundingClientRect(); return [...document.querySelectorAll("#tabbar .tb")].every(e => { const r = e.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; }); });
  ok(await inBar(), "Quer: Symbole ragen aus der Leiste");
  await click("#edgeBtn"); await page.waitForTimeout(400); ok(await inBar(), "Quer eingeklappt: Symbole ragen aus der Leiste"); await click("#edgeBtn"); await page.waitForTimeout(400);
  // wie als App vom Home-Bildschirm: iOS meldet die neue Höhe der Kopfleiste teils erst nach resize – Knöpfe und Tagesleiste folgen ihr trotzdem
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(600);
  const noOv = () => page.evaluate(() => { const tr = document.querySelector(".toprow").getBoundingClientRect(), tb = document.getElementById("tabbar").getBoundingClientRect(), c = document.getElementById("ctrl").getBoundingClientRect(), r = document.getElementById("rail").getBoundingClientRect();
    return {tb:tr.top >= tb.bottom - 1, ctrl:c.top >= tr.bottom - 1, rail:r.top >= tr.bottom - 1}; });
  let ov = await noOv(); ok(ov.tb && ov.ctrl && ov.rail, "Hochkant nach Drehen überlappt: "+JSON.stringify(ov));
  await page.waitForTimeout(800); // Nachzügler vom Drehen abwarten
  await page.evaluate(() => { document.querySelector(".top").style.paddingTop = "70px"; }); await page.waitForTimeout(300);
  ov = await noOv(); ok(ov.ctrl && ov.rail, "Knöpfe folgen der Kopfleiste nicht, wenn sie später höher wird: "+JSON.stringify(ov));
  await page.evaluate(() => { document.querySelector(".top").style.paddingTop = ""; });
}, QUER);

await test("Breitbild (iPad): Reise-Auswahl, Leiste, Suche und Plus in einer Zeile", async () => {
  await seed(); await page.waitForTimeout(300);
  for(const vp of [{width:1366, height:1024}, {width:1024, height:1366}, {width:1180, height:820}]){
    await page.setViewportSize(vp); await page.waitForTimeout(500);
    const w = vp.width+"×"+vp.height;
    ok(await rp(`desktop.matches`), w+": keine Seitenleiste");
    if(!(await rp(`sideOpen`))){ await click("#edgeBtn"); await page.waitForTimeout(400); }
    await mapCtrlsOk(w); await oneRow(w); await shot("breit-"+vp.width+"x"+vp.height);
    await click("#edgeBtn"); await page.waitForTimeout(400);
    ok(await rp(`!sideOpen`), w+": Planung klappt nicht ein");
    await mapCtrlsOk(w+" eingeklappt"); await oneRow(w+" eingeklappt"); await shot("breit-"+vp.width+"x"+vp.height+"-zu");
    await click("#edgeBtn"); await page.waitForTimeout(400);
  }
  // Hochformat iPhone bleibt zweizeilig: Reise-Auswahl unter der Leiste
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(500);
  ok(await page.evaluate(() => document.getElementById("tripBtn").getBoundingClientRect().top >= document.getElementById("tabbar").getBoundingClientRect().bottom - 1), "Hochformat: Reise-Auswahl nicht mehr unter der Leiste");
}, {vp:{width:1366, height:1024}});

// Wunschliste → Ort antippen → Haupt-Pop-up schließen: der Punkt bleibt sichtbar, Karten-Pop-up und Leisten verdecken ihn nicht (Hoch- und Querformat, iPhone und iPad)
await test("Kartenpunkt bleibt nach Schließen des Pop-ups sichtbar (iPad, Querformat)", async () => {
  await seed(); await page.waitForTimeout(300);
  for(const vp of [{width:1366, height:1024}, {width:1024, height:1366}, {width:1180, height:820}, {width:844, height:390}, {width:390, height:844}]){
    await page.setViewportSize(vp); await page.waitForTimeout(500);
    const w = vp.width+"×"+vp.height;
    for(const pid of ["p7", "p6"]){
      await rp(`(function(){ closeJPop(); select(null); tab = "wish"; renderAll(); map.jumpTo({center:[-73.90, 40.80], zoom:12}); })()`);
      if(await rp(`desktop.matches && !sideOpen`)){ await click("#edgeBtn"); await page.waitForTimeout(400); }
      if(await rp(`!desktop.matches`)){ await rp(`setSheet("mid")`); await page.waitForTimeout(400); }
      await page.locator('#sheet li.wi[data-id="'+pid+'"] .nm, #side li.wi[data-id="'+pid+'"] .nm, li.wi[data-id="'+pid+'"] .nm').first().click();
      await page.waitForTimeout(1300);
      if(await visible("#jPop")){ await click('#jPop [data-act="jclose"]'); }
      await page.waitForFunction(() => !window.__rp("map.isMoving()"), null, {timeout:4000}).catch(() => {});
      await page.waitForTimeout(1300);
      ok(await visible("#card"), w+": Karten-Pop-up fehlt");
      const r = await rp(`(function(){ var p = P("${pid}"), q = map.project([p.lo, p.la]), mr = mapEl.getBoundingClientRect(), x = q.x + mr.left, y = q.y + mr.top;
        var c = $("card").getBoundingClientRect(), top = document.elementFromPoint(x, y);
        return {x:Math.round(x), y:Math.round(y), card:[Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)],
          inCard: x > c.left - 6 && x < c.right + 6 && y > c.top - 6 && y < c.bottom + 6, onMap: !!top && (mapEl.contains(top) || ($("ov") && $("ov").contains(top))) && x > Math.max(mr.left, 0) + 16 && x < Math.min(mr.right, innerWidth) - 16 && y > document.querySelector(".top").getBoundingClientRect().bottom + 8 && y < Math.min(mr.bottom, innerHeight) - 16, hit: top ? (top.id || top.className || top.tagName) : "" }; })()`);
      await shot("punkt-sichtbar-"+vp.width+"x"+vp.height+"-"+pid);
      ok(!r.inCard, w+" "+pid+": Karten-Pop-up verdeckt den Punkt "+JSON.stringify(r));
      ok(r.onMap, w+" "+pid+": Punkt verdeckt von "+JSON.stringify(r));
    }
  }
}, {vp:{width:1366, height:1024}});

// prüft: Knöpfe, Eingaben und Überschriften der offenen Ansicht liegen nicht unter Notch/Rand (horizontal ins Bild ragende Elemente in Laufbändern ausgenommen)
async function notchFree(root, where){
  const bad = await page.evaluate((root) => {
    const W = innerWidth, H = innerHeight, d = document.createElement("div"); d.style.cssText = "position:fixed;padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"; document.body.appendChild(d);
    const c = getComputedStyle(d), L = parseFloat(c.paddingLeft), R = parseFloat(c.paddingRight); d.remove(); const out = [];
    document.querySelectorAll(root).forEach(rt => rt.querySelectorAll("button, input, textarea, select, h1, h2, h3, h4, b").forEach(e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if(!r.width || !r.height || cs.visibility==="hidden" || r.bottom < 0 || r.top > H) return;
      let p = e.parentElement, scr = false; while(p && p!==rt.parentElement){ const ps = getComputedStyle(p); if(/auto|scroll|hidden/.test(ps.overflowX) && p.scrollWidth > p.clientWidth + 2){ scr = true; break; } p = p.parentElement; } if(scr) return;
      if(r.left < L - 1 || r.right > W - R + 1) out.push((e.id || e.className || e.tagName)+" "+Math.round(r.left)+"–"+Math.round(r.right)+" "+(e.textContent||"").trim().slice(0, 20));
    }));
    return out.slice(0, 6);
  }, root);
  ok(!bad.length, where+": unter Notch/Rand: "+bad.join(" | "));
}
await test("Querformat: Ansichten und Dialoge liegen nicht unter der Notch", async () => {
  await seed();
  const views = [
    ["profil", `openProfile()`, "#profView", `closeProfile()`],
    ["ziele", `openZiele()`, "#profView", `closeProfile()`],
    ["liste", `openLsPage()`, "#lsView", `closeLsPage()`],
    ["mitteilungen", `openNtPage()`, "#ntView", `closeNtPage()`],
    ["chat", `openChPage()`, "#chView", `closeChPage()`],
    ["entdecken", `openDcPage()`, "#dcView", `closeDcPage()`],
    ["suche", `openSearch()`, "#srchPop", `closeSearch()`],
    ["ki", `openAiChat()`, "#aiPop", `$("aiPop").hidden = true`],
    ["einstellungen", `openSettings()`, "#acctPop", `closeSettings()`],
    ["tagebuch", `openJPop("p4", dayOf("p4"))`, "#jPop", `closeJPop()`],
    ["rueckblick", `openRecap(dayOf("p4"))`, "#rc", `closeRecap()`],
  ];
  for(const [n, open, root, close] of views){
    await rp(open); await page.waitForTimeout(700);
    await notchFree(root, n);
    await shot("quer-"+n);
    await rp(close).catch(() => {}); await page.waitForTimeout(250);
  }
}, QUER);

await test("Route: gemerkte Orte am Weg, Zahl am Stern, Einschieben verknüpft mit dem Ziel", async () => {
  await seed();
  await rp(`var z = zielNew("New York", {id:"o1", n:"New York", la:40.73, lo:-73.99, r:30000}); zielAdd(z, {n:"Russ & Daughters", c:"essen", la:40.7265, lo:-73.9920}); zielAdd(z, {n:"Weit weg", c:"sight", la:40.80, lo:-73.95});
    setLegMode(P("p1"), P("p2"), "walk"); save(); renderAll(); true`);
  await page.waitForTimeout(250);
  const li = await rp(`var L = dayLegs(cur), j = -1; L.forEach(function(pr, i){ if(pr[1]===P("p2")) j = i; }); j`);
  ok(li > -1, "Etappe zum Park fehlt");
  ok(await rp(`sugCount(${li})`) >= 1, "Gemerkter Ort am Weg wird nicht gezählt");
  ok(await page.locator(`.sugb[data-leg="${li}"] b`).count()===1, "Zahl am Stern-Knopf fehlt");
  await click(`.sugb[data-leg="${li}"]`); await page.waitForTimeout(200);
  if(await rp(`SUG.tab`)!=="zl") await click(`#catPop [data-act=sugtab][data-v=zl]`);
  const txt = await page.locator("#catPop").innerText();
  ok(txt.includes("Russ & Daughters") && txt.includes("gemerkt in „New York“"), "Gemerkter Ort fehlt im Reiter „Gemerkt“");
  ok(!txt.includes("Weit weg"), "Ort abseits des Wegs wird vorgeschlagen");
  await shot("route-gemerkt");
  await click("#catPop [data-act=sugadd]"); await page.waitForTimeout(250);
  ok(await rp(`var o = ord(cur), id = o.filter(function(k){ return P(k).n==="Russ & Daughters"; })[0]; !!id && !!P(id).zl && o.indexOf(id) < o.indexOf("p2")`), "Ort nicht vor dem Park eingeplant oder nicht mit Ziel verknüpft");
  ok(await rp(`sugItems("zl", sugPath(dayLegs(cur)[${li}])).filter(function(r){ return !r.inT; }).length`)===0, "Eingeplanter Ort wird weiter vorgeschlagen");
});
await test("Öffnungszeiten: OSM-Regeln lesen, geschlossenen Tag im Plan und in der Karte zeigen", async () => {
  await seed();
  ok(await rp(`var W = ohParse("Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off"); W[0][0][0]===540 && W[5][0][1]===840 && W[6].length===0`), "Einfache Regel falsch gelesen");
  ok(await rp(`ohParse("24/7")[3][0][1]===1440 && ohParse("Tu-Su 10:00-17:30")[0].length===0 && ohParse("Jan-Mar Mo 10:00-12:00")===null && ohParse("Mo-Th 11:00-15:00,17:00-23:00; Fr-Sa 11:00-01:00")[5][0][1]===1500`), "Sonderfälle falsch gelesen");
  ok(await rp(`ohCheck("Tu-Su 10:00-17:30", "2026-10-26", "").closed===true && ohCheck("Tu-Su 10:00-17:30", "2026-10-27", "").txt==="10:00–17:30" && ohCheck("Tu-Su 10:00-17:30", "2026-10-27", "09:00").late===true`), "Prüfung für Tag/Uhrzeit falsch");
  const wd = await rp(`["Su","Mo","Tu","We","Th","Fr","Sa"][parseD(cur).getUTCDay()]`);
  await page.route(/overpass-api\.de/, rt => rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({elements:[
    {type:"node", lat:40.7614, lon:-73.9776, tags:{name:"MoMA", opening_hours:"Mo-Su 10:30-17:30; "+wd+" off"}},
    {type:"node", lat:40.7308, lon:-73.9973, tags:{name:"Other Park", opening_hours:"24/7"}}]}) }));
  await rp(`OHFAIL = 0; OHNEW.p3 = 1; renderSheet(); true`);
  await page.waitForFunction(() => document.querySelectorAll("#sheet .st .ohx, .st .ohx").length > 0, null, {timeout:5000});
  ok(await rp(`var r = document.querySelector('.st[data-id="p3"] .ohx'); !!r && /geschlossen/.test(r.textContent)`), "Geschlossen-Hinweis am MoMA fehlt");
  ok(await rp(`!document.querySelector('.st[data-id="p2"] .ohx') && ohOf(P("p2")).o===""`), "Öffnungszeiten eines anderen Orts übernommen");
  ok((await page.locator("#toast").innerText()).includes("MoMA"), "Kein Hinweis nach dem Einplanen eines geschlossenen Orts");
  await shot("oh-tag");
  await rp(`select("p3"); renderCard(); true`); await page.waitForTimeout(200);
  ok((await page.locator("#card .ohl").innerText()).includes("geschlossen"), "Öffnungszeiten fehlen in der Karte");
  ok(await page.locator("#card .ohl small").count()===0, "Wochenliste in der Karte nicht eingeklappt");
  await click("#card [data-act=ohopen]"); await page.waitForTimeout(150);
  ok(await page.locator("#card .ohl small").count()===1, "Wochenliste lässt sich nicht aufklappen");
  await click("#card [data-act=ohopen]"); await page.waitForTimeout(150);
  ok(await page.locator("#card .ohl small").count()===0, "Wochenliste lässt sich nicht wieder einklappen");
  await shot("oh-karte");
});
await test("Öffnungszeiten (online): Warnung bei später Uhrzeit, Anzeige in der Detailansicht, Notiz wird ignoriert", async () => {
  await seed();
  // Online-Daten (OSM) Di–Sa 10–18 Uhr; die Notiz nennt andere Zeiten und darf nicht zählen
  await rp(`var p = P("p3"); p.note = "Kunstgalerie. Täglich 08:00–23:00."; ohCache()[ohKey(p)] = {o:"Tu-Sa 10:00-18:00", at:Date.now()};
    var k = days().map(function(d){ return d.key; }).filter(function(x){ var w = parseD(x).getUTCDay(); return w>=2 && w<=6; })[0];
    if(dayOf("p3")!==k){ Object.keys(T().order).forEach(function(d){ T().order[d] = T().order[d].filter(function(x){ return x!=="p3"; }); }); ord(k).push("p3"); }
    save(); openJPop("p3", k); true`); await page.waitForTimeout(300);
  ok((await page.locator("#jPop .jp-info").innerText()).includes("10:00–18:00"), "Öffnungszeiten fehlen in der Detailansicht");
  // Uhrzeit wie auf dem iPhone setzen: Feld hat den Fokus, Rad meldet input/change, gespeichert wird beim Verlassen (blur).
  // Bewusst im Seitenkontext statt page.fill/locator.blur – Google Chrome (Action) verhielt sich dabei anders als Chromium.
  ok(await rp(`var i = document.querySelector("#jPop input[data-act=time]"); i.focus(); i.value = "19:30";
    i.dispatchEvent(new Event("input", {bubbles:true})); i.dispatchEvent(new Event("change", {bubbles:true}));
    var early = timeOf("p3")==="19:30" && document.activeElement===i; i.blur();
    // Google Chrome ohne Fensterfokus (Action, mehrere Prozesse) schickt bei blur() kein blur-Ereignis – wie das iPhone beim Schließen des Rads selbst auslösen
    i.dispatchEvent(new FocusEvent("blur")); !early`), "Uhrzeit schon während der Eingabe gespeichert (iOS-Rad würde schließen)");
  await page.waitForTimeout(300);
  ok(await rp(`timeOf("p3")==="19:30"`), "Uhrzeit nicht gespeichert: "+await rp(`JSON.stringify({t:timeOf("p3"), v:(document.querySelector("#jPop input[data-act=time]")||{}).value, ae:document.activeElement && document.activeElement.tagName, foc:document.hasFocus()})`));
  const tt = await page.locator("#toast").innerText();
  ok(tt.includes("19:30") && tt.includes("zu"), "Keine Warnung bei Uhrzeit außerhalb der Öffnungszeiten: "+tt);
  ok((await page.locator("#jPop .jp-info").innerText()).includes("Um 19:30 geschlossen"), "Detailansicht zeigt nicht, dass um 19:30 zu ist");
  await shot("oh-notiz-detail");
  await rp(`var p = P("p4"); p.note = "Di–Sa 10:00–18:00."; ohCache()[ohKey(p)] = {o:"", at:Date.now()}; true`);
  ok(await rp(`ohInfo(P("p4"))===null`), "Öffnungszeiten aus der Notiz übernommen");
  await rp(`closeJPop(); cur = dayOf("p3"); tab = "plan"; renderAll(); true`); await page.waitForTimeout(300);
  ok(await rp(`var r = document.querySelector('.st[data-id="p3"] .ohx'); !!r && /zu/.test(r.textContent)`), "Hinweis im Tagesplan fehlt");
});
await test("Tagesvorschlag: angezeigte Wünsche nach Nähe auf die übrigen Tage verteilen", async () => {
  await seed();
  await rp(`[["q1","Bryant Park",40.7536,-73.9832],["q2","Grand Central",40.7527,-73.9772],["q3","DUMBO",40.7033,-73.9881],["q4","Brooklyn Museum",40.6712,-73.9636]].forEach(function(r){ T().places[r[0]] = {id:r[0], n:r[1], c:"sight", la:r[2], lo:r[3], list:"l_main", note:"", addr:"x"}; });
    save(); tab = "wish"; renderAll(); true`);
  await page.waitForTimeout(200);
  await click("[data-act=dsopen]"); await page.waitForTimeout(200);
  ok(await page.locator("#catPop .ds-day").count() >= 2, "Vorschau zeigt keine Tage");
  await shot("tage-verteilen");
  const n = await rp(`dsPool().length`);
  await click("#catPop [data-act=dsapply]"); await page.waitForTimeout(250);
  ok(await rp(`dsPool().length`)===0 && n >= 5, "Nicht alle Wünsche verteilt");
  ok(await rp(`var tk = todayKeySafe(); ["q1","q2","q3","q4","p6","p7"].every(function(id){ var k = dayOf(id); return k && k >= tk; })`), "Wunsch auf vergangenen Tag gelegt");
  ok(await rp(`dayOf("q1")===dayOf("q2")`), "Nahe Orte (Bryant Park, Grand Central) auf verschiedene Tage verteilt");
  ok(await rp(`ord(days().filter(function(d){ return d.key===cur; })[0].key).slice(0,3).join()==="p1,p2,p3"`), "Bereits geplante Stopps verändert");
  ok((await page.locator("#toast").innerText()).includes("verteilt"), "Hinweis mit Rückgängig fehlt");
});
await test("Offline-Paket: ÖPNV und Bezirke aller Ziele der Reise mitladen (Lissabon, Porto)", async () => {
  const OVQ = [];
  await page.route(/overpass-api\.de/, rt => { const q = decodeURIComponent((rt.request().postData()||"").replace(/^data=/, "").replace(/\+/g, " ")); OVQ.push(q);
    const el = q.includes("subway") ? [{type:"relation", id:1, tags:{type:"route", route:"subway", ref:"A", name:"Linha Azul"}, members:[{type:"way", ref:11}]},
      {type:"way", id:11, tags:{railway:"subway"}, geometry:[{lat:38.71, lon:-9.14}, {lat:38.72, lon:-9.15}]}] : [];
    return rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({elements:el}) }); });
  await page.route(/tiles\.test/, rt => rt.fulfill({ contentType: "application/x-protobuf", headers: {"access-control-allow-origin":"*"}, body: "x".repeat(300) }));
  await seed();
  await rp(`(function(){ var t = newTripObj({id:"t_pt", name:"Portugal", start:"2026-11-02", end:"2026-11-08", hotels:[{id:"h9", n:"Hotel Lisboa", la:38.7150, lo:-9.1400, from:"2026-11-02", to:"2026-11-05"}],
    orte:[{id:"o9", n:"Lissabon", la:38.7223, lo:-9.1393, from:"2026-11-02", to:"2026-11-05"}, {id:"o8", n:"Porto", la:41.1579, lo:-8.6291, from:"2026-11-05", to:"2026-11-08"}]});
    S.trips.t_pt = t; S.cur = "t_pt"; DL = {}; OFFTPL = "https://tiles.test/{z}/{x}/{y}.pbf"; OFFMAX = 60; tab = "trip"; renderAll(); })()`);
  await page.waitForTimeout(200);
  ok((await page.locator("#offBox").innerText()).includes("ÖPNV"), "Knopf erklärt ÖPNV nicht");
  ok((await page.locator("#offBox").innerText()).includes("noch nicht verfügbar"), "Hinweis auf die iPhone-App fehlt");
  await click("#offBox [data-act=offload]");
  await page.waitForFunction(() => window.__rp("!!offMeta(S.cur)"), null, {timeout:20000});
  const ks = await rp(`destAll().map(function(d){ return d.k; })`);
  ok(ks.length===2, "nicht beide Ziele erkannt: "+ks);
  for(const k of ks) ok(await rp(`Promise.all(["tr","bus","nb"].map(function(p){ return destGet("${k}:"+p); })).then(function(v){ return v.every(Boolean); })`), "ÖPNV von "+k+" nicht gespeichert");
  ok(OVQ.filter(q => q.includes("subway")).length===2, "Bahnen nicht je Ziel geladen");
  const tx = await page.locator("#offBox").innerText();
  ok(tx.includes("Lissabon") && tx.includes("Porto") && !tx.includes("New York"), "Ziele im Stand falsch: "+tx);
  // erneut laden: frische Daten werden nicht noch einmal abgefragt
  const n0 = OVQ.length; await click("#offBox [data-act=offload]");
  await page.waitForFunction(() => window.__rp("!OFF.run"), null, {timeout:20000});
  ok(OVQ.length===n0, "frische ÖPNV-Daten werden neu abgefragt");
});

await test("Offline-Modus: Fotospot ohne Netz setzen, Fotos warten, Adresse kommt mit Internet", async () => {
  await seed();
  const ctx = page.context();
  await ctx.setOffline(true); await page.waitForTimeout(150);
  ok(await visible("#offline"), "Offline-Hinweis fehlt");
  ok((await page.locator("#offline").innerText()).includes("GPS"), "Hinweis sagt nicht, dass GPS weitergeht");
  await rp(`lpShow({la:40.7420, lo:-73.9890}); true`); await page.waitForTimeout(100);
  const card = await page.locator("#catPop").innerText();
  ok(card.includes("Offline") && card.includes("hochgeladen") && !card.includes("wird gesucht"), "Karte des markierten Punkts offline falsch: "+card);
  ok(await page.locator("#catPop [data-act=lpphoto]").count()===1, "Fotospot offline nicht wählbar");
  const pid = await rp(`lpClose(); lpPhotoSpot("new:40.7420,-73.9890,")`);
  ok(await rp(`P("${pid}").geo===1 && P("${pid}").k==="photo"`), "Fotospot ohne Adresse nicht vorgemerkt");
  // Foto in der Warteschlange: Zähler im Hinweis; während der Privat-Entscheidung wird nichts hochgeladen
  await rp(`var q = phQueue(); q.up.push("ph_off1"); phSaveQ(q); true`);
  ok((await page.locator("#offline").innerText()).includes("1 Foto wartet"), "wartendes Foto nicht angezeigt");
  ok(await rp(`CAPQ = ["ph_off1"]; fbDb = {}; acct.user = acct.user || {uid:"u_me"}; var b = phBusy; phFlush(); var r = !phBusy; CAPQ = []; fbDb = null; r`), "Hochladen läuft schon vor der Privat-Entscheidung los");
  await rp(`var q = phQueue(); q.up = q.up.filter(function(x){ return x!=="ph_off1"; }); phSaveQ(q); true`);
  // wieder online: Adresse und Name nachtragen
  await page.route(/photon\.komoot\.io\/reverse/, rt => rt.fulfill({ contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:JSON.stringify({features:[{properties:{name:"Flatiron Building", street:"5th Ave", housenumber:"175", city:"New York"}}]}) }));
  await ctx.setOffline(false);
  await page.waitForFunction(id => !window.__rp(`P("${id}").geo`), pid, {timeout:5000});
  ok(await rp(`P("${pid}").n==="Fotospot Flatiron Building" && P("${pid}").addr==="5th Ave 175, New York"`), "Adresse nicht nachgetragen: "+await rp(`P("${pid}").n+" | "+P("${pid}").addr`));
  ok(!(await visible("#offline")), "Offline-Hinweis bleibt online stehen");
});

await test("Offline-Karte: Kacheln des Reisegebiets laden, anzeigen und löschen", async () => {
  await seed();
  let tiles = 0;
  await page.route(/tiles\.test/, rt => { tiles++; return rt.fulfill({ contentType: "application/x-protobuf", headers: {"access-control-allow-origin":"*"}, body: "x".repeat(500) }); });
  await rp(`OFFTPL = "https://tiles.test/{z}/{x}/{y}.pbf"; OFFMAX = 120; tab = "trip"; renderSheet(); true`); await page.waitForTimeout(200);
  ok((await page.locator("#offBox").innerText()).includes("Kacheln"), "Offline-Bereich fehlt in „Reise“");
  await click("#offBox [data-act=offload]");
  await page.waitForFunction(() => window.__rp("!!offMeta(S.cur)"), null, {timeout:15000});
  ok(tiles > 20, "Kacheln nicht geladen");
  ok(await page.evaluate(async () => (await (await caches.open(window.__rp("offCacheName(S.cur)"))).keys()).length) === tiles, "Kacheln nicht im Offline-Speicher");
  ok((await page.locator("#offBox").innerText()).includes("Gespeichert"), "Stand nicht angezeigt");
  // New York: ÖPNV ist eingebaut, Citi-Bike-Stationen kommen mit
  ok(await rp(`offMeta(S.cur).nyc && JSON.parse(lsGet("rp-cb-info")).s.length===3`), "ÖPNV/Citi Bike nicht im Offline-Paket");
  ok((await page.locator("#offBox").innerText()).includes("ÖPNV: New York"), "ÖPNV-Stand nicht angezeigt");
  await shot("offline-karte");
  await click("#offBox [data-act=offdel]"); ok(await visible("#cfPop"), "Löschen ohne Rückfrage");
  await click("#cfPop .cf-ok"); await page.waitForTimeout(300);
  ok(await rp(`!offMeta(S.cur)`) && !(await page.evaluate(() => caches.has(window.__rp("offCacheName(S.cur)")))), "Offline-Karte nicht gelöscht");
});

await test("Social: „3 Freunde empfehlen das“ an Ort, in Entdecken und Wunschliste", async () => {
  await seed();
  await rp(`var mk = function(k, by, fn, rt){ return {key:by+"/"+k, by:by, fname:fn, n:"MoMA", c:"kultur", la:40.7615, lo:-73.9777, rating:rt, photos:[], note:"", cm:[], at:Date.now()}; };
    DC.items = [mk("a", "u_anna", "anna", 1), mk("b", "u_ludwig", "Ludwig", 6), mk("c", "u_clara", "Clara", 0), mk("d", "u_bob", "bob", 8),
      {key:"u_anna/j", by:"u_anna", fname:"anna", n:"Joe's Pizza", c:"essen", la:40.7306, lo:-74.0021, rating:2, photos:[], note:"", cm:[], at:Date.now()}];
    DC.byKey = {}; DC.items.forEach(function(r){ DC.byKey[r.key] = r; }); DC.at = Date.now(); select("p3"); renderCard(); true`);
  await page.waitForTimeout(200);
  const fl = await page.locator("#card .frl").innerText();
  ok(fl.includes("3 Freunde") && fl.includes("@anna"), "„3 Freunde empfehlen das“ fehlt oder zählt die schlechte Bewertung mit: "+fl);
  await shot("social-3freunde");
  await rp(`select(null); dcScope = "all"; openDcPage(); true`); await page.waitForTimeout(250);
  ok(await page.locator("#dcView .dc-card").count()===2, "Derselbe Ort erscheint mehrfach in Entdecken");
  ok((await page.locator("#dcView .dc-also").first().innerText()).includes("@Ludwig"), "„auch empfohlen von“ fehlt");
  await rp(`closeDcPage(); tab = "wish"; renderAll(); true`); await page.waitForTimeout(200);
  ok(await rp(`!!document.querySelector('.wi[data-id="p6"] .wfr')`), "Wunschliste zeigt Freunde-Empfehlung nicht");
});
await test("Social: Freunde nach Tipps für ein Ziel fragen", async () => {
  await seed();
  await rp(`var fq = function(){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(id){ return {id:id, collection:function(){ return fq(); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    window.__fakeDb = function(over){ var db = {collection:function(){ return fq(); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }}; return Object.assign(db, over||{}); };
    window.__msgs = []; fbDb = window.__fakeDb({batch:function(){ return {set:function(ref, d){ if(d.from && d.t) window.__msgs.push(d); }, commit:function(){ return Promise.resolve(); }}; }});
    var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); save(); openZiele(z); true`);
  await page.waitForTimeout(200);
  await click("#zPop [data-act=askopen]");
  ok((await page.locator("#askT").inputValue()).includes("„Rom“"), "Nachricht nennt das Ziel nicht");
  ok(await page.locator("#catPop [data-act=asksend][disabled]").count()===1, "Senden ohne Auswahl möglich");
  await page.fill("#catPop .frs-in", "ann"); await page.waitForTimeout(150);
  await click("#catPop [data-act=askpick][data-uid=u_anna]");
  ok(await page.locator("#catPop .frs-chip[data-uid=u_anna]").count()===1, "Ausgewählter Freund nicht oben angezeigt");
  await page.fill("#catPop .frs-in", "cla"); await page.waitForTimeout(150);
  await click("#catPop [data-act=askpick][data-uid=u_clara]");
  await shot("social-fragen");
  await click("#catPop [data-act=asksend]"); await page.waitForTimeout(250);
  ok(await rp(`window.__msgs.length===2 && window.__msgs.every(function(m){ return /Rom/.test(m.t) && !m.place; })`), "Nicht an beide Freunde gesendet");
  ok((await page.locator("#toast").innerText()).includes("2 Freunde"), "Bestätigung fehlt");
  await rp(`fbDb = null; true`);
});
await test("Social: Einladungslink fragt, ob man folgen will", async () => {
  await seed();
  await rp(`window.__req = null; PROF = {name:"ich", nameLower:"ich"}; FR.followers = []; FR.following = []; folFollow = function(u, n){ window.__req = [u, n]; };
    var fq = function(){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(id){ return {id:id, collection:function(){ return fq(); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    window.__fakeDb = function(over){ var db = {collection:function(){ return fq(); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }}; return Object.assign(db, over||{}); };
    fbDb = window.__fakeDb({collection:function(n){ var q = fq(); q.doc = function(id){ var d = fd(id); d.get = function(){ return Promise.resolve(n==="usernames" ? {exists:id==="zoe", data:function(){ return {uid:"u_zoe"}; }} : {exists:true, data:function(){ return {name:"Zoe"}; }}); }; return d; }; return q; }});
    INVFR = "zoe"; invCheck(); true`);
  await page.waitForTimeout(300);
  ok(await visible("#cfPop") && (await page.locator("#cfPop").innerText()).includes("@Zoe"), "Frage nach Folgen fehlt");
  ok((await page.locator("#cfPop .cf-ok").innerText()).trim()==="Anfrage senden", "Knopf heißt nicht „Anfrage senden“");
  await click("#cfPop .cf-ok");
  ok(await rp(`window.__req && window.__req[0]==="u_zoe"`), "Folgen nicht ausgelöst");
  ok(await rp(`invLink().endsWith("?freund=ich")`), "Einladungslink falsch");
  await rp(`INVFR = "ich"; invCheck(); true`); await page.waitForTimeout(200);
  ok(!(await visible("#cfPop")), "Eigener Link fragt nach Freundschaft mit sich selbst");
  await rp(`fbDb = null; true`);
});
await test("Social: Liste per Link teilen und als Ziel oder Wunschliste übernehmen", async () => {
  await seed();
  const code = await page.evaluate(() => window.__rp(`lkPack("Pizza in NYC", [{n:"Lucali", c:"essen", la:40.6818, lo:-73.9991, addr:"Henry St", note:"früh kommen"}, {n:"L'Industrie", c:"essen", la:40.7115, lo:-73.9576}])`));
  ok(/^[zj][A-Za-z0-9_-]+$/.test(code) && code.length < 600, "Link-Code ungültig oder zu lang");
  await rp(`location.hash = "liste=${code}"; true`); await page.waitForTimeout(600);
  ok(await visible("#catPop .lk-card") && (await page.locator("#catPop").innerText()).includes("Lucali"), "Geteilte Liste wird nicht angezeigt");
  ok(await rp(`location.hash===""`), "Link bleibt in der Adresse stehen");
  await shot("social-liste");
  await click("#catPop [data-act=lkziel]");
  ok(await rp(`var z = zielIds().map(function(k){ return S.trips[k]; }).filter(function(t){ return t.name==="Pizza in NYC"; })[0]; !!z && Object.keys(z.places).length===2 && z.orte[0].bb`), "Nicht als Ziel übernommen");
  await rp(`location.hash = "liste=${code}"; true`); await page.waitForTimeout(600);
  await click("#catPop [data-act=lkwish]");
  ok(await rp(`T().lists.some(function(l){ return l.name==="Pizza in NYC"; }) && Object.keys(T().places).filter(function(k){ return T().places[k].n==="Lucali"; }).length===1`), "Nicht in die Wunschliste übernommen");
  await rp(`location.hash = "liste=zkaputt"; true`); await page.waitForTimeout(500);
  ok((await page.locator("#toast").innerText()).includes("beschädigt"), "Kaputter Link ohne Hinweis");
});
await test("Profil: Weltkarte mit besuchten Orten und Städten", async () => {
  await seed();
  await rp(`openProfile(); profTab = "welt"; renderProfile(); true`); await page.waitForTimeout(800);
  const st = await page.locator("#profView .wm-stats").innerText();
  ok(/1\s*Stadt/.test(st) && /2\s*Orte/.test(st), "Zahlen der Weltkarte falsch: "+st.replace(/\s+/g, " "));
  ok(await page.locator("#pfMap canvas").count()===1, "Karte fehlt");
  const same = await rp(`var a = document.querySelector("#pfMap"); renderProfile(); a===document.querySelector("#pfMap")`);
  ok(same, "Karte wird bei jedem Neuzeichnen neu geladen");
  await shot("profil-weltkarte");
  await rp(`profTab = "mine"; renderProfile(); true`);
  ok(await rp(`PFMAP===null`), "Karte bleibt nach Tabwechsel im Speicher");
});

await test("Öffentlich: Ort für alle freigeben, in pub speichern, in Entdecken zeigen und melden", async () => {
  await seed();
  await rp(`window.__log = []; var mk = function(path){ var o = {collection:function(n){ return mk(path+"/"+n); }, doc:function(id){ return mk(path+"/"+id); },
      set:function(d){ window.__log.push([path, d]); return Promise.resolve(); }, update:function(d){ return Promise.resolve(); }, delete:function(){ window.__log.push([path, "del"]); return Promise.resolve(); },
      where:function(){ return o; }, orderBy:function(){ return o; }, limit:function(){ return o; }, onSnapshot:function(){ return function(){}; },
      get:function(){ return Promise.resolve(path.indexOf("/pub")===0 ? {docs:[{id:"u_zoe_t1_p1", data:function(){ return {by:"u_zoe", name:"zoe", n:"Lucali", c:"essen", la:40.6818, lo:-73.9991, gh:geohash(40.6818, -73.9991, 7), rating:1, photos:[], at:Date.now()}; }}]} : {docs:[], exists:false, data:function(){ return {}; }}); }};
      return o; };
    fbDb = Object.assign(mk(""), {batch:function(){ return {set:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }}); true`);
  ok(await rp(`geohash(57.64911, 10.40744, 11)==="u4pruydqqvj"`), "Geohash falsch");
  await rp(`setVis("p4", "all"); true`); await page.waitForTimeout(200);
  ok(await visible("#pubPop") && (await page.locator("#pubPop").innerText()).includes("Öffentlich teilen"), "Rückfrage zum öffentlichen Teilen fehlt");
  await shot("oeffentlich-frage");
  await click("#pubPop .pub-ok");
  ok(await rp(`T().pubA.p4===1 && T().pubP.p4==="u_me" && visOf4("p4")==="all" && isPubP("p4")`), "Ort nicht öffentlich gestellt");
  await rp(`KNOWN.t_test = 1; recBusy = false; lsSet("rp-recs-u_me", "{}"); recSync(); true`); await page.waitForTimeout(500);
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/pub/u_me_t_test_p4" && x[1].gh && x[1].gh.length===7 && x[1].by==="u_me"; })`), "Öffentliche Empfehlung nicht in pub geschrieben");
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/recs/u_me/items/t_test_p4"; })`), "Freundes-Empfehlung fehlt");
  await rp(`setVis("p4", "pub"); true`); await page.waitForTimeout(200);
  ok(await visible("#cfPop"), "Zurücknehmen ohne Rückfrage");
  await click("#cfPop .cf-ok");
  ok(await rp(`!T().pubA.p4 && T().pubP.p4==="u_me"`), "Öffentlich nicht zurückgenommen");
  await rp(`recBusy = false; window.__log = []; recSync(); true`); await page.waitForTimeout(500);
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/pub/u_me_t_test_p4" && x[1]==="del"; })`), "Öffentliche Empfehlung nicht gelöscht");
  await rp(`dcSrc = "all"; dcScope = "all"; DC.at = Date.now(); openDcPage(); true`); await page.waitForTimeout(500);
  const txt = await page.locator("#dcView").innerText();
  ok(txt.includes("Lucali") && txt.includes("öffentlich"), "Öffentliche Empfehlung fehlt in Entdecken");
  await shot("oeffentlich-entdecken");
  await click("#dcView [data-act=dcmore]");
  await click("#jpMenu [data-act=dcreport]");
  await click("#catPop [data-act=dcrepgo]"); await page.waitForTimeout(300);
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/reports/u_me_u_zoe_t1_p1" && x[1].target==="u_zoe_t1_p1" && x[1].owner==="u_zoe"; })`), "Meldung nicht gespeichert");
  ok(!(await page.locator("#dcView").innerText()).includes("Lucali"), "Gemeldeter Beitrag noch sichtbar");
  await rp(`fbDb = null; closeDcPage(); true`);
});

await test("Ziele: Pop-up „Neues Ziel“ bleibt über dem Profil (Tippen)", async () => {
  await seed();
  await rp(`openZiele(); true`); await page.waitForTimeout(200);
  const st = async (w) => ok(await rp(`profOpen && !document.getElementById("profView").hidden`), "Profil geschlossen "+w);
  await page.tap("#profView [data-act=znew]"); await page.waitForTimeout(300);
  ok(await visible("#catPop .zpop"), "Pop-up fehlt"); await st("nach dem Öffnen");
  await page.tap("#zName"); await page.keyboard.type("Testziel"); await page.waitForTimeout(200); await st("nach Name");
  await page.tap("#zQ"); await page.keyboard.type("Brooklyn"); await page.waitForTimeout(800); await st("nach Suche");
  await page.tap("#catPop [data-act=zarea]"); await page.waitForTimeout(300); await st("nach Gebiet");
  await page.tap("#catPop .pop-head h4"); await page.waitForTimeout(200); await st("nach Tippen auf den Titel");
  await page.tap("#catPop [data-act=zsave]"); await page.waitForTimeout(300); await st("nach Speichern");
  ok(await rp(`profTab==="ziele" && zOpen && Z(zOpen).name==="Testziel"`), "Ziel nicht im Profil geöffnet");
  await rp(`zEdit = zEditFrom(zOpen); zRenderEdit(true); true`); await page.waitForTimeout(200);
  await page.tap("#catPop [data-act=zback]"); await page.waitForTimeout(250); await st("nach Schließen");
});

await test("Ziele: Pop-up „Neues Ziel“ im Querformat über dem Profil", async () => {
  await seed();
  await rp(`openZiele(); true`); await page.waitForTimeout(300);
  await page.tap("#profView [data-act=znew]"); await page.waitForTimeout(400);
  await shot("quer-ziel-neu");
  ok(await rp(`profOpen && !document.getElementById("profView").hidden`), "Profil geschlossen");
}, QUER);

await test("Ziele: Ziel öffnet als Pop-up über dem Profil, schließt mit × und Tipp daneben", async () => {
  await seed();
  await rp(`var z = zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); zielMerk(z, {n:"Belém", c:"sight", la:38.69, lo:-9.21}, false); save(); openZiele(); true`); await page.waitForTimeout(250);
  await page.tap("#profView .pf-trip.zt"); await page.waitForTimeout(300);
  ok(await visible("#zPop .zdpop"), "Ziel-Pop-up fehlt");
  ok(await rp(`profOpen && !$("profView").hidden && !!document.querySelector("#profView .pf-trip.zt")`), "Profil-Übersicht nicht mehr dahinter");
  ok((await page.locator("#zPop .zdpop").innerText()).includes("Belém"), "Gemerkter Ort fehlt im Pop-up");
  ok(await page.locator("#zLink").count()===1, "Linkfeld doppelt oder fehlt");
  const r = await page.locator("#zPop .pop-card").boundingBox();
  ok(r.y > 20 && r.y + r.height < 844 - 20, "Pop-up nicht mittig: "+JSON.stringify(r));
  await shot("ziel-popup");
  await page.tap("#zPop [data-act=zedit]"); await page.waitForTimeout(250);
  ok(await visible("#catPop .zpop") && await visible("#zPop .zdpop"), "Bearbeiten liegt nicht über dem Ziel-Pop-up");
  await page.tap("#catPop .pop-head [data-act=zback]"); await page.waitForTimeout(250);
  ok(await rp(`$("catPop").hidden && !$("zPop").hidden`), "Nach Bearbeiten-Schließen ist das Ziel weg");
  await page.tap("#zPop .zhead [data-act=zback]"); await page.waitForTimeout(250);
  ok(await rp(`$("zPop").hidden && profOpen && profTab==="ziele" && !zOpen`), "× schließt nicht zurück zum Profil");
  await page.tap("#profView .pf-trip.zt"); await page.waitForTimeout(300);
  await page.mouse.click(195, 12); await page.waitForTimeout(250);
  ok(await rp(`$("zPop").hidden && profOpen`), "Tipp neben das Pop-up schließt es nicht");
});

await test("Textfelder: Text hat Abstand zum Rand (Ziel, Reise, Suche, Konto)", async () => {
  await seed();
  const scan = async (where) => {
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("input[type=text],input[type=search],input[type=email],input[type=password],input[type=url],input[type=tel],input[type=number],input:not([type]),textarea").forEach((el) => {
        const r = el.getBoundingClientRect(); if(!r.width || !r.height) return;
        const cs = getComputedStyle(el), bg = cs.backgroundColor, bw = parseFloat(cs.borderLeftWidth);
        const boxed = !(bg==="transparent" || /rgba\(.*,\s*0\)$/.test(bg)) || bw > 0; if(!boxed) return;
        const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
        if(pl < 8 || pr < 8 || pt < 5 || pb < 5) out.push((el.id || el.className || el.placeholder || el.tagName)+" "+[pt, pr, pb, pl].join("/"));
      });
      return out;
    });
    ok(!bad.length, where+": zu wenig Innenabstand: "+bad.join(" | "));
  };
  await rp(`openZiele(); zEdit = zEditFrom(""); zRenderEdit(true); true`); await page.waitForTimeout(250); await scan("Neues Ziel");
  await rp(`closeCatPop(); zEdit = null; closeProfile(); tdraft = null; tab = "trip"; renderSheet(); setSheet("full"); true`); await page.waitForTimeout(300); await scan("Reise");
  await rp(`openSearch(); true`); await page.waitForTimeout(250); await scan("Suche"); await rp(`closeSearch(); true`);
  await rp(`openSettings(); true`); await page.waitForTimeout(250); await scan("Konto"); await rp(`closeSettings(); true`);
  await rp(`accView = "profile"; openSettings(); true`); await page.waitForTimeout(250); await scan("Profil bearbeiten"); await rp(`closeSettings(); accView = ""; true`);
  await rp(`zPlanTrip(zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000})); true`); await page.waitForTimeout(300); await scan("Neue Reise");
  await rp(`tdraft = null; openJPop("p4", dayOf("p4")); true`); await page.waitForTimeout(300); await scan("Tagebuch"); await rp(`closeJPop(); true`);
  await rp(`openChPage(); true`); await page.waitForTimeout(300); await scan("Chat"); await rp(`closeChPage(); true`);
  await rp(`openDcPage(); true`); await page.waitForTimeout(300); await scan("Entdecken"); await rp(`closeDcPage(); true`);
  await rp(`openLsPage(); true`); await page.waitForTimeout(300); await scan("Liste"); await rp(`closeLsPage(); true`);
  await rp(`tab = "wish"; renderSheet(); true`); await page.waitForTimeout(300); await scan("Wunschliste");
});

const pfStatsSide = async (n) => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; PROF = {name:"Ferdinand_V"}; openProfile(); true`); await page.waitForTimeout(400);
  const av = await page.locator("#profView .pf-av").first().boundingBox(), st = await page.locator("#profView .pf-stats").boundingBox(), gr = await page.locator("#profView .pf-gear").boundingBox();
  ok(st.x >= av.x + av.width, "Zähler nicht rechts vom Profilbild: "+JSON.stringify([av, st]));
  ok(st.y < av.y + av.height, "Zähler liegen unter dem Profilbild");
  ok(st.height <= 44, "Zähler zu groß: "+st.height);
  const sd = await page.locator("#profView .pf-side").boundingBox();
  ok(sd.y >= av.y - 2 && sd.y + sd.height <= av.y + av.height + 2, "Name und Zähler höher als das Profilbild: "+JSON.stringify([av, sd]));
  ok(!(await page.locator("#profView .pf-head").innerText()).includes("@test.de"), "E-Mail steht noch im Profilkopf");
  ok(!(gr.y + gr.height > st.y && gr.x < st.x + st.width), "Zahnrad überdeckt die Zähler");
  const ov = await rp(`[].slice.call(document.querySelectorAll("#profView .pf-stats span")).filter(function(x){ return x.scrollWidth > x.clientWidth + 1; }).length`);
  ok(ov===0, "Beschriftung abgeschnitten");
  // Kein Instagram-Zahlenblock: Reisen/Beobachtet zählen in den Reitern, Kopf hat nur Follower/Gefolgt
  ok(await rp(`!/Reisen|Beobachtet/.test(document.querySelector("#profView .pf-head").textContent)`), "Reisen/Beobachtet stehen noch als Zahlenzeile im Kopf");
  ok(await rp(`var t = document.querySelectorAll("#profView .pf-seg button"); t.length===4 && t[0].querySelector(".pf-n").textContent===String(liveIds().filter(function(id){ return !isViewerOf(id); }).length) && !!t[1].querySelector(".pf-n") && !t[2].querySelector(".pf-n")`), "Reiter zeigen keine Anzahl");
  ok(await rp(`[].every.call(document.querySelectorAll("#profView .pf-seg button"), function(b){ return b.scrollWidth <= b.clientWidth + 1; })`), "Reiter-Beschriftung abgeschnitten");
  ok(gr.y < av.y + av.height && gr.y + gr.height > av.y, "Zahnrad nicht in der Kopfzeile");
  await tapS('#profView .pf-seg [data-v="obs"]'); await page.waitForTimeout(150);
  ok(await rp(`profTab==="obs"`), "Reiter Beobachtet reagiert nicht");
  await tapS('#profView .pf-stats [data-v="fol"]'); await page.waitForTimeout(250);
  ok(await visible("#acctPop"), "Follower-Zähler öffnet nichts");
  await rp(`closeSettings(); profTab = "mine"; renderProfile(); true`);
  await shot("profil-zaehler-"+n);
};
await test("Profil: Zähler klein rechts neben dem Profilbild", async () => { await pfStatsSide("hoch"); });
await test("Profil: Zähler rechts neben dem Profilbild im Querformat", async () => { await pfStatsSide("quer"); }, QUER);

/* Profilbild: nach der Auswahl runder Zuschneide-Rahmen, verschieben (ein Finger) und zoomen (zwei Finger/Mausrad); Antippen → Vollbild */
const avCropTest = async (n) => {
  await seed();
  await rp(`acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; PROF = {name:"ferdi"}; window.__avSet = null;
    var mk = function(path){ var o = {collection:function(n){ return mk(path+"/"+n); }, doc:function(id){ return mk(path+"/"+id); },
      set:function(d){ if(path.indexOf("/profiles/")===0 && d.photo) window.__avSet = d; return Promise.resolve(); }, delete:function(){ return Promise.resolve(); },
      where:function(){ return o; }, orderBy:function(){ return o; }, limit:function(){ return o; }, onSnapshot:function(){ return function(){}; },
      get:function(){ return Promise.resolve({docs:[], exists:false, data:function(){ return {}; }}); }}; return o; };
    fbDb = Object.assign(mk(""), {batch:function(){ return {set:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }});
    var c = document.createElement("canvas"); c.width = 400; c.height = 200; var x = c.getContext("2d"); x.fillStyle = "#f00"; x.fillRect(0, 0, 200, 200); x.fillStyle = "#00f"; x.fillRect(200, 0, 200, 200);
    var b = atob(c.toDataURL("image/png").split(",")[1]), u = new Uint8Array(b.length); for(var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    setAvatar(new File([u], "a.png", {type:"image/png"})); true`);
  const st = page.locator("#avcSt"); await st.waitFor({state:"visible"});
  const bb = await st.boundingBox(), vp = page.viewportSize();
  ok(bb.x >= 0 && bb.y >= 0 && bb.x + bb.width <= vp.width && bb.y + bb.height <= vp.height, "Rahmen nicht ganz im Bild: "+JSON.stringify(bb));
  const cb = await page.locator("#avCrop .cf-ok").boundingBox(); ok(cb && cb.y + cb.height <= vp.height, "Fertig-Knopf nicht sichtbar");
  ok(await rp(`getComputedStyle(document.querySelector("#avCrop .avc-m")).borderRadius==="50%"`), "kein runder Rahmen");
  // Mitte: Grenze rot/blau; mit einem Finger nach rechts ziehen → linker (roter) Teil
  await page.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width, bb.y + bb.height/2, {steps:6}); await page.mouse.up();
  // zwei Finger auseinander → größer
  const sc0 = await rp(`new DOMMatrix(getComputedStyle($("avcImg")).transform).a`);
  await rp(`var st = $("avcSt"), r = st.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2, f = function(t, id, x){ st.dispatchEvent(new PointerEvent(t, {pointerId:id, clientX:x, clientY:cy, bubbles:true, cancelable:true})); };
    f("pointerdown", 11, cx - 20); f("pointerdown", 12, cx + 20); f("pointermove", 11, cx - 60); f("pointermove", 12, cx + 60); f("pointerup", 11, cx - 60); f("pointerup", 12, cx + 60); true`);
  const sc1 = await rp(`new DOMMatrix(getComputedStyle($("avcImg")).transform).a`);
  ok(sc1 > sc0*2.5, "Zwei-Finger-Zoom wirkt nicht: "+sc0+" → "+sc1);
  await shot("profilbild-zuschneiden-"+n);
  await page.locator("#avCrop .cf-ok").click();
  await page.waitForFunction(() => window.__rp(`!!window.__avSet`));
  const px = await rp(`new Promise(function(res){ var im = new Image(); im.onload = function(){ var c = document.createElement("canvas"); c.width = im.width; c.height = im.height; var x = c.getContext("2d"); x.drawImage(im, 0, 0); res([im.width, Array.from(x.getImageData(im.width/2, im.height/2, 1, 1).data)]); }; im.src = window.__avSet.photo; })`);
  ok(px[0]===480, "Größe des Profilbilds: "+px[0]);
  ok(px[1][0] > 200 && px[1][2] < 60, "Ausschnitt nicht verschoben (Mitte sollte rot sein): "+px[1]);
  ok(await rp(`$("avCrop").hidden && PROF.photo===window.__avSet.photo`), "Dialog nicht zu oder Bild nicht übernommen");
  // Abbrechen speichert nichts
  await rp(`window.__avSet = null; var c = document.createElement("canvas"); c.width = 50; c.height = 50; var b = atob(c.toDataURL("image/png").split(",")[1]), u = new Uint8Array(b.length); for(var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); setAvatar(new File([u], "b.png", {type:"image/png"})); true`);
  await st.waitFor({state:"visible"}); await page.locator("#avCrop .cf-no").click();
  ok(await rp(`$("avCrop").hidden && !window.__avSet`), "Abbrechen hat gespeichert: "+await rp(`JSON.stringify([$("avCrop").hidden, !!window.__avSet, $("avCrop").className])`));
  // Antippen im Profil → Vollbild, × schließt, Profil bleibt offen
  await rp(`openProfile(); true`); await page.waitForTimeout(300);
  await page.locator("#profView img.pf-av").click();
  await page.locator("#avFull img").waitFor({state:"visible"});
  const fb = await page.locator("#avFull img").boundingBox(); ok(fb.width >= Math.min(vp.width, vp.height) - 120, "Vollbild zu klein: "+fb.width);
  ok(await rp(`$("avFull").querySelector("img").getAttribute("src")===PROF.photo`), "falsches Bild im Vollbild");
  await shot("profilbild-vollbild-"+n);
  await page.locator("#avFull .avf-x").click();
  ok(await rp(`$("avFull").hidden && profOpen`), "Vollbild nicht geschlossen oder Profil zu");
  // nach unten ziehen schließt wie bei den Fotos
  await page.locator("#profView img.pf-av").click(); await page.locator("#avFull img").waitFor({state:"visible"});
  const cdp = await page.context().newCDPSession(page), mx = Math.round(vp.width/2), my = Math.round(vp.height/3);
  await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:mx, y:my}]});
  for(const d of [20, 60, 120, 180, 220]){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:mx, y:my + d}]}); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
  await page.waitForFunction(() => window.__rp(`$("avFull").hidden`));
  ok(await rp(`profOpen`), "Profil nach Runterziehen zu");
  await rp(`fbDb = null; true`);
};
await test("Profilbild: zuschneiden im runden Rahmen, verschieben, zoomen, Vollbild", async () => { await avCropTest("hoch"); });
await test("Profilbild: zuschneiden im Querformat", async () => { await avCropTest("quer"); }, QUER);

/* Tastatur in Pop-ups (Tastatur über visualViewport nachgestellt). Regel: passt die Karte an ihrer Stelle über die Tastatur, bleibt sie;
   sonst Unterkante knapp über der Tastatur, Oberkante höchstens bis oben, Rest scrollt innen. Hintergrund bleibt über die ganze Seite.
   pan0: iOS verschiebt die Seite beim Fokus um offsetTop – gerechnet wird in Bildschirm-Koordinaten (Layout-y minus offsetTop).
   pred: iOS-Vorhersage – Karte steht schon beim Antippen richtig, beim echten Öffnen bewegt sich nichts mehr. */
const kbSettle = () => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => 0))));
const kbPop = async (open, ovSel, name, o = {}) => {
  const pan0 = o.pan0 || 0;
  await seed(); await rp(open); await page.waitForTimeout(300); await kbSettle();
  const fld = ovSel+" input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden])";
  ok(await page.locator(fld).count() > 0, name+": kein Eingabefeld");
  const card = ovSel+" > *";
  const before = await page.locator(card).first().boundingBox();
  const H = await page.evaluate(() => innerHeight), kbH = H > 600 ? 380 : 230, VH = H - kbH;
  if(o.pred) await rp(`KBPRED = true; KBVH = [${VH}, 0]; true`);
  await page.locator(fld).first().focus();
  let predBox = null;
  if(o.pred){ await page.waitForTimeout(50); await kbSettle(); predBox = await page.locator(card).first().boundingBox(); }
  await page.evaluate(([h, t, sh]) => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); if(t) Object.defineProperty(visualViewport, "offsetTop", {configurable:true, get:() => t});
    if(sh){ window.__ihD = Object.getOwnPropertyDescriptor(window, "innerHeight"); Object.defineProperty(window, "innerHeight", {configurable:true, get:() => h}); }   // manche iOS-Versionen verkleinern innerHeight mit
    visualViewport.dispatchEvent(new Event("resize")); }, [VH, pan0, !!o.shrink]);
  await page.waitForTimeout(450); await kbSettle();
  ok(await rp(`document.body.classList.contains("kb")`), name+": Tastatur nicht erkannt");
  const ov = await page.locator(ovSel).boundingBox(), fb = await page.locator(fld).first().boundingBox(), lb = await page.locator(card).first().boundingBox();
  const after = {y: lb.y - pan0, height: lb.height}, f = {y: fb.y - pan0, height: fb.height};   // Bildschirm-Koordinaten
  const clip = await page.evaluate(s => { const c = document.querySelector(s); return c.scrollHeight > c.clientHeight + 1; }, card);
  const fits = before.y + before.height <= VH - 10 + 1, info = JSON.stringify({before:[before.y, before.height], after:[after.y, after.height], clip, VH});
  if(fits) ok(Math.abs(after.y - before.y) <= 1 && Math.abs(after.height - before.height) <= 1, name+": Karte passt, bewegt sich aber "+info);
  else {
    ok(Math.abs(after.y + after.height - (VH - 10)) <= 2, name+": Unterkante nicht knapp über der Tastatur "+info);
    ok(after.y <= before.y + 1, name+": Karte rutscht nach unten "+info);
    ok(!clip || after.y <= 9, name+": Karte gekürzt, obwohl oben noch Platz ist "+info);
  }
  ok(after.y >= 7, name+": Karte reicht über den oberen Rand "+info);
  ok(ov.y <= 0.5 && ov.y + ov.height >= H - 0.5, name+": Hintergrund reicht nicht über die ganze Seite: "+JSON.stringify(ov));
  ok(f.y >= after.y - 1 && f.y + f.height <= VH, name+": Feld verdeckt "+JSON.stringify(f));
  if(predBox) ok(Math.abs(predBox.y - lb.y) <= 1 && Math.abs(predBox.height - lb.height) <= 1, name+": Vorhersage beim Antippen weicht ab ("+predBox.y+" → "+lb.y+")");
  await shot("tastatur-"+name);
  // iOS verschiebt die Seite (offsetTop ändert sich): Karte bleibt auf dem BILDSCHIRM an derselben Stelle, Hintergrund ohne Lücke oben
  await page.evaluate(t => { Object.defineProperty(visualViewport, "offsetTop", {configurable:true, get:() => t}); visualViewport.dispatchEvent(new Event("scroll")); }, pan0 + 60);
  await page.waitForTimeout(150); await kbSettle();
  const pan = await page.locator(card).first().boundingBox(), ov2 = await page.locator(ovSel).boundingBox();
  ok(Math.abs(pan.y - (pan0 + 60) - after.y) <= 1, name+": Karte verrutscht auf dem Bildschirm beim Verschieben der Seite ("+after.y+" → "+(pan.y - pan0 - 60)+")");
  ok(ov2.y <= 0.5, name+": Lücke über dem Pop-up-Hintergrund: "+ov2.y);
  // Schließen wie auf iOS: erst verlässt der Fokus das Feld, dann schiebt iOS die Seite zurück, zuletzt ist die Tastatur weg.
  // Die Karte darf sich dabei nur EINMAL ändern (Lage und Größe zusammen), nicht zweimal.
  const pre = await page.locator(card).first().boundingBox();
  await page.evaluate(s => { window.__kbH = []; const c = document.querySelector(s); window.__kbRO = new ResizeObserver(() => window.__kbH.push(Math.round(c.getBoundingClientRect().height))); window.__kbRO.observe(c); }, card);
  await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(200);
  await page.evaluate(() => { delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event("scroll")); }); await page.waitForTimeout(200);
  const mid = await page.locator(card).first().boundingBox();
  ok(Math.abs(mid.y - pre.y) <= 1 && Math.abs(mid.height - pre.height) <= 1, name+": Karte ändert sich schon, bevor die Tastatur zu ist ("+JSON.stringify([pre.y, pre.height])+" → "+JSON.stringify([mid.y, mid.height])+")");
  await page.evaluate(() => { delete visualViewport.height; if(window.__ihD){ Object.defineProperty(window, "innerHeight", window.__ihD); delete window.__ihD; } visualViewport.dispatchEvent(new Event("resize")); });
  await page.waitForTimeout(300);
  const hs = await page.evaluate(() => { window.__kbRO.disconnect(); return window.__kbH.filter((h, i, a) => i===0 || h!==a[i-1]); });
  ok(hs.length <= 2, name+": Größe ändert sich beim Schließen mehrmals: "+hs.join(" → "));
  ok(!(await rp(`!!document.querySelector(".kbpin") || document.body.classList.contains("kb")`)), name+": Tastatur-Zustand bleibt hängen");
  await page.waitForTimeout(300); await kbSettle();
  const back = await page.locator(card).first().boundingBox();
  ok(Math.abs(back.y - before.y) <= 1, name+": Karte steht nach dem Schließen woanders ("+before.y+" → "+back.y+")");
};
const KB_PROFIL = `acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; PROF = {name:"Ferdinand_V"}; accView = "profile"; openSettings(); true`;
const KB_ZIEL = `acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; FR.friends = [{id:"r1", uid:"u1", name:"anna", email:"a@x.de"}];
    var z = zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:30000}); zielMerk(z, {n:"Belém", c:"sight", la:38.69, lo:-9.21}, false); META[z] = {owner:"u_me", members:["u_me"], invites:[]}; save(); openZiele(z); true`;
await test("Tastatur im Pop-up: Profil bearbeiten springt nicht, Hintergrund bleibt unscharf", async () => { await kbPop(KB_PROFIL, "#acctPop", "profil"); });
await test("Tastatur im Pop-up: mittige Karte (Neues Ziel) springt nicht", async () => { await kbPop(`openZiele(); zEdit = zEditFrom(""); zRenderEdit(true); true`, "#catPop", "ziel"); });
await test("Tastatur im Pop-up: hohe Karte (Ziel) sitzt knapp über der Tastatur und nutzt den Platz bis oben", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-hoch"); });
await test("Tastatur im Pop-up: iOS verschiebt die Seite beim Fokus – Karte trotzdem knapp über der Tastatur", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-pan", {pan0:120}); });
await test("Tastatur im Pop-up: Vorhersage beim Antippen (iOS) – beim Öffnen bewegt sich nichts mehr", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-pred", {pred:true}); });
await test("Tastatur im Pop-up: Tastatur erkannt, auch wenn iOS innerHeight mitverkleinert", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-inner", {shrink:true}); });
await test("Tastatur im Pop-up: Antippen fokussiert ohne iOS-Verschiebung (preventScroll), Feldwechsel klappt", async () => {
  await seed(); await rp(KB_PROFIL); await page.waitForTimeout(300); await kbSettle();
  await page.evaluate(() => { window.__fo = []; const f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function(o){ window.__fo.push((this.id||this.tagName)+":"+!!(o && o.preventScroll)); return f.call(this, o); }; });
  await page.tap("#acctPop #unIn"); await page.waitForTimeout(100);
  const fo = await page.evaluate(() => { const r = window.__fo; delete HTMLElement.prototype.focus; return {r, a:document.activeElement && document.activeElement.id}; });
  ok(fo.a==="unIn", "Tippen ins Feld fokussiert es nicht: "+fo.a);
  ok(fo.r.includes("unIn:true"), "Pop-up-Feld nicht ohne Verschieben fokussiert: "+fo.r.join(" "));
  await page.tap("#acctPop #unIn"); await page.waitForTimeout(50);
  ok(await page.evaluate(() => document.activeElement.id)==="unIn", "Erneutes Tippen ins aktive Feld verliert den Fokus");
});
await test("Tastatur im Pop-up: Feld weiter unten (Neue Reise) wird über Tastatur und Fußleiste gescrollt", async () => {
  await seed(); await rp(`zPlanTrip(zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000})); true`); await page.waitForTimeout(300); await kbSettle();
  const H = await page.evaluate(() => innerHeight), VH = H - 380;
  // Suchfeld fürs Reiseziel – liegt wie in Ferdinands Fall unten in der Karte, unter den Hotels
  // Tastatur ist schon offen (Wechsel aus einem anderen Feld), Karte entsprechend niedrig
  await page.evaluate(() => { const o = document.querySelector("#tripPop input[type=text]"); o.focus({preventScroll:true}); });
  await page.evaluate(h => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); visualViewport.dispatchEvent(new Event("resize")); }, VH);
  await page.waitForTimeout(900); await kbSettle();
  // wie im Screenshot: Feld liegt genau hinter der festen Fußleiste („Abbrechen · Reise anlegen“), aber noch innerhalb der Karte
  const id = await page.evaluate(() => { const f = document.querySelector("#tripPop input[type=search]"), c = document.querySelector("#tripPop .ag-card"), ft = document.querySelector("#tripPop .tf-foot"); if(!f || !c || !ft) return "";
    c.scrollTop += f.getBoundingClientRect().top - (ft.getBoundingClientRect().top + 6);
    f.id = f.id || "kbLow"; f.focus({preventScroll:true}); return document.activeElement===f ? f.id : ""; });
  ok(id, "kein Textfeld in „Neue Reise“");
  await page.evaluate(h => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); visualViewport.dispatchEvent(new Event("resize")); }, VH);
  await page.waitForTimeout(1100); await kbSettle();
  const r = await page.evaluate(([id, vh]) => { const f = document.getElementById(id), b = f.getBoundingClientRect(), x = b.left + Math.min(b.width/2, 40), y = b.top + b.height/2, hit = document.elementFromPoint(x, y);
    const foot = document.querySelector("#tripPop .tf-foot"), fr = foot ? foot.getBoundingClientRect() : null;
    return {top:b.top, bot:b.bottom, hit:!!hit && (hit===f || f.contains(hit) || hit.contains(f)), hitDesc:hit ? (hit.className || hit.tagName) : "", footTop:fr ? fr.top : null, vh}; }, [id, VH]);
  ok(r.bot <= VH && r.top >= 0, "Feld nicht über der Tastatur: "+JSON.stringify(r));
  ok(r.footTop===null || r.bot <= r.footTop + 1, "Feld hinter der Fußleiste: "+JSON.stringify(r));
  ok(r.hit, "Feld verdeckt (getroffen: "+r.hitDesc+") "+JSON.stringify(r));
  await shot("tastatur-neue-reise");
  await page.evaluate(() => { document.activeElement.blur(); delete visualViewport.height; visualViewport.dispatchEvent(new Event("resize")); });
});
await test("Tastatur im Pop-up: Querformat", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-quer"); }, QUER);

// Chat-Attrappe für neue Chat-Funktionen: __M = Verlauf, __sent = gesendete Nachrichten, __upd = Updates (msgs und chats)
const CHMOCK = `window.__sent = []; window.__upd = []; window.__sets = []; window.__M = window.__M || [];
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(r, d){ __sets.push(d); if(d && d.from && d.at) __sent.push(d); }, update:function(r, o){ __upd.push(["b", o]); }, commit:function(){ return Promise.resolve(); }}; },
      collection:function(){ var top = {where:function(){ return top; }, orderBy:function(){ return top; }, limit:function(){ return top; }, get:function(){ return Promise.resolve({docs:[], forEach:function(){}}); }, onSnapshot:function(){ return function(){}; }, add:function(d){ __sets.push(d); return Promise.resolve({id:"new"}); }};
        top.doc = function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, set:function(d){ __sets.push(d); return Promise.resolve(); }, update:function(o){ __upd.push([cid, o]); return Promise.resolve(); },
      collection:function(n){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, limit:function(){ return q; }, where:function(){ return q; }, add:function(d){ __sets.push(d); return Promise.resolve({id:"new"}); }, doc:function(id){ return {set:function(d){ __sets.push(d); return Promise.resolve(); }, update:function(o){ __upd.push([id, o]); return Promise.resolve(); }}; }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ if(n!=="msgs") return function(){}; window.__snap = function(){ cb(qs()); }; setTimeout(__snap, 0); return function(){}; }}; return q; }}; }; return top; }};
    FR.friends = [{uid:"u1", name:"Anna"}, {uid:"u2", name:"Bert"}, {uid:"u3", name:"Clara"}]; CHPROF.u1 = {name:"Anna"}; CHPROF.u2 = {name:"Bert"}; CHPROF.u3 = {name:"Clara"};
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, names:{u1:"Anna"}, read:{u_me:Date.now()}, last:{t:"Hallo", from:"u1", at:1000}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true;`;
await test("Chat: Tag teilen – Tagesplan als Karte schicken, Empfänger übernimmt ihn auf einen eigenen Tag", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"Hallo", at:Date.now()-60000}]; ${CHMOCK} true`);
  // Tageskopf: Knopf „Tag im Chat schicken“ → Freund wählen → Chat mit Tageskarte als Entwurf
  await page.tap("#sheet [data-act=dayshare]"); await page.waitForTimeout(250);
  ok(await rp(`!!document.querySelector("[data-act=chdayto][data-uid=u1]")`), "Freunde-Auswahl für den Tag fehlt");
  await page.tap("[data-act=chdayto][data-uid=u1]");
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && !!document.querySelector("#chDraftBox .ch-dy")`), null, {timeout:4000});
  ok(await rp(`var b = $("chDraftBox").textContent; b.includes("Katz Deli") && b.includes("3 Stopps")`), "Entwurf zeigt den Tag nicht: "+await rp(`$("chDraftBox").textContent`));
  await page.tap("#chView [data-act=chsend]"); await page.waitForTimeout(150);
  ok(await rp(`var s = __sent[0]; !!s && s.day && s.day.st.length===3 && s.day.st[0].n==="Katz Deli" && s.day.trip==="Testreise"`), "Tag nicht gesendet: "+JSON.stringify(await rp(`__sent`)));
  ok(await rp(`__sets.some(function(d){ return d.last && /^Tag \\d+ · /.test(d.last.place); })`), "Chat-Liste zeigt keinen Tag als letzte Nachricht");
  // Empfang: Karte mit Stopps; Übernehmen auf einen anderen Tag (neue Orte entstehen, vorhandene werden eingeplant)
  await rp(`__M.push({id:"m2", from:"u1", t:"", at:Date.now(), day:{dn:1, dt:"Montag, 1. Juni", trip:"Annas Reise", km:1200, st:[{n:"Katz Deli", c:"essen", la:40.7223, lo:-73.9874}, {n:"Russ & Daughters", c:"essen", la:40.7224, lo:-73.9882}, {n:"Brooklyn Bridge", c:"sight", la:40.7061, lo:-73.9969}]}}); __snap(); true`);
  await page.waitForTimeout(200);
  ok(await rp(`var c = document.querySelector('#chMsgs .ch-msg[data-mid="m2"] .ch-dy'); !!c && c.querySelectorAll(".ch-dys").length===3 && !!c.querySelector("[data-act=chdytake]")`), "Empfangene Tageskarte fehlt");
  await shot("chat-tag-karte");
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] [data-act=chdytake]'); await page.waitForTimeout(200);
  await page.tap('[data-act=chdytk][data-day="'+await rp(`days()[days().length-1].key`)+'"]'); await page.waitForTimeout(200);
  const r = await rp(`var k = days()[days().length-1].key, o = ord(k).map(function(id){ return P(id).n; }); JSON.stringify(o)`);
  ok(r.includes("Russ & Daughters") && !r.includes("Katz Deli") && !r.includes("Brooklyn Bridge"), "Übernahme falsch (Katz ist schon eingeplant, Brücke auch): "+r);
  ok(await rp(`Object.keys(T().places).filter(function(k){ return T().places[k].n==="Katz Deli"; }).length===1`), "Vorhandener Ort doppelt angelegt");
  // Stopp antippen zeigt ihn auf der Karte
  await rp(`openChPage("u1_u_me"); true`); await page.waitForTimeout(300);
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] .ch-dys >> nth=1'); await page.waitForTimeout(300);
  ok(await rp(`!chPage && sel==="poi" && poiSel && poiSel.n==="Russ & Daughters"`) || await rp(`!chPage && sel && P(sel) && P(sel).n==="Russ & Daughters"`), "Stopp antippen zeigt ihn nicht auf der Karte");
  await rp(`CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: „Gesehen“ unter der letzten eigenen Nachricht und „Tippt …“-Anzeige", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"Hallo", at:Date.now()-120000}, {id:"m2", from:"u_me", t:"Hi Anna", at:Date.now()-60000}]; ${CHMOCK} CH.byId.u1_u_me.read = {u_me:Date.now(), u1:Date.now()-90000}; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===2`), null, {timeout:4000});
  ok(await rp(`!document.querySelector("#chMsgs .ch-seen")`), "„Gesehen“, obwohl Anna noch nicht gelesen hat");
  // Anna öffnet den Chat → read.u1 neuer als die Nachricht
  await rp(`CH.byId.u1_u_me = Object.assign({}, CH.byId.u1_u_me, {read:{u_me:Date.now(), u1:Date.now()}}); CH.list = [CH.byId.u1_u_me]; chMetaUpd(); true`);
  ok(await rp(`var s = document.querySelector('#chMsgs .ch-msg[data-mid="m2"] .ch-seen'); !!s && s.textContent==="Gesehen"`), "„Gesehen“ fehlt");
  // Anna tippt: drei Punkte unten im Verlauf, verschwinden nach 7 s ohne neues Signal
  await rp(`CH.byId.u1_u_me = Object.assign({}, CH.byId.u1_u_me, {typ:{u1:Date.now()-5500}}); chMetaUpd(); true`);
  ok(await rp(`var t = document.querySelector("#chMsgs .ch-typ"); !!t && $("chMsgs").lastElementChild===t && t.querySelectorAll(".ch-bub i").length===3`), "„Tippt …“ fehlt");
  await shot("chat-tippt-gesehen");
  await page.waitForFunction(() => window.__rp(`!document.querySelector("#chMsgs .ch-typ")`), null, {timeout:3000});
  // selbst tippen: Signal höchstens alle 4 s, Leeren setzt 0
  await page.type("#chIn", "abc"); await page.waitForTimeout(100);
  ok(await rp(`var u = __upd.filter(function(x){ return x[0]==="u1_u_me" && "typ.u_me" in x[1]; }); u.length===1 && u[0][1]["typ.u_me"] > 0`), "Tipp-Signal falsch: "+await rp(`JSON.stringify(__upd)`));
  await page.fill("#chIn", ""); await page.waitForTimeout(100);
  ok(await rp(`var u = __upd.filter(function(x){ return x[0]==="u1_u_me" && "typ.u_me" in x[1]; }); u.length===2 && u[1][1]["typ.u_me"]===0`), "Leeren setzt Tipp-Signal nicht zurück");
  // Nachricht senden: typ 0 mitgeschickt
  await page.fill("#chIn", "Neu"); await page.tap("#chView [data-act=chsend]"); await page.waitForTimeout(150);
  ok(await rp(`__sets.some(function(d){ return d.typ && d.typ.u_me===0; })`), "Senden setzt Tipp-Signal nicht zurück");
  await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: Ortsnamen und Karten-Links im Text werden als Ort-Karte vorgeschlagen, empfangene Links zeigen eine Karte", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"Schau mal https://www.google.com/maps/place/Russ+%26+Daughters/@40.7224,-73.9882,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d40.72246!4d-73.98823", at:Date.now()-60000}]; ${CHMOCK} openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===1`), null, {timeout:4000});
  ok(await rp(`var c = document.querySelector('#chMsgs .ch-msg[data-mid="m1"] .ch-pl'); !!c && c.textContent.includes("Russ & Daughters") && !!c.querySelector("[data-act=chwish]")`), "Empfangener Maps-Link zeigt keine Ort-Karte");
  ok(await rp(`Math.abs(CHPL["m1~l"].la - 40.72246) < 1e-5`), "Koordinaten aus !3d/!4d nicht genutzt");
  // Wunschliste aus dem Link
  await page.tap('#chMsgs .ch-msg[data-mid="m1"] [data-act=chwish]'); await page.waitForTimeout(200);
  ok(await rp(`Object.keys(T().places).some(function(k){ var p = T().places[k]; return p.n==="Russ & Daughters" && p.rec && p.rec.by==="u1"; })`), "Ort aus Link nicht gemerkt");
  // Ortsname aus eigener Reise beim Schreiben → Vorschlag, Antippen hängt die Karte an
  await page.type("#chIn", "Treffen wir uns bei katz deli?"); await page.waitForTimeout(450);
  ok(await rp(`!$("chSugBox").hidden && $("chSugBox").textContent.includes("Katz Deli")`), "Kein Vorschlag für Ortsnamen");
  await shot("chat-ort-vorschlag");
  await page.tap("#chSugBox [data-act=chsugok]"); await page.waitForTimeout(300);
  ok(await rp(`chDraft && chDraft.n==="Katz Deli" && $("chSugBox").hidden`), "Vorschlag hängt keine Ort-Karte an");
  await page.tap("#chView [data-act=chsend]"); await page.waitForTimeout(150);
  ok(await rp(`var s = __sent[__sent.length-1]; s && s.place && s.place.n==="Katz Deli" && s.t.includes("katz deli")`), "Ort-Karte nicht mitgesendet");
  // Teilwort trifft nicht; × blendet aus
  await page.type("#chIn", "MoMAs Shop"); await page.waitForTimeout(450);
  ok(await rp(`$("chSugBox").hidden`), "Teilwort löst Vorschlag aus");
  await page.fill("#chIn", ""); await page.type("#chIn", "Danach ins MoMA"); await page.waitForTimeout(450);
  ok(await rp(`!$("chSugBox").hidden`), "Vorschlag für MoMA fehlt");
  await page.tap("#chSugBox [data-act=chsugx]"); await page.type("#chIn", "!"); await page.waitForTimeout(450);
  ok(await rp(`$("chSugBox").hidden`), "Ausgeblendeter Vorschlag kommt wieder");
  // Link-Erkennung
  ok(await rp(`var a = chLinkPl("https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffelturm"), b = chLinkPl("Katz's Delicatessen\\nhttps://maps.app.goo.gl/AbC123"), c = chLinkPl("https://example.com/@1.5,2.5");
    a && a.n==="Eiffelturm" && a.la===48.8584 && b && b.q==="Katz's Delicatessen" && !c`), "Link-Erkennung falsch");
  await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: geteilte Orte des Chats auf einer Karte mit Liste, Antippen zeigt den Ort", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"", at:Date.now()-300000, place:{n:"Russ & Daughters", c:"essen", la:40.7224, lo:-73.9882, addr:"Houston St"}},
    {id:"m2", from:"u_me", t:"https://maps.apple.com/?ll=40.7484,-73.9857&q=Empire%20State", at:Date.now()-200000},
    {id:"m3", from:"u1", t:"", at:Date.now()-100000, day:{dn:2, dt:"Dienstag, 2. Juni", trip:"X", km:0, st:[{n:"Russ & Daughters", c:"essen", la:40.7224, lo:-73.9882}, {n:"Katz Deli", c:"essen", la:40.7223, lo:-73.9874}]}}]; ${CHMOCK} openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===3`), null, {timeout:4000});
  await page.tap("#chView .ch-head [data-act=chplaces]"); await page.waitForTimeout(400);
  const r = await rp(`var rows = [].map.call(document.querySelectorAll("#catPop .ch-plsl .ls-row b"), function(b){ return b.textContent; }); JSON.stringify({rows:rows, map:!!$("chPlsMap"), mk:document.querySelectorAll("#chPlsMap .ch-plsmk").length})`);
  const o = JSON.parse(r);
  ok(o.rows.length===3 && o.rows.includes("Russ & Daughters") && o.rows.includes("Empire State") && o.rows.includes("Katz Deli") && o.map && o.mk===3, "Liste/Karte falsch (doppelte Orte zusammengefasst?): "+r);
  ok(await rp(`document.querySelector("#catPop .ch-plsl").textContent.includes("in deiner Reise")`), "Hinweis „in deiner Reise“ fehlt bei Katz Deli");
  await shot("chat-geteilte-orte");
  await page.tap('#catPop .ch-plsl .ls-row:has-text("Empire State")'); await page.waitForTimeout(300);
  ok(await rp(`$("catPop").hidden && !chPage && sel==="poi" && poiSel.n==="Empire State" && !CHPLS.map`), "Antippen zeigt den Ort nicht auf der Karte oder Pop-up/Karte bleibt");
  await rp(`CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: Fotos vom Gerät als Album – Auswahl, Entwurf, Senden (Fotos einzeln ohne at), Raster, Galerie", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"Hallo", at:Date.now()-60000}]; ${CHMOCK} openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===1`), null, {timeout:4000});
  const imgs = await page.evaluate(() => ["#c33", "#3a3", "#36c", "#cc3", "#c3c"].map((col, i) => { const c = document.createElement("canvas"); c.width = 2400; c.height = 1600; const g = c.getContext("2d"); g.fillStyle = col; g.fillRect(0, 0, 2400, 1600); g.fillStyle = "#fff"; g.font = "400px sans-serif"; g.fillText(String(i+1), 1000, 1000); return c.toDataURL("image/png").split(",")[1]; }));
  await page.setInputFiles("#chPhIn", imgs.map((b, i) => ({name:"f"+i+".png", mimeType:"image/png", buffer:Buffer.from(b, "base64")})));
  await page.waitForFunction(() => window.__rp(`chDraft && chDraft.al && chDraft.al.length===5`), null, {timeout:6000});
  ok(await rp(`document.querySelectorAll("#chDraftBox .ch-ald").length===5 && document.querySelector("#chView .ch-comp").classList.contains("has")`), "Entwurf zeigt die Fotos nicht oder Senden fehlt");
  ok(await rp(`chDraft.al.every(function(x){ return x.w===1600 && x.h===1067 && x.d.length < 900000 && x.th.length < 40000; })`), "Fotos nicht verkleinert: "+await rp(`JSON.stringify(chDraft.al.map(function(x){ return [x.w, x.h, x.d.length, x.th.length]; }))`));
  await page.tap('#chDraftBox [data-act=chalx][data-i="4"]'); await page.waitForTimeout(100);
  ok(await rp(`chDraft.al.length===4`), "Foto entfernen klappt nicht");
  await page.fill("#chIn", "Unser Tag"); await page.tap("#chView [data-act=chsend]"); await page.waitForTimeout(300);
  ok(await rp(`var imgs = __sets.filter(function(d){ return d.img; }); imgs.length===4 && imgs.every(function(d){ return d.from==="u_me" && !("at" in d); })`), "Fotos nicht einzeln ohne at gespeichert");
  ok(await rp(`var s = __sent[__sent.length-1]; s && s.al && s.al.length===4 && s.t==="Unser Tag" && s.al.every(function(x){ return x.id && x.th && !x.d; })`), "Album-Nachricht falsch");
  ok(await rp(`__sets.some(function(d){ return d.last && d.last.place==="4 Fotos" && d.last.ph; })`), "Chat-Liste zeigt das Album nicht");
  // Empfang: Raster; 6 Fotos → 4 Felder mit +2; Antippen öffnet Galerie mit allen
  await rp(`var th = __sent[__sent.length-1].al[0].th; __M.push(Object.assign({id:"m2"}, __sent[__sent.length-1])); __M.push({id:"m3", from:"u1", t:"", at:Date.now(), al:[0,1,2,3,4,5].map(function(i){ return {id:"x"+i, th:th, w:1600, h:1067}; })}); __snap(); true`);
  await page.waitForTimeout(200);
  ok(await rp(`var g = document.querySelector('#chMsgs .ch-msg[data-mid="m3"] .ch-al'); !!g && g.classList.contains("n4") && g.querySelectorAll(".ch-alc").length===4 && g.textContent.includes("+2")`), "Raster falsch");
  await shot("chat-album");
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] .ch-alc >> nth=1'); await page.waitForTimeout(400);
  ok(await rp(`!$("chPhView").hidden && CHGAL.list.length===4 && CHGAL.i===1 && /^data:image\\/jpeg/.test(document.querySelector("#chPvImg").src) && document.querySelector("#chPvImg").naturalWidth===1600`), "Galerie zeigt das große Foto nicht");
  await rp(`$("chPhView").hidden = true; CHGAL = null; closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: Abstimmung – Plus-Menü, Frage und Antworten (Orte erkannt), abstimmen, Ergebnis, Einplanen nur von Hand, beenden", async () => {
  await seed();
  await rp(`window.__M = [{id:"m1", from:"u1", t:"Hallo", at:Date.now()-60000}]; ${CHMOCK} openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===1`), null, {timeout:4000});
  await page.tap("#chView [data-act=chplus]"); await page.waitForTimeout(200);
  ok(await rp(`["chpick", "chphpick", "chpoll"].every(function(a){ return !!document.querySelector("#jpMenu [data-act="+a+"]"); })`), "Plus-Menü unvollständig");
  await page.tap("#jpMenu [data-act=chpoll]"); await page.waitForTimeout(200);
  ok(await rp(`!$("catPop").hidden && document.activeElement===$("pollQ") && document.querySelector("#catPop [data-act=chpollsend]").disabled`), "Abstimmungs-Fenster falsch");
  await page.fill("#pollQ", "Wohin heute Abend?");
  const o = await page.$$("#catPop .poll-o"); await o[0].fill("Katz Deli"); await o[1].fill("Pizza irgendwo");
  await page.tap("#catPop [data-act=chpolladd]"); await page.waitForTimeout(100);
  ok(await rp(`document.querySelectorAll("#catPop .poll-o").length===3 && document.activeElement===document.querySelectorAll("#catPop .poll-o")[2] && $("pollQ").value==="Wohin heute Abend?"`), "Antwort hinzufügen verliert Eingaben");
  await page.tap("#catPop [data-act=chpollsend]"); await page.waitForTimeout(200);
  ok(await rp(`var s = __sent[__sent.length-1]; s && s.poll && s.poll.q==="Wohin heute Abend?" && s.poll.o.length===2 && s.poll.o[0].pl && s.poll.o[0].pl.n==="Katz Deli" && !s.poll.o[1].pl && $("catPop").hidden`), "Abstimmung falsch gesendet: "+JSON.stringify(await rp(`__sent`)));
  // Empfang einer Abstimmung mit Ort, der nicht in der Reise ist; abstimmen speichert pv.u_me
  await rp(`__M.push({id:"m2", from:"u1", t:"", at:Date.now(), poll:{q:"Frühstück?", mu:false, o:[{t:"Russ & Daughters", pl:{n:"Russ & Daughters", c:"essen", la:40.7224, lo:-73.9882}}, {t:"Bagel"}]}, pv:{u1:[0]}}); __snap(); true`); await page.waitForTimeout(200);
  ok(await rp(`var p = document.querySelector('#chMsgs .ch-msg[data-mid="m2"] .ch-poll'); !!p && p.querySelectorAll(".ch-pollb").length===2 && p.textContent.includes("1 Stimme") && !!p.querySelector("[data-act=chplan]")`), "Abstimmung nicht dargestellt");
  ok(await rp(`!Object.keys(T().places).some(function(k){ return T().places[k].n==="Russ & Daughters"; })`), "Ort wurde automatisch übernommen");
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] [data-act=chvote][data-i="1"]'); await page.waitForTimeout(150);
  ok(await rp(`JSON.stringify(__upd[__upd.length-1])===JSON.stringify(["m2", {"pv.u_me":[1]}]) && document.querySelector('#chMsgs .ch-msg[data-mid="m2"] .ch-pollr.on .ch-pollt').textContent==="Bagel"`), "Stimme nicht gespeichert: "+await rp(`JSON.stringify(__upd)`));
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] [data-act=chvote][data-i="0"]'); await page.waitForTimeout(150);
  ok(await rp(`__upd[__upd.length-1][1]["pv.u_me"].join()==="0" && document.querySelector('#chMsgs .ch-msg[data-mid="m2"] .ch-poll').textContent.includes("2 Stimmen")`), "Einfachauswahl wechselt nicht");
  await shot("chat-abstimmung");
  // manuell einplanen
  await page.tap('#chMsgs .ch-msg[data-mid="m2"] [data-act=chplan]'); await page.waitForTimeout(200);
  await page.tap('#jpMenu [data-act=chday] >> nth=0'); await page.waitForTimeout(200);
  ok(await rp(`Object.keys(T().places).some(function(k){ var p = T().places[k]; return p.n==="Russ & Daughters" && dayOf(k) && p.rec && p.rec.by==="u1"; })`), "Einplanen aus der Abstimmung klappt nicht");
  // eigene Abstimmung beenden
  await rp(`__M.push(Object.assign({id:"m3"}, __sent[__sent.length-1])); __snap(); true`); await page.waitForTimeout(150);
  await page.tap('#chMsgs .ch-msg[data-mid="m3"] [data-act=chpollend]'); await page.waitForTimeout(150);
  ok(await rp(`JSON.stringify(__upd[__upd.length-1])===JSON.stringify(["m3", {"poll.end":true}]) && document.querySelector('#chMsgs .ch-msg[data-mid="m3"] .ch-poll').textContent.includes("beendet") && !document.querySelector('#chMsgs .ch-msg[data-mid="m3"] [data-act=chvote]')`), "Beenden klappt nicht");
  await rp(`closeChPage(); CH.byId = {}; CH.list = []; CHMC = {}; true`);
});
await test("Chat: Kopf ohne Balken, Verlauf scrollt darunter durch und blendet oben weich aus, Knöpfe als Glas-Kreise", async () => {
  await seed();
  await rp(`window.__M = []; for(var i = 0; i < 30; i++) __M.push({id:"m"+String(i).padStart(2,"0"), from:i % 3 ? "u1" : "u_me", t:"Nachricht Nummer "+i+" mit etwas mehr Text, damit sie umbricht", at:Date.now() - (30 - i)*60000});
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(){}, update:function(){}, commit:function(){ return Promise.resolve(); }}; }, collection:function(){ return {doc:function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, update:function(){ return Promise.resolve(); },
      collection:function(n){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, doc:function(){ return {}; }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ if(n!=="msgs" || cid!=="u1_u_me") return function(){}; setTimeout(function(){ cb(qs()); }, 0); return function(){}; }}; return q; }}; }}; }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; acct.user.uid = "u_me";
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:1000, names:{u1:"Anna"}, read:{u_me:Date.now()}, last:{t:"Nachricht 29", from:"u1", at:__M[29].at}}}; CH.list = [CH.byId.u1_u_me]; CH.got = true; CHPROF.u1 = {name:"Anna"};
    CHMC.u1_u_me = null; delete CHMC.u1_u_me; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && document.querySelectorAll("#chMsgs .ch-msg").length===30`), null, {timeout:4000});
  await page.waitForTimeout(400);
  await shot("chat-kopf");
  ok(await rp(`!$("chNewMk")`), "Trennlinie „Neue Nachrichten“ ohne ungelesene Nachrichten");
  const st = await page.evaluate(() => { const hd = document.querySelector("#chView .ch-head"), box = document.getElementById("chMsgs"), cs = getComputedStyle(hd), bk = getComputedStyle(hd.querySelector(".ch-back"));
    const hb = hd.getBoundingClientRect(), mb = box.getBoundingClientRect();
    return {bg:cs.backgroundColor, line:cs.borderBottomStyle==="none" || parseFloat(cs.borderBottomWidth)===0, under:mb.top <= hb.top + 1, mask:getComputedStyle(box).webkitMaskImage || getComputedStyle(box).maskImage,
      blur:bk.backdropFilter || bk.webkitBackdropFilter, round:bk.borderRadius, padTop:parseFloat(getComputedStyle(box).paddingTop) >= hb.bottom - mb.top - 2,
      atEnd:box.scrollHeight - box.scrollTop - box.clientHeight < 4, headH:hb.height}; });
  ok(st.line && /rgba\(0, 0, 0, 0\)|transparent/.test(st.bg), "Chat-Kopf hat noch einen Balken/Trennlinie: "+JSON.stringify(st));
  ok(st.under && st.padTop, "Verlauf läuft nicht unter dem Kopf durch: "+JSON.stringify(st));
  ok(/gradient/.test(st.mask || ""), "Verlauf blendet oben nicht weich aus: "+JSON.stringify(st));
  ok(/blur/.test(st.blur || "") && st.round==="50%", "Zurück-Knopf ist kein Glas-Kreis: "+JSON.stringify(st));
  ok(st.atEnd, "Chat öffnet nicht an der neuesten Nachricht");
  // ganz nach oben gescrollt: erste Nachricht liegt vollständig unter dem Kopf, nicht verdeckt
  const top = await page.evaluate(() => { const box = document.getElementById("chMsgs"); box.scrollTop = 0; const f = box.querySelector(".ch-msg").getBoundingClientRect(), hb = document.querySelector("#chView .ch-head").getBoundingClientRect(); return {f:f.top, h:hb.bottom}; });
  ok(top.f >= top.h - 1, "Erste Nachricht beim Hochscrollen vom Kopf verdeckt: "+JSON.stringify(top));
  // ungelesen ab Nachricht 20: Trennlinie „Neue Nachrichten“ vor der ersten ungelesenen fremden Nachricht, Lesestelle dort (direkt unter dem Kopf)
  await rp(`chBackToList(); CH.byId.u1_u_me.read = {u_me:__M[19].at}; openChPage("u1_u_me"); true`);
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && !!$("chNewMk")`), null, {timeout:4000});
  await page.waitForTimeout(400);
  await shot("chat-neue-nachrichten");
  const nm = await page.evaluate(() => { const m = document.getElementById("chNewMk"), nx = m.nextElementSibling, hb = document.querySelector("#chView .ch-head").getBoundingClientRect(), r = m.getBoundingClientRect();
    return {txt:m.textContent, next:nx && nx.getAttribute("data-mid"), n:document.querySelectorAll("#chNewMk").length, y:Math.round(r.top), h:Math.round(hb.bottom)}; });
  ok(nm.txt==="Neue Nachrichten" && nm.next==="m20" && nm.n===1, "Trennlinie nicht vor der ersten ungelesenen Nachricht: "+JSON.stringify(nm));
  ok(nm.y >= nm.h - 2 && nm.y <= nm.h + 40, "Lesestelle nicht an der Trennlinie: "+JSON.stringify(nm));
});

await test("Chat: Zurück zur Übersicht zeigt den Chat als normale Zeile", async () => {
  await seed();
  await rp(`window.__M = []; for(var i = 0; i < 12; i++) __M.push({id:"m"+String(i).padStart(2,"0"), from:i % 3 ? "u1" : "u_me", t:"Nachricht "+i, at:Date.now() - (12 - i)*60000});
    var qs = function(){ return {docs:__M.map(function(m){ return {id:m.id, data:function(){ return JSON.parse(JSON.stringify(m)); }}; })}; };
    fbDb = {runTransaction:function(){ return new Promise(function(){}); }, batch:function(){ return {set:function(){}, update:function(){}, commit:function(){ return Promise.resolve(); }}; }, collection:function(){ return {doc:function(cid){ return {get:function(){ return Promise.resolve({exists:false}); }, update:function(){ return Promise.resolve(); },
      collection:function(n){ var q = {orderBy:function(){ return q; }, limitToLast:function(){ return q; }, doc:function(){ return {}; }, get:function(){ return Promise.resolve(qs()); },
        onSnapshot:function(cb){ setTimeout(function(){ cb(qs()); }, 0); return function(){}; }}; return q; }}; }}; }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; acct.user.uid = "u_me";
    CH.byId = {u1_u_me:{id:"u1_u_me", members:["u1","u_me"], at:2000, names:{u1:"Hannah_zim"}, read:{u_me:__M[5].at}, last:{t:"Nachricht 11", from:"u1", at:__M[11].at}},
      u2_u_me:{id:"u2_u_me", members:["u2","u_me"], at:1000, names:{u2:"anna"}, read:{u_me:Date.now()}, last:{t:"Huhu", from:"u_me", at:1000}}};
    CH.list = [CH.byId.u1_u_me, CH.byId.u2_u_me]; CH.got = true; CHPROF.u1 = {name:"Hannah_zim"}; CHPROF.u2 = {name:"anna"};
    openChPage(); true`);
  await page.waitForTimeout(300);
  await page.tap('#chView [data-act=chopen][data-v="u1_u_me"]');
  await page.waitForFunction(() => window.__rp(`chOpen==="u1_u_me" && !!document.querySelector("#chMsgs .ch-msg")`), null, {timeout:4000});
  await page.waitForTimeout(300);
  await page.tap("#chView .ch-back"); await page.waitForTimeout(300);
  await shot("chat-zurueck");
  const r = await page.evaluate(() => { const a = document.querySelector('#chView [data-v="u1_u_me"]').getBoundingClientRect(), b = document.querySelector('#chView [data-v="u2_u_me"]').getBoundingClientRect(); return {a:Math.round(a.height), b:Math.round(b.height), ret:document.querySelector('#chView [data-v="u1_u_me"]').classList.contains("ch-ret")}; });
  ok(r.ret && Math.abs(r.a - r.b) <= 2, "Zurückgekehrter Chat nicht als normale Zeile: "+JSON.stringify(r));
});

await test("Tastatur im Chat: Leiste und Kopf bleiben, nur die Eingabezeile sitzt über der Tastatur", async () => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; CH.byId.c1 = {id:"c1", members:["u_me","u_h"], names:{u_h:"Hannah_zim"}}; CH.list = [CH.byId.c1]; openChPage("c1"); try { localStorage.removeItem("rp-chkb"); } catch(e){} if(typeof KBPRED!=="undefined") KBPRED = true; CHKB.fb = 60000; true`);   // Rückfallebene „keine Tastatur“ (1,2 s) würde unter Last vorzeitig greifen
  await page.waitForTimeout(1000);   // Zeitgeber vorheriger Tests (Fokus) abwarten
  ok(await page.locator("#chIn").count()===1, "Chat-Eingabe fehlt");
  const vp = page.viewportSize(), H = vp.height, VH = H - 380;
  // Lagen in BILDSCHIRM-Koordinaten (getBoundingClientRect zählt ab Layout-Oberkante, iOS verschiebt um offsetTop)
  const pos = () => page.evaluate(() => { const r = s => { const e = document.querySelector(s); if(!e) return null; const b = e.getBoundingClientRect(), t = visualViewport.offsetTop; return {y:Math.round(b.top - t), b:Math.round(b.bottom - t)}; };
    // überall im sichtbaren Bereich muss Chat (oder die Leiste) liegen – nie die Karte
    const vv = visualViewport, hole = []; for(let y = vv.offsetTop + 5; y < vv.offsetTop + vv.height; y += 20){ const e = document.elementFromPoint(innerWidth/2, y); if(!e || !e.closest("#chView,.top")) hole.push(Math.round(y)); }
    return {bar:r(".tabbar"), head:r("#chView .ch-head"), inp:r("#chView .ch-comp"), vt:vv.offsetTop, vh:vv.height, hole}; });
  const kbFake = (h, top) => page.evaluate(([h, top]) => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); Object.defineProperty(visualViewport, "offsetTop", {configurable:true, get:() => top});
    visualViewport.dispatchEvent(new Event("resize")); visualViewport.dispatchEvent(new Event("scroll")); }, [h, top]);
  const kbReal = () => page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event("resize")); });
  const p0 = await pos();
  ok(!p0.hole.length && p0.inp.b >= H - 2, "Chat ohne Tastatur nicht bildschirmfüllend: "+JSON.stringify(p0));
  const same = (p, w) => { ok(Math.abs(p.bar.y - p0.bar.y) <= 1, w+": Hauptleiste verrutscht ("+p0.bar.y+" → "+p.bar.y+")"); ok(Math.abs(p.head.y - p0.head.y) <= 1, w+": Chat-Kopf verrutscht ("+p0.head.y+" → "+p.head.y+")");
    ok(!p.hole.length, w+": Karte scheint durch bei y="+p.hole.join(",")); };
  // 1) Antippen: Eingabe sofort über der (geschätzten) Tastatur, nichts darunter durchsichtig
  // Gleiten statt Springen: Bild für Bild mitschreiben, wo die Eingabe steht
  const glide = (act) => page.evaluate(async (act) => { const c = document.querySelector("#chView .ch-comp"), ys = [Math.round(c.getBoundingClientRect().bottom)];
    if(act==="focus") document.getElementById("chIn").focus(); else document.activeElement.blur();
    const t0 = performance.now(); let slow = 0;
    for(let i = 0; i < 40 && performance.now() - t0 < 500; i++){ const t = performance.now(); await new Promise(r => requestAnimationFrame(r)); if(i < 12 && performance.now() - t > 60) slow++; ys.push(Math.round(c.getBoundingClientRect().bottom)); }
    return {ys, slow:slow > 2 || ys.length < 10}; }, act).then(r => { r.ys.slow = r.slow; return r.ys; });
  // Gleiten = erstes Bild noch (fast) an der alten Stelle, dann gleichmäßig in eine Richtung über mehrere Bilder bis zum Ziel
  // (die Bildrate schwankt unter Last, daher keine feste Schrittgrenze)
  // nur bis zum ersten Erreichen des Ziels auswerten (danach greift ggf. die Rückfallebene „keine Tastatur gekommen“ nach 1,2 s)
  // Rechner unter Last (Bilder > 60 ms): Bildfolge sagt nichts über Gleiten aus – dann nur Endlage prüfen (geschieht danach ohnehin)
  const smooth = (ys0, w, z) => { if(ys0.slow){ console.log("    (Gleiten nicht beurteilt: Rechner unter Last)"); return; } const a = ys0[0]; let k = ys0.findIndex(y => Math.abs(y - z) <= 2); const ys = k > 0 ? ys0.slice(0, k + 1) : ys0, dir = Math.sign(z - a); let mono = true, mid = 0;
    for(let i = 1; i < ys.length; i++){ if(Math.sign(ys[i] - ys[i-1]) === -dir && Math.abs(ys[i] - ys[i-1]) > 1) mono = false; if(Math.abs(ys[i] - a) > 8 && Math.abs(ys[i] - z) > 8) mid++; }
    ok(Math.abs(ys[1] - a) <= 40 && mono && mid >= 2, w+": Eingabe springt statt zu gleiten: "+ys0.join(",")); };
  const g1 = await glide("focus"); smooth(g1, "Antippen", H - 400);   // erste Schätzung: gut 400 pt Tastatur
  // auf das Ende der Bewegung warten – unter Last dauert sie länger
  for(let i = 0; i < 60 && await rp(`CHKB.anim`); i++) await page.waitForTimeout(50);
  const p1 = await pos(); same(p1, "Antippen"); ok(p1.inp.b <= H - 380 && p1.inp.b >= H - 420, "Eingabe beim Antippen nicht über der erwarteten Tastatur: "+JSON.stringify(p1.inp));

  // 2) Fall A – iOS meldet die Tastatur nur über visualViewport (innerHeight bleibt) und verschiebt die Seite (offsetTop)
  await kbFake(VH, 120); await page.waitForTimeout(350);
  let p = await pos(); same(p, "Tastatur mit Seitenverschiebung");
  ok(Math.abs(p.inp.b - VH) <= 1, "Eingabe nicht direkt über der Tastatur (verschoben): "+JSON.stringify(p));
  await kbFake(VH, 0); await page.waitForTimeout(350);
  p = await pos(); same(p, "Tastatur ohne Verschiebung"); ok(Math.abs(p.inp.b - VH) <= 1, "Eingabe nicht direkt über der Tastatur: "+JSON.stringify(p));
  const g2 = await glide("blur"); smooth(g2, "Schließen", p0.inp.b); await kbReal(); await page.waitForTimeout(50);
  p = await pos(); same(p, "Schließen"); ok(Math.abs(p.inp.b - p0.inp.b) <= 1, "Eingabe steht nach dem Schließen nicht wie vorher: "+p0.inp.b+" → "+p.inp.b); ok(p.inp.b >= H - 2, "Eingabe bleibt nach dem Schließen oben: "+JSON.stringify(p.inp));
  // 3) Fall B – iOS verkleinert das ganze Layout (innerHeight sinkt mit): das war der Fehler mit der durchscheinenden Karte
  await page.locator("#chIn").focus(); await page.waitForTimeout(350);
  await page.setViewportSize({width:vp.width, height:VH}); await page.waitForTimeout(350);
  p = await pos(); same(p, "Layout verkleinert"); ok(Math.abs(p.inp.b - VH) <= 1, "Eingabe nicht direkt über der Tastatur (Layout verkleinert): "+JSON.stringify(p));
  ok(await rp(`JSON.parse(localStorage.getItem("rp-chkb") || "{}") && true`), "Tastaturhöhe nicht gemerkt");
  await shot("tastatur-chat");
  await page.evaluate(() => document.activeElement.blur()); await page.setViewportSize(vp); await page.waitForTimeout(400);
  p = await pos(); same(p, "Schließen nach Verkleinern"); ok(p.inp.b >= H - 2, "Eingabe nach dem Schließen nicht unten: "+JSON.stringify(p.inp));
  // 4) Zweites Antippen: gemerkte Höhe → Eingabe steht sofort an der richtigen Stelle (kein Nachrutschen)
  const g3 = await glide("focus"); smooth(g3, "Zweites Antippen", VH);
  p = await pos(); ok(Math.abs(p.inp.b - VH) <= 1, "Gemerkte Tastaturhöhe nicht genutzt: "+JSON.stringify(p.inp));
  // 4b) Wechsel auf die (höhere) Emoji-Tastatur: iOS meldet die neue Höhe teils OHNE resize-Ereignis – Eingabe muss trotzdem nachrücken
  await page.evaluate(h => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); Object.defineProperty(visualViewport, "offsetTop", {configurable:true, get:() => 0}); }, VH - 60);
  for(let i = 0; i < 30 && Math.abs((await pos()).inp.b - (VH - 60)) > 1; i++) await page.waitForTimeout(50);
  p = await pos(); same(p, "Emoji-Tastatur"); ok(Math.abs(p.inp.b - (VH - 60)) <= 1, "Eingabe rückt bei höherer Emoji-Tastatur nicht nach (ohne Ereignis): "+JSON.stringify(p.inp));
  await page.evaluate(h => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); }, VH);
  for(let i = 0; i < 30 && Math.abs((await pos()).inp.b - VH) > 1; i++) await page.waitForTimeout(50);
  p = await pos(); ok(Math.abs(p.inp.b - VH) <= 1, "Eingabe kehrt nach Rückwechsel zur normalen Tastatur nicht zurück: "+JSON.stringify(p.inp));
  // 5) Senden lässt die Tastatur offen (Fokus bleibt im Feld)
  await page.evaluate(() => { const b = document.querySelector("#chView .ch-send"); const ev = new MouseEvent("mousedown", {bubbles:true, cancelable:true}); b.dispatchEvent(ev); window.__md = ev.defaultPrevented; });
  ok(await page.evaluate(() => window.__md), "Senden-Knopf nimmt dem Feld den Fokus (Tastatur ginge zu)");
  await page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop; });
  await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(50); await rp(`CHKB.fb = 1200; true`);
});

await test("Anmeldung: Hintergrund bleibt ganz, beim Antippen und mit Tastatur bewegt sich nichts", async () => {
  await seed();
  await rp(`acct.user = null; acct.verify = null; acct.ready = true; acct.state = "out"; renderGate(true); true`);
  await page.waitForTimeout(200);
  ok(await visible("#gate #acMail"), "Anmeldefenster fehlt");
  const H = page.viewportSize().height;
  const st = () => page.evaluate(() => { const vv = visualViewport, t = vv.offsetTop, c = document.querySelector("#gate .gate-card").getBoundingClientRect(), pw = document.getElementById("acPw").getBoundingClientRect(), hole = [];
    for(let y = t + 3; y < t + vv.height; y += 20) for(const x of [5, innerWidth/2, innerWidth - 5]){ const e = document.elementFromPoint(x, y); if(!e || !e.closest("#gate")) hole.push(Math.round(x)+"/"+Math.round(y)); }
    return {card:Math.round(c.top - t), pw:Math.round(pw.bottom - t), hole}; });
  const s0 = await st();
  ok(!s0.hole.length, "Hintergrund nicht überall: "+s0.hole.join(" "));
  ok(s0.pw <= H - 400, "Passwortfeld läge unter der Tastatur (iOS müsste verschieben): "+s0.pw);
  await page.locator("#acMail").focus(); await page.waitForTimeout(200);
  const chk = async (w) => { const s1 = await st(); ok(Math.abs(s1.card - s0.card) <= 1, w+": Karte springt ("+s0.card+" → "+s1.card+")"); ok(!s1.hole.length, w+": Hintergrund nicht überall: "+s1.hole.join(" ")); };
  await chk("Antippen");
  await page.evaluate(h => { Object.defineProperty(visualViewport, "height", {configurable:true, get:() => h}); visualViewport.dispatchEvent(new Event("resize")); }, H - 400);
  await page.waitForTimeout(200); await chk("Tastatur offen");
  await page.locator("#acPw").focus(); await page.waitForTimeout(200); await chk("Zweites Feld");
  await page.setViewportSize({width:page.viewportSize().width, height:H - 400}); await page.waitForTimeout(200);
  const s2 = await st(); ok(Math.abs(s2.card - s0.card) <= 1, "Layout verkleinert: Karte springt"); ok(!s2.hole.length, "Layout verkleinert: Hintergrund nicht überall");
  await page.evaluate(() => { delete visualViewport.height; document.activeElement.blur(); visualViewport.dispatchEvent(new Event("resize")); });
  await page.setViewportSize({width:page.viewportSize().width, height:H}); await page.waitForTimeout(200);
  // Antippen fokussiert selbst und OHNE Verschieben (iOS schob am iPhone beim Feldwechsel kurz um 48 pt) – Feldwechsel per Tippen
  await page.evaluate(() => { window.__fo = []; const f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function(o){ window.__fo.push((this.id||"?")+":"+!!(o && o.preventScroll)); return f.call(this, o); }; });
  await page.tap("#acMail"); await page.waitForTimeout(100); await page.tap("#acPw"); await page.waitForTimeout(100);
  const fo = await page.evaluate(() => { const r = window.__fo; delete HTMLElement.prototype.focus; return {r, a:document.activeElement && document.activeElement.id}; });
  ok(fo.a==="acPw", "Tippen ins Passwortfeld fokussiert es nicht: "+fo.a);
  ok(fo.r.includes("acMail:true") && fo.r.includes("acPw:true"), "Felder nicht ohne Verschieben fokussiert: "+fo.r.join(" "));
  await page.tap("#acPw"); await page.waitForTimeout(50);
  ok(await page.evaluate(() => document.activeElement.id)==="acPw", "Erneutes Tippen ins aktive Feld verliert den Fokus");
  await page.evaluate(() => document.activeElement.blur());
  await shot("anmeldung");
});

await test("Freunde: Suche statt Liste bei 200 Freunden (Ziel teilen)", async () => {
  await seed();
  await rp(`var fq = function(){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(id){ return {id:id, collection:function(){ return fq(); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    fbDb = {collection:function(){ return fq(); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"};
    FR.friends = []; for(var i = 0; i < 200; i++) FR.friends.push({id:"r"+i, uid:"u"+i, name:"freund"+i, email:"f"+i+"@x.de"});
    FR.friends.push({id:"rz", uid:"u_zoe", name:"Zoe", email:"zoe@x.de"});
    var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); META[z] = {owner:"u_me", members:["u_me"], invites:[]}; save(); openZiele(z); true`);
  await page.waitForTimeout(300);
  await page.tap("#zPop [data-act=zinvpop]"); await page.waitForTimeout(300);
  ok(await visible("#catPop .frs-pop"), "Pop-up zum Einladen öffnet nicht");
  ok(await page.locator("#catPop .frs-row").count()===201, "Ohne Suche nicht alle Freunde in der Liste");
  await page.fill("#catPop .frs-in", "freund1"); await page.waitForTimeout(150);
  const n = await page.locator("#catPop .frs-row").count();
  ok(n===111, "Nicht alle Treffer angezeigt: "+n);
  ok(await rp(`var d = document.querySelector("#catPop .frs-big"); !!d && d.scrollHeight > d.clientHeight + 20 && d.clientHeight >= 300`), "Trefferbereich nicht groß und scrollbar");
  await page.fill("#catPop .frs-in", "zo"); await page.waitForTimeout(150);
  ok(await page.locator("#catPop .frs-row").count()===1, "Suche nach Zoe findet nicht genau einen Treffer");
  await shot("freunde-suche");
  await rp(`fbDb = null; FR.friends = []; true`);
});

// Tippen mit Selektor in der Fehlermeldung
async function tapS(sel){ try { await page.tap(sel); } catch(e){ throw new Error("Tippen auf "+sel+" fehlgeschlagen: "+(e.message||e).split("\n")[0]); } }
await test("Freundesgruppen: anlegen, am Freund zuordnen, Schnellauswahl beim Fragen und Einladen, löschen", async () => {
  await seed();
  await rp(`window.__fgw = []; var fq = function(path){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(path+"/"+id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(path){ return {id:path, collection:function(c){ return fq(path+"/"+c); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(v){ __fgw.push(["set", path, v]); return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ __fgw.push(["del", path]); return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    fbDb = {collection:function(c){ return fq(c); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; FG = [];
    FR.friends = [{id:"r1", uid:"u_anna", name:"anna", email:"a@x.de"}, {id:"r2", uid:"u_ludwig", name:"Ludwig", email:"l@x.de"}, {id:"r3", uid:"u_clara", name:"Clara", email:"c@x.de"}];
    FR.followers = FR.friends.map(function(f){ return Object.assign({mutual:true}, f); }); FR.following = FR.friends.slice(); FR.inc = []; frTab = "fol";
    closeMenus(); accView = "friends"; openSettings(); true`);
  await page.waitForTimeout(200);
  ok(!(await rp(`!!document.querySelector("#acctPop [data-act=fgnew]")`)), "Gruppen stehen noch als Liste auf der Freunde-Seite");
  await tapS("#acctPop [data-act=fglist]"); await page.waitForTimeout(250);
  ok(await visible("#catPop .fr-pop [data-act=fgnew]"), "Gruppen-Pop-up mit „Neue Gruppe“ öffnet nicht");
  await tapS("#catPop [data-act=fgnew]"); await page.waitForTimeout(250);
  ok(await visible("#catPop .fg-card"), "Gruppen-Fenster öffnet nicht");
  await tapS("#catPop [data-act=fgsave]"); await page.waitForTimeout(150);
  ok(await rp(`FG.length===0 && !!document.querySelector("#catPop .fg-card")`), "Gruppe ohne Namen gespeichert");
  await page.fill("#fgName", "Familie");
  await tapS('#catPop .frs-row[data-uid="u_anna"]'); await page.waitForTimeout(120);
  await tapS('#catPop .frs-row[data-uid="u_ludwig"]'); await page.waitForTimeout(120);
  ok(await rp(`document.getElementById("fgName").value`)==="Familie", "Name geht beim Auswählen verloren");
  ok(await page.locator("#catPop .frs-chip").count()===2, "Ausgewählte erscheinen nicht oben");
  await shot("fg-bearbeiten");
  await tapS("#catPop [data-act=fgsave]"); await page.waitForTimeout(250);
  ok(await rp(`FG.length===1 && FG[0].n==="Familie" && FG[0].m.join()==="u_anna,u_ludwig"`), "Gruppe falsch gespeichert: "+await rp(`JSON.stringify(FG)`));
  ok(await rp(`__fgw.some(function(w){ return w[0]==="set" && /^users\\/u_me\\/fgroups\\/g/.test(w[1]) && w[2].n==="Familie" && w[2].m.length===2; })`), "Nicht im eigenen privaten Bereich gespeichert: "+await rp(`JSON.stringify(__fgw)`));
  ok(await rp(`var g = document.querySelector("#catPop .fr-pop .fg-grp"); !!g && /Familie/.test(g.textContent) && /2 Personen/.test(g.textContent)`), "Nach dem Speichern nicht zurück in der Gruppenliste");
  ok(await rp(`/1 Gruppe/.test(document.querySelector("#acctPop [data-act=fglist]").getAttribute("aria-label")) && /Gruppen\s*1/.test(document.querySelector("#acctPop [data-act=fglist]").textContent)`), "Gruppen-Knopf zählt nicht");
  await tapS("#catPop [data-act=fgnew]"); await page.waitForTimeout(250);
  ok(await rp(`document.getElementById("fgName").value===""`), "Neue Gruppe übernimmt den Namen der vorigen: "+await rp(`document.getElementById("fgName").value`));
  await rp(`closeCatPop(); true`);
  // Zweite Gruppe, Clara am Freund selbst zuordnen – auch in mehreren Gruppen
  await rp(`fgPut({id:"gk", n:"Enger Kreis", m:["u_anna"]}); $("toast").hidden = true; true`); await page.waitForTimeout(100);
  await tapS('#acctPop [data-act=fgfor][data-uid="u_clara"]'); await page.waitForTimeout(200);
  ok(await page.locator("#jpMenu [data-act=fgset]").count()===2, "Gruppen-Auswahl am Freund fehlt");
  await tapS('#jpMenu [data-act=fgset]:has-text("Familie")'); await page.waitForTimeout(150);
  await tapS('#jpMenu [data-act=fgset]:has-text("Enger Kreis")'); await page.waitForTimeout(150);
  ok(await visible("#jpMenu"), "Auswahl schließt nach dem Antippen");
  ok(await rp(`fgOf("u_clara").length===2 && fgOf("u_anna").length===2`), "Person nicht in mehreren Gruppen");
  await shot("fg-am-freund");
  await tapS("#acctPop .ag-title"); await page.waitForTimeout(150);
  ok(await rp(`/Enger Kreis · Familie/.test(document.querySelector('#acctPop [data-uid="u_clara"]').closest(".ag-row").textContent)`), "Gruppen stehen nicht beim Freund");
  // Schnellauswahl: Freunde fragen
  await rp(`closeSettings(); openAsk("Rom"); true`); await page.waitForTimeout(200);
  ok(await page.locator("#catPop .ask-card .fg-chip").count()===2, "Gruppen fehlen beim Freunde-Fragen");
  await shot("fg-fragen");
  await tapS('#catPop .fg-chip:has-text("Familie")'); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(ASK.sel).sort().join()==="u_anna,u_clara,u_ludwig"`), "Gruppe wählt nicht alle aus");
  await tapS('#catPop .fg-chip:has-text("Familie")'); await page.waitForTimeout(150);
  ok(await rp(`Object.keys(ASK.sel).length===0`), "Zweites Antippen hebt die Auswahl nicht auf");
  await rp(`closeCatPop(); ASK = null; true`);
  // Schnellauswahl: Ziel teilen (einladen) mit Rückfrage
  await rp(`var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); META[z] = {owner:"u_me", members:["u_me"], invites:["a@x.de"]}; window.__z = z; save(); openZiele(z); true`);
  await page.waitForTimeout(300);
  await tapS("#zPop [data-act=zinvpop]"); await page.waitForTimeout(300);
  ok((await page.locator('#catPop .fg-chip[data-act=fginv]:has-text("Familie")').textContent()).replace(/\s/g, "")==="Familie2", "Gruppe zählt bereits Eingeladene mit");
  await tapS('#catPop .fg-chip:has-text("Familie")'); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card"), "Keine Rückfrage vor dem Einladen der Gruppe");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(300);
  ok(await rp(`META[__z].invites.slice().sort().join()==="a@x.de,c@x.de,l@x.de"`), "Gruppe nicht eingeladen: "+await rp(`JSON.stringify(META[__z].invites)`));
  ok(await rp(`!document.querySelector("#catPop .fg-chip[data-act=fginv]")`), "Gruppe bleibt trotz eingeladener Personen zur Auswahl");
  await rp(`closeCatPop(); closeProfile(); true`);
  // Löschen nur mit Bestätigung, rot
  await rp(`closeMenus(); accView = "friends"; openSettings(); $("toast").hidden = true; true`); await page.waitForTimeout(200);
  await tapS("#acctPop [data-act=fglist]"); await page.waitForTimeout(250);
  await tapS('#catPop [data-act=fgopen][data-g="gk"]'); await page.waitForTimeout(200);
  ok(await rp(`var c = getComputedStyle(document.querySelector("#catPop [data-act=fgdel]")).color.match(/\\d+/g).map(Number); c[0] > c[1] + 40`), "Löschen-Knopf nicht rot");
  await tapS("#catPop [data-act=fgdel]"); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card") && await rp(`FG.length===2`), "Löschen ohne Rückfrage");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(200);
  ok(await rp(`FG.length===1 && !fgGet("gk") && __fgw.some(function(w){ return w[0]==="del" && /fgroups\\/gk$/.test(w[1]); })`), "Gruppe nicht gelöscht");
  ok(await visible("#catPop .fr-pop .fg-grp") && !(await rp(`!!document.querySelector('#catPop [data-g="gk"]')`)), "Nach dem Löschen nicht zurück in der aktualisierten Liste");
  await rp(`closeCatPop(); closeSettings(); fbDb = null; FR.friends = []; FR.followers = []; FR.following = []; FG = []; true`);
});

await test("Konto löschen: Bestätigung mit Passwort, Reisen übergeben/löschen/verlassen, Inhalte bleiben als „Gelöschter Nutzer“", async () => {
  await seed();
  await rp(`window.__upd = []; window.__udel = 0;
    var D = {trips:[{id:"t1", data:{owner:"u_me", members:["u_me","u_v","u_b"], viewers:["u_v"]}}, {id:"t2", data:{owner:"u_me", members:["u_me"]}}, {id:"t3", data:{owner:"u_x", members:["u_x","u_me"]}}],
      "trips/t1/comments":[{id:"c1", data:{by:"u_me", email:"me@test.de"}}], pub:[{id:"u_me_k", data:{by:"u_me", name:"ich"}}], follows:[{id:"u_me_u_b", data:{from:"u_me", to:"u_b"}}]};
    var fq = function(path){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:(D[path]||[]).map(function(x){ return {id:x.id, data:function(){ return x.data; }, ref:fd(path+"/"+x.id)}; })}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(path+"/"+id); }}; return q; },
      fd = function(path){ return {id:path, collection:function(c){ return fq(path+"/"+c); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(v){ __upd.push(["set", path, v]); return Promise.resolve(); }, update:function(v){ __upd.push(["upd", path, v]); return Promise.resolve(); }, delete:function(){ __upd.push(["del", path]); return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    fbDb = {collection:function(c){ return fq(c); }, runTransaction:function(){ return Promise.resolve(); }};
    window.__au = window.firebase.auth; var fu = {uid:"u_me", email:"me@test.de", reauthenticateWithCredential:function(c){ return c.pw==="geheim" ? Promise.resolve() : Promise.reject({code:"auth/wrong-password"}); }, delete:function(){ __udel++; return Promise.resolve(); }};
    window.firebase.auth = Object.assign(function(){ return {currentUser:fu, signOut:function(){ return Promise.resolve(); }}; }, {EmailAuthProvider:{credential:function(e, p){ return {pw:p}; }}});
    PROF = {name:"ich", nameLower:"ich"}; closeMenus(); accView = "main"; openSettings(); true`);
  await page.waitForTimeout(200);
  ok(await visible("#acctPop [data-act=acdel]"), "Knopf „Konto löschen“ fehlt");
  await rp(`document.querySelector("#acctPop [data-act=acdel]").scrollIntoView({block:"end"}); true`); await shot("konto-loeschen-knopf");
  ok(await rp(`var b = document.querySelector("#acctPop [data-act=acdel]"); b.getBoundingClientRect().width > b.closest(".ag-card").clientWidth*0.8`), "Knopf nicht in voller Breite");
  await click("#acctPop [data-act=acdel]");
  ok(await visible("#adPop .ad-card"), "Bestätigung fehlt");
  ok(await rp(`var r = document.querySelector("#adPop .ad-card").getBoundingClientRect(); Math.abs((r.left + r.right)/2 - innerWidth/2) < 3 && Math.abs((r.top + r.bottom)/2 - innerHeight/2) < 40`), "Bestätigung nicht zentriert");
  ok(/Gelöschter Nutzer/.test(await page.locator("#adPop").innerText()), "Hinweis auf „Gelöschter Nutzer“ fehlt");
  await shot("konto-loeschen-dialog");
  // Abbrechen: nichts passiert, Konto-Seite bleibt
  await click("#adPop [data-act=adno]");
  ok(!(await visible("#adPop .ad-card")) && await visible("#acctPop [data-act=acdel]") && !(await rp(`__upd.length`)), "Abbrechen schließt nicht oder ändert etwas");
  // falsches Passwort: Meldung, nichts gelöscht
  await click("#acctPop [data-act=acdel]");
  await page.fill("#adPw", "falsch"); await page.locator("#adPop .cf-ok").click(); await page.waitForTimeout(300);
  ok(/Passwort stimmt nicht/.test(await page.locator("#adPop").innerText()) && !(await rp(`__upd.length || __udel`)), "Falsches Passwort nicht abgefangen");
  await page.fill("#adPw", "geheim"); await page.locator("#adPop .cf-ok").click();
  await page.waitForFunction(() => window.__rp("__udel")===1, null, {timeout:4000});
  const W = await rp(`JSON.stringify(__upd)`), U = JSON.parse(W), has = (k, p, f) => U.some(w => w[0]===k && w[1]===p && (!f || f(w[2]||{})));
  ok(has("upd", "trips/t1", v => v.owner==="u_b" && JSON.stringify(v.members)==='["u_v","u_b"]' && JSON.stringify(v.viewers)==='["u_v"]'), "Gemeinsame eigene Reise nicht an Mitreisende/n übergeben: "+W);
  ok(has("set", "trips/t2", v => v.deleted===true), "Eigene Einzel-Reise nicht gelöscht");
  ok(has("upd", "trips/t3", v => !("owner" in v)) && !has("set", "trips/t3"), "Fremde Reise nicht nur verlassen");
  ok(has("upd", "trips/t1/comments/c1", v => "email" in v) && !has("del", "trips/t1/comments/c1"), "Kommentar nicht behalten oder E-Mail nicht entfernt");
  ok(has("del", "trips/t1/loc/u_me") && has("del", "follows/u_me_u_b") && has("del", "usernames/ich"), "Standort, Folgen oder Benutzername nicht entfernt");
  ok(has("upd", "pub/u_me_k", v => v.name==="Gelöschter Nutzer") && !has("del", "pub/u_me_k"), "Öffentliche Empfehlung nicht als „Gelöschter Nutzer“ behalten");
  ok(has("set", "profiles/u_me", v => v.deleted===true && v.name==="Gelöschter Nutzer" && !("photo" in v)), "Profil nicht als gelöscht markiert");
  ok(await rp(`var U2 = __upd.map(function(w){ return w[1]; }); U2.indexOf("profiles/u_me") > U2.indexOf("trips/t1")`), "Profil vor den Reisen geändert");
  await page.waitForTimeout(200);
  ok(!(await visible("#adPop .ad-card")) && await rp(`!acct.user && /gelöscht/.test(acct.msg)`), "Nach dem Löschen nicht abgemeldet");
  // Anzeige: Name ohne „@“, Chat mit gelöschtem Konto ohne Eingabe
  ok(await rp(`atn("Gelöschter Nutzer")==="Gelöschter Nutzer" && atn("anna")==="@anna"`), "Namensanzeige falsch");
  await rp(`window.firebase.auth = window.__au; acct.user = {uid:"u_me2", email:"x@test.de"}; fbDb = null; CHPROF.u_g = {name:"Gelöschter Nutzer", photo:"", deleted:true}; CH.byId = {cg:{id:"cg", members:["u_me2","u_g"]}}; CH.list = [CH.byId.cg]; CH.got = true; openChPage("cg"); true`);
  await page.waitForTimeout(300);
  ok(await rp(`var c = document.querySelector("#chView .ch-conv"); !!c && c.classList.contains("gone") && !document.getElementById("chIn").offsetParent && !/@Gelöschter/.test(document.querySelector("#chView .ch-head").textContent)`), "Chat mit gelöschtem Konto erlaubt Schreiben oder zeigt „@“");
  await shot("konto-loeschen");
});

await test("Follower-Seite: Follower/Gefolgt, neue Follower mit rotem Zähler, zurückfolgen, entfernen, entfolgen, durchsuchen", async () => {
  await seed();
  await rp(`window.__upd = []; var fq = function(path){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(path+"/"+id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(path){ return {id:path, collection:function(c){ return fq(path+"/"+c); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(v){ __upd.push(["set", path, v]); return Promise.resolve(); }, update:function(v){ __upd.push(["upd", path, v]); return Promise.resolve(); }, delete:function(){ __upd.push(["del", path]); return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    fbDb = {collection:function(c){ return fq(c); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; PROF = {name:"ich", nameLower:"ich"}; FG = []; try { localStorage.removeItem(frReadKey()); } catch(e){}
    FR.followers = [{id:"u_anna_u_me", uid:"u_anna", name:"anna", mutual:true}, {id:"u_ludwig_u_me", uid:"u_ludwig", name:"Ludwig", mutual:true}, {id:"u_x_u_me", uid:"u_x", name:"xaver"}];
    FR.following = [{id:"u_me_u_anna", uid:"u_anna", name:"anna"}, {id:"u_me_u_ludwig", uid:"u_ludwig", name:"Ludwig"}, {id:"u_me_u_z", uid:"u_z", name:"zora"}];
    FR.inc = [{id:"u_y_u_me:1", uid:"u_y", name:"yvonne"}, {id:"u_v_u_me:1", uid:"u_v", name:"vera"}]; FR.out = [];
    FR.friends = FR.followers.slice(0, 2); frTab = "fol"; frFilt = "";
    closeMenus(); accView = "friends"; openSettings(); true`);
  await page.waitForTimeout(200);
  ok(/Follower/.test(await page.locator("#acctPop .ag-title").innerText()), "Seite heißt nicht Follower");
  ok(/Follower\s*3/.test(await page.locator('#acctPop [data-act=frtab][data-v="fol"]').innerText()) && /Gefolgt\s*3/.test(await page.locator('#acctPop [data-act=frtab][data-v="ing"]').innerText()), "Reiter Follower/Gefolgt zählen falsch");
  ok(await rp(`var t = document.querySelector("#acctPop .ag-title").getBoundingClientRect(), x = document.querySelector("#acctPop .ag-x").getBoundingClientRect(), s = document.querySelector("#acctPop .fr-seg").getBoundingClientRect(), b = document.querySelector("#acctPop [data-act=frreqs]").getBoundingClientRect(); Math.abs(document.querySelector("#acctPop [data-act=fglist]").getBoundingClientRect().top - b.top) < 2 && b.height <= 40 && s.top >= b.bottom && (function(){ var g = document.createRange(); g.selectNodeContents(document.querySelector("#acctPop .ag-title")); return g.getBoundingClientRect().right <= x.left - 4; })()`), "Kopf nicht kompakt: Gruppen/Anfragen nicht in einer Zeile über dem Umschalter oder Titel unter dem Schließen-Knopf");
  ok(await page.locator("#acctPop [data-frn]").count()===3, "Follower-Liste unvollständig");
  ok(await rp(`[].every.call(document.querySelectorAll("#acctPop [data-frn] .fn b"), function(b){ return b.scrollWidth <= b.clientWidth + 1; })`), "Namen in der Liste abgeschnitten");
  ok(await rp(`!document.querySelector('#acctPop [data-act=fgfor][data-uid="u_x"]') && !!document.querySelector('#acctPop [data-act=fgfor][data-uid="u_anna"]')`), "Gruppen-Knopf nicht nur bei Freunden (gegenseitig)");
  ok(!(await rp(`/befreundet|Freundschaft/.test(document.getElementById("acctPop").textContent)`)), "Alte Wörter befreundet/Freundschaft auf der Seite");
  ok((await page.locator("#acctPop [data-act=frreqs] .fr-badge").textContent()).trim()==="2", "Roter Zähler fehlt oder falsch");
  ok(await rp(`var b = document.querySelector("#acctPop .fr-badge"), t = document.querySelector("#acctPop [data-act=frreqs]"), r = b.getBoundingClientRect(), q = t.getBoundingClientRect(); getComputedStyle(b).backgroundColor==="rgb(255, 59, 48)" && r.right > q.right - 30 && r.top < q.top + 20`), "Zähler nicht rot oben rechts");
  await shot("follower-seite");
  await tapS("#acctPop [data-act=frreqs]"); await page.waitForTimeout(250);
  ok(await page.locator("#catPop .fr-pop [data-act=folacc]").count()===2 && await page.locator("#catPop .fr-pop [data-act=folrej]").count()===2, "Pop-up „Anfragen zum Folgen“ unvollständig");
  ok(/Anfragen zum Folgen/.test(await page.locator("#catPop .fr-pop h4").innerText()) && !/xaver/.test(await page.locator("#catPop .fr-pop").innerText()), "Im Pop-up stehen nicht nur Anfragen");
  ok(!(await rp(`!!document.querySelector("#acctPop .fr-badge")`)), "Zähler bleibt nach dem Ansehen");
  await shot("anfragen-folgen");
  await tapS('#catPop [data-act=folacc][data-uid="u_v"]'); await page.waitForTimeout(150);
  ok(await rp(`__upd.some(function(u){ return u[0]==="upd" && /^follows\\/u_v_u_me$/.test(u[1]) && u[2].st==="ok"; })`), "Annehmen schreibt nicht: "+await rp(`JSON.stringify(__upd)`));
  await tapS('#catPop [data-act=folrej][data-uid="u_y"]'); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card"), "Ablehnen ohne Rückfrage");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(150);
  ok(await rp(`__upd.some(function(u){ return u[0]==="del" && /^follows\\/u_y_u_me$/.test(u[1]); })`), "Ablehnen löscht nicht");
  await rp(`closeCatPop(); true`); await page.waitForTimeout(100);
  // Follower ohne Zurückfolgen: Folgen schickt eine Anfrage, Entfernen mit Rückfrage
  await tapS('#acctPop [data-act=folfol][data-uid="u_x"]'); await page.waitForTimeout(150);
  ok(await rp(`__upd.some(function(u){ return u[0]==="set" && /^follows\\/u_me_u_x$/.test(u[1]) && u[2].from==="u_me" && u[2].to==="u_x" && u[2].st==="req"; })`), "Folgen schickt keine Anfrage: "+await rp(`JSON.stringify(__upd)`));
  await tapS('#acctPop [data-act=folrm][data-uid="u_x"]'); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card"), "Entfernen ohne Rückfrage");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(150);
  ok(await rp(`__upd.some(function(u){ return u[0]==="del" && /^follows\\/u_x_u_me$/.test(u[1]); })`), "Follower entfernen löscht nicht");
  await rp(`closeCatPop(); FR.inc.push({id:"u_w_u_me:1", uid:"u_w", name:"wim"}); openSettings(); true`); await page.waitForTimeout(150);
  ok((await page.locator("#acctPop .fr-badge").textContent()).trim()==="1", "Neue Anfrage wird nicht als ungelesen gezählt");
  // Gefolgt: entfolgen mit Rückfrage
  await tapS('#acctPop [data-act=frtab][data-v="ing"]'); await page.waitForTimeout(150);
  ok(await page.locator("#acctPop [data-frn]").count()===3 && await page.locator("#acctPop [data-act=folunf]").count()===3, "Gefolgt-Liste falsch");
  ok(!(await rp(`!!document.querySelector("#acctPop [data-act=fgfor]")`)), "Gruppen-Knopf steht auch bei Gefolgt");
  await tapS('#acctPop [data-act=folunf][data-uid="u_z"]'); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card"), "Entfolgen ohne Rückfrage");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(150);
  ok(await rp(`__upd.some(function(u){ return u[0]==="del" && /^follows\\/u_me_u_z$/.test(u[1]); })`), "Entfolgen löscht nicht");
  // Durchsuchen
  await tapS('#acctPop [data-act=frtab][data-v="fol"]'); await page.waitForTimeout(150);
  await page.fill("#frFilt", "lu"); await page.waitForTimeout(100);
  ok(await rp(`[].filter.call(document.querySelectorAll("#acctPop [data-frn]"), function(r){ return !r.hidden; }).map(function(r){ return r.getAttribute("data-frn"); }).join()==="ludwig"`), "Suche filtert nicht");
  await rp(`openSettings(); true`);
  ok(await rp(`document.activeElement.id==="frFilt" && [].filter.call(document.querySelectorAll("#acctPop [data-frn]"), function(r){ return !r.hidden; }).length===1`), "Suche geht beim Aktualisieren verloren");
  await page.fill("#frFilt", "qqq"); await page.waitForTimeout(100);
  ok(await visible("#acctPop .fr-none"), "Kein Hinweis bei leerer Suche");
  // Profil: Follower und Gefolgt statt Freunde
  await rp(`closeSettings(); frFilt = ""; openProfile(); true`); await page.waitForTimeout(250);
  await shot("profil-follower");
  ok(await rp(`var t = document.querySelector("#profView .pf-stats").textContent; /3\\s*Follower/.test(t) && /3\\s*Gefolgt/.test(t) && !/Freunde/.test(t)`), "Profil zeigt nicht Follower/Gefolgt: "+await rp(`document.querySelector("#profView .pf-stats").textContent`));
  ok(await rp(`var a = document.querySelector("#profView .pf-stats").getBoundingClientRect(), p = document.querySelector("#profView .pf").getBoundingClientRect(); a.right <= p.right + 1`), "Profil-Zahlen ragen über den Rand");
  await rp(`closeProfile(); fbDb = null; FR = {inc:[], out:[], followers:[], following:[], friends:[]}; true`);
});

await test("Follower-Seite: Unterfenster (Leute suchen, Gruppen, Gruppe, neue Follower, Gruppe zuordnen) führen beim Schließen zurück", async () => {
  await seed();
  await rp(`var fq = function(path){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(path+"/"+id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(path){ return {id:path, collection:function(c){ return fq(path+"/"+c); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    fbDb = {collection:function(c){ return fq(c); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }};
    acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; PROF = {name:"ich", nameLower:"ich"}; FG = [{id:"g1", n:"Familie", m:["u_anna"]}];
    FR.followers = [{id:"u_anna_u_me", uid:"u_anna", name:"anna", mutual:true}, {id:"u_x_u_me", uid:"u_x", name:"xaver"}];
    FR.following = [{id:"u_me_u_anna", uid:"u_anna", name:"anna"}];
    FR.friends = FR.followers.slice(0, 1); FR.inc = FR.followers.slice(1); frTab = "fol"; frFilt = "";
    closeMenus(); openProfile(); true`);
  await page.waitForTimeout(300);
  await rp(`accView = "friends"; openSettings(); true`); await page.waitForTimeout(200);
  const onFriends = async (w) => { await page.waitForTimeout(250); ok(await rp(`!document.getElementById("acctPop").hidden && accView==="friends" && !!document.querySelector("#acctPop .fr-pills")`), w+": nicht zurück auf der Follower-Seite"); };
  // Leute suchen: × und Tipp daneben
  await tapS('#acctPop [data-act=accview][data-v="search"]'); await page.waitForTimeout(200);
  ok(await rp(`accView==="search"`), "Leute suchen öffnet nicht");
  await tapS("#acctPop .ag-x"); await onFriends("Leute suchen ×");
  await tapS('#acctPop [data-act=accview][data-v="search"]'); await page.waitForTimeout(200);
  await page.mouse.click(5, 5); await onFriends("Leute suchen daneben");
  await tapS('#acctPop [data-act=accview][data-v="search"]'); await page.waitForTimeout(200);
  await tapS('#acctPop .back[data-v="friends"]'); await onFriends("Leute suchen ‹");
  // Gruppen-Pop-up, Gruppe bearbeiten, neue Gruppe
  await tapS("#acctPop [data-act=fglist]"); await page.waitForTimeout(200);
  await tapS('#catPop [data-act=fgopen][data-g="g1"]'); await page.waitForTimeout(200);
  await tapS("#catPop .fg-card [data-act=fgcancel]"); await page.waitForTimeout(200);
  ok(await visible("#catPop .fr-pop .fg-grp"), "Gruppe × führt nicht zur Gruppenliste zurück");
  await tapS("#catPop [data-act=fgnew]"); await page.waitForTimeout(200);
  await page.mouse.click(5, 5); await page.waitForTimeout(200);
  ok(await visible("#catPop .fr-pop .fg-grp"), "Neue Gruppe daneben führt nicht zur Gruppenliste zurück");
  await tapS("#catPop .fr-pop .x"); await onFriends("Gruppen ×");
  ok(await rp(`document.getElementById("catPop").hidden`), "Gruppen-Pop-up bleibt offen");
  // Neue Follower
  await tapS("#acctPop [data-act=frreqs]"); await page.waitForTimeout(200);
  await page.mouse.click(5, 5); await onFriends("Neue Follower daneben");
  // Gruppe zuordnen am Freund
  await tapS('#acctPop [data-act=fgfor][data-uid="u_anna"]'); await page.waitForTimeout(200);
  ok(await visible("#jpMenu"), "Gruppen-Auswahl am Freund öffnet nicht");
  await page.mouse.click(5, 5); await onFriends("Gruppe zuordnen daneben");
  ok(!(await rp(`!!document.getElementById("jpMenu")`)), "Gruppen-Auswahl bleibt offen");
  // Follower-Seite selbst schließen → Profil bleibt
  await tapS("#acctPop .ag-x"); await page.waitForTimeout(200);
  ok(await rp(`document.getElementById("acctPop").hidden && profOpen`), "Follower-Seite schließen führt nicht zum Profil zurück");
  await rp(`closeProfile(); fbDb = null; FR.friends = []; FR.followers = []; FR.following = []; FR.inc = []; FG = []; true`);
});

await test("Follower: bestehende Freundschaften werden einmalig zu gegenseitigem Folgen, sonst nichts geändert", async () => {
  await seed();
  await rp(`window.__w = []; window.__snap = {}; window.__fmig = {"u_old_u_me":1};
    var REQ = [{id:"u_anna_u_me", from:"u_anna", to:"u_me", status:"accepted", fromEmail:"a@x.de", toEmail:"me@test.de", at:5},
               {id:"u_me_u_lu", from:"u_me", to:"u_lu", status:"accepted", toEmail:"lu@x.de", at:6},
               {id:"u_me_u_z", from:"u_me", to:"u_z", status:"pending", at:7},
               {id:"u_y_u_me", from:"u_y", to:"u_me", status:"pending", at:8},
               {id:"u_old_u_me", from:"u_old", to:"u_me", status:"accepted", at:9}];
    var snap = function(list){ return {docs:list.map(function(v){ var c = Object.assign({}, v), id = c.id; delete c.id; return {id:id, data:function(){ return Object.assign({}, c); }}; })}; };
    var q = function(col){ var f = null, v = null, o = {where:function(a, b, c){ f = a; v = c; return o; }, orderBy:function(){ return o; }, limit:function(){ return o; }, get:function(){ return Promise.resolve({docs:[]}); },
      onSnapshot:function(cb){ var k = col+":"+f; __snap[k] = function(list){ cb(snap(list.filter(function(r){ return r[f]===v; }))); }; if(col==="friendReqs") setTimeout(function(){ __snap[k](REQ); }, 0); else setTimeout(function(){ __snap[k]([]); }, 0); return function(){}; },
      doc:function(id){ return d(col, id); }}; return o; };
    var d = function(col, id){ return {id:id, collection:function(c){ return q(col+"/"+id+"/"+c); }, get:function(){ return Promise.resolve({exists: col==="fmig" ? !!__fmig[id] : false, data:function(){ return {}; }}); }, set:function(v){ __w.push(["set", col+"/"+id, v]); return Promise.resolve(); }, update:function(v){ __w.push(["upd", col+"/"+id, v]); return Promise.resolve(); }, delete:function(){ __w.push(["del", col+"/"+id]); return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }, __p:col+"/"+id}; };
    fbDb = {collection:function(c){ return q(c); }, batch:function(){ var ops = []; return {set:function(ref, v){ ops.push(["bset", ref.__p, v]); }, update:function(){}, delete:function(){}, commit:function(){ ops.forEach(function(o){ __w.push(o); }); return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }};
    frStop(); acct.user = {uid:"u_me", email:"me@test.de"}; chWatch = function(){}; fgWatch = function(){}; frWatch(); true`);
  await page.waitForTimeout(400);
  const W = await rp(`JSON.stringify(__w)`);
  const has = (p, f) => rp(`__w.some(function(w){ return w[0]==="bset" && w[1]===${JSON.stringify(p)} && (${f || "true"}); })`);
  ok(await has("follows/u_anna_u_me", `w[2].from==="u_anna" && w[2].to==="u_me" && w[2].mig==="u_anna_u_me" && w[2].fromEmail==="a@x.de"`), "Anna folgt mir nicht: "+W);
  ok(await has("follows/u_me_u_anna", `w[2].from==="u_me" && w[2].fromEmail==="me@test.de"`), "Ich folge Anna nicht: "+W);
  ok(await has("fmig/u_anna_u_me") && await has("follows/u_me_u_lu") && await has("follows/u_lu_u_me") && await has("fmig/u_me_u_lu"), "Zweite Freundschaft nicht umgewandelt: "+W);
  ok(await has("follows/u_me_u_z", `w[2].st==="req"`) && !(await has("follows/u_z_u_me")), "Offene eigene Anfrage nicht zur Anfrage zum Folgen: "+W);
  ok(await has("follows/u_y_u_me", `w[2].st==="req"`) && !(await has("follows/u_me_u_y")), "Offene Anfrage an mich nicht zur Anfrage zum Folgen: "+W);
  ok(!(await rp(`__w.some(function(w){ return /u_old/.test(w[1]); })`)), "Schon umgewandelte Freundschaft erneut angelegt: "+W);
  ok(await rp(`__w.every(function(w){ return w[0]==="bset" && /^(follows|fmig)\\//.test(w[1]); })`), "Andere Daten verändert: "+W);
  // Wenn die Folgen-Dokumente da sind: Freunde = gegenseitig
  await rp(`var F = [{id:"u_anna_u_me", from:"u_anna", to:"u_me", fromEmail:"a@x.de", mig:"x", at:5}, {id:"u_me_u_anna", from:"u_me", to:"u_anna", fromEmail:"me@test.de", at:5}, {id:"u_y_u_me", from:"u_y", to:"u_me", at:8, st:"req"}, {id:"u_me_u_z", from:"u_me", to:"u_z", at:7, st:"req"}];
    __snap["follows:to"](F); __snap["follows:from"](F); true`);
  await page.waitForTimeout(150);
  ok(await rp(`FR.friends.length===1 && FR.friends[0].uid==="u_anna" && FR.friends[0].email==="a@x.de" && FR.followers.length===1 && FR.following.length===1 && FR.inc.length===1 && FR.inc[0].uid==="u_y" && FR.out.length===1 && FR.out[0].uid==="u_z" && frState("u_z")==="requested" && frState("u_y")==="inc"`), "Listen falsch: "+await rp(`JSON.stringify(FR)`));
  await rp(`frStop(); fbDb = null; true`);
});

const wmFullTest = async (n, vp) => {
  await seed();
  await rp(`acct.user = acct.user || {uid:"u_me", email:"me@test.de"}; profTab = "welt"; openProfile(); true`); await page.waitForTimeout(800);
  const bx = await page.locator("#profView .wm-box").boundingBox();
  ok(n==="quer" || (bx.height >= 220 && bx.height <= 340), "Weltkarte zu klein oder zu groß: "+bx.height);
  ok(n==="quer" || bx.height < vp.height * 0.45, "Weltkarte nimmt zu viel Höhe ein");
  ok(await visible("#profView .wm-box .wm-stats") && await visible("#profView .wm-box .wm-fs"), "Zahlen oder Vollbild-Knopf fehlen auf der Karte");
  ok(await rp(`var c = PFMAP && PFMAP.getCanvas(), b = document.querySelector("#profView .wm-box"); !!c && Math.abs(c.clientHeight - b.clientHeight) < 3`), "Karte füllt den Rahmen nicht");
  await shot("weltkarte-"+n);
  await page.tap("#profView .wm-fs"); await page.waitForTimeout(400);
  const fb = await page.locator("#profView .wm-box").boundingBox();
  ok(Math.abs(fb.x) < 1 && Math.abs(fb.y) < 1 && Math.abs(fb.width - vp.width) < 2 && Math.abs(fb.height - vp.height) < 2, "Kein Vollbild: "+JSON.stringify(fb));
  const top = await page.evaluate(() => { const b = document.querySelector("#profView .wm-fs").getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2); return e && e.closest(".wm-fs") ? "" : (e ? (e.id || e.className || e.tagName) + "/" + ((e.closest("[id]")||{}).id||"") : "nichts"); });
  ok(!top, "Vollbild-Knopf verdeckt von "+top);
  ok(await rp(`var c = PFMAP && PFMAP.getCanvas(); !!c && Math.abs(c.clientHeight - window.innerHeight) < 3`), "Karte füllt das Vollbild nicht");
  await shot("weltkarte-voll-"+n);
  await page.tap("#profView .wm-fs"); await page.waitForTimeout(300);
  const bb = await page.locator("#profView .wm-box").boundingBox();
  ok(Math.abs(bb.height - bx.height) < 2, "Vollbild lässt sich nicht verlassen");
  await rp(`closeProfile(); true`);
};
await test("Profil: Weltkarte groß, Zahlen auf der Karte, Vollbild an und aus", async () => { await wmFullTest("hoch", {width:390, height:844}); });
await test("Profil: Weltkarte Vollbild im Querformat", async () => { await wmFullTest("quer", {width:844, height:390}); }, QUER);

await test("Lösch-X sitzt im Suchfeld, auch nach Scrollen (Profil → Ziele, Suche)", async () => {
  await seed();
  const xIn = async (fld, what) => {
    const f = await page.locator(fld).first().boundingBox(), x = await page.locator("#clrX").boundingBox();
    ok(x && await visible("#clrX"), what+": X fehlt");
    const cx = x.x + x.width/2, cy = x.y + x.height/2;
    ok(cx > f.x + f.width - 40 && cx < f.x + f.width && Math.abs(cy - (f.y + f.height/2)) <= 3, what+": X verschoben "+JSON.stringify([f, x]));
  };
  await rp(`zielNew("Lissabon", {id:"o1", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); save(); openZiele(); true`); await page.waitForTimeout(300);
  const zl = "#profView #zLink";
  ok(await page.locator(zl).count()===1, "Linkfeld im Profil fehlt");
  await page.locator(zl).fill("Lissabon"); await page.waitForTimeout(500);
  await xIn(zl, "Ziele");
  await page.evaluate(() => { const v = document.querySelector("#profView"); const sc = [v].concat([].slice.call(v.querySelectorAll("*"))).find(e => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if(sc){ sc.scrollTop += 60; sc.dispatchEvent(new Event("scroll")); } });
  await page.waitForTimeout(200);
  if(await page.locator(zl).isVisible()) await xIn(zl, "Ziele nach Scrollen");
  await shot("loesch-x-ziele");
  await rp(`closeProfile(); openSearch(); true`); await page.waitForTimeout(300);
  const sf = "#srchPop input[type=search]";
  await page.locator(sf).first().fill("Katz"); await page.waitForTimeout(400);
  await xIn(sf, "Suche");
});

await test("Liste: Reise-Auswahl als Dropdown mit Suche statt Chips (30 Reisen), vergangene im eigenen Pop-up", async () => {
  await seed();
  await rp(`(function(){ var N = ["Lissabon","Tokio","New York","Rom","Paris"]; for(var i = 0; i < 30; i++){ var y = i < 20 ? 2000 + i : 2007 + i, nm = i < 5 ? N[i] : "Reise "+(i+1);
      var t = newTripObj({id:"t_r"+i, name:nm, start:y+"-05-01", end:y+"-05-08", hotels:[], orte:[]}); S.trips[t.id] = t; } save(); openLsPage(); return true; })()`);
  await page.waitForTimeout(300);
  ok(await page.locator("#lsView .ls-trips button").count()===0, "Reisen stehen noch als Chips nebeneinander");
  ok(await page.locator("#lsView .ls-tripdd").count()===1, "Dropdown für die Reise fehlt");
  ok((await page.locator("#lsView .ls-tripdd").innerText()).includes("Testreise"), "Dropdown zeigt die aktuelle Reise nicht");
  const bb = await page.locator("#lsView .ls-tripdd").boundingBox(); ok(bb.height < 50, "Dropdown zu hoch: "+bb.height);
  await page.tap("#lsView .ls-tripdd"); await page.waitForTimeout(250);
  ok(await page.locator("#jpMenu .frp-q").count()===1, "Suche im Dropdown fehlt");
  ok(await page.locator("#jpMenu [data-act=lstrip]").count()===10 && await page.locator("#jpMenu .tm-cur").count()===1, "Dropdown soll gewählte Reise oben + übrige laufende/kommende Reisen zeigen: "+await page.locator("#jpMenu [data-act=lstrip]").count());
  ok(await page.locator("#jpMenu [data-act=lstrip][data-trip=t_r1]").count()===0, "Vergangene Reise steht direkt im Dropdown");
  ok(await page.locator("#jpMenu [data-act=scopepop][data-k=past]").count()===1 && (await page.locator("#jpMenu [data-act=scopepop][data-k=past]").innerText()).includes("20"), "Knopf „Vergangene Reisen“ fehlt");
  const mb = await page.locator("#jpMenu").boundingBox(); ok(mb.y + mb.height <= 844 && mb.height <= 480, "Dropdown zu groß: "+JSON.stringify(mb));
  await page.locator("#jpMenu .frp-q").fill("reise 25"); await page.waitForTimeout(100);
  const vis = await page.evaluate(() => [].slice.call(document.querySelectorAll("#jpMenu [data-act=lstrip]")).filter(b => !b.hidden).map(b => b.getAttribute("data-trip")));
  ok(vis.length===1 && vis[0]==="t_r24", "Suche findet nicht nur „Reise 25“: "+vis.join(","));
  await page.locator("#jpMenu .frp-q").fill("");
  await click("#jpMenu [data-act=scopepop][data-k=past]");
  ok(await visible("#catPop .scpop") && await page.locator("#jpMenu").count()===0, "Pop-up „Vergangene Reisen“ öffnet nicht");
  ok(await page.locator("#catPop [data-act=scopeset]").count()===20, "nicht alle vergangenen Reisen: "+await page.locator("#catPop [data-act=scopeset]").count());
  ok(await page.locator("#catPop [data-act=scopeset]").first().getAttribute("data-v")==="t_r19", "Neueste vergangene Reise steht nicht oben");
  await page.locator("#catPop .sc-q").fill("tok"); await page.waitForTimeout(100);
  const vis2 = await page.evaluate(() => [].slice.call(document.querySelectorAll("#catPop [data-act=scopeset]")).filter(b => !b.hidden).map(b => b.getAttribute("data-v")));
  ok(vis2.length===1 && vis2[0]==="t_r1", "Suche „tok“ findet nicht nur Tokio: "+vis2.join(","));
  await page.locator("#catPop .sc-q").fill("xyz"); await page.waitForTimeout(100);
  ok((await page.locator("#catPop").innerText()).includes("Keine Reise gefunden"), "Hinweis bei leerer Suche fehlt");
  await page.locator("#catPop .sc-q").fill("tok"); await page.waitForTimeout(100);
  await shot("liste-vergangene-reisen");
  await page.locator("#catPop [data-v=t_r1]").click(); await page.waitForTimeout(300);
  ok(await rp(`S.cur`)==="t_r1", "Auswahl wechselt die Reise nicht");
  ok(!(await visible("#catPop")), "Pop-up bleibt nach der Auswahl offen");
  ok((await page.locator("#lsView .ls-tripdd").innerText()).includes("Tokio"), "Dropdown zeigt die neue Reise nicht");
});

await test("Ziele: in Karte, Liste und Entdecken auswählbar (Knopf mit Such-Pop-up), vergangene Reisen nicht direkt gelistet", async () => {
  await seed();
  await rp(`(function(){
    var r = newTripObj({id:"t_rom", name:"Rom 2020", start:"2020-05-01", end:"2020-05-05", hotels:[], orte:[{id:"o1", n:"Rom", la:41.9, lo:12.5, from:"2020-05-01", to:"2020-05-05"}]});
    r.places.v1 = {id:"v1", n:"Kolosseum", c:"sight", la:41.8902, lo:12.4922, list:"l_main", note:""}; r.order["2020-05-02"] = ["v1"]; r.done = {v1:1}; S.trips.t_rom = r;
    var z = zielNew("Rom", {id:"o1", n:"Rom", la:41.9, lo:12.5, r:30000}); zielAdd(z, {n:"Trattoria Roma", c:"essen", la:41.9, lo:12.5});
    zielNew("Lissabon", {id:"o2", n:"Lissabon", la:38.72, lo:-9.14, r:20000}); save(); renderAll(); return true; })()`);
  // Karte: Reise-Menü
  await click("#tripBtn");
  const tm = await page.locator("#tripMenu").innerText();
  ok(tm.includes("Testreise") && !tm.includes("Rom 2020"), "Reise-Menü: abgeschlossene Reise steht direkt in der Liste: "+tm);
  ok(await page.locator("#tripMenu [data-act=scopepop][data-k=z]").count()===1 && await page.locator("#tripMenu [data-act=scopepop][data-k=past]").count()===1, "Knöpfe „Ziele“/„Vergangene Reisen“ fehlen im Reise-Menü");
  await shot("ziele-reisemenue");
  await click("#tripMenu [data-act=scopepop][data-k=z]");
  ok(await visible("#catPop .scpop") && await rp(`$("tripMenu").hidden`), "Ziele-Pop-up öffnet nicht");
  ok(await page.locator("#catPop [data-act=scopeset]").count()===2, "nicht alle Ziele im Pop-up");
  await page.locator("#catPop .sc-q").fill("rom"); await page.waitForTimeout(100);
  await shot("ziele-popup");
  ok(await page.evaluate(() => [].slice.call(document.querySelectorAll("#catPop [data-act=scopeset]")).filter(b => !b.hidden).length)===1, "Ziel-Suche filtert nicht");
  await page.locator("#catPop [data-act=scopeset]:not([hidden])").click(); await page.waitForTimeout(400);
  ok(await rp(`zsOn()===zielIds().filter(function(id){ return S.trips[id].name==="Rom"; })[0] && S.cur==="t_test"`), "Ziel nicht gewählt oder aktive Reise verändert");
  ok((await page.locator("#tripBtn").innerText()).includes("Rom"), "Kopfzeile zeigt das Ziel nicht");
  const sb = await page.locator("#body").textContent();
  ok(sb.includes("Gemerkt · 1") && sb.includes("Trattoria Roma") && sb.includes("Besucht auf Reisen · 1") && sb.includes("Kolosseum"), "Blatt zeigt die Orte des Ziels nicht: "+sb);
  ok(!(await visible("#sheet .tabs")) && await rp(`$("rail").hidden`), "Tagesplan-Reiter/Tagesleiste noch sichtbar");
  await page.waitForTimeout(700);
  ok(await rp(`ZSMK.length`)===2, "Karte zeigt nicht beide Orte des Ziels: "+await rp(`ZSMK.length`));
  ok(await page.locator("#ov text", {hasText:"Katz Deli"}).count()===0, "Karte zeigt noch Stopps der Reise");
  await shot("ziel-auf-karte");
  await page.locator("#body [data-act=zsgo]", {hasText:"Trattoria"}).click(); await page.waitForTimeout(300);
  ok(await rp(`sel==="poi" && poiSel && poiSel.n==="Trattoria Roma" && !!poiSel.zr`), "Antippen zeigt den gemerkten Ort nicht");
  await rp(`select(null); true`);
  // Liste: dasselbe Ziel, Auswahl über das Dropdown
  await rp(`openLsPage(); true`); await page.waitForTimeout(250);
  ok((await page.locator("#lsView .ls-tripdd").innerText()).includes("Rom") && (await page.locator("#lsView").innerText()).includes("Kolosseum"), "Liste zeigt das Ziel nicht");
  await page.tap("#lsView .ls-tripdd"); await page.waitForTimeout(250);
  ok(await page.locator("#jpMenu [data-act=lstrip][data-trip=t_rom]").count()===0 && await page.locator("#jpMenu [data-act=scopepop][data-k=z]").count()===1, "Listen-Dropdown: vergangene Reise direkt oder Ziele-Knopf fehlt");
  await click("#jpMenu [data-act=scopepop][data-k=z]");
  await page.locator("#catPop [data-act=scopeset]", {hasText:"Lissabon"}).click(); await page.waitForTimeout(300);
  ok((await page.locator("#lsView .ls-tripdd").innerText()).includes("Lissabon") && (await page.locator("#lsView").textContent()).includes("Gemerkt · 0"), "Liste wechselt nicht aufs gewählte Ziel");
  await page.tap("#lsView .ls-tripdd"); await page.waitForTimeout(250);
  await click("#jpMenu [data-act=lstrip][data-trip=t_test]");
  ok(await rp(`!zsOn() && S.cur==="t_test"`) && (await page.locator("#lsView .ls-tripdd").innerText()).includes("Testreise"), "Zurück zur Reise klappt nicht");
  // vergangene Reise über das Pop-up öffnen
  await page.tap("#lsView .ls-tripdd"); await page.waitForTimeout(250);
  await click("#jpMenu [data-act=scopepop][data-k=past]");
  await click("#catPop [data-v=t_rom]");
  ok(await rp(`S.cur==="t_rom"`), "Vergangene Reise lässt sich nicht öffnen");
  await rp(`closeLsPage(); S.cur = "t_test"; save(); renderAll(); true`);
  // Entdecken: Reisen direkt, Ziele und vergangene Reisen über Knöpfe
  await rp(`openDcPage(); true`); await page.waitForTimeout(300);
  await click("#dcView [data-act=dctgt]");
  const dm = await page.locator("#jpMenu").innerText();
  await shot("entdecken-auswahl");
  ok(dm.includes("Testreise") && !dm.includes("Rom 2020") && !dm.includes("Lissabon"), "Entdecken-Auswahl listet Ziele/vergangene Reisen direkt: "+dm);
  ok(await page.locator("#jpMenu [data-act=scopepop][data-k=z]").count()===1 && await page.locator("#jpMenu [data-act=scopepop][data-k=past]").count()===1, "Knöpfe fehlen in Entdecken");
  await click("#jpMenu [data-act=scopepop][data-k=z]");
  await page.locator("#catPop [data-act=scopeset]", {hasText:"Lissabon"}).click(); await page.waitForTimeout(300);
  ok(await rp(`S.trips[dcScope] && S.trips[dcScope].name==="Lissabon"`) && (await page.locator("#dcView .dc-tgt").innerText()).includes("Lissabon"), "Entdecken übernimmt das Ziel nicht");
  ok(await rp(`!zsOn()`), "Auswahl in Entdecken ändert die Karte");
});

await test("Bewegung: Pop-up geht am Knopf auf, schließt sofort ohne Zucken, Seiten mit Richtung", async () => {
  await seed(); await rp(`select("p6")`); await page.waitForTimeout(200);
  await click("#card [data-act=planpick]");
  const o = await page.evaluate(() => { const e = document.getElementById("planPop"), c = e.firstElementChild; return {fx:e.classList.contains("fx-in"), dx:c.style.getPropertyValue("--fxdx"), s:c.style.getPropertyValue("--fxs")}; });
  ok(o.fx && o.s===".78" && o.dx!=="", "Pop-up geht nicht am Knopf auf: "+JSON.stringify(o));
  await page.waitForTimeout(500);
  ok(await rp(`!$("planPop").classList.contains("fx-in")`), "Einblend-Klasse bleibt hängen (Neuzeichnen würde wieder animieren)");
  await page.locator("#planPop [data-act=plancancel]").click();
  // Schließen: sofort weg, keine ausblendende Kopie (die tauchte auf dem iPhone kurz wieder auf = Zucken)
  const g = await page.evaluate(() => ({orig:document.getElementById("planPop").hidden, ghosts:document.querySelectorAll("#fxL > *").length}));
  ok(g.orig && g.ghosts===0, "Pop-up zuckt beim Schließen (Kopie): "+JSON.stringify(g));
  await page.locator("#tbProf").click(); await page.waitForTimeout(450);
  await page.locator("#tbMap").click();
  ok(await page.evaluate(() => document.querySelectorAll("#fxL > :not(.fx-pgbg)").length)===0, "Seite hinterlässt Inhalts-Kopie");
  await page.waitForTimeout(350);
  // Seiten: Profil → Entdecken (Reiter weiter links) gleitet von links, die leere Fläche des Profils entfällt sofort
  await rp(`openProfile()`); await page.waitForTimeout(450);
  await click("#tbDisc");
  const pg = await page.evaluate(() => ({c:document.getElementById("dcView").classList.contains("fx-pgc"), x:document.getElementById("dcView").style.getPropertyValue("--fxx"), bg:document.querySelectorAll("#fxL .fx-pgbg").length}));
  ok(pg.c && pg.x==="-28px" && pg.bg===0, "Seitenwechsel ohne Richtung: "+JSON.stringify(pg));
  await click("#tbChat");
  ok(await rp(`$("chView").style.getPropertyValue("--fxx")`)==="28px", "Reiter weiter rechts gleitet nicht von rechts");
  // Bewegung reduzieren: keine Kopien, keine Klassen
  await page.emulateMedia({reducedMotion:"reduce"});
  await click("#tbMap"); await rp(`select("p6")`); await page.waitForTimeout(200);
  await click("#card [data-act=planpick]");
  ok(await rp(`!$("planPop").classList.contains("fx-in")`), "Bewegung trotz „Bewegung reduzieren“");
  await click("#planPop [data-act=plancancel]");
  ok(await page.evaluate(() => document.getElementById("fxL").children.length)===0, "Kopie trotz „Bewegung reduzieren“");
});

await test("Bewegung: Foto fliegt aus dem Vorschaubild ins Vollbild und zurück, Ränder mit weichem Foto", async () => {
  await seed();
  await rp(`openJPop("p4", dayOf("p4"))`); await page.waitForTimeout(500);
  const rec = () => page.evaluate(() => new Promise(res => { const ws = []; const t0 = performance.now(); (function f(){ const e = document.querySelector(".fx-fly"); if(e) ws.push(Math.round(e.getBoundingClientRect().width)); if(performance.now() - t0 < 900) requestAnimationFrame(f); else res(ws); })(); }));
  let r = rec(); await page.locator("#jPop [data-act=phview]").first().click(); let ws = await r, la = await rp(`FX.last`);
  ok(ws.length && la && la.d==="in" && la.from < 120 && la.to > 300, "Foto fliegt nicht aus dem Vorschaubild: "+JSON.stringify(la)+" "+ws.join(","));
  // unter Last (parallele Testprozesse) kann der Flug länger dauern: auf das Aufräumen warten statt fester Zeit
  await page.waitForFunction(() => window.__rp(`!$("pvLayer").classList.contains("fx-flying") && !document.querySelector(".fx-fly")`), null, {timeout:4000}).catch(() => {});
  ok(await rp(`!$("pvLayer").classList.contains("fx-flying") && !document.querySelector(".fx-fly")`), "Flug räumt nicht auf");
  ok(await rp(`!!document.querySelector("#pvLayer .pv-amb[src]")`), "Weicher Fotohintergrund fehlt");
  r = rec(); await click("#pvLayer [data-act=phback]"); ws = await r; la = await rp(`FX.last`);
  ok(ws.length && la.d==="out" && la.from > 300 && la.to > 0 && la.to < 120, "Foto fliegt nicht zurück: "+JSON.stringify(la)+" "+ws.join(","));
  ok(await rp(`[].every.call(document.querySelectorAll("#jPop img[data-ph]"), function(i){ return !i.style.visibility; }) && !document.querySelector("#fxL > *")`), "Vorschaubild bleibt versteckt oder Reste bleiben");
  // herunterziehen: fliegt ebenfalls zurück
  await page.locator("#jPop [data-act=phview]").first().click(); await page.waitForTimeout(700);
  ok(await visible("#pvLayer"), "Foto öffnet nach dem Zurückfliegen nicht erneut");
  const cdp = await page.context().newCDPSession(page);
  await rp(`FX.last = null`);
  await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:200, y:420}]});
  for(const d of [20, 60, 120, 180, 220]){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:200, y:420 + d}]}); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
  await page.waitForFunction(() => window.__rp("FX.last"), null, {timeout:3000}).catch(() => {});
  ok(await rp(`$("pvLayer").hidden && !$("pvLayer").style.background`), "Herunterziehen schließt nicht sauber: "+JSON.stringify(await rp(`[$("pvLayer").hidden, $("pvLayer").style.background, FX.last]`)));
  la = await rp(`FX.last`);
  ok(la && la.d==="out" && la.to > 0 && la.to < 120 && la.from < 390, "Nach dem Herunterziehen fliegt das Foto nicht zurück: "+JSON.stringify(la));
});

await test("Foto-Ansicht: Runterziehen wie in Apple Fotos – Foto folgt dem Finger, wird kleiner, Hintergrund blendet aus, federt zurück", async () => {
  await seed();
  await rp(`openJPop("p4", dayOf("p4"))`); await page.waitForTimeout(400);
  await page.locator("#jPop [data-act=phview]").first().click();
  await page.waitForFunction(() => window.__rp(`!$("pvLayer").hidden && !$("pvLayer").classList.contains("fx-flying")`), null, {timeout:4000}).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  const T = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {type, touchPoints:type==="touchEnd" ? [] : [{x, y}]});
  // schräg nach unten ziehen: Foto folgt auch seitlich, wird kleiner, Hintergrund und Knöpfe blenden aus
  await T("touchStart", 200, 400);
  for(const [x, y] of [[204, 414], [215, 440], [235, 480], [250, 520]]){ await T("touchMove", x, y); await page.waitForTimeout(20); }
  await page.waitForTimeout(60);
  const mid = await page.evaluate(() => { const tr = document.getElementById("pvTrack"), m = new DOMMatrix(getComputedStyle(tr).transform), L = document.getElementById("pvLayer");
    const a = /rgba\([^)]*,\s*([\d.]+)\)/.exec(L.style.background || ""), ch = L.querySelector(".pv-wrap > :not(.pv-track)");
    return {tx:Math.round(m.e), ty:Math.round(m.f), sc:+m.a.toFixed(2), bg:a ? +a[1] : 1, ch:ch ? +ch.style.opacity : null}; });
  ok(mid.tx > 30 && mid.ty > 90 && mid.sc < 0.95 && mid.bg < 0.8 && mid.ch!==null && mid.ch < 0.5, "Foto folgt beim Ziehen nicht frei / wird nicht kleiner / Hintergrund bleibt: "+JSON.stringify(mid));
  // langsam zurück und loslassen: federt zurück, nichts bleibt hängen
  for(const [x, y] of [[230, 470], [210, 430], [202, 418]]){ await T("touchMove", x, y); await page.waitForTimeout(30); }
  await page.waitForTimeout(200); await T("touchEnd");
  await page.waitForTimeout(600);
  ok(await rp(`!$("pvLayer").hidden && !$("pvTrack").style.transform && !$("pvLayer").style.background && [].every.call(document.querySelectorAll("#pvLayer .pv-wrap > *"), function(n){ return !n.style.opacity; })`),
    "Zurückfedern lässt Reste oder schließt: "+JSON.stringify(await rp(`[$("pvLayer").hidden, $("pvTrack").style.transform, $("pvLayer").style.background]`)));
  // schneller kurzer Wisch nach unten: Schwung schließt
  // (im Seitenkontext mit echtem Zeitabstand, CDP-Ereignisse kommen im Testbrowser zu langsam für einen echten Schwung)
  await page.evaluate(async () => { const el = document.querySelector("#pvTrack img") || document.getElementById("pvTrack"), w = (ms) => new Promise(r => setTimeout(r, ms));
    const ev = (type, y) => { const t = new Touch({identifier:7, target:el, clientX:200, clientY:y}); el.dispatchEvent(new TouchEvent(type, {touches:type==="touchend" ? [] : [t], changedTouches:[t], bubbles:true, cancelable:true})); };
    ev("touchstart", 400); for(const y of [412, 430, 455, 480]){ await w(14); ev("touchmove", y); } await w(10); ev("touchend", 480); });
  await page.waitForFunction(() => window.__rp(`$("pvLayer").hidden`), null, {timeout:3000}).catch(() => {});
  ok(await rp(`$("pvLayer").hidden`), "Schneller Wisch schließt nicht: "+JSON.stringify(await rp(`FX.last`)));
  // Chat-Foto: Runterziehen schließt ebenso
  await rp(`chGal(["ph_a"], 0, {n:"Brooklyn Bridge", trip:"Testreise"})`); await page.waitForTimeout(200);
  await T("touchStart", 200, 400);
  for(const [x, y] of [[205, 420], [215, 470], [225, 540], [230, 600]]){ await T("touchMove", x, y); await page.waitForTimeout(16); }
  const cm = await page.evaluate(() => { const sl = document.querySelectorAll("#chPhView .chpv-sl")[1]; const m = new DOMMatrix(getComputedStyle(sl).transform); return {tx:Math.round(m.e), sc:+m.a.toFixed(2)}; });
  ok(cm.tx > 10 && cm.sc < 0.9, "Chat-Foto folgt dem Finger nicht: "+JSON.stringify(cm));
  await T("touchEnd");
  await page.waitForFunction(() => window.__rp(`$("chPhView").hidden`), null, {timeout:3000}).catch(() => {});
  ok(await rp(`$("chPhView").hidden && !$("chPhView").style.background`), "Chat-Foto schließt nicht sauber");
});

await test("Bewegung: Wischen unter den Reitern wechselt den Reiter (Profil, Liste)", async () => {
  await seed(); await rp(`openProfile()`); await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (x0, x1, y) => { await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:x0, y}]});
    for(let i = 1; i <= 6; i++){ await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:x0 + (x1-x0)*i/6, y:y + i}]}); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); await page.waitForTimeout(400); };
  const y = await page.evaluate(() => Math.round(document.querySelector("#profView [role=tablist]").getBoundingClientRect().bottom + 60));
  ok(await rp(`profTab`)==="mine", "Start nicht bei Reisen");
  await swipe(300, 100, y);
  ok(await rp(`profTab`)==="obs", "Nach links wischen wechselt nicht zu „Beobachtet“: "+await rp(`profTab`));
  await swipe(100, 300, y);
  ok(await rp(`profTab`)==="mine", "Nach rechts wischen führt nicht zurück");
  await swipe(100, 300, y);
  ok(await rp(`profTab`)==="mine", "Am ersten Reiter darf Wischen nichts ändern");
  // kurzer Zug: bleibt, Inhalt springt zurück
  await swipe(250, 210, y);
  ok(await rp(`profTab`)==="mine" && await page.evaluate(() => [].every.call(document.querySelectorAll("#profView > *"), n => !n.style.transform)), "Kurzer Zug wechselt oder lässt Verschiebung zurück");
  // senkrecht: kein Wechsel
  await cdp.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:200, y}]});
  for(const d of [20, 50, 90]) { await cdp.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:205, y:y + d}]}); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]}); await page.waitForTimeout(300);
  ok(await rp(`profTab`)==="mine", "Senkrechtes Wischen wechselt den Reiter");
  // angetippt: Auswahl gleitet, Inhalt kommt aus der Richtung des Reiters
  const plw = page.waitForFunction(() => document.querySelectorAll("#profView .fx-pill").length===1 && !!document.querySelector("#profView .fx-seg"), null, {polling:"raf", timeout:2000}).then(() => true, () => false);
  await page.locator("#profView [role=tab][data-v=ziele]").click();
  ok(await plw, "Auswahl gleitet nicht");
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => !document.querySelector(".fx-pill,.fx-seg")), "Gleit-Auswahl bleibt zurück");
  await rp(`openLsPage()`); await page.waitForTimeout(400);
  const ly = await page.evaluate(() => Math.round(document.querySelector("#lsView [role=tablist]").getBoundingClientRect().bottom + 80));
  const t0 = await page.evaluate(() => document.querySelector("#lsView [role=tab][aria-selected=true]").getAttribute("data-v"));
  await swipe(300, 100, ly);
  const t1 = await page.evaluate(() => document.querySelector("#lsView [role=tab][aria-selected=true]").getAttribute("data-v"));
  ok(t0!==t1, "Wischen in der Liste wechselt den Reiter nicht: "+t0+" → "+t1);
});

await test("Design: Seiten der Leiste als mattes Glas, darunter keine Knöpfe als Schemen, Chats deckend", async () => {
  await seed(); await rp(`openProfile()`); await page.waitForTimeout(400);
  const g = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById("profView")); return {bg:cs.backgroundColor, bf:cs.backdropFilter || cs.webkitBackdropFilter || ""}; });
  ok(/blur/.test(g.bf) && /(rgba|color\(srgb|oklab|color-mix)/.test(g.bg) && !/, 1\)$/.test(g.bg), "Profil ist kein mattes Glas: "+JSON.stringify(g));
  ok(await page.evaluate(() => ["sheet", "ctrl"].every(id => getComputedStyle(document.getElementById(id)).visibility==="hidden")), "Planung/Knöpfe scheinen unter der Seite durch");
  await click("#tbMap");
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("sheet")).visibility==="visible"), "Planung nach dem Schließen der Seite unsichtbar");
  await rp(`openChPage()`); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !/blur/.test(getComputedStyle(document.getElementById("chView")).backdropFilter || "")), "Chats sollen deckend bleiben");
});

await test("Leiste: erneutes Antippen eines Knopfs bleibt auf der Seite (kein Sprung zur Karte), scrollt nach oben", async () => {
  await seed(); await rp(`$("bellBtn").hidden = false; true`); // Glocke erscheint sonst erst mit Konto
  for(const [btn, view, flag] of [["#tbProf","profView","profOpen"],["#tbList","lsView","lsPage"],["#tbDisc","dcView","dcPage"],["#tbSearch","gsView","gsPage"],["#tbChat","chView","chPage"],["#bellBtn","ntView","ntPage"]]){
    try { await page.locator(btn).click({timeout:4000}); } catch(e){ throw new Error(btn+" (1): "+e.message.split("\n").slice(0,6).join(" / ")); } await page.waitForTimeout(500);
    ok(await rp(flag)===true, btn+" öffnet die Seite nicht");
    await page.evaluate((v) => { const e = document.getElementById(v); e.insertAdjacentHTML("beforeend", "<div class=\"tsPad\" style=\"height:3000px\"></div>"); e.scrollTop = 600; }, view);
    try { await page.locator(btn).click({timeout:4000}); } catch(e){ throw new Error(btn+" (2): "+e.message.split("\n").slice(0,6).join(" / ")); } await page.waitForTimeout(900);
    const r = await page.evaluate((v) => ({open:!document.getElementById(v).hidden, st:document.getElementById(v).scrollTop}), view);
    ok(r.open && await rp(flag)===true, btn+": erneutes Antippen schließt die Seite (Sprung zur Karte)");
    ok(r.st===0, btn+": Seite nicht nach oben gescrollt: "+r.st);
    await page.evaluate((v) => document.querySelectorAll("#"+v+" .tsPad").forEach(e => e.remove()), view);
  }
  await page.locator("#tbMap").click(); await page.waitForTimeout(300);
  ok(await rp(`!profOpen && !lsPage && !dcPage && !gsPage && !chPage && !ntPage`), "Karten-Knopf schließt die Seiten nicht");
});

await test("Empfehlungen: gemeinsame Reise – nur wer veröffentlicht hat, gibt den Ort als eigene Empfehlung weiter", async () => {
  await seed();
  // Mitreisende(r) in einer fremden Reise: Ort p4 von „u_owner“ veröffentlicht, p5 von mir, p1 alt (1) → zählt für den Besitzer
  await rp(`T().done.p1 = 1; T().pubP = {p4:"u_owner", p5:"u_me", p1:1}; T().notes = {p4:"Notiz vom Besitzer"}; KNOWN.t_test = 1;
    META.t_test = {owner:"u_owner", members:["u_owner","u_me"], viewers:[]}; true`);
  ok(await rp(`var r = recCollect(); !r.t_test_p4 && !!r.t_test_p5 && !r.t_test_p1`), "Mitreisende(r) veröffentlicht fremde Orte als eigene Empfehlung");
  // als Besitzer: alte Markierung (1) gilt als eigene
  await rp(`META.t_test.owner = "u_me"; true`);
  ok(await rp(`var r = recCollect(); !!r.t_test_p1 && !!r.t_test_p5 && !r.t_test_p4`), "Besitzer: alte Veröffentlichung fehlt");
  // setVis merkt sich, wer veröffentlicht hat
  await rp(`delete META.t_test; T().pubP = {}; T().privP = {}; setVis("p4", "pub"); true`); await page.waitForTimeout(200);
  if(await visible("#pubPop")) await click("#pubPop .pub-ok");
  ok(await rp(`T().pubP.p4==="u_me"`), "Veröffentlicher nicht gespeichert");
});

await test("3D-Karte: Knopf bei Suche und Plus erst ab Zoomstufe, Standard 3D kippt beim Hineinzoomen, 2D/3D umschaltbar und gemerkt", async () => {
  // ohne Animation: geneigte Karte rendert im Test-Chromium zäh
  await seed(); await rp(`reduceMotion = true; lsSet("rp-3dv", ""); v3d = true; v3dDone = false; map.jumpTo({center:[-73.985, 40.758], zoom:12, pitch:0}); true`);
  await page.waitForTimeout(300);
  const pos = async () => { await page.evaluate(() => Promise.all(document.getElementById("b3dBtn").getAnimations().map(a => a.finished))); return page.evaluate(() => { const q = id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }; return {s:q("srchBtn"), c:q("camBtn"), t:q("tripBtn"), b:q("b3dBtn"), h:document.getElementById("b3dBtn").hidden}; }); };
  const p0 = await pos(); ok(p0.h, "3D-Knopf bei Zoom 12 sichtbar");
  await rp(`map.jumpTo({zoom:15.6}, {originalEvent:{}}); true`);
  await page.waitForFunction(() => window.__rp("map.getPitch() > 40 && !map.isMoving()"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`map.getPitch()`) > 40, "Standard 3D: Karte kippt beim Hineinzoomen nicht: "+await rp(`map.getPitch()`));
  ok(await rp(`b3dOn`), "3D-Gebäude nicht an");
  await page.waitForTimeout(300); const p1 = await pos();
  ok(!p1.h, "3D-Knopf ab Zoom 15 nicht sichtbar");
  ok(JSON.stringify([p1.s, p1.c, p1.t])===JSON.stringify([p0.s, p0.c, p0.t]), "Suche/Plus/Reise verschieben sich beim Einblenden: "+JSON.stringify([p0, p1]));
  ok(Math.abs(p1.b[1] - p1.s[1]) <= 2 && p1.b[0] + p1.b[2] <= p1.s[0] - 4 && p1.b[0] >= p1.t[0] + p1.t[2], "3D-Knopf nicht links neben der Suche: "+JSON.stringify(p1));
  ok(await page.locator("#b3dBtn").textContent()==="3D" && await page.locator("#b3dBtn").getAttribute("aria-pressed")==="true", "Knopf zeigt nicht 3D an");
  await page.evaluate(() => document.getElementById("b3dBtn").click());
  await page.waitForFunction(() => window.__rp("map.getPitch() < 1 && !map.isMoving()"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`map.getPitch()`) < 1, "2D schaltet nicht zurück");
  ok(await rp(`lsGet("rp-3dv")`)==="0" && await page.locator("#b3dBtn").textContent()==="2D", "2D-Wahl nicht gemerkt/angezeigt");
  // 2D gemerkt: erneutes Hineinzoomen kippt nicht
  await rp(`map.jumpTo({zoom:12}); true`); await page.waitForTimeout(300);
  ok(await rp(`$("b3dBtn").hidden`), "3D-Knopf beim Herauszoomen nicht ausgeblendet");
  await rp(`map.jumpTo({zoom:16}, {originalEvent:{}}); true`); await page.waitForTimeout(900);
  ok(await rp(`map.getPitch()`) < 1, "Trotz 2D-Wahl gekippt");
  await page.evaluate(() => document.getElementById("b3dBtn").click());
  await page.waitForFunction(() => window.__rp("map.getPitch() > 40 && !map.isMoving()"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`map.getPitch()`) > 40 && await rp(`lsGet("rp-3dv")`)==="1", "3D schaltet nicht wieder ein");
  // Kopfleiste in einer Zeile (iPad quer): Knopf links neben der Suche, Leiste in der Mitte rutscht nicht
  await page.setViewportSize({width:1180, height:820}); await page.waitForTimeout(500);
  await rp(`map.jumpTo({zoom:12, pitch:0}); true`); await page.waitForTimeout(300);
  const tb0 = await page.evaluate(() => Math.round(document.querySelector(".tabbar").getBoundingClientRect().left));
  await rp(`map.jumpTo({zoom:16}, {originalEvent:{}}); true`); await page.waitForTimeout(600);
  const w = await pos(), tb1 = await page.evaluate(() => Math.round(document.querySelector(".tabbar").getBoundingClientRect().left));
  ok(!w.h && Math.abs(w.b[1] - w.s[1]) <= 2 && w.b[0] + w.b[2] <= w.s[0] - 4, "iPad: 3D-Knopf nicht neben der Suche: "+JSON.stringify(w));
  ok(tb0===tb1, "iPad: Leiste rutscht beim Einblenden: "+tb0+" → "+tb1);
  await page.setViewportSize({width:390, height:844});
  await rp(`map.jumpTo({zoom:12, pitch:0}); reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; true`);
});

await test("3D-Karte: nach Rauszoomen aus 3D (Karte wird flach) lässt sich die Karte weiter verschieben", async () => {
  await seed(); await rp(`reduceMotion = false; lsSet("rp-3dv", "1"); v3d = true; v3dDone = true; map.jumpTo({center:[-73.985, 40.758], zoom:14.2, pitch:50}); true`);
  await page.waitForTimeout(300);
  // Touch-Folge direkt an die Karte (Zwei-Finger-Zusammenziehen bzw. ein Finger), Schritt für Schritt mit echten Frames
  const touches = (frames) => page.evaluate(async (frames) => {
    const el = document.querySelector("#gl .maplibregl-canvas"), r = el.getBoundingClientRect();
    const mk = (pts) => pts.map((p, i) => new Touch({identifier:p[2] || i+1, target:el, clientX:r.left + p[0], clientY:r.top + p[1]}));
    const fire = (type, pts, all) => el.dispatchEvent(new TouchEvent(type, {bubbles:true, cancelable:true, touches:mk(all), targetTouches:mk(all), changedTouches:mk(pts)}));
    fire("touchstart", frames[0], frames[0]);
    for(const f of frames.slice(1)){ await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16))); fire("touchmove", f, f); }
    const last = frames[frames.length-1];
    // wie auf dem iPhone: ein Finger geht zuerst hoch, der zweite kurz danach
    if(last.length > 1){ await new Promise(r => setTimeout(r, 16)); fire("touchend", [[last[1][0], last[1][1], 2]], [last[0]]); await new Promise(r => setTimeout(r, 300)); fire("touchend", [last[0]], []); }
    else { await new Promise(r => setTimeout(r, 16)); fire("touchend", last, []); }
  }, frames);
  const pinch = []; for(let k = 0; k <= 14; k++){ const d = 150 - k*10; pinch.push([[195 - d, 300], [195 + d, 300]]); }
  await touches(pinch);
  await page.waitForFunction(() => window.__rp("map.getPitch() < 1 && !map.isMoving()"), null, {timeout:6000}).catch(() => {});
  ok(await rp(`map.getZoom()`) < 13.5, "Geste hat nicht herausgezoomt: "+await rp(`map.getZoom()`));
  ok(await rp(`map.getPitch()`) < 1, "Karte nach dem Herauszoomen nicht flach: "+await rp(`map.getPitch()`));
  await page.waitForTimeout(300);
  const c0 = await rp(`JSON.stringify(map.getCenter())`);
  const drag = []; for(let k = 0; k <= 10; k++) drag.push([[200 - k*12, 300 + k*6]]);
  await touches(drag); await page.waitForTimeout(800);
  ok(await rp(`JSON.stringify(map.getCenter())`) !== c0, "Karte lässt sich nach dem Zurückkippen nicht mehr verschieben");
  ok(!errs.some(e => /_onEaseFrame|already running/.test(e)), "Fehler der Karte: "+errs.join(" | "));
  await rp(`reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; true`);
});

await test("Detail-Pop-up passt mit vielen Fotos ins Fenster, × erreichbar (schmales iPhone)", async () => {
  // Fehler: die Fotozeile gab dem Fenster eine Mindestbreite → Rasterspalte breiter als der Bildschirm, Fenster nach rechts verschoben, × außerhalb
  await seed();
  await rp(`T().photos.p4 = ["ph_a","ph_b","ph_c","ph_a","ph_b","ph_c"]; T().rating = {p4:6}; T().notes = {p4:"am besten beim Sonnenuntergang"};
    T().places.p4.n = "High Line → West Village"; T().places.p4.addr = "Start Hudson Yards (W 34th St), Ende Gansevoort St"; true`);
  for(const vp of [{width:360, height:780}, {width:428, height:926}]){
    await page.setViewportSize(vp); await page.waitForTimeout(150);
    await rp(`openJPop("p4", dayOf("p4"))`); await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const w = document.querySelector("#jPop .jp-wrap"), c = w.querySelector(".ag-card"), x = w.querySelector(".ag-x"); const a = w.getBoundingClientRect(), b = x.getBoundingClientRect();
      return {l:a.left, r:a.right, xl:b.left, xr:b.right, W:innerWidth, sw:c.scrollWidth, cw:c.clientWidth}; });
    ok(r.l >= 8 && r.r <= r.W - 8, vp.width+": Fenster ragt über den Rand: "+JSON.stringify(r));
    ok(Math.abs(r.l - (r.W - r.r)) <= 2, vp.width+": Fenster nicht mittig: "+JSON.stringify(r));
    ok(r.xl >= 0 && r.xr <= r.W, vp.width+": × nicht erreichbar: "+JSON.stringify(r));
    ok(r.sw <= r.cw + 1, vp.width+": Inhalt breiter als das Fenster: "+JSON.stringify(r));
    await page.locator("#jPop .jp-wrap > .ag-x").click(); await page.waitForTimeout(250);
    ok(await rp(`$("jPop").hidden`), vp.width+": × schließt das Fenster nicht");
  }
});

/* ------------------------------------------------------------------ Ergebnis */
srv.close();
if(SHARD){ console.log("@@"+JSON.stringify(results)); process.exit(0); }
report(results);
