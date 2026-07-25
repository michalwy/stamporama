// Build the Stamporama Assistant extension (#253) with esbuild — deliberately boring: each
// entrypoint is bundled to a self-contained IIFE, and the static assets (manifest, HTML, icons) are
// copied into dist/. `node build.mjs` for a one-shot build, `--watch` for incremental rebuilds.
import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_ICON_DIR, DEV_KEY, DEV_NAME_SUFFIX } from "./identity.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
// `--release` builds what gets signed into a CRX (#254): the plain manifest and the blue icons,
// with the identity left to the signing key. Without it — the default, and what you load unpacked —
// the build is a *separate extension*: its own key, its own name, amber icons, so it can sit in the
// browser next to the policy-installed one without a collision.
const release = process.argv.includes("--release");

// Each flavour has its own output directory, so `dist/` is *always* the dev build. Sharing one
// directory means a release build (or a pack) silently leaves a blue, keyless `dist/` behind, and
// the next "Load unpacked" installs the wrong extension without saying anything.
const outdir = resolve(root, release ? "dist-release" : "dist");

const entryPoints = {
  background: resolve(root, "src/background/index.ts"),
  content: resolve(root, "src/content/index.ts"),
  popup: resolve(root, "src/popup/index.ts"),
  options: resolve(root, "src/options/index.ts"),
};

/** Point every icon declaration at the dev set. */
function useDevIcons(sizes) {
  return Object.fromEntries(Object.keys(sizes).map((size) => [size, `${DEV_ICON_DIR}/icon-${size}.png`]));
}

/** Copy the manifest, popup/options HTML, and icons alongside the bundled JS. */
async function copyStatic() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (!release) {
    manifest.name += DEV_NAME_SUFFIX;
    manifest.key = DEV_KEY;
    manifest.icons = useDevIcons(manifest.icons);
    manifest.action.default_icon = useDevIcons(manifest.action.default_icon);
    manifest.action.default_title += DEV_NAME_SUFFIX;
  }
  await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  await cp(resolve(root, "src/popup/index.html"), resolve(outdir, "popup.html"));
  await cp(resolve(root, "src/options/index.html"), resolve(outdir, "options.html"));
  await cp(resolve(root, "icons"), resolve(outdir, "icons"), {
    recursive: true,
    // The dev icons are dead weight inside a signed CRX — and shipping them would invite the
    // released extension to reference an icon set it is not supposed to use.
    filter: (source) => !release || !source.includes(`${sep}dev`),
  });
}

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome110",
  platform: "browser",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.rebuild();
  await copyStatic();
  await ctx.watch();
  console.log("[assistant] watching for changes…");
} else {
  await build(options);
  await copyStatic();
  console.log(`[assistant] build complete → dist/ (${release ? "release" : "dev"})`);
}
