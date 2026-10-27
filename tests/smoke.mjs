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
    S = {trips:{t_test:t}, cur:"t_test"}; cur = H; tab = "day"; sel = null;
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

await test("Neuer Ort (POI): Kacheln, Freunde/Öffentlich, keine Weg-Zeile", async () => {
  await seed();
  await rp(`poiSel = {n:"Test Café", cls:"cafe", sub:"cafe", c:"cafe", la:40.7290, lo:-74.0010, addr:"Bleecker St 1"}; sel = null; select("poi"); poiSel = poiSel || null; renderCard();`);
  ok(await visible("#card"), "POI-Pop-up nicht sichtbar");
  const tiles = await page.locator("#card .jp-tile").allInnerTexts();
  ["Zur Planung","Wunschliste","Route","Mehr"].forEach(x => ok(tiles.some(t => t.includes(x)), "Kachel fehlt: "+x));
  ok(await page.locator("#card .rvchips").count()===1, "Freunde/Öffentlich fehlt");
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
  ok((await page.locator("#jpMenu").innerText()).includes("Inspiration") && (await page.locator("#jpMenu").innerText()).includes("Lissabon"), "Auswahl ohne Inspiration oder Ziel");
  await page.locator("#jpMenu [data-act=dcscopeset]", {hasText:"Lissabon"}).click(); await page.waitForTimeout(250);
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
  ok(await rp(`[MAPICO, MAPGO].every(function(s){ return s===ic("map"); }) && visIco("pub")===ic("friends") && visIco("all")===ic("globe") && visIco("trip")===ic("trip")`), "Karten-/Sichtbarkeits-Symbole uneinheitlich");
});

await test("App-Demo: Auswahl Reisende/Beobachter, alle Schritte durchklickbar", async () => {
  await seed();
  await rp(`openDemo("trav")`); await page.waitForTimeout(200);
  ok(await visible("#demo .dm-role"), "Rollenauswahl oben fehlt");
  ok(await page.locator("#demo .m-bar .bi svg").count() >= 6, "Symbole in der Leiste fehlen");
  const nT = await rp(`DM_STEPS_NOW().length`), seen = new Set();
  for(let i = 0; i < nT - 1; i++){ seen.add(await page.locator("#demo .dm-mock").getAttribute("data-s")); await page.locator("#demo .dm-next").click(); await page.waitForTimeout(60); }
  ["card","photo","comment","vis","send","chat","recap","disc","share"].forEach(x => ok(seen.has(x), "Reisende-Demo zeigt Bildschirm nicht: "+x));
  ok((await page.locator("#demo .dm-next").innerText()).includes("Los"), "Letzter Schritt ohne „Los geht’s“");
  await page.locator("#demo .dm-role [data-r=obs]").click(); await page.waitForTimeout(150);
  const nO = await rp(`DM_STEPS_NOW().length`);
  ok(nO !== nT && await rp(`dmI`)===0, "Beobachter-Demo startet nicht von vorn");
  ok(await page.locator("#demo .dm-role [data-r=obs][aria-selected=true]").count()===1, "Rollenauswahl nicht markiert");
  for(let i = 0; i < nO - 1; i++){ await page.locator("#demo .dm-next").click(); await page.waitForTimeout(60); }
  await rp(`dmShow(DM_STEPS_NOW().findIndex(function(s){ return s.s==="photo"; }))`);
  ok(!(await visible("#demo .ms-more")), "Beobachter-Demo zeigt ⋯ (Herunterladen/Löschen)");
  await rp(`dmShow(DM_STEPS_NOW().length-1)`); await page.locator("#demo .dm-next").click(); await page.waitForTimeout(150);
  ok(await page.locator("#demo").count()===0, "Demo schließt am Ende nicht");
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
    else if(q.includes("map_to_area")) el = [201, 202, 203].map((id, i) => ({type:"relation", id, tags:{name:["Estrela","Misericórdia","Alfama"][i], admin_level:"8"}, bounds:{minlat:38.70, minlon:-9.20+i*0.02, maxlat:38.71, maxlon:-9.19+i*0.02}}))
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

await test("Wünsche zurückstellen, ein-/ausblenden, zurückholen, weiterhin löschbar", async () => {
  await seed();
  await rp(`select("p6")`); await page.waitForTimeout(200);
  await click("#card [data-act=cardmore]");
  await click("#jpMenu [data-act=wpark]"); await page.waitForTimeout(200);
  ok(await rp(`T().places.p6.park===1 && wishes().every(function(w){ return w.id!=="p6"; })`), "Wunsch wird nicht zurückgestellt");
  ok(await rp(`!!T().places.p6`), "Zurückstellen hat den Wunsch gelöscht");
  await rp(`select(null); tab = "wish"; setSheet("full"); renderSheet();`); await page.waitForTimeout(300);
  ok(!(await visible("#wishRes li[data-id=p6]")), "Zurückgestellter Wunsch steht noch in der Wunschliste");
  ok((await page.locator("#wishRes .wpark").innerText()).includes("Zurückgestellt · 1"), "Abschnitt „Zurückgestellt“ fehlt");
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
  ok((await page.locator("#body [data-act=zoffer]").innerText()).includes("2 gemerkte Orte"), "Später übernehmen in der Wunschliste fehlt");
  await click("#body [data-act=zoffer]"); await page.waitForTimeout(150);
  await click("#cfPop .cf-ok"); await page.waitForTimeout(200);
  ok(await page.locator("#body [data-act=zoffer]").count()===0, "Angebot bleibt nach dem Übernehmen stehen");
  ok(await rp(`Object.keys(T().places).filter(function(k){ return T().places[k].zl; }).length`)===2, "Orte nicht übernommen");
  ok(await rp(`!T().ziel && !noTrip()`), "Neue Reise ist nicht aktiv");
  await rp(`var k = Object.keys(T().places).filter(function(k){ return T().places[k].n==="Pantheon"; })[0], d = days()[0].key; T().order[d] = [k]; T().done[k] = true; T().rating = {}; T().rating[k] = 2; save(); openZiele(zielIds()[0]);`);
  await page.waitForTimeout(200);
  const txt = await page.locator("#zPop .zdpop").innerText();
  ok(txt.includes("besucht") && txt.includes("Must Have"), "Besuch/Bewertung erscheint nicht im Ziel");
  ok(txt.includes("Wunschliste"), "Übernommener, noch offener Ort zeigt keinen Stand");
  await shot("ziel-besucht");
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
await test("Social: Einladungslink fragt nach Freundschaftsanfrage", async () => {
  await seed();
  await rp(`window.__req = null; PROF = {name:"ich", nameLower:"ich"}; frRequest = function(u, n){ window.__req = [u, n]; };
    var fq = function(){ var q = {where:function(){ return q; }, orderBy:function(){ return q; }, limit:function(){ return q; }, get:function(){ return Promise.resolve({docs:[], empty:true}); }, onSnapshot:function(){ return function(){}; }, doc:function(id){ return fd(id); }, add:function(){ return Promise.resolve({}); }}; return q; },
      fd = function(id){ return {id:id, collection:function(){ return fq(); }, get:function(){ return Promise.resolve({exists:false, data:function(){ return {}; }}); }, set:function(){ return Promise.resolve(); }, update:function(){ return Promise.resolve(); }, delete:function(){ return Promise.resolve(); }, onSnapshot:function(){ return function(){}; }}; };
    window.__fakeDb = function(over){ var db = {collection:function(){ return fq(); }, batch:function(){ return {set:function(){}, update:function(){}, delete:function(){}, commit:function(){ return Promise.resolve(); }}; }, runTransaction:function(){ return Promise.resolve(); }}; return Object.assign(db, over||{}); };
    fbDb = window.__fakeDb({collection:function(n){ var q = fq(); q.doc = function(id){ var d = fd(id); d.get = function(){ return Promise.resolve(n==="usernames" ? {exists:id==="zoe", data:function(){ return {uid:"u_zoe"}; }} : {exists:true, data:function(){ return {name:"Zoe"}; }}); }; return d; }; return q; }});
    INVFR = "zoe"; invCheck(); true`);
  await page.waitForTimeout(300);
  ok(await visible("#cfPop") && (await page.locator("#cfPop").innerText()).includes("@Zoe"), "Frage nach Freundschaft fehlt");
  await click("#cfPop .cf-ok");
  ok(await rp(`window.__req && window.__req[0]==="u_zoe"`), "Anfrage nicht gesendet");
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
  ok(await rp(`T().pubA.p4===1 && T().pubP.p4===1 && visOf4("p4")==="all" && isPubP("p4")`), "Ort nicht öffentlich gestellt");
  await rp(`KNOWN.t_test = 1; recBusy = false; lsSet("rp-recs-u_me", "{}"); recSync(); true`); await page.waitForTimeout(500);
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/pub/u_me_t_test_p4" && x[1].gh && x[1].gh.length===7 && x[1].by==="u_me"; })`), "Öffentliche Empfehlung nicht in pub geschrieben");
  ok(await rp(`window.__log.some(function(x){ return x[0]==="/recs/u_me/items/t_test_p4"; })`), "Freundes-Empfehlung fehlt");
  await rp(`setVis("p4", "pub"); true`); await page.waitForTimeout(200);
  ok(await visible("#cfPop"), "Zurücknehmen ohne Rückfrage");
  await click("#cfPop .cf-ok");
  ok(await rp(`!T().pubA.p4 && T().pubP.p4===1`), "Öffentlich nicht zurückgenommen");
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
  await shot("profil-zaehler-"+n);
};
await test("Profil: Zähler klein rechts neben dem Profilbild", async () => { await pfStatsSide("hoch"); });
await test("Profil: Zähler rechts neben dem Profilbild im Querformat", async () => { await pfStatsSide("quer"); }, QUER);

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
await test("Tastatur im Pop-up: Querformat", async () => { await kbPop(KB_ZIEL, "#zPop", "ziel-quer"); }, QUER);

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
  // 5) Senden lässt die Tastatur offen (Fokus bleibt im Feld)
  await page.evaluate(() => { const b = document.querySelector("#chView .ch-send"); const ev = new MouseEvent("mousedown", {bubbles:true, cancelable:true}); b.dispatchEvent(ev); window.__md = ev.defaultPrevented; });
  ok(await page.evaluate(() => window.__md), "Senden-Knopf nimmt dem Feld den Fokus (Tastatur ginge zu)");
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
    closeMenus(); accView = "friends"; openSettings(); true`);
  await page.waitForTimeout(200);
  ok(await visible("#acctPop [data-act=fgnew]"), "„Neue Gruppe“ fehlt auf der Freunde-Seite");
  await tapS("#acctPop [data-act=fgnew]"); await page.waitForTimeout(250);
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
  ok(await rp(`document.getElementById("catPop").hidden && /Familie/.test(document.querySelector("#acctPop .fg-grp").textContent) && /2 Personen/.test(document.querySelector("#acctPop .fg-grp").textContent)`), "Gruppe fehlt auf der Freunde-Seite");
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
  await tapS('#acctPop [data-act=fgopen][data-g="gk"]'); await page.waitForTimeout(200);
  ok(await rp(`var c = getComputedStyle(document.querySelector("#catPop [data-act=fgdel]")).color.match(/\\d+/g).map(Number); c[0] > c[1] + 40`), "Löschen-Knopf nicht rot");
  await tapS("#catPop [data-act=fgdel]"); await page.waitForTimeout(200);
  ok(await visible("#cfPop .cf-card") && await rp(`FG.length===2`), "Löschen ohne Rückfrage");
  await tapS("#cfPop .cf-ok"); await page.waitForTimeout(200);
  ok(await rp(`FG.length===1 && !fgGet("gk") && __fgw.some(function(w){ return w[0]==="del" && /fgroups\\/gk$/.test(w[1]); })`), "Gruppe nicht gelöscht");
  await rp(`closeCatPop(); closeSettings(); fbDb = null; FR.friends = []; FG = []; true`);
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

/* ------------------------------------------------------------------ Ergebnis */
srv.close();
if(SHARD){ console.log("@@"+JSON.stringify(results)); process.exit(0); }
report(results);
