/* Automatischer Klicktest der Reiseplan-App im iPhone-Format.
   Start:  cd tests && npm install && node smoke.mjs
   Die App wird lokal ausgeliefert, alle externen Anfragen (Firebase, Kartenkacheln, Google) sind gesperrt.
   Über ?rptest stellt die App window.__rp(code) bereit, um Testdaten anzulegen und den Zustand zu prüfen. */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium as pw } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";            // Ordner für Screenshots (optional)
const ONLY = process.argv[2] || "";               // nur Tests, deren Name das enthält

async function chromePath(){
  if(process.env.CHROME) return { exe: process.env.CHROME, args: [] };
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

async function newPage(){
  // je Test ein frischer Browser (das mitgelieferte Chromium läuft als ein Prozess; mehrere Karten-Seiten nacheinander blockieren sonst)
  browser = await pw.launch({ executablePath: exe, args, headless: true });
  const ctx = await browser.newContext({ viewport: {width:390, height:844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "de-DE", timezoneId: "America/New_York" });
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
      const ws = Math.abs(p[0] + 74.01) < 0.0002 ? [0, 1, 2, 3].map(i => ({location:[p[0] + 0.00003*i, p[1] + 0.00003*i], distance:3*i})).concat([{location:[p[0] + 0.0004, p[1]], distance:34}]) : [{location:p, distance:0}];
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
    acct.user = {uid:"u_me", email:"me@test.de", emailVerified:true}; fbDb = null; acct.state = "ok";
    S = {trips:{t_test:t}, cur:"t_test"}; cur = H; tab = "day"; sel = null;
    FR.friends = [{uid:"u_anna", name:"anna"},{uid:"u_ludwig", name:"Ludwig"},{uid:"u_clara", name:"Clara"}];
    renderGate(); renderAll();
    return {Y:Y, H:H};
  })()`);
}

async function test(name, fn){
  if(ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const t0 = Date.now(); if(process.env.VERBOSE) console.log("… "+name);
  try {
    page = await newPage();
    await fn();
    ok(!errs.length, "JavaScript-Fehler: "+errs.join(" | "));
    results.push({name, ok:true, ms:Date.now()-t0});
  } catch(e){
    await shot("FEHLER-"+name.replace(/[^\w]+/g, "_")).catch(()=>{});
    results.push({name, ok:false, ms:Date.now()-t0, err:(e.message||String(e)).split("\n")[0]+(errs.length ? " | JS: "+errs.join(" | ") : "")});
  } finally { if(browser) await browser.close().catch(()=>{}); browser = null; }
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
  await rp(`openRecap("${Y}")`); await page.waitForTimeout(900);
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
  await click("#dcView img[data-act=dcfull]");
  ok(await page.locator("#pvLayer .pv-slide").count()===2, "Nicht alle Fotos des Spots im Vollbild");
  ok(await page.locator("#pvLayer [data-act=dcvsave], #pvLayer [data-act=phsave]").count()===0, "Fotos von Freunden lassen sich herunterladen");
  ok(await page.locator("#pvLayer .pv-side [data-act=dcvcm]").count()===1, "Kommentare fehlen");
  await shot("entdecken-vollbild");
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const L = document.getElementById("pvLayer"); return !L || L.hidden; }), "Vollbild schließt nicht");
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
  ok(await page.locator("#jpMenu [data-act=opentrip]").count()===1, "Mitreisende einladen fehlt im ⋯-Menü");
  await click("#jpMenu [data-act=pfcover][data-v=photo]");
  ok(await visible("#cvPop .cv-grid"), "Foto-Auswahl öffnet nicht");
  await page.locator("#cvPop [data-act=cvph]").last().click(); await page.waitForTimeout(200);
  ok(!!(await rp(`S.trips.t_test.cover && S.trips.t_test.cover.ph`)), "Titelbild wird nicht gespeichert");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcover][data-v=letters]");
  await page.locator("#cvPop [data-act=cvcol]").nth(2).click();
  await click("#cvPop [data-act=cvletters]");
  ok(await rp(`!!(S.trips.t_test.cover && S.trips.t_test.cover.txt)`), "Buchstaben-Modus wird nicht gespeichert");
  ok(await page.locator("#profView .pf-tw:has([data-trip=t_test]) .pf-cov.lt").count()===1, "Kachel zeigt nach Buchstaben-Wahl noch ein Foto");
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcover][data-v=auto]");
  ok(await rp(`!S.trips.t_test.cover`), "Automatisch setzt nicht zurück");
});

await test("Titelbild-Auswahl: viele Fotos als sauberes Raster, nur sichtbare geladen", async () => {
  await seed();
  await rp(`(function(){ var t = S.trips.t_test, ids = []; for(var i = 0; i < 90; i++){ var id = "phx"+i; ids.push(id); PHC[id] = PHC["ph_"+["a","b","c"][i%3]]; } t.photos.p4 = t.photos.p4.concat(ids); PROF = {name:"tester"}; openProfile(); })()`);
  await page.waitForTimeout(300);
  await page.locator("#profView [data-act=pfmore][data-trip=t_test]").click();
  await click("#jpMenu [data-act=pfcover][data-v=photo]");
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
  await rp(`navEnd(true)`); await page.waitForFunction(() => window.__rp("map.getPitch() < 5 && !map.isMoving()"), null, {timeout:5000}).catch(() => {});
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
    ok(fp.p && !fp.south && Math.abs(fp.lo + 74.0096) < 1e-4, "Fußweg vom Anleger fährt mit der Fähre: "+JSON.stringify(fp));
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
  ok(await visible("#addMenu") && await page.evaluate(() => { const m = document.querySelector("#addMenu").getBoundingClientRect(), h = document.querySelector("#navUi .nav-hero").getBoundingClientRect(); return m.top >= h.bottom && m.left > 50; }), "Plus-Menü erscheint nicht neben der linken Leiste");
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

/* ------------------------------------------------------------------ Ergebnis */
srv.close();
const bad = results.filter(r => !r.ok);
for(const r of results) console.log((r.ok ? "✓" : "✗")+" "+r.name+(r.ok ? "" : "\n    → "+r.err)+`  (${r.ms} ms)`);
console.log(`\n${results.length - bad.length} von ${results.length} Tests bestanden`);
process.exit(bad.length ? 1 : 0);
