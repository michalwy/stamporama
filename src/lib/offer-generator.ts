import "server-only";
import { prisma } from "./db";
import { candidateIdsOf } from "./candidate-set-rules";
import { buildItemFilterWhere, listItemsPaginated, type ItemListFiltersPaginated, type ItemListItem } from "./items";
import { listableOnPlatformFilters, loadPoolChecklists } from "./lot-builder";
import { loadVariantChains } from "./checklist-variant-rollup";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { CLOSED_OFFER_STATES, isOfferState, type OfferState } from "./offer-rules";
import { TRADED_AWAY } from "./trade-exit";
import { formatItemNo } from "./item-number";
import { formatEntityNo } from "./quick-jump";
import { FACEBOOK_PLATFORM_MODULE, usesPlatformCatalogue } from "./platform-modules";
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
import { readFacebookCreateChoice } from "./facebook-post-rules";
import { writeFacebookPost } from "./facebook-posts";
import { syncFacebookPostLotPhotos } from "./facebook-lot-photos";
import {
  findPlanDrift,
  fingerprintPlan,
  generatorCombinationParts,
  generatorSelection,
  keptFingerprint,
  planOffers,
  issueLineTitle,
  SKIP_REASON_LABEL,
  SKIP_REASONS,
  generatorPostRefusal,
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
  candidates: { select: { stampId: true } },
} as const;

async function readGeneratorState(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput,
  includeSpecialised: boolean
): Promise<GeneratorState> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, collectionId },
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
            candidateStampIds: candidateIdsOf(row),
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
    orderedChecklists(
      collectionId,
      copies.filter((copy) => !copy.multiStamp),
      includeSpecialised
    ),
    loadCollisionMembers(collectionId, collisionStampIds(copies), { platformId: input.platformId }),
  ]);
  // On Facebook a set goes only into an auction **in the group the pass is for** (#1663): an offer in
  // another group is not one this pass may grow, so a line it would have matched becomes a new auction
  // in the chosen group instead. Off Facebook every offer on the platform is a target, as before.
  const facebookGroupId =
    platform.platformModule === FACEBOOK_PLATFORM_MODULE
      ? (readFacebookCreateChoice(input.facebook).facebookGroupId ?? "")
      : undefined;
  const offers = await readOffers(
    collectionId,
    [...new Set(members.map((member) => member.offerId))],
    facebookGroupId
  );

  const plan = planOffers({
    copies,
    checklists,
    mode: input.mode,
    packaging: input.packaging,
    mixing: input.mixing,
    priority: input.priority,
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
  copies: readonly GeneratorCopy[],
  includeSpecialised: boolean
): Promise<LotChecklist[]> {
  const checklists = await loadPoolChecklists(collectionId, copies, includeSpecialised);
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

/** The offers a pass may add sets to — on Facebook, only those in `facebookGroupId` (none without one). */
async function readOffers(
  collectionId: string,
  offerIds: string[],
  facebookGroupId?: string
): Promise<Map<string, GeneratorOffer>> {
  if (offerIds.length === 0) return new Map();
  const rows = await prisma.offer.findMany({
    where: {
      id: { in: offerIds },
      collectionId,
      ...(facebookGroupId !== undefined ? { facebookGroupId } : {}),
    },
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

/** One axis of a line's combination, short (#1368): the chip says `label`, its hover says `name`. */
export interface GeneratorCombinationPart {
  axis: "condition" | "certificate" | "format";
  /** Null for a condition the copies do not record, and for *no certificate* or *single* on an axis
   *  the line mixes. */
  id: string | null;
  /** The dictionary's abbreviation, else its name. */
  label: string;
  name: string;
  /** How many of a set's copies are in this value, on an axis the line mixes (#2102); else null. */
  count: number | null;
}

export interface GeneratorLineView {
  id: string;
  kind: "series" | "single" | "carrier";
  /** `Issue · Checklist` for a series (#2104); `Issue · Stamp` for a single (#2046); the stamp's name
   *  for a piece of several. Empty where there is no name — the catalogue numbers then say what it is. */
  title: string;
  /** Condition always, certificate and format only when not the default (#1368, as #1243); on a mixed
   *  axis every value with its count (#2102). */
  combination: GeneratorCombinationPart[];
  /** What a set is, by catalogue number and as ranges where they run (#379/#400). Every set of a line
   * holds the same stamps, so the first one speaks for all. */
  catalog: string;
  /** The variants filling a slot of the series in place of their parent (#661), by catalogue number. */
  variantLabels: string[];
  /** The copies of every set, each as the Copies list's own row reads it (#1887), so an expanded line
   *  draws them with the row every other screen draws a copy with. */
  sets: ItemListItem[][];
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
  /** What every line together makes — the dialog's own count follows the ticks (`generatorSelection`). */
  totals: { newOffers: number; changedOffers: number; sets: number; copies: number };
  /** What confirming sends back, to be compared with a fresh plan (#717). */
  fingerprint: PlanFingerprint;
}

export async function previewOfferGeneration(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput,
  /** Whether specialised checklists are sets an offer may be built on (#1617). */
  includeSpecialised = false
): Promise<OfferGeneratorPreview> {
  const state = await readGeneratorState(ownerId, collectionId, input, includeSpecialised);
  const [lines, creationBlock] = await Promise.all([
    nameLines(ownerId, collectionId, state),
    quickOfferCreationBlock(
      ownerId,
      collectionId,
      input.platformId,
      input.state,
      readFacebookCreateChoice(input.facebook).facebookGroupId
    ),
  ]);
  const { plan } = state;
  return {
    platformName: state.platformName,
    askedCopies: state.askedCopies,
    skipped: state.skipped.map((entry) => ({ ...entry, label: SKIP_REASON_LABEL[entry.reason] })),
    otherModeCopies: plan.otherModeCopies,
    creationBlock,
    lines,
    totals: (({ newOffers, changedOffers, sets, copies }) => ({ newOffers, changedOffers, sets, copies }))(
      generatorSelection(lines, new Set())
    ),
    fingerprint: fingerprintPlan(plan, state.offers),
  };
}

/** The names behind the plan's ids: checklists and issues, stamps, the combination, the offers, and
 * the copies as full rows for the line expanded to check a set against the desk (#1368, #1887). */
async function nameLines(ownerId: string, collectionId: string, state: GeneratorState): Promise<GeneratorLineView[]> {
  const { plan } = state;
  if (plan.lines.length === 0) return [];
  const stampIds = new Set<string>();
  const itemIds = new Set<string>();
  const checklistIds = new Set<string>();
  const offerIds = new Set<string>();
  const conditionIds = new Set<string>();
  const certificateIds = new Set<string>();
  const formatIds = new Set<string>();
  const dictionaryIds = { condition: conditionIds, certificate: certificateIds, format: formatIds };
  // Every set of a line holds the same values (#2102 included), so the first speaks for all.
  const partsOf = new Map(
    plan.lines.map((line) => [line.id, generatorCombinationParts(line.combination, line.sets[0].copies)])
  );
  for (const line of plan.lines) {
    if (line.checklistId) checklistIds.add(line.checklistId);
    for (const id of [...line.matches, ...line.biddingMatches]) offerIds.add(id);
    for (const part of partsOf.get(line.id)!) if (part.id) dictionaryIds[part.axis].add(part.id);
    for (const set of line.sets) {
      for (const copy of set.copies) {
        stampIds.add(copy.stampId);
        itemIds.add(copy.itemId);
      }
    }
  }

  const dictionarySelect = { id: true, name: true, abbreviation: true } as const;
  const [checklists, stamps, { items: copyRows }, offers, conditions, certificates, formats, labeller] = await Promise.all([
    prisma.checklist.findMany({
      where: { id: { in: [...checklistIds] }, collectionId },
      select: { id: true, name: true, issue: { select: { name: true } } },
    }),
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId },
      select: { id: true, ...STAMP_LABEL_SELECT.stamp.select },
    }),
    listItemsPaginated(ownerId, collectionId, { ids: [...itemIds], pageSize: itemIds.size }),
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
  const copyById = new Map(copyRows.map((row) => [row.id, row]));
  const dictionary = (rows: { id: string; name: string; abbreviation: string | null }[]) =>
    new Map(rows.map((row) => [row.id, { name: row.name, label: row.abbreviation || row.name }]));
  const names = {
    condition: dictionary(conditions),
    certificate: dictionary(certificates),
    format: dictionary(formats),
  };
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
  const copyCatalog = (stampId: string) => {
    const stamp = stampById.get(stampId);
    return stamp ? labeller.copy(stamp) : "Copy";
  };
  const combinationPart = (part: ReturnType<typeof generatorCombinationParts>[number]): GeneratorCombinationPart => {
    if (part.id === null) {
      if (part.axis === "certificate") return { ...part, label: "No cert.", name: "No certificate" };
      if (part.axis === "format") return { ...part, label: "Single", name: "Single" };
      return { ...part, label: "No condition", name: "No condition recorded" };
    }
    const known = names[part.axis].get(part.id);
    return { ...part, label: known?.label ?? "?", name: known?.name ?? `Unknown ${part.axis}` };
  };

  return plan.lines.map((line): GeneratorLineView => {
    const firstSet = line.sets[0].copies;
    const first = firstSet[0];
    const firstStamp = stampById.get(first.stampId);
    const checklist = line.checklistId ? checklistById.get(line.checklistId) : undefined;
    const members = line.checklistId ? membersOf.get(line.checklistId) : undefined;
    // A set is named by its issue and checklist (#2104), a single by its issue and stamp (#2046), read
    // from the copy row the line expands to; a piece of several stamps keeps its own. No stand-in.
    const title = line.checklistId
      ? issueLineTitle(checklist?.issue?.name, checklist?.name)
      : first.multiStamp
        ? (firstStamp?.name ?? "")
        : issueLineTitle(copyById.get(first.itemId)?.issueName, firstStamp?.name);
    return {
      id: line.id,
      kind: line.checklistId ? "series" : first.multiStamp ? "carrier" : "single",
      title,
      combination: partsOf.get(line.id)!.map(combinationPart),
      catalog: labeller.set({
        title: null,
        items: firstSet.flatMap((copy) => {
          const stamp = stampById.get(copy.stampId);
          return stamp ? [{ itemId: copy.itemId, sortOrder: null, item: { stamp } }] : [];
        }),
      }),
      variantLabels: members
        ? [...new Set(firstSet.filter((copy) => !members.has(copy.stampId)).map((copy) => copyCatalog(copy.stampId)))]
        : [],
      // Every copy in the plan was read from the pool a moment ago, so a row is missing only when it
      // changed in between — and then the commit refuses by name anyway.
      sets: line.sets.map((set) => set.copies.flatMap((copy) => copyById.get(copy.itemId) ?? [])),
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
  /** The new post the created offers are the lots of (#2030), when the pass was asked for one. */
  post: { postId: string; postNo: number } | null;
}

/**
 * Carry a confirmed pass out (#1287).
 *
 * **Re-reads and re-plans from the request** (#717), then compares the fresh plan with the one the
 * collector confirmed: a copy that has since sold, gone onto an offer, changed or newly matches the
 * filters, or a receiving offer that changed state, set count or bidding, refuses the pass by name.
 * Only the lines the collector left ticked are written and compared (#1887): an unticked line's copies
 * stay where they are, so a change among them refuses nothing. The pass is all or nothing — `writeGeneratedOffers` writes it in one transaction and asks the same
 * questions once more inside it.
 */
export async function commitOfferGeneration(
  ownerId: string,
  collectionId: string,
  input: GeneratorInput,
  expected: PlanFingerprint,
  includeSpecialised = false
): Promise<OfferGeneratorResult> {
  const state = await readGeneratorState(ownerId, collectionId, input, includeSpecialised);
  const skip = new Set(input.skip);
  const drift = findPlanDrift(keptFingerprint(expected, skip), keptFingerprint(fingerprintPlan(state.plan, state.offers), skip));
  if (drift) throw new OfferActionBlockedError("not-eligible", await describeDrift(collectionId, drift));
  if (state.plan.lines.length === 0) {
    throw new OfferActionBlockedError("empty", "There is nothing to generate: none of these copies makes an offer in this mode.");
  }
  const lines = state.plan.lines.filter((line) => !skip.has(line.id));
  if (lines.length === 0) {
    throw new OfferActionBlockedError("empty", "There is nothing to generate: every proposed offer is unticked.");
  }
  const block = await quickOfferCreationBlock(
    ownerId,
    collectionId,
    input.platformId,
    input.state,
    readFacebookCreateChoice(input.facebook).facebookGroupId
  );
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

  // In a new post (#2030): only the offers this pass creates, as lots in the preview's order — an
  // existing offer receiving sets stays where it is. Refused before anything is written; the post is
  // then made inside the pass's own transaction, so there are never offers without the post asked for.
  const postTitle = input.postTitle;
  if (postTitle !== undefined) {
    const refusal = generatorPostRefusal({
      state: input.state,
      facebookGroupId: (await isFacebookPlatform(collectionId, input.platformId))
        ? readFacebookCreateChoice(input.facebook).facebookGroupId
        : null,
      newOffers: newOffers.length,
      title: postTitle,
    });
    if (refusal) throw new OfferActionBlockedError("facebook-group", refusal);
  }
  const made: { post: OfferGeneratorResult["post"] } = { post: null };

  try {
    const written = await writeGeneratedOffers(
      ownerId,
      collectionId,
      {
        platformId: input.platformId,
        state: input.state,
        ...readFacebookCreateChoice(input.facebook),
        newOffers,
        additions: [...additions.values()],
      },
      postTitle === undefined
        ? {}
        : {
            inTransaction: async (tx, createdOfferIds) => {
              made.post = await writeFacebookPost(tx, collectionId, createdOfferIds, postTitle);
            },
          }
    );
    // A post captioned from the start has its lots' photos queued now (#1861), as *Post together*'s.
    if (made.post) await syncFacebookPostLotPhotos(made.post.postId);
    return {
      createdOffers: written.createdOfferIds.length,
      changedOffers: written.changedOfferIds.length,
      sets: lines.reduce((n, line) => n + line.sets.length, 0),
      copies: lines.reduce((n, line) => n + line.sets.reduce((m, set) => m + set.copies.length, 0), 0),
      post: made.post,
    };
  } catch (e) {
    if (e instanceof GenerationChangedError) {
      throw new OfferActionBlockedError("not-eligible", await describeDrift(collectionId, e.drift));
    }
    throw e;
  }
}

async function isFacebookPlatform(collectionId: string, platformId: string): Promise<boolean> {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, collectionId },
    select: { platformModule: true },
  });
  return platform?.platformModule === FACEBOOK_PLATFORM_MODULE;
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
