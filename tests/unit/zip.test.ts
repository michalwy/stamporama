import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { crc32, zip } from "../../src/lib/zip";

// The photo-plan archive (#314) is a hand-written ZIP, and a malformed one fails opaquely — in the
// collector's file manager, after the download. So these tests read the bytes back out of it.

/** Read entries back by walking the local file headers, in the order they were written. */
function readEntries(archive: Buffer): { name: string; contents: Buffer }[] {
  const entries: { name: string; contents: Buffer }[] = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const uncompressedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressedSize);
    const contents = method === 0 ? Buffer.from(payload) : inflateRawSync(payload);
    assert.equal(contents.length, uncompressedSize, `${name} declares its uncompressed size`);
    assert.equal(archive.readUInt32LE(offset + 14), crc32(contents), `${name} CRC`);
    entries.push({ name, contents });
    offset = start + compressedSize;
  }
  return entries;
}

/** The end-of-central-directory record, which every unzip reads first. */
function readEnd(archive: Buffer) {
  const at = archive.length - 22;
  assert.equal(archive.readUInt32LE(at), 0x06054b50, "EOCD signature");
  return {
    count: archive.readUInt16LE(at + 8),
    centralSize: archive.readUInt32LE(at + 12),
    centralOffset: archive.readUInt32LE(at + 16),
  };
}

describe("zip", () => {
  it("round-trips its entries in order, with a matching central directory", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const text = Buffer.from("plan".repeat(200), "utf8");
    const archive = zip([
      { name: "01.jpg", contents: jpeg },
      { name: "02.jpg", contents: text },
    ]);

    const entries = readEntries(archive);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["01.jpg", "02.jpg"]
    );
    assert.deepEqual(entries[0].contents, jpeg);
    assert.deepEqual(entries[1].contents, text);

    const end = readEnd(archive);
    assert.equal(end.count, 2);
    // The central directory sits directly after the last entry's payload and runs to the EOCD.
    assert.equal(end.centralOffset + end.centralSize, archive.length - 22);
    assert.equal(archive.readUInt32LE(end.centralOffset), 0x02014b50);
  });

  it("stores already-compressed bytes verbatim rather than growing them", () => {
    // Incompressible payload: deflate would come out larger, so the writer must fall back to store.
    const noise = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 137 + ((i * i) % 251)) % 256)
    );
    const archive = zip([{ name: "01.jpg", contents: noise }]);

    assert.equal(archive.readUInt16LE(8), 0, "stored, method 0");
    assert.deepEqual(readEntries(archive)[0].contents, noise);
  });

  it("deflates when that actually helps", () => {
    const repetitive = Buffer.from("a".repeat(10_000), "utf8");
    const archive = zip([{ name: "notes.txt", contents: repetitive }]);

    assert.equal(archive.readUInt16LE(8), 8, "deflated, method 8");
    assert.ok(archive.length < repetitive.length / 2);
    assert.deepEqual(readEntries(archive)[0].contents, repetitive);
  });

  it("keeps non-ASCII names readable and flags them as UTF-8", () => {
    const archive = zip([{ name: "Węgry — 01.jpg", contents: Buffer.from("x") }]);

    assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800, "UTF-8 name flag");
    assert.equal(readEntries(archive)[0].name, "Węgry — 01.jpg");
  });

  it("is deterministic — same input, same bytes", () => {
    const entries = [{ name: "01.jpg", contents: Buffer.from("abc") }];
    assert.deepEqual(zip(entries), zip(entries));
  });

  it("writes a readable empty archive", () => {
    const archive = zip([]);

    assert.equal(archive.length, 22);
    assert.equal(readEnd(archive).count, 0);
    assert.deepEqual(readEntries(archive), []);
  });
});
