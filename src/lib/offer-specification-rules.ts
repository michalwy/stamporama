// An offer's **specification** for buyers (#1758) — the pure half: which copies it lists, in what
// order, and what one row says. The read is `offer-specification.ts`.
//
// The specification is what a Facebook post promises "on request": exactly what the offer contains,
// copy by copy, for somebody deciding whether to bid. It is a packing list with nothing about packing
// and nothing about the sale — **no catalogue value, no price**, no shelf, no copy number, no buyer.
// That is why a row is a type of its own rather than a `PackingListRow` with columns switched off:
// a figure that is not on the type cannot be printed by mistake, in this form or in the plain-text
// and share-link forms that build on it (#1759, #1760).

import { checklistGroupsOf, type PlanChecklistSlot, type PlanCopy } from "./offer-photo-plan";
import { compareSets, sortSetItems, type SetItemOrderRow, type SetOrderRow } from "./offer-set-order";
import { renderTitleTemplate, type TitleTemplateCopy } from "./offer-title-template";
import { formatEntityNo } from "./quick-jump";

/** One copy of an offer set, as the specification orders it. */
export interface SpecificationCopyOrder extends SetItemOrderRow {
  /** The standard checklists the copy fills a slot of (#1673) — read only when the offer groups its
   *  photos by checklist; absent otherwise. */
  checklists?: readonly PlanChecklistSlot[];
}

/** One offer set, as the specification orders and filters it. */
export interface SpecificationSet extends SetOrderRow {
  /** Whether a sale line names this set — it sold through this very offer. */
  sold: boolean;
  items: readonly SpecificationCopyOrder[];
}

/**
 * The copies the specification lists, in the order it lists them.
 *
 * **What the offer holds now.** A set that sold through this offer is gone, and so is a copy that
 * sold anywhere else (`soldItemIds`): a partly sold offer lists what is left, and a buyer asking for
 * the specification is never shown a stamp somebody else already has. A copy held back by bidding on
 * another listing is still held, so it stays.
 *
 * **The order the photos are in.** Sets in their explicit order, each set's copies in catalogue order
 * or the collector's own (#306) — and where the offer groups its photos by checklist (#1673), each
 * checklist group's copies together, in the checklist's order, ahead of the set's ungrouped rest:
 * exactly the walk `offer-photo-plan.ts` makes, through the same `checklistGroupsOf`, so row *n* of
 * the specification and the stamp on the *n*th tile are read in the same sequence. A one-copy set is
 * never grouped, as it never is in the photos.
 */
export function specificationCopyOrder(
  sets: readonly SpecificationSet[],
  soldItemIds: ReadonlySet<string>,
  groupByChecklist: boolean
): string[] {
  const order: string[] = [];
  for (const set of [...sets].sort(compareSets)) {
    if (set.sold) continue;
    const copies = sortSetItems(set.items.filter((copy) => !soldItemIds.has(copy.itemId)));
    if (groupByChecklist && copies.length > 1) {
      const { groups, rest } = checklistGroupsOf(copies.map(asPlanCopy));
      for (const group of groups) for (const copy of group.copies) order.push(copy.itemId);
      for (const copy of rest) order.push(copy.itemId);
      continue;
    }
    for (const copy of copies) order.push(copy.itemId);
  }
  return order;
}

/** The grouping reads order fields and checklist slots only; the photo ids it never looks at. */
function asPlanCopy(copy: SpecificationCopyOrder): PlanCopy {
  return { ...copy, frontPhotoId: null, backPhotoId: null };
}

/** One row of the specification: one copy, as a buyer reads it. */
export interface OfferSpecificationRow {
  itemId: string;
  /** The copy's own scan for the thumbnail — its front, else its back; null with neither. */
  photoId: string | null;
  /** The area, as the offer's title names it (the area's title name, in the offer's language). */
  area: string | null;
  issue: string | null;
  year: number | null;
  /** Every catalogue number the copy carries, as `{catalog}` prints it in the offer's title — a
   *  cover or a fragment names each stamp on it (ADR-0044 §8). Empty when none is recorded. */
  catalog: string;
  /** The stamp's description — its name, in the offer's language. */
  description: string | null;
  condition: string | null;
  /** What is wrong with the piece (#1557), in the dictionary's order. Empty for a sound copy. */
  faults: string[];
  /** The copy's certificate, when it has one. */
  certificate: string | null;
}

/**
 * One row from a copy normalised for the offer's listing texts (`toTitleCopy`, in the offer's
 * language). Built from that shape on purpose: it is the one place the stamp, the issue, the
 * condition, the faults and the certificate are already resolved into the listing's language,
 * falling back field by field to the collection's own wording where a translation is missing — the
 * same words the offer's title and description use, which is what *written in the offer's language*
 * has to mean.
 */
export function specificationRow(
  itemId: string,
  copy: TitleTemplateCopy,
  photoId: string | null
): OfferSpecificationRow {
  return {
    itemId,
    photoId,
    area: copy.area,
    issue: copy.issueName,
    year: copy.year ?? copy.issueYear,
    catalog: renderTitleTemplate("{catalog}", [copy]),
    description: copy.name,
    condition: copy.condition,
    faults: [...(copy.faults ?? [])],
    certificate: copy.certificate,
  };
}

/** What the plain-text form needs of the specification — its header and its rows. */
export interface SpecificationTextSource {
  offerNo: number;
  title: string;
  rows: readonly OfferSpecificationRow[];
}

/**
 * The specification **as plain text** (#1759), for a buyer asking in a chat, where pasting a list is
 * quicker than attaching a PDF.
 *
 * The printable page's contents, line for line: a header naming the offer by its number and title,
 * then one line per copy, in the page's order, with the page's fields in the page's column order —
 * catalogue, area, series, year, stamp, condition, certificate. The thumbnail is the one field plain
 * text cannot carry. The faults qualify the condition, so they follow it in brackets, as they read
 * under it on the page. A field the copy does not have is left out rather than drawn as a dash: the
 * page's dash holds a column open, and a line has no columns to hold.
 */
export function specificationText(spec: SpecificationTextSource): string {
  const header = `${formatEntityNo(spec.offerNo)} · ${spec.title}`;
  return [header, ...spec.rows.map(specificationTextLine)].join("\n");
}

function specificationTextLine(row: OfferSpecificationRow): string {
  const faults = row.faults.join(", ");
  const condition = row.condition
    ? faults
      ? `${row.condition} (${faults})`
      : row.condition
    : faults;
  return [row.catalog, row.area, row.issue, row.year?.toString(), row.description, condition, row.certificate]
    .filter((field): field is string => !!field)
    .join(" · ");
}
