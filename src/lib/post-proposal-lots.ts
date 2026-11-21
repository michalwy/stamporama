import "server-only";
import type { DbTransaction } from "./db";
import { hasFacebookPostGoneUp } from "./facebook-post-rules";
import type { OfferState } from "./offer-rules";
import {
  OPEN_PROPOSAL_STATUSES,
  isPostProposalLotPlanEmpty,
  postProposalLotPlan,
  postProposalSentRefusal,
} from "./proposal-rules";

// A proposal made from a Facebook post (#2602) holds the post's own lots, under the post's numbers.
// Every write that puts a lot into a post, takes one out or puts its lots in another order calls
// `syncPostProposalLots` in its own transaction, so the proposal follows the post while it is being
// prepared — and a post whose proposal has been sent refuses the change, rolling the caller back.
//
// It imports only the database and pure rules: `facebook-auctions.ts`, which `offers.ts` imports,
// calls it when a lot leaves its post.

/** A change to a post's lots refused because the proposal made from it has been sent. Its message is
 *  the collector's. */
export class PostProposalFixedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostProposalFixedError";
  }
}

/** The proposal made from the post that is still open, or null. */
export async function readOpenPostProposal(
  db: Pick<DbTransaction, "proposal">,
  postId: string
): Promise<{ id: string; proposalNo: number; status: string; contactName: string } | null> {
  const row = await db.proposal.findFirst({
    where: { facebookPostId: postId, status: { in: [...OPEN_PROPOSAL_STATUSES] } },
    orderBy: { proposalNo: "desc" },
    select: { id: true, proposalNo: true, status: true, contact: { select: { name: true } } },
  });
  return row && { id: row.id, proposalNo: row.proposalNo, status: row.status, contactName: row.contact.name };
}

/**
 * Bring the open proposal made from `postId` into line with the post's lots, inside the caller's
 * transaction: a lot new to the post joins it, a lot gone from the post leaves it (losing any pick, as
 * every lot leaving a proposal does, #2601), and each carries its post's number. Nothing while the post
 * is up — it takes no lots then — or has no open proposal. A change while the proposal is Sent is
 * refused with {@link PostProposalFixedError}.
 */
export async function syncPostProposalLots(tx: DbTransaction, postId: string): Promise<void> {
  const proposal = await readOpenPostProposal(tx, postId);
  if (!proposal) return;
  const [postLots, proposalLots] = await Promise.all([
    tx.offer.findMany({
      where: { facebookPostId: postId },
      select: {
        id: true,
        state: true,
        facebookPostSnapshot: true,
        facebookLotNo: true,
        proposalId: true,
        proposalLotNo: true,
        proposal: { select: { status: true } },
      },
    }),
    tx.offer.findMany({ where: { proposalId: proposal.id }, select: { id: true } }),
  ]);
  if (hasFacebookPostGoneUp(postLots)) return;
  const plan = postProposalLotPlan(
    proposal.id,
    postLots.map((lot) => ({
      offerId: lot.id,
      facebookLotNo: lot.facebookLotNo,
      proposalId: lot.proposalId,
      proposalOpen: lot.proposal !== null && (OPEN_PROPOSAL_STATUSES as readonly string[]).includes(lot.proposal.status),
      proposalLotNo: lot.proposalLotNo,
      state: lot.state as OfferState,
    })),
    proposalLots.map((lot) => lot.id)
  );
  if (isPostProposalLotPlanEmpty(plan)) return;
  if (proposal.status !== "preparing") {
    throw new PostProposalFixedError(postProposalSentRefusal(proposal));
  }
  if (plan.leave.length > 0) {
    await tx.offer.updateMany({
      where: { id: { in: plan.leave } },
      data: { proposalId: null, proposalLotNo: null, proposalPickedAt: null },
    });
  }
  const joining = new Set(plan.join);
  // Two passes through negatives, as every renumbering does: the unique (proposal, lot) index is
  // checked row by row.
  for (const [index, lot] of plan.renumber.entries()) {
    await tx.offer.update({
      where: { id: lot.offerId },
      data: {
        proposalLotNo: -1 - index,
        // A pick is the buyer's of this proposal (#2601): none follows a lot in from an earlier one.
        ...(joining.has(lot.offerId) ? { proposalId: proposal.id, proposalPickedAt: null } : {}),
      },
    });
  }
  for (const lot of plan.renumber) {
    await tx.offer.update({ where: { id: lot.offerId }, data: { proposalLotNo: lot.lotNo } });
  }
}
