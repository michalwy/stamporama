import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { allocateEntityNumber } from "./items";
import { LABEL_STAMP_SELECT, loadTradeLineLabeller } from "./trade-line-label";
import {
  carryOverPool,
  findSubstitutions,
  isCarryOverSettled,
  splitCarryOverPool,
  tradeLotPendingMessage,
  tradeUnrecordedCostNote,
  type CarryOverPool,
  type SubstitutedArrival,
} from "./trade-intake-rules";

// **Closing a trade turns it into inventory** (#644; ADR-0039 §12) — the database half. The
// arithmetic, the judgements and every sentence a refusal is made in live in the pure
// `trade-intake-rules.ts`, beside this module exactly as `trade-realisation-rules.ts` sits beside
// `trade-realisation.ts`.
//
// **A `Purchase`, yes.** The supplier is the partner and `Purchase.tradeId` says where it came from,
// exactly as `Purchase.auctionSale` marks a purchase transcribed from an auction settlement
// (ADR-0021). That inherits the whole intake apparatus — scan sheets, tiles, tile-to-line binding,
// the pool split, ROI — so nothing is duplicated and nothing pretends the collector bought anything.
//
// **A `Sale`, no.** A sale is a named buyer, an amount, a platform, a shipment and the cycle
// `ordered → paid → packed → sent → received`, in which `paid` would be a lie and the amount fiction.
// The record of the exit is the **give line of a closed trade** — a third exit path beside
// `SaleLineItem` and `disposedAt`, each with its own meaning and none impersonating another. It is
// read, never written: see `hasLeftInTrade` in `trade-realisation-rules.ts`.
//
// **No copies are created here, only lots.** A receive line has the same shape as an auction lot
// line and settlement creates copies from those — but the incoming material of a trade is identified
// through the **scan-sheet intake against the purchase**, which is where a substituted variant and a
// bonus can be seen at all. A copy conjured from the line would agree with the line by construction,
// and there would be nothing left to notice.
//
// It sits **below** `trades.ts` and imports neither it nor `trade-lines.ts`, since `setTradeStatus`
// calls it; `lots.ts` calls it too, for the gate on closing one of these lots.

/** Everything a purchase's lot prices are computed from: what left, and what came. */
const GIVE_SELECT = {
  itemId: true,
  fulfillment: true,
  item: { select: { costBasis: true, lotId: true, lot: { select: { status: true } } } },
} satisfies Prisma.TradeLineSelect;

const RECEIVE_SELECT = {
  id: true,
  fulfillment: true,
  quantity: true,
  stampId: true,
  condition: { select: { name: true, abbreviation: true } },
  stamp: { select: LABEL_STAMP_SELECT },
  // The frozen **own** valuation (#638), in the collection's base currency — the same unit a cost
  // basis is in, which is the whole reason the split can be done in it without a rate.
  valuations: { where: { kind: "own" }, select: { value: true } },
} satisfies Prisma.TradeLineSelect;

type GiveRow = Prisma.TradeLineGetPayload<{ select: typeof GIVE_SELECT }>;
type ReceiveRow = Prisma.TradeLineGetPayload<{ select: typeof RECEIVE_SELECT }>;

async function readSides(tradeId: string): Promise<{ give: GiveRow[]; receive: ReceiveRow[] }> {
  const [give, receive] = await Promise.all([
    prisma.tradeLine.findMany({
      where: { tradeId, side: "give", itemId: { not: null } },
      select: GIVE_SELECT,
    }),
    prisma.tradeLine.findMany({
      where: { tradeId, side: "receive" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: RECEIVE_SELECT,
    }),
  ]);
  return { give, receive };
}

/** The pure module's view of the give side. */
function poolOf(give: GiveRow[]): CarryOverPool {
  return carryOverPool(
    give.map((line) => ({
      itemId: line.itemId!,
      fulfillment: line.fulfillment,
      costBasis: line.item?.costBasis?.toFixed(2) ?? null,
      lotId: line.item?.lotId ?? null,
      lotStatus: line.item?.lot?.status ?? null,
    }))
  );
}

/** The pure module's view of the receive side. */
function incomingOf(receive: ReceiveRow[]) {
  return receive.map((line) => ({
    lineId: line.id,
    fulfillment: line.fulfillment,
    ownValue: line.valuations[0]?.value != null ? Number(line.valuations[0].value) : null,
    quantity: line.quantity,
  }));
}

function money(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount.toFixed(2));
}

/**
 * Turn a closed trade into the purchase that holds what came in.
 *
 * Called from `setTradeStatus` after the write, so a trade that failed to move never leaves a
 * purchase behind. **Idempotent**: a trade that already has one is left alone, which is what makes
 * reopening the negotiation and closing it again the ordinary act it should be rather than a way to
 * grow a second parcel.
 *
 * A trade where **nothing arrived** — every receive line withdrawn or never delivered, or a trade
 * with no receive side at all — gets no purchase. There is no material to hold and an empty parcel
 * on the orders list would be a record of something that did not happen. The give side still leaves
 * the collection: that is the line's doing, not the purchase's.
 */
export async function createTradePurchase(tradeId: string): Promise<string | null> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: {
      collectionId: true,
      partnerId: true,
      receivedAt: true,
      purchase: { select: { id: true } },
      collection: { select: { baseCurrency: true } },
    },
  });
  if (!trade) return null;
  if (trade.purchase) return trade.purchase.id;

  const { give, receive } = await readSides(tradeId);
  const pool = poolOf(give);
  const shares = splitCarryOverPool(pool.total, incomingOf(receive));
  if (shares.length === 0) return null;

  // A lot the collector will meet on the orders screen, named the way the trade named it — the same
  // labeller a refusal names a line with, so the two are recognisably about the same thing.
  const label = await loadTradeLineLabeller(trade.collectionId);
  const titleByLine = new Map(
    receive.map((line) => [line.id, label({ condition: line.condition, stamp: line.stamp, item: null })])
  );

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        collectionId: trade.collectionId,
        purchaseNo: await allocateEntityNumber(tx, trade.collectionId, "purchase"),
        // The partner is the supplier. There is no platform: an exchange goes through nobody.
        contactId: trade.partnerId,
        tradeId,
        // The day the exchange was closed. There is no other date on it, and no money was spent on
        // one — which is also why the currency is the **base** one and the rate is null: the pool is
        // already a base-currency figure, being a sum of cost bases, so there is nothing to convert
        // and no rate anybody could check.
        purchasedAt: startOfDay(new Date()),
        currency: trade.collection.baseCurrency,
        fxRateToBase: null,
        // Postage is the one piece of genuine cash in the whole operation, and it is typed on the
        // order like any other shipping cost — distributed over the incoming copies by the engine
        // that distributes every other shared cost. Nothing here invents a figure for it.
        shippingCost: null,
        status: trade.receivedAt ? "arrived" : "in_transit",
      },
      select: { id: true },
    });

    for (const share of shares) {
      await tx.purchaseLot.create({
        data: {
          purchaseId: purchase.id,
          tradeLineId: share.lineId,
          title: titleByLine.get(share.lineId) ?? null,
          price: money(share.price),
          status: "open",
        },
      });
    }

    return purchase.id;
  });
}

/** Midnight UTC, the shape every other date column on a purchase is stored in. */
function startOfDay(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Restate a trade purchase's lot prices from the cost bases as they stand now.
 *
 * The pool is the cost of copies that may themselves still be waiting on a lot of their own, so the
 * figure written at closing is provisional and this is what settles it — called from `closeLot`,
 * just before the pool it is about to distribute is read.
 *
 * **It stops at the first closed lot.** Up to that point the recompute is idempotent: the gate below
 * refuses to close any of these lots while a source copy is pending, so once one of them may close,
 * every source basis is frozen and the split is deterministic. After it, restating would move money
 * that has already been distributed to copies — which a source purchase being reopened for a
 * correction could otherwise do, silently.
 */
export async function syncTradePurchasePool(purchaseId: string): Promise<void> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { tradeId: true, lots: { select: { id: true, tradeLineId: true, status: true } } },
  });
  if (!purchase?.tradeId) return;
  if (purchase.lots.some((lot) => lot.status === "closed")) return;

  const { give, receive } = await readSides(purchase.tradeId);
  const shares = splitCarryOverPool(poolOf(give).total, incomingOf(receive));
  const priceByLine = new Map(shares.map((s) => [s.lineId, s.price]));

  for (const lot of purchase.lots) {
    const price = lot.tradeLineId != null ? priceByLine.get(lot.tradeLineId) : undefined;
    if (price === undefined) continue;
    await prisma.purchaseLot.update({ where: { id: lot.id }, data: { price: money(price) } });
  }
}

/**
 * Why one of a trade's lots may not be closed yet, or null.
 *
 * Read by `closeLot`, which is otherwise none the wiser that a lot came from a trade. Null for every
 * ordinary purchase, so the gate costs one already-loaded column on the common path.
 */
export async function tradeLotCarryOverBlocker(lotId: string): Promise<string | null> {
  const lot = await prisma.purchaseLot.findUnique({
    where: { id: lotId },
    select: { purchase: { select: { tradeId: true } } },
  });
  const tradeId = lot?.purchase?.tradeId;
  if (!tradeId) return null;

  const give = await prisma.tradeLine.findMany({
    where: { tradeId, side: "give", itemId: { not: null } },
    select: GIVE_SELECT,
  });
  return tradeLotPendingMessage(await blockingOrderLabels(poolOf(give)));
}

/** The orders a pending source copy is waiting on, named as the quick-jump box names them (#431) —
 *  distinct, because ten copies off one auction lot are one thing to go and close. */
async function blockingOrderLabels(pool: CarryOverPool): Promise<string[]> {
  if (isCarryOverSettled(pool)) return [];
  const rows = await prisma.item.findMany({
    where: { id: { in: pool.pendingItemIds } },
    select: { lot: { select: { purchase: { select: { purchaseNo: true } } } } },
  });
  const numbers = [
    ...new Set(
      rows
        .map((row) => row.lot?.purchase?.purchaseNo)
        .filter((no): no is number => typeof no === "number")
    ),
  ].sort((a, b) => a - b);
  return numbers.map((no) => `order #${no}`);
}

/**
 * A substitution with the two stamps named (#642).
 *
 * Named by **catalogue number**, through the labeller a refusal names a line with — so *what was
 * promised* and *what came* read as the same kind of thing as every other sentence the trade says
 * about a line, and a stamp with no name (which is most of them) is still legible.
 */
export interface TradeSubstitution extends SubstitutedArrival {
  promisedLabel: string;
  arrivedLabel: string;
}

/** What closing did, as the trade's own screen reads it. */
export interface TradeIntakeRead {
  /** The purchase this trade became, or null while it has not been closed (or brought nothing in). */
  purchase: {
    id: string;
    purchaseNo: number;
    /** The collection's base currency — a trade purchase has no other. */
    currency: string;
    /** The carried-over pool as it stands, 2-dp. Provisional while {@link settled} is false. */
    pool: string;
    lotCount: number;
    openLotCount: number;
    /** Copies identified into those lots so far. */
    itemCount: number;
    /** Scan tiles on the order still waiting to become something (#566) — a nudge, never a block. */
    unidentifiedTileCount: number;
  } | null;
  /** Which lot holds which receive line's material, so a row can link straight into the intake. */
  lotByLine: Record<string, string>;
  /** What arrived as something other than what was promised (#642) — derived, never stored. */
  substitutions: TradeSubstitution[];
  /** Whether every copy that left has a frozen cost basis, so the pool is final. */
  settled: boolean;
  /** Why the incoming lots cannot be closed yet, naming the orders, or null. */
  pendingMessage: string | null;
  /** The copies that carried no recorded cost at all, as a sentence, or null. */
  unrecordedNote: string | null;
}

export const NO_TRADE_INTAKE: TradeIntakeRead = {
  purchase: null,
  lotByLine: {},
  substitutions: [],
  settled: true,
  pendingMessage: null,
  unrecordedNote: null,
};

/**
 * What became of this trade's material, for the trade's own screen.
 *
 * Rides with the detail read beside the reservation, the feedback and the realisation, for their
 * reason: it is a light read over rows the screen is about to draw anyway, and what it says — *this
 * is where the incoming material is being identified*, *this line came as something else*, *the cost
 * is still waiting on order #12* — has to be **on the trade**, which is the screen the collector is
 * on when they wonder.
 */
export async function readTradeIntake(tradeId: string): Promise<TradeIntakeRead> {
  const purchase = await prisma.purchase.findUnique({
    where: { tradeId },
    select: {
      id: true,
      purchaseNo: true,
      currency: true,
      lots: {
        select: {
          id: true,
          tradeLineId: true,
          status: true,
          items: { select: { id: true, stampId: true } },
        },
      },
      scanTiles: { where: { state: "unidentified" }, select: { id: true } },
    },
  });
  if (!purchase) return NO_TRADE_INTAKE;

  const give = await prisma.tradeLine.findMany({
    where: { tradeId, side: "give", itemId: { not: null } },
    select: GIVE_SELECT,
  });
  const pool = poolOf(give);

  const promisedByLine = new Map(
    (
      await prisma.tradeLine.findMany({
        where: { tradeId, side: "receive" },
        select: { id: true, stampId: true },
      })
    ).map((line) => [line.id, line.stampId])
  );

  const lotByLine: Record<string, string> = {};
  const arrived = [];
  let itemCount = 0;
  let openLotCount = 0;
  for (const lot of purchase.lots) {
    if (lot.status !== "closed") openLotCount += 1;
    itemCount += lot.items.length;
    if (!lot.tradeLineId) continue;
    lotByLine[lot.tradeLineId] = lot.id;
    for (const item of lot.items) {
      arrived.push({
        lineId: lot.tradeLineId,
        itemId: item.id,
        promisedStampId: promisedByLine.get(lot.tradeLineId) ?? null,
        arrivedStampId: item.stampId,
      });
    }
  }

  return {
    purchase: {
      id: purchase.id,
      purchaseNo: purchase.purchaseNo,
      currency: purchase.currency,
      pool: pool.total.toFixed(2),
      lotCount: purchase.lots.length,
      openLotCount,
      itemCount,
      unidentifiedTileCount: purchase.scanTiles.length,
    },
    lotByLine,
    substitutions: await nameSubstitutions(tradeId, findSubstitutions(arrived)),
    settled: isCarryOverSettled(pool),
    pendingMessage: tradeLotPendingMessage(await blockingOrderLabels(pool)),
    unrecordedNote: tradeUnrecordedCostNote(pool),
  };
}

/**
 * Put the two stamps' names on each substitution.
 *
 * A second read, and only where there is something to name — which on nearly every trade is nothing
 * at all. The labeller is the trade's own, so a line described here and the same line named in a
 * refusal are recognisably about the same stamp.
 */
async function nameSubstitutions(
  tradeId: string,
  substitutions: readonly SubstitutedArrival[]
): Promise<TradeSubstitution[]> {
  if (substitutions.length === 0) return [];
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { collectionId: true },
  });
  if (!trade) return [];

  const stampIds = [
    ...new Set(substitutions.flatMap((s) => [s.promisedStampId, s.arrivedStampId])),
  ];
  const [label, stamps] = await Promise.all([
    loadTradeLineLabeller(trade.collectionId),
    prisma.stamp.findMany({ where: { id: { in: stampIds } }, select: { id: true, ...LABEL_STAMP_SELECT } }),
  ]);
  const byId = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const name = (stampId: string): string =>
    label({ condition: null, stamp: byId.get(stampId) ?? null, item: null });

  return substitutions.map((s) => ({
    ...s,
    promisedLabel: name(s.promisedStampId),
    arrivedLabel: name(s.arrivedStampId),
  }));
}
