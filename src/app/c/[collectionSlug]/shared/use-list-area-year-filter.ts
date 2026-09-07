"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import {
  AREA_FILTER_PARAM,
  YEAR_FILTER_PARAM,
  areaYearUrlUpdates,
  resolveAreaYearFilter,
  shouldRememberAreaYear,
} from "@/lib/list-area-year-filter";
import { useCollectionFilterStore } from "./use-collection-filter-store";
import { useHydrated } from "./lot-view-prefs";

/**
 * The shared area + year selection for a **URL-backed list screen** — the Copies, Issues, Stamps
 * and listing-workspace lists, each of which draws the same `ListFilterSidebar` (#143, #844).
 *
 * The vocabulary and the precedence are `@/lib/list-area-year-filter`; what is here is where the
 * value is kept and the two mirrors that keep the address, the screen and the memory saying the
 * same thing:
 *
 * - **into the memory**, so the next list opens on the same country and year;
 * - **into the address**, with `replace`, so a reload has something to read back. This is the half
 *   #844 was missing. A restore is not a navigation — the collector did not go anywhere, the screen
 *   simply caught up with what it already knew — so it must not become a history entry the back
 *   button has to walk through.
 *
 * Both mirrors wait for {@link useHydrated}. The memory is read through `useSyncExternalStore` with
 * an empty server snapshot, so the first render of a freshly loaded page sees no remembered filter
 * whether or not one exists; mirroring *that* into the address would switch off a filter that is
 * about to arrive, and mirroring it into the memory would erase it outright.
 *
 * A press writes both places itself, through the screen's own `updateParams` funnel, so it needs no
 * help from either effect — they are guarded on equality and write once.
 */
export function useListAreaYearFilter(
  collectionId: string,
  /** The collection's whole area tree, so an id naming nothing can be dropped rather than queried. */
  areas: readonly { id: string }[]
): {
  /** The area in force, or null for every area. */
  filterAreaId: string | null;
  /** The year in force, `""` for every year — the shape the list filters are built from. */
  year: string;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const { storedAreaId, storedYear, writeStore } = useCollectionFilterStore(collectionId);

  const urlAreaId = searchParams.get(AREA_FILTER_PARAM);
  const urlYear = searchParams.get(YEAR_FILTER_PARAM);
  const knownAreaIds = useMemo(() => new Set(areas.map((a) => a.id)), [areas]);
  const selection = resolveAreaYearFilter({
    urlAreaId,
    urlYear,
    storedAreaId,
    storedYear,
    knownAreaIds,
  });
  const { areaId: filterAreaId } = selection;
  const year = selection.year ?? "";

  // Carry the selection to the next list. `writeStore` no-ops when unchanged, so a restore — which
  // is the common case — notifies nobody and cannot loop.
  useEffect(() => {
    if (!hydrated) return;
    if (!shouldRememberAreaYear({ areaId: filterAreaId, year: year || null }, urlAreaId, urlYear))
      return;
    writeStore({ areaId: filterAreaId, year: year || null });
  }, [hydrated, filterAreaId, year, urlAreaId, urlYear, writeStore]);

  /** Write the selection into the address, keeping every other parameter exactly as it was — the
   * Copies list's dozen filters, the listing workspace's `?platform=`. */
  const writeToUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) params.set(key, value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const writeToUrlRef = useRef(writeToUrl);
  useEffect(() => {
    writeToUrlRef.current = writeToUrl;
  });
  useEffect(() => {
    if (!hydrated) return;
    const updates = areaYearUrlUpdates(
      { areaId: filterAreaId, year: year || null },
      urlAreaId,
      urlYear
    );
    if (!updates) return;
    writeToUrlRef.current(updates);
  }, [hydrated, filterAreaId, year, urlAreaId, urlYear]);

  return { filterAreaId, year };
}
