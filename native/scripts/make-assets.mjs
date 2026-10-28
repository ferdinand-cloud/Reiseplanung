// Erzeugt die Ausgangsbilder für @capacitor/assets aus assets/icon.svg (gleiches Motiv wie icons/icon-512.png).
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const BG = "#17212c";
// Nur das Motiv ohne Hintergrund (für Android-Vordergrund und Startbild)
const motiv = svg.replace(/<rect[^>]*\/>/, "");

const png = (s, size) => sharp(Buffer.from(s), { density: 72 * size / 512 }).resize(size, size).png();

await png(svg, 1024).toFile(join(dir, "icon-only.png"));
// Android: Motiv im sicheren Bereich (66 %) des adaptiven Symbols
const fg = await png(motiv, 676).toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: fg, gravity: "center" }]).png().toFile(join(dir, "icon-foreground.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } }).png().toFile(join(dir, "icon-background.png"));
// Startbild: Motiv klein in der Mitte auf App-Hintergrund (hell und dunkel gleich, wie die App beim Start)
const klein = await png(motiv, 640).toBuffer();
for (const name of ["splash.png", "splash-dark.png"]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
    .composite([{ input: klein, gravity: "center" }]).png().toFile(join(dir, name));
}
console.log("Ausgangsbilder in native/assets erzeugt");
