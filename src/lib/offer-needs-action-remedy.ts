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

/**
 * Whether a set has **sold elsewhere** (#1804): it has not left through this offer's own sale, and
 * one of its copies has left through another set's — another offer's, on this platform or another.
 * `soldVia` maps each sold copy to the set whose sale line took it. Only a live offer is asked: a
 * set of an offer that is not up is not out of step with anything.
 */
export function isSetSoldElsewhere(
  set: { id: string; sold: boolean; itemIds: readonly string[] },
  soldVia: ReadonlyMap<string, string>
): boolean {
  if (set.sold) return false;
  return set.itemIds.some((itemId) => {
    const via = soldVia.get(itemId);
    return via != null && via !== set.id;
  });
}

/**
 * What *Remove sets sold elsewhere* (#1805) would do to an offer: the sets it takes off — every one
 * sold elsewhere, and only those, a set sold through this offer being this offer's own record — and
 * how many sets would be left to sell afterwards. When that is none the action does not run: an
 * emptied listing can only come down (#1277), so the collector is pointed at closing it instead.
 */
export function soldElsewhereRemoval<S extends { sold: boolean; soldElsewhere: boolean }>(
  sets: readonly S[]
): { remove: S[]; leftToSell: number } {
  return {
    remove: sets.filter((s) => s.soldElsewhere),
    leftToSell: sets.filter((s) => !s.sold && !s.soldElsewhere).length,
  };
}

/** The action's name, with its count (#1805): *Remove 3 sets sold elsewhere*. */
export function soldElsewhereRemovalLabel(count: number): string {
  return `Remove ${count} ${count === 1 ? "set" : "sets"} sold elsewhere`;
}

/**
 * Where the removal of the sets sold elsewhere is offered (#1835): inside **Update via Assistant**
 * wherever the offer has that update, since taking them off is always the first half of bringing the
 * listing back into step — one action and one confirmation instead of remove, confirm, update. Its
 * own **Remove N sets sold elsewhere** (#1805) stays only where there is no update to fold it into: a
 * platform the Assistant cannot edit a live listing on, or an offer that is not Active. Null while
 * there is nothing to remove.
 */
export function soldElsewhereRemovalVia(offer: {
  state: OfferState;
  /** The offer's screen offers Update via Assistant at all (`offersAssistantUpdate`). */
  assistantUpdate: boolean;
  sets: readonly { soldElsewhere: boolean }[];
}): "update" | "own" | null {
  if (!offer.sets.some((s) => s.soldElsewhere)) return null;
  return offer.state === "active" && offer.assistantUpdate ? "update" : "own";
}

/** The update's action once it removes sets first (#1835): *Remove 2 sets and update*. */
export function soldElsewhereUpdateLabel(count: number): string {
  return `Remove ${count} ${count === 1 ? "set" : "sets"} and update`;
}
