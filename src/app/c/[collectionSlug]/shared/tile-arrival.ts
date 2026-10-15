import {
  matchesTileFilter,
  reachesFinishedBatches,
  type FilterableTile,
  type TileFilter,
} from "@/lib/scan-tile-filter";

/**
 * What a `?tile=` link asks of the scans card on a purchase's screen (#1924): *open on this tile*.
 *
 * A copy identified from a card scan names the card and the tile on its row, and pressing that
 * marker lands here — the section opens, the tile's batch is drawn with the tile in it, the square
 * scrolls into view and flashes once, and the param is consumed, exactly as `?lot=` is (#876).
 *
 * **The strip is the scan, for this purpose.** It is the card in reading order and it is always
 * there: the retained sheet behind it is swept once a batch is finished with (#578), and a batch
 * holding a copy is nearly always finished with, so a link that opened the sheet itself would most
 * often open on nothing.
 *
 * **What reveals the tile is what the collector would have pressed to find it.** Three things can
 * hide a tile — a chip narrowing the strip, the batch set aside as worked through, the batch folded
 * shut — and each is lifted by the same choice its own control records, so nothing snaps back once
 * the flash is over. Only what actually hides the tile is touched: a strip already showing it keeps
 * every choice as it was.
 */

/** The address-bar name for the tile asked for. */
export const TILE_ARRIVAL_PARAM = "tile";

export interface ArrivalBatch<T extends FilterableTile & { id: string }> {
  batchNo: number;
  doneAt: string | null;
  tiles: readonly T[];
}

/** How the strip is being shown when the link arrives. */
export interface TileArrivalView<B> {
  /** The narrowing in force — the effective one, after a chip has retired. */
  filter: TileFilter;
  /** Whether the worked-through batches are showing. */
  showDone: boolean;
  isExpanded: (batch: B) => boolean;
}

/** What has to change for the tile to be on screen. */
export interface TileArrival {
  tileId: string;
  batchNo: number;
  /** The chip in force hides this tile, so the strip goes back to showing everything. */
  clearFilter: boolean;
  /** The batch is set aside as worked through, so the set-aside batches come out. */
  showDone: boolean;
  /** The batch is folded shut, so it opens. */
  expand: boolean;
}

/**
 * The tile asked for and what reveals it, or **null when this order holds no such tile** — a copy
 * moved to another order's lot, a batch deleted since the link was made, a hand-edited address.
 * Null leaves the param where it is, by `lot-arrival.ts`'s rule: consuming a param nothing
 * answered would tidy the address bar over a screen that did not react.
 */
export function tileArrival<T extends FilterableTile & { id: string }, B extends ArrivalBatch<T>>(
  tileId: string | null | undefined,
  batches: readonly B[],
  view: TileArrivalView<B>
): TileArrival | null {
  if (!tileId) return null;
  for (const batch of batches) {
    const tile = batch.tiles.find((t) => t.id === tileId);
    if (!tile) continue;
    const clearFilter = !matchesTileFilter(tile, view.filter);
    const filter: TileFilter = clearFilter ? "all" : view.filter;
    // Under a chip that reaches finished batches the set-aside pile is out and every batch it
    // shows is drawn open (#853), so neither choice needs making there.
    const reaches = reachesFinishedBatches(filter);
    return {
      tileId,
      batchNo: batch.batchNo,
      clearFilter,
      showDone: batch.doneAt != null && !view.showDone && !reaches,
      expand: !reaches && !view.isExpanded(batch),
    };
  }
  return null;
}
