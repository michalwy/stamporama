// Closing a Facebook post from the phone (#2631, ADR-0072 §5): once its auctions end, the collector
// ticks one winner's lots, sells them into one sale — a new one or that buyer's open one — each at its
// own price, and repeats it for the next winner; the lots left are ticked and withdrawn. The desk's
// post screen does the same with its ticks and *Sell…* (#2050); the phone does not read winners from
// Facebook, which the app does nowhere (decided in writing the issue).
//
// Pure, so the unit suite holds it.

import type { OfferState } from "./offer-rules";

/** The lot as the closing reads it. */
export interface PhoneClosingLot {
  offerId: string;
  lotNo: number;
  state: OfferState;
  /** What the lot sells at: its price — an auction's last recorded bid (#1545), a quick buy's price. */
  price: string;
  currency: string;
}

/**
 * Whether the lot can be ticked to be sold or withdrawn: a lot still up in its group. A lot sold or
 * withdrawn has dropped out; a lot of a post waiting for the group's approval is not one (withdrawing it
 * would take the whole post back, #1779), nor a lot before the post went up — that is the desk's.
 */
export function isPhoneClosingLot(lot: { state: OfferState }): boolean {
  return lot.state === "active" || lot.state === "paused";
}

/** The ticks still standing: a lot sold or withdrawn since it was ticked drops out of them. */
export function phoneClosingTicks(
  ticked: ReadonlySet<string>,
  lots: readonly { offerId: string; state: OfferState }[]
): string[] {
  return lots.filter((lot) => ticked.has(lot.offerId) && isPhoneClosingLot(lot)).map((lot) => lot.offerId);
}

/**
 * The ticked lots' total, in their currency, to two places — what the buyer pays for them before
 * postage. Null when the lots are in more than one currency, which one sale cannot take.
 */
export function phoneClosingTotal(lots: readonly Pick<PhoneClosingLot, "price" | "currency">[]): {
  amount: string;
  currency: string;
} | null {
  if (lots.length === 0) return null;
  const currency = lots[0].currency;
  if (lots.some((lot) => lot.currency !== currency)) return null;
  const cents = lots.reduce((sum, lot) => sum + Math.round(Number(lot.price) * 100), 0);
  return { amount: (cents / 100).toFixed(2), currency };
}

/** The lots named by number, in lot order: *lot 4*, *lots 1, 4 and 7*. */
export function phoneLotNumbersText(lotNos: readonly number[]): string {
  const sorted = [...lotNos].sort((a, b) => a - b);
  if (sorted.length === 1) return `lot ${sorted[0]}`;
  const head = sorted.slice(0, -1).join(", ");
  return `lots ${head} and ${sorted[sorted.length - 1]}`;
}

/** The toast after the phone's *Sell*: which lots went into which sale, and to whom — *Lots 1, 4 and 7
 *  sold in new sale #12 · Jan Kowalski* — and every ticked lot that could not be sold, with why. */
export function phoneLotsSoldMessage(input: {
  lotNos: readonly number[];
  created: boolean;
  saleNo: number;
  buyerName: string | null;
  skipped: readonly { lotNo: number; reason: string }[];
}): string {
  const what = phoneLotNumbersText(input.lotNos);
  const sold = `${what[0].toUpperCase()}${what.slice(1)} sold ${input.created ? "in new sale" : "into sale"} #${input.saleNo}${
    input.buyerName ? ` · ${input.buyerName}` : ""
  }`;
  const left = input.skipped.map((s) => ` Lot ${s.lotNo} ${s.reason} — not sold.`).join("");
  return `${sold}.${left}`;
}

/** The toast after the phone's *Withdraw*. */
export function phoneLotsWithdrawnMessage(lotNos: readonly number[]): string {
  const what = phoneLotNumbersText(lotNos);
  return `${what[0].toUpperCase()}${what.slice(1)} withdrawn`;
}
