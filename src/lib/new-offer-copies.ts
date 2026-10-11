// **What is going into a new offer** (#1793): the *New offer* dialog opened on copies already chosen
// lists them, and before creating the offer the collector checks three things — that no stamp went
// in twice by accident, that nothing too valuable slipped in, and what the set is worth at catalogue
// and at cost.
//
// Pure, so the unit suite holds the rules the dialog draws:
//
//  - **The same stamp** is the same catalogue entry — the stamp or variant the copy points at —
//    whatever the copies' conditions or formats. A multi-stamp piece (ADR-0044) is the same as
//    another only when it carries exactly the same stamps.
//  - **The cost** is the rule an offer's COST and the Lot builder's follow (#1736, #1743): the frozen
//    cost basis, an open lot's copy at its estimate and the figure then marked. It is `copiesCost`
//    itself, so the three cannot drift apart.
//  - **The order** is the picked order by default, or highest first by catalogue value or by cost,
//    so an expensive copy stands out; a copy with no figure goes last either way.
//  - **The filters** (#1795) narrow what is *shown*, never what goes in: the duplicates only, some
//    conditions, a catalogue-value floor. *Duplicates* is asked of the whole offer, so hiding one of
//    two copies of a stamp does not make the other stop being a duplicate.
//  - **The groups** (#1795) are by issue or by stamp, each summed like the whole set.

import { copiesCost, copyCostFigure, type CopyCostInput, type OfferSetCost } from "./offer-cost";
import { formatItemNo } from "./item-number";

/** A copy as this module reads it — the fields of a Copies list row it needs. */
export interface NewOfferCopy extends Omit<CopyCostInput, "label"> {
  id: string;
  itemNo: number;
  stampName: string | null;
  stampId: string;
  conditionId: string;
  issueId: string | null;
  issueName: string | null;
  multiStamp: boolean;
  carriedStamps: readonly { stampId: string }[];
  value: { baseAmountDisplay: string | null; uncertain: boolean };
}

/** The identity two copies share when they are the same stamp — see the module header. */
export function sameStampKey(copy: Pick<NewOfferCopy, "stampId" | "multiStamp" | "carriedStamps">): string {
  if (copy.multiStamp && copy.carriedStamps.length > 0) {
    return `piece:${copy.carriedStamps.map((s) => s.stampId).sort().join(",")}`;
  }
  return `stamp:${copy.stampId}`;
}

/** The stamps a set of copies holds more than once. */
export interface DuplicateStamps {
  /** For every copy whose stamp is doubled, how many copies of that stamp the set holds. */
  copiesOfSameStamp: Map<string, number>;
  /** How many distinct stamps are doubled — what the warning at the top counts. */
  doubledStamps: number;
  /** How many copies those stamps account for. */
  doubledCopies: number;
}

export function duplicateStamps(
  copies: readonly Pick<NewOfferCopy, "id" | "stampId" | "multiStamp" | "carriedStamps">[]
): DuplicateStamps {
  const byKey = new Map<string, string[]>();
  for (const copy of copies) {
    const key = sameStampKey(copy);
    const ids = byKey.get(key);
    if (ids) ids.push(copy.id);
    else byKey.set(key, [copy.id]);
  }
  const copiesOfSameStamp = new Map<string, number>();
  let doubledStamps = 0;
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    doubledStamps++;
    for (const id of ids) copiesOfSameStamp.set(id, ids.length);
  }
  return { copiesOfSameStamp, doubledStamps, doubledCopies: copiesOfSameStamp.size };
}

/** The dialog's summary of the whole set. Amounts are base-currency 2-dp strings. */
export interface NewOfferCopiesSummary {
  count: number;
  catalogue: {
    /** The priced copies' catalogue values summed, or null when none is priced. */
    amount: string | null;
    /** Copies with no catalogue value in the base currency — left out of {@link amount}. */
    unpricedCount: number;
    /** A copy counted in {@link amount} has an unknown variant, so its figure is the lowest
     *  variant's — the total is then a floor rather than a figure. */
    uncertain: boolean;
  };
  cost: OfferSetCost;
}

const cents = (amount: string) => Math.round(Number(amount) * 100);

export function newOfferCopiesSummary(copies: readonly NewOfferCopy[]): NewOfferCopiesSummary {
  let total = 0;
  let priced = 0;
  let uncertain = false;
  for (const copy of copies) {
    if (copy.value.baseAmountDisplay == null) continue;
    total += cents(copy.value.baseAmountDisplay);
    priced++;
    if (copy.value.uncertain) uncertain = true;
  }
  return {
    count: copies.length,
    catalogue: {
      amount: priced === 0 ? null : (total / 100).toFixed(2),
      unpricedCount: copies.length - priced,
      uncertain,
    },
    // Named as the Lot builder names a copy with no figure yet (#1743): its number and stamp.
    cost: copiesCost(
      copies.map((c) => ({ ...c, label: `${formatItemNo(c.itemNo)}${c.stampName ? ` (${c.stampName})` : ""}` }))
    ),
  };
}

export type NewOfferCopyOrder = "picked" | "value" | "cost";

/** The figure a copy is ordered by, or null when it has none — such a copy goes last. */
function orderFigure(copy: NewOfferCopy, order: Exclude<NewOfferCopyOrder, "picked">): number | null {
  if (order === "value") {
    return copy.value.baseAmountDisplay == null ? null : cents(copy.value.baseAmountDisplay);
  }
  const figure = copyCostFigure(copy);
  return figure.kind === "missing" ? null : cents(figure.amount);
}

/** The copies in the order asked for — highest first, a tie and a copy with no figure keeping the
 *  picked order. A new array; the input is left as it was. */
export function orderNewOfferCopies<T extends NewOfferCopy>(copies: readonly T[], order: NewOfferCopyOrder): T[] {
  if (order === "picked") return [...copies];
  return copies
    .map((copy, index) => ({ copy, index, figure: orderFigure(copy, order) }))
    .sort((a, b) => {
      if (a.figure === null || b.figure === null) {
        if (a.figure === b.figure) return a.index - b.index;
        return a.figure === null ? 1 : -1;
      }
      return b.figure - a.figure || a.index - b.index;
    })
    .map((e) => e.copy);
}

/** What the list is narrowed to (#1795). Each narrows on its own; together a copy has to pass all. */
export interface NewOfferCopyFilters {
  /** Only the copies of a stamp the offer holds more than once — {@link duplicateStamps} over the
   *  whole offer, whatever its packaging. */
  duplicatesOnly: boolean;
  /** The conditions shown, or empty for every condition. */
  conditionIds: readonly string[];
  /** A catalogue-value floor in the base currency as typed, or blank for none. A copy with no
   *  catalogue value is not known to be worth it, so it is hidden while a floor is set. */
  minValue: string;
}

export const NO_NEW_OFFER_COPY_FILTERS: NewOfferCopyFilters = {
  duplicatesOnly: false,
  conditionIds: [],
  minValue: "",
};

/** The floor in cents, or null when none is set or what was typed is not an amount. */
function floorCents(minValue: string): number | null {
  const trimmed = minValue.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function newOfferCopyFiltersActive(filters: NewOfferCopyFilters): boolean {
  return filters.duplicatesOnly || filters.conditionIds.length > 0 || floorCents(filters.minValue) !== null;
}

/** The copies the filters let through, in the order given. A new array; nothing is taken out of the
 *  offer — the caller still creates it from every copy. */
export function filterNewOfferCopies<T extends NewOfferCopy>(copies: readonly T[], filters: NewOfferCopyFilters): T[] {
  const doubled = filters.duplicatesOnly ? duplicateStamps(copies).copiesOfSameStamp : null;
  const conditions = filters.conditionIds.length > 0 ? new Set(filters.conditionIds) : null;
  const floor = floorCents(filters.minValue);
  return copies.filter((copy) => {
    if (doubled && !doubled.has(copy.id)) return false;
    if (conditions && !conditions.has(copy.conditionId)) return false;
    if (floor !== null) {
      if (copy.value.baseAmountDisplay == null) return false;
      if (cents(copy.value.baseAmountDisplay) < floor) return false;
    }
    return true;
  });
}

export type NewOfferCopyGrouping = "none" | "issue" | "stamp";

/** One group of the list: its copies in the order given, and their figures summed as the whole
 *  set's are. */
export interface NewOfferCopyGroup<T extends NewOfferCopy> {
  key: string;
  label: string;
  copies: T[];
  summary: NewOfferCopiesSummary;
}

export const NO_ISSUE_GROUP_LABEL = "No issue";

/** The copies grouped by issue or by stamp. Groups come in the order their first copy does, so the
 *  row order chosen still reads from the top; the copies with no issue close the list, as they do on
 *  the Copies list. *By stamp* uses {@link sameStampKey}, so a stamp's duplicates sit together. */
export function groupNewOfferCopies<T extends NewOfferCopy>(
  copies: readonly T[],
  grouping: Exclude<NewOfferCopyGrouping, "none">
): NewOfferCopyGroup<T>[] {
  const groups = new Map<string, { label: string; copies: T[] }>();
  for (const copy of copies) {
    const key =
      grouping === "issue" ? (copy.issueId ? `issue:${copy.issueId}` : "issue:none") : sameStampKey(copy);
    const label =
      grouping === "issue"
        ? copy.issueId
          ? (copy.issueName ?? "Unnamed issue")
          : NO_ISSUE_GROUP_LABEL
        : (copy.stampName ?? "Unnamed stamp");
    const group = groups.get(key);
    if (group) group.copies.push(copy);
    else groups.set(key, { label, copies: [copy] });
  }
  const out = [...groups].map(([key, g]) => ({
    key,
    label: g.label,
    copies: g.copies,
    summary: newOfferCopiesSummary(g.copies),
  }));
  const noIssue = out.findIndex((g) => g.key === "issue:none");
  if (noIssue >= 0) out.push(...out.splice(noIssue, 1));
  return out;
}
