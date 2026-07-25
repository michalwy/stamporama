// Package the built extension for the Chrome Web Store (#288, part of #155).
//
// Run after `node build.mjs --release` (or via `pnpm pack:store`, which does both):
//
//   node pack.mjs --version 0.28.0
//
// Inputs: `dist-release/` and a version. Output: `dist-store/stamporama-assistant.zip`, the archive
// CI uploads to the store — and the same file to attach by hand for the very first submission,
// which the API cannot create.
//
// The store assigns the extension's identity and signs the package itself, so nothing here is
// signed and no key is involved. The unpacked dev build is the only flavour that carries a `key`
// (see identity.mjs); an uploaded package must not, or the store rejects the mismatch.
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion, zip } from "./archive.mjs";
import { DEV_NAME_SUFFIX } from "./identity.mjs";

const root = dirname(fileURLToPath(import.meta.url));
// `build.mjs --release` writes here; `dist/` is always the dev build and is never packed.
const distdir = resolve(root, "dist-release");
const zipName = "stamporama-assistant.zip";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// `--out` writes straight into a directory of the caller's choosing; CI leaves the default.
const outdir = resolve(root, arg("out") ?? "dist-store");

/** Every file under `dir`, sorted, as ZIP-style forward-slash relative paths. */
async function collect(dir) {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue;
    const absolute = join(item.parentPath, item.name);
    found.push([relative(dir, absolute).split(sep).join("/"), absolute]);
  }
  found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return found;
}

const version = normalizeVersion(arg("version") ?? process.env.STAMPORAMA_VERSION);

const files = await collect(distdir);
if (!files.some(([name]) => name === "manifest.json")) {
  throw new Error(`No manifest.json in ${distdir}. Run \`node build.mjs --release\` first.`);
}

// Stamp the version into the archived manifest. It mirrors the app release, so cutting a release is
// what gives the store a version to accept — an upload whose version did not increase is rejected.
// `manifest.json` in the repo keeps its placeholder.
const entries = [];
for (const [name, absolute] of files) {
  const contents = await readFile(absolute);
  if (name === "manifest.json") {
    const manifest = JSON.parse(contents.toString("utf8"));
    if (manifest.name.includes(DEV_NAME_SUFFIX)) {
      throw new Error(
        `${distdir} holds a dev build (${manifest.name}). Run \`pnpm pack:store\`, which builds with --release.`
      );
    }
    manifest.version = version;
    entries.push([name, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")]);
  } else {
    entries.push([name, contents]);
  }
}

const archive = zip(entries);

if (outdir === resolve(root, "dist-store")) await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(join(outdir, zipName), archive);

console.log(
  `[assistant] packed ${zipName} — version ${version}, ${archive.length} bytes, sha256 ${createHash("sha256")
    .update(archive)
    .digest("hex")
    .slice(0, 16)}…`
);
