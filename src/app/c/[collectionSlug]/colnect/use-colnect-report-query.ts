"use client";

import { useCallback } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ColnectReportCountry,
  ColnectReportCounts,
  ColnectReportList,
  ColnectReportRow,
} from "@/lib/colnect-list-report";
import { getColnectReportListsAction } from "@/app/actions/colnect";

// The report's reads (#686). One page of rows, and the two facets that ride with it.
//
// The counts and the countries come back **on the page** rather than from queries of their own: all
// three are the same comparison over the same tens of thousands of rows, and asking them separately
// would run it three times for one screen. Only the first page's copy is read — every later page
// carries the same answer, since the facets do not depend on the offset.

export interface ColnectReportPageResult {
  rows: ColnectReportRow[];
  nextCursor: string | null;
  counts: ColnectReportCounts;
  countries: ColnectReportCountry[];
}

/** What the screen narrows by, mirrored into the query key so a change refetches from the first
 *  page rather than appending to a list built under different terms. */
export interface ColnectReportFilterState {
  buckets: string[];
  countries: string[];
  includeHidden: boolean;
}

export const colnectReportKeys = {
  all: (collectionId: string) => ["colnect-report", collectionId] as const,
  lists: (collectionId: string) => ["colnect-report", collectionId, "lists"] as const,
  rows: (collectionId: string, lt: number | null, filters: ColnectReportFilterState) =>
    ["colnect-report", collectionId, "rows", lt, filters] as const,
};

/** Every configured list with the export its Colnect side comes from. Through a server action
 *  rather than a route: it is one small read the screen makes once, and the selector and the header
 *  both want it. */
export function useColnectReportLists(collectionId: string) {
  return useQuery<ColnectReportList[]>({
    queryKey: colnectReportKeys.lists(collectionId),
    queryFn: () => getColnectReportListsAction(collectionId),
  });
}

export function useColnectReport(
  collectionId: string,
  lt: number | null,
  filters: ColnectReportFilterState
) {
  return useInfiniteQuery<ColnectReportPageResult>({
    queryKey: colnectReportKeys.rows(collectionId, lt, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ lt: String(lt) });
      if (filters.buckets.length) params.set("buckets", filters.buckets.join(","));
      if (filters.countries.length) params.set("countries", filters.countries.join(","));
      if (filters.includeHidden) params.set("includeHidden", "1");
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(
        `/api/collections/${collectionId}/colnect/report?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to read the Colnect report.");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: lt !== null,
  });
}

/** Everything about the report at once. An import replaces the snapshot, and marking a row done or
 *  ignored changes what a bucket holds as well as the row — so nothing here is worth invalidating
 *  by halves. */
export function useInvalidateColnectReport() {
  const queryClient = useQueryClient();
  return useCallback(
    (collectionId: string) => {
      void queryClient.invalidateQueries({ queryKey: colnectReportKeys.all(collectionId) });
    },
    [queryClient]
  );
}
