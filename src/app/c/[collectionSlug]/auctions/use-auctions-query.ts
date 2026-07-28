"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuctionLotFilterCounts,
  AuctionLotListItem,
  AuctionSellerDefaults as AuctionSellerDefaultsData,
  AuctionSaleDetail,
  AuctionSaleListItem,
  AuctionSaleProposal,
  AuctionClosingWindow,
} from "@/lib/auctions";
import type { AuctionLotStatus, AuctionSaleStatus } from "@/lib/auction-rules";
import type { LotSignal } from "@/lib/auction-lot";

// Client queries for auction tracking (#351/#352). Everything lives under one `["auctions", id]`
// key so a single `invalidateAll` refreshes the lot list, its facet badges, the sale list and any
// open sale detail together — a bid recorded on the flat list changes the parcel total two screens
// away.

/** Dates cross the route handler as JSON strings. Kept as strings rather than revived: the screens
 * format them for display and compare them against `Date.now()` at the point of use. */
type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export type AuctionLotView = Serialized<AuctionLotListItem>;
export type AuctionSaleView = Serialized<AuctionSaleListItem>;
export type AuctionSaleDetailView = Serialized<Omit<AuctionSaleDetail, "lots">> & {
  lots: AuctionLotView[];
};
export type AuctionSaleProposalView = Serialized<AuctionSaleProposal>;
export type { AuctionClosingWindow, LotSignal };

/** The seller's stored auction defaults, as the add-lot dialog seeds a new sale from them — plus
 * the platform they were last tracked on, which pre-fills the pair. */
export type AuctionSellerDefaults = AuctionSellerDefaultsData;

export interface AuctionLotFilters {
  status?: AuctionLotStatus;
  /** Closing-time window: already ended, or closing inside a day / a week. */
  closing?: AuctionClosingWindow;
  /** A derived state: still biddable, outbid, over ceiling… */
  signal?: LotSignal;
  sellerId?: string;
  platformId?: string;
}

interface AuctionLotsPage {
  items: AuctionLotView[];
  nextCursor: string | null;
}

export const auctionKeys = {
  all: (collectionId: string) => ["auctions", collectionId] as const,
  lots: (collectionId: string, filters: AuctionLotFilters) =>
    ["auctions", collectionId, "lots", filters] as const,
  sale: (collectionId: string, saleId: string) =>
    ["auctions", collectionId, "sale", saleId] as const,
};

function lotParams(filters: AuctionLotFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.closing) params.set("closing", filters.closing);
  if (filters.signal) params.set("signal", filters.signal);
  if (filters.sellerId) params.set("sellerId", filters.sellerId);
  if (filters.platformId) params.set("platformId", filters.platformId);
  return params;
}

/** The flat list of lots across all sales — the primary auction screen. */
export function useAuctionLotsInfinite(collectionId: string, filters: AuctionLotFilters) {
  return useInfiniteQuery<AuctionLotsPage>({
    queryKey: auctionKeys.lots(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = lotParams(filters);
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(`/api/collections/${collectionId}/auctions/lots?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch auction lots");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Faceted counts for the toolbar's chips and selects (#332). */
export function useAuctionLotCounts(collectionId: string, filters: AuctionLotFilters) {
  return useQuery<AuctionLotFilterCounts>({
    queryKey: ["auctions", collectionId, "lot-counts", filters] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/auctions/lots/counts?${lotParams(filters).toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch auction lot counts");
      return res.json();
    },
  });
}

/** Sellers and platforms that carry at least one sale, for the two filter selects. */
export function useAuctionParties(collectionId: string) {
  return useQuery<{ sellers: { id: string; name: string }[]; platforms: { id: string; name: string }[] }>({
    queryKey: ["auctions", collectionId, "parties"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/auctions/parties`);
      if (!res.ok) throw new Error("Failed to fetch auction parties");
      return res.json();
    },
  });
}

/** Every sale with its parcel totals — the settlement list. Unpaginated (see `listAuctionSales`). */
export function useAuctionSales(collectionId: string, status?: AuctionSaleStatus) {
  return useQuery<AuctionSaleView[]>({
    queryKey: ["auctions", collectionId, "sales", status ?? "all"] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(
        `/api/collections/${collectionId}/auctions/sales?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch auction sales");
      return (await res.json()).items;
    },
  });
}

/** One sale with its own fields and its lots. */
export function useAuctionSaleDetail(collectionId: string, saleId: string) {
  return useQuery<AuctionSaleDetailView>({
    queryKey: auctionKeys.sale(collectionId, saleId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/auctions/sales/${saleId}`);
      if (!res.ok) throw new Error("Failed to fetch the auction sale");
      return res.json();
    },
  });
}

/**
 * The seller's defaults — including the platform they were last tracked on — and, once a platform
 * is known too, the open sale proposed for that pair (#352).
 *
 * Keyed on the **seller alone** for the defaults half: the platform pre-fill has to arrive before a
 * platform has been picked, so requiring one would deadlock the very thing it feeds. A seller name
 * typed but never matched to a contact still has no id, and nothing can be looked up for it.
 */
export function useOpenAuctionSale(
  collectionId: string,
  sellerId: string,
  platformId: string,
  enabled: boolean
) {
  return useQuery<{ proposal: AuctionSaleProposalView | null; sellerDefaults: AuctionSellerDefaults | null }>({
    queryKey: ["auctions", collectionId, "open-sale", sellerId, platformId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ sellerId });
      if (platformId) params.set("platformId", platformId);
      const res = await fetch(
        `/api/collections/${collectionId}/auctions/sales/open?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to look up the open sale");
      return res.json();
    },
    enabled: enabled && !!sellerId,
  });
}

export function useInvalidateAuctions() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: auctionKeys.all(collectionId) }),
  };
}
