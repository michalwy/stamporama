// The CRX3 container is hand-written (crx.mjs), and a malformed one fails late and opaquely — at
// install time, on someone else's machine. These tests check the bytes we produce against the
// format's own rules: a readable ZIP, a signature that verifies over exactly the specified payload,
// and an extension id that matches the key in `manifest.json`.
import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
// @ts-expect-error — plain JS packaging helper, shared with pack.mjs; not part of the browser build.
import { crx3, extensionIdFor, normalizeVersion, publicKeyDer, toExtensionId, zip } from "./crx.mjs";
// @ts-expect-error — same: the build/pack flavour constants.
import { DEV_EXTENSION_ID, DEV_KEY, DEV_NAME_SUFFIX, RELEASE_EXTENSION_ID } from "./identity.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

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

/** Decode a protobuf varint at `offset`. */
function readVarint(buffer: Buffer, offset: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    const byte = buffer[cursor];
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, cursor];
    shift += 7;
  }
}

/** Decode a message of length-delimited fields into `fieldNumber → payloads`. */
function readMessage(buffer: Buffer): Map<number, Buffer[]> {
  const fields = new Map<number, Buffer[]>();
  let offset = 0;
  while (offset < buffer.length) {
    const [key, afterKey] = readVarint(buffer, offset);
    assert.equal(key & 0x07, 2, "only length-delimited fields are written");
    const [length, afterLength] = readVarint(buffer, afterKey);
    const payloads = fields.get(key >> 3) ?? [];
    payloads.push(buffer.subarray(afterLength, afterLength + length));
    fields.set(key >> 3, payloads);
    offset = afterLength + length;
  }
  return fields;
}

test("crx3 produces a Cr24 container whose signature verifies over the specified payload", () => {
  const archive = zip([["manifest.json", Buffer.from('{"manifest_version":3}')]]);
  const { crx, extensionId } = crx3(archive, privateKey);

  assert.equal(crx.subarray(0, 4).toString("ascii"), "Cr24");
  assert.equal(crx.readUInt32LE(4), 3, "CRX format version");

  const headerLength = crx.readUInt32LE(8);
  const header = readMessage(crx.subarray(12, 12 + headerLength));
  assert.deepEqual(crx.subarray(12 + headerLength), archive, "the archive follows the header untouched");

  const proof = readMessage(header.get(2)![0]); // sha256_with_rsa
  const publicKey = proof.get(1)![0];
  const signature = proof.get(2)![0];
  const signedHeaderData = header.get(10000)![0];

  const crxId = createHash("sha256").update(publicKeyDer(privateKey)).digest().subarray(0, 16);
  assert.deepEqual(publicKey, publicKeyDer(privateKey));
  assert.deepEqual(signedHeaderData, Buffer.concat([Buffer.from([0x0a, 0x10]), crxId]));
  assert.equal(extensionId, toExtensionId(crxId));

  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length, 0);
  const signed = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "utf8"),
    length,
    signedHeaderData,
    archive,
  ]);

  const verified = createVerify("sha256").update(signed).verify(createPublicKey(privateKey), signature);
  assert.equal(verified, true);
});

test("the shared manifest claims no identity of its own", () => {
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  // `key` is added per flavour — the dev key by build.mjs, the signing key by pack.mjs. A key here
  // would give both builds the same id again, and Chrome would refuse to load the second one.
  assert.equal(manifest.key, undefined);
  assert.ok(!manifest.name.includes(DEV_NAME_SUFFIX));
});

test("the dev build's committed key produces the documented dev id", () => {
  const der = Buffer.from(DEV_KEY, "base64");
  const id = toExtensionId(createHash("sha256").update(der).digest().subarray(0, 16));
  assert.equal(id, DEV_EXTENSION_ID);
  assert.notEqual(DEV_EXTENSION_ID, RELEASE_EXTENSION_ID);
});

// CI has no signing key (it arrives as a secret only for release tags), so this can only run where
// the key file does — which is where a rotation would actually be made.
const keyPath = new URL("./keys/assistant.pem", import.meta.url);
test(
  "the signing key still produces the documented release id",
  { skip: existsSync(keyPath) ? false : "no local signing key" },
  () => {
    // Every machine's Chrome policy entry names this id, and it is repeated in extension/README.md,
    // docs/user-guide/assistant.md and ADR-0016 — a rotation has to move all of them.
    assert.equal(extensionIdFor(createPrivateKey(readFileSync(keyPath))), RELEASE_EXTENSION_ID);
  }
);

test("extensionIdFor derives the same id from the private key", () => {
  const der = publicKeyDer(privateKey);
  const expected = toExtensionId(createHash("sha256").update(der).digest().subarray(0, 16));
  assert.equal(extensionIdFor(privateKey), expected);
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
