"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OfferListItem,
  OfferCollision,
  OfferDetail,
  ComposeTargets,
  OfferFilterCounts,
} from "@/lib/offers";
import type { ItemListItem } from "@/lib/items";
import type { OfferPhotoPlanState } from "@/lib/offer-photo-generation";
import type { TitleFallback } from "@/lib/offer-title-template";
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
  /** Show closed (sold / withdrawn) offers; off by default hides dead listings (#245). */
  includeClosed?: boolean;
}

export const offerKeys = {
  all: (collectionId: string) => ["offers", collectionId] as const,
  list: (collectionId: string, filters: OfferFilters) =>
    ["offers", collectionId, "list", filters] as const,
  detail: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "detail", offerId] as const,
  photoPlan: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "photo-plan", offerId] as const,
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
      else if (filters.includeClosed) params.set("includeClosed", "1");
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

/** The offer's photo plan (#311) as the Photos card reads it. Timestamps arrive as JSON strings; the
 * card shows state and counts, so they are typed away rather than revived. */
export type OfferPhotoPlanView = Omit<OfferPhotoPlanState, "startedAt" | "finishedAt">;

/** Generation state + stored images for an offer's photos (#311). Polls while a run is queued or in
 * flight — rendering happens in a background worker, so the card has no completion event to await. */
export function useOfferPhotoPlan(collectionId: string, offerId: string) {
  return useQuery<OfferPhotoPlanView>({
    queryKey: offerKeys.photoPlan(collectionId, offerId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/photos`);
      if (!res.ok) throw new Error("Failed to load the photo plan");
      return res.json();
    },
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running" ? 2000 : false,
  });
}

/** Faceted counts for the toolbar's filter controls (#332). Lives under the offers key so
 * `invalidateAll` refreshes the badges whenever an offer changes state, platform, or is deleted. */
export function useOfferFilterCounts(collectionId: string, filters: OfferFilters) {
  return useQuery<OfferFilterCounts>({
    queryKey: ["offers", collectionId, "counts", filters] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.state) params.set("state", filters.state);
      else if (filters.includeClosed) params.set("includeClosed", "1");
      const res = await fetch(
        `/api/collections/${collectionId}/offers/counts?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch offer counts");
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

/** Offers a copy can be added to (#188): non-terminal offers with their sets + the copies each set
 * holds, and flags for sets/offers already holding this copy. Disabled until the picker opens. */
export function useComposeTargets(collectionId: string, itemId: string, enabled: boolean) {
  return useQuery<ComposeTargets>({
    queryKey: ["offers", collectionId, "compose-targets", itemId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ itemId });
      const res = await fetch(
        `/api/collections/${collectionId}/offers/compose-targets?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load offers");
      return res.json();
    },
    enabled,
  });
}

/** The entity translations missing behind an offer's generated texts, in the platform's listing
 * language (#299) — the offer screen's "fill it here" panel. Read through the server action rather
 * than a route handler: it is a small, screen-specific read, and it lives under the offers key so
 * `invalidateAll` refreshes it whenever the composition or a translation changes. */
export function useOfferTranslationGaps(collectionId: string, offerId: string, enabled: boolean) {
  return useQuery<{ language: string | null; gaps: TitleFallback[] }>({
    queryKey: ["offers", collectionId, "translation-gaps", offerId] as const,
    queryFn: async () => {
      const { offerTranslationGapsAction } = await import("@/app/actions/offers");
      return offerTranslationGapsAction(offerId);
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
