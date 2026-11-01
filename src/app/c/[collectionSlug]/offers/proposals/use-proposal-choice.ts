"use client";

import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { usePreparingProposals } from "./use-proposals-query";

/** Where the proposal last chosen for new offers is remembered, per collection (#2304). */
const PROPOSAL_CHOICE_KEY = "offer-proposal";

/**
 * The proposal new offers made from the Copies list go into (#2304): *New offer*'s Proposal field and
 * the offer generator's *Into proposal* read and write the one remembered choice, so both follow the
 * proposal being put together. The proposals offered are those being prepared — the only ones that
 * take lots (#2307) — and the remembered one is preselected only while it is still among them: once it
 * is sent, sold or declined, the choice is *None* again.
 */
export function useProposalChoice(collectionId: string, enabled: boolean) {
  const { data: proposals = [], isFetched } = usePreparingProposals(collectionId, enabled);
  const [stored, remember] = usePersistedCollectionValue(PROPOSAL_CHOICE_KEY, collectionId);
  const remembered = stored && proposals.some((p) => p.proposalId === stored) ? stored : "";
  return {
    proposals,
    /** The proposal to start on, or "" for none. */
    remembered,
    /** Remember a proposal, or "" for none. */
    remember,
    /** The proposals have been read, so `remembered` is what it will stay. */
    ready: !enabled || isFetched,
  };
}
