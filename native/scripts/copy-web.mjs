// Kopiert die PWA aus dem Hauptordner nach native/www (Capacitor-webDir).
// Die PWA bleibt die einzige Quelle: hier wird nichts von Hand geändert.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "www");
const FILES = ["index.html", "sw.js", "manifest.webmanifest", "firebase.js", "bus.json",
  "maplibre-gl.js", "maplibre-gl.css", "maplibre-LICENSE.txt", "icons"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) { console.error("fehlt: " + f); process.exit(1); }
  cpSync(src, join(out, f), { recursive: true });
}
console.log("PWA nach native/www kopiert (" + FILES.length + " Einträge)");
