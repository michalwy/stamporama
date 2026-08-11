"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WantIssueGroupRow, WantListItem, WantYearFacet } from "@/lib/wants";
import type { WantPriority } from "@/lib/want-rules";

interface WantsPage {
  items: WantListItem[];
  nextCursor: string | null;
}

/** What the screen narrows by. Mirrored into the query key, so changing any of them refetches from
 *  the first page rather than appending to a list built under different terms. */
export interface WantListFilters {
  status?: "open" | "closed" | "all";
  priorities?: WantPriority[];
  conditionIds?: string[];
  areaIds?: string[];
  /** "none" for the no-year bucket, otherwise a numeric year string. */
  year?: string;
  /** One issue's wants — what an expanded issue group reads its members with. `NO_ISSUE` asks for
   *  the wants whose stamp is in no issue, which an absent filter cannot. */
  issueId?: string;
  /** One stamp's wants — what the stamp detail screen's card reads (#518). */
  stampId?: string;
  search?: string;
}

/** The filters the year facets are counted against — everything except the year itself. */
export type WantYearFacetFilters = Omit<WantListFilters, "year">;

export const wantKeys = {
  all: (collectionId: string) => ["wants", collectionId] as const,
  list: (collectionId: string, filters: WantListFilters) =>
    ["wants", collectionId, "list", filters] as const,
  years: (collectionId: string, filters: WantYearFacetFilters) =>
    ["wants", collectionId, "years", filters] as const,
  issueGroups: (collectionId: string, filters: WantListFilters) =>
    ["wants", collectionId, "issue-groups", filters] as const,
};

/** The filters both endpoints take, as query parameters. One builder, so the page and the facets
 *  beside it can never be asked slightly different questions. */
function toParams(filters: WantListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priorities?.length) params.set("priorities", filters.priorities.join(","));
  if (filters.conditionIds?.length) params.set("conditionIds", filters.conditionIds.join(","));
  if (filters.areaIds?.length) params.set("areaIds", filters.areaIds.join(","));
  if (filters.year) params.set("year", filters.year);
  if (filters.issueId) params.set("issueId", filters.issueId);
  if (filters.stampId) params.set("stampId", filters.stampId);
  if (filters.search) params.set("search", filters.search);
  return params;
}

/** One page at a time (#532). A want list is a collecting plan's shopping list and runs to
 *  thousands, so it scrolls like the stamps and inventory lists rather than arriving whole.
 *
 *  `enabled` is what an issue group's members ride on: a collector opens a handful of series out of
 *  a long list, and fetching every group's wants up front is the cost the grouped view exists to
 *  avoid. */
export function useWantsInfinite(
  collectionId: string,
  filters: WantListFilters,
  enabled = true
) {
  return useInfiniteQuery<WantsPage>({
    queryKey: wantKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = toParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(`/api/collections/${collectionId}/wants?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch the want list");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useWantYears(collectionId: string, filters: WantYearFacetFilters) {
  return useQuery<WantYearFacet[]>({
    queryKey: wantKeys.years(collectionId, filters),
    queryFn: async () => {
      const params = toParams(filters);
      const res = await fetch(
        `/api/collections/${collectionId}/wants/years?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch the want year facets");
      const data = await res.json();
      return data.facets;
    },
  });
}

interface WantIssueGroupsPage {
  groups: WantIssueGroupRow[];
  nextCursor: string | null;
}

/** The same list as one row per series (#532) — a *view* of the flat list, sharing its filters. */
export function useWantIssueGroups(
  collectionId: string,
  filters: WantListFilters,
  enabled: boolean
) {
  return useInfiniteQuery<WantIssueGroupsPage>({
    queryKey: wantKeys.issueGroups(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = toParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(
        `/api/collections/${collectionId}/wants/issue-groups?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch the want issue groups");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useInvalidateWants() {
  const queryClient = useQueryClient();
  return {
    invalidate: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: wantKeys.all(collectionId) }),
  };
}
