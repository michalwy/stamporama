/**
 * The collage template preview (#1477) — what a template's numbers lay out, planned on placeholder
 * scans rather than photos so it can be drawn for any template, before any offer uses it.
 *
 * Pure: no `sharp`, no Prisma, so it runs in the browser as the fields are typed and in the unit
 * suite beside a real render.
 *
 * ## Nothing here is a second layout
 *
 * A preview that disagreed with the rendered collage would be worse than none — a confident wrong
 * answer. So every step is the renderer's own, in the renderer's order: the width through
 * `collageColumnsFor` (what generation asks, #413/#514), the cells — a pair's front and back included
 * (#694) — through `collageCells` (what the renderer composites a pair by), and the canvas through
 * `layOutCollage`. What this module adds is only the input: `count` placeholder stamps of one size.
 *
 * ## Placeholders of one size
 *
 * A real collage keeps each stamp's true size (#310), so a page of mixed stamps packs differently from
 * this one; the preview shows what the template decides — the grid, the spacing, the strip, the
 * colour — on stamps that differ in nothing else. A portrait definitive's proportions, because that
 * is the commonest scan.
 */

import {
  collageCells,
  collageColumnsFor,
  layOutCollage,
  type CollagePlannedTileSize,
  type CollageTileSize,
} from "./collage-layout";
import {
  MAX_COLLAGE_AXIS,
  MIN_COLLAGE_AXIS,
  normalizeCollageGridMode,
} from "./collage-template-rules";

/** The placeholder scan, in pixels: a portrait definitive at a common scanning resolution. The
 *  unit only matters for rounding — the gap and the strip are shares, and the drawing is scaled to
 *  the room on screen — so it is large enough that a pixel of rounding is invisible. */
export const COLLAGE_PREVIEW_SCAN: CollageTileSize = { width: 500, height: 600 };

/** The template values the drawing depends on. The name is not one of them, and neither is the
 *  background: it is painted, never measured. */
export interface CollagePreviewValues {
  gridMode: string;
  pairSides: boolean;
  rows: number;
  columns: number;
  gapPercent: number;
  labelPercent: number;
}

/** One placeholder scan, in canvas coordinates. `side` is null on an unpaired template, which has no
 *  sides to tell apart. */
export interface CollagePreviewScan {
  x: number;
  y: number;
  width: number;
  height: number;
  side: "front" | "back" | null;
}

export interface CollagePreviewCell {
  /** 1-based, in plan order — the order a real collage's copies take. */
  number: number;
  scans: CollagePreviewScan[];
  /** The cell's label strip, as the layout reserved it; zero-high when the template has none. */
  label: { x: number; y: number; width: number; height: number };
}

export interface CollagePreview {
  width: number;
  height: number;
  /** Tiles per row as the renderer would choose them for this many stamps. */
  columns: number;
  rowCount: number;
  cells: CollagePreviewCell[];
}

function axis(value: number): number {
  if (!Number.isFinite(value)) return MIN_COLLAGE_AXIS;
  return Math.min(MAX_COLLAGE_AXIS, Math.max(MIN_COLLAGE_AXIS, Math.round(value)));
}

/** How many stamps one image of this template holds: rows × columns, in either grid (#413). */
export function collagePreviewCapacity(values: Pick<CollagePreviewValues, "rows" | "columns">): number {
  return axis(values.rows) * axis(values.columns);
}

/**
 * The collage `count` placeholder stamps make under these values — the full image when `count` is
 * left out. A count past capacity is held to it, since the plan never puts more on one image (#309);
 * below one is one.
 */
export function planCollagePreview(values: CollagePreviewValues, count?: number): CollagePreview {
  const capacity = collagePreviewCapacity(values);
  const stamps = Math.min(capacity, Math.max(1, Math.round(count ?? capacity)));
  const scan = { stored: COLLAGE_PREVIEW_SCAN, original: null };
  const planned: CollagePlannedTileSize[] = Array.from({ length: stamps }, () => ({
    main: scan,
    pair: values.pairSides ? scan : null,
  }));

  const columns = collageColumnsFor(planned, {
    gridMode: normalizeCollageGridMode(values.gridMode),
    rows: axis(values.rows),
    columns: axis(values.columns),
  });
  const { cells } = collageCells(
    planned.map((tile) => (tile.pair ? [COLLAGE_PREVIEW_SCAN, COLLAGE_PREVIEW_SCAN] : [COLLAGE_PREVIEW_SCAN])),
    values.gapPercent
  );
  const layout = layOutCollage(cells, {
    columns,
    gapPercent: values.gapPercent,
    labelPercent: values.labelPercent,
  });

  return {
    width: layout.width,
    height: layout.height,
    columns,
    rowCount: layout.rowCount,
    cells: layout.tiles.map((tile, index) => ({
      number: index + 1,
      scans: cells[index].scans.map((at, side) => ({
        x: tile.x + at.x,
        y: tile.y + at.y,
        width: at.width,
        height: at.height,
        side: values.pairSides ? (side === 0 ? "front" : "back") : null,
      })),
      label: tile.label,
    })),
  };
}
