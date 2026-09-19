import "server-only";
import { prisma } from "./db";
import { buildItemFilterWhere, type ItemListFiltersPaginated } from "./items";
import { listableOnPlatformFilters, loadPoolChecklists } from "./lot-builder";
import { loadVariantChains } from "./checklist-variant-rollup";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { CLOSED_OFFER_STATES, isOfferState, type OfferState } from "./offer-rules";
import { TRADED_AWAY } from "./trade-exit";
import { formatItemNo } from "./item-number";
import { formatEntityNo } from "./quick-jump";
import { usesPlatformCatalogue } from "./platform-modules";
import { resolveListedStampIds } from "./listing-catalog-ids";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  GenerationChangedError,
  collisionStampIds,
  loadCollisionMembers,
  OfferActionBlockedError,
  quickOfferCreationBlock,
  writeGeneratedOffers,
} from "./offers";
import type { LotChecklist } from "./lot-builder-rules";
import {
  findPlanDrift,
  fingerprintPlan,
  planOffers,
  SKIP_REASON_LABEL,
  SKIP_REASONS,
  skipReason,
  type GeneratorCopy,
  type GeneratorOffer,
  type GeneratorPlan,
  type GeneratorRequest,
  type PlanDrift,
  type PlanFingerprint,
  type SkipReason,
} from "./offer-generator-rules";

// The server half of generating offers in bulk from the Copies list (#1287). Every rule the collector
// could describe — what a complete set is, what identical means, which existing offer receives sets —
// is `offer-generator-rules.ts`. What lives here is the pool, read, and the names the preview states
// the plan in.
//
// **Available is the bulk-lot builder's reading, imported rather than restated**
// (`listableOnPlatformFilters`, #758): in hand, for sale, still held, not in an open offer on the
// platform, not set aside for it, not held by an offer in active bidding anywhere. The copies asked
// for and not available are counted by reason, never silently dropped.
//
// **The commit re-reads and re-plans; it is never handed a plan** (#717). What the client sends back
// is the plan it showed, and only to be compared: a copy or an offer not where the preview put it
// refuses the whole pass by name, and nothing is written.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The request as the server takes it: the list's filters already parsed by the list's own reader. */
export interface GeneratorInput extends Omit<GeneratorRequest, "filters"> {
  filters: ItemListFiltersPaginated;
}

interface GeneratorState {
  platformName: string;
  askedCopies: number;
  skipped: { reason: SkipReason; count: number }[];
  copies: GeneratorCopy[];
  checklists: LotChecklist[];
  offers: Map<string, GeneratorOffer>;
  plan: GeneratorPlan;
}

const POOL_SELECT = {
  id: true,
  itemNo: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  stampCount: true,
  stamp: { select: { primaryCatalogSortKey: true, colnectId: true, variants: { select: VARIANT_FLAG_SELECT } } },
} as const;

async function readGeneratorState(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput
): Promise<GeneratorState> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await prisma.contact.findFirst({
    where: { id: input.platformId, collectionId, platform: true },
    select: { name: true, platformModule: true },
  });
  if (!platform) throw new Error("Platform not found.");

  // What was asked for: the ticked copies as they are, or exactly what the list's filters show.
  const asked =
    input.itemIds !== null
      ? await prisma.item.findMany({ where: { collectionId, id: { in: input.itemIds } }, select: { id: true } })
      : await prisma.item.findMany({ where: await buildItemFilterWhere(collectionId, input.filters), select: { id: true } });
  const askedIds = asked.map((row) => row.id);

  const rows =
    askedIds.length === 0
      ? []
      : await prisma.item.findMany({
          where: await buildItemFilterWhere(collectionId, {
            ...listableOnPlatformFilters(input.platformId),
            ids: askedIds,
          }),
          select: POOL_SELECT,
        });
  const poolIds = new Set(rows.map((row) => row.id));
  const skipped = await countSkipped(
    collectionId,
    input.platformId,
    askedIds.filter((id) => !poolIds.has(id))
  );

  // What each copy would be listed as (#1347): on a platform that lists an umbrella under its
  // cheapest variant, a `523` copy resolving to `523I` is that listing, so it packs with the `523I`
  // copies and matches their offers. The derivation a new listing makes — no offer, so no choice.
  const [chains, listed] = await Promise.all([
    loadVariantChains(collectionId, [...new Set(rows.map((row) => row.stampId))]),
    usesPlatformCatalogue(platform.platformModule)
      ? resolveListedStampIds(
          collectionId,
          rows.map((row) => ({
            itemId: row.id,
            stampId: row.stampId,
            conditionId: row.conditionId,
            certificateStatusId: row.certificateStatusId,
            formatId: row.formatId,
            unknownVariant: isUnknownVariantStamp(row.stamp),
            ownCatalogItemId: row.stamp.colnectId?.trim() || null,
          }))
        )
      : new Map<string, string>(),
  ]);
  const copies: GeneratorCopy[] = rows.map((row) => ({
    itemId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    multiStamp: row.stampCount > 1,
    catalogSortKey: row.stamp.primaryCatalogSortKey,
    variantChain: chains.get(row.stampId) ?? [row.stampId],
    listedStampId: listed.get(row.id) ?? row.stampId,
  }));

  const [checklists, members] = await Promise.all([
    orderedChecklists(collectionId, copies.filter((copy) => !copy.multiStamp)),
    loadCollisionMembers(collectionId, collisionStampIds(copies), { platformId: input.platformId }),
  ]);
  const offers = await readOffers(collectionId, [...new Set(members.map((member) => member.offerId))]);

  const plan = planOffers({
    copies,
    checklists,
    mode: input.mode,
    packaging: input.packaging,
    members,
    offers,
    targets: input.targets,
  });
  return { platformName: platform.name, askedCopies: askedIds.length, skipped, copies, checklists, offers, plan };
}

/**
 * The checklists the pool can touch, **in precedence order** (#531): issue by issue in catalogue order,
 * each issue's checklists in the order set on it, a checklist spanning issues last.
 */
async function orderedChecklists(
  collectionId: string,
  copies: readonly GeneratorCopy[]
): Promise<LotChecklist[]> {
  const checklists = await loadPoolChecklists(collectionId, copies);
  if (checklists.length === 0) return [];
  const rows = await prisma.checklist.findMany({
    where: { id: { in: checklists.map((c) => c.checklistId) }, collectionId },
    select: { id: true, sortOrder: true, issueId: true, issue: { select: { primaryCatalogSortKey: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...checklists].sort((a, b) => {
    const ra = byId.get(a.checklistId);
    const rb = byId.get(b.checklistId);
    if (!ra?.issueId !== !rb?.issueId) return ra?.issueId ? -1 : 1;
    return (
      compareCatalogSortKeys(ra?.issue?.primaryCatalogSortKey ?? null, rb?.issue?.primaryCatalogSortKey ?? null) ||
      (ra?.issueId ?? "").localeCompare(rb?.issueId ?? "") ||
      (ra?.sortOrder ?? 0) - (rb?.sortOrder ?? 0) ||
      a.checklistId.localeCompare(b.checklistId)
    );
  });
}

async function readOffers(collectionId: string, offerIds: string[]): Promise<Map<string, GeneratorOffer>> {
  if (offerIds.length === 0) return new Map();
  const rows = await prisma.offer.findMany({
    where: { id: { in: offerIds }, collectionId },
    select: { id: true, offerNo: true, state: true, inActiveBidding: true, _count: { select: { sets: true } } },
  });
  const out = new Map<string, GeneratorOffer>();
  for (const row of rows) {
    if (!isOfferState(row.state)) continue;
    out.set(row.id, {
      offerId: row.id,
      offerNo: row.offerNo,
      state: row.state,
      inActiveBidding: row.inActiveBidding,
      setCount: row._count.sets,
    });
  }
  return out;
}

/** The copies asked for and not available, counted under the one reason that explains each. */
async function countSkipped(
  collectionId: string,
  platformId: string,
  itemIds: string[]
): Promise<{ reason: SkipReason; count: number }[]> {
  if (itemIds.length === 0) return [];
  const closed = CLOSED_OFFER_STATES as readonly string[];
  const [rows, tradedAway] = await Promise.all([
    prisma.item.findMany({
      where: { collectionId, id: { in: itemIds } },
      select: {
        id: true,
        forSale: true,
        deliveryState: true,
        disposedAt: true,
        saleLineItems: { select: { itemId: true }, take: 1 },
        platformExclusions: { where: { platformId }, select: { id: true }, take: 1 },
        offerSetMemberships: {
          where: {
            offerSet: {
              offer: {
                OR: [
                  { platformId, state: { notIn: [...CLOSED_OFFER_STATES] } },
                  { state: "active", inActiveBidding: true },
                ],
              },
            },
          },
          select: { offerSet: { select: { offer: { select: { platformId: true, state: true, inActiveBidding: true } } } } },
        },
      },
    }),
    prisma.item.findMany({ where: { collectionId, id: { in: itemIds }, ...TRADED_AWAY }, select: { id: true } }),
  ]);
  const traded = new Set(tradedAway.map((row) => row.id));
  const counts = new Map<SkipReason, number>();
  for (const row of rows) {
    const offers = row.offerSetMemberships.map((membership) => membership.offerSet.offer);
    const reason = skipReason({
      gone: row.disposedAt !== null || row.saleLineItems.length > 0 || traded.has(row.id),
      forSale: row.forSale,
      deliveryState: row.deliveryState,
      setAside: row.platformExclusions.length > 0,
      offeredOnPlatform: offers.some((offer) => offer.platformId === platformId && !closed.includes(offer.state)),
      inActiveBidding: offers.some((offer) => offer.state === "active" && offer.inActiveBidding),
    });
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return SKIP_REASONS.flatMap((reason) => {
    const count = counts.get(reason);
    return count ? [{ reason, count }] : [];
  });
}

// ── The preview ────────────────────────────────────────────────────────────────────────────────────

export interface GeneratorOfferRef {
  offerId: string;
  offerNo: number;
  label: string;
  state: OfferState;
  setCount: number;
}

export interface GeneratorLineView {
  id: string;
  kind: "series" | "single" | "carrier";
  /** The checklist's name for a series; the leading catalogue number and the stamp's name otherwise. */
  title: string;
  /** The issue a series belongs to. */
  subtitle: string | null;
  /** Condition, certificate and format, in words. */
  combinationLabels: string[];
  /** The variants filling a slot of the series in place of their parent (#661), named. */
  variantLabels: string[];
  /** The copy numbers of every set. */
  sets: number[][];
  target: { kind: "new" } | { kind: "existing"; offerId: string };
  /** Offers that may receive the sets (#732), lowest number first — the choice offered. */
  matches: GeneratorOfferRef[];
  /** Offers that match but are in active bidding, and so receive nothing (#334). */
  biddingMatches: GeneratorOfferRef[];
  resultingSetCount: number;
}

export interface OfferGeneratorPreview {
  platformName: string;
  /** How many copies were asked for — ticked, or matching the filters. */
  askedCopies: number;
  skipped: { reason: SkipReason; label: string; count: number }[];
  /** Available copies the other mode lists (`GeneratorPlan.otherModeCopies`). */
  otherModeCopies: number;
  /** Why offers cannot be created in this status the way quick offer mode creates them, if so. */
  creationBlock: string | null;
  lines: GeneratorLineView[];
  totals: { newOffers: number; changedOffers: number; sets: number; copies: number };
  /** What confirming sends back, to be compared with a fresh plan (#717). */
  fingerprint: PlanFingerprint;
}

export async function previewOfferGeneration(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput
): Promise<OfferGeneratorPreview> {
  const state = await readGeneratorState(ownerId, collectionId, input);
  const [lines, creationBlock] = await Promise.all([
    nameLines(collectionId, state),
    quickOfferCreationBlock(ownerId, collectionId, input.platformId, input.state),
  ]);
  const { plan } = state;
  return {
    platformName: state.platformName,
    askedCopies: state.askedCopies,
    skipped: state.skipped.map((entry) => ({ ...entry, label: SKIP_REASON_LABEL[entry.reason] })),
    otherModeCopies: plan.otherModeCopies,
    creationBlock,
    lines,
    totals: {
      newOffers: plan.lines.filter((line) => line.target.kind === "new").length,
      changedOffers: new Set(
        plan.lines.flatMap((line) => (line.target.kind === "existing" ? [line.target.offerId] : []))
      ).size,
      sets: plan.lines.reduce((n, line) => n + line.sets.length, 0),
      copies: plan.lines.reduce((n, line) => n + line.sets.reduce((m, set) => m + set.copies.length, 0), 0),
    },
    fingerprint: fingerprintPlan(plan, state.offers),
  };
}

/** The names behind the plan's ids: checklists and issues, stamps, the combination, the offers. */
async function nameLines(collectionId: string, state: GeneratorState): Promise<GeneratorLineView[]> {
  const { plan } = state;
  if (plan.lines.length === 0) return [];
  const stampIds = new Set<string>();
  const checklistIds = new Set<string>();
  const offerIds = new Set<string>();
  const conditionIds = new Set<string>();
  const certificateIds = new Set<string>();
  const formatIds = new Set<string>();
  for (const line of plan.lines) {
    if (line.checklistId) checklistIds.add(line.checklistId);
    for (const id of [...line.matches, ...line.biddingMatches]) offerIds.add(id);
    const { conditionId, certificateStatusId, formatId } = line.combination;
    if (conditionId) conditionIds.add(conditionId);
    if (certificateStatusId) certificateIds.add(certificateStatusId);
    if (formatId) formatIds.add(formatId);
    for (const set of line.sets) for (const copy of set.copies) stampIds.add(copy.stampId);
  }

  const dictionarySelect = { id: true, name: true } as const;
  const [checklists, stamps, offers, conditions, certificates, formats, labeller] = await Promise.all([
    prisma.checklist.findMany({
      where: { id: { in: [...checklistIds] }, collectionId },
      select: { id: true, name: true, issue: { select: { name: true } } },
    }),
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId },
      select: { id: true, ...STAMP_LABEL_SELECT.stamp.select },
    }),
    prisma.offer.findMany({
      where: { id: { in: [...offerIds] }, collectionId },
      select: {
        id: true,
        name: true,
        sets: {
          select: { title: true, items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    }),
    prisma.stampCondition.findMany({ where: { id: { in: [...conditionIds] }, collectionId }, select: dictionarySelect }),
    prisma.certificateStatus.findMany({ where: { id: { in: [...certificateIds] }, collectionId }, select: dictionarySelect }),
    prisma.stampFormat.findMany({ where: { id: { in: [...formatIds] }, collectionId }, select: dictionarySelect }),
    makeOfferLabeller(collectionId),
  ]);
  const checklistById = new Map(checklists.map((row) => [row.id, row]));
  const stampById = new Map(stamps.map((row) => [row.id, row]));
  const nameOf = (rows: { id: string; name: string }[]) => new Map(rows.map((row) => [row.id, row.name]));
  const conditionName = nameOf(conditions);
  const certificateName = nameOf(certificates);
  const formatName = nameOf(formats);
  const membersOf = new Map(state.checklists.map((checklist) => [checklist.checklistId, new Set(checklist.stampIds)]));

  const offerRef = new Map<string, GeneratorOfferRef>();
  for (const row of offers) {
    const known = state.offers.get(row.id);
    if (!known) continue;
    offerRef.set(row.id, {
      offerId: row.id,
      offerNo: known.offerNo,
      label: offerDisplayLabel(row.name, row.sets, labeller),
      state: known.state,
      setCount: known.setCount,
    });
  }
  const refs = (ids: string[]) => ids.flatMap((id) => (offerRef.has(id) ? [offerRef.get(id)!] : []));
  const stampLabel = (stampId: string) => {
    const stamp = stampById.get(stampId);
    if (!stamp) return "A stamp";
    return [labeller.catalogNumbers(stamp)[0], stamp.name].filter(Boolean).join(" ") || "A stamp";
  };

  return plan.lines.map((line): GeneratorLineView => {
    const first = line.sets[0].copies[0];
    const { conditionId, certificateStatusId, formatId } = line.combination;
    const combinationLabels = [
      conditionName.get(conditionId ?? "") ?? "Unknown condition",
      certificateStatusId ? (certificateName.get(certificateStatusId) ?? "Unknown certificate") : "No certificate",
      formatId ? (formatName.get(formatId) ?? "Unknown format") : "Single",
    ];
    const checklist = line.checklistId ? checklistById.get(line.checklistId) : undefined;
    const members = line.checklistId ? membersOf.get(line.checklistId) : undefined;
    return {
      id: line.id,
      kind: line.checklistId ? "series" : first.multiStamp ? "carrier" : "single",
      title: line.checklistId ? (checklist?.name ?? "A set") : stampLabel(first.stampId),
      subtitle: checklist?.issue?.name ?? null,
      combinationLabels,
      variantLabels: members
        ? [...new Set(line.sets[0].copies.filter((copy) => !members.has(copy.stampId)).map((copy) => stampLabel(copy.stampId)))]
        : [],
      sets: line.sets.map((set) => set.copies.map((copy) => copy.itemNo)),
      target: line.target,
      matches: refs(line.matches),
      biddingMatches: refs(line.biddingMatches),
      resultingSetCount: line.resultingSetCount,
    };
  });
}

// ── The commit ─────────────────────────────────────────────────────────────────────────────────────

export interface OfferGeneratorResult {
  createdOffers: number;
  changedOffers: number;
  sets: number;
  copies: number;
}

/**
 * Carry a confirmed pass out (#1287).
 *
 * **Re-reads and re-plans from the request** (#717), then compares the fresh plan with the one the
 * collector confirmed: a copy that has since sold, gone onto an offer, changed or newly matches the
 * filters, or a receiving offer that changed state, set count or bidding, refuses the pass by name.
 * The pass is all or nothing — `writeGeneratedOffers` writes it in one transaction and asks the same
 * questions once more inside it.
 */
export async function commitOfferGeneration(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput,
  expected: PlanFingerprint
): Promise<OfferGeneratorResult> {
  const state = await readGeneratorState(ownerId, collectionId, input);
  const drift = findPlanDrift(expected, fingerprintPlan(state.plan, state.offers));
  if (drift) throw new OfferActionBlockedError("not-eligible", await describeDrift(collectionId, drift));
  const { lines } = state.plan;
  if (lines.length === 0) {
    throw new OfferActionBlockedError("empty", "There is nothing to generate: none of these copies makes an offer in this mode.");
  }
  const block = await quickOfferCreationBlock(ownerId, collectionId, input.platformId, input.state);
  if (block) throw new OfferActionBlockedError("unpriced", block);

  const additions = new Map<string, { offerId: string; state: OfferState; setCount: number; sets: string[][] }>();
  for (const line of lines) {
    if (line.target.kind !== "existing") continue;
    const offer = state.offers.get(line.target.offerId)!;
    const addition = additions.get(offer.offerId) ?? { offerId: offer.offerId, state: offer.state, setCount: offer.setCount, sets: [] };
    addition.sets.push(...line.sets.map((set) => set.copies.map((copy) => copy.itemId)));
    additions.set(offer.offerId, addition);
  }
  const newOffers = lines
    .filter((line) => line.target.kind === "new")
    .map((line) => line.sets.map((set) => set.copies.map((copy) => copy.itemId)));

  try {
    const written = await writeGeneratedOffers(ownerId, collectionId, {
      platformId: input.platformId,
      state: input.state,
      newOffers,
      additions: [...additions.values()],
    });
    return {
      createdOffers: written.createdOfferIds.length,
      changedOffers: written.changedOfferIds.length,
      sets: lines.reduce((n, line) => n + line.sets.length, 0),
      copies: lines.reduce((n, line) => n + line.sets.reduce((m, set) => m + set.copies.length, 0), 0),
    };
  } catch (e) {
    if (e instanceof GenerationChangedError) {
      throw new OfferActionBlockedError("not-eligible", await describeDrift(collectionId, e.drift));
    }
    throw e;
  }
}

/** A refusal in the collector's words: the copy or the offer by its number (#314). */
async function describeDrift(collectionId: string, drift: PlanDrift): Promise<string> {
  if (drift.kind === "copy") {
    const item = await prisma.item.findFirst({ where: { id: drift.itemId, collectionId }, select: { itemNo: true } });
    const copy = item ? `Copy ${formatItemNo(item.itemNo)}` : "A copy";
    return `${copy} has changed since the preview — it has sold, gone onto an offer or under bid, been edited, or come to match the list. Nothing was created; check the preview again.`;
  }
  const offer = await prisma.offer.findFirst({ where: { id: drift.offerId, collectionId }, select: { offerNo: true } });
  const ref = offer ? `Offer ${formatEntityNo(offer.offerNo)}` : "An offer";
  return `${ref} has changed since the preview — its status, its sets or its bidding. Nothing was created; check the preview again.`;
}
