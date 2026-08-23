// Turning one Colnect **transaction** into a `Sale` (#698; ADR-0041) — pure, no Prisma and no
// `server-only`, so every judgement the import makes can be asserted against what the page printed.
//
// The second half of the orders story ADR-0038 opened on Delcampe, and deliberately its shape rather
// than a second design: the Assistant reports what the transaction printed and this module decides
// what it means (#409), the order is **all lines or nothing**, and every reason it cannot be recorded
// is named at once, because the collector is about to go and fix them and finding the second only
// after fixing the first is two trips through the same screens.
//
// What Colnect states that Delcampe did not, and what changes here because of it:
//
//   * **A per-row item count.** Delcampe prints one row per copy; Colnect prints `Item count: 1`.
//     A count above one refuses **for now** (ADR-0041 §5): the fifteen prices of the observed
//     transaction sum exactly to `Items total`, which does not separate a row's unit price from its
//     line total, and `SaleLine.price` is per set — so the two readings write different money.
//   * **A transaction-wide date.** `Started: August 23, 2026 2:21 PM`, one for the whole order, so
//     ADR-0038's latest-of-the-rows rule is not needed and is not repeated.
//   * **Labelled totals.** Four of them, meaning four things, so the anchor is chosen by the words
//     beside the figure rather than by arithmetic: `Total with shipping` is what the buyer paid and
//     `Items total` is not.
//   * **A shipping method.** Colnect names one; a Delcampe sold row named none. So it is read, as
//     printed, which is the one place ADR-0038 §6 is departed from.
//   * **No seller reference.** Colnect prints none on a transaction row, so a row finds its offer
//     exactly one way — `Offer.colnectSaleId` (#696) — where Delcampe had two.
//   * **A multi-quantity offer is picked, not guessed** (#697). A matched offer with more sets left
//     than the row bought is not a refusal here: the sale takes the lowest-`sortOrder` sets and the
//     line is flagged for the seller's own choice, because which identical copy leaves is a decision
//     made at the packing table and not a fact about the order.
//
// What is deliberately **not** here, exactly as on Delcampe: anything about the buyer beyond a login
// and a name (the page prints their full postal address, which is never read and therefore can never
// be stored), Colnect's own phase ladder (`Sale.status` is the collector's workflow, #191/#492), and
// any figure the page did not state outright.

import {
  buyerIdentityFor,
  type BuyerIdentity,
  type MappableSet,
} from "./order-sale-rules";

// ---------------------------------------------------------------------------
// What the Assistant reports
// ---------------------------------------------------------------------------

/** One listing row of a transaction, as the page printed it. */
export interface ColnectOrderLineInput {
  /** Colnect's own opaque sale code, off the row's address (`/<locale>/market/sale/<code>`) — the
   *  value #696 stores on `Offer.colnectSaleId`, and the only join a transaction row offers. */
  saleCode: string;
  title: string;
  /** The row's own price, as printed — `"€ 0.46"`. In the **viewer's display currency**, which is
   *  why a symbol naming anything but the platform's currency refuses the order. */
  priceText: string | null;
  /** How many of that listing the row is for, as printed — `"Item count: 1"`, label and all. */
  quantityText: string | null;
}

/** One transaction, as the page printed it. */
export interface ColnectOrderInput {
  /** Colnect's transaction id, off `…/transaction/show/id/<id>` — what `Sale.externalRef` carries,
   *  the same column an Allegro order number (#479) and a Delcampe order id (#612) go into. */
  orderId: string;
  /** The transaction's own address, for `Sale.transactionUrl` (#292). */
  orderUrl: string;
  buyerLogin: string | null;
  buyerName: string | null;
  /** The transaction's own start, as printed — `"August 23, 2026 2:21 PM"`. */
  soldAtText: string | null;
  /** The delivery method as printed, with Colnect's own label already off it —
   *  `"Stamps→domestic: Registered mail (Poczta Polska)"`. */
  shippingMethodText: string | null;
  /** The header's figures, each with the words that say what it is — `"Total with shipping € 12.00"`.
   *  Labelled because four figures that differ only in meaning cannot be told apart by their size. */
  totalTexts: string[];
  lines: ColnectOrderLineInput[];
}

// ---------------------------------------------------------------------------
// Reading what the page printed
// ---------------------------------------------------------------------------

/**
 * The currency symbols Colnect's transaction screens print, and what they are.
 *
 * Short, and **a bare `$` is not in it**, which is ADR-0038 §5's rule kept rather than re-argued: a
 * lone `$` is a currency this list has not met or a template that changed, and answering either with
 * "probably dollars" is how a sale is recorded in the wrong money. An unrecognised symbol reads as
 * *no* currency, refuses the transaction and says so, and that one is recorded by hand until a real
 * transaction says what Colnect actually prints for it.
 *
 * Longest first when matching: `US$` must win over `$` if `$` is ever added.
 */
const CURRENCY_SYMBOLS: readonly (readonly [string, string])[] = [
  ["US$", "USD"],
  ["CA$", "CAD"],
  ["AU$", "AUD"],
  ["C$", "CAD"],
  ["A$", "AUD"],
  ["CHF", "CHF"],
  ["PLN", "PLN"],
  ["zł", "PLN"],
  ["€", "EUR"],
  ["£", "GBP"],
];

/** An amount the page printed, once read. */
export interface ColnectAmount {
  /** Fixed to two decimals, as every amount in this app is stored. Negative where the page printed a
   *  deduction — `Discount -€ 0.37` — because a figure's sign is part of what it says. */
  amount: string;
  /** The ISO code the symbol named, or null when the symbol is not one this app recognises. */
  currency: string | null;
}

/**
 * Read one printed amount.
 *
 * The number is read with the **last** separator as the decimal point, which makes `1,234.56` and
 * `1.234,56` the same figure without this module knowing which locale Colnect served. A separator
 * followed by three digits and nothing else is a thousands separator, since no price has three
 * decimals. Delcampe's reader answers the same way for the same reasons; the two are separate
 * because the pages state different things around the figure, not because the figures differ.
 *
 * Null when there is no number at all. A number with no recognised symbol still comes back — with a
 * null currency — because "the page said 9.97 of something" and "the page said nothing" are
 * different faults and only the first is worth naming a row over.
 */
export function readColnectAmount(text: string | null | undefined): ColnectAmount | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  let currency: string | null = null;
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (raw.includes(symbol)) {
      currency = code;
      break;
    }
  }

  const digits = raw.match(/\d[\d\s.,]*/);
  if (!digits) return null;
  // A minus **anywhere before the figure**, because Colnect prints it in front of the symbol
  // (`-€ 0.37`) and other screens print it after. Trailing punctuation belongs to the sentence the
  // figure sits in rather than to the figure: `€ 12.00.` read whole would take the full stop for a
  // decimal point.
  const negative = /[-−]/.test(raw.slice(0, raw.indexOf(digits[0])));
  const number = digits[0].replace(/\s/g, "").replace(/[.,]+$/, "");
  const lastSeparator = Math.max(number.lastIndexOf(","), number.lastIndexOf("."));
  let normalized: string;
  if (lastSeparator < 0) {
    normalized = number;
  } else {
    const fraction = number.slice(lastSeparator + 1);
    normalized =
      fraction.length === 3
        ? number.replace(/[.,]/g, "")
        : `${number.slice(0, lastSeparator).replace(/[.,]/g, "")}.${fraction}`;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return { amount: (negative ? -value : value).toFixed(2), currency };
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * The day the transaction states it started on, as `YYYY-MM-DD`.
 *
 * `Sale.soldAt` is a date and the sale's FX freeze hangs off it, so only the day matters — which is
 * why the time Colnect also prints is read past rather than parsed. The month is matched on its
 * first three letters against **English** names, because English is the language these screens are
 * read in here: a month name this app cannot read is no date, and refuses the transaction rather
 * than dating a sale by guesswork.
 *
 * Deliberately not `new Date(text)`: what that parses varies by engine, and a sale silently dated a
 * day out is worse than one that would not import.
 */
export function readColnectOrderDate(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  // `August 23, 2026 2:21 PM` — the month leads on Colnect, where Delcampe led with the day.
  const match = /([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(raw);
  if (!match) return null;
  const [, monthName, day, year] = match;
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${`${month + 1}`.padStart(2, "0")}-${`${dayNumber}`.padStart(2, "0")}`;
}

/**
 * How many of the listing a row is for, off the printed `Item count: 1`.
 *
 * Null when the row states nothing this reads as a count — which **refuses** the transaction rather
 * than assuming one, because how many copies left is the whole question a sale line answers.
 */
export function readColnectItemCount(text: string | null | undefined): number | null {
  const match = /(\d+)/.exec((text ?? "").trim());
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count > 0 ? count : null;
}

/**
 * The figure printed under one of the header's labels — `Total with shipping` — or null when the
 * header states no such line.
 *
 * By its **words**, not by its size: Colnect's header carries `Items total`, `Shipping price`,
 * `Discount` and `Total with shipping`, and on a transaction with no postage the first and the last
 * are the same number. Picking by arithmetic would be picking the meaning by accident.
 */
export function readColnectTotal(
  totalTexts: readonly string[],
  label: string
): ColnectAmount | null {
  const wanted = label.trim().toLowerCase();
  const line = totalTexts.find((text) => text.trim().toLowerCase().startsWith(wanted));
  return line ? readColnectAmount(line) : null;
}

/** What the header calls the figure the buyer actually paid — the only one #205's anchor may come
 *  from. `Items total` is the goods alone, and a sale anchored on it would report the postage the
 *  buyer paid as money nobody received. */
export const BUYER_PAID_LABEL = "Total with shipping";

// ---------------------------------------------------------------------------
// Deciding whether the transaction can be recorded
// ---------------------------------------------------------------------------

/** What the instance found for one row of the transaction, handed to the planner already resolved. */
export interface ColnectOrderCandidate {
  saleCode: string;
  /** The offer this listing is, or null when nothing here carries that sale code. */
  offer: { id: string; offerNo: number; label: string } | null;
  /** The sets of that offer still available to sell, **in the offer's own order** (`sortOrder`) —
   *  which is what makes the pick below the lowest one rather than an arbitrary one. */
  sets: MappableSet[];
}

/** One reason this transaction was not recorded, in the collector's terms. `saleCode` names the row
 *  it is about, or is null for something the transaction as a whole is missing. */
export interface ColnectOrderProblem {
  saleCode: string | null;
  message: string;
}

/** One sold set the import will write, exactly as `addSaleLines` takes it. */
export interface PlannedColnectSaleLine {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
  /** True where the set was **picked rather than chosen** (#697): the offer had more sets left than
   *  the row bought, so which identical copy goes is still the seller's own call. */
  setChoicePending: boolean;
}

export type ColnectOrderPlan =
  | {
      ok: true;
      /** The transaction's own day — Colnect states one for the whole order. */
      soldAt: string;
      currency: string;
      buyer: BuyerIdentity;
      /** #205's anchor, from `Total with shipping` alone and only when it is stated exactly, in the
       *  sale's currency, and not below what the rows add up to. Null otherwise, which leaves the
       *  sale's handling blank rather than derived from a figure that means something else. */
      buyerPaidTotal: string | null;
      /** The delivery method as Colnect printed it (#468), or null where it printed none. Matching
       *  it against the platform's own dictionary is the caller's job — the FK is a convenience and
       *  the printed name is the record. */
      shippingMethodName: string | null;
      lines: PlannedColnectSaleLine[];
    }
  | { ok: false; problems: ColnectOrderProblem[] };

/** Which sets of the matched offer one row stands for, and whether anybody has chosen them.
 *
 * Three outcomes rather than `mapLineToSets`'s two, and the third is the whole of #697: an offer with
 * three sets left and one bought is **not** ambiguous the way a Delcampe row is, because the sets of
 * one offer are the same thing at the same price — that is why they are one listing. So the sale
 * records the lowest-`sortOrder` ones and says out loud that nobody has picked yet, which is the
 * truthful record of a choice the seller makes at the packing table. Quantity **greater** than the
 * sets left is still a refusal: that is the order disagreeing with the inventory, and no pick fixes
 * it. */
export function chooseColnectSets(
  quantity: number,
  sets: readonly MappableSet[]
): { sets: MappableSet[]; setChoicePending: boolean; skipped: "sold-out" | "short" | null } {
  if (sets.length === 0) return { sets: [], setChoicePending: false, skipped: "sold-out" };
  if (quantity > sets.length) return { sets: [], setChoicePending: false, skipped: "short" };
  if (quantity === sets.length) return { sets: [...sets], setChoicePending: false, skipped: null };
  return { sets: sets.slice(0, quantity), setChoicePending: true, skipped: null };
}

/**
 * What recording this transaction would be — or every reason it cannot be recorded, at once.
 *
 * The sale's currency is the **platform's** (#196), like every other sale's, and a figure whose
 * printed symbol names a different one refuses the transaction. That is not pedantry here: Colnect
 * renders every amount in the **viewer's** own display currency, which is a seller-level setting
 * (#402) rather than a fact about the sale, so a page read in the wrong display currency states real
 * numbers in money nobody was paid.
 */
export function planColnectOrderSale(
  order: ColnectOrderInput,
  context: { currency: string; candidates: readonly ColnectOrderCandidate[] }
): ColnectOrderPlan {
  const problems: ColnectOrderProblem[] = [];
  if (order.lines.length === 0) {
    return { ok: false, problems: [{ saleCode: null, message: "This transaction lists no items." }] };
  }

  const soldAt = readColnectOrderDate(order.soldAtText);
  if (!soldAt) {
    problems.push({
      saleCode: null,
      message: "The date this transaction started could not be read.",
    });
  }

  const byCode = new Map(context.candidates.map((candidate) => [candidate.saleCode, candidate]));
  const lines: PlannedColnectSaleLine[] = [];
  let gross = 0;

  for (const line of order.lines) {
    const named = `Listing ${line.saleCode}`;
    const price = readColnectAmount(line.priceText);
    const quantity = readColnectItemCount(line.quantityText);
    /** The row's price once it has passed every test — null while any of them is what stopped it. */
    let paid: string | null = null;

    if (!price) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: the price on this row could not be read.`,
      });
    } else if (!price.currency) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: ${line.priceText?.trim()} is in a currency this app does not recognise.`,
      });
    } else if (price.currency !== context.currency) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: priced in ${price.currency}, but this platform's sales are in ${context.currency}. Set Colnect's display currency to ${context.currency} and open the transaction again.`,
      });
    } else if (Number(price.amount) <= 0) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: Colnect states no amount for this row — a row with nothing to pay is not a sale.`,
      });
    } else {
      paid = price.amount;
    }

    if (quantity === null) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: the item count on this row could not be read.`,
      });
    } else if (quantity > 1) {
      // ADR-0041 §5, an open question answered conservatively: the observed transaction's rows are
      // all `Item count: 1` and their prices sum exactly to `Items total`, which leaves "the row's
      // unit price" and "the row's line total" indistinguishable. `SaleLine.price` is per set, so
      // the two readings write different money. Lift this once a real multi-item row says which.
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: ${quantity} of this listing sold in one row, and this app cannot yet tell whether Colnect's figure is the price of one or of all — record this sale from the offer's own screen.`,
      });
    }

    const candidate = byCode.get(line.saleCode);
    if (!candidate?.offer) {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: no offer here carries this Colnect listing. Open the offer, put its Colnect address on it, and try again.`,
      });
      continue;
    }
    const choice = chooseColnectSets(quantity ?? 1, candidate.sets);
    if (choice.skipped === "sold-out") {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: offer #${candidate.offer.offerNo} has no copies left to sell here — record this sale from the offer's own screen.`,
      });
      continue;
    }
    if (choice.skipped === "short") {
      problems.push({
        saleCode: line.saleCode,
        message: `${named}: ${quantity} sold, but offer #${candidate.offer.offerNo} has only ${candidate.sets.length} left here.`,
      });
      continue;
    }
    if (paid === null || quantity === null || quantity > 1) continue;

    gross += Number(paid) * choice.sets.length;
    for (const set of choice.sets) {
      lines.push({
        offerId: candidate.offer.id,
        offerSetId: set.offerSetId,
        price: paid,
        itemIds: set.itemIds,
        setChoicePending: choice.setChoicePending,
      });
    }
  }

  // `soldAt` is tested again here rather than trusted from above: it is the one refusal that is not
  // about a row, and narrowing it is what lets the plan state a date instead of asserting one.
  if (problems.length > 0 || soldAt === null) return { ok: false, problems };

  // From `Total with shipping` alone, and only when it is stated exactly, in the sale's own currency
  // and not below what the rows add up to: `buyerPaidTotal` is the anchor handling is derived from
  // (#205), so a figure in somebody else's currency, or smaller than the goods, would make the
  // sale's postage a number nobody entered. The `Discount` line needs no arithmetic here — it is
  // already inside what the buyer actually paid, which is exactly the figure this takes.
  const stated = readColnectTotal(order.totalTexts, BUYER_PAID_LABEL);
  const buyerPaidTotal =
    stated && stated.currency === context.currency && Number(stated.amount) >= gross
      ? stated.amount
      : null;

  return {
    ok: true,
    soldAt,
    currency: context.currency,
    buyer: buyerIdentityFor({ buyerLogin: order.buyerLogin, buyerName: order.buyerName }),
    buyerPaidTotal,
    shippingMethodName: order.shippingMethodText?.trim() || null,
    lines,
  };
}

/** The refusals as one sentence, for a mark that has room for a line rather than a list. Ordered as
 *  the rows are, so it reads down the transaction the collector is looking at. */
export function describeColnectOrderProblems(problems: readonly ColnectOrderProblem[]): string {
  return problems.map((problem) => problem.message).join(" ");
}
