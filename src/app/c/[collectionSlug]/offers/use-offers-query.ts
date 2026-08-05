"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OfferListItem,
  OfferCollision,
  OfferDetail,
  ComposeTargets,
  OfferFilterCounts,
  OffersSummary,
  ListingWorkspaceOffer,
  OfferLookupTarget,
  OfferListNeighbours,
} from "@/lib/offers";
import type { OfferListContext } from "./list-context";
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
  /** The state chips that are on, OR-matched — a multi-select since #475. */
  states?: OfferState[];
  /** The derived "needs action" overlay (ADR-0013 §4); mutually exclusive with `states`. */
  needsAction?: boolean;
  /** Only offers in active bidding (#215) — what the notification centre's "bidding started" group
   * (#481) links to. Composes with every other filter rather than replacing them. */
  bidding?: boolean;
  /** Only auctions that ended with a bid on them and are waiting to be resolved (#490) — what the
   * notification centre's ended-auction group links to. Composes with every other filter. */
  endedAuction?: boolean;
  /** Show closed (sold / withdrawn) offers; off by default hides dead listings (#245). */
  includeClosed?: boolean;
  /** Free text over the title, the offer number, the listing URL and the copies' catalog numbers
   * and filing refs (#465). Matched server-side — the list is cursor-paginated, so it cannot be a
   * client facet. */
  search?: string;
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
      if (filters.bidding) params.set("bidding", "1");
      if (filters.endedAuction) params.set("endedAuction", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      const res = await fetch(`/api/collections/${collectionId}/offers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch offers");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * Full offer (header + sets) for the offer detail / compose screen.
 *
 * Refetched when the tab comes back to the front, against the app's default: preparing a listing is
 * a walk in and out of other tabs — the Assistant's match window, the marketplace itself — and each
 * of those can change what this screen is showing. The Assistant rings a doorbell of its own when it
 * writes a match, but only for a browser carrying the extension and only for what it did; coming
 * back to the tab is the gesture that covers the rest.
 */
export function useOfferDetail(collectionId: string, offerId: string) {
  return useQuery<OfferDetail>({
    queryKey: offerKeys.detail(collectionId, offerId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}`);
      if (!res.ok) throw new Error("Failed to fetch offer");
      return res.json();
    },
    refetchOnWindowFocus: true,
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

/**
 * Where this offer sits in the filtered list it was opened from, and what comes before and after it
 * (#429). Asked **once per offer** and then frozen: the whole use case is finishing an offer — which
 * usually moves it out of the filter that was showing it — and then stepping on, so an answer that
 * refreshed itself would take the walk away at exactly the moment it is needed. That is also why it
 * lives outside `offerKeys.all`: `invalidateAll` must not reach it.
 */
export function useOfferNeighbours(
  collectionId: string,
  offerId: string,
  context: OfferListContext | null
) {
  return useQuery<OfferListNeighbours>({
    queryKey: ["offer-neighbours", collectionId, offerId, context] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ offerId });
      if (context?.platformId) params.set("platformId", context.platformId);
      if (context?.bidding) params.set("bidding", "1");
      if (context?.endedAuction) params.set("endedAuction", "1");
      if (context?.needsAction) params.set("needsAction", "1");
      else if (context?.states?.length) params.set("state", context.states.join(","));
      else if (context?.includeClosed) params.set("includeClosed", "1");
      if (context?.search) params.set("search", context.search);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/neighbours?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to locate the offer in the list");
      return res.json();
    },
    enabled: !!context,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
      if (filters.bidding) params.set("bidding", "1");
      if (filters.endedAuction) params.set("endedAuction", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/counts?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch offer counts");
      return res.json();
    },
  });
}

/** Aggregate figures for the offer list's summary bar (#317), over the same filtered set the list
 * shows. Lives under the offers key so `invalidateAll` refreshes the totals whenever an offer's
 * price, platform, or state changes. */
export function useOffersSummary(collectionId: string, filters: OfferFilters) {
  return useQuery<OffersSummary>({
    queryKey: ["offers", collectionId, "summary", filters] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.bidding) params.set("bidding", "1");
      if (filters.endedAuction) params.set("endedAuction", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/summary?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch the offer summary");
      return res.json();
    },
  });
}

/** Every `ready` offer on one platform, for the bulk listing workspace (#322). One request, no
 * pagination: the screen groups it by area/year and facets the rail client-side, so it needs the
 * whole batch in hand. Disabled until a platform is chosen — the workspace posts to one marketplace.
 * Lives under the offers key, so activating an offer refreshes the batch it just left. */
export function useListingOffers(collectionId: string, platformId: string | undefined) {
  return useQuery<ListingWorkspaceOffer[]>({
    queryKey: ["offers", collectionId, "listing", platformId] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ platformId: platformId! });
      const res = await fetch(
        `/api/collections/${collectionId}/offers/listing?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load the ready offers");
      return (await res.json()).items;
    },
    enabled: !!platformId,
    // A bulk regeneration (#323) queues runs for the whole batch, so the batch itself has to show
    // them finishing — the per-offer plan poll only covers the one card that happens to be open.
    refetchInterval: (query) =>
      query.state.data?.some((o) => o.photoStatus === "queued" || o.photoStatus === "running")
        ? 3000
        : false,
  });
}

/** Every offer referencing a copy of one target — a copy, a stamp, or an issue — across all
 * platforms and states (#276, #349): the "View offers" popup. Disabled until the popup opens. Lives
 * under the offers key, so listing a copy elsewhere or changing an offer's state refreshes it. */
export function useOffersForTarget(
  collectionId: string,
  target: OfferLookupTarget,
  enabled: boolean
) {
  const param: Record<string, string> =
    target.kind === "item"
      ? { itemId: target.itemId }
      : target.kind === "stamp"
        ? { stampId: target.stampId }
        : { issueId: target.issueId };
  return useQuery<OfferListItem[]>({
    queryKey: ["offers", collectionId, "for-target", param] as const,
    queryFn: async () => {
      const params = new URLSearchParams(param);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/for-target?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load the offers");
      return (await res.json()).items;
    },
    enabled,
  });
}

/** Platforms that currently have at least one offer, for the list filter dropdown — and, in the
 * listing workspace, for whether the Assistant has a module for the platform being posted to (#407). */
export function useOfferPlatforms(collectionId: string) {
  return useQuery<
    {
      id: string;
      name: string;
      platformCurrency: string | null;
      platformModule: string | null;
    }[]
  >({
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

/** Offers copies can be added to (#188): non-terminal offers with their sets + the copies each set
 * holds, and which of the copies being added each already holds (#372/#373). Disabled until the
 * picker opens. */
export function useComposeTargets(collectionId: string, itemIds: string[], enabled: boolean) {
  return useQuery<ComposeTargets>({
    queryKey: ["offers", collectionId, "compose-targets", [...itemIds].sort()] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of itemIds) params.append("itemId", id);
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
    /** Just this offer's own read model. For a change that answers a question the detail screen is
     *  asking but nothing else is — a photo run finishing under the ready gate (#311/#418) — where
     *  invalidating every offer list on the collection would be noise for one header. */
    invalidateDetail: (collectionId: string, offerId: string) =>
      queryClient.invalidateQueries({ queryKey: offerKeys.detail(collectionId, offerId) }),
  };
}
