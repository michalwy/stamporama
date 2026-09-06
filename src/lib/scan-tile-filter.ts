/**
 * *Which tiles the card-scans strip is narrowed to* (#567, #597, #853) — the pure half of the
 * header's filter chips.
 *
 * Every chip answers **one** question — *which tiles do I want to see* — so this is a single value
 * and never a set of independent toggles: pressing one releases the other, and no combination can
 * narrow a strip to nothing. `all` is the resting state and what a chip retires to when it stops
 * counting anything.
 *
 * The fourth value, `discarded` (#853), is the odd one and the reason this left `scans-card.tsx`:
 * the other three narrow to work that is **outstanding**, and every rule the strip has for hiding
 * things — a finished batch is set aside, a finished batch is folded shut — was written knowing
 * that. A discard is the opposite: it is the *end* a tile reached, so it lives almost entirely in
 * batches the screen has decided are done with, and a filter that respected those rules would show
 * the collector an empty screen. `reachesFinishedBatches` is that exception, stated once here
 * rather than repeated as an `=== "discarded"` at each of the three places that has to lift.
 *
 * **What the `discarded` filter is for** is a worklist for the physical cards, not a review screen:
 * having identified a card, the collector goes back to the stockbook on the desk and pulls out the
 * pieces he rejected here. Every tile it shows is one card to pull, read with a stamp in the other
 * hand — which is what decides that the tiles keep their sheet order and that their pictures stop
 * receding while it is on (`scans-card.tsx` draws both).
 */

/** The state a tile is in, as the strip reads one — `scan_tile.state`. */
export interface FilterableTile {
  state: string;
}

export type TileFilter = "all" | "waiting" | "parked" | "discarded";

export const TILE_FILTERS: readonly TileFilter[] = ["all", "waiting", "parked", "discarded"];

/** How many tiles each chip is counting. A chip with nothing to count is not drawn, and the filter
 * it would apply retires — see `effectiveTileFilter`. */
export interface TileFilterCounts {
  unidentified: number;
  parked: number;
  discarded: number;
}

/** The address-bar name for this narrowing (#844): a filter that reaches the screen reaches the
 * URL. `all` is absence — a resting strip leaves no parameter behind. */
export const TILE_FILTER_PARAM = "tiles";

/** Read a stored chip or a URL parameter back, falling to the unnarrowed strip for anything
 * unrecognised — a filter only ever narrows, so an unknown one is a wider answer and never the
 * wrong tiles. */
export function parseTileFilter(raw: string | null | undefined): TileFilter {
  return TILE_FILTERS.find((f) => f === raw) ?? "all";
}

export function matchesTileFilter(tile: FilterableTile, filter: TileFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "waiting":
      return tile.state === "unidentified";
    case "parked":
      return tile.state === "parked";
    case "discarded":
      // The one state that means *I took this out during identification* (#567). `consumed` became
      // a copy and `parked` is still to be answered, so nothing else can end up under this chip and
      // the chip can be named after exactly what it shows.
      return tile.state === "discarded";
  }
}

/**
 * The narrowing actually in force.
 *
 * **A chip retires with what it counts.** The chip is its own only control, so working the last
 * waiting tile through — or putting the last discard back — would otherwise leave the strip
 * narrowed to nothing with nothing on screen to press to get out of it. Derived rather than reset,
 * so the choice is still there when the count comes back.
 */
export function effectiveTileFilter(choice: TileFilter, counts: TileFilterCounts): TileFilter {
  if (choice === "waiting" && counts.unidentified === 0) return "all";
  if (choice === "parked" && counts.parked === 0) return "all";
  if (choice === "discarded" && counts.discarded === 0) return "all";
  return choice;
}

/** Whether the strip is narrowed at all. */
export function isNarrowed(filter: TileFilter): boolean {
  return filter !== "all";
}

/**
 * Whether this narrowing reaches into batches the screen has finished with (#853).
 *
 * The three ways a worked-through batch is kept out of the way — set aside behind *N
 * worked-through batches*, and folded shut by `useBatchExpansion` — all rest on the same
 * assumption: what you are looking for is what is left to do, and a finished card has none of it.
 * That holds for `waiting` and `parked`, whose every matching batch is by definition unfinished.
 * It is false for `discarded`, whose tiles are mostly on cards that were finished weeks ago — so
 * under it the set-aside pile opens and the matching batches are drawn open, or the filter would
 * answer a press with a blank screen.
 */
export function reachesFinishedBatches(filter: TileFilter): boolean {
  return filter === "discarded";
}
