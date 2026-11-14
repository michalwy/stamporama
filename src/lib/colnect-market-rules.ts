// Check Colnect market (#2454) — the pure half: what a read from the Assistant may contain, what is
// kept of it on the offer, and how the offer's screen draws it. No Prisma, so `test:unit` holds it.
//
// Three stages, each a function:
//
// 1. {@link parseColnectMarketReadInput} — the read as the Assistant sends it, checked field by field.
//    It comes from a page on somebody else's site through the collector's own browser, so nothing in
//    it is taken on trust as a shape.
// 2. {@link storeColnectMarketRead} — what is kept: every listing in the **offer's currency**, the
//    collector's own listings marked, nothing about who the other sellers are. A price Colnect showed
//    in another currency is converted at the rate the app already holds and says so.
// 3. {@link colnectMarketView} — one block per Colnect item, one row per condition, each a strip of
//    dots on a logarithmic axis shared by the whole read.
//
// Which conditions are the collector's is decided at **view** time, off the collection's Colnect
// mapping (#404) as it stands — a mapping corrected after a read is honoured without reading again.

import { COLNECT_CONDITIONS } from "./colnect-conditions";

// ── 1. The read, as the Assistant sends it ──────────────────────────────────────────────────────────

/** Mirrored by hand from `extension/src/platform/colnect/market.ts` (`ColnectMarketOfferRead`). */
export interface ColnectMarketOfferInput {
  saleCode: string | null;
  grade: string | null;
  gradeLabel: string | null;
  amount: string;
  currency: string;
  originalPrice: string | null;
  seller: string | null;
  note: string | null;
}

/** Mirrored from `extension/src/core/colnect-market-handoff.ts` (`MarketItemRead`). */
export interface ColnectMarketItemInput {
  colnectId: string;
  offers: ColnectMarketOfferInput[];
  lots: number;
  unreadable: number;
  truncated: boolean;
}

/** Mirrored from `extension/src/core/colnect-market-handoff.ts` (`MarketRead`). */
export interface ColnectMarketReadInput {
  signedInAs: string | null;
  items: ColnectMarketItemInput[];
}

/** More listings than one item can sensibly be said to have — ten pages of two hundred. */
const MAX_OFFERS_PER_ITEM = 2000;
const MAX_ITEMS = 40;
const MAX_TEXT = 300;

function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return t || null;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The read the Assistant handed over, or null when it is not one. All-or-nothing: a read with one
 * malformed listing is not trimmed to the readable rest, because a strip quietly missing listings is
 * a wrong answer to the question the collector asked.
 */
export function parseColnectMarketReadInput(raw: unknown): ColnectMarketReadInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const signedInAs = optionalText(r.signedInAs);
  if (signedInAs === undefined || !Array.isArray(r.items) || r.items.length > MAX_ITEMS) return null;

  const items: ColnectMarketItemInput[] = [];
  for (const rawItem of r.items) {
    if (typeof rawItem !== "object" || rawItem === null) return null;
    const i = rawItem as Record<string, unknown>;
    const colnectId = typeof i.colnectId === "string" ? i.colnectId.trim() : "";
    const lots = count(i.lots);
    const unreadable = count(i.unreadable);
    if (!/^\d+$/.test(colnectId) || lots === undefined || unreadable === undefined) return null;
    if (!Array.isArray(i.offers) || i.offers.length > MAX_OFFERS_PER_ITEM) return null;
    const offers: ColnectMarketOfferInput[] = [];
    for (const rawOffer of i.offers) {
      if (typeof rawOffer !== "object" || rawOffer === null) return null;
      const o = rawOffer as Record<string, unknown>;
      const amount = typeof o.amount === "string" ? o.amount.trim() : "";
      const currency = typeof o.currency === "string" ? o.currency.trim().toUpperCase() : "";
      if (!/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0) || !/^[A-Z]{3}$/.test(currency)) return null;
      const grade = optionalText(o.grade);
      const saleCode = optionalText(o.saleCode);
      const gradeLabel = optionalText(o.gradeLabel);
      const originalPrice = optionalText(o.originalPrice);
      const seller = optionalText(o.seller);
      const note = optionalText(o.note);
      if (
        grade === undefined ||
        (grade !== null && !/^\d+$/.test(grade)) ||
        saleCode === undefined ||
        gradeLabel === undefined ||
        originalPrice === undefined ||
        seller === undefined ||
        note === undefined
      ) {
        return null;
      }
      offers.push({ saleCode, grade, gradeLabel, amount, currency, originalPrice, seller, note });
    }
    items.push({ colnectId, offers, lots, unreadable, truncated: i.truncated === true });
  }
  return { signedInAs, items };
}

// ── 2. What is kept on the offer ────────────────────────────────────────────────────────────────────

/** One listing as kept: in the offer's currency, and nothing about who sells it but whether it is the
 *  collector's own. */
export interface StoredMarketOffer {
  /** Colnect's grade (the sale form's option value), or null where the page named one we cannot
   *  place — then {@link gradeLabel} is the only name it has. */
  grade: string | null;
  gradeLabel: string | null;
  /** In the offer's currency, two decimals. */
  amount: string;
  /** Not the figure the seller typed: Colnect converted it, or this app did. */
  converted: boolean;
  /** What the seller actually asks, where it was converted (`A$ 0.01`). */
  original: string | null;
  note: string | null;
  /** One of the collector's own listings — counted apart, never a dot, so the offer never undercuts
   *  itself. */
  own: boolean;
}

export interface StoredMarketItem {
  colnectId: string;
  offers: StoredMarketOffer[];
  lots: number;
  unreadable: number;
  truncated: boolean;
}

/** The document `Offer.colnectMarketRead` holds. */
export interface StoredColnectMarketRead {
  v: 1;
  /** The offer's currency at the time of the read — every amount is in it. */
  currency: string;
  items: StoredMarketItem[];
}

/** Integer cents for a 2-dp-or-finer decimal string, rounded half up. */
function cents(amount: string | number): number {
  return Math.round(Number(amount) * 100 + 1e-9);
}

function fromCents(c: number): string {
  return (c / 100).toFixed(2);
}

/**
 * What is kept of a read.
 *
 * `rateTo(currency)` answers the rate from a currency Colnect showed prices in to the offer's, or null
 * where the app holds none — and then the read is refused rather than kept with prices in the wrong
 * money: every listing on one read is shown in the same currency, so one missing rate is all of them.
 * `ownSaleCodes` are the sale codes this collection's offers record (#696): a listing is the
 * collector's own when it is one of those **or** when it is sold by the login the pages were read as.
 */
export function storeColnectMarketRead(
  input: ColnectMarketReadInput,
  options: {
    currency: string;
    rateTo: (currency: string) => number | null;
    ownSaleCodes: ReadonlySet<string>;
  }
): { ok: true; read: StoredColnectMarketRead } | { ok: false; error: string } {
  const me = input.signedInAs?.toLowerCase() ?? null;
  const rates = new Map<string, number | null>();
  const rate = (currency: string) => {
    if (!rates.has(currency)) rates.set(currency, currency === options.currency ? 1 : options.rateTo(currency));
    return rates.get(currency)!;
  };

  const items: StoredMarketItem[] = [];
  for (const item of input.items) {
    const offers: StoredMarketOffer[] = [];
    for (const o of item.offers) {
      const r = rate(o.currency);
      if (r === null) {
        return {
          ok: false,
          error: `Colnect showed prices in ${o.currency} and there is no ${o.currency} → ${options.currency} rate to convert them with.`,
        };
      }
      const same = o.currency === options.currency;
      offers.push({
        grade: o.grade,
        gradeLabel: o.gradeLabel,
        // Never below a cent: a price that converts to nothing is still somebody's listing.
        amount: fromCents(Math.max(1, cents(Number(o.amount) * r))),
        converted: !same || o.originalPrice !== null,
        original: o.originalPrice ?? (same ? null : `${o.amount} ${o.currency}`),
        note: o.note,
        own:
          (o.saleCode !== null && options.ownSaleCodes.has(o.saleCode)) ||
          (me !== null && o.seller?.toLowerCase() === me),
      });
    }
    items.push({
      colnectId: item.colnectId,
      offers,
      lots: item.lots,
      unreadable: item.unreadable,
      truncated: item.truncated,
    });
  }
  return { ok: true, read: { v: 1, currency: options.currency, items } };
}

/** A stored read as it came back out of the JSON column, or null for anything this build did not
 *  write — a future shape is a read to take again, not one to misdraw. */
export function readStoredColnectMarketRead(raw: unknown): StoredColnectMarketRead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<StoredColnectMarketRead>;
  if (r.v !== 1 || typeof r.currency !== "string" || !Array.isArray(r.items)) return null;
  return r as StoredColnectMarketRead;
}

// ── 3. The card ─────────────────────────────────────────────────────────────────────────────────────

/** One listing on a strip. */
export interface MarketDot {
  amount: string;
  /** Where on the shared axis, 0–1 from the left. */
  position: number;
  converted: boolean;
  original: string | null;
  note: string | null;
}

/**
 * Listings at one price, drawn as **one dot** with their count beside it (#2464) rather than as dots
 * over one another.
 */
export interface MarketDotGroup {
  amount: string;
  position: number;
  count: number;
  /** Whether any of them Colnect showed in another currency. */
  converted: boolean;
  /** The prices as Colnect showed them, for those converted. */
  originals: string[];
  /** The sellers' notes, those that have one. */
  notes: string[];
}

/** One condition of one item. */
export interface MarketRow {
  key: string;
  /** The collector's own condition(s) mapped to this grade, or Colnect's name where none is. */
  name: string;
  /** Colnect's grade beside it (`MNH`), null where the row already is Colnect's name. */
  colnectGrade: string | null;
  /** The offer's own condition for this item — the row drawn highlighted. */
  highlighted: boolean;
  /** Another condition of an item that has a highlighted row: drawn toned down, so a price is not read
   *  from the wrong row (#2469). False on every row of an item with no highlighted row. */
  receded: boolean;
  dots: MarketDot[];
  /** The same listings, one entry per price, cheapest first — what the strip draws (#2464). */
  groups: MarketDotGroup[];
  lowest: string | null;
  median: string | null;
  /** Where the two marks sit on the axis, null with no listings. */
  lowestPosition: number | null;
  medianPosition: number | null;
  count: number;
  /** The collector's own listings in this condition, left out of the strip. */
  ownCount: number;
}

export interface MarketItemView {
  colnectId: string;
  label: string;
  /** Null for an item of the offer the last read did not cover — read again to see it. */
  rows: MarketRow[] | null;
  lots: number;
  unreadable: number;
  truncated: boolean;
}

/** A labelled point on the shared axis. */
export interface MarketTick {
  label: string;
  position: number;
}

/** The shared logarithmic axis: the prices at its two ends. */
export interface MarketAxis {
  lo: number;
  hi: number;
}

export interface ColnectMarketView {
  items: MarketItemView[];
  /** Round figures along the axis — 1, 2 and 5 of each decade, thinned to the ones that fit. */
  ticks: MarketTick[];
  /** The axis every strip is drawn on — so a price that is not a listing (the offer's own) can be
   * placed on it too (#2464). */
  axis: MarketAxis;
  /** Whether any condition of any item has a listing — the card says so when none does. */
  anyListings: boolean;
  /** The most listings at one price in any row of the read — the largest dot (#2473); 0 with none. */
  largestGroup: number;
}

/**
 * How far a dot of `count` listings is from the smallest dot to the largest, 0–1, **by area**
 * (#2473): a single listing is 0, the read's {@link ColnectMarketView.largestGroup} is 1, and every
 * group between is proportional to its count. The scale is the read's, not fixed thresholds, so it
 * stays useful for a handful of listings and for hundreds; a read of single listings is all 0.
 */
export function dotAreaScale(count: number, largestGroup: number): number {
  if (largestGroup <= 1 || count <= 1) return 0;
  return Math.min(1, (count - 1) / (largestGroup - 1));
}

/**
 * The diameter of a dot whose area is `scale` of the way from a `smallest`-wide dot to a
 * `largest`-wide one.
 */
export function dotDiameter(scale: number, smallest: number, largest: number): number {
  return Math.sqrt(smallest ** 2 + (largest ** 2 - smallest ** 2) * scale);
}

/**
 * The counts the legend draws a dot for (#2473): one listing, about half the largest group, and the
 * largest group — each once, so a read whose largest group is 1 shows *1* alone, and one of 2 shows
 * *1* and *2*.
 */
export function dotLegendCounts(largestGroup: number): number[] {
  const out = [1];
  for (const c of [Math.round(largestGroup / 2), largestGroup]) {
    if (c > out.at(-1)!) out.push(c);
  }
  return out;
}

/** One of the offer's Colnect items, as the card is to show it. */
export interface MarketItemTarget {
  colnectId: string;
  /** The catalogue number it is named by. */
  label: string;
  /** Colnect grades the offer's copies of this item are in — the rows drawn highlighted. */
  grades: readonly string[];
}

/**
 * Where a price sits on the axis, 0–1 from the left; outside the read's range it is held at the
 * nearer end, and `outside` says which way it lies. Null for no price — nothing, or not above zero.
 */
export function axisPosition(
  axis: MarketAxis,
  amount: string | null | undefined
): { position: number; outside: "below" | "above" | null } | null {
  const value = Number(amount);
  if (amount == null || !Number.isFinite(value) || value <= 0) return null;
  const position = (Math.log(value) - Math.log(axis.lo)) / (Math.log(axis.hi) - Math.log(axis.lo));
  if (position < 0) return { position: 0, outside: "below" };
  if (position > 1) return { position: 1, outside: "above" };
  return { position, outside: null };
}

/**
 * **The offer's price zones on the market's axis** (#2523): each zone, given in prices (`from` up to
 * `to`, `to` null for one that runs on past every price — the offer's price zones of #2497), placed on
 * this logarithmic axis. The axis keeps its scale: a zone reaching past either end starts or ends at
 * that end, and a zone wholly outside it — or with no width on it — is dropped. A price of zero sits
 * at the left end, as the axis has no zero. Generic over the zone's key, so this module stays free of
 * the price table's.
 */
export function axisZones<Z extends { from: number; to: number | null }>(
  axis: MarketAxis,
  zones: readonly Z[]
): Array<Z & { start: number; end: number }> {
  const at = (value: number) =>
    value <= 0
      ? 0
      : Math.min(1, Math.max(0, (Math.log(value) - Math.log(axis.lo)) / (Math.log(axis.hi) - Math.log(axis.lo))));
  return zones.flatMap((zone) => {
    const start = at(zone.from);
    const end = zone.to === null ? 1 : at(zone.to);
    return end > start ? [{ ...zone, start, end }] : [];
  });
}

/** The 1-2-5 values next to `v`: the largest below it and the smallest above it. */
function oneTwoFiveBelow(v: number): number {
  const e = Math.floor(Math.log10(v));
  for (const candidate of [5 * 10 ** e, 2 * 10 ** e, 10 ** e, 5 * 10 ** (e - 1)]) {
    if (candidate < v * (1 - 1e-9)) return candidate;
  }
  return 5 * 10 ** (e - 1);
}
function oneTwoFiveAbove(v: number): number {
  const e = Math.floor(Math.log10(v));
  for (const candidate of [10 ** e, 2 * 10 ** e, 5 * 10 ** e, 10 ** (e + 1)]) {
    if (candidate > v * (1 + 1e-9)) return candidate;
  }
  return 10 ** (e + 1);
}

/** The labelled values of the 1-2-5 sequence (or the decades alone) between `lo` and `hi`. */
function oneTwoFiveTicks(lo: number, hi: number, multiples: readonly number[]): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of multiples) {
      const v = m * 10 ** e;
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/** A scale never shows fewer labelled lines than this, nor — 1-2-5 giving way to the decades — more
 * than {@link MOST_TICKS} (#2464). */
const FEWEST_TICKS = 3;
const MOST_TICKS = 9;

/** The median of sorted cents, rounded to a cent. */
function medianCents(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The card's content: one block per item of the offer, in the offer's order, each with a row for
 * every Colnect condition (Colnect's five, then any other the read met) — an empty row says "no
 * listings" rather than disappearing, since *nobody sells it in this grade* is an answer too.
 *
 * `conditionNames` maps a Colnect grade to the collector's condition names mapped to it (#404).
 */
export function colnectMarketView(
  stored: StoredColnectMarketRead | null,
  targets: readonly MarketItemTarget[],
  conditionNames: ReadonlyMap<string, readonly string[]>
): ColnectMarketView {
  const byId = new Map((stored?.items ?? []).map((i) => [i.colnectId, i]));

  // One axis for the whole read, so a condition can be compared with another at a glance.
  const values = targets.flatMap((t) =>
    (byId.get(t.colnectId)?.offers ?? []).filter((o) => !o.own).map((o) => Number(o.amount))
  );
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) lo = hi = 1;
  // A margin either side, so the cheapest and dearest dots are not drawn on the strip's edges, and a
  // read of one price still has an axis.
  lo = lo / 1.25;
  hi = hi * 1.25;
  // A narrow read is widened to the 1-2-5 values around it until the scale has a few labelled lines
  // (#2464) — a read of one price is otherwise a single line, and a scale of one figure says nothing.
  while (oneTwoFiveTicks(lo, hi, [1, 2, 5]).length < FEWEST_TICKS) {
    lo = oneTwoFiveBelow(lo);
    hi = oneTwoFiveAbove(hi);
  }
  const span = Math.log(hi) - Math.log(lo);
  const at = (amount: string | number) => (Math.log(Number(amount)) - Math.log(lo)) / span;

  let anyListings = false;
  const items = targets.map((target): MarketItemView => {
    const item = byId.get(target.colnectId);
    if (!item) {
      return { colnectId: target.colnectId, label: target.label, rows: null, lots: 0, unreadable: 0, truncated: false };
    }
    const highlighted = new Set(target.grades);

    // Colnect's five first, always; then a grade the read met that is not one of them, under the
    // name the page gave it.
    const rowKeys: { key: string; grade: string | null; label: string | null }[] = COLNECT_CONDITIONS.map((g) => ({
      key: g.value,
      grade: g.value,
      label: g.label,
    }));
    const keyOf = (o: StoredMarketOffer) =>
      o.grade !== null && COLNECT_CONDITIONS.some((g) => g.value === o.grade)
        ? o.grade
        : `other:${o.grade ?? ""}:${o.gradeLabel ?? ""}`;
    for (const o of item.offers) {
      const key = keyOf(o);
      if (!rowKeys.some((r) => r.key === key)) {
        rowKeys.push({ key, grade: o.grade, label: o.gradeLabel ?? "Unknown condition" });
      }
    }

    const isOwn = (grade: string | null) => grade !== null && highlighted.has(grade);
    const hasOwnRow = rowKeys.some((r) => isOwn(r.grade));
    const rows = rowKeys.map(({ key, grade, label }): MarketRow => {
      const inRow = item.offers.filter((o) => keyOf(o) === key);
      const listed = inRow.filter((o) => !o.own).sort((a, b) => cents(a.amount) - cents(b.amount));
      const sorted = listed.map((o) => cents(o.amount));
      if (listed.length > 0) anyListings = true;
      const known = COLNECT_CONDITIONS.find((g) => g.value === key);
      const mine = (grade !== null && conditionNames.get(grade)) || [];
      const lowest = sorted.length ? fromCents(sorted[0]) : null;
      const median = sorted.length ? fromCents(medianCents(sorted)) : null;
      return {
        key,
        name: mine.length > 0 ? mine.join(" / ") : (label ?? key),
        colnectGrade: mine.length > 0 && known ? known.abbrev : null,
        highlighted: isOwn(grade),
        receded: hasOwnRow && !isOwn(grade),
        dots: listed.map((o) => ({
          amount: o.amount,
          position: at(o.amount),
          converted: o.converted,
          original: o.original,
          note: o.note,
        })),
        groups: groupByPrice(listed, at),
        lowest,
        median,
        lowestPosition: lowest === null ? null : at(lowest),
        medianPosition: median === null ? null : at(median),
        count: listed.length,
        ownCount: inRow.length - listed.length,
      };
    });
    return {
      colnectId: target.colnectId,
      label: target.label,
      rows,
      lots: item.lots,
      unreadable: item.unreadable,
      truncated: item.truncated,
    };
  });
  // 1-2-5 of every decade in range; where that would crowd the scale, the decades alone.
  const ticks: MarketTick[] = [];
  if (anyListings) {
    let values = oneTwoFiveTicks(lo, hi, [1, 2, 5]);
    if (values.length > MOST_TICKS) values = oneTwoFiveTicks(lo, hi, [1]);
    for (const v of values) {
      const e = Math.floor(Math.log10(v) + 1e-9);
      ticks.push({ label: v >= 1 ? String(Math.round(v)) : v.toFixed(Math.max(0, -e)), position: at(v) });
    }
  }
  // One dot scale for the whole read, as the axis is, so conditions compare by size too (#2473).
  let largestGroup = 0;
  for (const item of items) {
    for (const row of item.rows ?? []) {
      for (const group of row.groups) largestGroup = Math.max(largestGroup, group.count);
    }
  }
  return { items, ticks, axis: { lo, hi }, anyListings, largestGroup };
}

/** Listings sorted cheapest first, one entry per price. */
function groupByPrice(
  listed: readonly StoredMarketOffer[],
  at: (amount: string) => number
): MarketDotGroup[] {
  const groups: MarketDotGroup[] = [];
  for (const o of listed) {
    let group = groups.at(-1);
    if (!group || cents(group.amount) !== cents(o.amount)) {
      group = { amount: o.amount, position: at(o.amount), count: 0, converted: false, originals: [], notes: [] };
      groups.push(group);
    }
    group.count += 1;
    if (o.converted) group.converted = true;
    if (o.converted && o.original) group.originals.push(o.original);
    if (o.note) group.notes.push(o.note);
  }
  return groups;
}

/** The step a click undercuts by, where the platform states none. */
export const DEFAULT_MARKET_PRICE_STEP = "0.01";

/**
 * The price a click on a market price sets: that price less the step, and never below a cent — an
 * offer cannot be listed for nothing, and a step that would take it there leaves it at the smallest
 * price there is.
 */
export function priceUnder(amount: string, step: string | null | undefined): string {
  const stepCents = cents(step && Number(step) > 0 ? step : DEFAULT_MARKET_PRICE_STEP);
  return fromCents(Math.max(1, cents(amount) - stepCents));
}

// ── The offer's side ───────────────────────────────────────────────────────────────────────────────

/** The part of an offer's item row (`OfferPlatformItem`) a market read is built from. */
export interface MarketItemSource {
  colnectItemId: string | null;
  colnectGrade: string | null;
  /** The variant the row is listed under (#616), named by its catalogue number. */
  catalogItemVariant: string | null;
  catalogNumbers: readonly string[];
  label: string;
}

/**
 * The Colnect items an offer is listed under, in the order its sets list them, each with the grades
 * its copies are in. An umbrella reads the variant it is listed under (#616) — that is the item its
 * row carries — and a row with no item (unmatched) is not one there is a market to read for.
 */
export function colnectMarketTargets(rows: readonly MarketItemSource[]): MarketItemTarget[] {
  const targets = new Map<string, { colnectId: string; label: string; grades: string[] }>();
  for (const row of rows) {
    const id = row.colnectItemId?.trim();
    if (!id) continue;
    let target = targets.get(id);
    if (!target) {
      target = { colnectId: id, label: row.catalogItemVariant ?? row.catalogNumbers[0] ?? row.label, grades: [] };
      targets.set(id, target);
    }
    if (row.colnectGrade && !target.grades.includes(row.colnectGrade)) target.grades.push(row.colnectGrade);
  }
  return [...targets.values()];
}

/** What the offer's screen draws the Colnect market card from. */
export interface OfferColnectMarket {
  /** What a read asks the Assistant about — empty when no stamp of the offer is linked to Colnect. */
  targets: MarketItemTarget[];
  view: ColnectMarketView;
  /** When the last read was taken, null before the first. */
  readAt: Date | null;
  /** The step a click undercuts by, 2-dp, in {@link currency}. */
  step: string;
  /** The offer's currency, which every figure on the card is in. */
  currency: string;
}
