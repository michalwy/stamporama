// CRX3 packaging primitives (#254, part of #155) — a deterministic ZIP writer and the signed CRX3
// container, used by `pack.mjs` and exercised by `crx.test.ts`.
//
// Deliberately dependency-free: a CRX is a small protobuf header plus a ZIP, and both are
// well-specified enough to write here rather than pulling in a packaging library.
import { createHash, createPublicKey, createSign } from "node:crypto";
import { deflateRawSync } from "node:zlib";

// ---------------------------------------------------------------------------- ZIP

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write a ZIP archive from `[name, contents]` pairs. Timestamps are fixed at the DOS epoch and
 * entries keep the given order, so the same input bytes always produce the same archive — a
 * rebuild that changed nothing is byte-identical, signature included.
 */
export function zip(entries) {
  const DOS_DATE = 0x0021; // 1980-01-01
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(contents, { level: 9 });
    // Only take the compressed form when it actually helps; tiny files can grow.
    const stored = deflated.length >= contents.length;
    const payload = stored ? contents : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(DOS_DATE, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBytes, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0, 8); // flags
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0, 12); // mod time
    entry.writeUInt16LE(DOS_DATE, 14); // mod date
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(contents.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra length
    entry.writeUInt16LE(0, 32); // comment length
    entry.writeUInt16LE(0, 34); // disk number
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBytes, end]);
}

// ---------------------------------------------------------------------------- CRX3

/** Protobuf varint. */
function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** Protobuf length-delimited field (wire type 2). */
function field(number, payload) {
  return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]);
}

function uint32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

/** Chrome renders the 16-byte crx id as 32 letters: each hex nibble mapped 0-f → a-p. */
export function toExtensionId(crxId) {
  return [...crxId]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join("");
}

/** The DER SubjectPublicKeyInfo that both `manifest.json`'s `key` and the CRX proof carry. */
export function publicKeyDer(privateKey) {
  return createPublicKey(privateKey).export({ type: "spki", format: "der" });
}

/** The extension id a given key produces — the same value for an unpacked load and a CRX. */
export function extensionIdFor(privateKey) {
  return toExtensionId(createHash("sha256").update(publicKeyDer(privateKey)).digest().subarray(0, 16));
}

/**
 * Build a CRX3 file: `Cr24` + format version + header length + a `CrxFileHeader` protobuf + the
 * ZIP. The header carries one RSA proof (the public key and a signature) plus `signed_header_data`,
 * which pins the extension id the archive claims. The signature covers a magic string, that signed
 * header data, and the whole archive, so neither the id nor a single file can be swapped.
 */
export function crx3(zipBytes, privateKey) {
  const publicKey = publicKeyDer(privateKey);
  const crxId = createHash("sha256").update(publicKey).digest().subarray(0, 16);

  const signedHeaderData = field(1, crxId); // CrxFileHeaderSignedData { bytes crx_id = 1 }
  const signedPayload = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "utf8"),
    uint32le(signedHeaderData.length),
    signedHeaderData,
    zipBytes,
  ]);

  const signature = createSign("sha256").update(signedPayload).sign(privateKey);
  const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
  const header = Buffer.concat([
    field(2, proof), // CrxFileHeader.sha256_with_rsa
    field(10000, signedHeaderData), // CrxFileHeader.signed_header_data
  ]);

  const prefix = Buffer.concat([Buffer.from("Cr24", "ascii"), uint32le(3), uint32le(header.length)]);

  return { crx: Buffer.concat([prefix, header, zipBytes]), extensionId: toExtensionId(crxId) };
}

/**
 * Chrome accepts one to four dot-separated integers. Release tags are plain semver (`0.28.0`), but
 * anything with a pre-release suffix would be rejected at install time, so trim to the numeric
 * prefix rather than shipping an unloadable CRX. Unversioned/dev packs become `0.0.0`.
 */
export function normalizeVersion(raw, warn = console.warn) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "dev") return "0.0.0";
  const match = trimmed.match(/^\d+(\.\d+){0,3}/);
  if (!match) throw new Error(`Version "${trimmed}" has no numeric prefix Chrome could use.`);
  if (match[0] !== trimmed) warn(`[assistant] version "${trimmed}" trimmed to "${match[0]}" for Chrome.`);
  return match[0];
}
