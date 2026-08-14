"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PurchaseScansData } from "@/lib/scan-sheets";

// Scan batches on an order (#566, re-parented to the purchase by #586). Loaded only while the Card
// scans section is open: a carton is fifty cards and a card of forty tiles is forty thumbnails.

export const purchaseScansKeys = {
  all: (collectionId: string) => ["purchase-scans", collectionId] as const,
  purchase: (collectionId: string, purchaseId: string) =>
    ["purchase-scans", collectionId, purchaseId] as const,
};

export function usePurchaseScans(collectionId: string, purchaseId: string, enabled = true) {
  return useQuery<PurchaseScansData>({
    queryKey: purchaseScansKeys.purchase(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/scan-sheets`
      );
      if (!res.ok) throw new Error("Failed to fetch the order's scans");
      return res.json();
    },
    enabled,
  });
}

/** Invalidate a collection's scan reads after an upload, a cut, a pairing, a re-cut or a rename. */
export function useInvalidatePurchaseScans() {
  const queryClient = useQueryClient();
  return {
    invalidatePurchaseScans: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: purchaseScansKeys.all(collectionId) }),
  };
}
