"use client";

import { useQuery } from "@tanstack/react-query";
import type { OverviewHoldings, OverviewProgress, OverviewValue } from "@/lib/overview";
import type { ValueHistory } from "@/lib/value-history-rules";

/**
 * The Overview screen's section reads (#649, #1398). Each section is its own query — and its own
 * route — so the Value figures render while Progress is still computing, and a failure in one
 * leaves the other standing. Own root key: nothing invalidates the Overview, its figures go stale
 * on the shared 30s clock and are recomputed on the next visit.
 */
export function useOverviewHoldings(collectionId: string) {
  return useQuery<OverviewHoldings>({
    queryKey: ["overview", collectionId, "holdings"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/overview/holdings`);
      if (!res.ok) throw new Error("Failed to load the collection's holdings");
      return res.json();
    },
  });
}

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

/** The value-over-time chart's series (#653) — a third query under the same root, so the chart loads
 * and fails apart from the tiles above it. */
export function useOverviewValueHistory(collectionId: string) {
  return useQuery<ValueHistory>({
    queryKey: ["overview", collectionId, "value-history"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/overview/value-history`);
      if (!res.ok) throw new Error("Failed to load the collection's value history");
      return res.json();
    },
  });
}
