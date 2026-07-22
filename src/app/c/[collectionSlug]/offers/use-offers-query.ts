"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfferListItem, OfferCollision, EligibleLot } from "@/lib/offers";
import type { OfferState } from "@/lib/offer-rules";

interface OffersPage {
  items: OfferListItem[];
  nextCursor: string | null;
}

export interface OfferFilters {
  platformId?: string;
  state?: OfferState;
}

export const offerKeys = {
  all: (collectionId: string) => ["offers", collectionId] as const,
  list: (collectionId: string, filters: OfferFilters) =>
    ["offers", collectionId, "list", filters] as const,
  lot: (collectionId: string, lotId: string) =>
    ["offers", collectionId, "lot", lotId] as const,
};

export function useOffersInfinite(collectionId: string, filters: OfferFilters) {
  return useInfiniteQuery<OffersPage>({
    queryKey: offerKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.state) params.set("state", filters.state);
      const res = await fetch(`/api/collections/${collectionId}/offers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch offers");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** All offers on a single lot (the lot detail panel's Offers section). */
export function useLotOffers(collectionId: string, lotId: string) {
  return useQuery<OfferListItem[]>({
    queryKey: offerKeys.lot(collectionId, lotId),
    queryFn: async () => {
      const params = new URLSearchParams({ lotId });
      const res = await fetch(`/api/collections/${collectionId}/offers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch offers");
      return (await res.json()).items;
    },
  });
}

/** Platforms that currently have at least one offer, for the list filter dropdown. */
export function useOfferPlatforms(collectionId: string) {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["offers", collectionId, "platforms"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/platforms`);
      if (!res.ok) throw new Error("Failed to fetch platforms");
      return (await res.json()).items;
    },
  });
}

/** Live, debounced collision lookup for the offer dialog. Disabled until a lot + platform are
 * both chosen. `excludeOfferId` skips the offer being edited. */
export function useOfferCollisions(
  collectionId: string,
  lotId: string | null,
  platformId: string | null,
  excludeOfferId: string | undefined,
  enabled: boolean
) {
  return useQuery<OfferCollision[]>({
    queryKey: ["offers", collectionId, "collision", lotId, platformId, excludeOfferId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ lotId: lotId!, platformId: platformId! });
      if (excludeOfferId) params.set("excludeOfferId", excludeOfferId);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/collision?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to check collisions");
      return (await res.json()).collisions;
    },
    enabled: enabled && !!lotId && !!platformId,
  });
}

/** Eligible-lot search for the Offers-screen create picker. Disabled until the dialog opens. */
export function useEligibleLots(collectionId: string, query: string, enabled: boolean) {
  return useQuery<EligibleLot[]>({
    queryKey: ["offers", collectionId, "eligible-lots", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(
        `/api/collections/${collectionId}/offers/eligible-lots?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load eligible lots");
      return (await res.json()).items;
    },
    enabled,
  });
}

export function useInvalidateOffers() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: offerKeys.all(collectionId) }),
  };
}
