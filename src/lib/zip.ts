// A deterministic ZIP writer (#314). Used to hand an offer's whole photo plan over as one archive
// the collector drops into a marketplace's bulk upload.
//
// Dependency-free on purpose, and for the same reason as `extension/archive.mjs` (which writes the
// Chrome Web Store package): a ZIP is ~80 lines of well-specified format, less than the cost of a
// packaging library in the dependency tree. The two are deliberately separate — that one is a build
// script outside the app's module graph and ships in the extension workspace.
//
// Scope: no ZIP64, so an archive is limited to 4 GiB and 65535 entries. A photo plan is a handful of
// images bounded by the platform's own photo-count and file-size limits (#308), which is orders of
// magnitude below either.
import { deflateRawSync } from "node:zlib";

/** One file in the archive: its name as it appears when unzipped, and its bytes. */
export interface ZipEntry {
  name: string;
  contents: Buffer;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write a ZIP archive from `entries`, keeping their order. Timestamps are fixed at the DOS epoch, so
 * the same inputs always produce the same bytes — an archive downloaded twice from unchanged images
 * is byte-identical, which is the same promise the stored images themselves make (#311).
 *
 * Each entry is deflated only when that actually makes it smaller. Collages are already-compressed
 * images, so in practice they are stored verbatim and the archive costs almost no CPU.
 */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const DOS_DATE = 0x0021; // 1980-01-01
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { name, contents } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(contents, { level: 9 });
    const stored = deflated.length >= contents.length;
    const payload = stored ? contents : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
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
    entry.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
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
