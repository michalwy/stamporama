import "server-only";
import { prisma } from "./db";
import { isTradeStatus, TRADE_STATUS_LABEL, type TradeStatus } from "./trade-rules";

// **Who may touch a trade, and when** (#646; #638). Three guards, in a module *below* every half of
// the trade domain.
//
// They were `trades.ts`'s, and `trade-lines.ts` already called them there rather than restating the
// two open statuses — one lock, asked once. The balancing engine (`trade-valuation.ts`) needs them
// too, and `trades.ts` in turn needs the engine's gate before it will let a trade leave `preparing`.
// A module below both is what keeps that from being an import cycle, exactly as `item-valuation.ts`
// sits below `items.ts` and `market-values.ts` for the same reason.
//
// `trades.ts` re-exports all three, so nothing that already called them there had to change.

/** Resolve the owning collection of a trade, asserting ownership. */
export async function assertTradeOwner(
  ownerId: string,
  tradeId: string
): Promise<{ collectionId: string; status: TradeStatus }> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { collectionId: true, status: true, collection: { select: { ownerId: true } } },
  });
  if (!trade || trade.collection.ownerId !== ownerId) {
    throw new Error("Trade not found or access denied.");
  }
  return {
    collectionId: trade.collectionId,
    status: isTradeStatus(trade.status) ? trade.status : "preparing",
  };
}

/** Resolve the owning trade of a section, asserting ownership. Sections hang off a trade, and lines
 *  off a section, so this is the guard the line half asks. */
export async function assertSectionOwner(
  ownerId: string,
  sectionId: string
): Promise<{ tradeId: string; status: TradeStatus }> {
  const section = await prisma.tradeSection.findUnique({
    where: { id: sectionId },
    select: {
      tradeId: true,
      trade: { select: { status: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!section || section.trade.collection.ownerId !== ownerId) {
    throw new Error("Trade section not found or access denied.");
  }
  return {
    tradeId: section.tradeId,
    status: isTradeStatus(section.trade.status) ? section.trade.status : "preparing",
  };
}

/** Refuse to touch the contents of a trade that has been agreed: the partner holds a copy of the
 *  list (#637). Recording that reality diverged is a different act (#642). */
export function assertContentEditable(status: TradeStatus): void {
  if (status === "preparing" || status === "shared") return;
  throw new Error(
    `A ${TRADE_STATUS_LABEL[status].toLowerCase()} trade's list cannot be changed.`
  );
}
