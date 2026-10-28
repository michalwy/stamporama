"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SaleListItem,
  SellableOffer,
  SaleCopyItem,
  SaleLineSetChoice,
} from "@/lib/sales";
import type { ItemListItem } from "@/lib/items";
import type { SaleStatus } from "@/lib/sale-status";
import type { SaleSearchField } from "@/lib/sale-search-fields";
import { SEARCH_FIELDS_PARAM } from "@/lib/search-fields";
import {
  keepRowsAcrossTreeChange,
  type AreaSelection,
} from "@/app/c/[collectionSlug]/shared/area-scope-placeholder";

interface SalesPage {
  items: SaleListItem[];
  nextCursor: string | null;
}

export interface SaleFilters {
  platformId?: string;
  /** One buyer (#1708), from a contact page's sales figures. */
  buyerId?: string;
  /** Fulfillment statuses (#191) the list is narrowed to (#392), OR-matched — empty (or absent)
   * for all of them. Still a **list** although the chips became mutually exclusive (#972, reversing
   * #475), for the offers list's reason (#735): a link or a remembered value written while they
   * were multi-select has to go on meaning what it said, and one axis keeps one filter on it. */
  statuses?: SaleStatus[];
  /** Free-text search over buyer, platform, external ref, and sold item name / catalog number (#193). */
  search?: string;
  /** The fields `search` matches (#2243), sent only when it narrows — absent is every field. */
  searchFields?: SaleSearchField[];
  /** Only sales holding a line whose set nobody has chosen yet (#697). */
  setChoicePending?: boolean;
  /** Only sales carrying the *to review* marker (#1948). */
  toReview?: boolean;
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
      if (filters.buyerId) params.set("buyerId", filters.buyerId);
      if (filters.statuses?.length) params.set("status", filters.statuses.join(","));
      if (filters.search) params.set("search", filters.search);
      if (filters.searchFields) params.set(SEARCH_FIELDS_PARAM, filters.searchFields.join(","));
      if (filters.setChoicePending) params.set("setChoice", "1");
      if (filters.toReview) params.set("toReview", "1");
      const res = await fetch(`/api/collections/${collectionId}/sales?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sales");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Platforms that currently have at least one sale, for the list filter dropdown — and, through it,
 * for seeding the Record a Sale dialog when the list is filtered to one (#464). */
export function useSalePlatforms(collectionId: string) {
  return useQuery<{ id: string; name: string; platformCurrency: string | null }[]>({
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

/** Enriched copies across the platform's sellable offers, for the add-sold-sets picker's set
 * details. Loaded once when the dialog opens; grouped by set client-side. */
export function useSellableCopies(collectionId: string, platformId: string | undefined, enabled: boolean) {
  return useQuery<ItemListItem[]>({
    queryKey: ["sales", collectionId, "sellable-copies", platformId ?? ""] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (platformId) params.set("platformId", platformId);
      const res = await fetch(`/api/collections/${collectionId}/sales/sellable-copies?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** The copies in stock a set on no offer can be picked from (#2021), scoped by area on the server.
 * Under the `sales` key, so a sale that takes some of them refreshes the picker too. */
export function useStockCopiesForSale(
  collectionId: string,
  areaIds: string[] | null,
  /** What `areaIds` was resolved from, so an area added under it keeps the rows drawn (#977). */
  areaSelection: AreaSelection
) {
  const key = (ids: string[] | null) => ["sales", collectionId, "stock-copies", ids ?? []] as const;
  return useQuery<ItemListItem[]>({
    queryKey: key(areaIds),
    ...keepRowsAcrossTreeChange<ItemListItem[]>(areaSelection, key(null)),
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of areaIds ?? []) params.append("areaId", id);
      const res = await fetch(`/api/collections/${collectionId}/sales/stock-copies?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
  });
}

/** The copies that left on one sale line (packing view). Lazily fetched when its sold-unit card
 * is expanded; cached by React Query so re-expanding is instant. */
export function useSaleLineCopies(collectionId: string, lineId: string, enabled: boolean) {
  return useQuery<SaleCopyItem[]>({
    queryKey: ["sales", collectionId, "line-copies", lineId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/sales/lines/${lineId}/copies`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** The sets one sale line could have gone out as (#697) — its own offer's still-available sets, and
 * the one it names today. Fetched only while the *Choose set* picker is open. */
export function useSaleLineSetOptions(collectionId: string, lineId: string | null) {
  return useQuery<SaleLineSetChoice>({
    queryKey: ["sales", collectionId, "line-set-options", lineId ?? ""] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/sales/lines/${lineId}/set-options`
      );
      if (!res.ok) throw new Error("Failed to load the sets for this line");
      return res.json();
    },
    enabled: !!lineId,
  });
}

/** Every copy across a whole sale (the packing view's flat / by-issue stream, "group by lot"
 * off). Lazily fetched only when the flat view is shown. */
export function useSaleCopies(collectionId: string, saleId: string, enabled: boolean) {
  return useQuery<SaleCopyItem[]>({
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
      // A changed buyer or a merge moves conversation entries off a sale (#2149).
      queryClient.invalidateQueries({ queryKey: ["conversation", collectionId] });
    },
  };
}
