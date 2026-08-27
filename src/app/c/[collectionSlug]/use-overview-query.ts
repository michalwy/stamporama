"use client";

import { useQuery } from "@tanstack/react-query";
import type { OverviewProgress, OverviewValue } from "@/lib/overview";

/**
 * The Overview screen's two section reads (#649). Each section is its own query — and its own
 * route — so the Value figures render while Progress is still computing, and a failure in one
 * leaves the other standing. Own root key: nothing invalidates the Overview, its figures go stale
 * on the shared 30s clock and are recomputed on the next visit.
 */
export function useOverviewValue(collectionId: string) {
  return useQuery<OverviewValue>({
    queryKey: ["overview", collectionId, "value"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/overview/value`);
      if (!res.ok) throw new Error("Failed to load the collection's value figures");
      return res.json();
    },
  });
}

export function useOverviewProgress(collectionId: string) {
  return useQuery<OverviewProgress>({
    queryKey: ["overview", collectionId, "progress"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/overview/progress`);
      if (!res.ok) throw new Error("Failed to load the collection's progress figures");
      return res.json();
    },
  });
}
