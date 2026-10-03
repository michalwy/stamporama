"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ScansData } from "@/lib/scan-sheets";
import { isScanUploadPending } from "@/lib/scan-upload-status-rules";

/** How often the section asks again while a scan of the order is waiting or being prepared (#1567).
 * Each ask answers at once; the scan's preparation itself never sits inside a request. */
const PREPARING_POLL_MS = 2_000;

// Scan batches (#566, re-parented to the purchase by #586). Loaded only while the Card scans section
// is open: a carton is fifty cards and a card of forty tiles is forty thumbnails.

/** The API prefix an order's scan reads and its upload open hang off. */
export function scansApiBase(collectionId: string, purchaseId: string): string {
  return `/api/collections/${collectionId}/purchases/${purchaseId}/scan-sheets`;
}

export const scansKeys = {
  all: (collectionId: string) => ["purchase-scans", collectionId] as const,
  purchase: (collectionId: string, purchaseId: string) =>
    ["purchase-scans", collectionId, purchaseId] as const,
};

export function useScans(collectionId: string, purchaseId: string, enabled = true) {
  return useQuery<ScansData>({
    queryKey: scansKeys.purchase(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(scansApiBase(collectionId, purchaseId));
      if (!res.ok) throw new Error("Failed to fetch the card scans");
      return res.json();
    },
    enabled,
    // Asked again only while something is on its way to being a card, so a page left open over a
    // finished order costs nothing.
    refetchInterval: (query) =>
      query.state.data?.uploads?.some((u) => isScanUploadPending(u.status))
        ? PREPARING_POLL_MS
        : false,
  });
}

/** Invalidate a collection's scan reads after an upload, a cut, a pairing, a re-cut or a rename.
 * Deliberately the whole namespace and not one order's: a stale strip is exactly the failure this
 * exists to prevent, and a namespace nobody is watching is only marked stale. */
export function useInvalidateScans() {
  const queryClient = useQueryClient();
  return {
    invalidateScans: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: scansKeys.all(collectionId) }),
  };
}
