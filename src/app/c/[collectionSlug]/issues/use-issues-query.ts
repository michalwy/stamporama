"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { IssueListItem, StampNodeData } from "@/lib/issues";

interface IssuesPage {
  items: IssueListItem[];
  nextCursor: string | null;
}

export const issueKeys = {
  all: (collectionId: string) => ["issues", collectionId] as const,
  list: (collectionId: string, areaIds?: string[]) =>
    ["issues", collectionId, "list", areaIds ?? "all"] as const,
  members: (collectionId: string, issueId: string) =>
    ["issues", collectionId, "members", issueId] as const,
};

export function useIssuesInfinite(
  collectionId: string,
  areaIds?: string[]
) {
  return useInfiniteQuery<IssuesPage>({
    queryKey: issueKeys.list(collectionId, areaIds),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam as string);
      if (areaIds && areaIds.length > 0)
        params.set("areaIds", areaIds.join(","));
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
