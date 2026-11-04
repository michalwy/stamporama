import { normalizeDecimalInput } from "./decimal-input";
import { assembleSets, type GeneratorCopy } from "./offer-generator-rules";
import type { LotChecklist } from "./lot-builder-rules";

// Free extras on a sale (#2408): copies put into the parcel for nothing, on top of what the buyer
// bought. The sale proposes them and the collector confirms; this module is the pure half — the
// limits as typed, the ranking, the proposal and the running totals — so the dialog and the tests
// read one rule. The candidates themselves (which copies may be given away, and what each is worth in
// the sale's currency) are the server's, in `sales.ts`.
//
// Settled with the collector on 2026-11-04:
//
// - **Value ranks first**, the copy's catalogue value from valuation, never its purchase cost; where
//   two are worth the same, a copy on no open offer comes before a listed one.
// - What the buyer bought does not steer the choice — no matching by area, period or theme.
// - The limits are a **count** and a **budget**, either or both; the budget is an amount in the
//   sale's currency or a percentage of the order's value — the sale's paid lines, without shipping
//   and without the free extras themselves.
// - **A free extra never breaks a complete set** (#2422): a whole series may go, and is proposed
//   before loose copies; a copy goes loose only where its stamp is held more times than the series'
//   complete sets need.
//
// Every figure here is in whole **cents** of the sale's currency, so a budget of 5.00 holds five
// copies at 1.00 exactly rather than four and a rounding error.

/** How the budget was typed: an amount in the sale's currency, or a percentage of the order. */
export type FreeExtraBudgetKind = "amount" | "percent";

/** The limits as the dialog's fields hold them. */
export interface FreeExtraLimitsRaw {
  count: string;
  budget: string;
  budgetKind: FreeExtraBudgetKind;
}

/** The limits resolved: null where a limit was left empty. At least one is set. */
export interface FreeExtraLimits {
  count: number | null;
  /** The budget in cents of the sale's currency — a percentage already taken of the order. */
  budgetCents: number | null;
}

/** One copy that may be given away, as the proposal reads it. */
export interface FreeExtraCandidate {
  itemId: string;
  /** The copy's own number (#268) — the last word in the order, so the ranking is stable. */
  itemNo: number;
  /** Its value in cents of the sale's currency. A copy with no value is never a candidate. */
  valueCents: number;
  /** On an open offer somewhere. Ranked after an unlisted copy of the same value. */
  listed: boolean;
}

/** A decimal amount as whole cents — rounded half away from zero, as the stored amounts are. */
export function toCents(amount: number | string): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

/** Cents as a 2-dp string, the shape every amount on a sale is printed in. */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The order's value (#2408): the sale's paid lines summed — shipping is not a line, and a free
 *  extra, priced at 0, is left out by name rather than by its price. */
export function orderValueCents(
  lines: readonly { price: number | string; freeExtra: boolean }[]
): number {
  return lines.reduce((sum, l) => (l.freeExtra ? sum : sum + toCents(l.price)), 0);
}

/**
 * Read the limits as typed. Blank is *no limit*; a count is a positive whole number; a budget is a
 * positive amount or percentage, the percentage taken of `orderCents`. At least one limit is
 * required — without either the proposal would be the whole stock.
 */
export function parseFreeExtraLimits(
  raw: FreeExtraLimitsRaw,
  orderCents: number
): { ok: true; limits: FreeExtraLimits } | { ok: false; message: string } {
  const countText = raw.count.trim();
  const budgetText = normalizeDecimalInput(raw.budget.trim());
  if (!countText && !budgetText) {
    return { ok: false, message: "Enter how many copies, a budget, or both." };
  }
  let count: number | null = null;
  if (countText) {
    if (!/^\d+$/.test(countText) || Number(countText) < 1) {
      return { ok: false, message: "The number of copies must be a whole number of at least 1." };
    }
    count = Number(countText);
  }
  let budgetCents: number | null = null;
  if (budgetText) {
    const n = Number(budgetText);
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        message:
          raw.budgetKind === "percent"
            ? "The budget must be a percentage above 0."
            : "The budget must be an amount above 0.",
      };
    }
    budgetCents = raw.budgetKind === "percent" ? Math.floor((orderCents * n) / 100) : toCents(n);
  }
  return { ok: true, limits: { count, budgetCents } };
}

/** The proposal's order: the lowest value first; at equal value a copy on no open offer before a
 *  listed one; then by copy number, so the same stock always proposes the same copies. */
export function compareFreeExtraCandidates(a: FreeExtraCandidate, b: FreeExtraCandidate): number {
  if (a.valueCents !== b.valueCents) return a.valueCents - b.valueCents;
  if (a.listed !== b.listed) return a.listed ? 1 : -1;
  return a.itemNo - b.itemNo;
}

/** The candidates in the proposal's order ({@link compareFreeExtraCandidates}), as a new array. */
export function rankFreeExtraCandidates<T extends FreeExtraCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compareFreeExtraCandidates);
}

/** A complete set of a series offered as one free extra (#2422): its copies go together or not at
 *  all. It is worth its copies' values summed, and counts as that many copies. */
export interface FreeExtraSeriesCandidate {
  /** Stable within one read: the checklist and the set's lowest copy number. */
  key: string;
  copies: readonly FreeExtraCandidate[];
}

/** A series' value: its copies' values summed. */
export function seriesValueCents(series: FreeExtraSeriesCandidate): number {
  return series.copies.reduce((sum, c) => sum + c.valueCents, 0);
}

/** The order series are proposed in: the lowest value first; at equal value a series with no copy on
 *  an open offer before one with any; then the fewer copies, then the lowest copy number. */
export function compareFreeExtraSeries(a: FreeExtraSeriesCandidate, b: FreeExtraSeriesCandidate): number {
  const value = seriesValueCents(a) - seriesValueCents(b);
  if (value !== 0) return value;
  const listedA = a.copies.some((c) => c.listed);
  const listedB = b.copies.some((c) => c.listed);
  if (listedA !== listedB) return listedA ? 1 : -1;
  if (a.copies.length !== b.copies.length) return a.copies.length - b.copies.length;
  const first = (s: FreeExtraSeriesCandidate) => Math.min(...s.copies.map((c) => c.itemNo));
  return first(a) - first(b);
}

/** The series in the proposal's order ({@link compareFreeExtraSeries}), as a new array. */
export function rankFreeExtraSeries<T extends FreeExtraSeriesCandidate>(series: readonly T[]): T[] {
  return [...series].sort(compareFreeExtraSeries);
}

/**
 * The copies proposed (#2408, #2422). **Whole series first**: walking the ranked series, each one
 * taken while it fits under both limits — its copies against the count, its summed value against the
 * budget — and one that does not fit passed over for the next. **Then loose copies**, by the same
 * walk over what the series left of the limits: each copy taken while there is room, one that would
 * go over the budget passed over. In ranked order every copy after it is worth as much or more, so
 * the walk ends there in practice, but a caller's own order is not trusted to be ranked.
 */
export function proposeFreeExtras(
  ranked: readonly FreeExtraCandidate[],
  limits: FreeExtraLimits,
  series: readonly FreeExtraSeriesCandidate[] = []
): string[] {
  const picked: string[] = [];
  let total = 0;
  const fits = (copies: number, valueCents: number) =>
    (limits.count === null || picked.length + copies <= limits.count) &&
    (limits.budgetCents === null || total + valueCents <= limits.budgetCents);
  for (const s of series) {
    const value = seriesValueCents(s);
    if (s.copies.length === 0 || !fits(s.copies.length, value)) continue;
    for (const c of s.copies) picked.push(c.itemId);
    total += value;
  }
  for (const c of ranked) {
    if (limits.count !== null && picked.length >= limits.count) break;
    if (!fits(1, c.valueCents)) continue;
    picked.push(c.itemId);
    total += c.valueCents;
  }
  return picked;
}

// ── Complete sets are never broken (#2422) ─────────────────────────────────────────────────────────
//
// Settled with the collector on 2026-11-04: a free extra never breaks a complete set. A series' number
// of complete sets is the smallest count among its stamps, and a copy may go loose only where its
// stamp is held more times than that — A×2, B×3, C×2 lets one B go; A×3, B×3, C×3 lets none.
//
// *A series* and *a complete set* are what complete-set offers already read (#1287): the offer
// generator's `assembleSets`, over the Series checklists in precedence order, a set uniform in
// condition, certificate status and format (no mixing), a variant filling its parent's slot, a
// checklist of one stamp no series, a multi-stamp copy filling nothing. The pool is the copies the
// sale may propose at all (`FREE_EXTRA_CANDIDATE_WHERE`, valued or not): a copy on a trade or another
// sale counts towards no set.

/** A copy of the pool as the set rule reads it. */
export type FreeExtraPoolCopy = Omit<GeneratorCopy, "catalogSortKey" | "listedStampId">;

/** The pool split: every complete set, and the copies left over once they are counted. */
export interface FreeExtraPoolSplit {
  sets: { checklistId: string; itemIds: string[] }[];
  looseItemIds: string[];
}

function assemble(pool: readonly FreeExtraPoolCopy[], checklists: readonly LotChecklist[]) {
  return assembleSets(
    pool.map((copy) => ({ ...copy, catalogSortKey: null })),
    checklists
  );
}

/** Which of the pool's copies form complete sets, and which are above them and may go loose. */
export function splitFreeExtraPool(
  pool: readonly FreeExtraPoolCopy[],
  checklists: readonly LotChecklist[]
): FreeExtraPoolSplit {
  const { sets, singles } = assemble(pool, checklists);
  return {
    sets: sets.map((set) => ({ checklistId: set.checklistId!, itemIds: set.copies.map((c) => c.itemId) })),
    looseItemIds: singles.map((single) => single.copies[0].itemId),
  };
}

/**
 * Whether giving `takenIds` away would break a complete set: the pool would then hold fewer complete
 * sets than it did, less those the taken copies make whole among themselves. Read off the counts,
 * not off which copy went into which set, so any copy of a stamp held above its sets passes — the
 * write does not depend on the dialog having been shown the same copies.
 */
export function freeExtrasBreakASet(
  pool: readonly FreeExtraPoolCopy[],
  takenIds: readonly string[],
  checklists: readonly LotChecklist[]
): boolean {
  const taken = new Set(takenIds);
  const before = assemble(pool, checklists).sets.length;
  const left = assemble(
    pool.filter((c) => !taken.has(c.itemId)),
    checklists
  ).sets.length;
  const whole = assemble(
    pool.filter((c) => taken.has(c.itemId)),
    checklists
  ).sets.length;
  return left < before - whole;
}

/**
 * The limits as they stand in the fields, for the summary (#2419): each field read on its own, and
 * one left blank — or not yet a figure {@link parseFreeExtraLimits} would take — is no limit. Never
 * refuses: the summary follows what is being typed, and *Propose* is where a bad figure is named.
 */
export function readFreeExtraLimits(raw: FreeExtraLimitsRaw, orderCents: number): FreeExtraLimits {
  const count = parseFreeExtraLimits({ ...raw, budget: "" }, orderCents);
  const budget = parseFreeExtraLimits({ ...raw, count: "" }, orderCents);
  return {
    count: count.ok ? count.limits.count : null,
    budgetCents: budget.ok ? budget.limits.budgetCents : null,
  };
}

/** One limit against the ticked copies: what it allows, and what is left of it — below 0 when the
 *  ticks go over, by that much. */
export interface FreeExtraLimitStanding {
  limit: number;
  left: number;
  over: boolean;
}

/** What the ticked copies come to, against the limits — the dialog's summary (#2419). */
export interface FreeExtraSummary {
  count: number;
  valueCents: number;
  /** Null where no count is given. */
  countLimit: FreeExtraLimitStanding | null;
  /** In cents; null where no budget is given. */
  budget: FreeExtraLimitStanding | null;
}

/** The ticked copies summed and set against the limits. Ticking past a limit by hand is the
 *  collector's call: the summary says by how much, and nothing refuses it. */
export function freeExtraSummary(
  ticked: readonly FreeExtraCandidate[],
  limits: FreeExtraLimits
): FreeExtraSummary {
  const valueCents = ticked.reduce((sum, c) => sum + c.valueCents, 0);
  const standing = (limit: number | null, used: number): FreeExtraLimitStanding | null =>
    limit == null ? null : { limit, left: limit - used, over: used > limit };
  return {
    count: ticked.length,
    valueCents,
    countLimit: standing(limits.count, ticked.length),
    budget: standing(limits.budgetCents, valueCents),
  };
}

// ── A platform's free-extras settings (#2409) ──────────────────────────────────────────────────────
//
// Each platform states when its sales are due free extras and how generous they are: a minimum order
// value, a default budget as a percentage of the order, and a maximum budget capping what the
// percentage gives. The dialog opens from them; the collector can still change the budget for the
// sale. Below the minimum the sale says no free extra is due, but nothing stops one being added by
// hand — a hint, not a block.

/** A platform's free-extras settings — or a contact's (#2416) — its two amounts already in cents of the
 *  sale's currency. */
export interface FreeExtraPlatformDefaults {
  minimumOrderCents: number | null;
  budgetPercent: number | null;
  maximumBudgetCents: number | null;
}

/** What the dialog opens with, read off the platform's settings and the order. */
export type FreeExtraPrefill =
  /** The platform states nothing: the dialog opens empty, as before #2409. */
  | { kind: "none" }
  /** The order is under the platform's minimum: no free extra is due, and no budget is filled in. */
  | { kind: "below-minimum"; minimumOrderCents: number }
  /** Free extras are due. `budgetCents` is null where the platform states no budget, or the one it
   *  gives comes to nothing; `capped` says the maximum cut the percentage's figure down. */
  | { kind: "due"; budgetCents: number | null; capped: boolean };

/**
 * The budget a platform proposes for an order (#2409): its percentage of the order's value, capped
 * at its maximum. With the maximum alone, the maximum is the budget; with the percentage alone,
 * nothing caps it. An order under the minimum is due none. A budget that rounds down to 0 fills
 * nothing in — the limits refuse a budget of 0.
 */
export function prefillFreeExtras(
  defaults: FreeExtraPlatformDefaults | null,
  orderCents: number
): FreeExtraPrefill {
  if (
    !defaults ||
    (defaults.minimumOrderCents == null &&
      defaults.budgetPercent == null &&
      defaults.maximumBudgetCents == null)
  ) {
    return { kind: "none" };
  }
  if (defaults.minimumOrderCents != null && orderCents < defaults.minimumOrderCents) {
    return { kind: "below-minimum", minimumOrderCents: defaults.minimumOrderCents };
  }
  let budgetCents: number | null = null;
  let capped = false;
  if (defaults.budgetPercent != null) {
    budgetCents = Math.floor((orderCents * defaults.budgetPercent) / 100);
    if (defaults.maximumBudgetCents != null && budgetCents > defaults.maximumBudgetCents) {
      budgetCents = defaults.maximumBudgetCents;
      capped = true;
    }
  } else if (defaults.maximumBudgetCents != null) {
    budgetCents = defaults.maximumBudgetCents;
  }
  return { kind: "due", budgetCents: budgetCents != null && budgetCents > 0 ? budgetCents : null, capped };
}

// ── A contact's own free-extras terms (#2416) ──────────────────────────────────────────────────────
//
// A regular customer can be treated more generously than the platform treats every buyer on it: a
// contact has the same three fields, and on a sale to it each field is combined with the platform's
// by taking the one **better for the buyer** — the lower minimum order, the higher percentage, the
// higher maximum budget (settled with the collector on 2026-11-04). Only fields that are set take
// part: one left empty on either side is not read as "no minimum" or "no cap", or every empty field
// would win and the comparison would mean nothing. A field set on one side only is that side's.

/** Where each of the combined terms came from — what the sale says beside the prefilled values. */
export interface FreeExtraTermSources {
  minimumOrder: "platform" | "contact" | null;
  budgetPercent: "platform" | "contact" | null;
  maximumBudget: "platform" | "contact" | null;
}

/** One field of the two sides, combined: the better of the two set values, the platform's at a tie
 *  — the contact's then improves on nothing. */
function better(
  platform: number | null,
  contact: number | null,
  prefer: "lower" | "higher"
): { value: number | null; source: "platform" | "contact" | null } {
  if (contact == null) return { value: platform, source: platform == null ? null : "platform" };
  if (platform == null) return { value: contact, source: "contact" };
  const contactWins = prefer === "lower" ? contact < platform : contact > platform;
  return contactWins ? { value: contact, source: "contact" } : { value: platform, source: "platform" };
}

/**
 * The platform's and the contact's terms combined (#2416), each field the better for the buyer, with
 * where each came from. Either side may be null (no buyer, or one that states nothing); both null is
 * null, and the dialog opens as {@link prefillFreeExtras} says of none.
 */
export function combineFreeExtraTerms(
  platform: FreeExtraPlatformDefaults | null,
  contact: FreeExtraPlatformDefaults | null
): { terms: FreeExtraPlatformDefaults; sources: FreeExtraTermSources } | null {
  if (!platform && !contact) return null;
  const minimumOrder = better(platform?.minimumOrderCents ?? null, contact?.minimumOrderCents ?? null, "lower");
  const budgetPercent = better(platform?.budgetPercent ?? null, contact?.budgetPercent ?? null, "higher");
  const maximumBudget = better(
    platform?.maximumBudgetCents ?? null,
    contact?.maximumBudgetCents ?? null,
    "higher"
  );
  return {
    terms: {
      minimumOrderCents: minimumOrder.value,
      budgetPercent: budgetPercent.value,
      maximumBudgetCents: maximumBudget.value,
    },
    sources: {
      minimumOrder: minimumOrder.source,
      budgetPercent: budgetPercent.source,
      maximumBudget: maximumBudget.source,
    },
  };
}

/** A contact's free-extras terms (#2416) in one line, for its page and the merge preview — *10% of
 *  the order · at most 5.00 PLN · from an order of 50.00 PLN* — or null where it states none. */
export function freeExtraTermsSummary(
  terms: {
    freeExtrasMinimumOrder: string | null;
    freeExtrasBudgetPercent: string | null;
    freeExtrasMaximumBudget: string | null;
  },
  currency: string
): string | null {
  const parts = [
    terms.freeExtrasBudgetPercent != null ? `${terms.freeExtrasBudgetPercent}% of the order` : null,
    terms.freeExtrasMaximumBudget != null ? `at most ${terms.freeExtrasMaximumBudget} ${currency}` : null,
    terms.freeExtrasMinimumOrder != null ? `from an order of ${terms.freeExtrasMinimumOrder} ${currency}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
