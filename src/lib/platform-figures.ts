import "server-only";
import { prisma } from "./db";
import { purchaseCostsOf } from "./purchase-allocation";
import { orderSpend, readSales } from "./contact-page";
import {
  averageDaysToSale,
  offerClosedOn,
  sellThrough,
  sumMoney,
  type MoneyTotal,
} from "./contact-page-rules";

// A platform's figures (#1960): how selling and buying on it goes — the offers on it, the sales and
// purchases made through it. They were the contact page's Platform section (#1710) until platforms
// left the contacts (#1955, ADR-0071), and are now the second row of the summary strip on the
// platform's own Settings page (ADR-0059 §4). The figures are #1710's, no more and no fewer, and the
// money rules are `contact-page-rules.ts`' unchanged.
//
// **Over all time**, settled with the collector on 2026-10-16: Settings is no report, so there is no
// period switch — the contact page's own default. Active and ready are where the offers stand today.

export interface PlatformFigures {
  /** Offers live on it now, and ready to go up. */
  activeCount: number;
  readyCount: number;
  /** Offers that ended: sold, and withdrawn. */
  soldCount: number;
  withdrawnCount: number;
  /** Sold of the offers that ended, 0–1; null when none ended. */
  sellThrough: number | null;
  /** The mean days from listing to sale over the sold offers with a listing date; null with none. */
  avgDaysToSale: number | null;
  /** How many sold offers the average is over — those missing a listing date are not. */
  timedCount: number;
  /** Sales made through it, and what their buyers paid — the sales list's own measure. */
  salesCount: number;
  revenue: MoneyTotal;
  /** Purchases made through it, and their order totals (#852). */
  purchaseCount: number;
  purchaseSpent: MoneyTotal;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The platform's figures, or null when it is not found, not in that collection or not the caller's. */
export async function getPlatformFigures(
  ownerId: string,
  collectionId: string,
  platformId: string
): Promise<PlatformFigures | null> {
  const platform = await prisma.platform.findUnique({
    where: { id: platformId },
    select: { collectionId: true, collection: { select: { ownerId: true, baseCurrency: true } } },
  });
  if (!platform || platform.collectionId !== collectionId || platform.collection.ownerId !== ownerId) {
    return null;
  }
  const { baseCurrency } = platform.collection;

  const [activeCount, readyCount, closed, sales, purchases] = await Promise.all([
    prisma.offer.count({ where: { collectionId, platformId, state: "active" } }),
    prisma.offer.count({ where: { collectionId, platformId, state: "ready" } }),
    prisma.offer.findMany({
      where: { collectionId, platformId, state: { in: ["sold", "withdrawn"] } },
      select: {
        state: true,
        listingDate: true,
        closedAt: true,
        saleLines: { select: { sale: { select: { soldAt: true } } } },
      },
    }),
    readSales({ collectionId, platformId }, baseCurrency, undefined),
    // The purchases list's own rule for a purchase: a trade's incoming side is no purchase.
    prisma.purchase.findMany({
      where: { collectionId, platformId, kind: "purchase", tradeId: null },
      select: {
        currency: true,
        fxRateToBase: true,
        shippingCost: true,
        lots: { select: { id: true, price: true } },
        expenses: { select: { id: true, price: true } },
        supplyLines: { select: { id: true, price: true } },
      },
    }),
  ]);

  let soldCount = 0;
  let withdrawnCount = 0;
  const timed: { listedOn: string; soldOn: string }[] = [];
  for (const o of closed) {
    if (o.state !== "sold") {
      withdrawnCount += 1;
      continue;
    }
    soldCount += 1;
    // The day it sold is its earliest sale's, the stamp only where no sale names it (#512).
    const soldOn = offerClosedOn(
      o.closedAt ? isoDate(o.closedAt) : null,
      o.saleLines.map((l) => isoDate(l.sale.soldAt))
    );
    if (o.listingDate && soldOn) timed.push({ listedOn: isoDate(o.listingDate), soldOn });
  }

  const purchaseSpent = sumMoney(
    purchases.map((p) => {
      const spend = orderSpend(p, purchaseCostsOf(p), baseCurrency);
      return {
        amount: Number(spend.tx.total),
        currency: p.currency,
        base: spend.base ? Number(spend.base.total) : null,
      };
    }),
    baseCurrency
  );

  return {
    activeCount,
    readyCount,
    soldCount,
    withdrawnCount,
    sellThrough: sellThrough(soldCount, withdrawnCount),
    avgDaysToSale: averageDaysToSale(timed),
    timedCount: timed.length,
    salesCount: sales.count,
    revenue: sales.revenue,
    purchaseCount: purchases.length,
    purchaseSpent,
  };
}
