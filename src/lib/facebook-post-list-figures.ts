// **A post's dates and figures on the list of posts** (#2502): when the post was made, submitted, put
// up and when it ends or ended — by its stage — and what it holds, asks, is worth, cost and has sold.
// Pure — no Prisma import — so the rules below are unit-tested on their own; `facebook-posts.ts` reads
// the lots and their figures and hands them here.
//
// **A date that was never recorded is left out, never guessed.** Each is read off what the lots
// already record — nothing new is stored:
// - *created* is the post's own `createdAt`;
// - *submitted* is when its pending lots entered Pending — `Offer.stateChangedAt` (#1811), which every
//   change of state stamps. Offers older than that column carry an estimate there, so a stamp from
//   before the column existed is not a submission date and is left out
//   ({@link STATE_CHANGED_RECORDED_FROM});
// - *up since* is the earliest lot's listing date, which the approval or the activation stamps (#320);
// - *auctions end* is the auction lots' `endsAt`, one time where they share it, else the earliest and
//   the latest;
// - *ended* is when the last lot closed: an auction at its end (or earlier, where it was withdrawn
//   before), anything else at `closedAt` (#512).
// Where some lot lacks the date the post's figure is taken from, the figure is left out — the
// earliest or latest of the others could be the wrong one.
//
// **Money is in the base currency**, converted at the current rate as the offers list converts an
// asking price (#208). **Nothing missing reads as 0** (#1184): a lot with no price is counted as
// unpriced and left out of the asking total, a lot without a catalogue value or a cost out of that
// total, each figure saying over how many lots it was taken. **Sold** counts the lots that are in a
// recorded sale — a cancelled sale's lines are gone (#2500) — and what those lines brought.

import type { FacebookPostStage } from "./facebook-post-rules";

/** When `Offer.stateChangedAt` began to be stamped (#1811, migration `20261011220000`). A stamp at
 *  or before it is the migration's estimate, not a recorded change of state. */
export const STATE_CHANGED_RECORDED_FROM = new Date("2026-10-11T22:00:00.000Z");

/** One lot as the dates are read off it. */
export interface PostListLotDates {
  state: string;
  auction: boolean;
  /** The day the lot went up (`@db.Date`), or null. */
  listingDate: Date | null;
  stateChangedAt: Date;
  closedAt: Date | null;
  endsAt: Date | null;
}

/** The dates the list shows beside a post's stage chip. Instants are ISO strings for the browser to
 *  put in the collector's zone (#490); `upSince` is a calendar day, `YYYY-MM-DD`. Each is null where
 *  the stage does not show it or it was never recorded. */
export interface FacebookPostListDates {
  createdAt: string;
  submittedAt: string | null;
  upSince: string | null;
  /** The auctions' end — one time when they share it, then `endsFrom === endsTo`. */
  endsFrom: string | null;
  endsTo: string | null;
  endedAt: string | null;
}

const OPEN_STATES = new Set(["pending", "active", "paused"]);

function isPosted(state: string): boolean {
  return state !== "preparing" && state !== "ready";
}

/** The earliest (or latest) of the lots' dates — null when any is missing or there are none. */
function extreme(dates: readonly (Date | null)[], pick: "min" | "max"): Date | null {
  if (dates.length === 0 || dates.some((d) => d === null)) return null;
  const times = (dates as Date[]).map((d) => d.getTime());
  return new Date(pick === "min" ? Math.min(...times) : Math.max(...times));
}

/** When a closed lot ended: an auction at its end, or when it closed if that was earlier (withdrawn
 *  before the end); anything else when it closed. */
function lotEnded(lot: PostListLotDates): Date | null {
  if (lot.auction && lot.endsAt) {
    return lot.closedAt && lot.closedAt < lot.endsAt ? lot.closedAt : lot.endsAt;
  }
  return lot.closedAt;
}

export function facebookPostListDates(
  stage: FacebookPostStage,
  createdAt: Date,
  lots: readonly PostListLotDates[]
): FacebookPostListDates {
  const dates: FacebookPostListDates = {
    createdAt: createdAt.toISOString(),
    submittedAt: null,
    upSince: null,
    endsFrom: null,
    endsTo: null,
    endedAt: null,
  };
  const posted = lots.filter((l) => isPosted(l.state));
  if (stage === "pending") {
    const submitted = extreme(
      lots.filter((l) => l.state === "pending").map((l) => (l.stateChangedAt > STATE_CHANGED_RECORDED_FROM ? l.stateChangedAt : null)),
      "min"
    );
    dates.submittedAt = submitted?.toISOString() ?? null;
  }
  if (stage === "up" || stage === "over") {
    // Lots still waiting for approval are not up yet; the rest went up on their listing day.
    const up = extreme(
      posted.filter((l) => l.state !== "pending").map((l) => l.listingDate),
      "min"
    );
    dates.upSince = up?.toISOString().slice(0, 10) ?? null;
  }
  if (stage === "up") {
    const open = lots.filter((l) => l.auction && OPEN_STATES.has(l.state));
    const from = extreme(open.map((l) => l.endsAt), "min");
    const to = extreme(open.map((l) => l.endsAt), "max");
    if (from && to) {
      dates.endsFrom = from.toISOString();
      dates.endsTo = to.toISOString();
    }
  }
  if (stage === "over") {
    dates.endedAt = extreme(posted.map(lotEnded), "max")?.toISOString() ?? null;
  }
  return dates;
}

/** One lot's figures, every amount in the base currency. */
export interface PostListLotFigures {
  copyCount: number;
  /** The stated price — a quick buy's asking price, an auction's starting price — or null while it
   *  has none. */
  asking: number | null;
  /** It has a price, but no rate converts it into the base currency. */
  askingUnconvertible: boolean;
  /** The catalogue value of one of its sets, as the offer's price table reads it; null when none. */
  catalogue: number | null;
  /** The cost of one of its sets (#1736); null when none is known. */
  cost: number | null;
  costEstimated: boolean;
  costOpening: boolean;
  /** Whether the lot is in a recorded sale. */
  sold: boolean;
  /** What its sale lines brought, or null when a line's currency has no rate. */
  soldAmount: number | null;
}

/** The row of figures under a post's chips. Amounts are base-currency 2-dp strings. */
export interface FacebookPostListFigures {
  lotCount: number;
  copyCount: number;
  asking: { amount: string | null; unpriced: number; unconvertible: number };
  catalogue: { amount: string | null; lots: number };
  cost: { amount: string | null; lots: number; estimated: boolean; opening: boolean };
  sold: { lots: number; amount: string | null; unconvertible: number };
}

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export function facebookPostListFigures(lots: readonly PostListLotFigures[]): FacebookPostListFigures {
  let copies = 0;
  let asking = 0;
  let priced = 0;
  let unpriced = 0;
  let askingUnconvertible = 0;
  let catalogue = 0;
  let catalogueLots = 0;
  let cost = 0;
  let costLots = 0;
  let estimated = false;
  let opening = false;
  let soldLots = 0;
  let sold = 0;
  let soldCounted = 0;
  let soldUnconvertible = 0;
  for (const lot of lots) {
    copies += lot.copyCount;
    if (lot.askingUnconvertible) askingUnconvertible++;
    else if (lot.asking === null) unpriced++;
    else {
      asking += cents(lot.asking);
      priced++;
    }
    if (lot.catalogue !== null) {
      catalogue += cents(lot.catalogue);
      catalogueLots++;
    }
    if (lot.cost !== null) {
      cost += cents(lot.cost);
      costLots++;
      estimated ||= lot.costEstimated;
      opening ||= lot.costOpening;
    }
    if (lot.sold) {
      soldLots++;
      if (lot.soldAmount === null) soldUnconvertible++;
      else {
        sold += cents(lot.soldAmount);
        soldCounted++;
      }
    }
  }
  return {
    lotCount: lots.length,
    copyCount: copies,
    asking: { amount: priced > 0 ? fromCents(asking) : null, unpriced, unconvertible: askingUnconvertible },
    catalogue: { amount: catalogueLots > 0 ? fromCents(catalogue) : null, lots: catalogueLots },
    cost: { amount: costLots > 0 ? fromCents(cost) : null, lots: costLots, estimated, opening },
    sold: { lots: soldLots, amount: soldCounted > 0 ? fromCents(sold) : null, unconvertible: soldUnconvertible },
  };
}
