"use client";

import { useEffect } from "react";
import {
  focusManager,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  keepRowsAcrossTreeChange,
  type AreaSelection,
} from "@/app/c/[collectionSlug]/shared/area-scope-placeholder";
import type {
  OfferListItem,
  OfferCollision,
  StampConditionCollision,
  OfferListingDuplicate,
  OfferDetail,
  ComposeTargets,
  OfferFilterCounts,
  OffersSummary,
  ListingWorkspaceOffer,
  PrepareOffer,
  OfferLookupTarget,
  OfferListNeighbours,
} from "@/lib/offers";
import { isPhotoRunBlocker } from "@/lib/offer-photo-readiness";
import type { OfferListContext } from "./list-context";
import type { FacebookPostListItem, FacebookPostLotUpdate, FacebookPostScreen } from "@/lib/facebook-posts";
import { lotPhotosDrawing, withFacebookPostLot, withLotPhotos, withPrepareRow } from "@/lib/facebook-post-lot-refresh";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import type { FacebookPostLotPhoto } from "@/lib/facebook-lot-photos";
import type { FacebookPostStage } from "@/lib/facebook-post-rules";
import type { ItemListItem } from "@/lib/items";
import type { OfferPhotoPlanState } from "@/lib/offer-photo-generation";
import type { TitleFallback } from "@/lib/offer-title-template";
// (offer copies for the rich sets view)
import type { OfferState } from "@/lib/offer-rules";
import type { LotPoolSummary, LotProposal } from "@/lib/lot-builder";
import { lotBuilderSearchParams, type LotBuilderRequest } from "@/lib/lot-builder-criteria";
import type { LotBuilderPresetData } from "@/lib/lot-builder-presets";
import type { SeriesRecombinationResult } from "@/lib/series-recombination";
import type { OfferGeneratorPreview } from "@/lib/offer-generator";

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
  /** Only offers whose listing has sold on a connected platform with no sale recorded here (#499) —
   * what the notification centre's "Sold on Allegro" group links to. */
  platformSale?: boolean;
  /** Only live listings changed since they went up (#542) — the ones that have to be re-posted. */
  listingOutOfDate?: boolean;
  /** Only active quick buys past their platform's refresh threshold (#1718). */
  needsRefresh?: boolean;
  /** Show closed (sold / withdrawn) offers; off by default hides dead listings (#245). */
  includeClosed?: boolean;
  /** Free text over the title, the offer number, the listing URL and the copies' catalog numbers
   * and filing refs (#465). Matched server-side — the list is cursor-paginated, so it cannot be a
   * client facet. */
  search?: string;
  /** Only the lots of one multi-lot Facebook post, by its number (#1842) — what a lot's *Post #N*
   * chip narrows the list to. */
  post?: number;
}

export const offerKeys = {
  all: (collectionId: string) => ["offers", collectionId] as const,
  list: (collectionId: string, filters: OfferFilters) =>
    ["offers", collectionId, "list", filters] as const,
  detail: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "detail", offerId] as const,
  photoPlan: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "photo-plan", offerId] as const,
  coverWalk: (collectionId: string, offerId: string) =>
    ["offers", collectionId, "cover-walk", offerId] as const,
  /** A multi-lot Facebook post's screen (#1842) — under the offers key, so a write to any lot
   *  refreshes it. */
  facebookPost: (collectionId: string, postId: string) =>
    ["offers", collectionId, "facebook-post", postId] as const,
  /** A captioned post's stored lot photos (#1861) — under the offers key, so regenerating a lot's
   *  images refreshes them. */
  facebookLotPhotos: (collectionId: string, postId: string) =>
    ["offers", collectionId, "facebook-lot-photos", postId] as const,
  /** The offers that could join a post as further lots (#1870) — under the offers key, so a write to
   *  any offer refreshes it. */
  facebookLotCandidates: (collectionId: string, postId: string) =>
    ["offers", collectionId, "facebook-lot-candidates", postId] as const,
  /** A post's lots as Prepare rows (#2031), while the post is not up — under the offers key, so every
   *  write to a lot refreshes its row. */
  facebookPostPrepare: (collectionId: string, postId: string) =>
    ["offers", collectionId, "facebook-post-prepare", postId] as const,
  /** The Prepare screen's pages (#1894) — under the offers key, so every write to an offer refreshes
   *  the row it is on. */
  prepare: (collectionId: string, filters: PrepareFilters) =>
    ["offers", collectionId, "prepare", filters] as const,
  /** The list of Facebook posts (#1850) — under the offers key for the same reason. */
  facebookPosts: (collectionId: string, filters: FacebookPostFilters) =>
    ["offers", collectionId, "facebook-posts", filters] as const,
};

export interface FacebookPostFilters {
  /** Any of these groups; empty is every group. */
  groupIds: readonly string[];
  stage?: FacebookPostStage;
  /** Only the posts with no title (#1862). */
  untitled?: boolean;
  /** Only the posts not yet up, which still take lots (#1870). */
  notUp?: boolean;
}

export function useOffersInfinite(collectionId: string, filters: OfferFilters) {
  return useInfiniteQuery<OffersPage>({
    queryKey: offerKeys.list(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.bidding) params.set("bidding", "1");
      if (filters.endedAuction) params.set("endedAuction", "1");
      if (filters.listingOutOfDate) params.set("listingOutOfDate", "1");
      if (filters.needsRefresh) params.set("needsRefresh", "1");
      if (filters.platformSale) params.set("platformSale", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      if (filters.post) params.set("post", String(filters.post));
      const res = await fetch(`/api/collections/${collectionId}/offers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch offers");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // An offer waiting for its photos turns Ready in the background (#1893); the list is asked again
    // while one it shows is waiting, so the row moves on without a reload.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((o) => o.readyAfterPhotos))
        ? READY_WAIT_POLL_MS
        : false,
  });
}

/** How often a screen showing an offer that waits for its photos to turn Ready asks again (#1893). */
const READY_WAIT_POLL_MS = 3_000;

/** How often a captioned post's lots still being drawn are asked after (#1861). */
const LOT_PHOTO_POLL_MS = 2_000;

/** The Prepare screen's filters (#1894). `areaIds` is the area selection already expanded to its
 *  subtree (`resolveAreaFilterIds`). */
export interface PrepareFilters {
  platformId?: string;
  groupId?: string;
  areaIds?: string[];
  noPrice?: boolean;
}

/** The collection's Preparing offers for the Prepare screen (#1894), a page at a time. Asked again
 *  while a row it shows waits for its photos to turn it Ready (#1893), so the row leaves by itself. */
export function usePrepareOffersInfinite(collectionId: string, filters: PrepareFilters) {
  return useInfiniteQuery<{ items: PrepareOffer[]; nextCursor: string | null }>({
    queryKey: offerKeys.prepare(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.platformId) params.set("platformId", filters.platformId);
      if (filters.groupId) params.set("groupId", filters.groupId);
      if (filters.areaIds?.length) params.set("areaIds", filters.areaIds.join(","));
      if (filters.noPrice) params.set("noPrice", "1");
      const res = await fetch(`/api/collections/${collectionId}/offers/prepare?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch the offers being prepared");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((o) => o.readyAfterPhotos))
        ? READY_WAIT_POLL_MS
        : false,
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
    // Waiting for its photos, the offer turns Ready in the background (#1893). The photos card's own
    // poll invalidates this on the run's end, but the Ready step comes just after it — so the header
    // asks again until the wait is over.
    refetchInterval: (query) => (query.state.data?.readyAfterPhotos ? READY_WAIT_POLL_MS : false),
  });
}

/** A multi-lot Facebook post as its own screen reads it (#1842). */
export function useFacebookPostScreen(collectionId: string, postId: string) {
  return useQuery<FacebookPostScreen>({
    queryKey: offerKeys.facebookPost(collectionId, postId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/facebook-posts/${postId}`);
      if (!res.ok) throw new Error("Failed to fetch the post");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });
}

/** A post's lots as Prepare rows (#2031), keyed by the lot's offer id; null once the post is up. Polled
 *  while a lot waits for its photos before turning Ready (#1893), as the Prepare screen is. */
export function useFacebookPostLotsPrepare(collectionId: string, postId: string, enabled: boolean) {
  return useQuery<Record<string, PrepareOffer> | null>({
    queryKey: offerKeys.facebookPostPrepare(collectionId, postId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/facebook-posts/${postId}/prepare`);
      if (!res.ok) throw new Error("Failed to load the post's lots");
      return (await res.json()).lots;
    },
    enabled,
    // Also while a lot's photos are being made again (#2114): *Publish…* waits for them.
    refetchInterval: (query) =>
      Object.values(query.state.data ?? {}).some(
        (o) => o.readyAfterPhotos || o.readyBlockers.some(isPhotoRunBlocker)
      )
        ? READY_WAIT_POLL_MS
        : false,
  });
}

/** Some of a post's lot photos read again (#2221), each written in place of the one the screen holds.
 *  Not asked while the screen holds none: the next read of them is the whole post's anyway. */
async function settleLotPhotos(queryClient: QueryClient, collectionId: string, postId: string, offerIds: string[]) {
  const key = offerKeys.facebookLotPhotos(collectionId, postId);
  if (offerIds.length === 0 || !queryClient.getQueryData(key)) return;
  const res = await fetch(
    `/api/collections/${collectionId}/facebook-posts/${postId}/lot-photos?lots=${offerIds.join(",")}`
  );
  if (!res.ok) return;
  const fresh: FacebookPostLotPhoto[] = (await res.json()).lots;
  queryClient.setQueryData<FacebookPostLotPhoto[]>(key, (all) => all && withLotPhotos(all, fresh));
}

/** A captioned post's lot photos (#1861): each lot's stored photo, or where it stands — and, while any
 *  is still being generated, the lots being drawn asked after every two seconds, so each appears as
 *  soon as it is ready. Only those lots (#2221): a lot already drawn has nothing new to say, and asking
 *  after one costs a read of its upload plan. Asked only while `enabled`. */
export function useFacebookPostLotPhotos(collectionId: string, postId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery<FacebookPostLotPhoto[]>({
    queryKey: offerKeys.facebookLotPhotos(collectionId, postId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/facebook-posts/${postId}/lot-photos`);
      if (!res.ok) throw new Error("Failed to load the lots' photos");
      return (await res.json()).lots;
    },
    enabled: enabled && postId !== null,
  });
  const drawing = enabled && postId !== null ? lotPhotosDrawing(query.data).join(",") : "";
  // Each answer is new data, so the next ask is scheduled from it — until no lot is being drawn. Not in
  // a tab out of view, as `refetchInterval` would not: coming back reads them all again anyway.
  const { dataUpdatedAt } = query;
  useEffect(() => {
    if (!drawing || !postId) return;
    const timer = setTimeout(() => {
      if (focusManager.isFocused()) void settleLotPhotos(queryClient, collectionId, postId, drawing.split(","));
    }, LOT_PHOTO_POLL_MS);
    return () => clearTimeout(timer);
  }, [queryClient, collectionId, postId, drawing, dataUpdatedAt]);
  return query;
}

/** The offers that could join a post as further lots (#1870), what *Add lots…* picks from. */
export function useFacebookLotCandidates(collectionId: string, postId: string) {
  return useQuery<FacebookKitLot[]>({
    queryKey: offerKeys.facebookLotCandidates(collectionId, postId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/facebook-posts/${postId}/candidates`);
      if (!res.ok) throw new Error("Failed to load the offers");
      return (await res.json()).offers;
    },
  });
}

/** Every Facebook post, newest first and a page at a time (#1850). */
export function useFacebookPostsInfinite(collectionId: string, filters: FacebookPostFilters) {
  return useInfiniteQuery<{ items: FacebookPostListItem[]; nextCursor: string | null }>({
    queryKey: offerKeys.facebookPosts(collectionId, filters),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (filters.groupIds.length) params.set("group", filters.groupIds.join(","));
      if (filters.stage) params.set("stage", filters.stage);
      if (filters.untitled) params.set("untitled", "1");
      if (filters.notUp) params.set("notUp", "1");
      const res = await fetch(`/api/collections/${collectionId}/facebook-posts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch the posts");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

/** The offer's photo plan (#311) as the Photos card reads it. Timestamps arrive as JSON strings; the
 * card shows state and counts, so they are typed away rather than revived. */
export type OfferPhotoPlanView = Omit<OfferPhotoPlanState, "startedAt" | "finishedAt">;

/** Generation state + stored images for an offer's photos (#311). Polls while a run is queued or in
 * flight — rendering happens in a background worker, so the card has no completion event to await. */
export function useOfferPhotoPlan(collectionId: string, offerId: string) {
  return useQuery<OfferPhotoPlanView>(photoPlanQuery(collectionId, offerId));
}

/** Several offers' photo plans at once — a multi-lot post's lots (#1848) — each under its offer's own
 *  key, so the post's screen and a lot's Photos card share one copy. Asked only while `enabled`. */
export function useOfferPhotoPlans(collectionId: string, offerIds: readonly string[], enabled: boolean) {
  return useQueries({
    queries: offerIds.map((offerId) => ({ ...photoPlanQuery(collectionId, offerId), enabled })),
  });
}

function photoPlanQuery(collectionId: string, offerId: string) {
  return {
    queryKey: offerKeys.photoPlan(collectionId, offerId),
    queryFn: async (): Promise<OfferPhotoPlanView> => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/photos`);
      if (!res.ok) throw new Error("Failed to load the photo plan");
      return res.json();
    },
    refetchInterval: (query: { state: { data?: OfferPhotoPlanView } }) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running" ? 2000 : false,
  };
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
      if (context?.listingOutOfDate) params.set("listingOutOfDate", "1");
      if (context?.needsRefresh) params.set("needsRefresh", "1");
      if (context?.platformSale) params.set("platformSale", "1");
      if (context?.needsAction) params.set("needsAction", "1");
      else if (context?.states?.length) params.set("state", context.states.join(","));
      else if (context?.includeClosed) params.set("includeClosed", "1");
      if (context?.search) params.set("search", context.search);
      if (context?.post) params.set("post", String(context.post));
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
      if (filters.listingOutOfDate) params.set("listingOutOfDate", "1");
      if (filters.needsRefresh) params.set("needsRefresh", "1");
      if (filters.platformSale) params.set("platformSale", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      if (filters.post) params.set("post", String(filters.post));
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
      if (filters.listingOutOfDate) params.set("listingOutOfDate", "1");
      if (filters.needsRefresh) params.set("needsRefresh", "1");
      if (filters.platformSale) params.set("platformSale", "1");
      if (filters.needsAction) params.set("needsAction", "1");
      else if (filters.states?.length) params.set("state", filters.states.join(","));
      else if (filters.includeClosed) params.set("includeClosed", "1");
      if (filters.search) params.set("search", filters.search);
      if (filters.post) params.set("post", String(filters.post));
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
        : target.kind === "issue"
          ? { issueId: target.issueId }
          : { checklistId: target.checklistId };
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
      /** What a new offer here starts as (#449/#362) — the format, and an auction platform's own
       * opening figure, which outranks a suggestion read off the goods (#553). */
      defaultStartingPrice: string | null;
      defaultListingType: string | null;
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

/** Live offers that already list the same **stamp in the same condition** as these copies (#513) —
 * Colnect's one-offer-per-stamp-per-condition rule, asked before the copies go on. `platformId`
 * narrows to the platform being listed on; without one the hook stays idle, since a collision is
 * always a collision *somewhere*. */
export function useStampConditionCollisions(
  collectionId: string,
  itemIds: string[],
  platformId: string | null,
  enabled: boolean
) {
  return useQuery<StampConditionCollision[]>({
    queryKey: [
      "offers",
      collectionId,
      "stamp-condition-collision",
      [...itemIds].sort(),
      platformId,
    ] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ platformId: platformId! });
      for (const id of itemIds) params.append("itemId", id);
      const res = await fetch(
        `/api/collections/${collectionId}/offers/stamp-condition-collisions?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to check collisions");
      return (await res.json()).collisions;
    },
    enabled: enabled && !!platformId && itemIds.length > 0,
  });
}

/** The live offers on this offer's platform listing the same thing it does (#1347) — keyed under the
 * offer's detail, so everything that re-reads the offer re-asks this too. */
export function useOfferListingDuplicates(collectionId: string, offerId: string, enabled: boolean) {
  return useQuery<OfferListingDuplicate[]>({
    queryKey: [...offerKeys.detail(collectionId, offerId), "listing-duplicates"] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/listing-duplicates`);
      if (!res.ok) throw new Error("Failed to check for duplicate listings");
      return (await res.json()).duplicates;
    },
    enabled,
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
  /** What `areaIds` was resolved from, so an area added under it keeps the rows drawn (#977). */
  areaSelection: AreaSelection,
  enabled: boolean
) {
  return useQuery<ItemListItem[]>({
    queryKey: ["offers", collectionId, "composable", offerId, areaIds] as const,
    ...keepRowsAcrossTreeChange<ItemListItem[]>(areaSelection, [
      "offers",
      collectionId,
      "composable",
      offerId,
    ]),
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

/**
 * The enriched copies of one target set, for the picker's expandable *Show contents* (#867).
 *
 * Fetched when the collector opens a set rather than shipped with every target offer — the closed
 * picker needs the copies for nothing, and enriching all of them was 94% of what
 * `compose-targets` returned. Under the offers key, so composing anything refreshes it, and cached
 * per set, so re-opening one costs nothing.
 */
export function useComposeTargetSetCopies(
  collectionId: string,
  offerSetId: string,
  enabled: boolean
) {
  return useQuery<ItemListItem[]>({
    queryKey: ["offers", collectionId, "compose-target-set-copies", offerSetId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/offers/compose-targets/set-copies?offerSetId=${encodeURIComponent(offerSetId)}`
      );
      if (!res.ok) throw new Error("Failed to load the set's copies");
      return (await res.json()).copies as ItemListItem[];
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

// ── The bulk-lot builder (#760) ──────────────────────────────────────────────────────────────────
//
// Two reads over one pool. The **summary** answers the criteria panel live, before anything is
// picked — which is the whole reason it is a read of its own (#759). The **proposal** runs only once
// the collector has asked for one, and asking is what puts a seed in the URL, so the seed doubles as
// "a lot has been proposed". Neither is cached beyond the query key it was asked under: the request
// *is* the key, so pinning a copy or re-rolling is a different question rather than a stale answer.

/** What the pool holds under these criteria — no pick is run. Disabled until a platform is chosen,
 *  since every availability clause is judged against one. */
/** The request with the listing choices dropped — the wording, and the type and Facebook group the
 *  offer is made as (#1688) — leaving what the pool and the pick are actually about. */
function withoutListingChoices(request: LotBuilderRequest): LotBuilderRequest {
  return {
    ...request,
    criteria: {
      ...request.criteria,
      nameTemplate: null,
      descriptionTemplate: null,
      listingType: null,
      facebookGroupId: null,
    },
  };
}

export function useLotPoolSummary(collectionId: string, request: LotBuilderRequest) {
  // Only the criteria narrow the pool; the seed and the pins describe a pick. Keyed on the criteria
  // alone so a re-roll does not re-ask a question whose answer cannot have changed.
  const params = lotBuilderSearchParams({
    criteria: withoutListingChoices(request).criteria,
    seed: "",
    pinnedItemIds: [],
    rejectedItemIds: [],
  }).toString();
  return useQuery<LotPoolSummary>({
    queryKey: ["offers", collectionId, "lot-pool", params] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/offers/lot-builder/summary?${params}`
      );
      if (!res.ok) throw new Error("Failed to read the candidate pool");
      return res.json();
    },
    enabled: !!request.criteria.platformId,
  });
}

/** One round of the builder: the criteria, the seed, the pins and the rejections, answered whole.
 *  Disabled until there is a seed — until then the collector is still stating criteria, and the
 *  readout above is what answers them. */
export function useLotProposal(collectionId: string, request: LotBuilderRequest) {
  // Keyed on everything **except the listing choices** (#774, #1688). The templates, the type and the
  // group ride in the criteria so the preset can keep them and the commit can make exactly what was
  // previewed, but they are not inputs to the pick: re-asking the server for a hundred copies because a title gained a character
  // would be a scan of every listable copy in the area, per keystroke.
  const params = lotBuilderSearchParams(withoutListingChoices(request)).toString();
  return useQuery<LotProposal>({
    queryKey: ["offers", collectionId, "lot-proposal", params] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/offers/lot-builder/proposal?${params}`
      );
      if (!res.ok) throw new Error("Failed to build the lot");
      return res.json();
    },
    enabled: !!request.criteria.platformId && !!request.seed,
    // The pool moves under an open wizard — a copy sold, listed elsewhere, promised in a trade — and
    // the commit re-plans regardless (#717). Re-asking on focus is how the screen stops showing a
    // lot the commit would no longer build.
    refetchOnWindowFocus: true,
  });
}

/** The series one platform's single offers plus its available copies could complete (#1210). In the
 *  offers namespace, so anything that changes an offer or a copy's availability re-asks it.
 *  `criteriaQuery` is the screen's filters and mixing switches (#1265), already a query string —
 *  `seriesCriteriaParams`' output — so the key and the request cannot spell them differently. */
export function useSeriesFromSingles(collectionId: string, platformId: string, criteriaQuery: string) {
  return useQuery<SeriesRecombinationResult>({
    queryKey: ["offers", collectionId, "series-from-singles", platformId, criteriaQuery] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/offers/series-from-singles?platformId=${encodeURIComponent(platformId)}${criteriaQuery ? `&${criteriaQuery}` : ""}`
      );
      if (!res.ok) throw new Error("Failed to read the series");
      return res.json();
    },
    enabled: !!platformId,
    // Offers and copies move while the screen sits open in another tab.
    refetchOnWindowFocus: true,
  });
}

/** The preview of a bulk offer pass from the Copies list (#1287). `query` is
 *  `generatorRequestParams`' output, so the key and the request cannot spell the choices differently.
 *  Not re-asked on focus: what the collector confirms is compared with a fresh plan on the server
 *  (#717), and a preview that changed under the cursor would make that comparison meaningless. */
export function useOfferGeneratorPreview(collectionId: string, query: string) {
  return useQuery<OfferGeneratorPreview>({
    queryKey: ["offers", collectionId, "generator", query] as const,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/generator?${query}`);
      if (!res.ok) throw new Error("Failed to plan the offers");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });
}

/**
 * The collection's saved lot criteria (#773).
 *
 * Read through the server action rather than a route of its own: it is a short, unfiltered list the
 * builder needs whole, and there is nothing for a URL to say about it. It lives in the offers key
 * namespace so `invalidateAll` after a save or a delete refreshes it along with everything else the
 * builder is showing.
 */
export function useLotBuilderPresets(collectionId: string) {
  return useQuery<LotBuilderPresetData[]>({
    queryKey: ["offers", collectionId, "lot-presets"] as const,
    queryFn: async () => {
      const { getLotBuilderPresetsAction } = await import("@/app/actions/offers");
      return getLotBuilderPresetsAction(collectionId);
    },
    staleTime: 5 * 60_000,
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
    /** A price typed on the Prepare screen (#1894): written into the row in place, and every other
     *  offer read marked stale. Refetching the screen itself would rebuild every loaded page — a
     *  valuation and a photo plan per row — for each of a run of prices typed one after another, and
     *  nothing else on its row follows from the price but what the row works out itself. */
    settlePreparePrice: (
      collectionId: string,
      offerId: string,
      field: "price" | "startingPrice",
      value: string | null
    ) => {
      queryClient.setQueriesData<InfiniteData<{ items: PrepareOffer[]; nextCursor: string | null }>>(
        { queryKey: ["offers", collectionId, "prepare"] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((o) =>
                o.id !== offerId
                  ? o
                  : field === "price"
                    ? { ...o, price: value ?? "0.00" }
                    : { ...o, startingPrice: value }
              ),
            })),
          }
      );
      return queryClient.invalidateQueries({
        queryKey: offerKeys.all(collectionId),
        predicate: (query) => query.queryKey[2] !== "prepare",
      });
    },
    /** A price typed on a lot's row of a post's screen (#2031): written into the lot's row at once, as
     *  {@link settlePreparePrice} does, and then the lot settled as any change to it is. */
    settlePostLotPrice: (
      collectionId: string,
      postId: string,
      offerId: string,
      field: "price" | "startingPrice",
      value: string | null
    ) => {
      const key = offerKeys.facebookPostPrepare(collectionId, postId);
      queryClient.setQueryData<Record<string, PrepareOffer> | null>(key, (data) => {
        const offer = data?.[offerId];
        if (!data || !offer) return data;
        return {
          ...data,
          [offerId]: field === "price" ? { ...offer, price: value ?? "0.00" } : { ...offer, startingPrice: value },
        };
      });
      return settlePostLot(queryClient, collectionId, postId, offerId);
    },
    settlePostLot: (collectionId: string, postId: string, offerId: string) =>
      settlePostLot(queryClient, collectionId, postId, offerId),
  };
}

/** What the post's screen reads of the post as a whole (#2221) — written in place by
 *  {@link settlePostLot} rather than read again. */
const POST_SCREEN_READS = new Set<unknown>(["facebook-post", "facebook-post-prepare", "facebook-lot-photos"]);

/** The last refresh asked of each lot, so an answer overtaken by a later one is dropped. */
const lotRefreshes = new Map<string, number>();

/**
 * One lot of a post changed from its row on the post's screen — a price, a title, its own state (#2221):
 * that lot read again and written into the screen — its row, the kit the post's text and captions are
 * drawn from, its texts' status, its untranslated names — and, captioned, its photo. Every other offer
 * read is marked stale, as `invalidateAll` would, except the post's own reads and the other offers'
 * photo plans, which the one lot cannot have changed: refetching them read every lot of the post again
 * for each price of a run typed down the list.
 */
async function settlePostLot(queryClient: QueryClient, collectionId: string, postId: string, offerId: string) {
  const ask = (lotRefreshes.get(offerId) ?? 0) + 1;
  lotRefreshes.set(offerId, ask);
  void queryClient.invalidateQueries({
    queryKey: offerKeys.all(collectionId),
    predicate: ({ queryKey: [, , kind, id] }) =>
      kind === "photo-plan" ? id === offerId : !(POST_SCREEN_READS.has(kind) && id === postId),
  });
  const res = await fetch(`/api/collections/${collectionId}/facebook-posts/${postId}/lots/${offerId}`);
  if (lotRefreshes.get(offerId) !== ask) return;
  if (!res.ok) {
    // Taken out of the post meanwhile, or the post gone: the screen is read whole.
    await queryClient.invalidateQueries({ queryKey: offerKeys.all(collectionId) });
    return;
  }
  const update: FacebookPostLotUpdate = await res.json();
  queryClient.setQueryData<FacebookPostScreen>(
    offerKeys.facebookPost(collectionId, postId),
    (screen) => screen && withFacebookPostLot(screen, update)
  );
  queryClient.setQueryData<Record<string, PrepareOffer> | null>(
    offerKeys.facebookPostPrepare(collectionId, postId),
    (rows) => withPrepareRow(rows ?? null, offerId, update.prepare)
  );
  await settleLotPhotos(queryClient, collectionId, postId, [offerId]);
}
