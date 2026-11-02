"use client";

import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PrepareOffer } from "@/lib/offers";
import type {
  ProposalListItem,
  ProposalLotCandidate,
  ProposalLotUpdate,
  ProposalSaleOptions,
  ProposalScreen,
  ProposalTakingLots,
} from "@/lib/proposals";
import type { ProposalLotPhotos, ProposalMessage } from "@/lib/proposal-handout";
import type { ProposalStatus } from "@/lib/proposal-rules";
import type { ListedElsewhereCopy } from "@/lib/listed-elsewhere-rules";
import { withPrepareRow } from "@/lib/facebook-post-lot-refresh";
import { withProposalLot, withProposalLotPhotos } from "@/lib/proposal-lot-refresh";

// Proposals (#2287). Every key is under the offers key, `["offers", collectionId, …]`, so a write to
// any offer — a lot priced, withdrawn, sold — refreshes the proposal it is in, and `invalidateAll`
// from `use-offers-query.ts` is the one invalidation a proposal's own writes need.
export const proposalKeys = {
  list: (collectionId: string, statuses: readonly ProposalStatus[]) =>
    ["offers", collectionId, "proposals", "list", statuses] as const,
  preparing: (collectionId: string) => ["offers", collectionId, "proposals", "preparing"] as const,
  screen: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "screen", proposalId] as const,
  prepare: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "prepare", proposalId] as const,
  candidates: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "candidates", proposalId] as const,
  saleOptions: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "sale-options", proposalId] as const,
  listedElsewhere: (collectionId: string, proposalId: string, offerIds: readonly string[]) =>
    ["offers", collectionId, "proposals", "listed-elsewhere", proposalId, offerIds] as const,
  photos: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "photos", proposalId] as const,
  message: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "message", proposalId] as const,
  shareLink: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "share-link", proposalId] as const,
};

/** Every proposal, newest first and a page at a time. */
export function useProposalsInfinite(collectionId: string, statuses: readonly ProposalStatus[]) {
  return useInfiniteQuery<{ items: ProposalListItem[]; nextCursor: string | null }>({
    queryKey: proposalKeys.list(collectionId, statuses),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("offset", pageParam as string);
      if (statuses.length) params.set("status", statuses.join(","));
      const res = await fetch(`/api/collections/${collectionId}/proposals?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch the proposals");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
  });
}

/** The proposals being prepared — the only ones that take lots (#2307), so *New offer*'s Proposal
 *  field (#2304) and the offer generator's *Into proposal* choices. */
export function usePreparingProposals(collectionId: string, enabled: boolean) {
  return useQuery<ProposalTakingLots[]>({
    enabled,
    queryKey: proposalKeys.preparing(collectionId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/preparing`);
      if (!res.ok) throw new Error("Failed to fetch the proposals");
      return (await res.json()).items;
    },
  });
}

export function useProposalScreen(collectionId: string, proposalId: string) {
  return useQuery<ProposalScreen>({
    queryKey: proposalKeys.screen(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}`);
      if (!res.ok) throw new Error("Failed to fetch the proposal");
      return res.json();
    },
  });
}

/** The proposal's open lots as Prepare rows, keyed by offer id — what its price fields edit. */
export function useProposalLotsPrepare(collectionId: string, proposalId: string) {
  return useQuery<Record<string, PrepareOffer>>({
    queryKey: proposalKeys.prepare(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/prepare`);
      if (!res.ok) throw new Error("Failed to fetch the lots");
      return (await res.json()).lots;
    },
  });
}

export function useProposalLotCandidates(collectionId: string, proposalId: string) {
  return useQuery<ProposalLotCandidate[]>({
    queryKey: proposalKeys.candidates(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/candidates`);
      if (!res.ok) throw new Error("Failed to fetch the offers");
      return (await res.json()).items;
    },
  });
}

/** What *Convert to sale…* offers (#2289): the open lots and the contact's open sales. */
export function useProposalSaleOptions(collectionId: string, proposalId: string) {
  return useQuery<ProposalSaleOptions>({
    queryKey: proposalKeys.saleOptions(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/sale-options`);
      if (!res.ok) throw new Error("Failed to fetch the lots");
      return res.json();
    },
  });
}

/** The ticked lots on *Convert to sale…* whose copies are in an open offer elsewhere (#2339). */
export function useProposalLotsListedElsewhere(collectionId: string, proposalId: string, offerIds: readonly string[]) {
  const sorted = [...offerIds].sort();
  return useQuery<{ offerId: string; copies: ListedElsewhereCopy[] }[]>({
    queryKey: proposalKeys.listedElsewhere(collectionId, proposalId, sorted),
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of sorted) params.append("offerId", id);
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/listed-elsewhere?${params}`);
      if (!res.ok) throw new Error("Failed to check the lots' copies");
      return (await res.json()).lots;
    },
    enabled: sorted.length > 0,
  });
}

/** Each lot's photos, in lot order (#2288) — what the buyer is sent, by the offer photo rules. Asked
 *  again every few seconds while a lot's photos are still being made, so they appear when done. */
export function useProposalPhotos(collectionId: string, proposalId: string) {
  return useQuery<ProposalLotPhotos[]>({
    queryKey: proposalKeys.photos(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/photos`);
      if (!res.ok) throw new Error("Failed to fetch the photos");
      return (await res.json()).lots;
    },
    refetchInterval: (query) =>
      query.state.data?.some((lot) => lot.status === "queued" || lot.status === "running") ? 4000 : false,
  });
}

/** The message to the buyer (#2288), from the Direct platform's template. */
export function useProposalMessage(collectionId: string, proposalId: string) {
  return useQuery<ProposalMessage>({
    queryKey: proposalKeys.message(collectionId, proposalId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/message`);
      if (!res.ok) throw new Error("Failed to fetch the message");
      return res.json();
    },
  });
}

/** What the proposal's screen reads of the proposal as a whole — written in place by
 *  {@link settleProposalLot} rather than read again. */
const PROPOSAL_SCREEN_READS = new Set<unknown>(["screen", "prepare", "photos"]);

/** The last refresh asked of each lot, so an answer overtaken by a later one is dropped. */
const lotRefreshes = new Map<string, number>();

/**
 * One lot of a proposal changed from its row — a price, a title, its own state (#2313, #2221's rule for
 * a post): that lot read again and written into the screen, its Prepare row and its photos. Every
 * other offer read is marked stale, as `invalidateAll` would, except the proposal's own reads, which the
 * one lot is written into: refetching them read every lot again for each price of a run typed down the
 * list.
 */
async function settleProposalLot(queryClient: QueryClient, collectionId: string, proposalId: string, offerId: string) {
  const ask = (lotRefreshes.get(offerId) ?? 0) + 1;
  lotRefreshes.set(offerId, ask);
  void queryClient.invalidateQueries({
    queryKey: ["offers", collectionId],
    predicate: ({ queryKey: [, , area, kind, id] }) =>
      !(area === "proposals" && PROPOSAL_SCREEN_READS.has(kind) && id === proposalId),
  });
  const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/lots/${offerId}`);
  if (lotRefreshes.get(offerId) !== ask) return;
  if (!res.ok) {
    // Taken out of the proposal meanwhile, or the proposal gone: the screen is read whole.
    await queryClient.invalidateQueries({ queryKey: ["offers", collectionId] });
    return;
  }
  const update: ProposalLotUpdate & { photos: ProposalLotPhotos | null } = await res.json();
  queryClient.setQueryData<ProposalScreen>(
    proposalKeys.screen(collectionId, proposalId),
    (screen) => screen && withProposalLot(screen, update)
  );
  queryClient.setQueryData<Record<string, PrepareOffer> | null>(
    proposalKeys.prepare(collectionId, proposalId),
    (rows) => withPrepareRow(rows ?? null, offerId, update.prepare)
  );
  queryClient.setQueryData<ProposalLotPhotos[]>(proposalKeys.photos(collectionId, proposalId), (photos) =>
    withProposalLotPhotos(photos, update.photos)
  );
}

/** A lot of the proposal settled from its row (#2313): a price is written into its row at once, as on
 *  the Prepare screen, and then the lot read again — it alone. */
export function useSettleProposalLot(collectionId: string, proposalId: string) {
  const queryClient = useQueryClient();
  return {
    settleLot: (offerId: string) => settleProposalLot(queryClient, collectionId, proposalId, offerId),
    settleLotPrice: (offerId: string, field: "price" | "startingPrice", value: string | null) => {
      queryClient.setQueryData<Record<string, PrepareOffer> | null>(proposalKeys.prepare(collectionId, proposalId), (data) => {
        const offer = data?.[offerId];
        if (!data || !offer) return data;
        return {
          ...data,
          [offerId]: field === "price" ? { ...offer, price: value ?? "0.00" } : { ...offer, startingPrice: value },
        };
      });
      return settleProposalLot(queryClient, collectionId, proposalId, offerId);
    },
  };
}
