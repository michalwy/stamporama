import "server-only";
import { prisma } from "./db";
import { assertTradeOwner, assertLineOwner } from "./trade-access";
// The pool **is** the picker's eligibility, narrowed to one valuation key. Reading "already
// promised" a second time here is the one way the two could come to disagree — and a pool that
// offered a copy the picker refuses would be a pool the collector cannot act on.
import { committedItemIds } from "./trade-lines";
import { filterItemIds, listItemsPaginated, type ItemListItem } from "./items";
import { IN_HAND_DELIVERY_STATES } from "./delivery-state";
import {
  describeBlockedPromise,
  describeClosedPool,
  tradeCandidateKey,
  type TradeCandidateCount,
  type TradeCandidateSubject,
} from "./trade-candidate-rules";
import { isTradeContentEditable, TRADE_STATUS_LABEL, type TradeStatus } from "./trade-rules";

// **Which of my copies could go instead of this one** (#657; ADR-0039 §13) — the database half. The
// key, the wording and every refusal are the pure `trade-candidate-rules.ts`.
//
// **The pool is derived, never stored.** For a give line it is the copies `listOfferableCopies`
// (#639) would allow — in hand, unsold, not disposed of, not promised to another live trade, not
// already on this one — matched on the line's full valuation key. There is no candidate table and
// there never will be: a stored pool is a pool that is wrong the first time a copy is sold and
// nobody re-runs anything, which is the same argument that keeps a commitment a give line rather
// than a flag on `Item` (`trade-reservation-rules.ts`).
//
// **The line still names a copy.** `TradeLine.itemId` stays the effective reference every other
// reader knows about — the reservation gate (#639), the balance figures (#638), the packing list
// (#643) and the closing exit record (#644) — and a nullable copy attached at packing time would
// make every one of them grow an exclusion for a state that exists between two clicks. What this
// module adds is the *set* the copy could be swapped for.
//
// **The one row that is stored is the collector's exception** — `TradeCopyBlock`, one per
// `(trade, copy)`, absence meaning available. Scoped to the trade rather than to the line, because
// "this one is not going to this person" is what a collector means, and two lines of one trade
// sharing a key would otherwise need the same decision taken twice.
//
// **Timing.** The pool is live while the trade is `preparing` or `shared` and closed from `agreed`
// on: at `agreed` the choice is settled along with everything else the lock covers, and holding a
// copy back there would change what the partner is looking at after they agreed to it. So the read
// returns nothing outside that window rather than returning a set nothing may be done with.
//
// It sits **above** `trade-lines.ts` and imports it; nothing in the line half imports this back.

/** How a copy is named in every refusal here — `trade-reservations.ts`'s wording, so the two ends of
 *  one trade do not call the same copy two different things. */
function copyLabel(itemNo: number): string {
  return `Copy #${itemNo}`;
}

const CANDIDATE_KEY_SELECT = {
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
} as const;

/**
 * The eligible copies for a set of keys, bucketed by key and ordered by copy number.
 *
 * Two queries, not one per key: the whole give side of a trade is a handful of stamps, so the
 * eligibility runs once over all of them and the key match — which no `where` can express, since
 * four nullable columns have to agree at once — happens over the ids that came back.
 *
 * Blocked copies are **in** here. Absence is availability, so the block is applied by the callers
 * that know what they are counting; a pool that had already dropped them would leave the collector
 * no way back to a decision they took.
 */
async function candidatePoolByKey(
  ownerId: string,
  collectionId: string,
  tradeId: string,
  subjects: readonly TradeCandidateSubject[]
): Promise<Map<string, string[]>> {
  const pool = new Map<string, string[]>();
  const stampIds = [...new Set(subjects.map((s) => s.stampId))];
  if (stampIds.length === 0) return pool;

  const committed = await committedItemIds(collectionId, tradeId);
  const eligible = await filterItemIds(ownerId, collectionId, {
    stampIds,
    deliveryStates: [...IN_HAND_DELIVERY_STATES],
    excludeGone: true,
    excludeIds: committed,
  });
  if (eligible.length === 0) return pool;

  const rows = await prisma.item.findMany({
    where: { id: { in: eligible } },
    // By copy number, which is how a collector reads a shelf of duplicates — and how the picker
    // that put the line there ordered them.
    orderBy: { itemNo: "asc" },
    select: { id: true, ...CANDIDATE_KEY_SELECT },
  });
  for (const row of rows) {
    const key = tradeCandidateKey(row);
    const existing = pool.get(key);
    if (existing) existing.push(row.id);
    else pool.set(key, [row.id]);
  }
  return pool;
}

// ── The trade's rows ────────────────────────────────────────────────────────────────────────────

/** How many alternatives each give line has, by line id. Lines with none are **absent** rather than
 *  present with zeroes — the row asks one question and draws nothing on a miss, which is the same
 *  shape the signal index takes (#662). */
export interface TradeCandidateRead {
  lines: Record<string, TradeCandidateCount>;
}

const NO_LINES: TradeCandidateRead = { lines: {} };

/**
 * The whole trade's counts, in one read — what the give rows draw their chip from.
 *
 * Counted here rather than on the line page for the reason the signals are: it is one question about
 * one trade, and asking it per page would be one query per column per scroll, each answering about
 * fifty rows out of the same set.
 */
export async function readTradeCandidates(
  ownerId: string,
  tradeId: string
): Promise<TradeCandidateRead> {
  const { collectionId, status } = await assertTradeOwner(ownerId, tradeId);
  // Closed from `agreed` on. Nothing may be blocked or unblocked there, so a count would be a number
  // with no act behind it.
  if (!isTradeContentEditable(status)) return NO_LINES;

  const lines = await prisma.tradeLine.findMany({
    where: { tradeId, side: "give", itemId: { not: null } },
    select: { id: true, item: { select: CANDIDATE_KEY_SELECT } },
  });
  const subjects = lines.flatMap((line) => (line.item ? [line.item] : []));
  if (subjects.length === 0) return NO_LINES;

  const [pool, blocks] = await Promise.all([
    candidatePoolByKey(ownerId, collectionId, tradeId, subjects),
    prisma.tradeCopyBlock.findMany({ where: { tradeId }, select: { itemId: true } }),
  ]);
  const blocked = new Set(blocks.map((b) => b.itemId));

  const out: Record<string, TradeCandidateCount> = {};
  for (const line of lines) {
    if (!line.item) continue;
    const ids = pool.get(tradeCandidateKey(line.item)) ?? [];
    if (ids.length === 0) continue;
    const held = ids.filter((id) => blocked.has(id)).length;
    out[line.id] = { available: ids.length - held, blocked: held };
  }
  return { lines: out };
}

// ── One line's list ─────────────────────────────────────────────────────────────────────────────

/** One candidate, drawn as the give side draws every copy. `blocked` is the collector's decision
 *  about it on **this** trade, and nothing about the copy itself. */
export interface TradeCandidateCopy {
  copy: ItemListItem;
  blocked: boolean;
}

export interface TradeLineCandidateRead {
  lineId: string;
  /** The trade the line is on — what the route scopes the request by, so a line id from another
   *  trade is a miss rather than a read of somebody else's negotiation through the wrong address. */
  tradeId: string;
  /** The copy the line names today — what the alternatives are alternatives *to*. Drawn at the head
   *  of the list so the comparison has something to be against, and never blockable: it is the
   *  promise. Null only where the line's copy has since been disposed of and the row cannot be
   *  built, which the give row itself already says (#662). */
  promised: ItemListItem | null;
  candidates: TradeCandidateCopy[];
  /** Whether the pool may still be changed. False from `agreed` on, with {@link closedReason}
   *  saying why — the dialog then reads rather than edits. */
  editable: boolean;
  closedReason: string | null;
}

/**
 * One give line's alternatives, enriched — the dialog's read.
 *
 * Blocked copies are **listed**, marked. Everything eligible is offered by default and a block is an
 * exception to that; leaving the exceptions out would leave the collector no way to take one back.
 */
export async function readTradeLineCandidates(
  ownerId: string,
  lineId: string
): Promise<TradeLineCandidateRead> {
  const { tradeId, collectionId, status, side } = await assertLineOwner(ownerId, lineId);
  if (side !== "give") {
    // The partner's material is in nobody's inventory, so there is no set of copies to choose from.
    throw new Error("Only a copy you are giving has alternatives.");
  }
  const line = await prisma.tradeLine.findUnique({
    where: { id: lineId },
    select: { itemId: true, item: { select: CANDIDATE_KEY_SELECT } },
  });
  if (!line?.itemId || !line.item) throw new Error("Trade line not found or access denied.");

  const editable = isTradeContentEditable(status);
  const closedReason = editable ? null : describeClosedPool(TRADE_STATUS_LABEL[status]);

  const [pool, blocks] = await Promise.all([
    candidatePoolByKey(ownerId, collectionId, tradeId, [line.item]),
    prisma.tradeCopyBlock.findMany({ where: { tradeId }, select: { itemId: true } }),
  ]);
  const blocked = new Set(blocks.map((b) => b.itemId));
  // From `agreed` on the pool is settled, so the list is the promise alone: showing alternatives
  // nothing may be done about would be offering a choice that has already been made.
  const candidateIds = editable ? (pool.get(tradeCandidateKey(line.item)) ?? []) : [];

  const ids = [line.itemId, ...candidateIds];
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    ids,
    // The promised copy may have left since (#639's departure warning); the row still has to draw,
    // and the candidates are unaffected — a disposed copy is never eligible in the first place.
    includeDisposed: true,
    pageSize: ids.length,
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  return {
    lineId,
    tradeId,
    promised: byId.get(line.itemId) ?? null,
    // Rebuilt in the pool's own order — by copy number — rather than the list read's `createdAt`.
    candidates: candidateIds.flatMap((id) => {
      const copy = byId.get(id);
      return copy ? [{ copy, blocked: blocked.has(id) }] : [];
    }),
    editable,
    closedReason,
  };
}

// ── The collector's exception ───────────────────────────────────────────────────────────────────

/**
 * Take one copy out of this trade's candidate pools, or put it back (#657).
 *
 * **Idempotent in both directions**, `setItemPlatformExclusion`'s shape: blocking is a create that
 * skips a duplicate, allowing is a delete, so the presence of the row is the whole state and running
 * either twice changes nothing. That is what lets the dialog's toggle be a plain write rather than a
 * read-modify-write over a list two people could be looking at.
 *
 * Scoped to the **trade**: the same copy held back for one line is held back for every line of the
 * trade that shares its key, which is what a collector means by it.
 *
 * The copy the trade already **names** is refused by name. In practice the dialog cannot offer it —
 * `committedItemIds` keeps every copy already on the trade out of the pool — so this is the guard
 * behind that, for an id arriving any other way.
 */
export async function setTradeCopyBlock(
  ownerId: string,
  tradeId: string,
  itemId: string,
  blocked: boolean
): Promise<void> {
  const { collectionId, status } = await assertTradeOwner(ownerId, tradeId);
  assertPoolOpen(status);

  const item = await prisma.item.findFirst({
    where: { id: itemId, collectionId },
    select: { id: true, itemNo: true },
  });
  if (!item) throw new Error("That copy is not in this collection.");

  const promised = await prisma.tradeLine.findFirst({
    where: { tradeId, itemId },
    select: { id: true },
  });
  if (promised) throw new Error(describeBlockedPromise(copyLabel(item.itemNo)));

  if (blocked) {
    await prisma.tradeCopyBlock.createMany({
      data: [{ tradeId, itemId }],
      skipDuplicates: true,
    });
  } else {
    await prisma.tradeCopyBlock.deleteMany({ where: { tradeId, itemId } });
  }
}

/** The pool's own window — the same two statuses `assertContentEditable` allows, refused in the
 *  collector's own terms: what they were looking at is a list of alternatives, not "the trade's
 *  list", and a refusal that named the wrong thing would send them looking for the wrong lock. */
function assertPoolOpen(status: TradeStatus): void {
  if (isTradeContentEditable(status)) return;
  throw new Error(describeClosedPool(TRADE_STATUS_LABEL[status]));
}
