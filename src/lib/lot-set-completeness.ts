import "server-only";
import { prisma } from "./db";
import { NOT_TRADED_AWAY } from "./trade-exit";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, catalogLabel } from "./area-vendor";
import { computeForSaleSetCompleteness } from "./checklist-completeness-rules";
import { loadChecklistVariantRollup, rollUpStampIds } from "./checklist-variant-rollup";
import { IN_HAND_DELIVERY_STATES } from "./delivery-state";
import { loadIssuePrefixMap } from "./issue-prefix";
import { CHECKLIST_STAMP_ORDER } from "./checklists";

// How close a purchase lot's issues are to a **complete for-sale set** (#563) — the I/O half.
//
// Sorting a stockbook is exactly when complete series accumulate, and noticing them by memory does
// not scale past a few hundred pieces. The two useful answers are *this set is complete, list it*
// and *one more and it is complete*, the second being what makes a second pass through the parcel
// worthwhile — which is why the missing stamps are named rather than merely counted.
//
// Deliberately **not** `checklist-completeness.ts`, which answers a different question on a
// different screen: that one is one issue's whole disposition × condition grid off every copy held,
// read on the issue's own page. This is one cell of it — for sale, any condition — asked of the
// issues a *lot* touches, over a narrower counting set, with the gap named. Two questions, and the
// only thing they share is the pure rule both call.
//
// Not #133's matrix either (disposition × condition × format, complete-set counts): that is a fuller
// answer on the Issues list, and this is the narrow slice a sorting pass needs. If #133's reusable
// service lands, this becomes a caller of it.

/** One checklist of one issue, ready to render. */
export interface ChecklistSetCompleteness {
  checklistId: string;
  /** The checklist's name — printed only where an issue carries more than one (ADR-0031). */
  name: string;
  /** Stamps on the checklist: the denominator of {@link owned}. */
  requiredCount: number;
  /** Of those, the ones the collection holds an in-hand for-sale copy of, **anywhere**. */
  owned: number;
  /** Of the owned ones, the ones this lot (or order) contributed — the quiet second figure. */
  fromHere: number;
  /** How many stamps are still missing — always printed, because a chip naming three of them out of
   *  eighteen otherwise leaves *how many am I still short* to be worked out by subtraction. */
  missingCount: number;
  /**
   * The missing stamps by catalog number — **one entry per stamp**, in the issue's own hand-set
   * stamp order (#549). Empty when nothing is missing.
   *
   * Formatted **server-side**, as the derived lot label already is (#172): the numbering needs the
   * area tree and the per-issue prefix overrides, both of which are read here anyway.
   *
   * Deliberately **no longer collapsed into runs** (#572). #563 sent `Mi·PL 3-6`, `9`, `11` because
   * the chip printed three of them inline and the runs were what it truncated; the list has since
   * moved into the popover and is drawn as one catalog-number chip per stamp, and neither half of a
   * run survives that — `3-6` is not a catalogue number, and a continuation entry has lost the
   * prefix that made the first one readable. Naming each missing stamp is also what the popover is
   * for: it is a list of things to go and look for.
   */
  missing: string[];
}

/** Every checklist of one issue on a lot's issue-group header, in the issue's own checklist order. */
export type SetCompletenessByIssue = Record<string, ChecklistSetCompleteness[]>;

/** Whose copies count as *from here* — one lot, or a whole order in the by-issue view across it. */
export type LotSetScope = { lotId: string } | { purchaseId: string };

function scopeWhere(scope: LotSetScope) {
  return "lotId" in scope ? { lotId: scope.lotId } : { lot: { purchaseId: scope.purchaseId } };
}

/**
 * What the figure counts, in one place.
 *
 * **For sale**, because the claim is that a series can go out as one offer set. **In hand**
 * (`IN_HAND_DELIVERY_STATES`, off `COPY_BUCKETS`), because a copy still `ordered` or `in_transit` is
 * bought — every other count in the app rightly includes it — and a set one copy of which is in the
 * post cannot be listed. Sold and disposed-of copies are out for `copy-counts.ts`'s own reasons: a
 * copy that has left is not stock.
 *
 * The lot-scoped read adds one clause to *this* object rather than restating it, so the headline
 * figure and the one beside it can never be taken over different sets — which is the whole reason
 * `fromHere` is allowed to sit on the same line.
 */
function forSaleStockWhere(collectionId: string, stampIds: string[]) {
  return {
    collectionId,
    stampId: { in: stampIds },
    forSale: true,
    saleLineItems: { none: {} },
    // …nor one already given to a partner (#644): it is not stock, whatever its disposition says.
    ...NOT_TRADED_AWAY,
    disposedAt: null,
    deliveryState: { in: [...IN_HAND_DELIVERY_STATES] },
  };
}

/** The distinct stamps of `stampIds` that `where` matches — the two sets the pure rule takes. */
async function stampsWithStock(where: ReturnType<typeof forSaleStockWhere>): Promise<string[]> {
  const rows = await prisma.item.groupBy({ by: ["stampId"], where });
  return rows.map((r) => r.stampId);
}

/**
 * Per-checklist for-sale completeness for a set of issues, batched.
 *
 * **Batched over the issues, never per row.** A lot's copies are cursor-paged, but its issue *groups*
 * are not — `getLotIntakeSummary` computes them whole — so the whole screen's answer is a fixed
 * handful of queries however many copies scroll past. That is #133's stated reason for keeping the
 * full breakdown in a popup rather than on a list, and it is why this one may sit on a header.
 *
 * `issueIds` are the groups actually on screen. An issue with no checklists answers with an empty
 * array rather than being absent, so the caller cannot mistake "this issue is no set" for "not
 * loaded yet".
 */
export async function getLotSetCompleteness(
  ownerId: string,
  collectionId: string,
  issueIds: string[],
  scope: LotSetScope
): Promise<SetCompletenessByIssue> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }

  const ids = [...new Set(issueIds)];
  if (ids.length === 0) return {};

  const checklists = await prisma.checklist.findMany({
    where: { collectionId, issueId: { in: ids } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      issueId: true,
      name: true,
      // The stamps a set is still missing are named in the order the set reads (#764).
      stamps: { select: { stampId: true }, orderBy: [...CHECKLIST_STAMP_ORDER] },
      issue: { select: { collectionAreaId: true } },
    },
  });
  const byIssue: SetCompletenessByIssue = Object.fromEntries(ids.map((id) => [id, []]));
  if (checklists.length === 0) return byIssue;

  // One read of the stock for **every** checklist on screen, however many issues they span — the
  // overlap between a basic set and its specialized counterpart is exactly the case that must not
  // be counted twice, and `getIssueCompleteness` shares the reasoning.
  const stampIds = [...new Set(checklists.flatMap((c) => c.stamps.map((s) => s.stampId)))];
  // The stock read reaches below the membership (#661): a `226yw` in the stockbook is a `226` for
  // the set it completes, and a set is listable out of the copies actually held.
  const rollup = await loadChecklistVariantRollup(collectionId, stampIds);
  const counting = rollup.countingStampIds;
  const [stock, fromLot] = await Promise.all([
    stampsWithStock(forSaleStockWhere(collectionId, counting)),
    stampsWithStock({ ...forSaleStockWhere(collectionId, counting), ...scopeWhere(scope) }),
  ]);

  const computed = checklists.map((c) => {
    // Per checklist, since which member a variant copy answers for depends on what this one names.
    const members = new Set(c.stamps.map((s) => s.stampId));
    return {
      checklist: c,
      result: computeForSaleSetCompleteness(
        [...members],
        rollUpStampIds(stock, rollup, members),
        rollUpStampIds(fromLot, rollup, members)
      ),
    };
  });

  // Only the stamps actually missing are read back for their numbers — on a well-stocked parcel that
  // is nothing at all, and on a thin one it is bounded by the checklists on screen. The area tree and
  // the prefix overrides exist **only** to format those numbers, so they sit behind the same guard: a
  // card whose every series is complete is the good case and should cost nothing to say so.
  const missingIds = [...new Set(computed.flatMap((c) => c.result.missingStampIds))];
  if (missingIds.length === 0) {
    for (const { checklist, result } of computed) {
      if (!checklist.issueId) continue;
      byIssue[checklist.issueId].push(describe(checklist, result, []));
    }
    return byIssue;
  }

  const [missingStamps, areas, prefixByIssue] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: missingIds }, collectionId },
      select: {
        id: true,
        name: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        // #549's hand-set tree order, so the gap is named in the order the collector arranged
        // the issue in rather than in whatever order the join came back.
        issueMemberships: { select: { issueId: true, sortOrder: true } },
      },
    }),
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const missingById = new Map(missingStamps.map((s) => [s.id, s]));
  const maps = buildAreaVendorMaps(areas, prefixByIssue);

  for (const { checklist, result } of computed) {
    // A checklist reached through `issueId in ids` always has one; the guard is for the type.
    const issueId = checklist.issueId;
    if (!issueId) continue;
    const areaId = checklist.issue?.collectionAreaId ?? null;

    // Numbered against the **issue's** area and prefix overrides — the very map the header's own
    // catalog chips are drawn with, so a stamp named as missing reads like the chips above it.
    const missing = result.missingStampIds
      .map((id) => missingById.get(id))
      .filter((s) => s != null)
      .sort(
        (a, b) =>
          (a.issueMemberships.find((m) => m.issueId === issueId)?.sortOrder ?? 0) -
          (b.issueMemberships.find((m) => m.issueId === issueId)?.sortOrder ?? 0)
      )
      .map((s) =>
        catalogLabel({ areaId, issueId, catalogNumbers: s.catalogNumbers, name: s.name }, maps)
      );

    byIssue[issueId].push(describe(checklist, result, missing));
  }
  return byIssue;
}

function describe(
  checklist: { id: string; name: string },
  result: { requiredCount: number; owned: number; fromHere: number; missingStampIds: string[] },
  missing: string[]
): ChecklistSetCompleteness {
  return {
    checklistId: checklist.id,
    name: checklist.name,
    requiredCount: result.requiredCount,
    owned: result.owned,
    fromHere: result.fromHere,
    missingCount: result.missingStampIds.length,
    missing,
  };
}
