// The bytes behind the album's faces (#768): the one place that opens a font file.
//
// `album-fonts.ts` says which faces exist; this says where each one's bytes are and hands out a
// parsed `fontkit` face. Two callers, and they must not be able to disagree: `album-metrics.ts`
// measures through the face, and `album-pdf.ts` embeds the same bytes into the document. Measuring
// one file and embedding another is exactly the drift the single measurer exists to prevent, so
// there is one lookup and both go through it.
//
// ## The file name is the face id
//
// `src/fonts/album/liberation-sans-bold-italic.ttf` is the face `liberation-sans-bold-italic`.
// No mapping table, so a face `album-fonts.ts` ships and a file on disk cannot drift apart — a
// missing one is a missing file, which {@link loadAlbumFace} says out loud rather than silently
// substituting a face the collector did not choose.
//
// ## Why `process.cwd()` and not a bundled import
//
// The production image ships `src/` (see the Dockerfile) and Next never bundles what it is not
// asked to import, so a path relative to the working directory resolves in `next dev`, in
// `next build`'s server output and in the container alike — the idiom `storage/filesystem.ts`
// already uses for the data directory. Importing 8.7 MB of TTF through webpack would put every
// face into a server chunk whether or not a template names it.
//
// ## Deliberately not `server-only`
//
// The client is not allowed to measure at all (ADR-0045 §7), so nothing here has any business in a
// browser bundle — but this module is reached from `album-metrics.ts`, which `test:unit` imports
// and runs on plain Node. A `server-only` import there would fail the suite rather than protect
// anything.

import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { Font } from "@pdf-lib/fontkit";
import { isAlbumFaceId } from "./album-fonts";

/** Where the shipped faces live, relative to the working directory. */
export const ALBUM_FONT_DIR = path.join("src", "fonts", "album");

/** Thrown when a face this build claims to ship has no bytes on disk — a packaging fault, not a
 *  collector's mistake, so it names the file rather than falling back to another face. */
export class AlbumFontError extends Error {}

/** Parsed faces, keyed by face id. Pinned to `globalThis` so `next dev`'s HMR cannot stack a second
 *  copy of 8.7 MB of glyph data on every recompile — `db.ts`'s and `storage/index.ts`'s rule, and
 *  the same failure mode: a module-level `Map` is re-created per reload while the old one stays
 *  reachable from the module instance the previous render closed over. */
const globalForAlbumFonts = globalThis as unknown as {
  albumFontBytes?: Map<string, Uint8Array>;
  albumFontFaces?: Map<string, Font>;
};

function bytesCache(): Map<string, Uint8Array> {
  if (!globalForAlbumFonts.albumFontBytes) globalForAlbumFonts.albumFontBytes = new Map();
  return globalForAlbumFonts.albumFontBytes;
}

function faceCache(): Map<string, Font> {
  if (!globalForAlbumFonts.albumFontFaces) globalForAlbumFonts.albumFontFaces = new Map();
  return globalForAlbumFonts.albumFontFaces;
}

/** The path a face's bytes sit at. Exported so a test can check the shipped set against the
 *  directory without duplicating the naming rule. */
export function albumFontPath(faceId: string): string {
  return path.join(ALBUM_FONT_DIR, `${faceId}.ttf`);
}

/**
 * The raw TTF bytes of a face, cached.
 *
 * Read synchronously and on demand: a face is opened once per process, the files are local, and an
 * async read here would make the measurer async — which would push `await` into the pure layout
 * engine that must stay pure.
 */
export function loadAlbumFontBytes(faceId: string): Uint8Array {
  const cached = bytesCache().get(faceId);
  if (cached) return cached;
  if (!isAlbumFaceId(faceId)) {
    throw new AlbumFontError(`Not a face this build ships: ${faceId}`);
  }
  const file = path.join(process.cwd(), albumFontPath(faceId));
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(file));
  } catch (err) {
    throw new AlbumFontError(
      `The face "${faceId}" is shipped but its bytes are missing at ${file}: ${String(err)}`
    );
  }
  bytesCache().set(faceId, bytes);
  return bytes;
}

/**
 * The parsed face, cached.
 *
 * This is the object `album-metrics.ts` measures with, and pdf-lib parses the *same bytes* with the
 * same engine when it embeds them — which is why the measured width and the drawn width are the
 * same number rather than two estimates that happen to be close.
 */
export function loadAlbumFace(faceId: string): Font {
  const cached = faceCache().get(faceId);
  if (cached) return cached;
  const font = fontkit.create(loadAlbumFontBytes(faceId));
  faceCache().set(faceId, font);
  return font;
}
