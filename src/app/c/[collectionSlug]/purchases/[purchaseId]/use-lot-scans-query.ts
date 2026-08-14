"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LotScansData } from "@/lib/scan-sheets";

// Scan batches on a lot (#566). Loaded only while the lot card is open and its Scans section is
// expanded: a card of forty tiles is forty thumbnails, and a collapsed lot has nowhere to draw them.

export const lotScansKeys = {
  all: (collectionId: string) => ["lot-scans", collectionId] as const,
  lot: (collectionId: string, lotId: string) => ["lot-scans", collectionId, lotId] as const,
};

export function useLotScans(collectionId: string, lotId: string, enabled = true) {
  return useQuery<LotScansData>({
    queryKey: lotScansKeys.lot(collectionId, lotId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/scan-sheets`
      );
      if (!res.ok) throw new Error("Failed to fetch the lot's scans");
      return res.json();
    },
    enabled,
  });
}

/** Invalidate a collection's scan reads after an upload, a cut, a pairing or a re-cut. */
export function useInvalidateLotScans() {
  const queryClient = useQueryClient();
  return {
    invalidateLotScans: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: lotScansKeys.all(collectionId) }),
  };
}
