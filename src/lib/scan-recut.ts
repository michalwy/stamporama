import type { Box } from "./scan-boxes";

/**
 * Re-cutting a card some of whose tiles have already become copies (#2055) — the pure half.
 *
 * A copy holds its tile's very images (#567), so a re-cut cannot touch that tile: its box is
 * **locked** — drawn in the editor, marked as a copy, never moved — and the commit cuts only the
 * boxes around it. Everything here is shared by the server, which numbers the new tiles, and the
 * editor, which draws those numbers before the commit, so the two cannot disagree.
 */

/** A tile a re-cut keeps as it is: one that has become a copy. Every other state — waiting,
 * parked, discarded — is cut again with the rest of the card. */
export function isLockedTile(tile: { state: string }): boolean {
  return tile.state === "consumed";
}

/**
 * The positions new tiles take, in reading order: the lowest ones **no locked tile holds**. A copy
 * shows its tile's number (#1924), so a new tile taking it would put two pieces under one number.
 */
export function freePositions(taken: Iterable<number>, count: number): number[] {
  const held = new Set(taken);
  const free: number[] = [];
  for (let p = 0; free.length < count; p++) {
    if (!held.has(p)) free.push(p);
  }
  return free;
}

/** Whether a box's centre lies inside another — the test for "this box is that stamp again". */
function centreInside(box: Box, other: Box): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= other.x && cx < other.x + other.w && cy >= other.y && cy < other.y + other.h;
}

/** A proposal with the locked stamps taken out: detection finds the copies' stamps too, and a box
 * proposed over a locked one would cut a second tile from a piece that is already a copy. */
export function outsideLocked<T extends Box>(boxes: readonly T[], locked: readonly Box[]): T[] {
  return boxes.filter((b) => !locked.some((l) => centreInside(b, l)));
}
