import "server-only";
import { prisma } from "./db";
import {
  describeCommittedCopies,
  describeDepartedCopies,
  describeListedCopies,
  type CommittedCopy,
  type DepartedCopy,
  type ListedCopy,
} from "./trade-reservation-rules";

// Reservation of committed copies against marketplace collisions (#639) — the database half. The
// vocabulary, and every sentence a refusal is made in, is the pure `trade-reservation-rules.ts`.
//
// **Nothing here writes.** There is no reservation table and no flag on `Item`: a commitment is a
// give line on an agreed trade, and a live listing is an active offer, so both questions are asked
// of the records that already answer them. That is the same reasoning that makes `SaleLineItem` the
// record of a sale rather than a boolean on the copy — one place for the truth, so there is never a
// second place for it to be wrong in.
//
// It sits **below** `offers.ts` and `trades.ts` and imports neither, which is what lets both call it:
// the offer refuses to go live because a trade holds the copy, and the trade refuses to be agreed
// because an offer holds it, and a module that reached back into either would make that a cycle.
// The same move `trade-access.ts` made for the trade domain's two halves (ADR-0039, #638).

/** The trade statuses that actually commit a copy. Only `agreed` — see the header of
 *  `trade-reservation-rules.ts` for why the negotiation statuses deliberately do not. */
const COMMITTED_TRADE_STATUSES = ["agreed"] as const;

/** The trade statuses that still hold a promise worth warning about when the copy behind it leaves.
 *  Wider than the set above on purpose: a copy sold out from under a trade being *composed* is worth
 *  the same sentence, and this end of it never blocks anything. */
const PROMISING_TRADE_STATUSES = ["preparing", "shared", "agreed"] as const;

/** How a copy is named in every refusal here — the wording `addTradeGiveLines` already refuses in,
 *  so the two ends of one collision do not call the same copy two different things. */
function copyLabel(itemNo: number): string {
  return `Copy #${itemNo}`;
}

// ── The two collisions ──────────────────────────────────────────────────────────────────────────

/**
 * Which of `itemIds` are promised in an **agreed** trade, with the trade holding each.
 *
 * Asked of the copies rather than of the trade, because that is the shape both callers have: an
 * offer knows its copies, and a picker knows the ones just ticked.
 */
export async function findCommittedCopies(
  collectionId: string,
  itemIds: readonly string[]
): Promise<CommittedCopy[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.tradeLine.findMany({
    where: {
      side: "give",
      itemId: { in: [...itemIds] },
      trade: { collectionId, status: { in: [...COMMITTED_TRADE_STATUSES] } },
    },
    select: {
      itemId: true,
      item: { select: { itemNo: true } },
      trade: { select: { id: true, tradeNo: true, partner: { select: { name: true } } } },
    },
    orderBy: { trade: { tradeNo: "asc" } },
  });
  return rows.flatMap((row) =>
    row.itemId && row.item
      ? [
          {
            itemId: row.itemId,
            label: copyLabel(row.item.itemNo),
            trade: {
              tradeId: row.trade.id,
              tradeNo: row.trade.tradeNo,
              partnerName: row.trade.partner.name,
            },
          },
        ]
      : []
  );
}

/**
 * Which of `itemIds` are live on a marketplace, with the offer holding each.
 *
 * A copy can be up on two platforms at once — that is an ordinary thing to do — so this reports the
 * first listing found for each copy rather than every one of them: what the refusal needs is the
 * name of something to go and pause, not an inventory of everywhere the copy is.
 */
export async function findListedCopies(
  collectionId: string,
  itemIds: readonly string[]
): Promise<ListedCopy[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.offerSetItem.findMany({
    where: {
      itemId: { in: [...itemIds] },
      offerSet: { offer: { collectionId, state: "active" } },
    },
    select: {
      itemId: true,
      item: { select: { itemNo: true } },
      offerSet: {
        select: {
          offer: {
            select: {
              id: true,
              offerNo: true,
              name: true,
              platform: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { offerSet: { offer: { offerNo: "asc" } } },
  });

  const seen = new Set<string>();
  const out: ListedCopy[] = [];
  for (const row of rows) {
    if (seen.has(row.itemId)) continue;
    seen.add(row.itemId);
    const offer = row.offerSet.offer;
    out.push({
      itemId: row.itemId,
      label: copyLabel(row.item.itemNo),
      offer: {
        offerId: offer.id,
        offerNo: offer.offerNo,
        // An offer with no name of its own is drawn from its copies everywhere else; here the number
        // is already in front of it, so the fallback says what kind of thing it is and stops.
        label: offer.name ?? "Untitled listing",
        platformName: offer.platform.name,
      },
    });
  }
  return out;
}

// ── The offer's end ─────────────────────────────────────────────────────────────────────────────

/**
 * The copies on this offer that are promised in an agreed trade.
 *
 * What the going-live gate refuses on, and what the offer's own screen states so the refusal is met
 * before the button rather than by it — a flag shown on a list is shown on the thing's own screen
 * too, from the same source.
 */
export async function readOfferCommitments(
  collectionId: string,
  offerId: string
): Promise<CommittedCopy[]> {
  const rows = await prisma.offerSetItem.findMany({
    where: { offerSet: { offerId } },
    select: { itemId: true },
  });
  return findCommittedCopies(collectionId, rows.map((r) => r.itemId));
}

/** The offer-side refusal, or null when there is nothing to refuse. One function so the transition
 *  and the composition paths cannot come to word the same collision differently. */
export async function offerCommitmentRefusal(
  collectionId: string,
  itemIds: readonly string[]
): Promise<string | null> {
  const committed = await findCommittedCopies(collectionId, itemIds);
  return committed.length > 0 ? describeCommittedCopies(committed) : null;
}

// ── The trade's end ─────────────────────────────────────────────────────────────────────────────

/** Every copy this trade promises — its give lines, in line order. */
async function tradeGiveItemIds(tradeId: string): Promise<string[]> {
  const rows = await prisma.tradeLine.findMany({
    where: { tradeId, side: "give", itemId: { not: null } },
    select: { itemId: true },
    orderBy: { position: "asc" },
  });
  return rows.map((r) => r.itemId!).filter(Boolean);
}

/**
 * What stands between this trade and being agreed, and what has gone wrong with it since.
 *
 * Two lists, and they are **not** the same kind of thing:
 *
 *  - `listed` **blocks** the move to `agreed`. Promising a partner a stamp that is up for sale is
 *    promising something a stranger can buy in the next minute.
 *  - `departed` **warns and never blocks**. The copy has already gone — refusing to record the
 *    agreement would not bring it back, and what resolves it is a withdrawal (#642). Told on the
 *    trade because that is where the promise lives.
 */
export interface TradeReservationRead {
  listed: ListedCopy[];
  departed: DepartedCopy[];
  /** The sentences the two lists read as, ready to draw. Built here rather than on the client so the
   *  screen and the refusal state one collision in one wording. */
  messages: { listed: string | null; departed: string[] };
}

export async function readTradeReservation(tradeId: string): Promise<TradeReservationRead> {
  const [trade, itemIds] = await Promise.all([
    prisma.trade.findUnique({ where: { id: tradeId }, select: { collectionId: true, status: true } }),
    tradeGiveItemIds(tradeId),
  ]);
  if (!trade || itemIds.length === 0) {
    return { listed: [], departed: [], messages: { listed: null, departed: [] } };
  }
  // A cancelled or closed trade promises nothing any more: the exchange is off, or it happened and
  // the copies left by design. Reporting a collision on one would be reporting a problem with a
  // decision already taken.
  if (!(PROMISING_TRADE_STATUSES as readonly string[]).includes(trade.status)) {
    return { listed: [], departed: [], messages: { listed: null, departed: [] } };
  }

  const [listed, departed] = await Promise.all([
    findListedCopies(trade.collectionId, itemIds),
    findDepartedCopies(itemIds),
  ]);
  return {
    listed,
    departed,
    messages: {
      listed: listed.length > 0 ? describeListedCopies(listed) : null,
      departed: describeDepartedCopies(departed),
    },
  };
}

/** The trade-side refusal, or null. The mirror of {@link offerCommitmentRefusal}. */
export async function tradeListingRefusal(tradeId: string): Promise<string | null> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { collectionId: true },
  });
  if (!trade) return null;
  const listed = await findListedCopies(trade.collectionId, await tradeGiveItemIds(tradeId));
  return listed.length > 0 ? describeListedCopies(listed) : null;
}

/**
 * Which of these promised copies have left the collection — sold on a sale line, or disposed of.
 *
 * A copy that has done both is reported as **sold**: that is the specific thing that happened to it,
 * and a disposal recorded alongside a sale is usually the same event written down twice.
 */
async function findDepartedCopies(itemIds: readonly string[]): Promise<DepartedCopy[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.item.findMany({
    where: {
      id: { in: [...itemIds] },
      OR: [{ disposedAt: { not: null } }, { saleLineItems: { some: {} } }],
    },
    select: {
      id: true,
      itemNo: true,
      disposedAt: true,
      saleLineItems: { select: { itemId: true }, take: 1 },
    },
    orderBy: { itemNo: "asc" },
  });
  return rows.map((row) => ({
    itemId: row.id,
    label: copyLabel(row.itemNo),
    reason: row.saleLineItems.length > 0 ? "sold" : "disposed",
  }));
}
