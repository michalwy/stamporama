/**
 * What the **Attach existing copies…** picker lists, worked out where the copies are read (#2179):
 * the year facet's counts, how many copies the filters hold, and those copies in the chosen order —
 * as ids, so the read can enrich only the page being drawn. Pure, so the server read and the unit
 * suite share one definition.
 *
 * The filters a `where` can say (area, state, disposition, condition, certificate, format, purchase)
 * have already narrowed the candidates; this applies the rest exactly as the dialog once did over
 * the rows it held: the search is `copyMatchesSearch` (#2136), the year is the stamp's issued year,
 * and the order is `sortAttachableCopies` (#2147). **The year facet is counted over every filter but the
 * year itself**, so a year's count says what choosing it would list, and the other years stay
 * reachable once one is chosen.
 */

import { copyMatchesSearch, type CopySearchable } from "./copy-search";
import type { AttachYear } from "./attach-picker-filters";
import {
  sortAttachableCopies,
  type AttachSortCopy,
  type AttachSortDir,
  type AttachSortKey,
} from "./attach-picker-sort";

/** One candidate copy: what the search, the year and the sort read, and nothing else. */
export type AttachCandidate = AttachSortCopy & CopySearchable & { id: string };

export interface AttachYearFacet {
  year: number | null;
  count: number;
}

export interface AttachPlan {
  /** Every copy the filters hold, in the chosen order. */
  ids: string[];
  /** Per issued year, over every filter but the year; no year (null) last. */
  yearFacets: AttachYearFacet[];
}

export interface AttachPlanQuery {
  year: AttachYear;
  search: string;
  sortBy: AttachSortKey;
  sortDir: AttachSortDir;
}

export function planAttachPicker<T extends AttachCandidate>(
  candidates: readonly T[],
  query: AttachPlanQuery,
  areaOrder: readonly string[],
  catalogKeysOf: (copy: T) => readonly string[]
): AttachPlan {
  const searched = candidates.filter((c) => copyMatchesSearch(c, query.search, () => catalogKeysOf(c)));
  const counts = new Map<number | null, number>();
  for (const c of searched) counts.set(c.issuedYear, (counts.get(c.issuedYear) ?? 0) + 1);
  const yearFacets = [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : a.year - b.year));
  const { year } = query;
  const inYear =
    year === null
      ? searched
      : searched.filter((c) => (year === "none" ? c.issuedYear === null : c.issuedYear === year));
  const ordered = sortAttachableCopies(inYear, query.sortBy, query.sortDir, areaOrder);
  return { ids: ordered.map((c) => c.id), yearFacets };
}
