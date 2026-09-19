// Generating offers in bulk from the Copies list (#1287) — the pure half. No React, no Prisma, so the
// preview, the commit and the unit tests share one plan, and the commit re-plans through this same
// function rather than being handed one (#717's rule).
//
// The question: out of the copies the collector can see, on **one platform**, which offers would a
// listing pass make — every complete series as one set, every loose stamp as one set, identical ones
// packed into one multi-quantity offer or kept apart. Nothing here is a new definition:
//
// - *Complete* is the bulk-lot builder's slot resolution (`checklistSlots`, #758), a variant copy
//   filling its parent's slot (#661), over one condition, certificate status and format at a time
//   (`combinationOf` under no mixing, #1265). A checklist of one stamp is not a series (#1257).
// - *A similar offer already exists* is `collidingItemIdsByOffer`, the rule the Copies list warns with
//   (#732) — the same function, handed the same members, not a second reading of it.
// - *Available* is decided in SQL before this runs (`listableOnPlatformFilters`, #758/#759); what is
//   left here is naming why a copy that was asked for is not in the pool.

import { checklistSlots, type CoverageCopy, type LotChecklist } from "./lot-builder-rules";
import {
  combinationKey,
  combinationOf,
  MIN_SERIES_STAMPS,
  NO_MIXING,
  type SeriesCombination,
} from "./series-recombination-rules";
import { collidingItemIdsByOffer, type OfferMemberCopy } from "./offer-collision-rules";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { LISTABLE_DELIVERY_STATES } from "./delivery-state";
import { isCreatableOfferState, type OfferState } from "./offer-rules";

// The choices ------------------------------------------------------------------------------------

/** What the pass lists: every complete series, or the copies left once those are taken out. */
export type GeneratorMode = "checklists" | "singles";

/** How identical sets are packed: one offer holding them all, or an offer each. */
export type GeneratorPackaging = "multi" | "separate";

export const GENERATOR_MODES: readonly GeneratorMode[] = ["checklists", "singles"];
export const GENERATOR_PACKAGINGS: readonly GeneratorPackaging[] = ["multi", "separate"];

// The input --------------------------------------------------------------------------------------

/** One copy the pool offers up — available on the platform, in the sense #758 reads. */
export interface GeneratorCopy extends CoverageCopy {
  itemId: string;
  itemNo: number;
  stampId: string;
  conditionId: string;
  /** Null: no certificate — a value on the axis (ADR-0006 §2). */
  certificateStatusId: string | null;
  /** Null: a single (ADR-0020) — a value on the axis too. */
  formatId: string | null;
  /** A carrier of several stamps (ADR-0044): it fills no slot and is always offered on its own (#745). */
  multiStamp: boolean;
  /** The stamp's catalogue sort key, which orders the singles as the catalogue reads. */
  catalogSortKey: string | null;
  /** The stamp the copy would be **listed under** on this platform (#1347) — the umbrella's resolved
   *  variant where the platform lists umbrellas that way, `stampId` otherwise and when absent. What
   *  *identical* and *a similar offer already exists* both read, so a `523` and a `523I` heading for
   *  one marketplace entry are one line and match one offer. */
  listedStampId?: string;
}

/** An open offer on the platform, as the plan needs to know it. */
export interface GeneratorOffer {
  offerId: string;
  offerNo: number;
  state: OfferState;
  /** The standing bidding flag (#215); it only means anything on an `active` offer. */
  inActiveBidding: boolean;
  setCount: number;
}

// Sets -------------------------------------------------------------------------------------------

/** One sellable unit the pass would list: a whole series, or one copy. */
export interface GeneratedSet {
  /** The series the set completes; null for a single. */
  checklistId: string | null;
  /** What every copy shares — a set is uniform in condition, certificate and format (#1265). */
  combination: SeriesCombination;
  /** In the checklist's own order; one copy for a single. */
  copies: GeneratorCopy[];
}

const byItemNo = (a: GeneratorCopy, b: GeneratorCopy) => a.itemNo - b.itemNo;

/**
 * Split the pool into complete series and the singles left over.
 *
 * `checklists` come **in precedence order** — the order set on the issue (#531) — and each is asked on
 * its own: the first takes every complete set it can out of the copies, and the next is asked of what
 * is left, so a copy goes into at most one set and the order decides between two series competing for
 * it. The copies are split by combination first, so a series completable only by mixing conditions,
 * certificates or formats forms no set and its copies stay singles; perforated and imperforate are
 * simply two checklists.
 *
 * Which copy fills a slot when several can: **the slot's own stamp before a variant of it** (#661 lets
 * the variant in; it is not the collector's first choice for a series), then the lowest copy number,
 * so the answer is the same on every read. A multi-stamp copy never fills a slot (#745).
 */
export function assembleSets(
  copies: readonly GeneratorCopy[],
  checklists: readonly LotChecklist[]
): { sets: GeneratedSet[]; singles: GeneratedSet[] } {
  const series = checklists.filter((checklist) => new Set(checklist.stampIds).size >= MIN_SERIES_STAMPS);
  const groups = new Map<string, { combination: SeriesCombination; copies: GeneratorCopy[] }>();
  for (const copy of copies) {
    if (copy.multiStamp) continue;
    const combination = combinationOf(copy, NO_MIXING);
    const key = combinationKey(combination);
    const group = groups.get(key);
    if (group) group.copies.push(copy);
    else groups.set(key, { combination, copies: [copy] });
  }

  const sets: GeneratedSet[] = [];
  const used = new Set<string>();
  for (const checklist of series) {
    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key)!;
      for (;;) {
        const remaining = group.copies.filter((copy) => !used.has(copy.itemId)).sort(byItemNo);
        const slots = checklistSlots(remaining, checklist);
        if (slots.size === 0 || [...slots.values()].some((candidates) => candidates.length === 0)) break;
        const picked = [...slots].map(
          ([stampId, candidates]) => candidates.find((copy) => copy.stampId === stampId) ?? candidates[0]
        );
        for (const copy of picked) used.add(copy.itemId);
        sets.push({ checklistId: checklist.checklistId, combination: group.combination, copies: picked });
      }
    }
  }

  const singles = copies
    .filter((copy) => !used.has(copy.itemId))
    .sort((a, b) => compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey) || byItemNo(a, b))
    .map((copy) => ({ checklistId: null, combination: combinationOf(copy, NO_MIXING), copies: [copy] }));
  return { sets, singles };
}

/** The stamp a copy is listed under on the pass's platform (#1347) — its own where nothing resolves. */
function listedStampOf(copy: GeneratorCopy): string {
  return copy.listedStampId ?? copy.stampId;
}

/**
 * What makes two sets **identical**, so that they may share a multi-quantity offer: for a series, the
 * same checklist in the same stamps — a variant filling a slot makes a different set, decided with the
 * user on 2026-09-14 — and for a single the same stamp; in both, the same condition, certificate status
 * and format. A multi-stamp copy is identical to nothing.
 *
 * "The same stamp" is the stamp each copy is **listed under** (#1347, decided with the user on
 * 2026-09-19): on a platform that lists an umbrella under its cheapest variant, a `523` copy resolving
 * to `523I` goes on the very entry a `523I` copy does, and two lines for it would be two offers the
 * marketplace refuses the second of. A variant that is *not* what its umbrella resolves to still makes
 * a different set, exactly as before.
 */

export function setIdentity(set: GeneratedSet): string {
  const { conditionId, certificateStatusId, formatId } = set.combination;
  if (set.checklistId !== null) {
    return JSON.stringify(["set", set.checklistId, set.copies.map(listedStampOf), conditionId, certificateStatusId, formatId]);
  }
  const copy = set.copies[0];
  if (copy.multiStamp) return JSON.stringify(["carrier", copy.itemId]);
  return JSON.stringify(["single", listedStampOf(copy), conditionId, certificateStatusId, formatId]);
}

/** FNV-1a, hex — a short stable id for a line, safe in a query string. */
export function lineIdOf(identity: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i += 1) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// The plan ---------------------------------------------------------------------------------------

/** Where a line's sets go. */
export type LineTarget =
  | { kind: "new" }
  | { kind: "existing"; offerId: string };

/** One offer the pass would make or add to. */
export interface PlanLine {
  /** Stable across reads of the same pool — what a chosen target is keyed by. */
  id: string;
  checklistId: string | null;
  combination: SeriesCombination;
  /** Every set the line lists, each in its own order. */
  sets: GeneratedSet[];
  /** Offers on the platform a set of exactly these stamps × conditions already sits in (#732) and
   *  which may receive the sets, lowest number first. Always empty with separate packaging. */
  matches: string[];
  /** Offers that match but are in active bidding, and so never receive a set (#334). */
  biddingMatches: string[];
  target: LineTarget;
  /** How many sets the offer will hold once the pass has run. */
  resultingSetCount: number;
}

export interface GeneratorPlanInput {
  copies: readonly GeneratorCopy[];
  checklists: readonly LotChecklist[];
  mode: GeneratorMode;
  packaging: GeneratorPackaging;
  /** Every copy of every set of the platform's open offers that holds one of the pool's stamps — the
   *  members `collidingItemIdsByOffer` compares whole compositions over (#732). */
  members: readonly OfferMemberCopy[];
  offers: ReadonlyMap<string, GeneratorOffer>;
  /** The collector's pick among several matches, by line id. Anything not a current match is ignored. */
  targets?: Readonly<Record<string, string>>;
}

export interface GeneratorPlan {
  lines: PlanLine[];
  /** Pool copies the other mode lists: the leftover singles in checklist mode, the copies in complete
   *  sets in singles mode. Running both modes, in either order, lists every copy once. */
  otherModeCopies: number;
}

function inActiveBidding(offer: GeneratorOffer): boolean {
  return offer.state === "active" && offer.inActiveBidding;
}

/**
 * Plan the pass.
 *
 * **Singles are the copies left once the complete sets are taken out**, in either mode — so listing the
 * singles first never breaks up a series, and the two modes give the same result in either order.
 *
 * With **separate** packaging every set is a new offer of its own, even where a similar offer exists.
 * With **multi-quantity**, identical sets are one line; a line whose set matches an open offer on the
 * platform (#732) is added to it — the lowest-numbered one, or the one the collector picked — and one
 * whose only matches are in active bidding becomes a new offer instead (#334).
 */
export function planOffers(input: GeneratorPlanInput): GeneratorPlan {
  const { sets, singles } = assembleSets(input.copies, input.checklists);
  const listed = input.mode === "checklists" ? sets : singles;
  const otherModeCopies =
    input.mode === "checklists" ? singles.length : sets.reduce((n, set) => n + set.copies.length, 0);

  const drafts: { identity: string; sets: GeneratedSet[] }[] = [];
  if (input.packaging === "separate") {
    const seen = new Map<string, number>();
    for (const set of listed) {
      const identity = setIdentity(set);
      const index = seen.get(identity) ?? 0;
      seen.set(identity, index + 1);
      drafts.push({ identity: `${identity}#${index}`, sets: [set] });
    }
  } else {
    const byIdentity = new Map<string, GeneratedSet[]>();
    for (const set of listed) {
      const identity = setIdentity(set);
      const group = byIdentity.get(identity);
      if (group) group.push(set);
      else {
        const created = [set];
        byIdentity.set(identity, created);
        drafts.push({ identity, sets: created });
      }
    }
  }

  const offerNo = (id: string) => input.offers.get(id)?.offerNo ?? Number.MAX_SAFE_INTEGER;
  const setsHeld = new Map<string, number>();
  const lines = drafts.map((draft): PlanLine => {
    const id = lineIdOf(draft.identity);
    const first = draft.sets[0];
    let matches: string[] = [];
    let biddingMatches: string[] = [];
    if (input.packaging === "multi") {
      const hits = collidingItemIdsByOffer(
        first.copies.map((copy) => ({
          itemId: copy.itemId,
          stampId: copy.stampId,
          conditionId: copy.conditionId,
          listedStampId: copy.listedStampId,
        })),
        input.members
      );
      const found = [...hits.keys()].filter((offerId) => input.offers.has(offerId)).sort((a, b) => offerNo(a) - offerNo(b));
      biddingMatches = found.filter((offerId) => inActiveBidding(input.offers.get(offerId)!));
      matches = found.filter((offerId) => !biddingMatches.includes(offerId));
    }
    const chosen = input.targets?.[id];
    const targetId = chosen !== undefined && matches.includes(chosen) ? chosen : matches[0];
    const target: LineTarget = targetId ? { kind: "existing", offerId: targetId } : { kind: "new" };
    let resultingSetCount = draft.sets.length;
    if (targetId) {
      resultingSetCount += setsHeld.get(targetId) ?? input.offers.get(targetId)?.setCount ?? 0;
      setsHeld.set(targetId, resultingSetCount);
    }
    return {
      id,
      checklistId: first.checklistId,
      combination: first.combination,
      sets: draft.sets,
      matches,
      biddingMatches,
      target,
      resultingSetCount,
    };
  });
  return { lines, otherModeCopies };
}

// Refusing a stale plan (#717) -------------------------------------------------------------------

/** What the collector confirmed: every line's sets and where they go, with the target as it stood. */
export interface PlanFingerprint {
  lines: {
    id: string;
    sets: string[][];
    /** The offer receiving the sets, or null for a new offer. */
    targetOfferId: string | null;
    targetState: OfferState | null;
    targetSetCount: number | null;
  }[];
}

export function fingerprintPlan(plan: GeneratorPlan, offers: ReadonlyMap<string, GeneratorOffer>): PlanFingerprint {
  return {
    lines: plan.lines.map((line) => {
      const target = line.target.kind === "existing" ? offers.get(line.target.offerId) : undefined;
      return {
        id: line.id,
        sets: line.sets.map((set) => set.copies.map((copy) => copy.itemId)),
        targetOfferId: target?.offerId ?? null,
        targetState: target?.state ?? null,
        targetSetCount: target?.setCount ?? null,
      };
    }),
  };
}

/** Why a confirmation was refused: a copy, or an offer, is not where the preview put it. */
export type PlanDrift = { kind: "copy"; itemId: string } | { kind: "offer"; offerId: string };

function placements(fingerprint: PlanFingerprint): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of fingerprint.lines) {
    line.sets.forEach((set, index) => {
      for (const itemId of set) out.set(itemId, `${line.id}/${index}`);
    });
  }
  return out;
}

/**
 * The first difference between the plan the collector confirmed and the plan the pool gives now, or
 * null when they agree. **A copy is named before an offer** — a copy that sold, was listed, changed or
 * newly matches is the likelier story and the one the collector can look up — then an offer that no
 * longer receives the sets, or has changed state or set count since.
 */
export function findPlanDrift(expected: PlanFingerprint, actual: PlanFingerprint): PlanDrift | null {
  const was = placements(expected);
  const now = placements(actual);
  for (const itemId of was.keys()) if (!now.has(itemId)) return { kind: "copy", itemId };
  for (const itemId of now.keys()) if (!was.has(itemId)) return { kind: "copy", itemId };
  for (const [itemId, place] of was) if (now.get(itemId) !== place) return { kind: "copy", itemId };

  const lines = new Map(actual.lines.map((line) => [line.id, line]));
  for (const line of expected.lines) {
    const current = lines.get(line.id);
    if (!current) continue;
    if (current.targetOfferId !== line.targetOfferId) {
      return { kind: "offer", offerId: (line.targetOfferId ?? current.targetOfferId)! };
    }
    if (
      line.targetOfferId !== null &&
      (current.targetState !== line.targetState || current.targetSetCount !== line.targetSetCount)
    ) {
      return { kind: "offer", offerId: line.targetOfferId };
    }
  }
  return null;
}

/** A fingerprint handed across the wire, checked for shape. Null when it is not one. */
export function parsePlanFingerprint(value: unknown): PlanFingerprint | null {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { lines?: unknown }).lines)) return null;
  const lines: PlanFingerprint["lines"] = [];
  for (const raw of (value as { lines: unknown[] }).lines) {
    if (typeof raw !== "object" || raw === null) return null;
    const line = raw as Record<string, unknown>;
    if (typeof line.id !== "string" || !Array.isArray(line.sets)) return null;
    const sets: string[][] = [];
    for (const set of line.sets) {
      if (!Array.isArray(set) || !set.every((id) => typeof id === "string")) return null;
      sets.push(set as string[]);
    }
    const targetOfferId = line.targetOfferId;
    const targetState = line.targetState;
    const targetSetCount = line.targetSetCount;
    if (targetOfferId !== null && typeof targetOfferId !== "string") return null;
    if (targetState !== null && typeof targetState !== "string") return null;
    if (targetSetCount !== null && typeof targetSetCount !== "number") return null;
    lines.push({
      id: line.id,
      sets,
      targetOfferId,
      targetState: targetState as OfferState | null,
      targetSetCount,
    });
  }
  return { lines };
}

// Why a copy was skipped -------------------------------------------------------------------------

/** Why a copy that was asked for is not in the pool, in the terms #758's availability is made of. */
export type SkipReason =
  | "gone"
  | "not-for-sale"
  | "not-in-hand"
  | "set-aside"
  | "offered"
  | "in-bidding";

export const SKIP_REASONS: readonly SkipReason[] = [
  "gone",
  "not-for-sale",
  "not-in-hand",
  "set-aside",
  "offered",
  "in-bidding",
];

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  gone: "no longer held — sold, traded away or written off",
  "not-for-sale": "not marked for sale",
  "not-in-hand": "not in hand",
  "set-aside": "set aside from this platform",
  offered: "already offered on this platform",
  "in-bidding": "in an offer in active bidding",
};

export interface SkipFacts {
  /** Sold, given away in a closed trade, or disposed of. */
  gone: boolean;
  forSale: boolean;
  deliveryState: string;
  /** Set aside for the platform (#506). */
  setAside: boolean;
  /** In an open offer on the platform (#259). */
  offeredOnPlatform: boolean;
  /** In an active offer in bidding on any platform (#334). */
  inActiveBidding: boolean;
}

/**
 * The one reason a copy is counted under, the most final first: a copy that has gone is not also
 * reported as not for sale. Null when none of the facts holds — the copy became available between the
 * two reads, and the plan's own re-read is what decides about it.
 */
export function skipReason(facts: SkipFacts): SkipReason | null {
  if (facts.gone) return "gone";
  if (!facts.forSale) return "not-for-sale";
  if (!(LISTABLE_DELIVERY_STATES as readonly string[]).includes(facts.deliveryState)) return "not-in-hand";
  if (facts.setAside) return "set-aside";
  if (facts.offeredOnPlatform) return "offered";
  if (facts.inActiveBidding) return "in-bidding";
  return null;
}

// The request ------------------------------------------------------------------------------------

/**
 * What the dialog asks for, as it travels in the preview's query string and to the commit. Which
 * copies is either the ticked ones (`itemIds`) or the list's filters, carried as the Copies list's own
 * query string (`filters`) so the server reads them through the one parser the list itself uses.
 */
export interface GeneratorRequest {
  platformId: string;
  state: OfferState;
  mode: GeneratorMode;
  packaging: GeneratorPackaging;
  itemIds: string[] | null;
  filters: string;
  targets: Record<string, string>;
}

export function generatorRequestParams(request: GeneratorRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("platformId", request.platformId);
  params.set("state", request.state);
  params.set("mode", request.mode);
  params.set("packaging", request.packaging);
  if (request.itemIds !== null) params.set("ids", request.itemIds.join(","));
  else if (request.filters) params.set("filters", request.filters);
  const targets = Object.entries(request.targets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lineId, offerId]) => `${lineId}:${offerId}`);
  if (targets.length > 0) params.set("targets", targets.join(","));
  return params;
}

/** Read a request off a query string. Null when a required choice is missing or unrecognised — a
 *  generator guessing at a platform, a status or a packaging would create offers nobody asked for. */
export function parseGeneratorRequest(sp: URLSearchParams): GeneratorRequest | null {
  const platformId = sp.get("platformId");
  const state = sp.get("state");
  const mode = sp.get("mode");
  const packaging = sp.get("packaging");
  if (!platformId || !isCreatableOfferState(state)) return null;
  if (!GENERATOR_MODES.includes(mode as GeneratorMode)) return null;
  if (!GENERATOR_PACKAGINGS.includes(packaging as GeneratorPackaging)) return null;
  const ids = sp.get("ids");
  const targets: Record<string, string> = {};
  for (const pair of (sp.get("targets") ?? "").split(",")) {
    const [lineId, offerId] = pair.split(":");
    if (lineId && offerId) targets[lineId] = offerId;
  }
  return {
    platformId,
    state,
    mode: mode as GeneratorMode,
    packaging: packaging as GeneratorPackaging,
    itemIds: sp.has("ids") ? (ids ?? "").split(",").filter(Boolean) : null,
    filters: sp.get("filters") ?? "",
    targets,
  };
}
