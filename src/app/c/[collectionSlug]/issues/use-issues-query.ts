"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { IssueListItem, IssueSortBy, StampNodeData, YearFacet } from "@/lib/issues";

interface IssuesPage {
  items: IssueListItem[];
  nextCursor: string | null;
}

export interface IssueListFilters {
  areaIds?: string[];
  search?: string;
  /** Vendor + bare number parsed out of the quick search text (#289), so a prefixed
   *  catalog number ("Mi PL 200") matches even though that spelling is never stored. */
  searchCatalogVendorId?: string;
  searchCatalogNumber?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  /** "none" for the no-year bucket, otherwise a numeric year string. */
  year?: string;
  sortBy?: IssueSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the price column / issue totals. */
  displayConditionId?: string | null;
  /** Format whose price fills the price column / issue totals (#343); null is the single. */
  displayFormatId?: string | null;
}

/** Filters that affect the year facet counts (everything except year itself). */
export interface IssueYearFacetFilters {
  areaIds?: string[];
  search?: string;
  searchCatalogVendorId?: string;
  searchCatalogNumber?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
}

export const issueKeys = {
  all: (collectionId: string) => ["issues", collectionId] as const,
  list: (collectionId: string, filters: IssueListFilters) =>
    ["issues", collectionId, "list", filters] as const,
  years: (collectionId: string, filters: IssueYearFacetFilters) =>
    ["issues", collectionId, "years", filters] as const,
  members: (
    collectionId: string,
    issueId: string,
    displayConditionId?: string | null,
    displayFormatId?: string | null
  ) =>
    [
      "issues",
      collectionId,
      "members",
      issueId,
      displayConditionId ?? null,
      displayFormatId ?? null,
    ] as const,
};

export function useIssuesInfinite(
  collectionId: string,
  filters: IssueListFilters
) {
  return useInfiniteQuery<IssuesPage>({
    queryKey: issueKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.searchCatalogVendorId)
        params.set("searchCatalogVendorId", filters.searchCatalogVendorId);
      if (filters.searchCatalogNumber)
        params.set("searchCatalogNumber", filters.searchCatalogNumber);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      if (filters.year) params.set("year", filters.year);
      if (filters.displayConditionId) params.set("displayConditionId", filters.displayConditionId);
      if (filters.displayFormatId) params.set("displayFormatId", filters.displayFormatId);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/issues?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch issues");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useIssueYears(
  collectionId: string,
  filters: IssueYearFacetFilters
) {
  return useQuery<YearFacet[]>({
    queryKey: issueKeys.years(collectionId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.areaIds && filters.areaIds.length > 0)
        params.set("areaIds", filters.areaIds.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.searchCatalogVendorId)
        params.set("searchCatalogVendorId", filters.searchCatalogVendorId);
      if (filters.searchCatalogNumber)
        params.set("searchCatalogNumber", filters.searchCatalogNumber);
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
      const res = await fetch(
        `/api/collections/${collectionId}/issues/years?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch issue years");
      const data = await res.json();
      return data.years;
    },
  });
}

export function useIssueMembers(
  collectionId: string,
  issueId: string,
  enabled: boolean,
  displayConditionId?: string | null,
  displayFormatId?: string | null
) {
  return useQuery<StampNodeData[]>({
    queryKey: issueKeys.members(collectionId, issueId, displayConditionId, displayFormatId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (displayConditionId) params.set("displayConditionId", displayConditionId);
      if (displayFormatId) params.set("displayFormatId", displayFormatId);
      const qs = params.toString();
      const res = await fetch(
        `/api/collections/${collectionId}/issues/${issueId}/members${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error("Failed to fetch members");
      const data = await res.json();
      return data.members;
    },
    enabled,
  });
}

export function useInvalidateIssues() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: issueKeys.all(collectionId),
      }),
    invalidateMembers: (collectionId: string, issueId: string) =>
      // Prefix match so every display-condition / display-format variant of this issue's members
      // is invalidated (the full key carries both as trailing segments, #238/#343).
      queryClient.invalidateQueries({
        queryKey: ["issues", collectionId, "members", issueId],
      }),
  };
}
