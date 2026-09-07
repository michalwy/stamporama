"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { StampListItem, StampSortBy, StampYearFacet } from "@/lib/stamps";
import type { IssueSearchItem } from "@/lib/issues";
import type { AreaFacet } from "@/lib/area-facets";
import {
  STAMP_ATTRIBUTE_FILTER_KEYS,
  type StampAttributeFilters,
} from "@/lib/stamp-attribute-kinds";

interface StampsPage {
  items: StampListItem[];
  nextCursor: string | null;
}

/** The catalogue-attribute narrowing both stamp queries carry (#737) — one id set per dictionary,
 *  absent or empty meaning every value. */
export interface StampListFilters extends StampAttributeFilters {
  areaIds?: string[];
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
  /** "none" for the no-year bucket, otherwise a numeric year string. */
  year?: string;
  sortBy?: StampSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the price column. */
  displayConditionId?: string | null;
  /** Format whose price fills the price column (#343); null is the single. */
  displayFormatId?: string | null;
}

/** Filters that affect the year facet counts (everything except year itself). The attribute
 *  filters are among them: they narrow the list, so the counts have to answer for them — unlike the
 *  condition and format switchers, which only choose which price a row shows. */
export interface StampYearFacetFilters extends StampAttributeFilters {
  areaIds?: string[];
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
}

/** Filters that affect the area facet counts (#843) — everything except the area selection itself,
 *  which is why `year` is in here and out of {@link StampYearFacetFilters}. */
export interface StampAreaFacetFilters extends StampAttributeFilters {
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
  /** "none" for the no-year bucket, otherwise a numeric year string. */
  year?: string;
}

/** Writes the four attribute filters onto a request's query string, in the shape the API route
 *  reads back. Empty sets are left off entirely, so a request carries only what is narrowing. */
function appendAttributeFilters(params: URLSearchParams, filters: StampAttributeFilters) {
  for (const key of STAMP_ATTRIBUTE_FILTER_KEYS) {
    const ids = filters[key];
    if (ids && ids.length > 0) params.set(key, ids.join(","));
  }
}

export const stampKeys = {
  all: (collectionId: string) => ["stamps", collectionId] as const,
  list: (collectionId: string, filters: StampListFilters) =>
    ["stamps", collectionId, "list", filters] as const,
  years: (collectionId: string, filters: StampYearFacetFilters) =>
    ["stamps", collectionId, "years", filters] as const,
  areaFacets: (collectionId: string, filters: StampAreaFacetFilters) =>
    ["stamps", collectionId, "area-facets", filters] as const,
  issueSearch: (collectionId: string, query: string, areaIds?: string[]) =>
    ["stamps", collectionId, "issueSearch", query, areaIds ?? "all"] as const,
};

export function useStampsInfinite(
  collectionId: string,
  filters: StampListFilters
) {
  return useInfiniteQuery<StampsPage>({
    queryKey: stampKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.issueId) params.set("issueId", filters.issueId);
      appendAttributeFilters(params, filters);
      if (filters.year) params.set("year", filters.year);
      if (filters.displayConditionId) params.set("displayConditionId", filters.displayConditionId);
      if (filters.displayFormatId) params.set("displayFormatId", filters.displayFormatId);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/stamps?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch stamps");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useStampYears(
  collectionId: string,
  filters: StampYearFacetFilters
) {
  return useQuery<StampYearFacet[]>({
    queryKey: stampKeys.years(collectionId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.issueId) params.set("issueId", filters.issueId);
      appendAttributeFilters(params, filters);
      const res = await fetch(
        `/api/collections/${collectionId}/stamps/years?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch stamp years");
      const data = await res.json();
      return data.years;
    },
  });
}

export function useStampAreaFacets(
  collectionId: string,
  filters: StampAreaFacetFilters
) {
  return useQuery<AreaFacet[]>({
    queryKey: stampKeys.areaFacets(collectionId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.issueId) params.set("issueId", filters.issueId);
      if (filters.year) params.set("year", filters.year);
      appendAttributeFilters(params, filters);
      const res = await fetch(
        `/api/collections/${collectionId}/stamps/areas?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch stamp area facets");
      const data = await res.json();
      return data.areas;
    },
  });
}

export function useIssueSearch(
  collectionId: string,
  query: string,
  areaIds?: string[]
) {
  return useQuery<IssueSearchItem[]>({
    queryKey: stampKeys.issueSearch(collectionId, query, areaIds),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("q", query);
      if (areaIds && areaIds.length > 0)
        params.set("areaIds", areaIds.join(","));
      const res = await fetch(
        `/api/collections/${collectionId}/issues/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search issues");
      const data = await res.json();
      return data.items;
    },
    enabled: query.length >= 1,
  });
}

// **There is deliberately no `useInvalidateStamps` here** (#918). Invalidating the stamps cache on
// its own was the half-answer that nine call sites gave five different versions of: a stamp row
// carries its issue's name, year and checklists, so the two caches always go stale together. The
// hook that does both is `shared/use-invalidate-stamps-and-issues.ts`, and `stampKeys.all` above is
// what it invalidates.
