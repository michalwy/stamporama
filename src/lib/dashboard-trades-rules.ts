/**
 * The dashboard's **Trades** section (#1813; ADR-0067) — agreed trades waiting on a parcel, in two
 * groups by {@link TradeShippingStage}: *To send* and *Waiting for the partner*.
 *
 * Pure, so the rows and their order are unit-tested without Prisma; `dashboard.ts` holds the reads,
 * which go through the trades list's own `listTradesPaginated` / `countTrades` with its `shipping`
 * filter — the very set a group's *N more →* opens.
 */
import { formatEntityNo } from "./quick-jump";
import { TRADE_SHIPPING_STAGE_LABEL, type TradeShippingStage } from "./trade-rules";
import type { DashboardGroup, DashboardItem } from "./dashboard-rules";

/** What a row needs of a trade — a `TradeListItem`, structurally. */
export interface DashboardTrade {
  id: string;
  tradeNo: number;
  partnerName: string;
  agreedAt: string | null;
  sentAt: string | null;
}

/**
 * Since when a trade has been in its stage: agreed for *To send*, its parcel out for *Waiting for
 * the partner*. Null for a trade agreed before `agreedAt` was recorded with nothing to recover it
 * from — no age is shown rather than one invented.
 */
export function tradeStageSince(stage: TradeShippingStage, trade: DashboardTrade): string | null {
  return stage === "to-send" ? trade.agreedAt : trade.sentAt;
}

/**
 * Longest waiting first. A trade with no known moment goes first: it was agreed before the moment
 * was recorded, so it has been waiting longer than any that has one. Ties by trade number.
 */
export function sortByStageAge<T extends DashboardTrade>(
  stage: TradeShippingStage,
  trades: readonly T[]
): T[] {
  const since = (t: T) => {
    const at = tradeStageSince(stage, t);
    return at === null ? Number.NEGATIVE_INFINITY : Date.parse(at);
  };
  return [...trades].sort((a, b) => since(a) - since(b) || a.tradeNo - b.tradeNo);
}

/** One row: the partner, the trade's number and balance, and how long it has waited. */
export function tradeShippingItem(
  stage: TradeShippingStage,
  trade: DashboardTrade,
  balance: string | null
): DashboardItem {
  return {
    key: trade.id,
    label: trade.partnerName,
    detail: [formatEntityNo(trade.tradeNo), balance].filter(Boolean).join(" · "),
    at: tradeStageSince(stage, trade),
    href: `trades/${trade.id}`,
  };
}

export function tradeShippingGroup(
  stage: TradeShippingStage,
  count: number,
  items: DashboardItem[]
): DashboardGroup {
  return {
    id: `trades-${stage}`,
    title: TRADE_SHIPPING_STAGE_LABEL[stage],
    count,
    items,
    href: `trades?shipping=${stage}`,
  };
}
