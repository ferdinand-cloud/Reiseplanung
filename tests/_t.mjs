import fs from "fs"; import { chromium } from "playwright-core";
const b = await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"}); const p = await b.newPage();
await p.goto("file:///home/claude/Reiseplanung/index.html?rptest"); await p.waitForFunction(() => !!window.__rp, null, {timeout:20000});
for (const c of process.argv.slice(2)) {
  const j = fs.readFileSync("/tmp/chi/"+c+".json","utf8");
  const r = await p.evaluate(([j, c]) => window.__rp(`(function(){ var t0 = performance.now(); var cc = {rail:cpPrep(${j}), st:{}}; var g = cpGeo(cc, false); var dt = performance.now() - t0;
    var o = {}; g.tr.geo.features.forEach(function(f){ o[f.properties.k] = f.properties.o; });
    return JSON.stringify({ms:Math.round(dt), n:g.tr.geo.features.length, o:"${c}"==="chicago" ? o : Object.keys(o).length,
      corner:"${c}"==="chicago" ? g.tr.geo.features.map(function(f){ var pts = []; f.geometry.coordinates.forEach(function(r){ r.forEach(function(q){ if(Math.abs(q[0]+87.6262) < .0005 && Math.abs(q[1]-41.8858) < .0004) pts.push(q[0].toFixed(6)+","+q[1].toFixed(6)); }); }); return f.properties.k+": "+pts.join(" "); }) : 0}); })()`), [j, c]);
  console.log(c, r);
}
await b.close();
