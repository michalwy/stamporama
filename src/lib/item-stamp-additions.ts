import { compareCatalogSortKeys } from "./catalog-sort-key";

// Adding stamps to the list of stamps on a piece (#2352, ADR-0044) — what one press of the picker
// does to the rows the copy's Edit dialog and the tile identification hold. Pure, so the two rules it
// carries are pinned by a unit test rather than by whichever dialog happens to call it.
//
// **A stamp already on the piece raises its row's quantity** instead of adding a second row: the
// same stamp twice loose is one entry of quantity 2 (ADR-0044 §4), and a second single row would be
// the pair `item_stamp_unique` refuses. Only the *single* row counts — a block of four of the same
// stamp on the cover is a different component, so a loose one beside it is a row of its own.
//
// **Several stamps land in catalogue order**, after the rows already on the list — the order the
// picker draws them in, whatever order they were ticked in. Ties keep the tick order.

/** The fields of a row these rules read — `ItemStampRow` and anything shaped like it. */
export interface StampRowLike {
  stampId: string;
  quantity: number;
  /** `""` is the single (ADR-0020 §3). */
  formatId: string;
}

/** A stamp as the picker hands it over: its id, and where it sorts in the catalogue. */
export interface StampToAdd {
  stampId: string;
  /** The stamp's main catalogue sort key (`catalogSortKeyOf`), null or absent to sort last. */
  catalogSortKey?: string | null;
}

/** `picked` in the order they will be added: catalogue order, ties in the order given. */
export function inAdditionOrder<P extends StampToAdd>(picked: readonly P[]): P[] {
  return picked
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        compareCatalogSortKeys(a.p.catalogSortKey ?? null, b.p.catalogSortKey ?? null) || a.i - b.i
    )
    .map(({ p }) => p);
}

/**
 * `rows` with `picked` added: each as a new single row of quantity 1 made by `newRow`, or — when the
 * stamp is already on the piece as a single — that row's quantity raised by one. Never mutates.
 */
export function addStampsToRows<R extends StampRowLike, P extends StampToAdd>(
  rows: readonly R[],
  picked: readonly P[],
  newRow: (picked: P) => R
): R[] {
  const next = [...rows];
  for (const p of inAdditionOrder(picked)) {
    const at = next.findIndex((row) => row.stampId === p.stampId && row.formatId === "");
    if (at >= 0) next[at] = { ...next[at], quantity: next[at].quantity + 1 };
    else next.push(newRow(p));
  }
  return next;
}
