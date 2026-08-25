import sharp from "sharp";
import {
  collageGap,
  layOutCollage,
  pairedCellGap,
  trueSizeScales,
  type CollageLayout,
  type CollageLayoutStyle,
  type CollageTileSize,
  type CollageTileTrueSize,
} from "../collage-layout";
import { collageLabelSvg, type TileLabelTexts } from "../collage-label";

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
 * The upload pipeline is the one thing that breaks this, and `trueSizeScales` is the repair: a scan
 * over `FULL_MAX_EDGE` is stored downscaled, so a tile that was clamped and one that was not are no
 * longer on a common scale. Each tile's recorded original size says how far it was shrunk, and the
 * tiles are scaled back into agreement **downwards** before anything is measured — so a block twice
 * the size of its neighbour composites twice as large again. Photos predating those recorded
 * originals read as un-downscaled and behave exactly as they did before.
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
 *
 * Labels
 * ------
 * Each tile's two annotations (#312) are drawn on the strip the layout reserves below it, from the
 * text the caller resolved against that copy. Text layout lives in `src/lib/collage-label.ts`; here it is one
 * more composite, applied before the output limits so labels scale with the stamps.
 *
 * Paired cells
 * ------------
 * In paired mode (#694) a cell holds a copy's two scans side by side. They are joined into **one
 * tile** before the layout runs, which is what keeps the geometry a single mechanism: `collage-layout`
 * never learns about pairs, a paired cell is simply a wider tile, the grid and the `auto` solver
 * score it as one, and the label strip spans the pair for free because it is as wide as its tile.
 *
 * The one thing that cannot be done per cell is the true-size correction: `trueSizeScales`
 * normalises against the worst-shrunk scan on the image, so it is solved over every scan — both
 * members of every pair — and only then are the pairs joined. The two scans are separated by half
 * the collage's own gap and centred against each other vertically, so a cell reads as one stamp
 * seen from both sides rather than as two stamps that happen to be close.
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

/** One scan's bytes and the size it was uploaded at — a tile, or the reverse sharing its cell. */
export interface CollageScanSource {
  buffer: Buffer;
  /** The dimensions this scan was uploaded at, before `FULL_MAX_EDGE` clamped the bytes. Absent
   * reads as "never downscaled". */
  originalSize?: CollageTileSize | null;
}

/** One tile's source bytes. `sharp` decodes and EXIF-rotates it before anything is measured. */
export interface CollageTileSource {
  buffer: Buffer;
  /** The reverse scan drawn beside `buffer` in the same cell, in paired mode (#694). Absent
   * everywhere else — including for a paired copy that has only one of its two scans, which is a
   * single-scan tile like any other. */
  pair?: CollageScanSource | null;
  /** The dimensions this scan was uploaded at, before `FULL_MAX_EDGE` clamped the bytes above.
   * Absent — or absent on the photo row, for anything uploaded before they were recorded — reads
   * as "never downscaled", which is what the renderer assumed of everything until now. */
  originalSize?: CollageTileSize | null;
  /** The two annotations drawn on the tile's label strip (#312), already resolved from the offer's
   * left / right label templates against this copy. Blank or absent leaves that side undrawn — a
   * copy with no value for a template's tokens is not special-cased. */
  labels?: TileLabelTexts | null;
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

async function decodeTile(buffer: Buffer): Promise<DecodedTile> {
  const { data, info } = await sharp(buffer, { failOn: "error" })
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Put one decoded tile back on the collage's common scale (`trueSizeScales`). A factor of 1 — every
 * tile, whenever no scan hit `FULL_MAX_EDGE` — returns the tile untouched, so the usual render is
 * exactly the decode it always was. Rounding never yields 0: a tile has to stay compositable.
 */
async function rescaleTile(tile: DecodedTile, scale: number): Promise<DecodedTile> {
  if (scale >= 1) return tile;
  const width = Math.max(1, Math.round(tile.width * scale));
  const height = Math.max(1, Math.round(tile.height * scale));
  const { data, info } = await sharp(tile.data, {
    raw: { width: tile.width, height: tile.height, channels: tile.channels },
  })
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Joins a cell's two scans into one tile (#694): front, a gap, back, each centred against the taller
 * of the two, on the collage's own background so the seam is invisible.
 *
 * The result is an ordinary decoded tile, which is the point — from here on nothing downstream can
 * tell a paired cell from a single scan, so the layout, the label strip and the output limits are
 * the same single mechanism they were.
 */
async function joinPair(
  main: DecodedTile,
  pair: DecodedTile,
  gap: number,
  background: string
): Promise<DecodedTile> {
  const width = main.width + gap + pair.width;
  const height = Math.max(main.height, pair.height);
  const { data, info } = await sharp({
    create: { width, height, channels: 3, background },
  })
    .composite([
      {
        input: main.data,
        raw: { width: main.width, height: main.height, channels: main.channels },
        left: 0,
        top: Math.round((height - main.height) / 2),
      },
      {
        input: pair.data,
        raw: { width: pair.width, height: pair.height, channels: pair.channels },
        left: main.width + gap,
        top: Math.round((height - pair.height) / 2),
      },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Composites the tiles — and the label strips over them (#312) — onto the background and returns the
 * finished canvas as raw pixels, so the file-size search can re-encode it as often as it likes
 * without compositing again.
 *
 * The labels are one canvas-sized SVG layer rather than one overlay per strip: a single composite
 * keeps the text at the layout's native scale, where it shrinks with the stamps under the output
 * limits instead of growing relative to them.
 */
async function compositeCanvas(
  tiles: readonly DecodedTile[],
  labels: readonly (TileLabelTexts | null | undefined)[],
  layout: CollageLayout,
  background: string
): Promise<{ data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 }> {
  const svg = collageLabelSvg(layout, labels, background);
  const canvas = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background,
    },
  }).composite([
    ...tiles.map((tile, index) => ({
      input: tile.data,
      raw: { width: tile.width, height: tile.height, channels: tile.channels },
      left: layout.tiles[index].x,
      top: layout.tiles[index].y,
    })),
    ...(svg ? [{ input: Buffer.from(svg), left: 0, top: 0 }] : []),
  ]);

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

  // Every scan on the image, in one flat list: a paired cell's two scans (#694) sit next to each
  // other, because the true-size correction is normalised across the whole image and cannot be
  // solved a cell at a time.
  const scans: { source: CollageScanSource; cell: number }[] = [];
  sources.forEach((source, cell) => {
    scans.push({ source, cell });
    if (source.pair) scans.push({ source: source.pair, cell });
  });

  const decoded = await Promise.all(scans.map((scan) => decodeTile(scan.source.buffer)));
  const scaled = await Promise.all(
    trueSizeScales(
      decoded.map<CollageTileTrueSize>((tile, index) => ({
        stored: { width: tile.width, height: tile.height },
        original: scans[index].source.originalSize ?? null,
      }))
    ).map((scale, index) => rescaleTile(decoded[index], scale))
  );

  // The gap the pairs are spaced by is the collage's own, asked for before they are joined. Safe to
  // ask this early: it is taken of tile *heights*, and joining a cell changes only its width.
  const cells: DecodedTile[][] = sources.map(() => []);
  scaled.forEach((tile, index) => cells[scans[index].cell].push(tile));
  const gap = collageGap(
    cells.map((cell) => ({
      width: 0,
      height: cell.reduce((tallest, tile) => Math.max(tallest, tile.height), 0),
    })),
    style.gapPercent
  );
  const tiles = await Promise.all(
    cells.map((cell) =>
      cell.length > 1
        ? joinPair(cell[0], cell[1], pairedCellGap(gap), style.background)
        : cell[0]
    )
  );

  const layout = layOutCollage(tiles, style);
  const canvas = await compositeCanvas(
    tiles,
    sources.map((s) => s.labels),
    layout,
    style.background
  );

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
