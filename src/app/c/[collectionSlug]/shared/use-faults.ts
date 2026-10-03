"use client";

import { useQuery } from "@tanstack/react-query";
import type { FaultSummary } from "@/lib/faults";

/**
 * The collection's fault dictionary (#1557) — what the copy dialog's fault field offers, and what
 * the Copies list's fault filter and bulk edit offer. Its own hook for `useCollectionTags`' reason:
 * small, per-collection, rarely changed, and needed on screens with no other reason to load it.
 * What a *chip* draws rides on the row, so a list never waits on this query.
 */
export const faultKeys = {
  all: (collectionId: string) => ["faults", collectionId] as const,
};

export function useCollectionFaults(collectionId: string) {
  return useQuery<FaultSummary[]>({
    queryKey: faultKeys.all(collectionId),
    queryFn: async () => {
      const { listFaultsAction } = await import("@/app/actions/faults");
      return listFaultsAction(collectionId);
    },
    staleTime: 60_000,
  });
}
