"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LotListItem, LotSubLotSummary } from "@/lib/sale-lots";
import type { ItemListItem } from "@/lib/items";
import type { LotKind, LotState } from "@/lib/sale-lot-rules";

interface LotsPage {
  items: LotListItem[];
  nextCursor: string | null;
}

export interface LotFilters {
  kind?: LotKind;
  state?: LotState;
  hideGrouped?: boolean;
}

export const lotKeys = {
  all: (collectionId: string) => ["lots", collectionId] as const,
  list: (collectionId: string, filters: LotFilters) =>
    ["lots", collectionId, "list", filters] as const,
};

export function useLotsInfinite(collectionId: string, filters: LotFilters) {
  return useInfiniteQuery<LotsPage>({
    queryKey: lotKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.kind) params.set("kind", filters.kind);
      if (filters.state) params.set("state", filters.state);
      if (filters.hideGrouped) params.set("hideGrouped", "1");
      const res = await fetch(
        `/api/collections/${collectionId}/lots?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch lots");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export interface SellableCopiesFilters {
  areaIds: string[] | null;
  year: string | null;
  search: string;
  /** Restrict to one stamp (quantity-lot copy picker: the lot's shape stamp). */
  stampId?: string | null;
  /** Restrict to one condition (quantity-lot copy picker: the lot's shape condition). */
  conditionId?: string | null;
  /** Copy ids to hide (already represented under the target quantity lot). */
  excludeIds?: string[];
}

/** Copies sellable into a unit lot (For sale, in collection, unsold, not already in the lot),
 * as enriched inventory rows for the composition picker. Filtered by the same area / year /
 * search controls as the inventory list. Disabled until the picker dialog opens. */
export function useSellableCopies(
  collectionId: string,
  lotId: string,
  filters: SellableCopiesFilters,
  enabled: boolean
) {
  return useQuery<ItemListItem[]>({
    queryKey: ["lots", collectionId, "sellable-copies", lotId, filters] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ lotId });
      if (filters.areaIds && filters.areaIds.length > 0) {
        params.set("areaIds", filters.areaIds.join(","));
      }
      if (filters.year) params.set("year", filters.year);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.stampId) params.set("stampId", filters.stampId);
      if (filters.conditionId) params.set("conditionId", filters.conditionId);
      if (filters.excludeIds && filters.excludeIds.length > 0) {
        params.set("excludeIds", filters.excludeIds.join(","));
      }
      const res = await fetch(
        `/api/collections/${collectionId}/lots/sellable-copies?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load sellable copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** Unit lots eligible to add as sub-lots of a quantity lot; disabled until the dialog opens. */
export function useEligibleSubLots(
  collectionId: string,
  lotId: string,
  enabled: boolean
) {
  return useQuery<LotSubLotSummary[]>({
    queryKey: ["lots", collectionId, "eligible-sub-lots", lotId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/lots/eligible-sub-lots?lotId=${lotId}`
      );
      if (!res.ok) throw new Error("Failed to load eligible sub-lots");
      return (await res.json()).items;
    },
    enabled,
  });
}

export function useInvalidateLots() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: lotKeys.all(collectionId) }),
  };
}
