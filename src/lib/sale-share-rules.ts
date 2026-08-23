import { SALE_STATUS_ORDER, type SaleStatus } from "./sale-status";

// **What the buyer's link is allowed to do** (#699; ADR-0013 §7) — the pure half, with no database
// and no `server-only`, so the rules can be reasoned about and tested on their own.
//
// `trade-share-rules.ts`'s job, one table over: whether a string is even one of our tokens, whether
// a resolved one may still be served, and — the question a trade does not have — whether the buyer
// may still answer.

/** Every raw token starts with this. `stmpa_` is the Assistant's and `stmpx_` a trade's share link;
 *  three credentials authorising three different things are told apart before anything is hashed. */
export const SALE_SHARE_TOKEN_PREFIX = "stmps_";

/** Cheap shape check, run before any lookup: anything not carrying our prefix is not ours, and
 *  hashing it to find that out would be a database round trip per stray request. */
export function isSaleShareTokenShape(raw: string): boolean {
  return raw.startsWith(SALE_SHARE_TOKEN_PREFIX) && raw.length > SALE_SHARE_TOKEN_PREFIX.length;
}

/**
 * Why a link is not being served at all.
 *
 * Told apart because they are different news for a reader with no account, no history and nobody to
 * ask: *expired* says the seller once meant to ask this and the address has run out, *unknown* says
 * it is simply wrong. A parcel already packed is **not** in here — that link still opens and still
 * shows what was chosen; it just no longer takes an answer (see {@link canChooseSaleSet}).
 */
export type SaleShareRefusal = "unknown" | "expired";

export const SALE_SHARE_REFUSAL_MESSAGE: Record<SaleShareRefusal, string> = {
  unknown: "This link is not valid. It may have been withdrawn, or replaced by a newer one.",
  expired: "This link has expired. Ask the seller for a new one.",
};

/**
 * Whether a verified token may still be served, given the sale it names.
 *
 * Only the expiry refuses. Every fulfillment status serves, `received` included: a buyer who opens
 * the link after the parcel arrived is entitled to see which copy went, and a page that had gone
 * blank would read as the seller having withdrawn it.
 */
export function resolveSaleShareAccess(
  token: { expiresAt: Date | null },
  now: Date
): { ok: true } | { ok: false; reason: SaleShareRefusal } {
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/** The first status at which the copies are in the envelope. */
const PACKED_INDEX = SALE_STATUS_ORDER.indexOf("packed");

/**
 * **Whether the buyer may still choose** — `ordered` and `paid`, and nothing after.
 *
 * The question is *which of these identical copies do you want*, and it is answered at the packing
 * table. From `packed` on it has been answered in the physical world: the copies are in the
 * envelope, and a pick landing afterwards would rewrite the record to say a different one left while
 * also dropping the packing marks the seller made (`swapSaleLineSet`'s rule — a different copy has
 * not been packed).
 *
 * The seller keeps their own override in every status, as they always did: correcting the record of
 * what actually went is a different act from being asked which one should go.
 */
export function canChooseSaleSet(status: SaleStatus): boolean {
  const index = SALE_STATUS_ORDER.indexOf(status);
  return index >= 0 && index < PACKED_INDEX;
}

/** Said in place of the picker once the window has closed, so a buyer is told why rather than left
 *  looking for a control that is not there. Names the step that closed it, since *packed* and *sent*
 *  are different news about the same parcel. */
export function describeSaleChoiceClosed(status: SaleStatus): string {
  if (status === "packed") {
    return "This parcel has been packed, so the copies are settled. Message the seller if something needs to change.";
  }
  if (status === "sent" || status === "received") {
    return "This parcel is on its way, so the copies are settled.";
  }
  // Not reachable while `canChooseSaleSet` and this function agree on the lifecycle, and stated
  // rather than left to a cast: a status added later should read as closed until somebody decides
  // otherwise.
  return "The copies on this order are settled.";
}

/**
 * What one copy is called on the buyer's page.
 *
 * `Copy 1`, `Copy 2` — the trade page's own wording (`tradeProposalOptionLabel`), and for its
 * reason: the seller's set titles, offer numbers and shelf positions are not the buyer's business
 * and are kept out of the payload rather than merely left undrawn. What the buyer is choosing
 * between is pictures, and the label is only there so a radio has something to say.
 */
export function saleChoiceOptionLabel(index: number): string {
  return `Copy ${index + 1}`;
}

/** The question, asked once per line and worded by how many answers there are. */
export function saleChoicePrompt(count: number): string {
  return count === 1
    ? "One copy is still available for this stamp. Confirm it and the seller will pack it."
    : `The seller has ${count} of this stamp. Which one would you like?`;
}

/** Said under the picker: a pick is not final until the parcel is packed, which is the one thing a
 *  buyer cannot tell from the page. */
export const SALE_CHOICE_HINT = "You can change this until the seller packs the parcel.";

/** What a line the buyer has already answered says. The picture is still the statement; this is the
 *  word beside it. */
export const SALE_CHOICE_PICKED_LABEL = "Your choice";
