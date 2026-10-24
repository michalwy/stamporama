import { ALL_SENTINEL, AREA_FILTER_PARAM, YEAR_FILTER_PARAM } from "@/lib/list-area-year-filter";

/**
 * The Copies list's remembered filter set, and the one way another screen links into the list so
 * that it shows **exactly** the copies a figure counted (#1398).
 *
 * Kept apart from `inventory-list-panel.tsx` so a screen linking in does not import the panel, and
 * so the unit suite can hold the link and the list's parser to the same set without React.
 */

export const DISPOSITION_FILTERS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

/** The filters this list remembers per collection (#693) — every one of them except the search box,
 * which is a lookup one finishes rather than a way of working (a list silently narrowed to a phrase
 * typed last week is the failure that rule avoids). The area and the year are absent because
 * `use-collection-filter-store` already carries them across every list screen (#143), the sort
 * because `usePersistedSort` does (#325), and the platform worklist because #275 remembers it on its
 * own — and its *review* half (#506) is deliberately never remembered, so it is not here either.
 * Grouping mode and its axes are a client preference of their own and never travel in the URL. */
export const REMEMBERED_FILTER_KEYS = [
  // The tag filter's two halves (#1182), remembered together: the mode alone says nothing, and a
  // remembered set of ids read back under the other reading would be a list nobody asked for.
  "tagIds",
  "tagMode",
  "faultIds",
  "conditionIds",
  "formatIds",
  "subtypeIds",
  "certificateStatusIds",
  "deliveryStates",
  "locationId",
  "noPhotos",
  "missingCatalogValue",
  "variantToSettle",
  "includeGone",
  "includeDisposed",
  "multiStamp",
  "complete",
  "held",
  ...DISPOSITION_FILTERS.map((f) => f.key),
] as const;

/** The platform worklist's own parameter (#259), remembered apart from the set above (#275). */
const NOT_OFFERED_PLATFORM_PARAM = "notOfferedPlatform";

/**
 * A link to the Copies list showing exactly the copies `params` select — **nothing the collector
 * left remembered narrows it further** (#1398).
 *
 * The list reads each filter from the URL where the URL names it and from memory otherwise (#693,
 * #143), so a link naming only `forSale=true` opens onto whatever condition, tag or area was left
 * set last time, and a figure beside it would disagree with the rows under it. Naming every other
 * remembered filter as empty, and the area and year as *all*, is how the list is told that nothing
 * else is in force — the same spelling its own *Reset filters* writes. Settled with the collector on
 * 2026-09-26: the figure and the list agree, at the cost of the remembered narrowing.
 */
export function exactCopiesListHref(base: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams();
  for (const key of REMEMBERED_FILTER_KEYS) query.set(key, "");
  query.set(NOT_OFFERED_PLATFORM_PARAM, "");
  query.set(AREA_FILTER_PARAM, ALL_SENTINEL);
  query.set(YEAR_FILTER_PARAM, ALL_SENTINEL);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `${base}/inventory?${query.toString()}`;
}

/** The parts of a copy {@link copyBehindFiltersHref} reads — whether it has left, and how. */
export interface CopyBehindFilters {
  itemNo: number;
  /** Left on a sale line (#166). */
  sold: boolean;
  /** Left in a closed trade (#644), or null. */
  tradedAway: unknown;
  /** No longer held (#394), or null. */
  disposedAt: unknown;
}

/**
 * Where the Copies list goes to show one copy that a `#123` search found nothing for (#2136): the
 * same search with every filter cleared — the {@link exactCopiesListHref} spelling, so nothing
 * remembered narrows it — and the one *Include* switch the copy needs turned on, because a sold,
 * traded-away or written-off copy is hidden by default and a cleared list would still hide it.
 */
export function copyBehindFiltersHref(base: string, copy: CopyBehindFilters): string {
  return exactCopiesListHref(base, {
    search: `#${copy.itemNo}`,
    ...(copy.sold || copy.tradedAway ? { includeGone: "true" } : {}),
    ...(copy.disposedAt ? { includeDisposed: "true" } : {}),
  });
}
