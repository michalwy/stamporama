import "server-only";
import { prisma } from "./db";
import { assertSectionOwner, assertTradeOwner, assertContentEditable } from "./trade-access";
// The pool is the picker's eligibility, and "already promised" is read once, in the module that
// owns it — the same rule #657's pool follows, and for the same reason: a resolver that offered a
// copy the picker refuses would hand the collector a line the write then throws back at them.
import {
  addTradeGiveLines,
  committedItemIds,
  resolveTradeLineStamps,
  type GiveLineRefusal,
} from "./trade-lines";
import { filterItemIds, stampLabel } from "./items";
import { IN_HAND_DELIVERY_STATES } from "./delivery-state";
import {
  resolveGiveRequirements,
  type GiveCandidateCopy,
  type GiveRequirement,
  type GiveResolution,
} from "./trade-give-resolution-rules";

// **From a requirement to a copy** (#659) — the database half. The order, the matching and every
// word about a gap are the pure `trade-give-resolution-rules.ts`.
//
// A partner's wish list is `stamp × condition` and nothing else. Every give line, though, names a
// copy — `TradeLine.itemId` is what the reservation gate (#639), the balance (#638), the packing
// list (#643) and the closing exit record (#644) all read. This module is the bridge: it is asked
// for a requirement and answers with copies out of the collection, or says plainly that there are
// none.
//
// **The candidate set is #657's**, minus the collector's own exceptions: what `listOfferableCopies`
// allows (in hand, unsold, not disposed of, not named by another live trade, not already on this
// one), minus this trade's `TradeCopyBlock` rows. Blocked copies are excluded *here* — unlike the
// candidate dialog, which lists them so a decision can be taken back, an automatic pick has no
// business reaching past a decision that was already taken.
//
// **A gap is an outcome, not an error.** *You do not hold this in this condition* is the main output
// of importing a wish list, so it comes back as a resolution with no copies on it and travels all
// the way to the report. Nothing here throws because a requirement could not be served.
//
// **Eligibility is re-checked on write.** The resolver runs over a whole file, and a copy can be
// sold in the minutes between resolving it and confirming it — so the write goes through
// `addTradeGiveLines`, which re-reads every copy and names its refusals one by one, and the report
// then puts the refused copies back on the shortfall they came from.

/** Everything the ranking reads, straight off `Item` — plus whether the copy has anything to show. */
const CANDIDATE_SELECT = {
  id: true,
  itemNo: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  forTrade: true,
  photos: { select: { id: true }, take: 1 },
} as const;

/**
 * The copies that could serve any of these requirements.
 *
 * One query for the whole batch: an imported wish list is one round trip's worth of stamps, and the
 * requirement-by-requirement match — four columns, two of them nullable and only sometimes asked
 * about — happens over the rows that came back. Narrowed by stamp **and** condition rather than by
 * stamp alone, because a collection holds far more of a stamp than a partner ever asks for.
 */
async function giveCandidatePool(
  ownerId: string,
  collectionId: string,
  tradeId: string,
  requirements: readonly GiveRequirement[]
): Promise<GiveCandidateCopy[]> {
  const stampIds = [...new Set(requirements.map((r) => r.stampId))];
  const conditionIds = [...new Set(requirements.map((r) => r.conditionId))];
  if (stampIds.length === 0) return [];

  const [committed, blocks] = await Promise.all([
    committedItemIds(collectionId, tradeId),
    prisma.tradeCopyBlock.findMany({ where: { tradeId }, select: { itemId: true } }),
  ]);
  const eligible = await filterItemIds(ownerId, collectionId, {
    stampIds,
    conditionIds,
    deliveryStates: [...IN_HAND_DELIVERY_STATES],
    excludeGone: true,
    excludeIds: [...committed, ...blocks.map((b) => b.itemId)],
  });
  if (eligible.length === 0) return [];

  const rows = await prisma.item.findMany({
    where: { id: { in: eligible } },
    select: CANDIDATE_SELECT,
  });
  return rows.map((row) => ({
    id: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    forTrade: row.forTrade,
    hasPhoto: row.photos.length > 0,
  }));
}

/**
 * What these requirements would come to on this trade, without writing anything.
 *
 * Read-only and ungated by status on purpose: the question *which copies would serve this list* is
 * answerable about any trade, and the lock that matters — a list the partner already holds — belongs
 * on the write, where {@link addTradeGiveLinesForRequirements} asserts it.
 */
export async function resolveTradeGiveRequirements(
  ownerId: string,
  tradeId: string,
  requirements: readonly GiveRequirement[]
): Promise<GiveResolution[]> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);
  if (requirements.length === 0) return [];
  await assertRequirementMembers(collectionId, requirements);
  const pool = await giveCandidatePool(ownerId, collectionId, tradeId, requirements);
  return resolveGiveRequirements(requirements, pool);
}

/** A stamp or a condition that is not this collection's is a mistake in the request, not a gap in
 *  the collection — and reported as a gap it would read as *you do not own this*, which is exactly
 *  the wrong thing to send a partner. */
async function assertRequirementMembers(
  collectionId: string,
  requirements: readonly GiveRequirement[]
): Promise<void> {
  const stampIds = [...new Set(requirements.map((r) => r.stampId))];
  const conditionIds = [...new Set(requirements.map((r) => r.conditionId))];
  const [stamps, conditions] = await Promise.all([
    prisma.stamp.count({ where: { collectionId, id: { in: stampIds } } }),
    prisma.stampCondition.count({ where: { collectionId, id: { in: conditionIds } } }),
  ]);
  if (stamps !== stampIds.length) throw new Error("Pick a stamp for this line.");
  if (conditions !== conditionIds.length) throw new Error("A condition is required.");
}

/** One requirement's outcome, named. The label rides along because a gap is the one outcome with no
 *  line to point at — twelve stamps off a checklist come back as twelve rows, and *this one you do
 *  not hold* has to say which one. */
export interface GiveRequirementOutcome extends GiveResolution {
  stampLabel: string;
}

/** What a batch came to: the lines that were made, the copies the write refused by name, and every
 *  requirement's own outcome — gaps included, which is the half a wish list is imported for. */
export interface GiveRequirementReport {
  added: number;
  refused: GiveLineRefusal[];
  outcomes: GiveRequirementOutcome[];
}

/** Name the stamps a batch is about, in the spelling the rest of the app uses. */
async function labelRequirements(
  collectionId: string,
  resolutions: readonly GiveResolution[]
): Promise<GiveRequirementOutcome[]> {
  const stamps = await prisma.stamp.findMany({
    where: { collectionId, id: { in: [...new Set(resolutions.map((r) => r.requirement.stampId))] } },
    select: { id: true, name: true, catalogNumbers: { select: { number: true } } },
  });
  const byId = new Map(stamps.map((stamp) => [stamp.id, stampLabel(stamp)]));
  return resolutions.map((resolution) => ({
    ...resolution,
    stampLabel: byId.get(resolution.requirement.stampId) ?? "(unnamed)",
  }));
}

/**
 * Resolve a batch of requirements and promise the copies (#659).
 *
 * The write is `addTradeGiveLines`'s, unchanged: one bulk add that re-checks each copy against the
 * collection as it stands now and collects its refusals rather than throwing on the first one. A
 * copy refused there is taken back off the resolution that chose it, so the report says *served 2 of
 * 3* rather than claiming a line that does not exist.
 */
export async function addTradeGiveLinesForRequirements(
  ownerId: string,
  sectionId: string,
  requirements: readonly GiveRequirement[]
): Promise<GiveRequirementReport> {
  const { tradeId, status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);

  const resolutions = await resolveTradeGiveRequirements(ownerId, tradeId, requirements);
  const itemIds = resolutions.flatMap((r) => r.itemIds);
  if (itemIds.length === 0) {
    return { added: 0, refused: [], outcomes: await labelRequirements(collectionId, resolutions) };
  }

  const { added, refused } = await addTradeGiveLines(ownerId, sectionId, itemIds);
  const lost = new Set(refused.map((r) => r.itemId));
  const settled = resolutions.map((resolution) => {
    const kept = resolution.itemIds.filter((id) => !lost.has(id));
    if (kept.length === resolution.itemIds.length) return resolution;
    return {
      ...resolution,
      itemIds: kept,
      served: kept.length,
      missing: resolution.requested - kept.length,
    };
  });
  return { added, refused, outcomes: await labelRequirements(collectionId, settled) };
}

/** The screen's entry point: one stated requirement — a stamp or a whole set — resolved and
 *  promised in one act. */
export async function addTradeGiveLinesFromRequirement(
  ownerId: string,
  sectionId: string,
  input: GiveRequirementInput
): Promise<GiveRequirementReport> {
  const { tradeId } = await assertSectionOwner(ownerId, sectionId);
  const requirements = await expandGiveRequirement(ownerId, tradeId, input);
  return addTradeGiveLinesForRequirements(ownerId, sectionId, requirements);
}

/** One requirement as the screen states it — a stamp **or a whole checklist**, the receive side's
 *  own shortcut (#637). A set expands into one requirement per stamp on it, all in the same
 *  condition: *send me this set, used* is one sentence, and twelve trips through a picker is the
 *  reason it would go half-written. */
export interface GiveRequirementInput extends Omit<GiveRequirement, "stampId"> {
  stampId?: string;
  checklistId?: string | null;
}

/** Expand it. The checklist is read by `trade-lines.ts`'s own reader, so a set means the same thing
 *  on both sides of the trade and is never stored as a line. */
export async function expandGiveRequirement(
  ownerId: string,
  tradeId: string,
  input: GiveRequirementInput
): Promise<GiveRequirement[]> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);
  const stampIds = await resolveTradeLineStamps(collectionId, input);
  return stampIds.map((stampId) => ({
    stampId,
    conditionId: input.conditionId,
    certificateStatusId: input.certificateStatusId,
    formatId: input.formatId,
    quantity: input.quantity,
  }));
}
