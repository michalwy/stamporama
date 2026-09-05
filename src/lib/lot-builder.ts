import "server-only";
import { prisma } from "./db";
import { areaSubtreeIds } from "./areas";
import { loadVariantChains } from "./checklist-variant-rollup";
import { getCollectionBaseCurrency } from "./pricing";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  buildItemFilterWhere,
  valuateItemRows,
  listItemsPaginated,
  type ItemListFiltersPaginated,
  type ItemListItem,
  type ValuationRow,
} from "./items";
import {
  capBoundedCapacity,
  checklistCoverage,
  duplicateKey,
  planLot,
  type LotCandidate,
  type LotChecklist,
  type LotPlan,
  type RefusedChecklistReason,
} from "./lot-builder-rules";
import {
  suggestLotTexts,
  toLotCriteria,
  type LotBuilderCriteria,
  type LotBuilderRequest,
  type LotSuggestedTexts,
} from "./lot-builder-criteria";
import { findCommittedCopies } from "./trade-reservations";
import type { CommittedCopy } from "./trade-reservation-rules";
import { createOffer, patchOffer } from "./offers";

// The server half of the bulk-lot builder (#759; #756's design, #758's rules).
//
// Three things live here and they are one thing seen three ways: the **candidate pool** the rules
// run over, a **summary** of that pool answering the criteria panel before anything is picked, and
// the **proposal / commit** pair — which are the same read and the same pure function, called twice.
//
// **The commit re-plans; it is never handed a plan.** #717's rule, for its two reasons: the client's
// copy of a proposal is stale and unauthenticated, and between opening the wizard and pressing
// commit a copy may have gone onto another offer or into an agreed trade. So nothing is stored
// between the two calls — the request *is* the state (`lot-builder-criteria.ts`), and both entry
// points go through {@link readLotPool} and `planLot`.
//
// Nothing here decides anything about the pick. Every rule the collector could describe lives in
// `lot-builder-rules.ts`, which has no Prisma in it precisely so this module cannot grow a second
// opinion about which copies belong in a lot.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

// ── The candidate pool ──────────────────────────────────────────────────────────────────────────

/** The copy fields the pool is assembled from — the valuation's inputs, plus the stamp's variant
 *  flags. Deliberately small: the pool is every listable copy in the area, and the display data of
 *  the hundred that get picked is fetched afterwards, over those hundred. */
const POOL_ROW_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
} as const;

/**
 * The filters the pool is read under — the structural narrowing, and the whole availability
 * question in one field.
 *
 * `notOfferedPlatformId` is `buildItemWhere`'s existing branch (#259), reused rather than
 * reinvented, and it is four clauses the lot wants all of: not sitting in a non-terminal offer on
 * that platform, not held by an offer **in active bidding on any platform** (#334 — a bid commits
 * the copy, so listing it elsewhere risks a double sale), in hand (`deliveryState` outside the
 * unavailable states), and not set aside by the collector for that platform (#506). It also implies
 * `forSale`. That is exactly the pool a lot is picked from, which is why the platform is a criterion
 * of the wizard rather than a decision made at commit.
 *
 * A copy promised in an **agreed trade is not excluded**. #639 puts that gate at `active` and
 * deliberately nowhere earlier: a `preparing` offer competes for nothing, and a collector may well
 * prepare the listing they will post the day the trade falls through. The proposal *reports* them
 * instead, through `trade-reservations.ts`, exactly as `OfferDetail.tradeCommitments` does at every
 * offer state.
 *
 * The per-copy catalog-value ceiling is **not** here: a catalog value is computed and never stored,
 * so it cannot be a `where`. It belongs to the rules, after the valuation pass (#758).
 */
async function poolFilters(
  collectionId: string,
  criteria: LotBuilderCriteria
): Promise<ItemListFiltersPaginated> {
  const areaIds = criteria.areaId ? await areaSubtreeIds(collectionId, criteria.areaId) : undefined;
  return {
    notOfferedPlatformId: criteria.platformId,
    ...(areaIds ? { areaIds } : {}),
    ...(criteria.yearFrom !== null ? { yearFrom: criteria.yearFrom } : {}),
    ...(criteria.yearTo !== null ? { yearTo: criteria.yearTo } : {}),
    ...(criteria.conditionIds.length > 0 ? { conditionIds: criteria.conditionIds } : {}),
    ...(criteria.formatIds.length > 0 ? { formatIds: criteria.formatIds } : {}),
  };
}

/** The pool, and the checklists whose members it can touch. */
interface LotPool {
  candidates: LotCandidate[];
  checklists: LotChecklist[];
}

/**
 * One pass: everything the rules need per copy, with no query per checklist and none per variant.
 *
 * Four reads whatever the pool holds — the copies, their variant chains, the checklists those chains
 * belong to with their memberships, and one valuation over the whole set (#378 values a whole offer
 * once; a pool is the same argument at a larger size).
 */
async function readLotPool(
  collectionId: string,
  criteria: LotBuilderCriteria
): Promise<LotPool> {
  const where = await buildItemFilterWhere(collectionId, await poolFilters(collectionId, criteria));
  const rows = await prisma.item.findMany({ where, select: POOL_ROW_SELECT });
  if (rows.length === 0) return { candidates: [], checklists: [] };

  // The chain answers both questions the rules ask of a copy — which checklist slot it covers, and
  // which duplicate pile it belongs to — so it is loaded once rather than derived twice.
  const chains = await loadVariantChains(collectionId, rows.map((r) => r.stampId));

  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    unknownVariant: isUnknownVariantStamp(row.stamp),
  }));
  const valuations = await valuateItemRows(collectionId, valuationRows);

  const candidates: LotCandidate[] = rows.map((row) => ({
    itemId: row.id,
    stampId: row.stampId,
    variantChain: chains.get(row.stampId) ?? [row.stampId],
    conditionId: row.conditionId,
    formatId: row.formatId,
    // Null **is not zero** (#378): an unpriced copy passes the ceiling, counts as a piece, and is
    // named rather than valued at nothing.
    catalogValue: valuations.get(row.id)?.baseAmount ?? null,
  }));

  return { candidates, checklists: await loadPoolChecklists(collectionId, candidates) };
}

/**
 * The checklists a lot drawn from this pool could complete: every checklist naming a stamp anywhere
 * on a pool copy's variant chain, read whole.
 *
 * Asked of the **chains** and not of the copies' own `stampId`, because a `226yw` copy answers a
 * checklist that names `226` (#661) and would otherwise pull in no checklist at all. Each one is
 * then loaded with its full membership: whether it is complete is measured over the pool, and a
 * membership read through the pool's own stamps could only ever look complete.
 */
async function loadPoolChecklists(
  collectionId: string,
  candidates: readonly LotCandidate[]
): Promise<LotChecklist[]> {
  const chainIds = new Set<string>();
  for (const candidate of candidates) for (const id of candidate.variantChain) chainIds.add(id);
  if (chainIds.size === 0) return [];

  const touched = await prisma.checklistStamp.findMany({
    where: { stampId: { in: [...chainIds] }, checklist: { collectionId } },
    select: { checklistId: true },
    distinct: ["checklistId"],
  });
  if (touched.length === 0) return [];

  const members = await prisma.checklistStamp.findMany({
    where: { checklistId: { in: touched.map((t) => t.checklistId) } },
    select: { checklistId: true, stampId: true },
  });
  const byChecklist = new Map<string, string[]>();
  for (const row of members) {
    const list = byChecklist.get(row.checklistId);
    if (list) list.push(row.stampId);
    else byChecklist.set(row.checklistId, [row.stampId]);
  }
  return [...byChecklist].map(([checklistId, stampIds]) => ({ checklistId, stampIds }));
}

// ── The pool summary ────────────────────────────────────────────────────────────────────────────

/**
 * What the criteria panel says before anything is picked (#756).
 *
 * A second, cheap answer over **exactly the same `where`** as the pool itself — the idiom
 * `getHoldingsValuation` already shares with `listItemsPaginated`, so a list and its total can never
 * disagree about which copies they are about. It answers the criteria *without* running a pick, so
 * the panel stays live while generating a proposal stays a deliberate act.
 *
 * There is deliberately **no "≈ N lots" estimate**. Dividing the pool by the target answers a
 * different question than it appears to: the cap and the atomic series leave remainders no later lot
 * can collect. {@link LotPoolSummary.capBoundedCapacity} is an exact ceiling instead, and it catches
 * the case that matters — a target of 100 against a pool that can only yield 80 — before a proposal
 * exists.
 */
export interface LotPoolSummary {
  /** Copies the criteria admit. */
  copies: number;
  /** Distinct stamps among them, rolled up through variants — the same `duplicateKey` the cap
   *  counts on, so the readout and the pick cannot disagree about what a duplicate is. */
  stamps: number;
  /** The pool's catalog-value sum in the collection's base currency, unpriced copies contributing
   *  nothing. */
  catalogValue: number;
  baseCurrency: string;
  /** Copies carrying **no** catalog value — named as a count rather than folded into the sum as
   *  zero (#378), so the gap is visible before the offer exists. */
  unpricedCopies: number;
  /** Checklists every one of whose slots a pool copy covers (#661). Not a promise that they will be
   *  taken: the cap beats the series, and the targets may fill first. */
  completeChecklists: number;
  /** `Σ min(copies of that stamp, cap)` — the largest lot the duplicate cap permits out of this
   *  pool, exact rather than estimated. Equals {@link copies} when no cap is set. */
  capBoundedCapacity: number;
}

function summarize(pool: LotPool, criteria: LotBuilderCriteria, baseCurrency: string): LotPoolSummary {
  const { candidates, checklists } = pool;
  const piles = new Set(candidates.map(duplicateKey));
  let catalogValue = 0;
  let unpricedCopies = 0;
  for (const candidate of candidates) {
    if (candidate.catalogValue === null) unpricedCopies += 1;
    else catalogValue += candidate.catalogValue;
  }
  return {
    copies: candidates.length,
    stamps: piles.size,
    catalogValue,
    baseCurrency,
    unpricedCopies,
    completeChecklists: checklistCoverage(candidates, checklists).filter((c) => c.complete).length,
    capBoundedCapacity: capBoundedCapacity(candidates, criteria.maxPerStamp),
  };
}

/** The criteria panel's readout, on its own — no pick is run. */
export async function getLotPoolSummary(
  ownerId: string,
  collectionId: string,
  criteria: LotBuilderCriteria
): Promise<LotPoolSummary> {
  await assertCollectionOwner(ownerId, collectionId);
  const [pool, baseCurrency] = await Promise.all([
    readLotPool(collectionId, criteria),
    getCollectionBaseCurrency(collectionId),
  ]);
  return summarize(pool, criteria, baseCurrency);
}

// ── The proposal ────────────────────────────────────────────────────────────────────────────────

/** A pinned copy the pool no longer holds, named rather than silently released (#314): listed on
 *  another offer since the wizard opened, sold, disposed of, or rejected in the same breath. */
export interface MissingPinnedCopy {
  itemId: string;
  /** The copy's own number, or null when the row is gone from the collection entirely. */
  itemNo: number | null;
  /** What the row was of, for a sentence the collector can act on. */
  stampName: string | null;
}

/** A series the lot took whole, named. The plan carries the ids; the screen states the set. */
export interface TakenChecklist {
  checklistId: string;
  name: string;
}

/** A series the pool could assemble that the lot did not take, with the reason in the terms the
 *  collector chose it in: the cap they typed, or the target they set. A `cap` refusal names the
 *  **stamp** that blocked it (#758), so the sentence says which one rather than only that one did. */
export interface RefusedChecklistDetail extends TakenChecklist {
  reason: RefusedChecklistReason;
  stampId: string | null;
  stampName: string | null;
}

export interface LotProposal {
  /** The pick and its whole report — what got in, how close each target came, which series were
   *  refused and why (#758). */
  plan: LotPlan;
  /** The picked copies in **pick order**, enriched as the Copies list enriches a row. */
  copies: ItemListItem[];
  /** Pinned copies that stopped being listable. */
  missingPinned: MissingPinnedCopy[];
  /** Picked copies promised in an agreed trade (#639). Reported, never excluded: a `preparing`
   *  offer competes for nothing, and the gate that does refuse them sits at `active`. */
  tradeCommitments: CommittedCopy[];
  /** Series taken whole, in the order they were taken — the plan's `takenChecklistIds`, named. */
  takenChecklists: TakenChecklist[];
  /** Series the pool could assemble that did not enter, and why. */
  refusedChecklists: RefusedChecklistDetail[];
  /** The criteria panel's readout over the same pool this proposal was picked from. */
  summary: LotPoolSummary;
  /** What the wizard's title and description fields are pre-filled with. */
  suggested: LotSuggestedTexts;
}

/**
 * Answer a proposal: read the pool, run #758's rules, and report the result whole.
 *
 * Takes the five things the wizard holds in its URL — criteria, seed, pinned, rejected — and trusts
 * none of them beyond that. Nothing about the previous proposal is read back: the pool is re-read
 * every time, which is what makes a re-roll and a commit agree with each other.
 */
export async function buildLotProposal(
  ownerId: string,
  collectionId: string,
  request: LotBuilderRequest
): Promise<LotProposal> {
  await assertCollectionOwner(ownerId, collectionId);
  const { criteria } = request;
  const [pool, baseCurrency] = await Promise.all([
    readLotPool(collectionId, criteria),
    getCollectionBaseCurrency(collectionId),
  ]);

  const plan = planLot({
    pool: pool.candidates,
    checklists: pool.checklists,
    criteria: toLotCriteria(criteria),
    seed: request.seed,
    pinnedItemIds: request.pinnedItemIds,
    rejectedItemIds: request.rejectedItemIds,
  });

  const [copies, missingPinned, tradeCommitments, series] = await Promise.all([
    loadPickedCopies(ownerId, collectionId, plan.itemIds),
    nameMissingPinned(collectionId, plan.missingPinnedItemIds),
    findCommittedCopies(collectionId, plan.itemIds),
    nameChecklists(collectionId, plan),
  ]);

  const summary = summarize(pool, criteria, baseCurrency);
  return {
    plan,
    copies,
    missingPinned,
    tradeCommitments,
    takenChecklists: series.taken,
    refusedChecklists: series.refused,
    summary,
    suggested: await suggestTexts(collectionId, criteria, pool, plan),
  };
}

/** The picked copies as the Copies list draws one, back in **pick order** — `sortOrder` on the
 *  offer's set is what a buyer reads as the order of the goods (#306), so the order the pick chose
 *  has to survive the display read that follows it. */
async function loadPickedCopies(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[]
): Promise<ItemListItem[]> {
  if (itemIds.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    ids: [...itemIds],
    pageSize: itemIds.length,
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  return itemIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
}

/** A sentence's worth of each pinned copy the pool has lost. Read straight off `Item` rather than
 *  through the pool: the whole point is that these copies are no longer in it. */
async function nameMissingPinned(
  collectionId: string,
  itemIds: readonly string[]
): Promise<MissingPinnedCopy[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.item.findMany({
    where: { id: { in: [...itemIds] }, collectionId },
    select: { id: true, itemNo: true, stamp: { select: { name: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return itemIds.map((itemId) => {
    const row = byId.get(itemId);
    return {
      itemId,
      itemNo: row?.itemNo ?? null,
      stampName: row?.stamp?.name ?? null,
    };
  });
}

/**
 * The names behind the plan's checklist ids, and behind the stamp a cap refusal blames.
 *
 * Resolved here rather than on the screen because they are the *reason* the lot looks the way it
 * does — "Numerals 1955 went in whole" and "Definitives was left out: you already have three of
 * 226" — and a panel that had to fetch them separately would draw the explanation a beat after the
 * thing it explains.
 */
async function nameChecklists(
  collectionId: string,
  plan: LotPlan
): Promise<{ taken: TakenChecklist[]; refused: RefusedChecklistDetail[] }> {
  const ids = [...new Set([...plan.takenChecklistIds, ...plan.refusedChecklists.map((r) => r.checklistId)])];
  if (ids.length === 0) return { taken: [], refused: [] };

  const blamedStampIds = plan.refusedChecklists
    .map((r) => r.stampId)
    .filter((id): id is string => id !== null);
  const [checklists, stamps] = await Promise.all([
    prisma.checklist.findMany({
      where: { id: { in: ids }, collectionId },
      select: { id: true, name: true },
    }),
    blamedStampIds.length > 0
      ? prisma.stamp.findMany({
          where: { id: { in: blamedStampIds }, collectionId },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const nameOf = new Map(checklists.map((c) => [c.id, c.name]));
  const stampNameOf = new Map(stamps.map((s) => [s.id, s.name]));
  // A checklist deleted between the read and here would leave an id with no name; it is still the
  // reason a series is missing, so it is reported as one rather than dropped.
  const label = (checklistId: string) => nameOf.get(checklistId) ?? "A set";

  return {
    taken: plan.takenChecklistIds.map((checklistId) => ({
      checklistId,
      name: label(checklistId),
    })),
    refused: plan.refusedChecklists.map((refusal) => ({
      checklistId: refusal.checklistId,
      name: label(refusal.checklistId),
      reason: refusal.reason,
      stampId: refusal.stampId,
      stampName: refusal.stampId ? (stampNameOf.get(refusal.stampId) ?? null) : null,
    })),
  };
}

/**
 * The pre-filled title and description (`lot-builder-criteria.ts` states why they exist at all).
 *
 * The labels are resolved here because the criteria carry ids and a name is what a listing says.
 * The piece count comes from the **plan**, never from the count target: the pick stops at the floor
 * of a range and an atomic series overshoots it, so a target of 100 routinely lands at 103.
 */
async function suggestTexts(
  collectionId: string,
  criteria: LotBuilderCriteria,
  pool: LotPool,
  plan: LotPlan
): Promise<LotSuggestedTexts> {
  const [area, conditions] = await Promise.all([
    criteria.areaId
      ? prisma.collectionArea.findFirst({
          where: { id: criteria.areaId, collectionId },
          select: { name: true },
        })
      : null,
    criteria.conditionIds.length > 0
      ? prisma.stampCondition.findMany({
          where: { id: { in: criteria.conditionIds }, collectionId },
          select: { name: true },
          orderBy: { sortOrder: "asc" },
        })
      : [],
  ]);
  return suggestLotTexts({
    areaName: area?.name ?? null,
    yearFrom: criteria.yearFrom,
    yearTo: criteria.yearTo,
    conditionNames: conditions.map((c) => c.name),
    pieceCount: plan.itemIds.length,
    distinctStamps: distinctStamps(pool, plan),
    completeSets: plan.takenChecklistIds.length,
  });
}

/** How many different stamps the lot holds, counted the way the cap counts them (`duplicateKey`,
 *  so a `226` and a `226yw` are one). Over the **picks**, so it describes the lot rather than the
 *  criteria — {@link LotPoolSummary.stamps} is the same figure over the whole pool. */
function distinctStamps(pool: LotPool, plan: LotPlan): number {
  const byId = new Map(pool.candidates.map((c) => [c.itemId, c]));
  const piles = new Set<string>();
  for (const itemId of plan.itemIds) {
    const candidate = byId.get(itemId);
    if (candidate) piles.add(duplicateKey(candidate));
  }
  return piles.size;
}

// ── The commit ──────────────────────────────────────────────────────────────────────────────────

export interface LotCommitInput extends LotBuilderRequest {
  /** The listing title. Non-empty is stored as the collector's own (`nameEdited`, #380); empty
   *  leaves the platform's template to render, as it does for every other offer. */
  name: string | null;
  /** The listing description, on the same contract. */
  description: string | null;
}

export interface LotCommitResult {
  offerId: string;
  /** How many copies the offer's one set holds. */
  copies: number;
  /** Pinned copies that had stopped being listable by the time commit ran — dropped from the lot
   *  and named, never silently released (#314). */
  missingPinned: MissingPinnedCopy[];
}

/**
 * Carry an accepted proposal out as an offer.
 *
 * **Re-plans from the request** rather than taking a list of copies: #717's rule, and the reason
 * nothing is stored between the proposal and this call. Between the two a copy may have gone onto
 * another offer or into an agreed trade, and re-reading is what notices.
 *
 * Creates a `preparing` offer holding **one set**. One set and not one per copy: ADR-0013 §2 makes
 * a set the atomic sellable unit, and N sets mean *N of the same thing* — `per-copy` packaging would
 * misdescribe a bulk lot as a hundred alternative listings. The write goes through `createOffer`,
 * so it inherits `assertAddableCopies`' disposal guard (#394) and its ordering rule (#306): the
 * caller's list leads, and the pick's order is what a buyer reads as the order of the goods.
 *
 * Everything downstream is untouched — the value roll-up (#378), the suggested price (#190) and the
 * photos are the offer's own, exactly as on any other listing.
 */
export async function commitLotProposal(
  ownerId: string,
  collectionId: string,
  input: LotCommitInput
): Promise<LotCommitResult> {
  const proposal = await buildLotProposal(ownerId, collectionId, input);
  if (proposal.plan.itemIds.length === 0) {
    throw new Error("That lot came out empty — widen the criteria or the targets and try again.");
  }

  const offerId = await createOffer(
    ownerId,
    collectionId,
    {
      platformId: input.criteria.platformId,
      url: null,
      // A draft states no figure yet — the same `0.00` a blank price on the offer form produces.
      // The suggested price (#190) and the copies' catalogue value (#230) reach the collector on the
      // offer's own screen, where they always have.
      price: "0.00",
      currency: "",
      listingDate: null,
      state: "preparing",
    },
    { seedItemIds: proposal.plan.itemIds }
  );

  // The wizard's texts, when it sent any. `patchOffer` carries #380's rule: writing a generated text
  // takes the field off the template. That flag is right even though nobody typed these — it means
  // *do not regenerate this*, and regeneration over a hundred unrelated stamps is exactly what
  // produces a title past the platform's cap (#403), which since #636 blocks the way to `ready`.
  const name = input.name?.trim() || null;
  const description = input.description?.trim() || null;
  if (name !== null || description !== null) {
    await patchOffer(ownerId, offerId, {
      ...(name !== null ? { name } : {}),
      ...(description !== null ? { description } : {}),
    });
  }

  return {
    offerId,
    copies: proposal.plan.itemIds.length,
    missingPinned: proposal.missingPinned,
  };
}
