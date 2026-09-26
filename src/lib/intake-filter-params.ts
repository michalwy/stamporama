import type { CopyDispositionFilter, LotCopyFilter, LotStateFilter } from "./items";

/**
 * Reading the sort screen's two filter axes off a query string (#622).
 *
 * One place rather than one per route, because five endpoints now take the same pair — the lot and
 * order copy pages and their summaries — and a filter parsed loosely in one of them would show the
 * collector a group heading whose list is empty, or count a selection differently from the write
 * that follows it.
 *
 * Anything unrecognised is dropped rather than refused: a filter can only ever narrow a read, so an
 * unknown one is a wider answer and never someone else's copies.
 *
 * The vocabularies live **here** rather than beside the query builders in `items.ts`, and this
 * module imports only *types* from it, so it stays free of `server-only`. The order screen now
 * remembers both filters and has to read its stored value back through the same parsers the
 * endpoints use — a client that had to keep its own copy of the vocabulary is exactly the drift
 * this module exists to prevent.
 */
const LOT_COPY_FILTERS: readonly LotCopyFilter[] = ["none", "unpriced", "to-sort", "no-photos"];

export const COPY_DISPOSITION_FILTERS: readonly CopyDispositionFilter[] = [
  "in-collection",
  "for-sale",
  "for-trade",
];

export function parseLotCopyFilter(raw: string | null): LotCopyFilter | undefined {
  return LOT_COPY_FILTERS.includes(raw as LotCopyFilter) ? (raw as LotCopyFilter) : undefined;
}

export function parseDispositionFilter(raw: string | null): CopyDispositionFilter | undefined {
  return COPY_DISPOSITION_FILTERS.includes(raw as CopyDispositionFilter)
    ? (raw as CopyDispositionFilter)
    : undefined;
}

/** The lot-state axis (#1394), read by the two order-level endpoints and by the order screen's
 * remembered value alike. */
export const LOT_STATE_FILTERS: readonly LotStateFilter[] = ["open", "closed"];

export function parseLotStateFilter(raw: string | null): LotStateFilter | undefined {
  return LOT_STATE_FILTERS.includes(raw as LotStateFilter) ? (raw as LotStateFilter) : undefined;
}

/** The lots the by-lot view draws under a lot-state filter (#1394) — every lot for none, in the
 * order's own order either way. Generic over the lot, so the screen hands it the rows it renders
 * and gets them back rather than a list of ids to look up again. */
export function lotsInState<L extends { status: string }>(
  lots: readonly L[],
  lotState: LotStateFilter | undefined
): L[] {
  return lotState ? lots.filter((lot) => lot.status === lotState) : [...lots];
}
