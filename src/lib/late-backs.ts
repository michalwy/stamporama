/**
 * *Where a back goes when its front has already become a copy* (#1995).
 *
 * A card's back scan is often added late — the front was scanned, every stamp identified, and the
 * back scan turned up afterwards. Pairing finds each back's front by position exactly as before
 * (#647, #1555); what this decides is the one thing that differs once the front is a **copy**: the
 * back is that copy's back picture, as it would have been had the scan been there before
 * identifying — unless the copy cannot take one.
 *
 * - **A copy that already has a back picture keeps it.** The collector gave it one, on the copy or
 *   from an earlier scan, and a scan arriving later is not a reason to take it away: the back goes
 *   to the unpaired strip instead, where it can be dragged elsewhere or left.
 * - **A tile whose copy was deleted takes no back.** There is nothing left to hang it on.
 *
 * Pure, because both sides ask: the server placing backs at the cut, by drag and on a change of how
 * the backs were made, and the strip deciding which squares a dragged back may be dropped on. A
 * strip that offers what the write refuses is the defect `tile-photo-roles.ts` was written against.
 */

/** Where a back paired with a consumed tile's front ends up. */
export type CopyBackPlacement = "copy" | "copy-has-back" | "copy-deleted";

export function copyBackPlacement(copy: {
  /** The copy the tile became still exists. */
  exists: boolean;
  /** That copy holds a picture in the `back` role — whoever gave it. */
  hasBack: boolean;
}): CopyBackPlacement {
  if (!copy.exists) return "copy-deleted";
  return copy.hasBack ? "copy-has-back" : "copy";
}

/**
 * May a back dragged from the strip be dropped on this square?
 *
 * A tile still to be identified (waiting or parked, #597) with a front and no back takes it, as it
 * always has; a tile that became a copy takes it when the copy has no back picture (#1995). A
 * discarded tile does not — *Put back in the queue* is one press away, and one rule about which tiles
 * are still workable is better than two (`unpairTileBack`'s reasoning).
 */
export function takesDraggedBack(tile: {
  state: string;
  frontBox: unknown;
  /** The tile already carries a back from a scan — on itself, or given to its copy. */
  backBox: unknown;
  backPhotoId: string | null;
  item: { backPhotoId: string | null } | null;
}): boolean {
  if (tile.frontBox == null || tile.backBox != null) return false;
  if (tile.state === "unidentified" || tile.state === "parked") return tile.backPhotoId == null;
  if (tile.state === "consumed") {
    return copyBackPlacement({ exists: tile.item != null, hasBack: tile.item?.backPhotoId != null }) === "copy";
  }
  return false;
}
