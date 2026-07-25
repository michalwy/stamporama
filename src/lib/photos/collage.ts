import sharp from "sharp";
import {
  layOutCollage,
  type CollageLayout,
  type CollageLayoutStyle,
} from "../collage-layout";

/**
 * Collage compositing for offer photos (#310) — the only genuinely new mechanism in the image
 * pipeline. Takes the scans of one planned image (#309) and produces the bytes to upload.
 *
 * True proportions
 * ----------------
 * Scans share a constant scanner DPI, so their pixel sizes already carry true relative sizes.
 * Tiles are composited at their native size (`src/lib/collage-layout.ts`) and the finished canvas is
 * scaled by **one shared factor** when the output limits are applied — never per tile, never per
 * row. Nothing here needs physical dimensions in millimetres.
 *
 * Output constraints
 * ------------------
 * Applied after compositing, from the platform's optional limits (#308), each skipped when absent:
 *
 * - **Longest edge** — `fit: "inside"`, the same convention as `FULL_MAX_EDGE` in `process.ts`.
 * - **File size** — new here: `process.ts` encodes once at a fixed quality and never looks at the
 *   result, which is fine for a single scan but not for a collage. Hitting a byte target needs
 *   iterative encoding, so quality is searched downwards and, only if even the lowest quality is
 *   too heavy, the canvas is shrunk further and the search repeats.
 *
 * Collages are always encoded as **JPEG**: the content is photo-like, and the quality knob is what
 * makes a byte target reachable at all (PNG has none, WebP is still refused by some marketplaces).
 * Source scans keep their own format — this is the offer-photo output format only.
 *
 * Stamps coming out small after a downscale is not warned about: picking a collage template suited
 * to the platform is the collector's call.
 */

/** The encoded output format for every collage. */
export const COLLAGE_MIME = "image/jpeg" as const;

/** Quality searched between these bounds when a file-size limit forces re-encoding. */
export const COLLAGE_QUALITY_MAX = 90;
export const COLLAGE_QUALITY_MIN = 40;

/** How far the canvas may shrink in pursuit of a byte target, and in how many rounds. Bounds keep
 * a pathological limit from grinding the image (and the loop) down indefinitely. */
const MIN_SIZE_SCALE = 0.2;
const MAX_SHRINK_ROUNDS = 4;

/** One tile's source bytes. `sharp` decodes and EXIF-rotates it before anything is measured. */
export interface CollageTileSource {
  buffer: Buffer;
}

/** The offer's collage values (#308) that affect rendering. `rows` is capacity and never appears
 * here: the canvas shrinks to the actual contents, so only `columns` shapes the packing. */
export interface CollageRenderStyle extends CollageLayoutStyle {
  /** Canvas colour as `#rrggbb` (normalised by `collage-template-rules.ts`). */
  background: string;
}

/** The platform's optional output limits (#308), read live at render time. */
export interface CollageOutputLimits {
  /** Longest edge in pixels, or null for no limit. */
  maxEdge: number | null;
  /** Max encoded size in bytes, or null for no limit. */
  maxBytes: number | null;
}

export interface RenderedCollage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: typeof COLLAGE_MIME;
  /** The JPEG quality the bytes were encoded at. */
  quality: number;
  /** The layout the tiles were composited with, at native scale — the label strips (#312) and tile
   * boxes in canvas coordinates, before any output-limit downscale. */
  layout: CollageLayout;
  /** True when even the smallest allowed encoding is still over `maxBytes`. The caller decides what
   * to do about it; the renderer returns its best attempt rather than throwing. */
  exceedsFileSizeLimit: boolean;
}

export class EmptyCollageError extends Error {}

/** One encoding of the finished canvas — a candidate for the output limits to accept or reject. */
interface Attempt {
  buffer: Buffer;
  width: number;
  height: number;
  quality: number;
}

/** A decoded, EXIF-rotated tile as raw pixels, ready to composite without a second decode. */
interface DecodedTile {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

async function decodeTile(source: CollageTileSource): Promise<DecodedTile> {
  const { data, info } = await sharp(source.buffer, { failOn: "error" })
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Composites the tiles onto the background and returns the finished canvas as raw pixels, so the
 * file-size search can re-encode it as often as it likes without compositing again.
 */
async function compositeCanvas(
  tiles: readonly DecodedTile[],
  layout: CollageLayout,
  background: string
): Promise<{ data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 }> {
  const canvas = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background,
    },
  }).composite(
    tiles.map((tile, index) => ({
      input: tile.data,
      raw: { width: tile.width, height: tile.height, channels: tile.channels },
      left: layout.tiles[index].x,
      top: layout.tiles[index].y,
    }))
  );

  const { data, info } = await canvas.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Renders one planned image (#309) to uploadable bytes.
 *
 * @throws {EmptyCollageError} when there are no tiles — the plan never emits an empty group, so an
 * empty call is a bug rather than a picture of nothing.
 */
export async function renderCollage(
  sources: readonly CollageTileSource[],
  style: CollageRenderStyle,
  limits: CollageOutputLimits = { maxEdge: null, maxBytes: null }
): Promise<RenderedCollage> {
  if (sources.length === 0) {
    throw new EmptyCollageError("A collage needs at least one tile.");
  }

  const tiles = await Promise.all(sources.map(decodeTile));
  const layout = layOutCollage(tiles, style);
  const canvas = await compositeCanvas(tiles, layout, style.background);

  const nativeEdge = Math.max(canvas.width, canvas.height);
  // One shared factor for the whole collage: the longest-edge limit only ever shrinks, so the true
  // relative sizes of the stamps survive it untouched.
  const limitedEdge =
    limits.maxEdge != null ? Math.min(nativeEdge, Math.max(1, limits.maxEdge)) : nativeEdge;

  const encode = async (quality: number, edge: number): Promise<Attempt> => {
    const { data, info } = await sharp(canvas.data, {
      raw: { width: canvas.width, height: canvas.height, channels: canvas.channels },
    })
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, quality };
  };

  const done = (attempt: Attempt, exceedsFileSizeLimit: boolean): RenderedCollage => ({
    ...attempt,
    mime: COLLAGE_MIME,
    layout,
    exceedsFileSizeLimit,
  });

  const maxBytes = limits.maxBytes;
  const full = await encode(COLLAGE_QUALITY_MAX, limitedEdge);
  if (maxBytes == null || full.buffer.byteLength <= maxBytes) return done(full, false);

  /** The largest quality that fits at this size, by bisection — encoded size grows monotonically
   * enough with quality for a handful of encodes to land on a sensible value. `floor` is the
   * smallest encoding tried, kept as the best effort when nothing fits. */
  const searchQuality = async (edge: number) => {
    let low = COLLAGE_QUALITY_MIN;
    let high = COLLAGE_QUALITY_MAX;
    let best: Attempt | null = null;
    let floor: Attempt | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = await encode(mid, edge);
      if (candidate.buffer.byteLength <= maxBytes) {
        best = candidate;
        low = mid + 1;
      } else {
        floor = candidate;
        high = mid - 1;
      }
    }
    return { best, floor };
  };

  // Too heavy at full quality. Search the quality range first — it costs no pixels — and shrink the
  // canvas only when even the floor quality does not fit.
  let scale = 1;
  let smallest = full;
  for (let round = 0; round <= MAX_SHRINK_ROUNDS; round += 1) {
    const edge = Math.max(1, Math.round(limitedEdge * scale));
    const { best, floor } = await searchQuality(edge);
    if (best) return done(best, false);
    if (floor) smallest = floor;

    // Nothing fit at this size. Shrink by the measured overshoot — encoded bytes track pixel area
    // closely enough — and run the whole search again, with a guaranteed step so it always ends.
    const measured = scale * Math.sqrt(maxBytes / smallest.buffer.byteLength) * 0.95;
    const next = Math.max(MIN_SIZE_SCALE, Math.min(measured, scale * 0.9));
    if (next >= scale) break;
    scale = next;
  }

  return done(smallest, true);
}
