"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfferListItem, OfferCollision, OfferDetail } from "@/lib/offers";
import type { ItemListItem } from "@/lib/items";
// (offer copies for the rich sets view)
import type { OfferState } from "@/lib/offer-rules";

interface OffersPage {
  items: OfferListItem[];
  nextCursor: string | null;
}

export interface OfferFilters {
  platformId?: string;
  state?: OfferState;
  /** The derived "needs action" overlay (ADR-0013 §4); mutually exclusive with `state`. */
  needsAction?: boolean;
}

export const offerKeys = {
  all: (collectionId: string) => ["offers", collectionId] as const,
  list: (collectionId: string, filters: OfferFilters) =>
    ["offers", collectionId, "list", filters] as const,
  detail: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "detail", offerId] as const,
};

export function useOffersInfinite(collectionId: string, filters: OfferFilters) {
  return useInfiniteQuery<OffersPage>({
    queryKey: offerKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.state) params.set("state", filters.state);
      const res = await fetch(`/api/collections/${collectionId}/offers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch offers");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Full offer (header + sets) for the offer detail / compose screen. */
export function useOfferDetail(collectionId: string, offerId: string) {
  return useQuery<OfferDetail>({
    queryKey: offerKeys.detail(collectionId, offerId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}`);
      if (!res.ok) throw new Error("Failed to fetch offer");
      return res.json();
    },
  });
}

/** Platforms that currently have at least one offer, for the list filter dropdown. */
export function useOfferPlatforms(collectionId: string) {
  return useQuery<{ id: string; name: string; platformCurrency: string | null }[]>({
    queryKey: ["offers", collectionId, "platforms"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/platforms`);
      if (!res.ok) throw new Error("Failed to fetch platforms");
      return (await res.json()).items;
    },
  });
}

/** Live collision lookup for the compose picker: other active offers on the chosen platform that
 * already list one of these copies. Disabled until a platform + copies are both chosen. */
export function useOfferCollisions(
  collectionId: string,
  itemIds: string[],
  platformId: string | null,
  excludeOfferId: string | undefined,
  enabled: boolean
) {
  return useQuery<OfferCollision[]>({
    queryKey: ["offers", collectionId, "collision", [...itemIds].sort(), platformId, excludeOfferId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ platformId: platformId! });
      for (const id of itemIds) params.append("itemId", id);
      if (excludeOfferId) params.set("excludeOfferId", excludeOfferId);
      const res = await fetch(`/api/collections/${collectionId}/offers/collision?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to check collisions");
      return (await res.json()).collisions;
    },
    enabled: enabled && !!platformId && itemIds.length > 0,
  });
}

/** Every enriched copy across an offer's sets (the rich sets view). */
export function useOfferCopies(collectionId: string, offerId: string, enabled: boolean) {
  return useQuery<ItemListItem[]>({
    queryKey: ["offers", collectionId, "copies", offerId] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/copies`);
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** Copies eligible to add to an offer's set (composition picker), area-scoped server-side. Year +
 * search are filtered client-side for instant facets (mirrors the Copies / lot pickers). */
export function useComposableCopies(
  collectionId: string,
  offerId: string,
  areaIds: string[] | null,
  enabled: boolean
) {
  return useQuery<ItemListItem[]>({
    queryKey: ["offers", collectionId, "composable", offerId, areaIds] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of areaIds ?? []) params.append("areaId", id);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/${offerId}/composable-copies?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load copies");
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
