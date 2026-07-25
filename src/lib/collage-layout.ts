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
 *   give a one-row image.
 * - Rows are **centred** horizontally against the widest row. Justified rows (the photo-gallery
 *   look, each row stretched to full width) are explicitly rejected — they scale each row by a
 *   different factor and would destroy the true proportions that are the point of the feature.
 * - `gap` separates tiles and rows and also serves as the outer margin, so nothing touches the edge.
 * - Every tile gets a **label strip** below it, as wide as the tile, drawn by `collage-label.ts`
 *   (#312); a height of 0 simply reserves nothing.
 *
 * Sizes relative to the stamps
 * ----------------------------
 * The gap and the label strip are configured as **percentages of the stamp height** (#312), not in
 * pixels, and are resolved here against the **median tile height** of this collage. A pixel number
 * would have to be chosen without knowing the scan DPI or how far the platform's limits will shrink
 * the finished image; a percentage needs neither, because "readable next to the stamp" is a relative
 * property that survives the shared downscale. The median rather than the tallest tile, so a single
 * oversized souvenir sheet cannot inflate the strips of a whole page.
 *
 * A single stamp is a 1×1 collage, so this is the only layout path there is.
 */

/** The native pixel size of one scan. */
export interface CollageTileSize {
  width: number;
  height: number;
}

/** The render values an offer carries, copied from a collage template (#307). */
export interface CollageLayoutStyle {
  /** Tiles per row — the collage template's `columns`. */
  columns: number;
  /** Space between tiles, between rows and around the whole collage, as a percent of the stamp
   * height (#312). */
  gapPercent: number;
  /** Height of the label strip reserved below each tile (#312), as a percent of the stamp height.
   * 0 reserves nothing, which is how a collage without labels is configured. */
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
  /** The median tile height the percentages were taken of. */
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
  const percentOf = (percent: number) =>
    Math.max(0, Math.round((referenceHeight * Math.max(0, percent)) / 100));
  const gap = percentOf(style.gapPercent);
  const labelStripHeight = percentOf(style.labelPercent);
  const columns = Math.max(1, Math.round(style.columns));

  const rows = chunk(sizes, columns).map((row) => ({
    sizes: row,
    width: row.reduce((sum, size) => sum + size.width, 0) + gap * (row.length - 1),
    // The band the stamps occupy; the label strip sits below it, so every tile in a row shares one
    // label baseline however tall the stamps are.
    contentHeight: row.reduce((tallest, size) => Math.max(tallest, size.height), 0),
  }));

  const contentWidth = rows.reduce((widest, row) => Math.max(widest, row.width), 0);
  const contentHeight =
    rows.reduce((sum, row) => sum + row.contentHeight + labelStripHeight, 0) +
    gap * (rows.length - 1);

  const width = contentWidth + gap * 2;
  const height = contentHeight + gap * 2;

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
