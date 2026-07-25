// Derive the dev build's toolbar icons from the release ones by rotating them off blue (#254).
//
// The dev and release Assistants are separate extensions with separate storage, and they sit next
// to each other in the toolbar — one pointed at a dev instance, one at the production collection.
// Two identical icons there is a real way to write to the wrong database, so the dev build is amber.
//
// Run from the repo root (sharp is the app's dependency, not the extension's — this is a one-off
// asset step, not part of `pnpm build`):
//
//   node extension/scripts/make-dev-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const icons = resolve(dirname(fileURLToPath(import.meta.url)), "..", "icons");
await mkdir(resolve(icons, "dev"), { recursive: true });

for (const size of [16, 48, 128]) {
  // Blue (#2563EB) → amber. The numbers are empirical: sharp rotates hue in LCh, so 135 lands the
  // blue on ~30° and the lightness bump keeps it from going muddy brown. White stays white —
  // unsaturated pixels are unaffected — so the S glyph reads the same on both icons.
  await sharp(resolve(icons, `icon-${size}.png`))
    .modulate({ hue: 135, lightness: 15 })
    .toFile(resolve(icons, "dev", `icon-${size}.png`));
}

console.log("[assistant] wrote dev icons → extension/icons/dev/");
