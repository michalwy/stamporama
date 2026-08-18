// Turning one **My Sold Items** order into a `Sale` (#612) — pure, no Prisma and no `server-only`,
// so every judgement the import makes can be asserted against what a page printed.
//
// This is the third Delcampe reader and the only one that reads a *page*. `delcampe-export-rules.ts`
// writes an upload, `delcampe-import-rules.ts` reads an export, and both are files whose columns are
// a contract. Here the contract is Delcampe's own seller screens, so the division of labour matters
// more than usual: **the Assistant reports what the row printed and this module decides what it
// means** (#409). The extension sends `"US$3.00"` and `"Sun 22 Mar 2026 at 22:25"` verbatim; which
// currency that is, what day that was, and whether the order can be recorded at all are answered
// here, where they are unit-tested beside the rest of Delcampe's rules rather than inside a content
// script running on somebody else's page.
//
// The order is **all lines or nothing**. Nothing is reviewed between the click on Delcampe and the
// write here — the collector pressed *Import* on a row, not on a form — so a sale created without a
// line it should have carried understates the proceeds while looking exactly like a complete one.
// #610 refuses a whole batch for the same reason from the other direction. Every refusal names the
// item it is about, because the way through is the offer's own sell flow and then a re-import.
//
// What is deliberately **not** here:
//
//   * **Anything about the buyer beyond a login and a name.** Delcampe prints an address and serves
//     a relay e-mail; neither reaches this module, so neither can reach the database.
//   * **Delcampe's phases.** `sold-items/sent` says the parcel went; `Sale.status` is the
//     collector's own workflow with its own events (#492), and two systems claiming one field is how
//     they drift. An imported order starts where every sale starts.
//   * **A conversion.** The `±` on an order total is Delcampe converting into the display currency,
//     and an approximate figure is not something to anchor a sale's arithmetic on (#205).

import {
  buyerIdentityFor,
  mapLineToSets,
  type BuyerIdentity,
  type LineSkipReason,
  type MappableSet,
} from "./order-sale-rules";

// ---------------------------------------------------------------------------
// What the Assistant reports
// ---------------------------------------------------------------------------

/** One item row of an order, as the page printed it. Everything but the id is text: the row states
 *  it, this module reads it. */
export interface DelcampeOrderLineInput {
  /** Delcampe's own `id_auction`, off the row's own address — the same id #611 stored on
   *  `Offer.delcampeItemId`, which is what makes the match exact rather than a guess. */
  itemId: string;
  title: string;
  /** The `personal_reference` printed on the row, with Delcampe's own `Ref.` label already off it.
   *  After #610 this is the offer's own short URL; before it, whatever the collector typed. */
  reference: string | null;
  /** The row's own price, as printed — `"US$3.00"`. The **listing's** currency, which on a page
   *  whose display currency is another one is not the currency of the total below it. */
  priceText: string | null;
  /** The row's own date, as printed — `"Sun 22 Mar 2026 at 22:25"`. */
  soldAtText: string | null;
}

/** One order block, as the page printed it. */
export interface DelcampeOrderInput {
  /** Delcampe's order id, off `…/payment-request/<id>` — what `Sale.externalRef` carries, the same
   *  column #479 drops an Allegro order id into. */
  orderId: string;
  /** The order's own address on Delcampe, for `Sale.transactionUrl` (#292). */
  orderUrl: string;
  buyerLogin: string | null;
  buyerName: string | null;
  /**
   * Every amount printed in the order's own header, as printed and in the order they appear.
   *
   * Delcampe prints the total **twice**: `± €13.95` converted into the screen's display currency,
   * then `US$16.15` in the currency the listings were actually in. Both arrive because choosing
   * between them is a decision, and the one that can anchor a sale is the exact one in the sale's
   * own currency — see {@link planDelcampeOrderSale}.
   */
  totalTexts: string[];
  lines: DelcampeOrderLineInput[];
}

// ---------------------------------------------------------------------------
// Reading what the page printed
// ---------------------------------------------------------------------------

/**
 * The currency symbols Delcampe prints, and what they are.
 *
 * Short on purpose, and **a bare `$` is not in it**. Delcampe writes `US$` for a dollar price, so a
 * lone `$` is either a currency this list has not met or a template that changed — and answering
 * either with "probably dollars" is how a sale gets recorded in the wrong money. An unrecognised
 * symbol reads as *no* currency, which refuses the order and says so, and the collector records that
 * one by hand.
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
  ["€", "EUR"],
  ["£", "GBP"],
];

/** An amount the page printed, once read. */
export interface DelcampeAmount {
  /** Fixed to two decimals, as every amount in this app is stored. */
  amount: string;
  /** The ISO code the symbol named, or null when the symbol is not one this app recognises. */
  currency: string | null;
  /** True when Delcampe printed it as a conversion (`±`) — its own arithmetic into the display
   *  currency, and not a figure this app may anchor a sale on. */
  approximate: boolean;
}

/**
 * Read one printed amount.
 *
 * The number is read with the **last** separator as the decimal point, which is what makes
 * `1,234.56` and `1.234,56` the same figure without this module having to know which locale the
 * collector's Delcampe is set to. A separator followed by three digits and nothing else is a
 * thousands separator, since no price has three decimals.
 *
 * Null when there is no number at all. A number with no recognised symbol still comes back — with a
 * null currency — because "the page said 3.00 of something" and "the page said nothing" are
 * different faults and only the first is worth naming an item over.
 */
export function readDelcampeAmount(text: string | null | undefined): DelcampeAmount | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const approximate = raw.includes("±");
  let currency: string | null = null;
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (raw.includes(symbol)) {
      currency = code;
      break;
    }
  }

  // `\s` already covers the non-breaking space Delcampe prints between a symbol and its
  // figure, which is why the class needs nothing beyond it.
  const digits = raw.match(/\d[\d\s.,]*/);
  if (!digits) return null;
  // Trailing punctuation belongs to the sentence the price sits in rather than to the figure:
  // a `13.95.` read whole would take the full stop for a decimal point and answer 1395.
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
  return { amount: value.toFixed(2), currency, approximate };
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
 * The day an item row states it sold on, as `YYYY-MM-DD`.
 *
 * `Sale.soldAt` is a date and the sale's FX freeze hangs off it, so only the day matters — which is
 * why the time the row also prints is read past rather than parsed. The month is matched on its
 * first three letters against **English** names, because English is the language these screens are
 * read in here. Several other languages happen to fall out right (`mars`, `mayo`, `Januar`) and none
 * of them lands on a *different* month, but the ones that do not — French's `juin` and `juillet`
 * being the same three letters — read as **no date**, which refuses the order. Being unable to date
 * a sale is a refusal worth reading; dating it a month out is not something anyone would notice.
 *
 * Deliberately not `new Date(text)`: what that parses varies by engine, and a sale silently dated a
 * day out in the wrong direction is worse than one that would not import.
 */
export function readDelcampeRowDate(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const match = /(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/.exec(raw);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${`${month + 1}`.padStart(2, "0")}-${`${dayNumber}`.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Deciding whether the order can be recorded
// ---------------------------------------------------------------------------

/** What the instance found for one item of the order, handed to the planner already resolved. */
export interface DelcampeOrderCandidate {
  itemId: string;
  /** The offer this item is, or null when nothing here carries it. */
  offer: { id: string; offerNo: number; label: string } | null;
  /** How it was found. `item-id` is Delcampe's own id off `Offer.delcampeItemId` (#611); `reference`
   *  is the offer's short URL read back out of `personal_reference` (#610). Provenance is kept
   *  because a match nobody can account for is one nobody can correct. */
  matchedBy: "item-id" | "reference" | null;
  /** The sets of that offer still available to sell. Empty when the offer has none left. */
  sets: MappableSet[];
}

/** One reason this order was not recorded, in the collector's terms. `itemId` names the row it is
 *  about, or is null for something the order as a whole is missing. */
export interface DelcampeOrderProblem {
  itemId: string | null;
  message: string;
}

/** One sold set the import will write, exactly as `addSaleLines` takes it. */
export interface PlannedDelcampeSaleLine {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
}

export type DelcampeOrderPlan =
  | {
      ok: true;
      /** The sale's date: the **latest** day the order's own rows state. An order is placed over
       *  several clicks — Delcampe groups them into one bill — and it is complete on the last of
       *  them, not the first. */
      soldAt: string;
      currency: string;
      buyer: BuyerIdentity;
      /** #205's anchor, set only from a total the page stated exactly. Null otherwise, which leaves
       *  the sale's handling blank rather than derived from Delcampe's own conversion. */
      buyerPaidTotal: string | null;
      lines: PlannedDelcampeSaleLine[];
    }
  | { ok: false; problems: DelcampeOrderProblem[] };

/** Why a mapped line could not be recorded, worded for a chip on Delcampe's own page. */
function skipMessage(reason: LineSkipReason, offerNo: number): string {
  switch (reason) {
    case "sold-out":
      return `Offer #${offerNo} has no copies left to sell here — record this sale from the offer's own screen.`;
    case "ambiguous":
      return `Offer #${offerNo} still has several sets for sale, so which one went cannot be told from the order — record this sale from the offer's own screen.`;
    case "recorded":
      return `Offer #${offerNo} is already on a sale here.`;
    case "unmatched":
    default:
      return `Offer #${offerNo} could not be matched to what sold.`;
  }
}

/**
 * What recording this order would be — or every reason it cannot be recorded, at once.
 *
 * **Every reason at once**, as #610's refused batch reports every bad row rather than the first: the
 * collector is going to go and fix these, and finding the second one only after fixing the first is
 * two trips through the same screens.
 *
 * The sale's currency is the **platform's** (#196), like every other sale's, and a row whose printed
 * symbol names a different one refuses the order. That is not pedantry: the page prints an order's
 * total in the display currency and its items in the currency they were listed in, so the two
 * genuinely differ, and a figure copied across without its currency is a sale recorded in money it
 * was never paid in.
 */
export function planDelcampeOrderSale(
  order: DelcampeOrderInput,
  context: { currency: string; candidates: readonly DelcampeOrderCandidate[] }
): DelcampeOrderPlan {
  const problems: DelcampeOrderProblem[] = [];
  if (order.lines.length === 0) {
    return { ok: false, problems: [{ itemId: null, message: "This order lists no items." }] };
  }

  const byItemId = new Map(context.candidates.map((candidate) => [candidate.itemId, candidate]));
  const lines: PlannedDelcampeSaleLine[] = [];
  const days: string[] = [];
  let gross = 0;

  for (const line of order.lines) {
    const named = `Item ${line.itemId}`;
    const price = readDelcampeAmount(line.priceText);
    const day = readDelcampeRowDate(line.soldAtText);
    if (!day) {
      problems.push({ itemId: line.itemId, message: `${named}: the date on this row could not be read.` });
    } else {
      days.push(day);
    }
    if (!price) {
      problems.push({ itemId: line.itemId, message: `${named}: the price on this row could not be read.` });
    } else if (!price.currency) {
      problems.push({
        itemId: line.itemId,
        message: `${named}: ${line.priceText?.trim()} is in a currency this app does not recognise.`,
      });
    } else if (price.currency !== context.currency) {
      problems.push({
        itemId: line.itemId,
        message: `${named}: sold in ${price.currency}, but this platform's sales are in ${context.currency}.`,
      });
    } else if (Number(price.amount) <= 0) {
      // Delcampe prices a cancelled item at zero and zeroes the order with it. Whatever else it is,
      // it is not something to record as sold.
      problems.push({
        itemId: line.itemId,
        message: `${named}: Delcampe states no amount for this row — a cancelled item is not a sale.`,
      });
    }

    const candidate = byItemId.get(line.itemId);
    if (!candidate?.offer) {
      problems.push({
        itemId: line.itemId,
        message: `${named}: no offer here carries this Delcampe listing.`,
      });
      continue;
    }
    // One row is one item. A listing with several of the same thing sold twice in one order would
    // still print one row per copy — and if it did not, the mapping below refuses rather than
    // guesses, which is the outcome that costs nothing but a manual entry.
    const mapping = mapLineToSets(1, candidate.sets);
    if (mapping.skipped) {
      problems.push({
        itemId: line.itemId,
        message: `${named}: ${skipMessage(mapping.skipped, candidate.offer.offerNo)}`,
      });
      continue;
    }
    if (!price || price.currency !== context.currency || Number(price.amount) <= 0) continue;
    gross += Number(price.amount) * mapping.sets.length;
    for (const set of mapping.sets) {
      lines.push({
        offerId: candidate.offer.id,
        offerSetId: set.offerSetId,
        price: price.amount,
        itemIds: set.itemIds,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // Only from a total the page stated **exactly**, in the sale's own currency, and not below what
  // the rows add up to: `buyerPaidTotal` is the anchor handling is derived from (#205), so a figure
  // that is Delcampe's conversion, or somebody else's currency, or smaller than the goods, would
  // make the sale's postage a number nobody entered. The header carries two figures for one total
  // and neither is labelled, so the test *is* the choice: at most one of them can pass it.
  const buyerPaidTotal =
    order.totalTexts
      .map(readDelcampeAmount)
      .find(
        (total) =>
          total !== null &&
          !total.approximate &&
          total.currency === context.currency &&
          Number(total.amount) >= gross
      )?.amount ?? null;

  return {
    ok: true,
    soldAt: days.reduce((latest, day) => (day > latest ? day : latest), days[0]),
    currency: context.currency,
    buyer: buyerIdentityFor({ buyerLogin: order.buyerLogin, buyerName: order.buyerName }),
    buyerPaidTotal,
    lines,
  };
}

/** The refusals as one sentence, for a chip that has room for a line rather than a list. Ordered as
 *  the rows are, so it reads down the order the collector is looking at. */
export function describeDelcampeOrderProblems(problems: readonly DelcampeOrderProblem[]): string {
  return problems.map((problem) => problem.message).join(" ");
}
