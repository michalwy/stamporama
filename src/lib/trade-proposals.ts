import "server-only";
import { prisma } from "./db";
import { assertLineOwner } from "./trade-access";
import {
  CANDIDATE_KEY_SELECT,
  offeredCandidateIds,
  readTradeCandidatePool,
  type TradeCandidatePool,
} from "./trade-candidates";
import { tradeCandidateKey } from "./trade-candidate-rules";
import { IN_HAND_DELIVERY_STATES } from "./delivery-state";
import { sortPhotos } from "./photos";
import { isTradeContentEditable } from "./trade-rules";
import type { TradeShareAccess } from "./trade-share";
import {
  canProposeTradeCopy,
  describeTradeProposalClosed,
  tradeProposalOptionLabel,
  tradeProposalUnansweredNote,
  TRADE_PROPOSAL_ALREADY_TAKEN,
  TRADE_PROPOSAL_NOT_OFFERED,
} from "./trade-proposal-rules";

// **The partner's pick of which copy they receive** (#658; ADR-0039 §15) — the database half. The
// window, the wording and every refusal are the pure `trade-proposal-rules.ts`.
//
// It sits **above** `trade-candidates.ts` and reads {@link readTradeCandidatePool} rather than
// deriving the set a second time: what the partner is offered has to be exactly what the collector's
// own *Alternatives* list shows, or the two ends of one link would be looking at different pools.
//
// Three properties hold this module together.
//
// **A proposal moves nothing.** `TradeLine.itemId` is the effective copy and stays the only
// reference the reservation gate (#639), the balance (#638), the packing list (#643) and the exit
// record (#644) read. `proposedItemId` is advisory: accepting writes it into `itemId` and clears it,
// dismissing clears it alone. Nothing in this file writes a figure, a reservation or a packing row.
//
// **The partner's half takes a `TradeShareAccess` and nothing else** — `trade-feedback.ts`'s rule,
// for its reason. The trade id comes from the token's own row, never from the request, so the worst
// a tampered body can name is a line or a copy that is not on this exchange, and both are refused
// before anything is written.
//
// **Eligibility is re-checked at acceptance, on the collector's screen.** A candidate can be sold,
// disposed of or promised elsewhere while the partner is looking at it, and a refusal is only
// actionable where somebody can act on it. So the partner's write checks the pool as it stands and
// the collector's acceptance checks it again — the latter in `trade-candidates.ts`, because granting
// a request **is** swapping the copy the line promises (`setTradeGiveLineItem`) and two ways to make
// that write would be two places for it to differ. What is left here is the other answer: dropping
// the request, which touches nothing.

/** How a copy is named in every refusal here — `trade-candidates.ts`'s wording, so the two ends of
 *  one trade do not call the same copy two different things. */
function copyLabel(itemNo: number): string {
  return `Copy #${itemNo}`;
}

/** A give line as both halves of this module need it: what it promises, what was suggested against
 *  it, and the key its alternatives are matched on. */
const LINE_SELECT = {
  id: true,
  itemId: true,
  proposedItemId: true,
  proposedAt: true,
  item: { select: CANDIDATE_KEY_SELECT },
} as const;

// ── The partner's half ──────────────────────────────────────────────────────────────────────────

/** One copy the partner may choose, reduced to what a picture and a radio need.
 *
 *  **No internal handles**, `readTradeShareView`'s rule: the copy number, where it is filed and what
 *  it cost are not the partner's business and are kept out of the payload rather than merely left
 *  undrawn. What travels is an opaque id — which authorises nothing on its own; the write checks it
 *  against this line's pool — the scans, and where the copy stands in the choice. */
export interface TradeShareChoiceOption {
  itemId: string;
  /** Addressed through the token's own photo route, which serves a candidate's scans and not one
   *  image further. */
  photoIds: string[];
  label: string;
  /** The copy the line names today. Always first, because it is what the others are alternatives
   *  *to*, and it is how the partner withdraws a suggestion — by choosing it again. */
  current: boolean;
  /** The partner's own standing suggestion, drawn **beside** the current choice rather than in place
   *  of it: a page that showed only the pick would suggest the swap had already happened. */
  proposed: boolean;
}

export interface TradeShareChoiceLine {
  lineId: string;
  /** The current copy first, then its alternatives in copy-number order. Empty from `agreed` on,
   *  where the pool is settled and the row itself is the statement of which copy was chosen. */
  options: TradeShareChoiceOption[];
  /** Whether a pick may still be made — `shared` and nothing else. */
  open: boolean;
  /** Said in place of the picker when it is not open, so a reader is told why rather than left
   *  looking for a control that is not there. */
  closedMessage: string | null;
  /** A request the collector never answered, on a list that has since been settled — said once, on
   *  the row, because the alternative is a partner who goes on thinking a swap is coming. Null
   *  wherever there is nothing of the sort to say. */
  unansweredNote: string | null;
}

export type TradeShareChoiceRead = Record<string, TradeShareChoiceLine>;

/**
 * What the partner may choose between, line by line.
 *
 * A line is in here only when there is a **choice**: at least one alternative beside the copy the
 * line names, or a suggestion of the partner's own still standing. A line with a single candidate is
 * drawn exactly as #640 draws it — nothing gains a control that has one option.
 *
 * Two reads over the trade's own rows plus the pool's three, whatever the length of the list: the
 * eligibility runs once over every stamp on the give side and the scans are fetched in one query for
 * every copy that will be drawn.
 */
export async function readTradeShareChoices(
  access: TradeShareAccess
): Promise<TradeShareChoiceRead> {
  const lines = await prisma.tradeLine.findMany({
    where: { tradeId: access.tradeId, side: "give", itemId: { not: null } },
    select: LINE_SELECT,
  });
  if (lines.length === 0) return {};

  const open = canProposeTradeCopy(access.status);
  const closedMessage = open ? null : describeTradeProposalClosed(access.status);
  // From `agreed` on the pool is settled along with everything else the lock covers (#657), so there
  // is nothing to derive and nothing to offer — what is left is to say plainly that a suggestion
  // nobody answered has been closed out with the trade.
  const poolOpen = isTradeContentEditable(access.status);
  const pool: TradeCandidatePool | null = poolOpen
    ? await readTradeCandidatePool(
        access.ownerId,
        access.collectionId,
        access.tradeId,
        lines.flatMap((line) => (line.item ? [line.item] : []))
      )
    : null;

  const chosen: { line: (typeof lines)[number]; candidateIds: string[] }[] = [];
  for (const line of lines) {
    if (!line.itemId || !line.item) continue;
    const candidateIds = pool ? offeredCandidateIds(pool, line.item) : [];
    if (candidateIds.length === 0 && !line.proposedItemId) continue;
    chosen.push({ line, candidateIds });
  }
  if (chosen.length === 0) return {};

  const photos = await photoIdsFor(
    new Set(chosen.flatMap(({ line, candidateIds }) => [line.itemId!, ...candidateIds]))
  );

  const out: TradeShareChoiceRead = {};
  for (const { line, candidateIds } of chosen) {
    const ids = candidateIds.length > 0 ? [line.itemId!, ...candidateIds] : [];
    out[line.id] = {
      lineId: line.id,
      options: ids.map((itemId, index) => ({
        itemId,
        photoIds: photos.get(itemId) ?? [],
        label: tradeProposalOptionLabel(index),
        current: itemId === line.itemId,
        proposed: itemId === line.proposedItemId,
      })),
      open,
      closedMessage,
      // Only worth saying where the choice itself is gone: while the picker is on screen the
      // standing request is marked on its own option, which says it better than a sentence would.
      unansweredNote:
        ids.length === 0 && line.proposedItemId !== null
          ? tradeProposalUnansweredNote(access.status)
          : null,
    };
  }
  return out;
}

/** The scans of a set of copies, in the app's own order — front, back, then the extras. One query
 *  for the whole page, never one per row. */
async function photoIdsFor(itemIds: Set<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.size === 0) return out;
  const rows = await prisma.photo.findMany({
    where: { itemId: { in: [...itemIds] } },
    select: { id: true, itemId: true, role: true, title: true, sortOrder: true },
  });
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.itemId) continue;
    const existing = byItem.get(row.itemId);
    if (existing) existing.push(row);
    else byItem.set(row.itemId, [row]);
  }
  for (const [itemId, group] of byItem) {
    out.set(
      itemId,
      group
        .map((p) => ({
          id: p.id,
          role: (p.role === "front" || p.role === "back" ? p.role : null) as
            | "front"
            | "back"
            | null,
          title: p.title,
          sortOrder: p.sortOrder,
        }))
        .sort(sortPhotos)
        .map((p) => p.id)
    );
  }
  return out;
}

/**
 * Whether a scan may be served through this token **because a copy is offered against a line**.
 *
 * #640 serves the pictures of the copies *on* the lines; this widens that scope to the copies
 * *offered against* them, and not one image further. It is asked only after the line-scoped check
 * has missed, so an ordinary thumbnail still costs the one query it always did.
 *
 * The eligibility is asked of the **copy** in one `where` — in this collection, in hand, unsold, not
 * disposed of, not held back on this trade — and the one clause no `where` can express, the four
 * nullable key columns agreeing at once, is compared here against the keys of this trade's own give
 * lines. That is the same set {@link readTradeShareChoices} offers, reached cheaply enough to sit on
 * a photo route.
 */
export async function canServeTradeShareCandidatePhoto(
  access: TradeShareAccess,
  photoId: string
): Promise<boolean> {
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      item: {
        collectionId: access.collectionId,
        disposedAt: null,
        deliveryState: { in: [...IN_HAND_DELIVERY_STATES] },
        saleLineItems: { none: {} },
        tradeCopyBlocks: { none: { tradeId: access.tradeId } },
      },
    },
    select: { item: { select: CANDIDATE_KEY_SELECT } },
  });
  if (!photo?.item) return false;

  const lines = await prisma.tradeLine.findMany({
    where: { tradeId: access.tradeId, side: "give", itemId: { not: null } },
    select: { item: { select: CANDIDATE_KEY_SELECT } },
  });
  const key = tradeCandidateKey(photo.item);
  return lines.some((line) => line.item && tradeCandidateKey(line.item) === key);
}

/**
 * Record which copy the partner would rather have, or take the request back.
 *
 * `null` — and choosing the copy the line already names, which is the same thing said with a
 * picture — withdraws the suggestion. There is no separate clear: a partner who has changed their
 * mind picks the current copy again, and that is one control rather than two.
 *
 * **One proposal per copy per trade**, refused by name here and by a partial unique index behind
 * that: two lines sharing a key ("two of these") must not both be answered with the same piece.
 */
export async function saveTradeCopyProposal(
  access: TradeShareAccess,
  lineId: string,
  itemId: string | null
): Promise<{ proposedItemId: string | null }> {
  if (!canProposeTradeCopy(access.status)) {
    throw new Error(describeTradeProposalClosed(access.status));
  }

  // The one place a reader-supplied id reaches a query, and it is bounded by the token's own trade
  // before it reaches a write.
  const line = await prisma.tradeLine.findFirst({
    where: { id: lineId, tradeId: access.tradeId, side: "give" },
    select: LINE_SELECT,
  });
  if (!line?.itemId || !line.item) throw new Error("That line is not on this exchange.");

  if (itemId === null || itemId === line.itemId) {
    await clearProposal(line.id);
    return { proposedItemId: null };
  }

  const pool = await readTradeCandidatePool(
    access.ownerId,
    access.collectionId,
    access.tradeId,
    [line.item]
  );
  if (!offeredCandidateIds(pool, line.item).includes(itemId)) {
    throw new Error(TRADE_PROPOSAL_NOT_OFFERED);
  }

  const taken = await prisma.tradeLine.findFirst({
    where: { tradeId: access.tradeId, proposedItemId: itemId, id: { not: line.id } },
    select: { id: true },
  });
  if (taken) throw new Error(TRADE_PROPOSAL_ALREADY_TAKEN);

  await prisma.tradeLine.update({
    where: { id: line.id },
    data: { proposedItemId: itemId, proposedAt: new Date() },
  });
  return { proposedItemId: itemId };
}

/** Both halves of one fact, cleared as a unit — a CHECK in the migration says so too. */
async function clearProposal(lineId: string): Promise<void> {
  await prisma.tradeLine.update({
    where: { id: lineId },
    data: { proposedItemId: null, proposedAt: null },
  });
}

// ── The collector's half ────────────────────────────────────────────────────────────────────────

/** One standing suggestion, as the row that draws it needs it. The copy is named by its **number**,
 *  which is how a collector reads a shelf of duplicates and how every other refusal on a trade names
 *  one. */
export interface TradeProposalItem {
  lineId: string;
  itemId: string;
  copyLabel: string;
  proposedAt: string;
}

export interface TradeProposalRead {
  /** By line id, with a line nobody has suggested anything about simply **absent** — the signal
   *  index's shape (#662), so a row asks one question and draws nothing on a miss. */
  lines: Record<string, TradeProposalItem>;
  /** How many are standing. Nothing derives a badge from this on its own; it is what the strip
   *  above the columns counts into its total. */
  open: number;
}

/**
 * What the partner has asked for, over the whole trade.
 *
 * Takes a trade id and no owner, like the reservation and the realisation reads beside it: the route
 * has already asserted the trade, and a second assertion per read would be a query per read for an
 * answer nobody could have changed in between.
 */
export async function readTradeProposals(tradeId: string): Promise<TradeProposalRead> {
  const rows = await prisma.tradeLine.findMany({
    where: { tradeId, proposedItemId: { not: null } },
    select: {
      id: true,
      proposedItemId: true,
      proposedAt: true,
      proposedItem: { select: { itemNo: true } },
    },
  });
  const lines: Record<string, TradeProposalItem> = {};
  for (const row of rows) {
    if (!row.proposedItemId || !row.proposedItem || !row.proposedAt) continue;
    lines[row.id] = {
      lineId: row.id,
      itemId: row.proposedItemId,
      copyLabel: copyLabel(row.proposedItem.itemNo),
      proposedAt: row.proposedAt.toISOString(),
    };
  }
  return { lines, open: Object.keys(lines).length };
}

/**
 * Drop the request, leaving the promise exactly where it was.
 *
 * The other answer — *send that one instead* — is `setTradeGiveLineItem`, because it **is** the swap
 * and having two ways to write the effective copy would be two places for that write to differ. This
 * one clears advisory data, so unlike the swap it is allowed wherever the trade is: a locked list
 * still takes a decision about what the partner asked for, and saying "no" to a request changes
 * nothing that was agreed.
 */
export async function dismissTradeCopyProposal(ownerId: string, lineId: string): Promise<void> {
  const { side } = await assertLineOwner(ownerId, lineId);
  if (side !== "give") throw new Error("Only a copy you are giving has alternatives.");
  const line = await prisma.tradeLine.findUnique({
    where: { id: lineId },
    select: { proposedItemId: true },
  });
  if (!line?.proposedItemId) throw new Error("There is no request on this line any more.");
  await clearProposal(lineId);
}
