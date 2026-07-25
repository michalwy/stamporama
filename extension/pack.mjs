// Package the built extension as a signed CRX3 for self-hosted distribution (#254, part of #155).
//
// Run after `node build.mjs` (or via `pnpm pack:crx`, which does both):
//
//   node pack.mjs --key keys/assistant.pem --version 0.28.0
//
// Inputs: `dist/` (the unpacked extension), an RSA private key, a version. Outputs, into
// `dist-crx/`: `stamporama-assistant.crx` and `crx-metadata.json` — the pair the app serves, the
// latter being what `/assistant/update.xml` reports to Chrome.
//
// The key is not the extension's identity by accident: the same public key sits in `manifest.json`
// as `key`, so an unpacked dev load and a signed CRX share one extension ID, and a machine's Chrome
// policy entry keeps working across both.
import { createHash, createPrivateKey } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crx3, normalizeVersion, publicKeyDer, zip } from "./crx.mjs";
import { DEV_NAME_SUFFIX } from "./identity.mjs";

const root = dirname(fileURLToPath(import.meta.url));
// `build.mjs --release` writes here; `dist/` is always the dev build and is never packed.
const distdir = resolve(root, "dist-release");
const crxName = "stamporama-assistant.crx";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// `--out` writes straight into what the app serves (`../public/assistant`), which is how CI stages
// the pair into the image build context and how a local instance is tested.
const outdir = resolve(root, arg("out") ?? "dist-crx");

/**
 * The private key comes from a file (`--key`, local packing) or from `ASSISTANT_CRX_KEY` (CI — a
 * base64-encoded PEM, so the secret survives being a single-line repository secret).
 */
async function loadPrivateKey() {
  const keyPath = arg("key");
  if (keyPath) return createPrivateKey(await readFile(resolve(root, keyPath)));

  const encoded = process.env.ASSISTANT_CRX_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "No signing key. Pass --key <path/to/assistant.pem> or set ASSISTANT_CRX_KEY to a base64-encoded PEM."
    );
  }
  const pem = encoded.includes("BEGIN") ? encoded : Buffer.from(encoded, "base64").toString("utf8");
  return createPrivateKey(pem);
}

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
const privateKey = await loadPrivateKey();

const files = await collect(distdir);
if (!files.some(([name]) => name === "manifest.json")) {
  throw new Error(`No manifest.json in ${distdir}. Run \`node build.mjs --release\` first.`);
}

// Stamp the release identity into the copy of the manifest that goes into the archive:
//
// - the **version** mirrors the app release, so upgrading the instance is what makes Chrome see a
//   newer extension (`manifest.json` in the repo keeps its placeholder);
// - the **key** is the public half of the signing key, so the manifest states the same ID the
//   signature already proves — and can never drift from it, being derived here rather than copied.
const entries = [];
for (const [name, absolute] of files) {
  const contents = await readFile(absolute);
  if (name === "manifest.json") {
    const manifest = JSON.parse(contents.toString("utf8"));
    if (manifest.name.includes(DEV_NAME_SUFFIX)) {
      throw new Error(
        `${distdir} holds a dev build (${manifest.name}). Run \`pnpm pack:crx\`, which builds with --release.`
      );
    }
    manifest.version = version;
    manifest.key = publicKeyDer(privateKey).toString("base64");
    entries.push([name, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")]);
  } else {
    entries.push([name, contents]);
  }
}

const { crx, extensionId } = crx3(zip(entries), privateKey);

// Only the packer's own output directory is cleared; a `--out` target belongs to someone else
// (the app's `public/assistant`), so there we just write the two files.
if (outdir === resolve(root, "dist-crx")) await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(join(outdir, crxName), crx);
await writeFile(
  join(outdir, "crx-metadata.json"),
  `${JSON.stringify(
    {
      extensionId,
      version,
      file: crxName,
      bytes: crx.length,
      sha256: createHash("sha256").update(crx).digest("hex"),
    },
    null,
    2
  )}\n`
);

console.log(`[assistant] packed ${crxName} — id ${extensionId}, version ${version}, ${crx.length} bytes`);
