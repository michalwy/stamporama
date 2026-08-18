/**
 * The decisions that turn **a marketplace order** into a `Sale`, kept pure and kept neutral.
 *
 * These three started life in `allegro-sale-rules.ts` (#463), which is where the first order flow
 * needed them. None of them is Allegro's: which sets an ordered line stands for, what day a sale is
 * dated and how a buyer is filed are rules about *this* app's sale, and the marketplace only
 * supplies the numbers. #612 records a Delcampe order from the seller's own screens and asks all
 * three of the same questions, so they moved here rather than being answered a second way — two
 * modules deciding which copy sold is exactly how two flows come to disagree about it.
 *
 * What stayed behind is genuinely Allegro's: `matchShippingMethod` reads a delivery method off an
 * Allegro order, and a Delcampe sold row states none.
 *
 * The register is #355's throughout: **a wrong composition is worse than none.** Every rule below
 * either states something the order says outright, or refuses and leaves it to the collector.
 */

/** One sellable set of the offer a line matched, narrowed to what the mapping needs. */
export interface MappableSet {
  offerSetId: string;
  label: string;
  itemIds: string[];
}

/** Why a line contributes nothing to the sale, in the collector's terms. */
export type LineSkipReason =
  /** No offer in this collection carries that marketplace listing. */
  | "unmatched"
  /** The matched offer has no set left to sell — it has already gone, here or elsewhere. */
  | "sold-out"
  /** Already on the sale that claims this order (the partially recorded case). */
  | "recorded"
  /** Matched, sellable, but what sold cannot be said without guessing. */
  | "ambiguous";

export interface LineMapping {
  sets: MappableSet[];
  skipped: LineSkipReason | null;
}

/**
 * Which sets of the matched offer this ordered line stands for.
 *
 * Confident in exactly one case: the quantity bought equals the number of sets the offer still has
 * to sell, so there is nothing left to choose. That covers the ordinary listing — one set, one
 * bought — and the quantity listing sold out in one order, and it refuses everything in between: an
 * offer with three sets left and one bought says *that* one sold, not which, and picking the first
 * would record copies as gone that are still in the collection.
 *
 * A refusal is not a dead end. The line is shown as needing the collector, who records it through
 * the offer's own sell flow, which is what that flow is for.
 */
export function mapLineToSets(quantity: number, sets: readonly MappableSet[]): LineMapping {
  if (sets.length === 0) return { sets: [], skipped: "sold-out" };
  if (quantity === sets.length) return { sets: [...sets], skipped: null };
  return { sets: [], skipped: "ambiguous" };
}

/**
 * The date the sale is recorded under: the day the order was bought, in the instance's own timezone,
 * as the date input takes it.
 *
 * `Sale.soldAt` is a `@db.Date` and the sale's FX freeze hangs off it, so the moment matters only as
 * far as which day it fell on — and the day that means something to the collector is the one their
 * own clock showed, not UTC's.
 */
export function saleDateOf(boughtAt: Date): string {
  const year = boughtAt.getFullYear();
  const month = `${boughtAt.getMonth() + 1}`.padStart(2, "0");
  const day = `${boughtAt.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A buyer as a `Contact` would hold them: the name they are filed under, and the name on the
 *  paperwork where that is a different thing. */
export interface BuyerIdentity {
  /** `Contact.name` — the identity, and what every picker searches. */
  name: string | null;
  /** `Contact.fullName` — the name the parcel carries. Null when it *is* the name above. */
  fullName: string | null;
}

/**
 * Who the buyer is, split the way a contact holds it.
 *
 * The **login leads**. A marketplace buyer is known by their login: it is what the collector
 * recognises them by across a dozen orders, what a message to them is addressed to, and — decisively
 * — how the buyers already in the address book are named. Filing them under the legal name would
 * miss the contact that is already there and quietly create a second one for the same person, every
 * time.
 *
 * The order's own name is not thrown away for that: it goes to `fullName`, which is the name that
 * has to appear on the parcel and the one place a login cannot stand in. Where the order states only
 * a name, that name *is* the identity and there is nothing to keep beside it.
 *
 * Both null where the order states neither, which leaves the sale anonymous rather than inventing a
 * buyer.
 */
export function buyerIdentityFor(order: {
  buyerName: string | null;
  buyerLogin: string | null;
}): BuyerIdentity {
  const login = order.buyerLogin?.trim() || null;
  const stated = order.buyerName?.trim() || null;
  if (!login) return { name: stated, fullName: null };
  // A login that *is* the stated name leaves nothing to record twice.
  return { name: login, fullName: stated && stated !== login ? stated : null };
}
