"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaleListItem, SellableOffer } from "@/lib/sales";
import type { ItemListItem } from "@/lib/items";

interface SalesPage {
  items: SaleListItem[];
  nextCursor: string | null;
}

export interface SaleFilters {
  platformId?: string;
}

export const saleKeys = {
  all: (collectionId: string) => ["sales", collectionId] as const,
  list: (collectionId: string, filters: SaleFilters) =>
    ["sales", collectionId, "list", filters] as const,
};

export function useSalesInfinite(collectionId: string, filters: SaleFilters) {
  return useInfiniteQuery<SalesPage>({
    queryKey: saleKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.platformId) params.set("platformId", filters.platformId);
      const res = await fetch(`/api/collections/${collectionId}/sales?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sales");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Platforms that currently have at least one sale, for the list filter dropdown. */
export function useSalePlatforms(collectionId: string) {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["sales", collectionId, "platforms"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/sales/platforms`);
      if (!res.ok) throw new Error("Failed to fetch platforms");
      return (await res.json()).items;
    },
  });
}

/** Offers that can be sold, with their available units. Disabled until the dialog opens; a
 * `platformId` narrows to one platform (a sale is single-platform). */
export function useSellableOffers(
  collectionId: string,
  platformId: string | undefined,
  enabled: boolean
) {
  return useQuery<SellableOffer[]>({
    queryKey: ["sales", collectionId, "sellable-offers", platformId ?? ""] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (platformId) params.set("platformId", platformId);
      const res = await fetch(
        `/api/collections/${collectionId}/sales/sellable-offers?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load sellable offers");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** The copies that left on one sale line (packing view). Lazily fetched when its sold-unit card
 * is expanded; cached by React Query so re-expanding is instant. */
export function useSaleLineCopies(collectionId: string, lineId: string, enabled: boolean) {
  return useQuery<ItemListItem[]>({
    queryKey: ["sales", collectionId, "line-copies", lineId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/sales/lines/${lineId}/copies`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** Every copy across a whole sale (the packing view's flat / by-issue stream, "group by lot"
 * off). Lazily fetched only when the flat view is shown. */
export function useSaleCopies(collectionId: string, saleId: string, enabled: boolean) {
  return useQuery<ItemListItem[]>({
    queryKey: ["sales", collectionId, "sale-copies", saleId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/sales/${saleId}/copies`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

export function useInvalidateSales() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: (collectionId: string) => {
      // Sales retire copies and flip offers → sold, so refresh the sibling views too.
      queryClient.invalidateQueries({ queryKey: saleKeys.all(collectionId) });
      queryClient.invalidateQueries({ queryKey: ["offers", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["lots", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", collectionId] });
    },
  };
}
