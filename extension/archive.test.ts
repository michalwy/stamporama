// The store package is a hand-written ZIP (archive.mjs), and a malformed one fails late and
// opaquely — on upload, or worse, in review. These tests read the bytes back out of it, and pin the
// dev build's identity, which is what keeps the unpacked copy from colliding with the store one.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
// @ts-expect-error — plain JS packaging helper, shared with pack.mjs; not part of the browser build.
import { normalizeVersion, toExtensionId, zip } from "./archive.mjs";
// @ts-expect-error — same: the build/pack flavour constants.
import { DEV_EXTENSION_ID, DEV_KEY, DEV_NAME_SUFFIX } from "./identity.mjs";

/** Read a stored/deflated entry back out of an archive by walking its local file headers. */
function readZipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(payload) : inflateRawSync(payload));
    offset = start + compressedSize;
  }
  return entries;
}

test("zip round-trips its entries and ends with a matching central directory", () => {
  const contents = Buffer.from("x".repeat(500) + JSON.stringify({ manifest_version: 3 }), "utf8");
  const archive = zip([
    ["manifest.json", contents],
    ["icons/icon-16.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ]);

  const entries = readZipEntries(archive);
  assert.equal(entries.size, 2);
  assert.deepEqual(entries.get("manifest.json"), contents);
  assert.deepEqual(entries.get("icons/icon-16.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const eocd = archive.length - 22;
  assert.equal(archive.readUInt32LE(eocd), 0x06054b50);
  assert.equal(archive.readUInt16LE(eocd + 8), 2, "entry count");
});

test("zip is deterministic — same input, same bytes", () => {
  const entries: [string, Buffer][] = [["a.js", Buffer.from("console.log(1)")]];
  assert.deepEqual(zip(entries), zip(entries));
});

test("the shared manifest claims no identity of its own", () => {
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  // `key` belongs to the dev build alone, added by build.mjs. In an uploaded package it would fight
  // the identity the Chrome Web Store assigns; in the shared manifest it would give both builds the
  // same id, and Chrome would refuse to load the second one.
  assert.equal(manifest.key, undefined);
  assert.ok(!manifest.name.includes(DEV_NAME_SUFFIX));
});

test("the dev build's committed key produces the documented dev id", () => {
  const der = Buffer.from(DEV_KEY, "base64");
  const id = toExtensionId(createHash("sha256").update(der).digest().subarray(0, 16));
  assert.equal(id, DEV_EXTENSION_ID);
});

test("normalizeVersion keeps what Chrome accepts and trims what it does not", () => {
  const silent = () => {};
  assert.equal(normalizeVersion("0.28.0", silent), "0.28.0");
  assert.equal(normalizeVersion("1", silent), "1");
  assert.equal(normalizeVersion("1.2.3.4", silent), "1.2.3.4");
  assert.equal(normalizeVersion("dev", silent), "0.0.0");
  assert.equal(normalizeVersion(undefined, silent), "0.0.0");
  assert.equal(normalizeVersion("0.28.0-rc.1", silent), "0.28.0");
  assert.throws(() => normalizeVersion("nightly", silent));
});
