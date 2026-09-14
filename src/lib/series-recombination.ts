import "server-only";
import { prisma } from "./db";
import { buildItemFilterWhere, type ItemListFiltersPaginated } from "./items";
import { listableOnPlatformFilters, loadPoolChecklists } from "./lot-builder";
import { loadVariantChains } from "./checklist-variant-rollup";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { isOfferState, type OfferState } from "./offer-rules";
import { findCommittedCopies } from "./trade-reservations";
import type { CommittingTrade } from "./trade-reservation-rules";
import { checklistSlots } from "./lot-builder-rules";
import { createOffer, OfferActionBlockedError, syncGeneratedTexts } from "./offers";
import { markListingContentChanged } from "./offer-listing-sync";
import { formatItemNo } from "./item-number";
import { sortPhotos, type PhotoSummary } from "./photos";
import {
  checkSeriesPicks,
  collapseCandidates,
  compositionOutcome,
  copyMatchesCombination,
  DEFAULT_SERIES_CRITERIA,
  findRecombinableSeries,
  RECOMBINABLE_OFFER_STATES,
  singlyOfferedCopies,
  type CompositionRefusal,
  type RecombinationCopy,
  type SeriesCombination,
  type SeriesCriteria,
  type SeriesPicks,
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
//
// **A copy no longer held never fills a slot** (#1263), by either route: the available pool carries
// `excludeGone` inside `listableOnPlatformFilters`, and the singles are read under it too — so a sold
// copy whose offer was left Active is still sold.
//
// The screen's filters (#1265) narrow **both** pools in the `where`, before completeness is judged, so
// a series complete only thanks to a filtered-out copy is not listed; how the copies are split into
// proposals is the rules' `SeriesCombination`.
//
// Composing a listed series (#1211) lives here too, because it has to read the same two pools the
// screen lists from: the commit re-reads them rather than trusting what the screen showed (#717).

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
  /** Every set the offer holds — what tells the compose preview whether taking one out empties it. */
  setCount: number;
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
  /** The copy's own photos, front and back first (#1266) — which copy suits the set is judged by
   *  looking at it. Empty: the copy has none, and the card says so. */
  photos: PhotoSummary[];
}

/** Identical candidates for a slot, collapsed into one line (#1266): the same stamp, condition,
 *  certificate status and format, from the same place. */
export interface RecombinationCandidateGroup {
  key: string;
  /** Into the slot's `fillers`, lowest inventory number first — the first is the copy the collapsed
   *  line chooses. */
  itemIds: string[];
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
  /** The same fillers collapsed into identical groups (#1266), available groups first. */
  candidates: RecombinationCandidateGroup[];
}

export interface RecombinationSeriesView {
  /** The proposal's identity — one checklist is proposed once per combination (#1265). */
  key: string;
  checklistId: string;
  checklistName: string;
  /** What every copy in the proposal shares; what composing it sends back. */
  combination: SeriesCombination;
  /** The combination in words, one per axis that is not mixed: condition, certificate, format. */
  combinationLabels: string[];
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

/** Both pools on one platform, read once — what the screen lists from and what the compose re-reads. */
interface RecombinationPool {
  platformName: string;
  /** Available copies (no offer ids) and single copies (the offers holding them singly). */
  copies: RecombinationCopy[];
  /** Whether any copy is offered singly at all. None: there is nothing to recombine. */
  hasSingles: boolean;
  /** The state of every open offer on the platform. */
  offerStates: Map<string, OfferState>;
  /** Every set of those offers, which is where a composed copy's one-copy set is found. */
  sets: { setId: string; offerId: string; itemIds: string[] }[];
}

/** The screen's four filters as the copy reads spell them (#1265). An empty filter is no filter. */
function criteriaFilters(criteria: SeriesCriteria): ItemListFiltersPaginated {
  return {
    ...(criteria.conditionIds.length > 0 ? { conditionIds: criteria.conditionIds } : {}),
    ...(criteria.certificateStatusIds.length > 0
      ? { certificateStatusIds: criteria.certificateStatusIds }
      : {}),
    ...(criteria.formatIds.length > 0 ? { formatIds: criteria.formatIds } : {}),
    ...(criteria.subtypeIds.length > 0 ? { subtypeIds: criteria.subtypeIds } : {}),
  };
}

const POOL_COPY_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
} as const;

async function readRecombinationPool(
  ownerId: string,
  collectionId: string,
  platformId: string,
  criteria: SeriesCriteria,
  /** Stop before the variant chains when nothing is offered singly — the screen then has nothing to
   *  list, while the compose still needs the available copies to check its picks against. */
  opts: { stopWithoutSingles: boolean }
): Promise<RecombinationPool> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { name: true },
  });
  if (!platform) throw new Error("Platform not found.");

  const [availableRows, platformSets] = await Promise.all([
    buildItemFilterWhere(collectionId, {
      ...listableOnPlatformFilters(platformId),
      ...criteriaFilters(criteria),
    }).then((where) => prisma.item.findMany({ where, select: POOL_COPY_SELECT })),
    prisma.offerSet.findMany({
      where: {
        offer: { collectionId, platformId, state: { in: [...RECOMBINABLE_OFFER_STATES] } },
      },
      select: {
        id: true,
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
  // of (#1263 — whatever state the offer holding them was left in) — and not under a bid on some
  // *other* platform. The screen's filters narrow them exactly as they narrow the available copies.
  const availableIds = new Set(availableRows.map((row) => row.id));
  const singleIds = [...singles.keys()].filter((id) => !availableIds.has(id));
  const singleRows =
    singleIds.length === 0
      ? []
      : await prisma.item.findMany({
          where: {
            AND: [
              await buildItemFilterWhere(collectionId, {
                ids: singleIds,
                excludeGone: true,
                ...criteriaFilters(criteria),
              }),
              NOT_IN_ACTIVE_BIDDING,
            ],
          },
          select: POOL_COPY_SELECT,
        });

  const rows = [
    ...availableRows.map((row) => ({ ...row, offerIds: [] as readonly string[] })),
    ...singleRows.map((row) => ({ ...row, offerIds: singles.get(row.id) ?? [] })),
  ];
  const sets = platformSets.map((set) => ({
    setId: set.id,
    offerId: set.offerId,
    itemIds: set.items.map((item) => item.itemId),
  }));
  const hasSingles = singleRows.length > 0;
  if (!hasSingles && opts.stopWithoutSingles) {
    return { platformName: platform.name, copies: [], hasSingles, offerStates, sets };
  }

  const chains = await loadVariantChains(collectionId, rows.map((row) => row.stampId));
  const copies: RecombinationCopy[] = rows.map((row) => ({
    itemId: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    variantChain: chains.get(row.stampId) ?? [row.stampId],
    offerIds: row.offerIds,
  }));
  return { platformName: platform.name, copies, hasSingles, offerStates, sets };
}

/**
 * The series on one platform that single offers plus available copies could complete, one proposal
 * per combination the criteria keep apart (#1265).
 *
 * Throws when the platform is not one of this collection's platforms: an empty answer would read as
 * "nothing to recombine" rather than "nothing asked".
 */
export async function findSeriesRecombinations(
  ownerId: string,
  collectionId: string,
  platformId: string,
  criteria: SeriesCriteria = DEFAULT_SERIES_CRITERIA
): Promise<SeriesRecombinationResult> {
  const pool = await readRecombinationPool(ownerId, collectionId, platformId, criteria, {
    stopWithoutSingles: true,
  });
  if (!pool.hasSingles) return { platformName: pool.platformName, series: [] };

  const found = findRecombinableSeries({
    copies: pool.copies,
    checklists: await loadPoolChecklists(collectionId, pool.copies),
    offerStates: pool.offerStates,
    mixing: criteria.mixing,
  });
  if (found.length === 0) return { platformName: pool.platformName, series: [] };

  return { platformName: pool.platformName, series: await nameSeries(collectionId, found) };
}

// ── Composing a series (#1211) ──────────────────────────────────────────────────────────────────

export interface ComposeSeriesInput {
  platformId: string;
  checklistId: string;
  /** The card's combination (#1265): only copies sharing it are candidates, so a pick of another
   *  combination is refused as stale rather than composed in. */
  combination: SeriesCombination;
  /** The screen's criteria, re-applied to the re-read. Absent: the default screen. */
  criteria?: SeriesCriteria;
  /** The copy chosen for every slot, keyed by the slot's stamp. */
  picks: SeriesPicks;
}

export interface ComposeSeriesResult {
  offerId: string;
  /** How many copies the new offer's one set holds. */
  copies: number;
  /** Single offers left with nothing in them, and withdrawn. */
  withdrawnOffers: number;
  /** Of those, how many were live — their listings have to be taken down on the platform. */
  withdrawnLiveOffers: number;
  /** Live single offers that lost a set and kept others, now flagged as changed after listing. */
  changedLiveOffers: number;
}

/**
 * Compose a listed series into one new offer, out of the copies the collector chose (#1211).
 *
 * **Re-reads; it is never handed a plan** (#717). The pool is read again exactly as the screen reads
 * it and the picks are checked against it (`checkSeriesPicks`): a copy that has since sold, gone
 * under bid, been composed into another set or left the collection refuses the commit **by name**,
 * and nothing is written — a series is atomic, and #314's rule is that a missing piece is named.
 *
 * Writes, all in one transaction (`createOffer`'s own, through its `inTransaction` hook):
 *
 * - a new **Preparing** offer on the platform holding **one set** with the chosen copies in the
 *   checklist's order — a series is one sellable unit (ADR-0013 §2), as the lot builder commits;
 * - for every chosen copy that was offered singly, **its one-copy set is taken out** of each offer
 *   holding it that way; the offers' other sets stay;
 * - an offer left with **no sets is withdrawn**;
 * - a **live** offer that lost a set and kept others is flagged as changed after listing (#542). A
 *   withdrawn one is not: a closed listing is history, and the flag only reads on a listed state.
 *
 * Inside the transaction the removed sets are asked again — still one copy, still in an open offer,
 * still not under bid, never sold through — and the withdrawn offers are withdrawn only while they
 * hold nothing, so a change landing between the read and the write rolls the whole commit back.
 */
export async function composeSeriesOffer(
  ownerId: string,
  collectionId: string,
  input: ComposeSeriesInput
): Promise<ComposeSeriesResult> {
  const pool = await readRecombinationPool(
    ownerId,
    collectionId,
    input.platformId,
    input.criteria ?? DEFAULT_SERIES_CRITERIA,
    { stopWithoutSingles: false }
  );
  const checklist = await prisma.checklist.findFirst({
    where: { id: input.checklistId, collectionId },
    select: { stamps: { select: { stampId: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!checklist) throw new Error("Series not found.");

  // Exactly the card's copies (#1265): another combination's copy never fills a slot here, even one
  // the same checklist would take under different settings.
  const candidates = pool.copies.filter((copy) => copyMatchesCombination(copy, input.combination));
  const slots = [
    ...checklistSlots(candidates, {
      checklistId: input.checklistId,
      stampIds: checklist.stamps.map((member) => member.stampId),
    }),
  ].map(([stampId, copies]) => ({ stampId, copies }));
  const check = checkSeriesPicks(slots, input.picks);
  if (!check.ok) {
    throw new OfferActionBlockedError("not-eligible", await describeRefusal(collectionId, check.refusal));
  }

  const setCounts = new Map<string, number>();
  for (const set of pool.sets) setCounts.set(set.offerId, (setCounts.get(set.offerId) ?? 0) + 1);
  const outcome = compositionOutcome(
    check.copies,
    new Map(
      [...setCounts].flatMap(([offerId, setCount]) => {
        const state = pool.offerStates.get(offerId);
        return state ? [[offerId, { state, setCount }] as const] : [];
      })
    )
  );
  const setIds = check.copies.flatMap((copy) =>
    pool.sets
      .filter(
        (set) =>
          copy.offerIds.includes(set.offerId) &&
          set.itemIds.length === 1 &&
          set.itemIds[0] === copy.itemId
      )
      .map((set) => set.setId)
  );
  const withdrawnIds = outcome.filter((change) => change.withdrawn).map((change) => change.offerId);
  const keptIds = outcome.filter((change) => !change.withdrawn).map((change) => change.offerId);
  const itemIds = check.copies.map((copy) => copy.itemId);
  const changedSince = () =>
    new OfferActionBlockedError(
      "not-eligible",
      "The offers changed while the series was being composed. Nothing was changed — open the screen again."
    );

  const offerId = await createOffer(
    ownerId,
    collectionId,
    {
      platformId: input.platformId,
      url: null,
      // A draft states no figure yet, as the lot builder's commit does.
      price: "0.00",
      currency: "",
      listingDate: null,
      state: "preparing",
    },
    {
      seedItemIds: itemIds,
      inTransaction: async (tx, newOfferId) => {
        // `createOffer` drops a copy that sold or left the collection since the check rather than
        // refusing; for a series that is a hole, so it refuses here instead.
        const seeded = await tx.offerSetItem.count({ where: { offerSet: { offerId: newOfferId } } });
        if (seeded !== itemIds.length) throw changedSince();

        const leaving = await tx.offerSet.findMany({
          where: {
            id: { in: setIds },
            saleLines: { none: {} },
            offer: {
              collectionId,
              platformId: input.platformId,
              state: { in: [...RECOMBINABLE_OFFER_STATES] },
              NOT: { state: "active", inActiveBidding: true },
            },
          },
          select: { _count: { select: { items: true } } },
        });
        if (leaving.length !== setIds.length || leaving.some((set) => set._count.items !== 1)) {
          throw changedSince();
        }
        await tx.offerSet.deleteMany({ where: { id: { in: setIds } } });

        if (withdrawnIds.length > 0) {
          const withdrawn = await tx.offer.updateMany({
            where: { id: { in: withdrawnIds }, sets: { none: {} } },
            // `closedAt` (#512) is stamped with the state, as on a withdrawal by hand.
            data: { state: "withdrawn", closedAt: new Date() },
          });
          if (withdrawn.count !== withdrawnIds.length) throw changedSince();
        }
        await markListingContentChanged(keptIds, tx);
      },
    }
  );

  // The offers that kept something list fewer sets now; texts still following a template say so,
  // exactly as after a set is removed by hand. A withdrawn offer's texts are a record and stay.
  for (const id of keptIds) await syncGeneratedTexts(ownerId, id);

  return {
    offerId,
    copies: itemIds.length,
    withdrawnOffers: withdrawnIds.length,
    withdrawnLiveOffers: outcome.filter((change) => change.withdrawn && change.live).length,
    changedLiveOffers: outcome.filter((change) => !change.withdrawn && change.live).length,
  };
}

/** A refusal in the collector's words: the copy by its number, the slot by its stamp. */
async function describeRefusal(collectionId: string, refusal: CompositionRefusal): Promise<string> {
  const [stamp, labeller] = await Promise.all([
    prisma.stamp.findFirst({
      where: { id: refusal.stampId, collectionId },
      select: STAMP_LABEL_SELECT.stamp.select,
    }),
    makeOfferLabeller(collectionId),
  ]);
  const slot = stamp ? (labeller.catalogNumbers(stamp)[0] ?? stamp.name ?? "a stamp") : "a stamp";
  switch (refusal.kind) {
    case "unchosen":
      return `Choose which copy fills ${slot} first.`;
    case "not-a-slot":
      return `${slot} is not part of this series.`;
    case "stale": {
      const item = await prisma.item.findFirst({
        where: { id: refusal.itemId, collectionId },
        select: { itemNo: true },
      });
      const copy = item ? `Copy ${formatItemNo(item.itemNo)}` : "The copy chosen";
      return `${copy} can no longer fill ${slot} — since the screen was opened it has sold, gone under bid, gone into another set, left the collection or stopped matching this series' condition, certificate or format. Nothing was changed.`;
    }
  }
}

/** The names behind the ids: checklists and their issues, slot stamps, copies, offers and trades. */
async function nameSeries(
  collectionId: string,
  found: ReturnType<typeof findRecombinableSeries>
): Promise<RecombinationSeriesView[]> {
  const itemIds = new Set<string>();
  const stampIds = new Set<string>();
  const offerIds = new Set<string>();
  const conditionIds = new Set<string>();
  const certificateIds = new Set<string>();
  const formatIds = new Set<string>();
  for (const series of found) {
    const { conditionId, certificateStatusId, formatId } = series.combination;
    if (conditionId) conditionIds.add(conditionId);
    if (certificateStatusId) certificateIds.add(certificateStatusId);
    if (formatId) formatIds.add(formatId);
    for (const slot of series.slots) {
      stampIds.add(slot.stampId);
      for (const copy of slot.copies) {
        itemIds.add(copy.itemId);
        stampIds.add(copy.stampId);
        for (const offerId of copy.offerIds) offerIds.add(offerId);
      }
    }
  }

  const dictionarySelect = { id: true, name: true, sortOrder: true } as const;
  const [conditions, certificates, formats] = await Promise.all([
    prisma.stampCondition.findMany({ where: { id: { in: [...conditionIds] }, collectionId }, select: dictionarySelect }),
    prisma.certificateStatus.findMany({ where: { id: { in: [...certificateIds] }, collectionId }, select: dictionarySelect }),
    prisma.stampFormat.findMany({ where: { id: { in: [...formatIds] }, collectionId }, select: dictionarySelect }),
  ]);
  const conditionById = new Map(conditions.map((row) => [row.id, row]));
  const certificateById = new Map(certificates.map((row) => [row.id, row]));
  const formatById = new Map(formats.map((row) => [row.id, row]));

  /** The combination in words, and a rank per axis in the dictionaries' own order — a null value
   *  (*No certificate*, *Single*) first, as the filters list it. */
  const describe = (combination: SeriesCombination) => {
    const labels: string[] = [];
    const rank: number[] = [];
    if (combination.conditionId !== undefined) {
      const row = conditionById.get(combination.conditionId);
      labels.push(row?.name ?? "Unknown condition");
      rank.push(row?.sortOrder ?? 0);
    }
    if (combination.certificateStatusId !== undefined) {
      const row = combination.certificateStatusId ? certificateById.get(combination.certificateStatusId) : null;
      labels.push(combination.certificateStatusId === null ? "No certificate" : (row?.name ?? "Unknown certificate"));
      rank.push(combination.certificateStatusId === null ? -1 : (row?.sortOrder ?? 0));
    }
    if (combination.formatId !== undefined) {
      const row = combination.formatId ? formatById.get(combination.formatId) : null;
      labels.push(combination.formatId === null ? "Single" : (row?.name ?? "Unknown format"));
      rank.push(combination.formatId === null ? -1 : (row?.sortOrder ?? 0));
    }
    return { labels, rank };
  };

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
      select: {
        id: true,
        itemNo: true,
        condition: { select: { abbreviation: true, name: true } },
        photos: { select: { id: true, role: true, title: true, sortOrder: true } },
      },
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
      setCount: offer.sets.length,
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

  const rankByKey = new Map<string, number[]>();
  const views = found.map((series): RecombinationSeriesView => {
    const checklist = checklistById.get(series.checklistId);
    const { labels, rank } = describe(series.combination);
    rankByKey.set(series.key, rank);
    return {
      key: series.key,
      checklistId: series.checklistId,
      checklistName: checklist?.name ?? "A set",
      combination: series.combination,
      combinationLabels: labels,
      issue: checklist?.issue
        ? { issueId: checklist.issue.id, name: checklist.issue.name, year: checklist.issue.year }
        : null,
      slots: series.slots.map((slot) => ({
        stamp: stampName(slot.stampId),
        candidates: collapseCandidates(
          slot.copies.map((copy) => ({ ...copy, itemNo: itemById.get(copy.itemId)?.itemNo ?? 0 }))
        ).map((group) => ({ key: group.key, itemIds: group.copies.map((copy) => copy.itemId) })),
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
            photos: (item?.photos ?? [])
              .map((photo): PhotoSummary => ({
                ...photo,
                role: photo.role === "front" || photo.role === "back" || photo.role === "main" ? photo.role : null,
              }))
              .sort(sortPhotos),
          };
        }),
      })),
      offersToChange: series.offersToChange.offerIds.length,
      liveOffersToChange: series.offersToChange.liveCount,
    };
  });

  // Issue by issue in catalogue order, as the Issues list reads; a checklist spanning issues last. One
  // checklist's proposals sit together, in the dictionaries' order (#1265).
  const sortKeyOf = (view: RecombinationSeriesView) =>
    checklistById.get(view.checklistId)?.issue?.primaryCatalogSortKey ?? null;
  const byCombination = (a: RecombinationSeriesView, b: RecombinationSeriesView) => {
    const ra = rankByKey.get(a.key) ?? [];
    const rb = rankByKey.get(b.key) ?? [];
    for (let i = 0; i < Math.max(ra.length, rb.length); i += 1) {
      if ((ra[i] ?? 0) !== (rb[i] ?? 0)) return (ra[i] ?? 0) - (rb[i] ?? 0);
    }
    return a.combinationLabels.join(" ").localeCompare(b.combinationLabels.join(" ")) || a.key.localeCompare(b.key);
  };
  return views.sort((a, b) => {
    if ((a.issue === null) !== (b.issue === null)) return a.issue === null ? 1 : -1;
    const byCatalog = compareCatalogSortKeys(sortKeyOf(a), sortKeyOf(b));
    if (byCatalog !== 0) return byCatalog;
    const byIssue = (a.issue?.name ?? "").localeCompare(b.issue?.name ?? "");
    if (byIssue !== 0) return byIssue;
    const bySort =
      (checklistById.get(a.checklistId)?.sortOrder ?? 0) - (checklistById.get(b.checklistId)?.sortOrder ?? 0);
    if (bySort !== 0) return bySort;
    const byName = a.checklistName.localeCompare(b.checklistName);
    if (byName !== 0) return byName;
    if (a.checklistId !== b.checklistId) return a.checklistId.localeCompare(b.checklistId);
    return byCombination(a, b);
  });
}
