// What the identification dialog shows for one tile (#585, ADR-0033 §6): which sides there are to
// look at, how large each one is in the scan's own pixels, and whether there is still a retained
// original behind it to look deeper into.
//
// Pure — no DOM, no React, no Prisma. It sits beside `scan-viewport.ts` for the same reason: the
// viewer needs the answer to draw its toolbar, the region URL is built from it, and the one case
// that is hardest to reach on a screen — a scan whose bytes the retention sweep has taken (#578) —
// is a plain function call here and a browser session with a cron job in it anywhere else.

import type { Box } from "./scan-boxes";

export type TileSide = "front" | "back";

/** What this module needs of a batch's sheet: which scan it is, and whether its bytes are still
 * there. Structural rather than `ScanSheetData`, so the module stays free of the server-only read
 * that produces one. */
export interface TileSheetRef {
  id: string;
  /** #578 took the bytes and left the row. Both scan routes answer 404 for such a sheet
   * *deliberately*, so this is not a fetch to try and recover from — it is the absence of a source,
   * known before anything is asked for. */
  purged: boolean;
}

/** What this module needs of a tile. `item` is the copy a `consumed` tile became, which owns the
 * tile's old `Photo` rows (#567) — the tile's images did not go anywhere, they changed owner. */
export interface TileViewSource {
  position: number;
  frontPhotoId: string | null;
  backPhotoId: string | null;
  frontBox: Box | null;
  backBox: Box | null;
  item: { frontPhotoId: string | null; backPhotoId: string | null } | null;
}

/** One side of a tile, as the viewer draws it. */
export interface TileSideView {
  side: TileSide;
  label: string;
  /** The picture on screen. */
  photoId: string;
  /** Its size and place on the sheet, in the sheet's **own** pixels — the space `1:1` is measured
   * in and the space the region route validates. Null when the tile carries no box for this side,
   * which leaves the picture's own pixels as the only truth about it. */
  box: Box | null;
  /** The retained scan to escalate to past the photo's own resolution, or null when there is none
   * to ask. */
  sheetId: string | null;
}

/**
 * The sides of a tile worth showing, in the order they are read: front, then back.
 *
 * A side with no picture is simply absent — a back-only tile (an unmatched back, #566) is one entry
 * and reads as one, rather than a front slot apologising for itself.
 *
 * **A deep source needs the tile's own photo, its own box and an unswept sheet.**
 *
 * - *Swept* is #578: the bytes are gone by the collector's own choice of retention, so the dialog
 *   falls back to the tile photo alone. That photo is a ~1400 px crop of a 1200 dpi card and is the
 *   picture the whole feature is about; what is lost is the last stop past its own resolution, on a
 *   tile that by definition has already been worked through.
 * - *Its own photo* excludes a `consumed` tile, whose pictures are read through the copy it became.
 *   They are usually the very same rows — but a copy's front can be replaced from the Copies screen,
 *   and there is nothing on the tile that would say so. Painting a crop of the card over a
 *   photograph of something else, sharper than what it covers, is the one failure this escalation
 *   must not have; a consumed tile is also exactly where the deep look is over.
 */
export function tileSideViews(
  tile: TileViewSource,
  sheets: { front: TileSheetRef | null; back: TileSheetRef | null }
): TileSideView[] {
  return (["front", "back"] as const)
    .map((side) => {
      const own = side === "front" ? tile.frontPhotoId : tile.backPhotoId;
      const photoId = own ?? (side === "front" ? tile.item?.frontPhotoId : tile.item?.backPhotoId);
      if (!photoId) return null;
      const box = side === "front" ? tile.frontBox : tile.backBox;
      const sheet = side === "front" ? sheets.front : sheets.back;
      const deep = own != null && box != null && sheet != null && !sheet.purged;
      return {
        side,
        label: side === "front" ? "Front" : "Back",
        photoId,
        box,
        sheetId: deep ? sheet.id : null,
      } satisfies TileSideView;
    })
    .filter((v): v is TileSideView => v != null);
}
