import { formatEntityNo } from "./quick-jump";
import { isSaleSent } from "./sale-status";
import type { StoredSaleApiReview } from "./sale-review";

/**
 * Merging one sale into another (#2041) — the pure half: which two sales can be merged, and what
 * the merged sale's amounts are.
 *
 * Two sales become one when they were made by mistake for the same buyer, or when one buyer bid
 * from two accounts and asked for everything to go together. One sale **remains** — its buyer, date,
 * order number, transaction link, shipping option and status — and the other is deleted once every
 * sold set and packing supply has moved to it. The collector chooses, for each amount, whether the
 * merged sale takes the remaining sale's, the other's, or their sum (settled 2026-10-18).
 *
 * Amounts travel as 2-dp strings (or null for *not recorded*), the form every read model gives them,
 * and are summed in cents so no float creeps into a stored figure.
 */

/** Whose figure the merged sale takes for one amount. */
export type SaleMergePick = "remaining" | "other" | "sum";

export const SALE_MERGE_PICKS: readonly SaleMergePick[] = ["remaining", "other", "sum"];

export function isSaleMergePick(value: unknown): value is SaleMergePick {
  return typeof value === "string" && (SALE_MERGE_PICKS as readonly string[]).includes(value);
}

/** The three amounts the merge dialog asks about. */
export interface SaleMergeChoices {
  /** Buyer handling, or the total the buyer paid where that is the sale's anchor (#205). */
  buyer: SaleMergePick;
  commission: SaleMergePick;
  /** The postage (`shippingCost`), with its currency and frozen rate (#206). */
  postage: SaleMergePick;
}

/** One sale as the merge reads it. */
export interface SaleMergeSide {
  saleNo: number;
  platformId: string;
  currency: string;
  status: string;
  /** The sum of its line prices. */
  gross: string;
  buyerHandling: string | null;
  buyerPaidTotal: string | null;
  commission: string | null;
  shippingCost: string | null;
  shippingCurrency: string | null;
  shippingFxRateToBase: string | null;
}

/** The stored amounts of the merged sale — what the remaining sale's row is written with. */
export interface MergedSaleAmounts {
  buyerHandling: string | null;
  buyerPaidTotal: string | null;
  commission: string | null;
  shippingCost: string | null;
  shippingCurrency: string | null;
  shippingFxRateToBase: string | null;
}

const cents = (v: string): number => Math.round(Number(v) * 100);
const fromCents = (c: number): string => (c / 100).toFixed(2);
const sumOf = (...values: (string | null)[]): string | null => {
  const present = values.filter((v): v is string => v != null);
  return present.length === 0 ? null : fromCents(present.reduce((s, v) => s + cents(v), 0));
};

/**
 * Why sale `b` cannot be merged with sale `a`, or null when it can: **the same platform, the same
 * currency, and neither sent yet** — a sale already *Sent* or *Delivered* is a parcel gone, and two
 * of those are two parcels, not one. Every line of a sale is in its currency and on its platform, so
 * the two are what keeps the moved lines true.
 */
export function saleMergeRefusal(
  a: Pick<SaleMergeSide, "saleNo" | "platformId" | "currency" | "status">,
  b: Pick<SaleMergeSide, "saleNo" | "platformId" | "currency" | "status">
): string | null {
  if (a.saleNo === b.saleNo) return "A sale cannot be merged with itself.";
  if (a.platformId !== b.platformId) return "Only sales on the same platform can be merged.";
  if (a.currency !== b.currency) return "Only sales in the same currency can be merged.";
  for (const side of [a, b]) {
    if (isSaleSent(side.status)) {
      return `Sale ${formatEntityNo(side.saleNo)} has already been sent — a sent sale cannot be merged.`;
    }
  }
  return null;
}

/**
 * Why the two postages cannot be summed, or null when they can. Postage is paid in a currency of its
 * own (#206), and two amounts in two currencies have no sum to store — the merged sale takes one of
 * them instead. A sale with no postage recorded sums with anything.
 */
export function postageSumRefusal(
  a: Pick<SaleMergeSide, "shippingCost" | "shippingCurrency">,
  b: Pick<SaleMergeSide, "shippingCost" | "shippingCurrency">
): string | null {
  if (a.shippingCost == null || b.shippingCost == null) return null;
  if (a.shippingCurrency === b.shippingCurrency) return null;
  return `The postages are in ${a.shippingCurrency} and ${b.shippingCurrency} — take one of them.`;
}

/** What the buyer paid on one sale: the total where that is the anchor, else gross + handling. */
function buyerPaid(side: SaleMergeSide): string {
  return side.buyerPaidTotal ?? fromCents(cents(side.gross) + cents(side.buyerHandling ?? "0"));
}

/**
 * The merged sale's stored amounts, one choice per amount.
 *
 * - **Buyer side.** Taking one sale's takes its anchor as it stands — a handling stays a handling and
 *   a total paid stays a total, so *the first sale's total* is a buyer who paid once for everything.
 *   The sum adds handlings while neither sale is anchored on a total; once either is, it is the sum of
 *   what each buyer paid (a handling-anchored sale paying its gross plus its handling), stored as the
 *   total. Neither sale recorded → nothing recorded.
 * - **Commission** — one or the other, or the sum of those recorded.
 * - **Postage** — one sale's cost with its currency and the rate frozen for it, or the sum in their
 *   shared currency at the remaining sale's rate. Throws when the sum is asked of two currencies:
 *   {@link postageSumRefusal} is the check to run first.
 */
export function mergedSaleAmounts(
  remaining: SaleMergeSide,
  other: SaleMergeSide,
  choices: SaleMergeChoices
): MergedSaleAmounts {
  const pick = (choice: SaleMergePick) => (choice === "other" ? other : remaining);

  let buyerHandling: string | null;
  let buyerPaidTotal: string | null;
  if (choices.buyer !== "sum") {
    const side = pick(choices.buyer);
    buyerHandling = side.buyerPaidTotal == null ? side.buyerHandling : null;
    buyerPaidTotal = side.buyerPaidTotal;
  } else if (remaining.buyerPaidTotal == null && other.buyerPaidTotal == null) {
    buyerHandling = sumOf(remaining.buyerHandling, other.buyerHandling);
    buyerPaidTotal = null;
  } else {
    buyerHandling = null;
    buyerPaidTotal = sumOf(buyerPaid(remaining), buyerPaid(other));
  }

  const commission =
    choices.commission === "sum"
      ? sumOf(remaining.commission, other.commission)
      : pick(choices.commission).commission;

  let postage: Pick<MergedSaleAmounts, "shippingCost" | "shippingCurrency" | "shippingFxRateToBase">;
  if (choices.postage !== "sum") {
    const side = pick(choices.postage);
    postage = {
      shippingCost: side.shippingCost,
      shippingCurrency: side.shippingCost == null ? null : side.shippingCurrency,
      shippingFxRateToBase: side.shippingCost == null ? null : side.shippingFxRateToBase,
    };
  } else {
    const refusal = postageSumRefusal(remaining, other);
    if (refusal) throw new Error(refusal);
    // One recorded: it is the sum, with its own currency and rate. Both: one currency, and the
    // remaining sale's rate — the sale whose date the merged one keeps.
    const anchor = remaining.shippingCost != null ? remaining : other;
    const cost = sumOf(remaining.shippingCost, other.shippingCost);
    postage = {
      shippingCost: cost,
      shippingCurrency: cost == null ? null : anchor.shippingCurrency,
      shippingFxRateToBase:
        cost == null ? null : (anchor.shippingFxRateToBase ?? remaining.shippingFxRateToBase ?? other.shippingFxRateToBase),
    };
  }

  return { buyerHandling, buyerPaidTotal, commission, ...postage };
}

/** The merged sale as the dialog previews it, before anything changes. */
export interface MergedSalePreview extends MergedSaleAmounts {
  /** Both sales' line prices together. */
  gross: string;
  /** The handling the merged sale works with — the stored one, or derived from the total (#205). */
  effectiveHandling: string;
  /** The total paid is below the merged sale's gross — the sale screen's own warning. */
  totalBelowGross: boolean;
  /** What the buyer pays in all: gross plus handling. */
  buyerTotal: string;
}

/** {@link mergedSaleAmounts} with the figures the dialog shows beside them. */
export function mergedSalePreview(
  remaining: SaleMergeSide,
  other: SaleMergeSide,
  choices: SaleMergeChoices
): MergedSalePreview {
  const amounts = mergedSaleAmounts(remaining, other, choices);
  const grossCents = cents(remaining.gross) + cents(other.gross);
  let handlingCents: number;
  let totalBelowGross = false;
  if (amounts.buyerPaidTotal != null) {
    const derived = cents(amounts.buyerPaidTotal) - grossCents;
    handlingCents = Math.max(0, derived);
    totalBelowGross = derived < 0;
  } else {
    handlingCents = cents(amounts.buyerHandling ?? "0");
  }
  return {
    ...amounts,
    gross: fromCents(grossCents),
    effectiveHandling: fromCents(handlingCents),
    totalBelowGross,
    buyerTotal: fromCents(grossCents + handlingCents),
  };
}

/**
 * The remaining sale's *to review* marker (#1948) after the merge. A sale the agent API wrote and the
 * collector has not confirmed **makes the merged sale *to review* too** — what it wrote is now on the
 * merged sale, and merging is not reviewing it (settled for #2041). Its actions follow, after a line
 * naming the merge, so the hint still says what the agent did; *recorded* stays the remaining sale's
 * own, since the agent did not record the sale that remains.
 *
 * Nothing here clears a marker: an unmarked other sale leaves the remaining one as it was.
 */
export function mergedSaleApiReview(
  remaining: StoredSaleApiReview,
  other: StoredSaleApiReview & { saleNo: number }
): StoredSaleApiReview {
  if (other.apiReviewAt === null) {
    return {
      apiReviewAt: remaining.apiReviewAt,
      apiReviewCreated: remaining.apiReviewCreated,
      apiReviewActions: [...remaining.apiReviewActions],
    };
  }
  const marked = remaining.apiReviewAt !== null;
  const actions = marked ? [...remaining.apiReviewActions] : [];
  const merged = other.apiReviewCreated
    ? `merged in sale ${formatEntityNo(other.saleNo)}, recorded through the agent API`
    : `merged in sale ${formatEntityNo(other.saleNo)}`;
  for (const action of [merged, ...other.apiReviewActions]) {
    if (!actions.includes(action)) actions.push(action);
  }
  const at =
    marked && remaining.apiReviewAt!.getTime() > other.apiReviewAt.getTime()
      ? remaining.apiReviewAt!
      : other.apiReviewAt;
  return {
    apiReviewAt: at,
    apiReviewCreated: marked && remaining.apiReviewCreated,
    apiReviewActions: actions,
  };
}
