import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { lotCostInputs, lotIsOpeningBalance, resolveCostBasis } from "./cost-basis";
import { loadCostEstimates } from "./cost-estimates";
import type { BaseCurrency } from "./currencies";
import { isHeld } from "./disposal";
import { getOrFetchRates } from "./exchange-rates";
import type { PostListLotFigures } from "./facebook-post-list-figures";
import { getHoldingsValuationByGroup } from "./items";
import { holdingsCostParts, notHeldCounts, offerSetCost } from "./offer-cost";
import { offerPriceFigures } from "./offer-price-table";
import { isAuctionListing, normalizeListingType } from "./offer-rules";

// The figures the list of posts shows under each post (#2502), read for a page of posts at once —
// the holdings, the pending copies' cost estimates and the rates each asked **once for the page**, as
// the Prepare screen asks them (#2222). A lot's catalogue value and cost are the offer price table's
// own (`offerPriceFigures`, per set, base currency), so the list cannot say what the offer's screen
// would not. The summing is `facebook-post-list-figures.ts`'s.

/** What the list reads of each lot for its figures. */
export const POST_LIST_LOT_FIGURES_SELECT = {
  id: true,
  listingType: true,
  price: true,
  startingPrice: true,
  currency: true,
  sets: {
    select: {
      id: true,
      items: {
        select: {
          itemId: true,
          item: {
            select: {
              costBasis: true,
              lotId: true,
              disposedAt: true,
              deliveryState: true,
              lot: { select: { status: true, price: true, purchase: { select: { kind: true } } } },
            },
          },
        },
      },
    },
  },
  // A cancelled sale's lines are deleted (#2500); the filter says the rule where it is read. A free
  // extra rides along with a sale and sold no lot.
  saleLines: {
    where: { freeExtra: false, sale: { status: { not: "cancelled" } } },
    select: { price: true, sale: { select: { currency: true } } },
  },
} satisfies Prisma.OfferSelect;

export type PostListFiguresLot = Prisma.OfferGetPayload<{ select: typeof POST_LIST_LOT_FIGURES_SELECT }>;

/** Each lot's figures, by its offer id. Caller must have asserted collection ownership. */
export async function readPostListLotFigures(
  collectionId: string,
  baseCurrency: string,
  lots: readonly PostListFiguresLot[]
): Promise<Map<string, PostListLotFigures>> {
  const sets = lots.flatMap((lot) => lot.sets);
  const copies = sets.flatMap((s) => s.items);
  const costInputs = new Map(
    copies.map((li) => [
      li.itemId,
      {
        id: li.itemId,
        costBasis: li.item.costBasis == null ? null : li.item.costBasis.toString(),
        lotId: li.item.lotId,
        openingBalance: lotIsOpeningBalance(li.item.lot),
        ...lotCostInputs(li.item.lot),
      },
    ])
  );
  // Copies whose cost is still pending, picked as the offer's own screen picks them (#1736, #2437).
  const pending = copies
    .filter((li) => isHeld(li.item))
    .map((li) => costInputs.get(li.itemId)!)
    .filter((c) => resolveCostBasis(c).state === "pending");
  const pendingIds = new Set(pending.map((c) => c.id));

  const currencies = [
    ...new Set([
      ...lots.map((lot) => lot.currency),
      ...lots.flatMap((lot) => lot.saleLines.map((line) => line.sale.currency)),
    ]),
  ].filter((c) => c !== baseCurrency);
  const [holdingsBySet, costEstimates, rates] = await Promise.all([
    getHoldingsValuationByGroup(
      collectionId,
      sets.map((s) => ({ key: s.id, itemIds: s.items.map((li) => li.itemId) }))
    ),
    loadCostEstimates(collectionId, pending),
    currencies.length === 0
      ? Promise.resolve(new Map<string, { rate: number }>())
      : getOrFetchRates(collectionId, baseCurrency as BaseCurrency, currencies).catch(
          () => new Map<string, { rate: number }>()
        ),
  ]);
  /** An amount in `currency` as base currency, or null when no rate is known. */
  const toBase = (amount: number, currency: string): number | null => {
    if (currency === baseCurrency) return amount;
    const rate = rates.get(currency)?.rate;
    return rate === undefined ? null : amount * rate;
  };

  const figures = new Map<string, PostListLotFigures>();
  for (const lot of lots) {
    const lotSets = lot.sets.map((s) => {
      const holdings = holdingsBySet.get(s.id)!;
      const parts = holdingsCostParts(holdings);
      const cost = offerSetCost(
        parts.known,
        s.items
          .filter((li) => pendingIds.has(li.itemId))
          .map((li) => ({
            label: li.itemId,
            estimate: costEstimates.get(li.itemId)?.amount ?? null,
            openingBalance: costInputs.get(li.itemId)!.openingBalance,
          })),
        parts.opening,
        notHeldCounts(s.items.map((li) => li.item))
      );
      return { holdings, cost, estimates: [] };
    });
    const table = offerPriceFigures(lotSets, 1);
    const stated = isAuctionListing(normalizeListingType(lot.listingType))
      ? lot.startingPrice
      : lot.price;
    const statedAmount = stated != null && Number(stated) > 0 ? Number(stated) : null;
    const asking = statedAmount === null ? null : toBase(statedAmount, lot.currency);
    const soldParts = lot.saleLines.map((line) => toBase(Number(line.price), line.sale.currency));
    figures.set(lot.id, {
      copyCount: lot.sets.reduce((n, s) => n + s.items.length, 0),
      asking,
      askingUnconvertible: statedAmount !== null && asking === null,
      catalogue: table.catalogue.valuedSets > 0 ? table.catalogue.sumBase / table.catalogue.valuedSets : null,
      cost: table.costAverageBase,
      costEstimated: lotSets.some((s) => s.cost.estimated),
      costOpening: lotSets.some((s) => s.cost.opening),
      sold: lot.saleLines.length > 0,
      soldAmount: soldParts.some((p) => p === null)
        ? null
        : soldParts.reduce<number>((sum, p) => sum + (p ?? 0), 0),
    });
  }
  return figures;
}
