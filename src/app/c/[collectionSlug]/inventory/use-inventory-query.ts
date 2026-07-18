"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ItemListItem,
  ItemSortBy,
  ItemVariantHistoryData,
} from "@/lib/items";
import type { HoldingsTotal } from "@/lib/valuation";
import type { ContactData } from "@/lib/contacts";
import type { StampNodeData } from "@/lib/issues";

interface InventoryItemsPage {
  items: ItemListItem[];
  nextCursor: string | null;
}

export interface InventoryItemFilters {
  conditionId?: string;
  certificateStatusId?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
}

export const inventoryKeys = {
  all: (collectionId: string) => ["inventory", collectionId] as const,
  list: (collectionId: string, filters: InventoryItemFilters) =>
    ["inventory", collectionId, "list", filters] as const,
};

export function useInventoryItemsInfinite(
  collectionId: string,
  filters: InventoryItemFilters
) {
  return useInfiniteQuery<InventoryItemsPage>({
    queryKey: inventoryKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.conditionId) params.set("conditionId", filters.conditionId);
      if (filters.certificateStatusId)
        params.set("certificateStatusId", filters.certificateStatusId);
      if (filters.inCollection) params.set("inCollection", "true");
      if (filters.forSale) params.set("forSale", "true");
      if (filters.forTrade) params.set("forTrade", "true");
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/items?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch inventory items");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Holdings valuation total over the whole filtered copy set (ADR-0007 §7, #101).
 * Shares the list's disposition/condition/certificate filters (not sort/pagination)
 * so the figure tracks what the list is showing. */
export function useHoldingsValuation(
  collectionId: string,
  filters: InventoryItemFilters
) {
  return useQuery<HoldingsTotal>({
    queryKey: ["inventory", collectionId, "valuation", {
      conditionId: filters.conditionId,
      certificateStatusId: filters.certificateStatusId,
      inCollection: filters.inCollection,
      forSale: filters.forSale,
      forTrade: filters.forTrade,
    }] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.conditionId) params.set("conditionId", filters.conditionId);
      if (filters.certificateStatusId)
        params.set("certificateStatusId", filters.certificateStatusId);
      if (filters.inCollection) params.set("inCollection", "true");
      if (filters.forSale) params.set("forSale", "true");
      if (filters.forTrade) params.set("forTrade", "true");
      const res = await fetch(
        `/api/collections/${collectionId}/items/valuation-summary?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch holdings valuation");
      return res.json();
    },
  });
}

/** Stamp nodes (base + variants) that belong to an issue, for the stamp picker. */
export function useIssueMembers(collectionId: string, issueId: string) {
  return useQuery<StampNodeData[]>({
    queryKey: ["inventory", collectionId, "issueMembers", issueId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/issues/${issueId}/members`
      );
      if (!res.ok) throw new Error("Failed to fetch issue members");
      const data = await res.json();
      return data.members;
    },
    enabled: !!issueId,
  });
}

/** Refinement history for a copy (#100). Fetched lazily when a history view is opened. */
export function useItemVariantHistory(
  collectionId: string,
  itemId: string | null,
  enabled: boolean
) {
  return useQuery<ItemVariantHistoryData[]>({
    queryKey: ["inventory", collectionId, "variantHistory", itemId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/items/${itemId}/variant-history`
      );
      if (!res.ok) throw new Error("Failed to fetch variant history");
      const data = await res.json();
      return data.history;
    },
    enabled: enabled && !!itemId,
  });
}

/** Contact suggestions for the acquisition-source autocomplete (#108). Backed by the
 * #107 search API; disabled until the user types (the dropdown only opens then). */
export function useContactSearch(collectionId: string, query: string) {
  return useQuery<ContactData[]>({
    queryKey: ["inventory", collectionId, "contactSearch", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      const res = await fetch(
        `/api/collections/${collectionId}/contacts/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search contacts");
      const data = await res.json();
      return data.items;
    },
    // The dropdown only opens once the user types; skip the redundant empty-query
    // fetch on mount (matches useIssueSearch).
    enabled: query.length >= 1,
  });
}

export function useInvalidateContacts() {
  const queryClient = useQueryClient();
  return {
    invalidateContacts: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: ["inventory", collectionId, "contactSearch"],
      }),
  };
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: inventoryKeys.all(collectionId),
      }),
  };
}
