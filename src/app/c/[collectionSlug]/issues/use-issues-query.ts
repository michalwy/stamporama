"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { IssueListItem, IssueSortBy, StampNodeData } from "@/lib/issues";

interface IssuesPage {
  items: IssueListItem[];
  nextCursor: string | null;
}

export interface IssueListFilters {
  areaIds?: string[];
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  sortBy?: IssueSortBy;
  sortDir?: "asc" | "desc";
}

export const issueKeys = {
  all: (collectionId: string) => ["issues", collectionId] as const,
  list: (collectionId: string, filters: IssueListFilters) =>
    ["issues", collectionId, "list", filters] as const,
  members: (collectionId: string, issueId: string) =>
    ["issues", collectionId, "members", issueId] as const,
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
      if (filters.catalogVendorId) params.set("catalogVendorId", filters.catalogVendorId);
      if (filters.catalogNumber) params.set("catalogNumber", filters.catalogNumber);
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

export function useIssueMembers(
  collectionId: string,
  issueId: string,
  enabled: boolean
) {
  return useQuery<StampNodeData[]>({
    queryKey: issueKeys.members(collectionId, issueId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/issues/${issueId}/members`
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
      queryClient.invalidateQueries({
        queryKey: issueKeys.members(collectionId, issueId),
      }),
  };
}
