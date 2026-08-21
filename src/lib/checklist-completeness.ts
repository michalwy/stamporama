import "server-only";
import { prisma } from "./db";
import { UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import {
  computeChecklistCompleteness,
  type CompletenessCount,
  type ChecklistCompletenessGrid,
} from "./checklist-completeness-rules";
import { loadChecklistVariantRollup, rollUpCounts } from "./checklist-variant-rollup";

// The I/O half of #519's completeness card, per checklist since #531: one `groupBy` over every
// stamp on the issue's checklists, split back out into one pure grid each. Deliberately **not** on
// the issues list — this is one issue's question, and the list keeps #54's lightweight indicator
// (the reasoning #133 wrote down). The format axis rides on the same `groupBy` — one more `by`
// column, no second query — because a format breakdown is a regrouping of the copies already read,
// never a different set of them.
//
// The `groupBy` reaches **below** the membership (#661): a copy filed under a variant of a listed
// stamp is a copy of it, so `checklist-variant-rollup.ts` widens the read to those children and
// says which member each row answers for.

/** One checklist's grid, named so the card can label it. */
export interface ChecklistCompleteness extends ChecklistCompletenessGrid {
  checklistId: string;
  name: string;
}

/** Every checklist of one issue, plus the dictionaries they are laid out against. */
export interface IssueCompleteness {
  checklists: ChecklistCompleteness[];
  conditions: { id: string; name: string; abbreviation: string }[];
  /** The multiples only — a single has no row (ADR-0020) and the card names it itself. Sent whole
   *  so the card can label a format grid; which ones it draws is the grid's own sparse answer. */
  formats: { id: string; name: string; abbreviation: string }[];
}

/**
 * How complete each of an issue's checklists is, from the copies actually held. Exclusions are
 * `copy-counts.ts`'s exactly — sold, disposed and never-usably-delivered copies are not held — so
 * this card and the copy-count badge beside it cannot disagree about what "having one" means.
 */
export async function getIssueCompleteness(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueCompleteness> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }

  const [checklists, conditions, formats] = await Promise.all([
    prisma.checklist.findMany({
      where: { collectionId, issueId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, stamps: { select: { stampId: true } } },
    }),
    prisma.stampCondition.findMany({
      where: { collectionId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.stampFormat.findMany({
      where: { collectionId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);

  // One `groupBy` for the whole issue, however many checklists it carries — the overlap between a
  // basic set and its specialized counterpart is exactly the case that must not be counted twice.
  const stampIds = [...new Set(checklists.flatMap((c) => c.stamps.map((s) => s.stampId)))];
  const rollup = await loadChecklistVariantRollup(collectionId, stampIds);
  const rows =
    rollup.countingStampIds.length === 0
      ? []
      : await prisma.item.groupBy({
          by: ["stampId", "conditionId", "formatId", "inCollection", "forSale", "forTrade"],
          where: {
            collectionId,
            stampId: { in: rollup.countingStampIds },
            saleLineItems: { none: {} },
            disposedAt: null,
            deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
          },
          _count: { _all: true },
        });

  const counts: CompletenessCount[] = rows.map((r) => ({
    stampId: r.stampId,
    conditionId: r.conditionId,
    formatId: r.formatId,
    inCollection: r.inCollection,
    forSale: r.forSale,
    forTrade: r.forTrade,
    count: r._count._all,
  }));
  const conditionIds = conditions.map((c) => c.id);
  const formatIds = formats.map((f) => f.id);

  return {
    checklists: checklists.map((c) => {
      // Per checklist, because the member a copy answers for is a question about *this*
      // membership: the same variant copy is its umbrella on the basic list and itself on the
      // specialized one (#661).
      const members = new Set(c.stamps.map((s) => s.stampId));
      return {
        checklistId: c.id,
        name: c.name,
        ...computeChecklistCompleteness(
          [...members],
          rollUpCounts(counts, rollup, members),
          conditionIds,
          formatIds
        ),
      };
    }),
    conditions,
    formats,
  };
}
