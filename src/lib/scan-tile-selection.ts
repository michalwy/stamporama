/**
 * *Which tiles the strip's action bar is about* (#596).
 *
 * Ticking several tiles is the collector **asserting** that they are the same stamp in the same
 * condition — fifteen of a definitive on one card is an ordinary find — so that one answer can be
 * given once and become fifteen copies. This module is the pure half of that: the state the
 * checkboxes produce, and the three questions the strip asks of it.
 *
 * **It is deliberately not `lot-selection.ts`.** That module's containers, exclusions and
 * server-resolved count all exist for one reason: the copies list streams in pages, so a ticked lot
 * or issue group names copies that have not loaded and can never be expanded into ids. A batch's
 * tiles are **all in hand** — `usePurchaseScans` answers with whole batches and their tiles — so a
 * plain set of ids is not a simplification of that model, it is the correct one: the count is
 * `size`, exact and free, and the write is handed the very ids that were ticked. Reaching for
 * containers here would buy nothing and cost a scope the screen would then have to re-resolve.
 *
 * What it *does* keep from #571 is the shape: a box per tile, a box per batch that ticks what is
 * beneath it and shows a dash while only part of it is in, and **one bar for the whole card**
 * rather than one per batch — a run of one definitive can cross two cards of the same parcel, and a
 * selection per batch would make the collector answer twice for one decision.
 *
 * **Only a tile still waiting can be ticked.** A consumed tile has already become a copy and a
 * discarded one deliberately became nothing; neither can take an identification, so neither gets a
 * box. That is what keeps the tri-state box on a batch honest — it is *on* when every tile that
 * could be identified is, not when the batch is somehow entirely selected.
 */

/** A tile as the selection sees it: its id, and whether it is still waiting to become something. */
export interface SelectableTile {
  id: string;
  state: string;
}

/** Can this tile be identified at all? The only tiles that get a checkbox. */
export function isSelectableTile(tile: SelectableTile): boolean {
  return tile.state === "unidentified";
}

export type TileBoxState = "on" | "off" | "partial";

/** Tick or untick one tile. */
export function toggleTile(selected: ReadonlySet<string>, tileId: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(tileId)) next.add(tileId);
  return next;
}

/**
 * The state of the box standing for a batch: **on** when every tile of it that could be identified
 * is ticked, **partial** while only some are, **off** otherwise. A batch with nothing left waiting
 * is `off` and draws no box at all — there is nothing under it to tick.
 */
export function batchBoxState(
  selected: ReadonlySet<string>,
  tiles: readonly SelectableTile[]
): TileBoxState {
  const waiting = tiles.filter(isSelectableTile);
  if (waiting.length === 0) return "off";
  const ticked = waiting.filter((t) => selected.has(t.id)).length;
  if (ticked === 0) return "off";
  return ticked === waiting.length ? "on" : "partial";
}

/** Tick every tile of a batch that is still waiting, or untick all of them. Partial counts as not
 *  yet on, so one press from a half-ticked batch fills it rather than clearing it. */
export function toggleBatch(
  selected: ReadonlySet<string>,
  tiles: readonly SelectableTile[]
): Set<string> {
  const waiting = tiles.filter(isSelectableTile);
  const next = new Set(selected);
  if (batchBoxState(selected, tiles) === "on") {
    for (const t of waiting) next.delete(t.id);
  } else {
    for (const t of waiting) next.add(t.id);
  }
  return next;
}

/**
 * Drop whatever is no longer there to identify.
 *
 * A selection outlives the writes made around it — a tile ticked here can be consumed, discarded or
 * re-cut away from the tile dialog next to it — and a stale id in the set would put a number on the
 * bar that no longer stands for anything on screen. Re-derived from the tiles themselves after
 * every refetch, so the bar can only ever count squares the collector can see.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  tiles: readonly SelectableTile[]
): Set<string> {
  const live = new Set(tiles.filter(isSelectableTile).map((t) => t.id));
  const next = new Set<string>();
  for (const id of selected) if (live.has(id)) next.add(id);
  return next;
}

/** The ticked tiles, in the order the strip draws them — which is the order of the card on the
 *  desk, and therefore the order the created copies are numbered in. */
export function selectedInOrder<T extends SelectableTile>(
  selected: ReadonlySet<string>,
  tiles: readonly T[]
): T[] {
  return tiles.filter((t) => selected.has(t.id) && isSelectableTile(t));
}
