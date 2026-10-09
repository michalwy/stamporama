import "server-only";
import { prisma } from "./db";
import { getContactListItem, type ContactListItem } from "./contacts";
import { resolveBuyerHandling } from "./sales";
import { auctionLotExposure, countAuctionLots, type AuctionLotExposure } from "./auctions";
import { lotOutcome } from "./auction-lot";
import {
  isAuctionLotStatus,
  isAuctionSaleStatus,
  type AuctionLotStatus,
  type AuctionSaleStatus,
} from "./auction-rules";
import { valuateItemsByIds } from "./item-valuation";
import { canExpressInBase, lotPoolBase, purchaseCostsOf } from "./purchase-allocation";
import { resolvePurchaseSpend } from "./purchase-spend";
import {
  lotCatalogBasis,
  orderCostToCatalog,
  type CatalogBasisCopy,
  type CostToCatalog,
  type CostToCatalogLot,
} from "./cost-to-catalog";
import { dateRangeBounds, type DateRange } from "./profit-and-loss-rules";
import {
  auctionPremiumTerms,
  auctionWinRate,
  auctionWonSpend,
  contactPeriodRange,
  type MoneyEntry,
  NOT_DELIVERED_PURCHASE_STATUSES,
  sumMoney,
  toBaseAmount,
  UNPAID_SALE_STATUSES,
  UNSENT_SALE_STATUSES,
  type ContactPeriod,
  type MoneyTotal,
} from "./contact-page-rules";

// The read behind a contact's own page (#1708): its header, and one section per role it plays —
// here **purchases** (the contact as seller), **sales** (the contact as buyer) and **auctions** (the
// contact as the seller or house an auction sale is tracked with, #1709). Platform and trades (#1710)
// is a section of its own still to come.
//
// **A section shows when the contact has the role or has data for it**, the data counted over all
// time: a contact created on the fly from a purchase's supplier field carries no roles, and its
// purchases must still show — and switching the period must not make a section disappear.
//
// Every figure in a section is over the period chosen; the money rules are `contact-page-rules.ts`'.

export interface ContactPurchaseRow {
  id: string;
  purchaseNo: number;
  purchasedAt: string;
  status: string;
  platformName: string | null;
  currency: string;
  /** What the order cost — lots, expenses and shipping (#852) — in its own currency. */
  total: string;
  /** Copies on the order, not-delivered ones aside. */
  copyCount: number;
}

export interface ContactPurchases {
  count: number;
  /** Σ of the order totals (#852). */
  spent: MoneyTotal;
  /** What the period's orders cost as a share of their copies' catalogue value (#1395) — every lot of
   *  every order read as one order is, so it is weighted by money rather than an average of
   *  percentages. Null where nothing has a figure. */
  costToCatalog: CostToCatalog | null;
  copyCount: number;
  lastPurchasedAt: string | null;
  /** The latest purchase's id, which the date opens. */
  lastPurchaseId: string | null;
  /** Orders still *Preparing* or *In transit*. */
  notDeliveredCount: number;
  rows: ContactPurchaseRow[];
}

export interface ContactSaleRow {
  id: string;
  saleNo: number;
  soldAt: string;
  status: string;
  platformName: string;
  currency: string;
  /** What the buyer paid: the line prices plus their handling, in the sale's currency. */
  paid: string;
  copyCount: number;
}

export interface ContactSales {
  count: number;
  /** Σ of what the buyer paid — the line prices plus buyer handling, before commission and the
   *  collector's own shipping, which are costs of the sale rather than money from the buyer. */
  revenue: MoneyTotal;
  copyCount: number;
  lastSoldAt: string | null;
  lastSaleId: string | null;
  /** Sales still *Ordered*. */
  unpaidCount: number;
  /** Sales not yet *Sent* — *Ordered*, *Paid* or *Packed*. */
  unsentCount: number;
  rows: ContactSaleRow[];
}

export interface ContactAuctionSaleRow {
  id: string;
  name: string;
  /** When the sale was first tracked — the date the period reads (see {@link readAuctions}). */
  trackedAt: string;
  status: AuctionSaleStatus;
  platformName: string;
  openCount: number;
  wonCount: number;
  lostCount: number;
}

export interface ContactAuctions {
  /** Auction sales tracked with the contact in the period. */
  saleCount: number;
  /** Every lot of those sales, whatever became of it. */
  lotCount: number;
  wonCount: number;
  lostCount: number;
  cancelledCount: number;
  /** Won of won + lost — see `auctionWinRate`. Null with nothing decided. */
  winRate: number | null;
  /** The won lots all-in: hammer, premium and each parcel's shipping once. */
  spent: MoneyTotal;
  /** The distinct buyer's premium terms across the period's sales, most recent first — each seeded
   *  from the contact when its sale was tracked, so a change of terms shows as a second entry. */
  premiumTerms: string[];
  /**
   * The contact's lots **as they stand now**, whatever the period — what is still running is a
   * present state, and these are the lots list's own figures (#1036) under its link, so the two can
   * never disagree: lots still open, what they commit and what they would cost at their ceilings,
   * and lots still waiting for the collector's review (#1626).
   */
  openCount: number;
  exposure: AuctionLotExposure;
  toReviewCount: number;
  rows: ContactAuctionSaleRow[];
}

export interface ContactPage {
  contact: ContactListItem;
  baseCurrency: string;
  period: ContactPeriod;
  range: DateRange;
  /** Null when the contact neither sells nor ever sold to the collector. */
  purchases: ContactPurchases | null;
  /** Null when the contact neither buys nor ever bought from the collector. */
  sales: ContactSales | null;
  /** Null when the contact is no auction house and no auction sale is tracked with it. */
  auctions: ContactAuctions | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The contact's page over one period, or null when the contact is not found or not the caller's. */
export async function getContactPage(
  ownerId: string,
  contactId: string,
  period: ContactPeriod,
  today: string
): Promise<ContactPage | null> {
  const contact = await getContactListItem(ownerId, contactId);
  if (!contact) return null;
  const { baseCurrency } = await prisma.collection.findUniqueOrThrow({
    where: { id: contact.collectionId },
    select: { baseCurrency: true },
  });
  const range = contactPeriodRange(period, today);
  const bounds = dateRangeBounds(range);
  const dateWhere = bounds.gte || bounds.lt ? bounds : undefined;

  const [purchaseCount, saleCount, auctionSaleCount] = await Promise.all([
    prisma.purchase.count({ where: purchaseWhere(contact) }),
    prisma.sale.count({ where: { collectionId: contact.collectionId, buyerId: contact.id } }),
    prisma.auctionSale.count({ where: { collectionId: contact.collectionId, sellerId: contact.id } }),
  ]);

  return {
    contact,
    baseCurrency,
    period,
    range,
    purchases:
      contact.seller || purchaseCount > 0
        ? await readPurchases(contact, baseCurrency, dateWhere)
        : null,
    sales:
      contact.buyer || saleCount > 0 ? await readSales(contact, baseCurrency, dateWhere) : null,
    // The Seller role alone does not bring it: most sellers are never bid with, and the purchases
    // section already answers for them. An auction house is, so it shows before anything is tracked.
    auctions:
      contact.auctionHouse || auctionSaleCount > 0
        ? await readAuctions(ownerId, contact, baseCurrency, dateWhere)
        : null,
  };
}

/**
 * The contact's purchases: the orders it is the supplier on. **A purchase, never a trade's incoming
 * half** — a trade is not money spent (#644) and has a section of its own (#1710) — and never an
 * opening balance, which has no supplier.
 */
function purchaseWhere(contact: ContactListItem) {
  return {
    collectionId: contact.collectionId,
    contactId: contact.id,
    kind: "purchase",
    tradeId: null,
  };
}

async function readPurchases(
  contact: ContactListItem,
  baseCurrency: string,
  dateWhere: { gte?: Date; lt?: Date } | undefined
): Promise<ContactPurchases> {
  const purchases = await prisma.purchase.findMany({
    where: { ...purchaseWhere(contact), ...(dateWhere ? { purchasedAt: dateWhere } : {}) },
    orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      purchaseNo: true,
      purchasedAt: true,
      status: true,
      currency: true,
      fxRateToBase: true,
      shippingCost: true,
      platform: { select: { name: true } },
      lots: { select: { id: true, price: true, status: true } },
      expenses: { select: { id: true, price: true } },
    },
  });

  const copies = await prisma.item.findMany({
    where: {
      collectionId: contact.collectionId,
      lot: { purchaseId: { in: purchases.map((p) => p.id) } },
    },
    select: { id: true, lotId: true, deliveryState: true, costBasis: true, lot: { select: { purchaseId: true } } },
  });
  // The catalogue value a lot's pool is split by, read as the purchase screen reads it (#1395).
  const valuations = await valuateItemsByIds(
    contact.collectionId,
    copies.map((c) => c.id)
  );
  const copiesByLot = new Map<string, CatalogBasisCopy[]>();
  const copyCountByPurchase = new Map<string, number>();
  for (const c of copies) {
    if (!c.lotId || !c.lot) continue;
    const basis = copiesByLot.get(c.lotId) ?? [];
    basis.push({
      deliveryState: c.deliveryState,
      costBasis: c.costBasis == null ? null : Number(c.costBasis),
      catalogValue: valuations.get(c.id)?.baseAmount ?? null,
    });
    copiesByLot.set(c.lotId, basis);
    if (c.deliveryState !== "not_delivered") {
      copyCountByPurchase.set(c.lot.purchaseId, (copyCountByPurchase.get(c.lot.purchaseId) ?? 0) + 1);
    }
  }

  const lots: CostToCatalogLot[] = [];
  const rows: ContactPurchaseRow[] = [];
  const spent = purchases.map((p) => {
    const costs = purchaseCostsOf(p);
    const canExpressBase = canExpressInBase(costs.fxRateToBase, p.currency, baseCurrency);
    for (const l of p.lots) {
      const valued = l.price != null;
      lots.push({
        open: l.status === "open",
        valued,
        poolBase: lotPoolBase(costs, l.id, { valued, canExpressBase }),
        basis: lotCatalogBasis(copiesByLot.get(l.id) ?? []),
      });
    }
    // The order's total exactly as its own screen states it (#852).
    const linesTx = [...p.lots, ...p.expenses].reduce(
      (sum, l) => (l.price == null ? sum : sum + Number(l.price)),
      0
    );
    const spend = resolvePurchaseSpend({
      scope: "order",
      priceTx: linesTx,
      shippingTx: costs.shippingCost,
      currency: p.currency,
      baseCurrency,
      fxRateToBase: costs.fxRateToBase,
    });
    rows.push({
      id: p.id,
      purchaseNo: p.purchaseNo,
      purchasedAt: isoDate(p.purchasedAt),
      status: p.status,
      platformName: p.platform?.name ?? null,
      currency: p.currency,
      total: spend.tx.total,
      copyCount: copyCountByPurchase.get(p.id) ?? 0,
    });
    return {
      amount: Number(spend.tx.total),
      currency: p.currency,
      base: spend.base ? Number(spend.base.total) : null,
    };
  });

  return {
    count: purchases.length,
    spent: sumMoney(spent, baseCurrency),
    costToCatalog: orderCostToCatalog(lots),
    copyCount: rows.reduce((sum, r) => sum + r.copyCount, 0),
    lastPurchasedAt: rows[0]?.purchasedAt ?? null,
    lastPurchaseId: rows[0]?.id ?? null,
    notDeliveredCount: purchases.filter((p) =>
      (NOT_DELIVERED_PURCHASE_STATUSES as readonly string[]).includes(p.status)
    ).length,
    rows,
  };
}

async function readSales(
  contact: ContactListItem,
  baseCurrency: string,
  dateWhere: { gte?: Date; lt?: Date } | undefined
): Promise<ContactSales> {
  const sales = await prisma.sale.findMany({
    where: {
      collectionId: contact.collectionId,
      buyerId: contact.id,
      ...(dateWhere ? { soldAt: dateWhere } : {}),
    },
    orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      saleNo: true,
      soldAt: true,
      status: true,
      currency: true,
      fxRateToBase: true,
      buyerHandling: true,
      buyerPaidTotal: true,
      platform: { select: { name: true } },
      lines: { select: { price: true, _count: { select: { items: true } } } },
    },
  });

  const rows: ContactSaleRow[] = sales.map((s) => {
    const gross = s.lines.reduce((sum, l) => sum + Number(l.price), 0);
    const { handling } = resolveBuyerHandling(s.buyerHandling, s.buyerPaidTotal, gross);
    return {
      id: s.id,
      saleNo: s.saleNo,
      soldAt: isoDate(s.soldAt),
      status: s.status,
      platformName: s.platform.name,
      currency: s.currency,
      paid: (Math.round((gross + handling) * 100) / 100).toFixed(2),
      copyCount: s.lines.reduce((sum, l) => sum + l._count.items, 0),
    };
  });
  const revenue = sumMoney(
    sales.map((s, i) => {
      const amount = Number(rows[i].paid);
      return {
        amount,
        currency: s.currency,
        base: toBaseAmount(
          amount,
          s.currency,
          baseCurrency,
          s.fxRateToBase == null ? null : Number(s.fxRateToBase)
        ),
      };
    }),
    baseCurrency
  );

  return {
    count: sales.length,
    revenue,
    copyCount: rows.reduce((sum, r) => sum + r.copyCount, 0),
    lastSoldAt: rows[0]?.soldAt ?? null,
    lastSaleId: rows[0]?.id ?? null,
    unpaidCount: sales.filter((s) => (UNPAID_SALE_STATUSES as readonly string[]).includes(s.status))
      .length,
    unsentCount: sales.filter((s) => (UNSENT_SALE_STATUSES as readonly string[]).includes(s.status))
      .length,
    rows,
  };
}

/**
 * The contact's auctions: the auction sales it is the **seller** on — the house of a house's own
 * sale, the seller of a marketplace basket (ADR-0021). The platform side of a sale is #1710's.
 *
 * **A sale belongs to the period it was tracked in** (`createdAt`), and every lot of it with it: a
 * sale is one settlement, so its rows and the figures above them sum to each other, and a sale has
 * no date of its own to read instead — `endsAt` is only a default for its lots (schema).
 */
async function readAuctions(
  ownerId: string,
  contact: ContactListItem,
  baseCurrency: string,
  dateWhere: { gte?: Date; lt?: Date } | undefined
): Promise<ContactAuctions> {
  const sales = await prisma.auctionSale.findMany({
    where: {
      collectionId: contact.collectionId,
      sellerId: contact.id,
      ...(dateWhere ? { createdAt: dateWhere } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      currency: true,
      premiumPercent: true,
      premiumFixed: true,
      shippingCost: true,
      createdAt: true,
      platform: { select: { name: true } },
      lots: {
        select: { status: true, myBid: true, finalPrice: true, wonTie: true, fxRateToBase: true },
      },
    },
  });

  // The watchlist as it stands, over the lots list's own reads under the filters its link opens.
  const sellerOnly = { sellerId: contact.id };
  const [openCount, exposure, toReviewCount] = await Promise.all([
    countAuctionLots(ownerId, contact.collectionId, { ...sellerOnly, outcome: "pending" }),
    auctionLotExposure(ownerId, contact.collectionId, { ...sellerOnly, outcome: "pending" }),
    countAuctionLots(ownerId, contact.collectionId, { ...sellerOnly, includeClosed: true, toReview: true }),
  ]);

  let lotCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  let cancelledCount = 0;
  const spent: MoneyEntry[] = [];
  const premiumTerms: string[] = [];
  const rows: ContactAuctionSaleRow[] = sales.map((s) => {
    const premium = auctionPremiumTerms(
      s.premiumPercent?.toString() ?? null,
      s.premiumFixed?.toString() ?? null,
      s.currency
    );
    if (!premiumTerms.includes(premium)) premiumTerms.push(premium);
    const counts = { pending: 0, won: 0, lost: 0, observed: 0, cancelled: 0 };
    const won: { finalPrice: number; fxRateToBase: number | null }[] = [];
    for (const lot of s.lots) {
      const outcome = lotOutcome({
        status: (isAuctionLotStatus(lot.status) ? lot.status : "open") as AuctionLotStatus,
        myBid: lot.myBid?.toString(),
        finalPrice: lot.finalPrice?.toString(),
        wonTie: lot.wonTie,
      });
      counts[outcome] += 1;
      // A won lot always carries its price: that is what made it won.
      if (outcome === "won" && lot.finalPrice) {
        won.push({
          finalPrice: Number(lot.finalPrice),
          fxRateToBase: lot.fxRateToBase == null ? null : Number(lot.fxRateToBase),
        });
      }
    }
    lotCount += s.lots.length;
    wonCount += counts.won;
    lostCount += counts.lost;
    cancelledCount += counts.cancelled;
    const entry = auctionWonSpend(
      won,
      {
        premiumPercent: s.premiumPercent == null ? null : Number(s.premiumPercent),
        premiumFixed: s.premiumFixed == null ? null : Number(s.premiumFixed),
        shippingCost: s.shippingCost == null ? null : Number(s.shippingCost),
      },
      s.currency,
      baseCurrency
    );
    if (entry) spent.push(entry);
    return {
      id: s.id,
      name: s.name,
      trackedAt: isoDate(s.createdAt),
      status: isAuctionSaleStatus(s.status) ? s.status : "open",
      platformName: s.platform.name,
      openCount: counts.pending,
      wonCount: counts.won,
      lostCount: counts.lost,
    };
  });

  return {
    saleCount: sales.length,
    lotCount,
    wonCount,
    lostCount,
    cancelledCount,
    winRate: auctionWinRate(wonCount, lostCount),
    spent: sumMoney(spent, baseCurrency),
    premiumTerms,
    openCount,
    exposure,
    toReviewCount,
    rows,
  };
}
