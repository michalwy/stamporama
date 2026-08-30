"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ScansData } from "@/lib/scan-sheets";

// Scan batches (#566, re-parented to the purchase by #586 and to the collection by #725). Loaded
// only while the Card scans section is open: a carton is fifty cards and a card of forty tiles is
// forty thumbnails.

/**
 * Which card scans a screen is about — an order's, or the collection's purchase-less ones (#725).
 *
 * The client twin of the server's `ScanOwnerRef`, and it travels as one value everywhere the old
 * `purchaseId` prop did: a component holding an owner cannot be handed a purchase id by one caller
 * and a collection id by another, and the query key below is built from it so the two screens are
 * two caches rather than one that occasionally shows the wrong card.
 */
export type ScanOwner = { kind: "purchase"; purchaseId: string } | { kind: "collection" };

/** The API prefix the owner's reads and its upload open hang off. */
export function scansApiBase(collectionId: string, owner: ScanOwner): string {
  return owner.kind === "purchase"
    ? `/api/collections/${collectionId}/purchases/${owner.purchaseId}/scan-sheets`
    : `/api/collections/${collectionId}/scan-sheets`;
}

/** The id this owner's remembered view state is filed under (`purchase-ui-state.ts`). A purchase
 * uses its own id; the collection's cards use one fixed name, which cannot collide with a cuid. */
export function scanOwnerUiKey(owner: ScanOwner): string {
  return owner.kind === "purchase" ? owner.purchaseId : "collection-scans";
}

export const scansKeys = {
  all: (collectionId: string) => ["purchase-scans", collectionId] as const,
  owner: (collectionId: string, owner: ScanOwner) =>
    [
      "purchase-scans",
      collectionId,
      owner.kind === "purchase" ? owner.purchaseId : "collection",
    ] as const,
};

export function useScans(collectionId: string, owner: ScanOwner, enabled = true) {
  return useQuery<ScansData>({
    queryKey: scansKeys.owner(collectionId, owner),
    queryFn: async () => {
      const res = await fetch(scansApiBase(collectionId, owner));
      if (!res.ok) throw new Error("Failed to fetch the card scans");
      return res.json();
    },
    enabled,
  });
}

/** Invalidate a collection's scan reads after an upload, a cut, a pairing, a re-cut or a rename.
 * Deliberately the whole namespace and not one owner's: identifying a tile can be reached from
 * either screen, and a stale strip is exactly the failure this exists to prevent. */
export function useInvalidateScans() {
  const queryClient = useQueryClient();
  return {
    invalidateScans: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: scansKeys.all(collectionId) }),
  };
}
