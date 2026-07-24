// Build the Stamporama Assistant extension (#253) with esbuild — deliberately boring: each
// entrypoint is bundled to a self-contained IIFE, and the static assets (manifest, HTML, icons) are
// copied into dist/. `node build.mjs` for a one-shot build, `--watch` for incremental rebuilds.
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

const entryPoints = {
  background: resolve(root, "src/background/index.ts"),
  content: resolve(root, "src/content/index.ts"),
  popup: resolve(root, "src/popup/index.ts"),
  options: resolve(root, "src/options/index.ts"),
};

/** Copy the manifest, popup/options HTML, and icons alongside the bundled JS. */
async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
  await cp(resolve(root, "src/popup/index.html"), resolve(outdir, "popup.html"));
  await cp(resolve(root, "src/options/index.html"), resolve(outdir, "options.html"));
  await cp(resolve(root, "icons"), resolve(outdir, "icons"), { recursive: true });
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
  console.log("[assistant] build complete → dist/");
}
