"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TradeListItem, TradeSortBy } from "@/lib/trades";
import type { TradeStatus } from "@/lib/trade-rules";
import type { ContactData } from "@/lib/contacts";

interface TradesPage {
  items: TradeListItem[];
  nextCursor: string | null;
}

export interface TradeFilters {
  status?: TradeStatus;
  /** One box, two meanings: `#7` is the trade number the quick jump sends, anything else is the
   * partner's name. Which one it is, is decided server-side so the two cannot drift apart. */
  search?: string;
  sortBy?: TradeSortBy;
  sortDir?: "asc" | "desc";
}

export const tradeKeys = {
  all: (collectionId: string) => ["trades", collectionId] as const,
  list: (collectionId: string, filters: TradeFilters) =>
    ["trades", collectionId, "list", filters] as const,
};

export function useTradesInfinite(collectionId: string, filters: TradeFilters) {
  return useInfiniteQuery<TradesPage>({
    queryKey: tradeKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortDir) params.set("sortDir", filters.sortDir);
      const res = await fetch(
        `/api/collections/${collectionId}/trades?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch trades");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Exchange-partner suggestions for the trade dialog's partner field, through the same #107 search
 * API every other contact picker uses — narrowed to the `exchangePartner` role so the address book's
 * marketplaces and auction houses stay out of it. Disabled until something is typed. */
export function useExchangePartnerSearch(collectionId: string, query: string) {
  return useQuery<ContactData[]>({
    queryKey: ["trades", collectionId, "partnerSearch", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, role: "exchangePartner" });
      const res = await fetch(
        `/api/collections/${collectionId}/contacts/search?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to search partners");
      const data = await res.json();
      return data.items;
    },
    enabled: query.length >= 1,
  });
}

export function useInvalidateTrades() {
  const queryClient = useQueryClient();
  return {
    invalidateList: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: tradeKeys.all(collectionId) }),
    invalidatePartners: (collectionId: string) =>
      queryClient.invalidateQueries({
        queryKey: ["trades", collectionId, "partnerSearch"],
      }),
  };
}
