import "server-only";
import { prisma } from "./db";
import { valuateItemsByIds } from "./item-valuation";
import { getCollectionBaseCurrency } from "./pricing";
import { resolveCostBasis, type CostBasisInput } from "./cost-basis";
import {
  canExpressInBase,
  estimateCopyCost,
  estimateWeightBase,
  lotPoolBase,
  purchaseCostsOf,
  type CostEstimate,
} from "./purchase-allocation";

// **What a copy on a still-open lot is estimated to cost** (#1696), read for the screens other than
// the purchase order: the copy's own page, the copies list, and the Valuation dialog's *What I paid*.
//
// The purchase order works its estimate out on the screen, from the lot's pool off the purchase
// detail and the lot's weight base off its intake summary (#172). This is the same arithmetic read
// server-side — the same pool rule (`lotPoolBase`), the same denominator (`estimateWeightBase`, over
// the **whole** lot whatever the reader is showing) and the same share (`estimateCopyCost`) — so a
// copy's page and its purchase order can never state two different figures.
//
// It is an estimate and stays one: nothing here is stored, nothing here is a cost basis, and a
// total that counts cost bases keeps counting these copies as pending (#1696).
//
// Kept out of `items.ts`, which reads through it, so the two never import each other.

/** A copy as the estimate needs it: its cost-basis inputs, which say whether it is pending. */
export interface CostEstimateCopy extends CostBasisInput {
  id: string;
}

/**
 * The estimate of every **pending** copy among `copies` — id → estimate, or a gap saying why there
 * is none. A copy that is not pending (frozen, no lot, no opening value) is absent.
 *
 * Each open lot behind them is read whole, once: its purchase's money for the pool, and every copy
 * on it valued for the weight base. Caller must have asserted collection ownership.
 */
export async function loadCostEstimates(
  collectionId: string,
  copies: readonly CostEstimateCopy[]
): Promise<Map<string, CostEstimate>> {
  const pending = copies.filter((c) => resolveCostBasis(c).state === "pending");
  const lotIds = [...new Set(pending.map((c) => c.lotId!))];
  if (lotIds.length === 0) return new Map();

  const [lots, baseCurrency] = await Promise.all([
    prisma.purchaseLot.findMany({
      where: { id: { in: lotIds }, purchase: { collectionId } },
      select: {
        id: true,
        price: true,
        items: { select: { id: true, deliveryState: true } },
        purchase: {
          select: {
            currency: true,
            shippingCost: true,
            fxRateToBase: true,
            lots: { select: { id: true, price: true } },
            expenses: { select: { id: true, price: true } },
          },
        },
      },
    }),
    getCollectionBaseCurrency(collectionId),
  ]);

  const valuations = await valuateItemsByIds(
    collectionId,
    lots.flatMap((l) => l.items.map((i) => i.id))
  );

  const estimates = new Map<string, CostEstimate>();
  for (const lot of lots) {
    const costs = purchaseCostsOf(lot.purchase);
    const poolBase = lotPoolBase(costs, lot.id, {
      valued: lot.price != null,
      canExpressBase: canExpressInBase(costs.fxRateToBase, lot.purchase.currency, baseCurrency),
    });
    const weighed = lot.items.map((i) => ({
      id: i.id,
      deliveryState: i.deliveryState,
      weight: valuations.get(i.id)?.baseAmount ?? null,
    }));
    const weightBase = estimateWeightBase(weighed);
    for (const copy of weighed) estimates.set(copy.id, estimateCopyCost(copy, poolBase, weightBase));
  }

  // Only the copies asked about, and only the pending ones among them.
  const result = new Map<string, CostEstimate>();
  for (const c of pending) {
    const estimate = estimates.get(c.id);
    if (estimate) result.set(c.id, estimate);
  }
  return result;
}
