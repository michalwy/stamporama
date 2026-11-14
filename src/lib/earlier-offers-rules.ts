// **What the same stamps were offered and sold for before** (#2521) — pure, no Prisma import, so the
// matching, the two *Last sale* figures and the *Earlier offers* axes are unit-tested on their own.
//
// The collector lists the same stamps again and again, and prices differ a lot between platforms, so
// the offer's screen answers two questions itself: what these stamps last **sold** for on this
// platform and on any platform (two rows of the price table), and every earlier offer of them, sold or
// not, on axes tinted in the offer's price zones and then in a table (a tab of the Pricing panel).
//
// **The same stamps** is a set holding exactly the stamps one of this offer's sets holds — a series
// matches a series, a single stamp that stamp; an earlier set holding only part of them, or more, is
// not one. A copy is its stamps (every `ItemStamp`, ADR-0044, with its quantity and format), so a
// block of four is not four singles and a piece is the stamps it carries. **The same condition** is
// the same again with each copy's condition beside it. Earlier offers in any condition are listed —
// another condition is greyed out — but the *Last sale* rows count the same condition only.
//
// *Sold* is what the set actually sold for in its sale, never the price it was listed at; a set whose
// sale was cancelled (#2500) has no sale line left and so counts as not sold. Every amount arrives here
// already in the offer's currency (null where no rate converts it), as the price table's figures do.

import { OFFER_STATE_LABEL, type OfferState } from "./offer-rules";
import type { PriceZone } from "./offer-price-table";

/** One of a copy's stamps, as the copy's `ItemStamp` row states it. */
export interface CopyStampInput {
  stampId: string;
  quantity: number;
  /** Null: a single. */
  formatId: string | null;
}

/** One copy of a set, as the matching reads it. */
export interface MatchCopyInput {
  /** Null for a piece, which has no condition (#2383). */
  conditionId: string | null;
  conditionName: string | null;
  stamps: readonly CopyStampInput[];
}

/** A copy as its stamps: every component, sorted, so the order they were described in does not matter. */
export function copyStampKey(copy: Pick<MatchCopyInput, "stamps">): string {
  return copy.stamps
    .map((s) => `${s.stampId}*${s.quantity}*${s.formatId ?? ""}`)
    .sort()
    .join("+");
}

/** A set as its stamps — each copy's {@link copyStampKey}, sorted. Two sets with the same key hold
 *  exactly the same stamps. Empty for an empty set. */
export function setStampKey(copies: readonly Pick<MatchCopyInput, "stamps">[]): string {
  return copies.map(copyStampKey).sort().join("|");
}

/** A set as its stamps in their conditions — each copy's stamps with its condition beside it. Two sets
 *  with the same key are the same stamps in the same condition. */
export function setConditionKey(copies: readonly Pick<MatchCopyInput, "stamps" | "conditionId">[]): string {
  return copies
    .map((c) => `${copyStampKey(c)}@${c.conditionId ?? ""}`)
    .sort()
    .join("|");
}

/** What a set's condition is called on its row: the one condition its copies share, or each one named,
 *  in the order first met. A set of pieces names none. */
export function setConditionLabel(copies: readonly Pick<MatchCopyInput, "conditionName">[]): string | null {
  const names = [...new Set(copies.map((c) => c.conditionName).filter((n): n is string => n !== null))];
  return names.length === 0 ? null : names.join(" / ");
}

/** One of this offer's own sets. */
export interface OwnSetInput {
  setId: string;
  /** How the set is named on the offer's screen. */
  label: string;
  copies: readonly MatchCopyInput[];
}

/** One set of an earlier offer, a candidate for being the same stamps. */
export interface EarlierSetInput {
  setId: string;
  offerId: string;
  offerNo: number;
  platformId: string;
  platformName: string;
  state: OfferState;
  /** When the offer went up — its listing date, else when it was made. */
  date: Date;
  /** The price it was listed at — the figure the seller stated, an auction's starting price — per set
   *  and in this offer's currency; null when it had none or no rate converts it. */
  listed: string | null;
  /** Its sale, where the set sold; `amount` in this offer's currency, null where no rate converts it. */
  sale: { amount: string | null; soldAt: Date } | null;
  /** Where the set sits in its offer, 1-based, and how many sets the offer had. */
  setPosition: number;
  setCount: number;
  copies: readonly MatchCopyInput[];
}

export type EarlierOfferOutcome =
  | { kind: "sold"; amount: string | null; soldAt: Date }
  | { kind: "withdrawn" }
  /** Still open — its state names where it is. */
  | { kind: "open"; state: OfferState }
  /** The offer closed as sold, but not this set of it. */
  | { kind: "unsold" };

/** One row of the *Earlier offers* table, and one dot on its axes. */
export interface EarlierOfferRow {
  setId: string;
  offerId: string;
  offerNo: number;
  /** `set 2 of 3`, where the earlier offer had several sets; null for an offer of one. */
  setLabel: string | null;
  /** Which of this offer's sets the row is for — only where this offer's sets are not all alike. */
  forSet: string | null;
  date: Date;
  platformId: string;
  platformName: string;
  conditionLabel: string | null;
  /** The same condition as the set it is for; a row in another condition is greyed out. */
  sameCondition: boolean;
  listed: string | null;
  outcome: EarlierOfferOutcome;
}

/** One sale behind a *Last sale* figure. */
export interface LastSaleSource {
  offerId: string;
  offerNo: number;
  soldAt: Date;
  platformName: string;
  amount: string;
}

/** A *Last sale* row's figure, per set: the last sale of the same stamps in the same condition. */
export interface LastSale {
  /** Per set, in the offer's currency — averaged over this offer's sets that have one, as every figure
   *  of the price table is; where the offer's sets are all alike it is simply the last sale's amount. */
  amount: string;
  /** The sales behind it, newest first — one, unless this offer's sets differ and each has its own. */
  sources: LastSaleSource[];
  /** This offer's sets that have one, of how many. */
  valuedSets: number;
  setCount: number;
}

export interface EarlierOffers {
  rows: EarlierOfferRow[];
  /** The last sale on this offer's platform, and on any platform; null where there is none. */
  lastSale: { platform: LastSale | null; any: LastSale | null };
  /** True where the same stamps in the same condition did sell, but no rate converts the amount —
   *  the one reason a *Last sale* row is empty other than there being no sale. */
  lastSaleUnconvertible: { platform: boolean; any: boolean };
}

function outcomeOf(set: EarlierSetInput): EarlierOfferOutcome {
  if (set.sale) return { kind: "sold", amount: set.sale.amount, soldAt: set.sale.soldAt };
  if (set.state === "withdrawn") return { kind: "withdrawn" };
  if (set.state === "sold") return { kind: "unsold" };
  return { kind: "open", state: set.state };
}

/** An outcome as the table writes it — *Sold 12.00*, *Withdrawn*, or the offer's state while open. */
export function describeOutcome(outcome: EarlierOfferOutcome): string {
  switch (outcome.kind) {
    case "sold":
      return outcome.amount === null ? "Sold" : `Sold ${outcome.amount}`;
    case "withdrawn":
      return "Withdrawn";
    case "unsold":
      return "Not sold";
    case "open":
      return OFFER_STATE_LABEL[outcome.state];
  }
}


/**
 * **This offer's earlier offers** (#2521): every earlier set holding exactly the stamps one of this
 * offer's sets holds, newest first, each matched to the set it is for — the one in its own condition
 * where there is one — and the two *Last sale* figures over those in the same condition.
 *
 * The caller has left out this offer itself and every offer still being prepared; anything else —
 * sold, withdrawn, still open — is listed.
 */
export function earlierOffers(
  own: readonly OwnSetInput[],
  candidates: readonly EarlierSetInput[],
  platformId: string
): EarlierOffers {
  const ownKeyed = own
    .filter((s) => s.copies.length > 0)
    .map((s) => ({ ...s, stampKey: setStampKey(s.copies), conditionKey: setConditionKey(s.copies) }));
  // The row says which set it is for only where this offer's sets are not all alike.
  const distinct = new Set(ownKeyed.map((s) => s.conditionKey));
  const named = distinct.size > 1;

  const rows: EarlierOfferRow[] = [];
  // What a row was matched by, and where its set sits in its offer — the matching's, not the row's.
  const conditionKeyOf = new Map<string, string>();
  const positionOf = new Map<string, number>();
  for (const set of candidates) {
    if (set.copies.length === 0) continue;
    const stampKey = setStampKey(set.copies);
    const conditionKey = setConditionKey(set.copies);
    const same = ownKeyed.find((s) => s.conditionKey === conditionKey);
    const target = same ?? ownKeyed.find((s) => s.stampKey === stampKey);
    if (!target) continue;
    rows.push({
      setId: set.setId,
      offerId: set.offerId,
      offerNo: set.offerNo,
      setLabel: set.setCount > 1 ? `set ${set.setPosition} of ${set.setCount}` : null,
      forSet: named ? target.label : null,
      date: set.date,
      platformId: set.platformId,
      platformName: set.platformName,
      conditionLabel: setConditionLabel(set.copies),
      sameCondition: same !== undefined,
      listed: set.listed,
      outcome: outcomeOf(set),
    });
    conditionKeyOf.set(set.setId, conditionKey);
    positionOf.set(set.setId, set.setPosition);
  }
  rows.sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() ||
      b.offerNo - a.offerNo ||
      positionOf.get(a.setId)! - positionOf.get(b.setId)!
  );

  const lastSaleOver = (onPlatform: boolean): { sale: LastSale | null; unconvertible: boolean } => {
    let sum = 0;
    let valuedSets = 0;
    let unconvertible = false;
    const sources = new Map<string, LastSaleSource>();
    for (const set of ownKeyed) {
      const sold = rows
        .filter(
          (r) =>
            r.sameCondition &&
            conditionKeyOf.get(r.setId) === set.conditionKey &&
            r.outcome.kind === "sold" &&
            (!onPlatform || r.platformId === platformId)
        )
        .map((r) => ({ row: r, outcome: r.outcome as Extract<EarlierOfferOutcome, { kind: "sold" }> }))
        .sort((a, b) => b.outcome.soldAt.getTime() - a.outcome.soldAt.getTime() || b.row.offerNo - a.row.offerNo);
      const last = sold.find((s) => s.outcome.amount !== null);
      if (!last) {
        if (sold.length > 0) unconvertible = true;
        continue;
      }
      sum += Number(last.outcome.amount);
      valuedSets++;
      sources.set(last.row.setId, {
        offerId: last.row.offerId,
        offerNo: last.row.offerNo,
        soldAt: last.outcome.soldAt,
        platformName: last.row.platformName,
        amount: last.outcome.amount!,
      });
    }
    if (valuedSets === 0) return { sale: null, unconvertible };
    return {
      sale: {
        amount: (sum / valuedSets).toFixed(2),
        sources: [...sources.values()].sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime() || b.offerNo - a.offerNo),
        valuedSets,
        setCount: ownKeyed.length,
      },
      unconvertible: false,
    };
  };
  const onPlatform = lastSaleOver(true);
  const anyPlatform = lastSaleOver(false);

  return {
    rows,
    lastSale: { platform: onPlatform.sale, any: anyPlatform.sale },
    lastSaleUnconvertible: { platform: onPlatform.unconvertible, any: anyPlatform.unconvertible },
  };
}

/** A *Last sale* row's note: the offer and the date — `#412, 2026-10-03` — and on any platform the
 *  platform too; `2 sales` where this offer's sets each had their own. */
export function describeLastSaleNote(sale: LastSale, withPlatform: boolean): string {
  if (sale.sources.length !== 1) return `${sale.sources.length} sales`;
  const source = sale.sources[0];
  const parts = [`#${source.offerNo}`, isoDay(source.soldAt)];
  if (withPlatform) parts.unshift(source.platformName);
  return parts.join(", ");
}

/** A day as the rows write it. Takes the string a `Date` arrives as on the client, too. */
export function isoDay(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

// ── The axes ─────────────────────────────────────────────────────────────────

/** How far the axis runs past the dearest price on it, so that dot is not drawn on the edge. */
export const EARLIER_AXIS_HEADROOM = 0.1;

export interface EarlierAxisDot {
  setId: string;
  offerNo: number;
  amount: string;
  position: number;
  /** Filled where it sold, at what it sold for; hollow where it was listed and did not sell. */
  sold: boolean;
}

export interface EarlierAxis {
  /** A platform's id, or `other-condition` for the greyed axis of the other conditions. */
  key: string;
  label: string;
  greyed: boolean;
  dots: EarlierAxisDot[];
}

export interface EarlierAxesView {
  axes: EarlierAxis[];
  /** Round figures along the axis. */
  ticks: { label: string; position: number }[];
  /** The offer's price zones (#2497) on this axis, the same on every axis. */
  zones: Array<PriceZone & { start: number; end: number }>;
  /** The offer's own price, once set — a mark on every axis. */
  own: { amount: string; position: number } | null;
  /** The price at the axis's right end; it starts at 0. */
  max: number;
}

export const OTHER_CONDITION_AXIS = "other-condition";

/** A step of 1, 2 or 5 of a power of ten, giving about `count` intervals over `max`. */
function niceStep(max: number, count: number): number {
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * power >= raw) return m * power;
  return 10 * power;
}

/**
 * **The *Earlier offers* axes** (#2521): one per platform for the offers in the same condition — this
 * offer's platform first, the rest by name — and one greyed axis for every offer in another condition,
 * each tinted in the offer's price zones as *Your price* (#2497) and the Colnect market's axes (#2523)
 * are. Each earlier offer is a dot at its price: filled where it sold, at what it sold for; hollow where
 * it did not, at the price it was listed at. A row with no amount (no rate) has no dot.
 *
 * Linear from 0, as the price scale under the table is, to a little past the dearest price on it — the
 * offer's own price included, which is a mark on every axis. A zone past the right end is cut there.
 * Null when there is no price to place at all.
 */
export function earlierOffersAxes(
  rows: readonly EarlierOfferRow[],
  platformId: string,
  zones: readonly PriceZone[],
  ownPrice: string | null
): EarlierAxesView | null {
  const value = (amount: string | null) => {
    const n = amount === null ? NaN : Number(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const placed = rows.flatMap((row) => {
    const sold = row.outcome.kind === "sold";
    const amount = sold ? (row.outcome as { amount: string | null }).amount : row.listed;
    const v = value(amount);
    return v === null ? [] : [{ row, amount: amount!, v, sold }];
  });
  const own = value(ownPrice);
  const highest = Math.max(0, own ?? 0, ...placed.map((p) => p.v));
  if (highest <= 0) return null;
  const step = niceStep(highest * (1 + EARLIER_AXIS_HEADROOM), 4);
  const max = Math.max(highest * (1 + EARLIER_AXIS_HEADROOM), step);
  const at = (v: number) => Math.min(1, Math.max(0, v / max));

  const byPlatform = new Map<string, EarlierAxis>();
  let other: EarlierAxis | null = null;
  for (const p of placed) {
    const dot: EarlierAxisDot = { setId: p.row.setId, offerNo: p.row.offerNo, amount: p.amount, position: at(p.v), sold: p.sold };
    if (!p.row.sameCondition) {
      other ??= { key: OTHER_CONDITION_AXIS, label: "Other condition", greyed: true, dots: [] };
      other.dots.push(dot);
      continue;
    }
    let axis = byPlatform.get(p.row.platformId);
    if (!axis) {
      axis = { key: p.row.platformId, label: p.row.platformName, greyed: false, dots: [] };
      byPlatform.set(p.row.platformId, axis);
    }
    axis.dots.push(dot);
  }
  const axes = [...byPlatform.values()].sort(
    (a, b) => Number(b.key === platformId) - Number(a.key === platformId) || a.label.localeCompare(b.label)
  );
  if (other) axes.push(other);
  // A sold dot is drawn over a hollow one at the same price.
  for (const axis of axes) axis.dots.sort((a, b) => Number(a.sold) - Number(b.sold) || a.position - b.position);

  const decimals = step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: EarlierAxesView["ticks"] = [];
  for (let i = 0; i * step <= max * (1 + 1e-9); i++) {
    ticks.push({ label: (i * step).toFixed(decimals), position: at(i * step) });
  }

  return {
    axes,
    ticks,
    zones: zones.flatMap((zone) => {
      const start = at(zone.from);
      const end = zone.to === null ? 1 : at(zone.to);
      return end > start ? [{ ...zone, start, end }] : [];
    }),
    own: own === null ? null : { amount: ownPrice!, position: at(own) },
    max,
  };
}
