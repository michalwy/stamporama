import "server-only";
import { prisma } from "./db";
import { buildItemFilterWhere } from "./items";
import { listableOnPlatformFilters, loadPoolChecklists } from "./lot-builder";
import { loadVariantChains } from "./checklist-variant-rollup";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { isOfferState, type OfferState } from "./offer-rules";
import { findCommittedCopies } from "./trade-reservations";
import type { CommittingTrade } from "./trade-reservation-rules";
import {
  findRecombinableSeries,
  RECOMBINABLE_OFFER_STATES,
  singlyOfferedCopies,
  type RecombinationCopy,
} from "./series-recombination-rules";

// The server half of the series-recombination screen (#1210; #754's design). Every rule the collector
// could describe — what counts as offered singly, what complete means, how many offers would change —
// is `series-recombination-rules.ts`. What lives here is the two pools, read, and the names the screen
// states the answer in.
//
// **Available is the bulk-lot builder's reading, imported rather than restated**
// (`listableOnPlatformFilters`): in hand, for sale, not in a non-terminal offer on the platform, not
// set aside for it, not held by an offer in active bidding anywhere. A second spelling would be a
// second place for the two screens to disagree about which copies are free.
//
// A copy promised in an **agreed trade is counted and named**, never excluded — #639's gate sits at
// `active`, and the bulk-lot builder keeps and names them for the same reason.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** An offer a filler copy sits in, named the way the offers list names it. */
export interface RecombinationOfferRef {
  offerId: string;
  offerNo: number;
  label: string;
  state: OfferState;
}

/** One copy that can fill a slot. */
export interface RecombinationFiller {
  itemId: string;
  itemNo: number;
  /** The copy's condition, abbreviated as the copy rows print it. */
  condition: string;
  /** The stamp the copy is **of**, when that is a variant filling its parent's slot (#661); null when
   *  the copy is the slot's own stamp. */
  variant: RecombinationStampName | null;
  /** The offers holding it singly on the platform. Empty: available — not offered there yet. */
  offers: RecombinationOfferRef[];
  /** The agreed trade the copy is promised in, if any (#639) — named, never a reason to leave it out. */
  promisedIn: CommittingTrade | null;
}

export interface RecombinationStampName {
  stampId: string;
  /** The leading catalogue number with its vendor and area prefix (`Mi·PL 865`), or null. */
  catalogNumber: string | null;
  name: string | null;
}

export interface RecombinationSlotView {
  stamp: RecombinationStampName;
  /** Available copies first. */
  fillers: RecombinationFiller[];
}

export interface RecombinationSeriesView {
  checklistId: string;
  checklistName: string;
  /** The issue the checklist belongs to; null for a checklist spanning issues. */
  issue: { issueId: string; name: string | null; year: number | null } | null;
  slots: RecombinationSlotView[];
  /** The **fewest** offers recombining would change — the screen says *at least*. */
  offersToChange: number;
  /** Of those, how many are live (Active or Paused). */
  liveOffersToChange: number;
}

export interface SeriesRecombinationResult {
  platformName: string;
  series: RecombinationSeriesView[];
}

/** A bid commits a copy (#334). Applied to the singles here because the pure rules only see the
 *  platform's own sets; the available pool carries the same clause inside `notOfferedPlatformId`. */
const NOT_IN_ACTIVE_BIDDING = {
  offerSetMemberships: { none: { offerSet: { offer: { state: "active", inActiveBidding: true } } } },
} as const;

/**
 * The series on one platform that single offers plus available copies could complete.
 *
 * Throws when the platform is not one of this collection's platforms: an empty answer would read as
 * "nothing to recombine" rather than "nothing asked".
 */
export async function findSeriesRecombinations(
  ownerId: string,
  collectionId: string,
  platformId: string
): Promise<SeriesRecombinationResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { name: true },
  });
  if (!platform) throw new Error("Platform not found.");

  const [availableRows, platformSets] = await Promise.all([
    buildItemFilterWhere(collectionId, listableOnPlatformFilters(platformId)).then((where) =>
      prisma.item.findMany({ where, select: { id: true, stampId: true } })
    ),
    prisma.offerSet.findMany({
      where: {
        offer: { collectionId, platformId, state: { in: [...RECOMBINABLE_OFFER_STATES] } },
      },
      select: {
        offerId: true,
        offer: { select: { state: true, inActiveBidding: true } },
        items: { select: { itemId: true } },
      },
    }),
  ]);

  const offerStates = new Map<string, OfferState>();
  for (const set of platformSets) {
    if (isOfferState(set.offer.state)) offerStates.set(set.offerId, set.offer.state);
  }
  const singles = singlyOfferedCopies(
    platformSets.flatMap((set) =>
      isOfferState(set.offer.state)
        ? [
            {
              offerId: set.offerId,
              state: set.offer.state,
              inActiveBidding: set.offer.inActiveBidding,
              itemIds: set.items.map((item) => item.itemId),
            },
          ]
        : []
    )
  );

  // The singles still have to be copies the collection holds: not sold, not traded away, not disposed
  // of — and not under a bid on some *other* platform.
  const availableIds = new Set(availableRows.map((row) => row.id));
  const singleIds = [...singles.keys()].filter((id) => !availableIds.has(id));
  const singleRows =
    singleIds.length === 0
      ? []
      : await prisma.item.findMany({
          where: {
            AND: [
              await buildItemFilterWhere(collectionId, { ids: singleIds, excludeGone: true }),
              NOT_IN_ACTIVE_BIDDING,
            ],
          },
          select: { id: true, stampId: true },
        });

  const rows = [
    ...availableRows.map((row) => ({ ...row, offerIds: [] as readonly string[] })),
    ...singleRows.map((row) => ({ ...row, offerIds: singles.get(row.id) ?? [] })),
  ];
  if (singleRows.length === 0) return { platformName: platform.name, series: [] };

  const chains = await loadVariantChains(collectionId, rows.map((row) => row.stampId));
  const copies: RecombinationCopy[] = rows.map((row) => ({
    itemId: row.id,
    stampId: row.stampId,
    variantChain: chains.get(row.stampId) ?? [row.stampId],
    offerIds: row.offerIds,
  }));
  const found = findRecombinableSeries({
    copies,
    checklists: await loadPoolChecklists(collectionId, copies),
    offerStates,
  });
  if (found.length === 0) return { platformName: platform.name, series: [] };

  return { platformName: platform.name, series: await nameSeries(collectionId, found) };
}

/** The names behind the ids: checklists and their issues, slot stamps, copies, offers and trades. */
async function nameSeries(
  collectionId: string,
  found: ReturnType<typeof findRecombinableSeries>
): Promise<RecombinationSeriesView[]> {
  const itemIds = new Set<string>();
  const stampIds = new Set<string>();
  const offerIds = new Set<string>();
  for (const series of found) {
    for (const slot of series.slots) {
      stampIds.add(slot.stampId);
      for (const copy of slot.copies) {
        itemIds.add(copy.itemId);
        stampIds.add(copy.stampId);
        for (const offerId of copy.offerIds) offerIds.add(offerId);
      }
    }
  }

  const [checklists, stamps, items, offers, commitments, labeller] = await Promise.all([
    prisma.checklist.findMany({
      where: { id: { in: found.map((series) => series.checklistId) }, collectionId },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        issue: { select: { id: true, name: true, year: true, primaryCatalogSortKey: true } },
      },
    }),
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId },
      select: { id: true, ...STAMP_LABEL_SELECT.stamp.select },
    }),
    prisma.item.findMany({
      where: { id: { in: [...itemIds] }, collectionId },
      select: { id: true, itemNo: true, condition: { select: { abbreviation: true, name: true } } },
    }),
    prisma.offer.findMany({
      where: { id: { in: [...offerIds] }, collectionId },
      select: {
        id: true,
        offerNo: true,
        name: true,
        state: true,
        sets: {
          select: {
            title: true,
            items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    }),
    findCommittedCopies(collectionId, [...itemIds]),
    makeOfferLabeller(collectionId),
  ]);

  const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const checklistById = new Map(checklists.map((checklist) => [checklist.id, checklist]));
  const promisedIn = new Map<string, CommittingTrade>();
  for (const commitment of commitments) {
    if (!promisedIn.has(commitment.itemId)) promisedIn.set(commitment.itemId, commitment.trade);
  }
  const offerById = new Map<string, RecombinationOfferRef>();
  for (const offer of offers) {
    if (!isOfferState(offer.state)) continue;
    offerById.set(offer.id, {
      offerId: offer.id,
      offerNo: offer.offerNo,
      label: offerDisplayLabel(offer.name, offer.sets, labeller),
      state: offer.state,
    });
  }

  const stampName = (stampId: string): RecombinationStampName => {
    const stamp = stampById.get(stampId);
    return {
      stampId,
      catalogNumber: stamp ? (labeller.catalogNumbers(stamp)[0] ?? null) : null,
      name: stamp?.name ?? null,
    };
  };

  const views = found.map((series): RecombinationSeriesView => {
    const checklist = checklistById.get(series.checklistId);
    return {
      checklistId: series.checklistId,
      checklistName: checklist?.name ?? "A set",
      issue: checklist?.issue
        ? { issueId: checklist.issue.id, name: checklist.issue.name, year: checklist.issue.year }
        : null,
      slots: series.slots.map((slot) => ({
        stamp: stampName(slot.stampId),
        fillers: slot.copies.map((copy) => {
          const item = itemById.get(copy.itemId);
          return {
            itemId: copy.itemId,
            itemNo: item?.itemNo ?? 0,
            condition: item?.condition.abbreviation || item?.condition.name || "",
            variant: copy.stampId === slot.stampId ? null : stampName(copy.stampId),
            offers: copy.offerIds.flatMap((offerId) => {
              const offer = offerById.get(offerId);
              return offer ? [offer] : [];
            }),
            promisedIn: promisedIn.get(copy.itemId) ?? null,
          };
        }),
      })),
      offersToChange: series.offersToChange.offerIds.length,
      liveOffersToChange: series.offersToChange.liveCount,
    };
  });

  // Issue by issue in catalogue order, as the Issues list reads; a checklist spanning issues last.
  const sortKeyOf = (view: RecombinationSeriesView) =>
    checklistById.get(view.checklistId)?.issue?.primaryCatalogSortKey ?? null;
  return views.sort((a, b) => {
    if ((a.issue === null) !== (b.issue === null)) return a.issue === null ? 1 : -1;
    const byCatalog = compareCatalogSortKeys(sortKeyOf(a), sortKeyOf(b));
    if (byCatalog !== 0) return byCatalog;
    const byIssue = (a.issue?.name ?? "").localeCompare(b.issue?.name ?? "");
    if (byIssue !== 0) return byIssue;
    const bySort =
      (checklistById.get(a.checklistId)?.sortOrder ?? 0) - (checklistById.get(b.checklistId)?.sortOrder ?? 0);
    return bySort !== 0 ? bySort : a.checklistName.localeCompare(b.checklistName);
  });
}
