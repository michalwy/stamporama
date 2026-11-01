"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PrepareOffer } from "@/lib/offers";
import type { ProposalListItem, ProposalLotCandidate, ProposalScreen } from "@/lib/proposals";
import type { ProposalStatus } from "@/lib/proposal-rules";

// Proposals (#2287). Every key is under the offers key, `["offers", collectionId, …]`, so a write to
// any offer — a lot priced, withdrawn, sold — refreshes the proposal it is in, and `invalidateAll`
// from `use-offers-query.ts` is the one invalidation a proposal's own writes need.
export const proposalKeys = {
  list: (collectionId: string, statuses: readonly ProposalStatus[]) =>
    ["offers", collectionId, "proposals", "list", statuses] as const,
  open: (collectionId: string) => ["offers", collectionId, "proposals", "open"] as const,
  screen: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "screen", proposalId] as const,
  prepare: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "prepare", proposalId] as const,
  candidates: (collectionId: string, proposalId: string) =>
    ["offers", collectionId, "proposals", "candidates", proposalId] as const,
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

/** The proposals still open — the offer generator's *Into proposal* choices. */
export function useOpenProposals(collectionId: string, enabled: boolean) {
  return useQuery<{ proposalId: string; proposalNo: number; contactName: string; status: ProposalStatus }[]>({
    enabled,
    queryKey: proposalKeys.open(collectionId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/open`);
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
