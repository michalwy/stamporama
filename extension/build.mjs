// Build the Stamporama Assistant extension (#253) with esbuild — deliberately boring: each
// entrypoint is bundled to a self-contained IIFE, and the static assets (manifest, HTML, icons) are
// copied into dist/. `node build.mjs` for a one-shot build, `--watch` for incremental rebuilds.
import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_ICON_DIR, DEV_KEY, DEV_NAME_SUFFIX } from "./identity.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
// `--release` builds what gets uploaded to the Chrome Web Store (#288): the plain manifest and the
// blue icons, with the identity left to the store. Without it — the default, and what you load unpacked —
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
  // The instance-origin script (#409). Registered at runtime rather than declared in the manifest —
  // a self-hosted instance has no origin to declare — but bundled like any other entrypoint.
  instance: resolve(root, "src/content/instance.ts"),
  popup: resolve(root, "src/popup/index.ts"),
  // The capture window (#355) — a page of its own rather than a mode of the match window: a
  // marketplace listing and a catalogue page are different questions about different pages.
  capture: resolve(root, "src/capture/index.ts"),
  // The search window (#529) — "have I got this?", asked about text selected on any page at all.
  search: resolve(root, "src/search/index.ts"),
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
  await cp(resolve(root, "src/capture/index.html"), resolve(outdir, "capture.html"));
  await cp(resolve(root, "src/search/index.html"), resolve(outdir, "search.html"));
  await cp(resolve(root, "src/options/index.html"), resolve(outdir, "options.html"));
  await cp(resolve(root, "icons"), resolve(outdir, "icons"), {
    recursive: true,
    // The dev icons are dead weight inside the store package — and shipping them would invite the
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
  // The toolbar icon, inlined as a `data:` URL wherever it is imported (#417). A content script
  // that shows the mark inside someone else's page needs the bytes, and the alternative —
  // `chrome.runtime.getURL` — requires a `web_accessible_resources` entry that hands every page
  // the extension's id. At 355 bytes for the 16px icon, inlining is cheaper than that trade, and
  // the icon file stays the single source of truth rather than being copied into a TS constant.
  loader: { ".png": "dataurl" },
  // Which flavour this bundle is, for `core/mark.ts`: a mark drawn into a page follows the toolbar,
  // and the dev build's toolbar is amber so the two extensions can be told apart in one browser.
  define: { __DEV_BUILD__: JSON.stringify(!release) },
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
  console.log(`[assistant] build complete → ${relative(root, outdir)}/ (${release ? "release" : "dev"})`);
}
