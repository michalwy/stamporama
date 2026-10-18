// A deterministic ZIP writer (#314). Used to hand an offer's whole photo plan over as one archive
// the collector drops into a marketplace's bulk upload.
//
// Dependency-free on purpose, and for the same reason as `extension/archive.mjs` (which writes the
// Chrome Web Store package): a ZIP is ~80 lines of well-specified format, less than the cost of a
// packaging library in the dependency tree. The two are deliberately separate — that one is a build
// script outside the app's module graph and ships in the extension workspace.
//
// The format is `zip-format.ts`, shared with the browser since #2052; this is its Node face, which
// supplies the deflate.
import { deflateRawSync } from "node:zlib";
import { crc32 as crc32Bytes, writeZip } from "./zip-format";

/** One file in the archive: its name as it appears when unzipped, and its bytes. */
export interface ZipEntry {
  name: string;
  contents: Buffer;
}

export function crc32(buffer: Buffer): number {
  return crc32Bytes(buffer);
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
  const bytes = writeZip(entries, (contents) => deflateRawSync(contents, { level: 9 }));
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
