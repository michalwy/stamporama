"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemListItem, ItemSortBy } from "@/lib/items";
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

/** Contact suggestions for the acquisition-source autocomplete (#108). Backed by the
 * #107 search API; an empty query returns the first contacts by name. */
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
