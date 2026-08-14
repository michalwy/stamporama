// Geometry for scan sheet ingest (#566, ADR-0033): the boxes a card scan is cut into, the order
// they are read in, the two edits that change how many there are, and the front/back pairing.
//
// Pure — no Prisma, no `sharp`, no DOM. The review editor, the commit path and the unit tests all
// work through this module, which is what keeps "where did this box come from" a question nothing
// downstream has to ask. #566 draws boxes by hand; #574 proposes them from the image and hands the
// very same shapes to the very same functions.
//
// Coordinates are **original-sheet pixels** throughout, integers, origin top-left. Not fractions:
// `sharp.extract` wants pixels, and a fraction round-tripped through a float is how a crop ends up
// one pixel short of the perforation.

/** An axis-aligned crop region on a sheet, in that sheet's original pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The dimensions a box is expressed against. */
export interface SheetSize {
  width: number;
  height: number;
}

/** Smallest crop worth cutting, in pixels on the original. Below this a box is a slip of the mouse,
 * not a stamp — the editor drops it rather than creating a tile nobody drew. Deliberately a floor
 * on the *drawing* gesture and not a stamp-size rule: what counts as too small to be a stamp is a
 * detection question and belongs to #574. */
export const MIN_BOX_EDGE_PX = 8;

/**
 * A box clamped into its sheet and rounded to whole pixels, with the corners in either order —
 * dragging up-and-left is as ordinary a gesture as dragging down-and-right, and only the caller
 * that produced the drag should ever have to know which happened.
 *
 * Returns null when what is left has an edge under {@link MIN_BOX_EDGE_PX}, including the case
 * where the whole box fell outside the sheet.
 */
export function normalizeBox(
  raw: { x: number; y: number; w: number; h: number },
  sheet: SheetSize
): Box | null {
  const x0 = Math.min(raw.x, raw.x + raw.w);
  const y0 = Math.min(raw.y, raw.y + raw.h);
  const x1 = Math.max(raw.x, raw.x + raw.w);
  const y1 = Math.max(raw.y, raw.y + raw.h);

  const left = Math.round(clamp(x0, 0, sheet.width));
  const top = Math.round(clamp(y0, 0, sheet.height));
  const right = Math.round(clamp(x1, 0, sheet.width));
  const bottom = Math.round(clamp(y1, 0, sheet.height));

  const w = right - left;
  const h = bottom - top;
  if (w < MIN_BOX_EDGE_PX || h < MIN_BOX_EDGE_PX) return null;
  return { x: left, y: top, w, h };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** A box's centre. For a rectangle this *is* its centroid, which is what pairing compares: the
 * distinction only matters for a non-rectangular region, and by the time a region reaches this
 * module it has already been reduced to its bounding box — a crop is a rectangle whatever the
 * stamp's shape. #574 may compute a true centroid over the mask; it would land here as the same
 * pair of numbers. */
export function boxCenter(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function boxArea(b: Box): number {
  return b.w * b.h;
}

/** Whether two boxes overlap at all. Not a rule — nothing here forbids overlapping crops, since
 * two stamps mounted with an overlapping selvedge really do share pixels — but the editor uses it
 * to decide which box a click landed in. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether `inner` lies wholly inside `outer`. */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

// ── Reading order ─────────────────────────────────────────────────────────────────────────────

/**
 * Reading order: rows grouped by top edge within a tolerance, each row left to right.
 *
 * The tolerance comes from the **median** box height, not the maximum. A card can carry a block of
 * four beside small definitives, and half the tallest box there is deep enough to swallow two rows
 * of the small ones into one — which reorders a whole card silently. The median is the height of a
 * typical piece on the card, which is what a "row" is actually spaced by.
 *
 * Returns the indices of `boxes` in reading order, so a caller can carry whatever it has hanging
 * off each box along with it.
 */
export function readingOrder(boxes: readonly Box[]): number[] {
  if (boxes.length === 0) return [];

  const tolerance = ROW_TOLERANCE_FACTOR * medianOf(boxes.map((b) => b.h));

  // Ties on `y` resolve by `x`, then by index: two boxes with the same top edge must not come out
  // in an order that depends on how the array happened to be built.
  const byTop = boxes
    .map((b, i) => ({ b, i }))
    .sort((p, q) => p.b.y - q.b.y || p.b.x - q.b.x || p.i - q.i);

  const rows: { b: Box; i: number }[][] = [];
  let anchorY = Number.NEGATIVE_INFINITY;
  for (const entry of byTop) {
    // Compared against the row's **first** box rather than its running mean: a row of gently
    // descending tops would otherwise drift a whole row's height and absorb the next row.
    if (rows.length === 0 || entry.b.y - anchorY > tolerance) {
      rows.push([entry]);
      anchorY = entry.b.y;
    } else {
      rows[rows.length - 1].push(entry);
    }
  }

  return rows.flatMap((row) =>
    row.sort((p, q) => p.b.x - q.b.x || p.i - q.i).map((e) => e.i)
  );
}

/** Half a typical piece's height. Wide enough that a row laid slightly crooked stays one row,
 * narrow enough that two rows of definitives do not merge. */
const ROW_TOLERANCE_FACTOR = 0.5;

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── The two edits that change the count ───────────────────────────────────────────────────────

/**
 * Split one box in two at `at`, an absolute coordinate on `axis`. `vertical` cuts left/right at an
 * x; `horizontal` cuts top/bottom at a y.
 *
 * Returns null when the cut would leave either half under {@link MIN_BOX_EDGE_PX} — including a
 * cut outside the box entirely. Refusing is right: the alternative is silently producing a sliver
 * the collector then has to notice and delete.
 */
export function splitBox(
  box: Box,
  axis: "vertical" | "horizontal",
  at: number
): [Box, Box] | null {
  const cut = Math.round(at);
  if (axis === "vertical") {
    const leftW = cut - box.x;
    const rightW = box.x + box.w - cut;
    if (leftW < MIN_BOX_EDGE_PX || rightW < MIN_BOX_EDGE_PX) return null;
    return [
      { x: box.x, y: box.y, w: leftW, h: box.h },
      { x: cut, y: box.y, w: rightW, h: box.h },
    ];
  }
  const topH = cut - box.y;
  const bottomH = box.y + box.h - cut;
  if (topH < MIN_BOX_EDGE_PX || bottomH < MIN_BOX_EDGE_PX) return null;
  return [
    { x: box.x, y: box.y, w: box.w, h: topH },
    { x: box.x, y: cut, w: box.w, h: bottomH },
  ];
}

/**
 * Merge boxes into the one that contains them all.
 *
 * The bounding box, not the union of the pixels: a crop is a rectangle, so two halves of a stamp
 * that were detected apart become the rectangle that holds both — which is the stamp. It follows
 * that merging two boxes far apart takes everything between them too, and that is the collector's
 * to see: the merged box is drawn before it is committed like every other.
 */
export function mergeBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── Front/back pairing ────────────────────────────────────────────────────────────────────────

/** One matched front/back pair, by index into the arrays handed to {@link pairByPosition}. */
export interface BoxPair {
  frontIndex: number;
  backIndex: number;
}

export interface PairingResult {
  pairs: BoxPair[];
  /** Front boxes that found no mutual back — the tiles that will have no back image. */
  frontUnmatched: number[];
  /** Back boxes that found no mutual front — each becomes a back-only tile, to be dragged onto a
   * front tile by hand. */
  backUnmatched: number[];
}

/**
 * Pair a back sheet's boxes to a front sheet's **by position**, not by index.
 *
 * The routine this is built around turns each stamp over **in place** and scans the card again, so
 * a front region and its back occupy the same spot. That is what makes position the right key —
 * and it is also why there is **no mirroring**. Mirroring is correct when a whole group is turned
 * over at once, and applying it to a card turned stamp by stamp would break the correspondence the
 * routine already guarantees.
 *
 * Index matching is what this deliberately is not: an ordering can differ between two scans over
 * one stamp nudged while turning, or one region drawn differently, and tile *n* to tile *n* would
 * pair the wrong two stamps in silence.
 *
 * The match must be **mutual** — nearest back to a front *and* nearest front to that back. That
 * mutuality is the whole guard, and there is deliberately no distance cap beside it: a cap is one
 * more constant to be wrong about, and a genuinely absurd pairing needs a stamp to be both sides'
 * nearest neighbour, which a sparse back scan does not produce. What is left over is reported, not
 * forced.
 *
 * Centres are compared in **fractional sheet coordinates**, so a back scanned at a slightly
 * different size or crop than its front still lines up.
 */
export function pairByPosition(
  front: readonly Box[],
  frontSheet: SheetSize,
  back: readonly Box[],
  backSheet: SheetSize
): PairingResult {
  const frontPts = front.map((b) => fractionalCenter(b, frontSheet));
  const backPts = back.map((b) => fractionalCenter(b, backSheet));

  const nearestBackOf = frontPts.map((p) => nearestIndex(p, backPts));
  const nearestFrontOf = backPts.map((p) => nearestIndex(p, frontPts));

  const pairs: BoxPair[] = [];
  const pairedBack = new Set<number>();
  for (let f = 0; f < frontPts.length; f++) {
    const b = nearestBackOf[f];
    if (b !== null && nearestFrontOf[b] === f) {
      pairs.push({ frontIndex: f, backIndex: b });
      pairedBack.add(b);
    }
  }

  const paired = new Set(pairs.map((p) => p.frontIndex));
  return {
    pairs,
    frontUnmatched: front.map((_, i) => i).filter((i) => !paired.has(i)),
    backUnmatched: back.map((_, i) => i).filter((i) => !pairedBack.has(i)),
  };
}

function fractionalCenter(b: Box, sheet: SheetSize): { x: number; y: number } {
  const c = boxCenter(b);
  return {
    x: sheet.width > 0 ? c.x / sheet.width : 0,
    y: sheet.height > 0 ? c.y / sheet.height : 0,
  };
}

/** Index of the nearest point, or null when there are none. Squared distance — the ordering is the
 * same and the square root buys nothing. Ties take the lower index so the result is stable. */
function nearestIndex(
  p: { x: number; y: number },
  candidates: readonly { x: number; y: number }[]
): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i++) {
    const dx = candidates[i].x - p.x;
    const dy = candidates[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
