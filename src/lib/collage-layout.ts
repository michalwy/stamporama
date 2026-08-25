/**
 * Pure geometry for offer photo collages (#310) — no `sharp`, no Prisma, so the packing rules are
 * unit-testable on plain numbers and could later drive a client-side preview.
 *
 * True proportions
 * ----------------
 * Stamps are **scanned**, not photographed, so scanner DPI is constant and the pixel dimensions of
 * the scans already carry true relative sizes. The layout therefore places every tile at its native
 * pixel size — no per-tile rescaling — and the whole canvas is scaled by one shared factor later,
 * when the platform's output limits are applied. The real size relationships survive for free.
 *
 * Packing
 * -------
 * - **Row-based**, not a uniform cell grid: a row is as tall as its tallest stamp, and each tile is
 *   vertically centred within that band. A short stamp next to a tall one is not stretched.
 * - Rows hold up to `columns` tiles. `rows × columns` from the collage template is **capacity, not
 *   a frame** (#307): the canvas shrinks to the actual contents, so four tiles under a 5×4 template
 *   give a one-row image — or, in the template's `auto` mode (#413), a 2 × 2 one, because there the
 *   two numbers are bounds and `resolveCollageColumns` solves the width from the tiles themselves —
 *   their sizes, not just how many there are (#514).
 * - Rows are **centred** horizontally against the widest row. Justified rows (the photo-gallery
 *   look, each row stretched to full width) are explicitly rejected — they scale each row by a
 *   different factor and would destroy the true proportions that are the point of the feature.
 * - `gap` separates tiles and rows and also serves as the outer margin, so nothing touches the edge.
 * - Every tile gets a **label strip** below it, as wide as the tile, drawn by `collage-label.ts`
 *   (#312); a height of 0 simply reserves nothing.
 *
 * Sizes as percentages, and what of
 * ---------------------------------
 * Neither the gap nor the label strip is a pixel count (#312): a pixel number would have to be
 * chosen without knowing the scan DPI or how far the platform's limits will shrink the finished
 * image. They are percentages — but of **two different things**, because they answer two different
 * questions:
 *
 * - **Gap** — a percent of the **median tile height**. Spacing between stamps is a property of the
 *   stamps, and the median rather than the tallest so one oversized souvenir sheet cannot inflate
 *   the whole page. (The median of an even count takes the lower middle: arbitrary, but stable.)
 * - **Label strip** — a percent of the finished image's **longest edge** (#337). Every image of a
 *   listing is scaled to the same platform limit before it is uploaded, so a share of the longest
 *   edge is the one measure that renders at the same size on all of them. Taking it off the stamp
 *   was the first attempt and it broke on exactly the images that need a caption most: a wide
 *   detail crop has no "stamp height" worth the name, so its caption came out a third of the size of
 *   the one on the full scan beside it.
 *
 * The strip is therefore circular — it grows the canvas it is a share of — and is solved for below
 * rather than multiplied out.
 *
 * A single stamp is a 1×1 collage, so this is the only layout path there is.
 */

import type { CollageGridMode } from "./collage-template-rules";

/** The native pixel size of one scan. */
export interface CollageTileSize {
  width: number;
  height: number;
}

/** One tile's stored size paired with the size its upload was measured at, before the
 * `FULL_MAX_EDGE` downscale. Equal whenever the scan came in under the cap. */
export interface CollageTileTrueSize {
  stored: CollageTileSize;
  /** Null for a photo predating the recorded originals — read as "never downscaled". */
  original: CollageTileSize | null;
}

/**
 * The factor each tile must be scaled by so that all of them sit on one common scale again.
 *
 * The renderer's "true proportions" rest on every scan sharing a scanner DPI, which makes stored
 * pixel sizes proportional to physical ones. `FULL_MAX_EDGE` breaks that: a scan clamped to 2500 px
 * and one that arrived at 2400 px come out nearly the same size however far apart their originals
 * were. Each tile's own shrink factor `r = originalEdge / storedEdge` is what recovers the ratio.
 *
 * Normalised against `max(r)` rather than `min(r)`, so every factor lands in `(0, 1]` and the
 * correction is applied by **downscaling** — never by interpolating a clamped tile back up, which
 * would spend real pixels on invented ones. The resolution the smaller tiles give up is largely
 * notional: the finished canvas is scaled to the platform's output limits afterwards anyway.
 *
 * Returns all-1 when nothing was downscaled, which is both the common case and what every photo
 * predating the recorded originals falls back to.
 */
export function trueSizeScales(tiles: readonly CollageTileTrueSize[]): number[] {
  const shrink = tiles.map((tile) => {
    const stored = Math.max(tile.stored.width, tile.stored.height);
    const original = tile.original
      ? Math.max(tile.original.width, tile.original.height)
      : 0;
    // A stored edge of 0 is not renderable anyway; an original at or below the stored size means
    // the scan was never clamped. Either way the tile is left where it is.
    if (stored <= 0 || original <= stored) return 1;
    return original / stored;
  });
  const worst = shrink.reduce((max, r) => Math.max(max, r), 1);
  return shrink.map((r) => r / worst);
}

/**
 * The sizes the tiles will actually composite at — `trueSizeScales` applied to the stored ones.
 *
 * The renderer arrives at the same numbers from the decoded pixels; this reaches them from the photo
 * rows instead, which is what lets the grid be solved (#514) before a single scan is decoded. The
 * two agree because stored dimensions are recorded EXIF-rotated, the same normalisation the decode
 * applies. Sub-pixel and never rounded: nothing is drawn from these, only measured.
 */
export function trueScaledSizes(tiles: readonly CollageTileTrueSize[]): CollageTileSize[] {
  return trueSizeScales(tiles).map((scale, index) => ({
    width: tiles[index].stored.width * scale,
    height: tiles[index].stored.height * scale,
  }));
}

/**
 * One tile as the plan names it: the scan drawn in it and, in paired mode (#694), the reverse drawn
 * beside it in the same cell. `pair` is null for every other mode — and for a copy in paired mode
 * that has only one of its two scans, which is a single-scan cell like any other.
 */
export interface CollagePlannedTileSize {
  main: CollageTileTrueSize;
  pair: CollageTileTrueSize | null;
}

/**
 * The sizes paired cells measure as (#694) — the two scans joined, side by side.
 *
 * The scaling is solved over **every** scan on the image, both members of every pair included, and
 * only then joined: `trueSizeScales` normalises against the worst-shrunk tile, so measuring the
 * pairs on their own would put each cell on a scale of its own and undo the very thing it repairs.
 *
 * The in-cell gap is left out, exactly as `autoGridCost` leaves out the gap between cells and for
 * the same reason: it shifts every candidate by nearly the same amount and cannot be known before
 * the sizes it is a share of are.
 */
export function pairedTrueScaledSizes(
  tiles: readonly CollagePlannedTileSize[]
): CollageTileSize[] {
  const flat = tiles.flatMap((tile) => (tile.pair ? [tile.main, tile.pair] : [tile.main]));
  const scaled = trueScaledSizes(flat);
  const sizes: CollageTileSize[] = [];
  let at = 0;
  for (const tile of tiles) {
    const main = scaled[at++];
    if (!tile.pair) {
      sizes.push(main);
      continue;
    }
    const pair = scaled[at++];
    sizes.push({
      width: main.width + pair.width,
      height: Math.max(main.height, pair.height),
    });
  }
  return sizes;
}

/** The capacity an offer carries, and how to read it (#413). */
export interface CollageGrid {
  gridMode: CollageGridMode;
  /** Rows — a maximum in both modes, and only a maximum. */
  rows: number;
  /** Tiles per row in `fixed` mode; the widest a row may get in `auto`. */
  columns: number;
}

/** A tile to fall back to when a size is missing or degenerate: a unit square, so a collage with no
 * usable dimensions is scored as the uniform grid #413 always assumed. */
const UNIT_TILE: CollageTileSize = { width: 1, height: 1 };

/**
 * What a step away from the wanted canvas shape costs, in empty tiles. Set so the two terms of the
 * auto-grid cost trade at the parity #413 chose: `3 × |ln(3/2)| ≈ 1.2`, so moving one step off shape
 * costs about one tile-sized hole. Raising it prefers well-shaped canvases at the price of ragged
 * rows.
 */
const SHAPE_WEIGHT = 3;

/**
 * The canvas shape the auto grid aims at (#526) — **landscape**, and a *band* rather than a point.
 *
 * The first cut of the cost aimed at a square, which is nobody's viewing surface: a collage is looked
 * at on a monitor and as a marketplace listing image, both wider than they are tall, and aiming at 1:1
 * meant a set of tall stamps could come out as a portrait column with no hole in it to argue against.
 * Anything from 4:3 to 16:9 is a natural landscape shape and there is no reason to prefer one over
 * another, so the whole band is free and the term only bites outside it — growing with the log
 * distance to the nearest edge, exactly as it grew away from square before.
 *
 * Portrait canvases are not forbidden: a single tall scan, or a row ceiling that forces the shape,
 * still lands where the holes term sends it. The band says which arrangement to reach for, not which
 * ones are allowed.
 */
const TARGET_ASPECT_MIN = 4 / 3;
const TARGET_ASPECT_MAX = 16 / 9;

/** How far off the landscape band a canvas is, in log-ratio; 0 anywhere inside it. */
function shapePenalty(width: number, height: number): number {
  const ratio = width / height;
  if (ratio < TARGET_ASPECT_MIN) return Math.log(TARGET_ASPECT_MIN / ratio);
  if (ratio > TARGET_ASPECT_MAX) return Math.log(ratio / TARGET_ASPECT_MAX);
  return 0;
}

/** Costs are floats now, so an exact tie needs a tolerance to still read as one. */
const COST_EPSILON = 1e-9;

/**
 * What a candidate row width would cost, measured on the canvas it actually produces (#514).
 *
 * The geometry is `layOutCollage`'s, minus the gap and the label strips: rows of `columns` tiles, a
 * row as tall as its tallest tile, the canvas as wide as its widest row. Both omissions are
 * deliberate — the strip is a share of the finished image's longest edge and so depends on the very
 * shape being chosen, and the gap is a share of the median tile height, which shifts every candidate
 * by nearly the same amount. Neither changes which width wins often enough to be worth the
 * circularity.
 *
 * Two terms, exactly the two #413 balanced, but read off pixels rather than off cell counts:
 *
 *     cost = empty area (in tile-sized holes) + SHAPE_WEIGHT × shapePenalty(width, height)
 *
 * - **Holes** — the canvas area the stamps do not cover, over the mean tile area. This is the term
 *   that grew: it counts the ragged cell at the end of the last row *and* the space a small
 *   definitive leaves beside a souvenir sheet in the same row, which is the imbalance #514 is about.
 * - **Shape** — how far the canvas's real aspect ratio falls outside the landscape band (#526), so a
 *   page of wide detail crops is judged on the wide canvas it makes rather than on how many cells
 *   across it is, and a page of tall stamps is pushed towards a wider arrangement rather than a
 *   column.
 */
function autoGridCost(sizes: readonly CollageTileSize[], columns: number): number {
  let canvasWidth = 0;
  let canvasHeight = 0;
  let tileArea = 0;
  for (let i = 0; i < sizes.length; i += columns) {
    let rowWidth = 0;
    let rowHeight = 0;
    for (const size of sizes.slice(i, i + columns)) {
      rowWidth += size.width;
      rowHeight = Math.max(rowHeight, size.height);
      tileArea += size.width * size.height;
    }
    canvasWidth = Math.max(canvasWidth, rowWidth);
    canvasHeight += rowHeight;
  }
  if (tileArea <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 0;

  const meanTileArea = tileArea / sizes.length;
  const holes = (canvasWidth * canvasHeight - tileArea) / meanTileArea;
  return holes + SHAPE_WEIGHT * shapePenalty(canvasWidth, canvasHeight);
}

/**
 * How many tiles go on a row (#413, refined by #514).
 *
 * In `fixed` mode this is the template's `columns`, unchanged — the row is filled to that width and
 * the last one comes up short, which is what a collector who typed an exact grid asked for.
 *
 * In `auto` mode the two numbers are bounds and the grid is solved from the tiles actually on the
 * image — their **sizes**, not merely how many there are, which is what a mixed page of definitives
 * and souvenir sheets needs. Every width from the narrowest that fits inside the row ceiling up to
 * `columns` is scored by `autoGridCost` and the cheapest wins.
 *
 * A row wider than the tile count is never a candidate: the canvas shrinks to its contents (#307),
 * so those columns cost nothing and would win every tie by being wider.
 *
 * Ties go to the **wider** grid (a 2-wide and a 2-tall arrangement of the same six): text sits beside
 * the image on a marketplace page, so height costs more than width.
 *
 * `rows` is a hard ceiling: with more tiles than `rows × columns` — which the plan's grouping never
 * produces, since it chunks by that very product — the widest allowed row wins, because dropping
 * tiles is not something a layout may decide.
 *
 * Total: no tiles, or tiles with no usable dimensions, are scored as unit squares rather than
 * refused, so a width is always named.
 */
export function resolveCollageColumns(
  sizes: readonly CollageTileSize[],
  grid: CollageGrid
): number {
  if (grid.gridMode !== "auto") return Math.max(1, Math.round(grid.columns));

  // One degenerate tile poisons the areas it is measured with, so the fallback is all-or-nothing.
  const usable =
    sizes.length > 0 && sizes.every((s) => s.width > 0 && s.height > 0)
      ? sizes
      : sizes.map(() => UNIT_TILE);
  const tiles = usable.length > 0 ? usable : [UNIT_TILE];

  const maxRows = Math.max(1, Math.round(grid.rows));
  // Capped at the tile count, per the doc above; the template's own ceiling still binds.
  const maxColumns = Math.min(tiles.length, Math.max(1, Math.round(grid.columns)));
  // The narrowest row that still fits inside the row ceiling. Past capacity it would exceed
  // `maxColumns`, and the clamp leaves the loop with the widest row allowed as its only candidate.
  const minColumns = Math.min(maxColumns, Math.max(1, Math.ceil(tiles.length / maxRows)));

  let best = minColumns;
  let bestCost = Infinity;
  for (let columns = minColumns; columns <= maxColumns; columns += 1) {
    const cost = autoGridCost(tiles, columns);
    // The tolerance is what makes a tie go to the wider grid: the loop climbs, so the last equal
    // cost wins. `bestCost` keeps the true minimum, so a run of near-ties cannot drift upwards.
    if (cost <= bestCost + COST_EPSILON) {
      best = columns;
      bestCost = Math.min(cost, bestCost);
    }
  }
  return best;
}

/** The render values an offer carries, copied from a collage template (#307). */
export interface CollageLayoutStyle {
  /** Tiles per row — the collage template's `columns`. */
  columns: number;
  /** Space between tiles, between rows and around the whole collage, as a percent of the stamp
   * height (#312). */
  gapPercent: number;
  /** Height of the label strip reserved below each tile (#312), as a percent of the finished
   * image's longest edge (#337) — the caption's size is this and nothing else. 0 reserves nothing,
   * which is how a collage without labels is configured. */
  labelPercent: number;
}

/** Where one tile — and its label strip — ends up on the canvas. */
export interface PlacedCollageTile {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The reserved label strip: directly below the tile, same width, `labelStripHeight` tall. */
  label: { x: number; y: number; width: number; height: number };
}

export interface CollageLayout {
  width: number;
  height: number;
  /** The pixels the percentages resolved to for this collage — reported so the renderer and the
   * tests can talk about the geometry that was actually used. */
  gap: number;
  labelStripHeight: number;
  /** The median tile height the **gap** was taken of. The strip is taken of the canvas instead. */
  referenceHeight: number;
  /** Placed tiles in input order (plan order — copy order within a group, #309). */
  tiles: PlacedCollageTile[];
  /** How many rows the tiles actually occupy — always ≤ the template's `rows`, and often fewer. */
  rowCount: number;
}

/** The tile height the percentages are taken of: the median, so one outsized tile among many cannot
 * decide the geometry of the whole collage. An even count takes the lower of the two middles —
 * arbitrary, but stable. */
function medianHeight(sizes: readonly CollageTileSize[]): number {
  const heights = sizes.map((s) => Math.max(0, s.height)).sort((a, b) => a - b);
  return heights[Math.floor((heights.length - 1) / 2)];
}

/**
 * The gap these tiles are laid out with, in pixels — the rule `layOutCollage` applies below, named
 * so the paired renderer (#694) can space a cell's two scans by a share of the very same number
 * before it joins them. It is safe to ask *before* joining: a pair's height is the taller of its two
 * scans and the gap is taken of heights alone, so the answer does not move when the widths do.
 */
export function collageGap(sizes: readonly CollageTileSize[], gapPercent: number): number {
  if (sizes.length === 0) return 0;
  return Math.max(0, Math.round((medianHeight(sizes) * Math.max(0, gapPercent)) / 100));
}

/**
 * How much of that gap separates the two scans **inside** a paired cell (#694).
 *
 * Half. The pair has to read as one stamp seen from both sides rather than as two stamps: at the
 * full gap a cell is indistinguishable from two neighbouring tiles and the pairing says nothing,
 * and at zero the two scans touch and their pale margins run together. A share rather than a
 * setting of its own — it is a property of the spacing the collector already chose, and one more
 * number to tune would not be answering a different question.
 */
export const PAIR_GAP_SHARE = 0.5;

/** The space between a paired cell's two scans, from the collage's own gap. */
export function pairedCellGap(gap: number): number {
  return Math.max(0, Math.round(gap * PAIR_GAP_SHARE));
}

/** The share of the canvas's height all the strips together may take. A rail, not a setting: a
 * caption that is 20% of the image is a fine thing to ask for on a single stamp and an impossible
 * one on a ten-row page, and the layout has to stay solvable either way. */
const MAX_LABEL_SHARE_OF_HEIGHT = 0.5;

/**
 * The strip height for a canvas whose other dimensions are already known — the fixed point of
 * `strip = percent × longestEdge`, where the longest edge itself grows by one strip per row.
 *
 * Two cases, both exact:
 * - The image stays **wider than it is tall** even with the strips: the longest edge is the known
 *   width, so the strip is a plain multiplication.
 * - Otherwise the height wins, and `h = base + rows × p × h` solves to `p × base / (1 − p × rows)`.
 *   The cap above keeps the denominator at or above ½, so this never explodes or goes negative.
 */
function solveLabelStrip(
  percent: number,
  rowCount: number,
  width: number,
  heightWithoutStrips: number
): number {
  const share = Math.min(
    Math.max(0, percent) / 100,
    MAX_LABEL_SHARE_OF_HEIGHT / Math.max(1, rowCount)
  );
  if (share <= 0 || rowCount === 0) return 0;

  const ifWidthWins = share * width;
  if (heightWithoutStrips + rowCount * ifWidthWins <= width) return Math.round(ifWidthWins);
  return Math.round((share * heightWithoutStrips) / (1 - share * rowCount));
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Lays out tiles at their native sizes. Total and deterministic: no tiles gives an empty canvas
 * (`0 × 0`), which the renderer rejects rather than encoding.
 */
export function layOutCollage(
  sizes: readonly CollageTileSize[],
  style: CollageLayoutStyle
): CollageLayout {
  if (sizes.length === 0) {
    return {
      width: 0,
      height: 0,
      gap: 0,
      labelStripHeight: 0,
      referenceHeight: 0,
      tiles: [],
      rowCount: 0,
    };
  }

  const referenceHeight = medianHeight(sizes);
  const gap = collageGap(sizes, style.gapPercent);
  const columns = Math.max(1, Math.round(style.columns));

  const rows = chunk(sizes, columns).map((row) => ({
    sizes: row,
    width: row.reduce((sum, size) => sum + size.width, 0) + gap * (row.length - 1),
    // The band the stamps occupy; the label strip sits below it, so every tile in a row shares one
    // label baseline however tall the stamps are.
    contentHeight: row.reduce((tallest, size) => Math.max(tallest, size.height), 0),
  }));

  // The canvas as it would be with no strips at all: everything the strip percentage is solved
  // against, and the width it is solved against outright.
  const contentWidth = rows.reduce((widest, row) => Math.max(widest, row.width), 0);
  const width = contentWidth + gap * 2;
  const heightWithoutStrips =
    rows.reduce((sum, row) => sum + row.contentHeight, 0) + gap * (rows.length - 1) + gap * 2;

  const labelStripHeight = solveLabelStrip(
    style.labelPercent,
    rows.length,
    width,
    heightWithoutStrips
  );
  const height = heightWithoutStrips + labelStripHeight * rows.length;

  const tiles: PlacedCollageTile[] = [];
  let y = gap;
  for (const row of rows) {
    let x = gap + Math.round((contentWidth - row.width) / 2);
    for (const size of row.sizes) {
      const tileY = y + Math.round((row.contentHeight - size.height) / 2);
      tiles.push({
        x,
        y: tileY,
        width: size.width,
        height: size.height,
        label: {
          x,
          y: y + row.contentHeight,
          width: size.width,
          height: labelStripHeight,
        },
      });
      x += size.width + gap;
    }
    y += row.contentHeight + labelStripHeight + gap;
  }

  return { width, height, gap, labelStripHeight, referenceHeight, tiles, rowCount: rows.length };
}
