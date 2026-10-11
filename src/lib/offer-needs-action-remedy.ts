/**
 * Which way off *Needs action* an active offer's situation calls for (#1804) — pure, Prisma-free.
 *
 * An active listing flagged *Needs action* is offered both **Update via Assistant** and **Close via
 * Assistant**, and the collector used to have to work out which one applied. The offer already knows:
 * if nothing in it is left to sell — every set sold, here or through another offer, or no set left at
 * all — the listing can only come down; otherwise it has to be brought back into step with what is
 * left. The answer is a **highlight**, never a restriction: the other action stays available, because
 * the collector may know something the record does not.
 */

import type { OfferState } from "./offer-rules";

export type NeedsActionRemedy = {
  action: "close" | "update";
  /** One short line saying why — the one-line-hint rule; the detail is in the user guide. */
  hint: string;
};

export function needsActionRemedy(offer: {
  state: OfferState;
  /** A set holds a copy sold or in bidding elsewhere (ADR-0013 §4). */
  needsAction: boolean;
  /** The listing was changed here since it was posted (#542) — the other half of *Needs action*. */
  listingOutOfDate: boolean;
  sets: readonly {
    /** Left through this offer's own sale. */
    sold: boolean;
    /** A copy left through another offer's sale (bidding does not count — it may come back). */
    soldElsewhere: boolean;
    needsAction: boolean;
  }[];
}): NeedsActionRemedy | null {
  // Both buttons are an Active offer's (#462/#729); anywhere else there is no pair to choose from.
  if (offer.state !== "active") return null;
  // An emptied listing is on *Needs action* whether or not anything else flags it (#1277).
  const flagged = offer.needsAction || offer.listingOutOfDate || offer.sets.length === 0;
  if (!flagged) return null;

  const left = offer.sets.filter((s) => !s.sold && !s.soldElsewhere).length;
  if (left === 0) {
    return {
      action: "close",
      hint:
        offer.sets.length === 0
          ? "Nothing left in this listing — close it"
          : "Last copy sold — close the listing",
    };
  }
  if (offer.sets.some((s) => s.soldElsewhere)) {
    return { action: "update", hint: "Some copies sold elsewhere — update the listing" };
  }
  if (offer.sets.some((s) => s.needsAction)) {
    return { action: "update", hint: "A copy is in bidding elsewhere — update the listing" };
  }
  return { action: "update", hint: "Listing out of step — update it" };
}
