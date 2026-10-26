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
//   (`combinationOf` under no mixing, #1265) — unless the collector lets a set mix an axis, with the
//   switches Series from Singles has (`SeriesMixing`, #2102). A checklist of one stamp is not a series
//   (#1257) — unless the collector counts one-stamp series as complete sets (#2202).
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
  SERIES_MIXING_PARAMS,
  type SeriesCombination,
  type SeriesMixing,
} from "./series-recombination-rules";
import { collidingItemIdsByOffer, type OfferMemberCopy } from "./offer-collision-rules";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { LISTABLE_DELIVERY_STATES } from "./delivery-state";
import { isCreatableOfferState, type OfferState } from "./offer-rules";
import { facebookPostTitleRefusal, isFacebookLotPosted, type FacebookCreateChoice } from "./facebook-post-rules";

// The choices ------------------------------------------------------------------------------------

/** What the pass lists: every complete series, or the copies left once those are taken out. */
export type GeneratorMode = "checklists" | "singles";

/** How identical sets are packed: one offer holding them all, or an offer each. */
export type GeneratorPackaging = "multi" | "separate";

export const GENERATOR_MODES: readonly GeneratorMode[] = ["checklists", "singles"];
export const GENERATOR_PACKAGINGS: readonly GeneratorPackaging[] = ["multi", "separate"];

/**
 * With a mixing switch on, which sets come first (#2102): **same value first** forms every set complete
 * in one value as before and mixes only the copies left over; **mix freely** forms sets in the usual
 * order whatever the value, so whatever completes a set does, pure or mixed.
 */
export type MixPriority = "same-first" | "free";

export const MIX_PRIORITIES: readonly MixPriority[] = ["same-first", "free"];

/** The query parameter the priority travels in; only *mix freely* is written, the default is not. */
export const MIX_PRIORITY_PARAM = "mixPriority";

/** The query parameter the one-stamp switch travels in (#2202); written only when on. */
export const ONE_STAMP_SETS_PARAM = "oneStampSets";

function mixesAny(mixing: SeriesMixing): boolean {
  return mixing.condition || mixing.certificate || mixing.format;
}

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
  /** What every copy shares (#1265): a value on every axis the copies agree on, and no key on one they
   *  mix (#2102) — so a set that happens to come out pure names its value, however it was formed. */
  combination: SeriesCombination;
  /** In the checklist's own order; one copy for a single. */
  copies: GeneratorCopy[];
}

const byItemNo = (a: GeneratorCopy, b: GeneratorCopy) => a.itemNo - b.itemNo;

/** What a set's copies share: the value on every axis they agree on, no key on one they do not. */
function sharedCombination(copies: readonly GeneratorCopy[]): SeriesCombination {
  const [first, ...rest] = copies;
  return {
    ...(rest.every((copy) => copy.conditionId === first.conditionId) ? { conditionId: first.conditionId } : {}),
    ...(rest.every((copy) => copy.certificateStatusId === first.certificateStatusId)
      ? { certificateStatusId: first.certificateStatusId }
      : {}),
    ...(rest.every((copy) => copy.formatId === first.formatId) ? { formatId: first.formatId } : {}),
  };
}

const MIX_AXES = [
  ["condition", (copy: GeneratorCopy) => copy.conditionId],
  ["certificate", (copy: GeneratorCopy) => copy.certificateStatusId],
  ["format", (copy: GeneratorCopy) => copy.formatId],
] as const;

/**
 * One copy per slot, leaning to the value most of the set shares (#2102, *same value first*): on each
 * mixed axis the value the most slots can be filled in is preferred, so a mixed set is eleven MH and
 * one MNH rather than six and six. A tie goes to the value more candidates hold, then to the lower id
 * — the same answer on every read. The rest is the usual order: own stamp, then lowest copy number.
 */
function pickLeaning(slots: Map<string, GeneratorCopy[]>, mixing: SeriesMixing): GeneratorCopy[] {
  const preferred = MIX_AXES.filter(([axis]) => mixing[axis]).map(([, valueOf]) => {
    const slotsFor = new Map<string | null, number>();
    const copiesFor = new Map<string | null, number>();
    for (const candidates of slots.values()) {
      for (const value of new Set(candidates.map(valueOf))) slotsFor.set(value, (slotsFor.get(value) ?? 0) + 1);
      for (const copy of candidates) copiesFor.set(valueOf(copy), (copiesFor.get(valueOf(copy)) ?? 0) + 1);
    }
    const [best] = [...slotsFor.keys()].sort(
      (a, b) =>
        slotsFor.get(b)! - slotsFor.get(a)! ||
        copiesFor.get(b)! - copiesFor.get(a)! ||
        (a ?? "").localeCompare(b ?? "")
    );
    return { valueOf, best };
  });
  return [...slots].map(([stampId, candidates]) => {
    const score = (copy: GeneratorCopy) =>
      preferred.reduce((n, { valueOf, best }, i) => n + (valueOf(copy) === best ? 2 ** (preferred.length - i) : 0), 0);
    return [...candidates].sort(
      (a, b) =>
        score(b) - score(a) || Number(b.stampId === stampId) - Number(a.stampId === stampId) || byItemNo(a, b)
    )[0];
  });
}

/**
 * Take every complete set each checklist can make out of `pool`, the copies grouped by what `mixing`
 * keeps apart. Checklists are asked **in precedence order**, each taking every set before the next is
 * asked; `used` is shared, so a copy goes into at most one set.
 */
function takeSets(
  pool: readonly GeneratorCopy[],
  series: readonly LotChecklist[],
  mixing: SeriesMixing,
  lean: boolean,
  used: Set<string>,
  sets: GeneratedSet[]
): void {
  const groups = new Map<string, GeneratorCopy[]>();
  for (const copy of pool) {
    const key = combinationKey(combinationOf(copy, mixing));
    const group = groups.get(key);
    if (group) group.push(copy);
    else groups.set(key, [copy]);
  }
  for (const checklist of series) {
    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key)!;
      for (;;) {
        const remaining = group.filter((copy) => !used.has(copy.itemId)).sort(byItemNo);
        const slots = checklistSlots(remaining, checklist);
        if (slots.size === 0 || [...slots.values()].some((candidates) => candidates.length === 0)) break;
        const picked = lean
          ? pickLeaning(slots, mixing)
          : [...slots].map(([stampId, candidates]) => candidates.find((copy) => copy.stampId === stampId) ?? candidates[0]);
        for (const copy of picked) used.add(copy.itemId);
        sets.push({ checklistId: checklist.checklistId, combination: sharedCombination(picked), copies: picked });
      }
    }
  }
}

/**
 * Split the pool into complete series and the singles left over.
 *
 * `checklists` come **in precedence order** — the order set on the issue (#531) — and each is asked on
 * its own: the first takes every complete set it can out of the copies, and the next is asked of what
 * is left, so a copy goes into at most one set and the order decides between two series competing for
 * it. The copies are split by combination first, so with no mixing a series completable only by mixing
 * conditions, certificates or formats forms no set and its copies stay singles; perforated and
 * imperforate are simply two checklists.
 *
 * A checklist of a single stamp is no series (#1257) — unless `oneStampSets` (#2202): then a copy of its
 * stamp is a complete set of its own, under every rule above, and so never a single.
 *
 * **Mixing** (#2102) stops splitting on the axes it names. Under *same value first* the pass above runs
 * unchanged and a second one, mixing, is asked of what it left — leaning each mixed set to the value
 * most of it shares; under *mix freely* only the mixing pass runs. Either way the sets come out
 * checklist by checklist, a checklist's pure sets before its mixed ones.
 *
 * Which copy fills a slot when several can: **the slot's own stamp before a variant of it** (#661 lets
 * the variant in; it is not the collector's first choice for a series), then the lowest copy number,
 * so the answer is the same on every read. A multi-stamp copy never fills a slot (#745).
 */
export function assembleSets(
  copies: readonly GeneratorCopy[],
  checklists: readonly LotChecklist[],
  mixing: SeriesMixing = NO_MIXING,
  priority: MixPriority = "same-first",
  oneStampSets = false
): { sets: GeneratedSet[]; singles: GeneratedSet[] } {
  const minStamps = oneStampSets ? 1 : MIN_SERIES_STAMPS;
  const series = checklists.filter((checklist) => new Set(checklist.stampIds).size >= minStamps);
  const pool = copies.filter((copy) => !copy.multiStamp);
  const mixed = mixesAny(mixing);
  const sets: GeneratedSet[] = [];
  const used = new Set<string>();
  if (!mixed || priority === "same-first") takeSets(pool, series, NO_MIXING, false, used, sets);
  if (mixed) takeSets(pool, series, mixing, priority === "same-first", used, sets);
  const order = new Map(series.map((checklist, index) => [checklist.checklistId, index]));
  sets.sort((a, b) => order.get(a.checklistId!)! - order.get(b.checklistId!)!);

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
 *
 * A **mixed** set (#2102) is identical to another only when every stamp is in the same condition,
 * certificate and format in both: twelve MH but one MNH is a different set from eleven MH and one MNH
 * on another stamp.
 */

export function setIdentity(set: GeneratedSet): string {
  const { conditionId, certificateStatusId, formatId } = set.combination;
  if (set.checklistId !== null) {
    if (conditionId === undefined || certificateStatusId === undefined || formatId === undefined) {
      return JSON.stringify([
        "mixed",
        set.checklistId,
        set.copies.map((copy) => [listedStampOf(copy), copy.conditionId, copy.certificateStatusId, copy.formatId]),
      ]);
    }
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
  /** Which axes a set may mix (#2102); absent, none — the default. */
  mixing?: SeriesMixing;
  /** Which sets come first while some axis is mixed; absent, *same value first*. */
  priority?: MixPriority;
  /** Whether a checklist of a single stamp counts as a complete set (#2202); absent, it does not. */
  oneStampSets?: boolean;
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
  const { sets, singles } = assembleSets(
    input.copies,
    input.checklists,
    input.mixing,
    input.priority,
    input.oneStampSets
  );
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

// Leaving offers out (#1887) ---------------------------------------------------------------------
//
// The preview proposes every offer the pass can make, and the collector ticks the ones to create.
// **Unticking drops a line and nothing else**: the plan is not re-run without it, so its copies go to
// no other line and simply stay where they are. That is why the ticks never travel with the preview's
// query — a tick needs no fresh plan — and travel only with the commit, which writes the kept lines.

/** One line as the selection reads it: its id, its sets (only their sizes count), where they go and
 *  how many sets the receiving offer was to hold. Both a plan line's view and the plan line fit. */
export interface GeneratorSelectionLine {
  id: string;
  sets: readonly (readonly unknown[])[];
  target: LineTarget;
  resultingSetCount: number;
}

/** What the ticked lines make, and what the unticked ones leave where it is. */
export interface GeneratorSelection {
  newOffers: number;
  changedOffers: number;
  sets: number;
  copies: number;
  /** Lines left unticked, and the copies in them. */
  leftOffers: number;
  leftCopies: number;
}

export function generatorSelection(
  lines: readonly GeneratorSelectionLine[],
  skip: ReadonlySet<string>
): GeneratorSelection {
  const kept = lines.filter((line) => !skip.has(line.id));
  const copiesOf = (line: GeneratorSelectionLine) => line.sets.reduce((n, set) => n + set.length, 0);
  return {
    newOffers: kept.filter((line) => line.target.kind === "new").length,
    changedOffers: new Set(kept.flatMap((line) => (line.target.kind === "existing" ? [line.target.offerId] : []))).size,
    sets: kept.reduce((n, line) => n + line.sets.length, 0),
    copies: kept.reduce((n, line) => n + copiesOf(line), 0),
    leftOffers: lines.length - kept.length,
    leftCopies: lines.filter((line) => skip.has(line.id)).reduce((n, line) => n + copiesOf(line), 0),
  };
}

/**
 * How many sets a receiving offer will hold after a kept line, once the unticked lines are out. The
 * plan counts every earlier line bound for the same offer (`resultingSetCount`); an unticked one no
 * longer adds its sets, so they come off. A line's own sets are always counted — the figure is what
 * the line would leave the offer with if it were ticked.
 */
export function keptResultingSetCount(
  lines: readonly GeneratorSelectionLine[],
  skip: ReadonlySet<string>,
  lineId: string
): number {
  const index = lines.findIndex((line) => line.id === lineId);
  if (index < 0) return 0;
  const line = lines[index];
  if (line.target.kind !== "existing") return line.resultingSetCount;
  const offerId = line.target.offerId;
  const dropped = lines
    .slice(0, index)
    .filter((other) => skip.has(other.id) && other.target.kind === "existing" && other.target.offerId === offerId)
    .reduce((n, other) => n + other.sets.length, 0);
  return line.resultingSetCount - dropped;
}

/**
 * The part of a fingerprint the commit is answerable for: the lines left ticked. A drift on an
 * unticked line — a copy in it that sold since — refuses nothing, because nothing of it is written;
 * a copy moving between a kept line and anywhere else still shows on the kept side.
 */
export function keptFingerprint(fingerprint: PlanFingerprint, skip: ReadonlySet<string>): PlanFingerprint {
  return { lines: fingerprint.lines.filter((line) => !skip.has(line.id)) };
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
  /** Which axes a complete set may mix (#2102), and which sets come first while one is mixed. Absent,
   *  no mixing — the pass as it always was. */
  mixing?: SeriesMixing;
  priority?: MixPriority;
  /** Whether a one-stamp checklist counts as a complete set (#2202). It decides what both modes list,
   *  so it travels with either. Absent, it does not — the pass as it always was. */
  oneStampSets?: boolean;
  itemIds: string[] | null;
  filters: string;
  targets: Record<string, string>;
  /** Lines the collector unticked (#1887), by id — only the commit carries any. */
  skip: string[];
  /** The group every new offer is an auction in, and when it closes, on Facebook (#1663). */
  facebook: FacebookCreateChoice;
  /** On Facebook, the title of the one new post the offers the pass creates become the lots of
   *  (#2030); absent, no post is made. Like `skip`, only the commit carries it. */
  postTitle?: string;
}

export function generatorRequestParams(request: GeneratorRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("platformId", request.platformId);
  params.set("state", request.state);
  params.set("mode", request.mode);
  params.set("packaging", request.packaging);
  // Spelled as Series from Singles spells them (#1265), and only what is on.
  const mixing = request.mixing ?? NO_MIXING;
  for (const axis of Object.keys(SERIES_MIXING_PARAMS) as (keyof SeriesMixing)[]) {
    if (mixing[axis]) params.set(SERIES_MIXING_PARAMS[axis], "true");
  }
  if (mixesAny(mixing) && request.priority === "free") params.set(MIX_PRIORITY_PARAM, "free");
  if (request.oneStampSets) params.set(ONE_STAMP_SETS_PARAM, "true");
  if (request.itemIds !== null) params.set("ids", request.itemIds.join(","));
  else if (request.filters) params.set("filters", request.filters);
  const targets = Object.entries(request.targets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lineId, offerId]) => `${lineId}:${offerId}`);
  if (targets.length > 0) params.set("targets", targets.join(","));
  if (request.skip.length > 0) params.set("skip", [...request.skip].sort().join(","));
  if (request.facebook.facebookGroupId) params.set("facebookGroupId", request.facebook.facebookGroupId);
  if (request.facebook.endsAt) params.set("endsAt", request.facebook.endsAt);
  if (request.postTitle !== undefined) params.set("postTitle", request.postTitle);
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
    mixing: {
      condition: sp.get(SERIES_MIXING_PARAMS.condition) === "true",
      certificate: sp.get(SERIES_MIXING_PARAMS.certificate) === "true",
      format: sp.get(SERIES_MIXING_PARAMS.format) === "true",
    },
    priority: sp.get(MIX_PRIORITY_PARAM) === "free" ? "free" : "same-first",
    oneStampSets: sp.get(ONE_STAMP_SETS_PARAM) === "true",
    itemIds: sp.has("ids") ? (ids ?? "").split(",").filter(Boolean) : null,
    filters: sp.get("filters") ?? "",
    targets,
    skip: (sp.get("skip") ?? "").split(",").filter(Boolean),
    facebook: { facebookGroupId: sp.get("facebookGroupId"), endsAt: sp.get("endsAt") },
    ...(sp.has("postTitle") ? { postTitle: sp.get("postTitle") ?? "" } : {}),
  };
}

/** Whether a pass in this status may put its offers into a new post (#2030): only one whose offers
 *  are not yet up — an offer that is up is already in a post of its own (#1989). */
export function canGenerateIntoPost(state: OfferState): boolean {
  return !isFacebookLotPosted(state);
}

/**
 * Why a pass cannot put the offers it creates into one new post (#2030), or null. *Post together*'s
 * rules as they bear on a pass: one Facebook group (the bar's), offers not yet up, at least two lots,
 * and a title. The listing type needs no asking here — every offer a pass creates starts as its
 * group's — and is asked again of the written offers when the post is made.
 */
export function generatorPostRefusal(request: {
  state: OfferState;
  facebookGroupId: string | null;
  newOffers: number;
  title: string;
}): string | null {
  if (!request.facebookGroupId) return "Only Facebook offers can go into a post — choose the group first.";
  if (!canGenerateIntoPost(request.state)) {
    return "Only offers not yet up can go into a new post — an offer that is up is in a post of its own.";
  }
  if (request.newOffers < 2) return "A post with several lots needs at least two new offers.";
  return facebookPostTitleRefusal(request.title);
}

// ── How the preview states a line (#1368) ──────────────────────────────────────────────────────────

/** One axis value on a preview line; `count` only where the line mixes that axis (#2102). */
export interface CombinationPartRef {
  axis: "condition" | "certificate" | "format";
  id: string | null;
  count: number | null;
}

/**
 * The combination the way the copy count popover writes it (#1243): the condition always, the
 * certificate and the format **only when they are not the default** — no certificate, single. Over
 * fifty lines the defaults said nothing and took most of the room.
 *
 * An axis the set **mixes** (#2102) names every value in it with how many of the set's copies are in
 * it, the most first — *MH ×11 · MNH ×1* — the default included, since there it is half the story.
 */
export function generatorCombinationParts(
  combination: {
    conditionId?: string | null;
    certificateStatusId?: string | null;
    formatId?: string | null;
  },
  copies: readonly Pick<GeneratorCopy, "conditionId" | "certificateStatusId" | "formatId">[] = []
): CombinationPartRef[] {
  const mix = (axis: CombinationPartRef["axis"], values: (string | null)[]): CombinationPartRef[] => {
    const counts = new Map<string | null, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts]
      .sort(([, a], [, b]) => b - a)
      .map(([id, count]) => ({ axis, id, count }));
  };
  const { conditionId, certificateStatusId, formatId } = combination;
  return [
    ...("conditionId" in combination
      ? [{ axis: "condition" as const, id: conditionId ?? null, count: null }]
      : mix("condition", copies.map((copy) => copy.conditionId))),
    ...("certificateStatusId" in combination
      ? certificateStatusId
        ? [{ axis: "certificate" as const, id: certificateStatusId, count: null }]
        : []
      : mix("certificate", copies.map((copy) => copy.certificateStatusId))),
    ...("formatId" in combination
      ? formatId
        ? [{ axis: "format" as const, id: formatId, count: null }]
        : []
      : mix("format", copies.map((copy) => copy.formatId))),
  ];
}

/**
 * A line's name in the preview: its issue's name, then its own — the stamp's for a single (#2046),
 * the checklist's for a set (#2104) — as `Issue · Own`, so every line reads by its issue first. Most
 * stamps carry no name of their own, and a fallback to a stand-in made a long pass hundreds of
 * identical lines. With neither name the line has none: its catalogue numbers already say what it is.
 * An own name equal to the issue's is named once — a checklist is often named after its issue (#1368).
 */
export function issueLineTitle(issueName: string | null | undefined, ownName: string | null | undefined): string {
  const issue = issueName?.trim() ?? "";
  const own = ownName?.trim() ?? "";
  if (!issue || !own) return issue || own;
  return issue.localeCompare(own, undefined, { sensitivity: "base" }) === 0 ? issue : `${issue} · ${own}`;
}
