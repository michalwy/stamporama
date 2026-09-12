// A quarter-turn of a picture (#1006, ADR-0049 §6) — the arithmetic between a picture drawn the
// right way up and the rectangle it was cut from.
//
// Pure — no DOM, no React, no Prisma. It sits beside `scan-viewport.ts` for that module's reason: the
// viewer turns a region request back onto the sheet on the client, the region route turns the crop
// on the server, and the two have to agree on which way *clockwise* is and which corner a turned box
// starts from. A crop taken from the wrong corner is still a plausible piece of stamp, served with an
// `immutable` header.
//
// **Why a tile's turn is geometry and a photo's is bytes.** A tile's box addresses its sheet, and
// `1:1`, `regionOnSheet` and every measurement stand on that; so the tile keeps its box and states a
// turn, and what is drawn is the box's pixels turned. An ordinary uploaded photo has no such
// correspondence, so its bytes are simply rewritten through `sharp` and nothing downstream learns
// anything — which is why this module is about boxes and nothing else.

import type { Box } from "./scan-boxes";

/** Degrees clockwise. Quarter-turns only: skew is not this (#1006 leaves it to P5). */
export type QuarterTurn = 0 | 90 | 180 | 270;

export const QUARTER_TURNS: readonly QuarterTurn[] = [0, 90, 180, 270];

export function isQuarterTurn(value: unknown): value is QuarterTurn {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** A stored integer as a turn. Anything the application did not write reads as unturned rather than
 * throwing: the column has no CHECK (the migration says why), and a picture drawn the way it was cut
 * is the one reading that can never be worse than the scan. */
export function asQuarterTurn(value: number | null | undefined): QuarterTurn {
  return isQuarterTurn(value) ? value : 0;
}

/** One more quarter to the right (`1`) or to the left (`-1`). */
export function turnBy(turn: QuarterTurn, direction: 1 | -1): QuarterTurn {
  return (((turn + direction * 90) % 360) + 360) % 360 as QuarterTurn;
}

/** How much further `to` is from `from`, clockwise — what a picture already drawn at `from` has to be
 * turned by to stand at `to`. */
export function turnBetween(from: QuarterTurn, to: QuarterTurn): QuarterTurn {
  return (((to - from) % 360) + 360) % 360 as QuarterTurn;
}

/** Whether a turn lays the picture on its side, swapping width and height. */
export function isSideways(turn: QuarterTurn): boolean {
  return turn === 90 || turn === 270;
}

/** A size, turned. Its own inverse for every quarter-turn, which is what lets the viewer recover the
 * box's size from the turned picture's. */
export function turnedSize(
  size: { width: number; height: number },
  turn: QuarterTurn
): { width: number; height: number } {
  return isSideways(turn) ? { width: size.height, height: size.width } : { ...size };
}

/**
 * A box on the **turned** picture, as the box on the picture before it was turned.
 *
 * `size` is the unturned picture's size — a tile's own box on the sheet. The viewer asks for a region
 * in the frame it draws (the piece the right way up), and the sheet only knows the frame it was
 * scanned in; this is the one conversion between them, and the region route then turns the crop by
 * the same amount so it lands back in the drawn frame.
 *
 * Turning clockwise by 90 sends a point `(x, y)` of a `W × H` picture to `(H − y, x)`, so a turned
 * box's left edge was the original's bottom edge — which is the corner this has to start from.
 */
export function unturnBox(box: Box, turn: QuarterTurn, size: { width: number; height: number }): Box {
  const W = size.width;
  const H = size.height;
  switch (turn) {
    case 90:
      return { x: box.y, y: H - box.x - box.w, w: box.h, h: box.w };
    case 180:
      return { x: W - box.x - box.w, y: H - box.y - box.h, w: box.w, h: box.h };
    case 270:
      return { x: W - box.y - box.h, y: box.x, w: box.h, h: box.w };
    default:
      return { ...box };
  }
}
