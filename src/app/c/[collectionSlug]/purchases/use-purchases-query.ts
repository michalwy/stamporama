"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PurchaseListItem,
  PurchaseSortBy,
  PurchaseStatus,
} from "@/lib/purchases";
import type { ContactData } from "@/lib/contacts";

interface PurchasesPage {
  items: PurchaseListItem[];
  nextCursor: string | null;
}

export interface PurchaseFilters {
  status?: PurchaseStatus;
  sortBy?: PurchaseSortBy;
  sortDir?: "asc" | "desc";
}

export const purchaseKeys = {
  all: (collectionId: string) => ["purchases", collectionId] as const,
  list: (collectionId: string, filters: PurchaseFilters) =>
    ["purchases", collectionId, "list", filters] as const,
};

export function usePurchasesInfinite(
  collectionId: string,
  filters: PurchaseFilters
) {
  return useInfiniteQuery<PurchasesPage>({
    queryKey: purchaseKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.status) params.set("status", filters.status);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch purchases");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Contact suggestions for the supplier / platform pickers. Backed by the #107 search
 * API; disabled until the user types (the dropdown only opens then), mirroring the
 * inventory acquisition-source autocomplete. Pass `role` to narrow the list: `"seller"`
 * for the supplier field, `"platform"` for platforms (Allegro, eBay…), `"buyer"` for the
 * sale buyer (#166). */
export function usePurchaseContactSearch(
  collectionId: string,
  query: string,
  role?: "platform" | "seller" | "buyer"
) {
  return useQuery<ContactData[]>({
    queryKey: ["purchases", collectionId, "contactSearch", role ?? "any", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      if (role) params.set("role", role);
      const res = await fetch(
        `/api/collections/${collectionId}/contacts/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search contacts");
      const data = await res.json();
      return data.items;
    },
    enabled: query.length >= 1,
  });
}

export function useInvalidatePurchases() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: purchaseKeys.all(collectionId),
      }),
    invalidateContacts: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: ["purchases", collectionId, "contactSearch"],
      }),
  };
}
