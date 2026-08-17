import {
  COPY_DISPOSITION_FILTERS,
  type CopyDispositionFilter,
  type LotCopyFilter,
} from "./items";

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
 */
const LOT_COPY_FILTERS: readonly LotCopyFilter[] = ["none", "unpriced", "to-sort", "no-photos"];

export function parseLotCopyFilter(raw: string | null): LotCopyFilter | undefined {
  return LOT_COPY_FILTERS.includes(raw as LotCopyFilter) ? (raw as LotCopyFilter) : undefined;
}

export function parseDispositionFilter(raw: string | null): CopyDispositionFilter | undefined {
  return COPY_DISPOSITION_FILTERS.includes(raw as CopyDispositionFilter)
    ? (raw as CopyDispositionFilter)
    : undefined;
}
