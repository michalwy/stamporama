"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StampListItem, StampSortBy } from "@/lib/stamps";
import type { IssueSearchItem } from "@/lib/issues";

interface StampsPage {
  items: StampListItem[];
  nextCursor: string | null;
}

export interface StampListFilters {
  areaIds?: string[];
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
  sortBy?: StampSortBy;
  sortDir?: "asc" | "desc";
}

export const stampKeys = {
  all: (collectionId: string) => ["stamps", collectionId] as const,
  list: (collectionId: string, filters: StampListFilters) =>
    ["stamps", collectionId, "list", filters] as const,
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

export function useInvalidateStamps() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: stampKeys.all(collectionId),
      }),
  };
}
