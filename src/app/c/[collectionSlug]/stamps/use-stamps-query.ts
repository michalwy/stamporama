"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { StampListItem } from "@/lib/stamps";

interface StampsPage {
  items: StampListItem[];
  nextCursor: string | null;
}

export const stampKeys = {
  all: (collectionId: string) => ["stamps", collectionId] as const,
  list: (collectionId: string, areaIds?: string[]) =>
    ["stamps", collectionId, "list", areaIds ?? "all"] as const,
};

export function useStampsInfinite(
  collectionId: string,
  areaIds?: string[]
) {
  return useInfiniteQuery<StampsPage>({
    queryKey: stampKeys.list(collectionId, areaIds),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam as string);
      if (areaIds && areaIds.length > 0)
        params.set("areaIds", areaIds.join(","));
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

export function useInvalidateStamps() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: stampKeys.all(collectionId),
      }),
  };
}
