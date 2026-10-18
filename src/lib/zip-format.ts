// The ZIP format itself (#314), with no Node import — so the server's archives (`zip.ts`) and the
// browser's one-off collage download (#2052) write the same bytes. Deflating is the caller's to
// supply: Node has it to hand, and the browser stores every entry as it is, which for a JPEG is what
// the server ends up doing anyway.
//
// Scope: no ZIP64, so an archive is limited to 4 GiB and 65535 entries. A photo plan is a handful of
// images bounded by the platform's own photo-count and file-size limits (#308), which is orders of
// magnitude below either.

/** One file in the archive: its name as it appears when unzipped, and its bytes. */
export interface ZipFormatEntry {
  name: string;
  contents: Uint8Array;
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

export function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Write a ZIP archive from `entries`, keeping their order. Timestamps are fixed at the DOS epoch, so
 * the same inputs always produce the same bytes. Each entry is deflated only when `deflate` is given
 * and that actually makes it smaller; otherwise it is stored verbatim.
 */
export function writeZip(
  entries: readonly ZipFormatEntry[],
  deflate?: (contents: Uint8Array) => Uint8Array
): Uint8Array<ArrayBuffer> {
  const DOS_DATE = 0x0021; // 1980-01-01
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const { name, contents } of entries) {
    const nameBytes = encoder.encode(name);
    const deflated = deflate ? deflate(contents) : null;
    const stored = !deflated || deflated.length >= contents.length;
    const payload = stored ? contents : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(contents);

    const local = new Uint8Array(30);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed
    l.setUint16(6, 0x0800, true); // flags: UTF-8 names
    l.setUint16(8, method, true);
    l.setUint16(10, 0, true); // mod time
    l.setUint16(12, DOS_DATE, true); // mod date
    l.setUint32(14, crc, true);
    l.setUint32(18, payload.length, true);
    l.setUint32(22, contents.length, true);
    l.setUint16(26, nameBytes.length, true);
    l.setUint16(28, 0, true); // extra length
    locals.push(local, nameBytes, payload);

    const entry = new Uint8Array(46);
    const e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true); // version made by
    e.setUint16(6, 20, true); // version needed
    e.setUint16(8, 0x0800, true); // flags: UTF-8 names
    e.setUint16(10, method, true);
    e.setUint16(12, 0, true); // mod time
    e.setUint16(14, DOS_DATE, true); // mod date
    e.setUint32(16, crc, true);
    e.setUint32(20, payload.length, true);
    e.setUint32(24, contents.length, true);
    e.setUint16(28, nameBytes.length, true);
    e.setUint16(30, 0, true); // extra length
    e.setUint16(32, 0, true); // comment length
    e.setUint16(34, 0, true); // disk number
    e.setUint16(36, 0, true); // internal attributes
    e.setUint32(38, 0, true); // external attributes
    e.setUint32(42, offset, true);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(4, 0, true); // this disk
  d.setUint16(6, 0, true); // disk with central directory
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, centralBytes.length, true);
  d.setUint32(16, offset, true);
  d.setUint16(20, 0, true); // comment length

  return concat([...locals, centralBytes, end]);
}
