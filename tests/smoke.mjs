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
    if(u.includes("routed-bike/route")){ OSRMREQ.push(u); const pts = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map(x => x.split(",").map(Number));
      const coords = []; pts.forEach((p, i) => { if(i){ const q = pts[i-1]; coords.push([q[0] + (p[0]-q[0])*0.5 + 0.0008, q[1] + (p[1]-q[1])*0.5]); } coords.push(p); });
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:1800, geometry:{type:"LineString", coordinates:coords}}]}) }); }
    if(u.includes("routed-foot/route") && u.includes("steps=true")){ const pts = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map(x => x.split(",").map(Number));
      const A = pts[0], B = pts[pts.length-1], M = [A[0], B[1]], co = [];
      for(let i = 0; i <= 10; i++) co.push([A[0], A[1] + (M[1]-A[1])*i/10]); for(let i = 1; i <= 10; i++) co.push([M[0] + (B[0]-M[0])*i/10, M[1]]);
      return rt.fulfill({ contentType: "application/json", headers: {"access-control-allow-origin":"*"}, body: JSON.stringify({code:"Ok", routes:[{distance:1200, duration:900, geometry:{type:"LineString", coordinates:co},
        legs:[{steps:[{name:"Bowery", maneuver:{type:"depart", location:A}}, {name:"Bleecker Street", maneuver:{type:"turn", modifier:"right", location:M}}, {name:"", maneuver:{type:"arrive", location:B}}]}]}]}) }); }
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

await test("Citi Bike: Stationen als Ebene, Stations-Infos, Etappe mit dem Rad", async () => {
  await seed();
  await click("#layersBtn");
  await page.locator("#lBike").check(); await page.waitForTimeout(900);
  await click("#layersBtn");
  ok(await rp(`layers.bike && lsGet("nyc-l-bike")==="1"`), "Ebene wird nicht eingeschaltet");
  ok(await rp(`CB.st.length`)===3, "Stationen nicht geladen ("+await rp(`CB.st.length + " " + CB.err`)+")");
  ok(await rp(`map.getSource("cb")._data.features.length`)===3, "Stationen nicht auf der Karte");
  await rp(`select("cb:S1")`); await page.waitForTimeout(150);
  const card = await page.locator("#card").innerText();
  ok(card.includes("Ludlow") && card.includes("7") && card.includes("freie Plätze"), "Stations-Karte unvollständig: "+card.slice(0, 120));
  await rp(`select(null); legsList = true; setSheet("full"); renderSheet();`); await page.waitForTimeout(150);
  ok(await page.locator("[data-act=lmpick]").count() > 0, "Umschalter für das Verkehrsmittel fehlt");
  const li = await rp(`(function(){ var L = dayLegs(cur); for(var i = 0; i < L.length; i++){ if(L[i][0] && L[i][0].id==="p1" && L[i][1] && L[i][1].id==="p2") return i; } return -1; })()`);
  ok(li > -1, "Etappe Katz Deli → Washington Square nicht gefunden");
  await page.locator(`[data-act=lmpick][data-leg="${li}"]`).click(); await page.waitForTimeout(150);
  ok(await page.locator("#jpMenu [data-act=lmode]").count()===3, "Menü bietet nicht Zu Fuß / U-Bahn / Citi Bike");
  ok((await page.locator("#jpMenu [data-mode=bike]").innerText()).includes("Min."), "Citi Bike ohne Zeitangabe im Menü");
  await page.locator("#jpMenu [data-act=lmode][data-mode=bike]").click(); await page.waitForTimeout(250);
  const leg = await page.locator(".leg.lbk").first().innerText();
  ok(leg.includes("Min.") && leg.includes("Ludlow") && leg.includes("Washington Sq E"), "Rad-Etappe falsch: "+leg.slice(0, 160));
  ok(await page.evaluate(() => document.querySelector(".leg.lbk .tsum").getBoundingClientRect().width > 80), "Zusammenfassung der Rad-Etappe ist nicht sichtbar");
  ok(await rp(`legMode(dayLegs(cur)[${li}][0], dayLegs(cur)[${li}][1])`)==="bike", "Rad-Modus wird nicht gespeichert");
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
  await rp(`me = {la:40.7215, lo:-73.9890, acc:8}; openGo("p2");`); await page.waitForTimeout(200);
  ok(await page.locator("#catPop .gp-nav [data-act=navstart]").count()===3, "Navigation in der App fehlt im Routen-Pop-up");
  await click("#catPop [data-act=navstart][data-mode=walk]");
  await page.waitForFunction(() => window.__rp("!!(NAV && NAV.pts)"), null, {timeout:5000}).catch(() => {});
  ok(await rp(`!!(NAV && NAV.pts && NAV.pts.length > 5)`), "Weg für die Navigation nicht berechnet");
  ok(await visible("#navUi .nav-top") && await visible("#navUi .nav-foot"), "Navigationsanzeige fehlt");
  const t1 = await page.locator("#navUi .nav-top").innerText();
  ok(t1.includes("Rechts abbiegen") && t1.includes("Bleecker"), "Abbiegehinweis fehlt: "+t1);
  ok(await rp(`document.body.classList.contains("navon")`), "Obere Leiste wird während der Navigation nicht ausgeblendet");
  await click("#navUi [data-act=navhide]");
  ok(await visible("#navUi .nav-pill") && !(await visible("#navUi .nav-top")), "Ausblenden funktioniert nicht");
  ok(await rp(`navSvg()===""`) && !(await rp(`document.body.classList.contains("navon")`)), "Weg/Leisten bleiben beim Ausblenden sichtbar");
  await click("#navUi [data-act=navshow]");
  ok(await visible("#navUi .nav-top"), "Einblenden funktioniert nicht");
  await rp(`me = {la:NAV.tgt.la, lo:NAV.tgt.lo, acc:8}; navOnPos();`); await page.waitForTimeout(150);
  ok((await page.locator("#navUi .nav-top").innerText()).includes("Angekommen"), "Ankunft wird nicht erkannt");
  await click("#navUi [data-act=navdone]");
  ok(await rp(`!!T().done.p2 && NAV===null`), "Abhaken bei Ankunft funktioniert nicht");
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
