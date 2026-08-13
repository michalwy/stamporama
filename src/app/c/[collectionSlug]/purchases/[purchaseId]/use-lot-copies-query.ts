"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ItemListItem,
  LotCopySort,
  LotCopyFilter,
  LotIntakeSummary,
  PurchaseIntakeSummary,
} from "@/lib/items";
import type { LocationRefUsage } from "@/lib/locations";
import type { PurchaseReturn } from "@/lib/purchase-return";

interface LotCopiesPage {
  items: ItemListItem[];
  nextCursor: string | null;
}

export interface LotCopiesParams {
  sort?: LotCopySort;
  sortDir?: "asc" | "desc";
  filter?: LotCopyFilter;
  /** Restrict to a single issue group (issue id or `"__none__"`) for the grouped view. */
  issueKey?: string;
}

export const lotCopiesKeys = {
  all: (collectionId: string) => ["lot-copies", collectionId] as const,
  lot: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId] as const,
  list: (collectionId: string, lotId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, lotId, "list", params] as const,
  summary: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "summary"] as const,
  purchaseList: (collectionId: string, purchaseId: string, params: LotCopiesParams) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "list", params] as const,
  purchaseSummary: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "summary"] as const,
  purchaseReturn: (collectionId: string, purchaseId: string) =>
    ["lot-copies", collectionId, "purchase", purchaseId, "return"] as const,
  lotReturn: (collectionId: string, lotId: string) =>
    ["lot-copies", collectionId, lotId, "return"] as const,
};

function buildCopyParams(params: LotCopiesParams, offset?: string): URLSearchParams {
  const sp = new URLSearchParams();
  if (offset) sp.set("offset", offset);
  if (params.sort) sp.set("sort", params.sort);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  if (params.filter) sp.set("filter", params.filter);
  if (params.issueKey) sp.set("issueKey", params.issueKey);
  return sp;
}

/** Infinite (cursor) list of a lot's copies for the paginated intake view (#172). Ordering,
 * filtering, and the issue-group scope are resolved server-side so scrolling never drops a
 * copy — replacing the old whole-lot load capped at 1000. */
export function useLotCopiesInfinite(
  collectionId: string,
  lotId: string,
  params: LotCopiesParams,
  enabled = true
) {
  return useInfiniteQuery<LotCopiesPage>({
    queryKey: lotCopiesKeys.list(collectionId, lotId, params),
    queryFn: async ({ pageParam }) => {
      const sp = buildCopyParams(params, pageParam as string | undefined);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/copies?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch lot copies");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** Infinite (cursor) list of a whole purchase's copies (across all lots), for the order-level
 * intake view with "By lot" grouping off — one globally-ordered flat/by-issue stream (#172). */
export function usePurchaseCopiesInfinite(
  collectionId: string,
  purchaseId: string,
  params: LotCopiesParams,
  enabled = true
) {
  return useInfiniteQuery<LotCopiesPage>({
    queryKey: lotCopiesKeys.purchaseList(collectionId, purchaseId, params),
    queryFn: async ({ pageParam }) => {
      const sp = buildCopyParams(params, pageParam as string | undefined);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/copies?${sp.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch purchase copies");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

/** Whole-lot aggregates (header counts, cost-estimate denominator, derived label, issue
 * groups) the paginated views can no longer compute client-side (#172). */
export function useLotSummary(collectionId: string, lotId: string, enabled = true) {
  return useQuery<LotIntakeSummary>({
    queryKey: lotCopiesKeys.summary(collectionId, lotId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/copies/summary`
      );
      if (!res.ok) throw new Error("Failed to fetch lot summary");
      return res.json();
    },
    enabled,
  });
}

/** Whole-purchase aggregates for the order-level view (#172): the per-lot estimate denominator
 * (each copy's estimate uses its own lot's pool + weight base) and issue groups merged across
 * all the purchase's lots. */
export function usePurchaseSummary(collectionId: string, purchaseId: string, enabled = true) {
  return useQuery<PurchaseIntakeSummary>({
    queryKey: lotCopiesKeys.purchaseSummary(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/copies/summary`
      );
      if (!res.ok) throw new Error("Failed to fetch purchase summary");
      return res.json();
    },
    enabled,
  });
}

/** What the order cost against what selling its copies has brought back (#559). Keyed under the
 * purchase's copies, since attaching, removing or closing copies moves the figure exactly as a sale
 * does — one invalidation covers both. */
export function usePurchaseReturn(collectionId: string, purchaseId: string, enabled = true) {
  return useQuery<PurchaseReturn>({
    queryKey: lotCopiesKeys.purchaseReturn(collectionId, purchaseId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/purchases/${purchaseId}/return`);
      if (!res.ok) throw new Error("Failed to fetch purchase return");
      return res.json();
    },
    enabled,
  });
}

/** The same figure for one lot (#559). Loaded beside the lot's own summary, and only while the lot
 * card is expanded — a collapsed lot draws no bar to put it in. */
export function useLotReturn(collectionId: string, lotId: string, enabled = true) {
  return useQuery<PurchaseReturn>({
    queryKey: lotCopiesKeys.lotReturn(collectionId, lotId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/return`
      );
      if (!res.ok) throw new Error("Failed to fetch lot return");
      return res.json();
    },
    enabled,
  });
}

/** The refs already written in one storage location, and the next one to suggest (#565). Read when
 * the file dialog's location changes — the whole set at once, because a location holds as many refs
 * as it has cards in it, and having them client-side is what lets the dialog answer *"`A147`
 * already holds 12 copies"* the moment a ref is typed instead of a round trip per keystroke. */
export function useLocationRefUsage(collectionId: string, locationId: string) {
  return useQuery<LocationRefUsage>({
    queryKey: ["location-ref-usage", collectionId, locationId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/locations/${locationId}/ref-usage`
      );
      if (!res.ok) throw new Error("Failed to fetch location refs");
      return res.json();
    },
    enabled: !!locationId,
  });
}

/** Invalidate every lot-copies list and summary for a collection after a copy/lot mutation,
 * so paginated pages and their aggregates refetch together. */
export function useInvalidateLotCopies() {
  const queryClient = useQueryClient();
  return {
    invalidateLotCopies: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: lotCopiesKeys.all(collectionId) }),
  };
}
