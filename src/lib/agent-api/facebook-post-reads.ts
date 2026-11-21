// What `get_facebook_post` answers with, and the naming of a post (#2608).
//
// **Pure, and structurally typed on purpose**, the shape every `*-reads.ts` beside it has and for
// their reason (`agent-api.md`, *The module layout is the Prisma-free split*). No Prisma, no
// `server-only`, so `pnpm test:unit` holds every decision below.
//
// A Facebook post is read here for one reason: to make a proposal of it (#2602) — *send this post to
// Jan first*. So the read is the post's lots as a proposal would carry them — each by its number in
// the post, which is the number the proposal gives it — and, per lot, the proposal it is in. Its
// photos, text and translations are the post's screen's, not the agent's.
//
//  - **Where a post stands is the post's screen's word for it** — `facebookPostStage`, the stages the
//    list of posts filters by — and whether a proposal can be made of it is `postProposalRefusal`,
//    the sentence *Make a proposal…* is refused with, asked of the same facts.
//  - **The post's proposal is the one its screen links to**: the open one, else the latest.
//  - **A lot's price is the figure the seller states** — a quick buy's asking price, an auction's
//    opening — absent rather than nought while it has none, as a proposal's lot states it.

import { facebookPostStage, hasFacebookPostGoneUp } from "../facebook-post-rules";
import { offerNumberLabel } from "../offer-set-rules";
import { isProposalOpen, postProposalRefusal, proposalStatusOf } from "../proposal-rules";

// ── Naming ───────────────────────────────────────────────────────────────────

/** How a post was named: its short number, or its id. */
export type FacebookPostRef = { kind: "number"; postNo: number } | { kind: "id"; id: string };

/** A post as the agent names it — its number as the collector calls it (`12`, `#12`), or its id. */
export function parseFacebookPostRef(value: string): FacebookPostRef {
  const text = value.trim();
  const numbered = /^#?(\d+)$/.exec(text);
  if (numbered) return { kind: "number", postNo: Number(numbered[1]) };
  return { kind: "id", id: text };
}

// ── get_facebook_post ────────────────────────────────────────────────────────

/** One lot of a post as it is read, typed structurally. */
export interface FacebookPostLotFacts {
  offerId: string;
  offerNo: number;
  /** Its number in the post; null only on a lot the post has not numbered. */
  facebookLotNo: number | null;
  name: string | null;
  state: string;
  listingType: string;
  price: string;
  startingPrice: string | null;
  currency: string;
  /** The text it went up with (#1800), or null — what tells a lot that went up from one that did not. */
  facebookPostSnapshot: unknown;
  /** The proposal it is a lot of, if any. */
  proposal: { proposalNo: number; status: string } | null;
}

/** A post as it is read, typed structurally. */
export interface FacebookPostFacts {
  postId: string;
  postNo: number;
  title: string | null;
  groupName: string;
  platformName: string;
  /** In lot order. */
  lots: readonly FacebookPostLotFacts[];
  /** Every proposal made from the post, any order. */
  proposals: readonly { proposalId: string; proposalNo: number; status: string; contactName: string }[];
}

/** One lot of a post as `get_facebook_post` states it. */
export interface AgentFacebookPostLot {
  readonly lotNo: number | null;
  readonly offerId: string;
  readonly offerNo: number;
  readonly title: string;
  readonly state: string;
  readonly listingType: string;
  /** The figure the seller states — the asking price, an auction's opening — null while it has none. */
  readonly price: string | null;
  readonly currency: string;
  /** The proposal it is a lot of (#2602) — the post's own, or an earlier one it was sold or withdrawn
   *  through — or null. */
  readonly proposal: { readonly proposalNo: number; readonly status: string } | null;
}

/** A post as `get_facebook_post` states it. */
export interface AgentFacebookPost {
  readonly id: string;
  readonly postNo: number;
  readonly title: string | null;
  readonly group: string;
  readonly platform: string;
  /** `preparing`, `ready`, `pending`, `up` or `over` — as the post's screen names it. */
  readonly stage: string;
  readonly lots: readonly AgentFacebookPostLot[];
  /** The proposal made from it that its screen links to — the open one, else the latest — or null. */
  readonly proposal: {
    readonly id: string;
    readonly proposalNo: number;
    readonly contact: string;
    readonly status: string;
  } | null;
  /** Why `create_proposal_from_post` would be refused now, in the app's words, or null when it would not. */
  readonly proposalRefusal: string | null;
  readonly path: string;
}

/** The figure a lot's seller states, or null while it has none — as a proposal's lot states it. */
function statedPrice(lot: FacebookPostLotFacts): string | null {
  const stated = lot.listingType === "auction" ? lot.startingPrice : lot.price;
  return stated !== null && Number(stated) > 0 ? stated : null;
}

export function facebookPostRecord(facts: FacebookPostFacts, path: string): AgentFacebookPost {
  const byNewest = [...facts.proposals].sort((a, b) => b.proposalNo - a.proposalNo);
  const open = byNewest.find((proposal) => isProposalOpen(proposalStatusOf(proposal.status)));
  const shown = open ?? byNewest[0];
  const stage = facebookPostStage(facts.lots);
  return {
    id: facts.postId,
    postNo: facts.postNo,
    title: facts.title,
    group: facts.groupName,
    platform: facts.platformName,
    stage,
    lots: facts.lots.map((lot) => ({
      lotNo: lot.facebookLotNo,
      offerId: lot.offerId,
      offerNo: lot.offerNo,
      title: offerNumberLabel(lot.name, lot.offerNo),
      state: lot.state,
      listingType: lot.listingType,
      price: statedPrice(lot),
      currency: lot.currency,
      proposal: lot.proposal && { proposalNo: lot.proposal.proposalNo, status: lot.proposal.status },
    })),
    proposal: shown
      ? { id: shown.proposalId, proposalNo: shown.proposalNo, contact: shown.contactName, status: shown.status }
      : null,
    proposalRefusal: postProposalRefusal({
      postNo: facts.postNo,
      up: hasFacebookPostGoneUp(facts.lots),
      lotCount: facts.lots.length,
      openProposal: open ? { proposalNo: open.proposalNo, contactName: open.contactName } : null,
    }),
    path,
  };
}
