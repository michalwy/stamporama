import "server-only";
import { prisma } from "./db";
import { assertTradeOwner } from "./trade-access";
import { readTradeFeedback } from "./trade-feedback";
import { readTradeLineFulfillments } from "./trade-realisation";
import { readTradeReservation } from "./trade-reservations";
import { readTradeGateBlockers } from "./trade-valuation";
import {
  indexTradeLineActions,
  type TradeActionLine,
  type TradeActionRead,
  type TradeActionSources,
} from "./trade-line-signals";
import { isTradeContentEditable, isTradeSide, isTradeStatus, type TradeStatus } from "./trade-rules";

// **What is waiting for the collector on this trade** (#663) — the database half. The rule itself is
// the pure `trade-line-signals.ts`, beside the marks the same facts are drawn as on the rows: the
// filter that narrows a side and the count on the toggle that offers it must be one reading of
// "needs action", and a second one living in a `where` clause would drift from it.
//
// **Nothing here is new.** Every condition is read off a record that already answers it — the
// partner's remarks (`trade-feedback.ts`), the marketplace collision and the departure
// (`trade-reservations.ts`), the verdict (`trade-realisation.ts`) and the valuation gate
// (`trade-valuation.ts`) — which is the same move `trade-line-signals.ts` made for the rows. There is
// no "needs attention" column and there never will be: a flag somebody has to keep up to date is a
// flag that is wrong the first time nobody does.
//
// It sits **above** those four and below nothing: `trade-lines.ts` calls it for the filter and the
// trade's detail read calls it for the count, and neither of them is imported here.
//
// Not to be confused with `action-items.ts`, the sidebar bell: that one gathers what is waiting
// across the whole collection and reports no trade at all. This is one trade's own columns, and the
// only thing it feeds is the toggle above them.
//
// **The reads are handed in where the caller already has them.** The trade's screen fetches the
// feedback, the reservation and the realisation for the rows anyway, so the detail read passes them
// straight through and this makes two more queries rather than seven. The filter path, which runs
// only when the toggle is on, has nothing to hand in and reads all of it.

/** What a caller already has in its hands. Anything absent is read here. */
export interface TradeActionInputs {
  feedback?: TradeActionSources["feedback"];
  reservation?: TradeActionSources["reservation"];
  realisation?: TradeActionSources["realisation"];
}

/** Every line of the trade, light — which column it is in, and the copy a give line promises. The
 *  reservation read knows a give line by that copy and by nothing else, so this is what turns two
 *  lists of copies into two lists of rows. */
async function readActionLines(tradeId: string): Promise<TradeActionLine[]> {
  const rows = await prisma.tradeLine.findMany({
    where: { tradeId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, sectionId: true, side: true, itemId: true },
  });
  return rows.map((row) => ({
    lineId: row.id,
    sectionId: row.sectionId,
    side: isTradeSide(row.side) ? row.side : "give",
    itemId: row.itemId,
  }));
}

/**
 * Which lines of this trade are waiting, and how many per column.
 *
 * The valuation gate is asked **only where its answer could matter** — while the list is still
 * unlocked, since that is the only window a figure may be typed in (`setTradeLineValue`) and the
 * rule suppresses the reason outside it. It is the one expensive read of the four (it values every
 * line of both sides against two catalogs), so not making it on an agreed or closed trade is worth
 * the extra sentence.
 */
export async function readTradeActions(
  ownerId: string,
  tradeId: string,
  have: TradeActionInputs = {}
): Promise<TradeActionRead> {
  await assertTradeOwner(ownerId, tradeId);
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { status: true },
  });
  if (!trade) return { lines: {}, counts: {}, total: 0 };
  const status: TradeStatus = isTradeStatus(trade.status) ? trade.status : "preparing";

  const [lines, feedback, reservation, realisation, blockers] = await Promise.all([
    readActionLines(tradeId),
    have.feedback ?? readTradeFeedback(ownerId, tradeId),
    have.reservation ?? readTradeReservation(tradeId),
    have.realisation ??
      readTradeLineFulfillments(tradeId).then((byLine) => ({ lines: [...byLine.values()] })),
    isTradeContentEditable(status) ? readTradeGateBlockers(tradeId) : Promise.resolve([]),
  ]);

  return indexTradeLineActions(lines, {
    feedback,
    reservation,
    realisation,
    // Every line the gate names, in either of its two gaps — deduplicated, since a line balanced by
    // value with no figure at all falls in both.
    unvaluedLineIds: [...new Set(blockers.flatMap((b) => b.lines.map((l) => l.lineId)))],
    status,
  });
}

/** The line ids alone, which is all a filter is. Kept beside the read rather than in `trade-lines.ts`
 *  so that "which lines are waiting" is asked in one place however it is used. */
export async function readTradeActionLineIds(
  ownerId: string,
  tradeId: string
): Promise<Set<string>> {
  const read = await readTradeActions(ownerId, tradeId);
  return new Set(Object.keys(read.lines));
}
