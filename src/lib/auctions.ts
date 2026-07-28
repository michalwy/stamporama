import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  allIn,
  bidStanding,
  lotHasSignal,
  maxBidWithin,
  summarizeAuctionSale,
  LOT_SIGNALS,
  type AuctionSaleSummary,
  type LotSignal,
} from "./auction-lot";
import {
  deriveAuctionSaleName,
  isAuctionLotStatus,
  isAuctionSaleStatus,
  type AuctionLotStatus,
  type AuctionSaleStatus,
} from "./auction-rules";

// Server-side domain logic for **auction tracking** (ADR-0021, #350–#352): a bidding watchlist with
// a fork at the end. `AuctionSale` ⊃ `AuctionLot` ⊃ `AuctionLotLine`, where the sale is one
// settlement with one seller — what ships in one parcel — and the lot carries the outcome.
//
// This module owns: the flat lot list that is the primary screen (§9) with its faceted counts, the
// sale list + sale detail read models, lot and sale create / edit / delete, the manual bid refresh
// that stamps `checkedAt`, and the **open-sale matching** that lets a lot be added by naming seller
// and platform rather than by picking a sale (#352). The pure vocabulary lives in `auction-rules.ts`
// and the arithmetic in `auction-lot.ts`; neither imports Prisma. All access is owner-scoped.
//
// Two things this module deliberately does not do: composition (`AuctionLotLine`, #353) and
// settlement into a `Purchase` (#28). Both have their own issues, and both read the tables written
// here without changing them.

// ── Errors ──────────────────────────────────────────────────────────────────

export type AuctionBlockReason =
  | "no-seller"
  | "no-platform"
  | "no-sale"
  | "bad-sale"
  | "settled"
  | "has-lots";

/** Raised when an auction action is refused by a domain guard. `message` is user-facing; the server
 * action maps it to an `{ status: "error" }` response. */
export class AuctionActionBlockedError extends Error {
  readonly reason: AuctionBlockReason;
  constructor(reason: AuctionBlockReason, message: string) {
    super(message);
    this.name = "AuctionActionBlockedError";
    this.reason = reason;
  }
}

// ── Ownership helpers ───────────────────────────────────────────────────────

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** Resolve a sale the owner may act on, returning what every mutation guard needs. */
async function assertSaleOwner(
  ownerId: string,
  saleId: string
): Promise<{ id: string; collectionId: string; status: string; purchaseId: string | null }> {
  const sale = await prisma.auctionSale.findFirst({
    where: { id: saleId, collection: { ownerId } },
    select: { id: true, collectionId: true, status: true, purchaseId: true },
  });
  if (!sale) throw new Error("Auction sale not found");
  return sale;
}

/** Resolve a lot the owner may act on, along with its sale. */
async function assertLotOwner(
  ownerId: string,
  lotId: string
): Promise<{ id: string; auctionSaleId: string; collectionId: string; purchaseLotId: string | null }> {
  const lot = await prisma.auctionLot.findFirst({
    where: { id: lotId, auctionSale: { collection: { ownerId } } },
    select: {
      id: true,
      auctionSaleId: true,
      purchaseLotId: true,
      auctionSale: { select: { collectionId: true } },
    },
  });
  if (!lot) throw new Error("Auction lot not found");
  return {
    id: lot.id,
    auctionSaleId: lot.auctionSaleId,
    collectionId: lot.auctionSale.collectionId,
    purchaseLotId: lot.purchaseLotId,
  };
}

/** A lot already transcribed into a purchase (#28) is history: the purchase lot carries the price
 * that was actually paid, and rewriting the bid here would leave the two disagreeing. */
function assertLotEditable(lot: { purchaseLotId: string | null }): void {
  if (lot.purchaseLotId) {
    throw new AuctionActionBlockedError(
      "settled",
      "This lot has been settled into a purchase. Edit the purchase instead, or undo the settlement first."
    );
  }
}

/** Verify a contact belongs to the collection before it is written onto a sale. Both FKs are
 * `Restrict`, so a cross-collection id would otherwise be caught only by the database. */
async function assertContact(collectionId: string, contactId: string, role: "seller" | "platform"): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, collectionId },
    select: { id: true },
  });
  if (contact) return;
  throw new AuctionActionBlockedError(
    role === "seller" ? "no-seller" : "no-platform",
    role === "seller" ? "Pick the seller this lot is being bought from." : "Pick the platform this lot is listed on."
  );
}

// ── Read models ─────────────────────────────────────────────────────────────

function money(value: Prisma.Decimal | null): string | null {
  return value == null ? null : value.toFixed(2);
}

/** One lot as the flat list renders it. Money is in the **sale's** currency throughout — a lot has
 * no currency of its own, because a settlement does. */
export interface AuctionLotListItem {
  id: string;
  saleId: string;
  saleName: string;
  saleStatus: AuctionSaleStatus;
  sellerId: string;
  sellerName: string;
  platformId: string;
  platformName: string;
  currency: string;
  lotNo: string | null;
  url: string | null;
  title: string | null;
  endsAt: Date;
  /** What the lot opened at, when the listing states one. A record only — it is never costed as a
   * bid, because a lot nobody has bid on costs nothing whatever it opens at. */
  startingPrice: string | null;
  currentBid: string | null;
  checkedAt: Date | null;
  /** What the collector has placed at the platform — a commitment, not an observation. */
  myBid: string | null;
  maxBid: string | null;
  finalPrice: string | null;
  status: AuctionLotStatus;
  notes: string | null;
  /**
   * What the costed figure (`finalPrice` when the lot closed, else `currentBid`) actually costs
   * once the seller's premium is added — **without shipping**. Shipping belongs to the parcel, not
   * the lot: adding it to every row would charge it once per lot the moment two lots are open with
   * the same seller. The sale's own total adds it once ({@link AuctionSaleListItem.summary}).
   */
  allIn: string | null;
  /** Where the collector stands: `leading` while their placed bid still covers the price, `outbid`
   * once it does not, null when either figure is missing. **Derived on every read**, never stored —
   * a flag would be wrong the moment the price moved. */
  standing: "leading" | "outbid" | null;
  /** The highest hammer price whose all-in cost still fits inside the ceiling — what a bid should
   * actually be placed at, since the ceiling is an all-in figure and a bid box is not. Null without
   * a ceiling, or when the fees alone already exceed it. */
  bidRoom: string | null;
  /** Whether {@link allIn} has passed the collector's ceiling. Null when either is unrecorded — the
   * ceiling is set against the all-in cost, so comparing it to the hammer price would under-report
   * (ADR-0021 §6). */
  overCeiling: boolean | null;
  /** What the bid the collector placed would cost all-in — the figure their ceiling is actually
   * about. Same rule as {@link allIn}: premium only, shipping belongs to the parcel. */
  myAllIn: string | null;
  /** The same comparison for the bid the collector **placed**: whether what they committed would,
   * all-in, cost more than the lot is worth to them. A different fact from {@link overCeiling} — the
   * price running past the ceiling is the market's doing, this one is theirs, and only this one can
   * be taken back. Null when either figure is unrecorded. */
  myBidOverCeiling: boolean | null;
  /** Composition lines entered so far (#353). Zero is the normal state while bidding. */
  lineCount: number;
  /** Whether the lot has been transcribed into a purchase (#28) — it is then read-only here. */
  settled: boolean;
  createdAt: Date;
}

const LOT_SELECT = {
  id: true,
  lotNo: true,
  url: true,
  title: true,
  endsAt: true,
  startingPrice: true,
  currentBid: true,
  checkedAt: true,
  myBid: true,
  maxBid: true,
  finalPrice: true,
  status: true,
  notes: true,
  purchaseLotId: true,
  createdAt: true,
  auctionSale: {
    select: {
      id: true,
      name: true,
      status: true,
      currency: true,
      premiumPercent: true,
      premiumFixed: true,
      sellerId: true,
      platformId: true,
      seller: { select: { name: true } },
      platform: { select: { name: true } },
    },
  },
  _count: { select: { lines: true } },
} satisfies Prisma.AuctionLotSelect;

type LotRow = Prisma.AuctionLotGetPayload<{ select: typeof LOT_SELECT }>;

function toLotListItem(row: LotRow): AuctionLotListItem {
  const sale = row.auctionSale;
  const status = (isAuctionLotStatus(row.status) ? row.status : "watching") as AuctionLotStatus;
  const costed = row.finalPrice ?? row.currentBid;
  const fees = {
    premiumPercent: money(sale.premiumPercent),
    premiumFixed: money(sale.premiumFixed),
  };
  const allInValue = allIn(money(costed), fees);
  // What the collector's own bid would cost if it took the lot — the figure their ceiling is
  // actually about, and the only one they can still do something about.
  const myAllIn = allIn(money(row.myBid), fees);
  const ceiling = money(row.maxBid);
  return {
    id: row.id,
    saleId: sale.id,
    saleName: sale.name,
    saleStatus: (isAuctionSaleStatus(sale.status) ? sale.status : "open") as AuctionSaleStatus,
    sellerId: sale.sellerId,
    sellerName: sale.seller.name,
    platformId: sale.platformId,
    platformName: sale.platform.name,
    currency: sale.currency,
    lotNo: row.lotNo,
    url: row.url,
    title: row.title,
    endsAt: row.endsAt,
    startingPrice: money(row.startingPrice),
    currentBid: money(row.currentBid),
    checkedAt: row.checkedAt,
    myBid: money(row.myBid),
    maxBid: ceiling,
    finalPrice: money(row.finalPrice),
    status,
    notes: row.notes,
    allIn: allInValue,
    standing: bidStanding(money(row.myBid), money(row.currentBid)),
    // Shipping is left out here for the same reason `allIn` leaves it out of a row: it belongs to
    // the parcel, and a bid is placed on one lot.
    bidRoom: maxBidWithin(ceiling, fees),
    overCeiling: allInValue !== null && ceiling !== null ? Number(allInValue) > Number(ceiling) : null,
    myAllIn,
    myBidOverCeiling: myAllIn !== null && ceiling !== null ? Number(myAllIn) > Number(ceiling) : null,
    lineCount: row._count.lines,
    settled: row.purchaseLotId !== null,
    createdAt: row.createdAt,
  };
}

/** The closing-time window a list is narrowed to (#351). `ended` is the one that earns its keep: a
 * lot whose moment has gone by is deliberately muted on the list — there is nothing to react to —
 * so this is how the collector goes and finds them to record what happened. */
export type AuctionClosingWindow = "ended" | "today" | "week";

export interface AuctionLotFilters {
  status?: AuctionLotStatus;
  closing?: AuctionClosingWindow;
  /** A **derived** state (`auction-lot.ts`) rather than a stored one — outbid, over ceiling, still
   * biddable. Resolved to ids in memory before the page query, exactly as the offers list resolves
   * its needs-action overlay (ADR-0013 §4): the comparison spans two tables and some arithmetic,
   * which no `where` can express, and a watchlist is small enough to walk. */
  signal?: LotSignal;
  sellerId?: string;
  platformId?: string;
  saleId?: string;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedAuctionLotsResult {
  items: AuctionLotListItem[];
  nextCursor: string | null;
}

/** The lot list's `where`, shared by the list and its faceted counts so the two can never disagree
 * (the `offerListWhere` pattern). `signalIds` is the resolved id list for a derived filter. */
function lotListWhere(
  collectionId: string,
  filters: AuctionLotFilters,
  signalIds?: string[]
): Prisma.AuctionLotWhereInput {
  return {
    ...(signalIds ? { id: { in: signalIds } } : {}),
    auctionSale: {
      collectionId,
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
      ...(filters.platformId ? { platformId: filters.platformId } : {}),
    },
    ...(filters.saleId ? { auctionSaleId: filters.saleId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...closingWhere(filters.closing),
  };
}

/** The rows a signal is computed over: every live lot the rest of the filters admit. Bounded by
 * what one person is currently bidding on, and each row is a handful of numbers. */
const SIGNAL_SELECT = {
  id: true,
  status: true,
  endsAt: true,
  currentBid: true,
  myBid: true,
  maxBid: true,
  auctionSale: { select: { premiumPercent: true, premiumFixed: true } },
} satisfies Prisma.AuctionLotSelect;

/** Which lots carry each signal, under everything else selected. One pass, so the list's own filter
 * and every chip's count come from the same reading of the same rows. */
async function resolveSignals(
  collectionId: string,
  filters: AuctionLotFilters
): Promise<Record<LotSignal, string[]>> {
  const rows = await prisma.auctionLot.findMany({
    // A signal only says something about a lot still being watched, so the candidate set is that.
    where: lotListWhere(collectionId, { ...filters, signal: undefined, status: "watching" }),
    select: SIGNAL_SELECT,
  });
  const now = new Date();
  const out = Object.fromEntries(LOT_SIGNALS.map((s) => [s, [] as string[]])) as Record<
    LotSignal,
    string[]
  >;
  for (const row of rows) {
    const input = {
      status: "watching" as const,
      endsAt: row.endsAt,
      currentBid: money(row.currentBid),
      myBid: money(row.myBid),
      maxBid: money(row.maxBid),
      fees: {
        premiumPercent: money(row.auctionSale.premiumPercent),
        premiumFixed: money(row.auctionSale.premiumFixed),
      },
    };
    for (const signal of LOT_SIGNALS) {
      if (lotHasSignal(signal, input, now)) out[signal].push(row.id);
    }
  }
  return out;
}

/** `endsAt` bounds for a closing window, read against the server's clock. The client cannot supply
 * the boundary: it would then differ between two open tabs and between the list and its counts. */
function closingWhere(window: AuctionClosingWindow | undefined): Prisma.AuctionLotWhereInput {
  if (!window) return {};
  const now = new Date();
  if (window === "ended") return { endsAt: { lt: now } };
  const days = window === "today" ? 1 : 7;
  return { endsAt: { gte: now, lte: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) } };
}

/**
 * Order for a given status selection, and the one place the list's reading order is decided.
 *
 * A watchlist is scanned by **closing time**, so live lots come soonest-first: that is the daily
 * job, and the lot at the top is the one to look at. A terminal selection is history, so it reads
 * most-recently-closed first. With no status chosen at all the two orders contradict each other —
 * a lot closing in six months would sit above one closing tonight — so the mixed list falls back to
 * newest-tracked first, which is meaningful for both halves.
 */
function lotOrderBy(filters: AuctionLotFilters): Prisma.AuctionLotOrderByWithRelationInput {
  // A window of lots that have already closed is history, whatever their status: most recent first.
  if (filters.closing === "ended") return { endsAt: "desc" };
  // Any other window is entirely in the future, so the soonest is the one to deal with.
  if (filters.closing) return { endsAt: "asc" };
  if (filters.status === "watching") return { endsAt: "asc" };
  if (filters.status) return { endsAt: "desc" };
  return { createdAt: "desc" };
}

/** The flat list of lots across all sales — the primary auction screen (ADR-0021 §9). Offset-
 * paginated for the shared infinite scroll, exactly like the offers list. */
export async function listAuctionLots(
  ownerId: string,
  collectionId: string,
  filters: AuctionLotFilters = {}
): Promise<PaginatedAuctionLotsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  // A derived filter is resolved to ids first and then paginated as an ordinary `where`, so a page
  // never costs more than the lots it shows.
  let signalIds: string[] | undefined;
  if (filters.signal) {
    signalIds = (await resolveSignals(collectionId, filters))[filters.signal];
    if (signalIds.length === 0) return { items: [], nextCursor: null };
  }

  const rows = await prisma.auctionLot.findMany({
    where: lotListWhere(collectionId, filters, signalIds),
    orderBy: lotOrderBy(filters),
    take: pageSize + 1,
    skip: offset,
    select: LOT_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: page.map(toLotListItem),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

export interface AuctionLotFilterCounts {
  /** Lots per status, under the selected seller / platform. Statuses with none are absent. */
  statuses: Partial<Record<AuctionLotStatus, number>>;
  /** Lots per seller, under the selected status / platform. */
  sellers: Record<string, number>;
  /** Lots per platform, under the selected status / seller. */
  platforms: Record<string, number>;
  /** Lots carrying each derived signal, under everything else selected. */
  signals: Record<LotSignal, number>;
  /** Lots per closing window, under everything else selected. Each is counted on its own, so the
   * three overlap not at all (`ended` is in the past) or fully (`today` ⊂ `week`). */
  closing: Record<AuctionClosingWindow, number>;
  /** Total under the selected status + seller + platform — what "All" would show. */
  total: number;
}

/**
 * Faceted counts for the lot list's filter controls (#332), computed the same way the offers ones
 * are: every control's count ignores its own dimension and respects the others, so a badge says how
 * many lots clicking it would show rather than how many are on screen now.
 */
export async function auctionLotFilterCounts(
  ownerId: string,
  collectionId: string,
  filters: Omit<AuctionLotFilters, "offset" | "pageSize"> = {}
): Promise<AuctionLotFilterCounts> {
  await assertCollectionOwner(ownerId, collectionId);

  const { status, sellerId, platformId, closing, signal, ...rest } = filters;
  const [byStatus, bySeller, byPlatform, closingCounts, signalIds, total] = await Promise.all([
    prisma.auctionLot.groupBy({
      by: ["status"],
      where: lotListWhere(collectionId, { ...rest, sellerId, platformId, closing }),
      _count: { _all: true },
    }),
    // Seller and platform live on the sale, so their facets group over sales and are folded back
    // onto the lots by sale id — `groupBy` cannot reach through a relation.
    lotCountsBySale(collectionId, { ...rest, status, platformId, closing }),
    lotCountsBySale(collectionId, { ...rest, status, sellerId, closing }),
    // Each window counted with the *other* dimensions applied but its own ignored, like the rest.
    Promise.all(
      (["ended", "today", "week"] as const).map((w) =>
        prisma.auctionLot.count({
          where: lotListWhere(collectionId, { ...rest, status, sellerId, platformId, closing: w }),
        })
      )
    ),
    // The signal facet ignores the selected signal, like every other facet ignores its own.
    resolveSignals(collectionId, { ...rest, status, sellerId, platformId, closing }),
    (async () =>
      prisma.auctionLot.count({
        where: lotListWhere(
          collectionId,
          filters,
          signal
            ? (await resolveSignals(collectionId, { ...rest, status, sellerId, platformId, closing }))[
                signal
              ]
            : undefined
        ),
      }))(),
  ]);

  const statuses: Partial<Record<AuctionLotStatus, number>> = {};
  for (const row of byStatus) {
    if (isAuctionLotStatus(row.status)) statuses[row.status] = row._count._all;
  }

  return {
    statuses,
    sellers: foldByParty(bySeller, "sellerId"),
    platforms: foldByParty(byPlatform, "platformId"),
    closing: { ended: closingCounts[0], today: closingCounts[1], week: closingCounts[2] },
    signals: Object.fromEntries(
      LOT_SIGNALS.map((s) => [s, signalIds[s].length])
    ) as Record<LotSignal, number>,
    total,
  };
}

/** Lot counts grouped by sale, carrying the sale's two parties — the raw material for the seller
 * and platform facets. */
async function lotCountsBySale(
  collectionId: string,
  filters: Omit<AuctionLotFilters, "offset" | "pageSize">
): Promise<{ sellerId: string; platformId: string; count: number }[]> {
  const grouped = await prisma.auctionLot.groupBy({
    by: ["auctionSaleId"],
    where: lotListWhere(collectionId, filters),
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const sales = await prisma.auctionSale.findMany({
    where: { id: { in: grouped.map((g) => g.auctionSaleId) } },
    select: { id: true, sellerId: true, platformId: true },
  });
  const byId = new Map(sales.map((s) => [s.id, s]));
  return grouped.flatMap((g) => {
    const sale = byId.get(g.auctionSaleId);
    return sale ? [{ sellerId: sale.sellerId, platformId: sale.platformId, count: g._count._all }] : [];
  });
}

function foldByParty(
  rows: { sellerId: string; platformId: string; count: number }[],
  key: "sellerId" | "platformId"
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row[key]] = (out[row[key]] ?? 0) + row.count;
  return out;
}

/** The sellers and platforms that currently carry at least one auction sale, for the list filters.
 * Both come off the sales rather than the contacts table: a contact who has never been bid with
 * would only be noise in a filter that can never narrow anything. */
export async function listAuctionParties(
  ownerId: string,
  collectionId: string
): Promise<{ sellers: { id: string; name: string }[]; platforms: { id: string; name: string }[] }> {
  await assertCollectionOwner(ownerId, collectionId);
  const sales = await prisma.auctionSale.findMany({
    where: { collectionId },
    select: {
      seller: { select: { id: true, name: true } },
      platform: { select: { id: true, name: true } },
    },
  });
  const sellers = new Map<string, string>();
  const platforms = new Map<string, string>();
  for (const sale of sales) {
    sellers.set(sale.seller.id, sale.seller.name);
    platforms.set(sale.platform.id, sale.platform.name);
  }
  const sort = (m: Map<string, string>) =>
    [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return { sellers: sort(sellers), platforms: sort(platforms) };
}

/** One sale as the settlement list and the detail header render it. */
export interface AuctionSaleListItem {
  id: string;
  name: string;
  url: string | null;
  status: AuctionSaleStatus;
  sellerId: string;
  sellerName: string;
  platformId: string;
  platformName: string;
  currency: string;
  endsAt: Date | null;
  shippingCost: string | null;
  premiumPercent: string | null;
  premiumFixed: string | null;
  /** The purchase this sale settled into (#28), or null while it is still being bid. */
  purchaseId: string | null;
  /** Parcel totals over the payable (`watching` + `won`) lots, shipping added once. */
  summary: AuctionSaleSummary;
  createdAt: Date;
}

const SALE_SELECT = {
  id: true,
  name: true,
  url: true,
  status: true,
  currency: true,
  endsAt: true,
  shippingCost: true,
  premiumPercent: true,
  premiumFixed: true,
  purchaseId: true,
  createdAt: true,
  sellerId: true,
  platformId: true,
  seller: { select: { name: true } },
  platform: { select: { name: true } },
  lots: { select: { status: true, currentBid: true, finalPrice: true } },
} satisfies Prisma.AuctionSaleSelect;

type SaleRow = Prisma.AuctionSaleGetPayload<{ select: typeof SALE_SELECT }>;

function toSaleListItem(row: SaleRow): AuctionSaleListItem {
  const fees = {
    premiumPercent: money(row.premiumPercent),
    premiumFixed: money(row.premiumFixed),
    shippingCost: money(row.shippingCost),
  };
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    status: (isAuctionSaleStatus(row.status) ? row.status : "open") as AuctionSaleStatus,
    sellerId: row.sellerId,
    sellerName: row.seller.name,
    platformId: row.platformId,
    platformName: row.platform.name,
    currency: row.currency,
    endsAt: row.endsAt,
    shippingCost: fees.shippingCost,
    premiumPercent: fees.premiumPercent,
    premiumFixed: fees.premiumFixed,
    purchaseId: row.purchaseId,
    summary: summarizeAuctionSale(
      row.lots.map((lot) => ({
        status: (isAuctionLotStatus(lot.status) ? lot.status : "watching") as AuctionLotStatus,
        currentBid: money(lot.currentBid),
        finalPrice: money(lot.finalPrice),
        // Catalogue value comes with composition (#353); until then every lot counts as unvalued,
        // which the summary already reports rather than hiding.
        catalogValue: null,
      })),
      fees
    ),
    createdAt: row.createdAt,
  };
}

/** Every sale, newest first, each with its parcel totals — the settlement list. Unpaginated: a sale
 * is one parcel from one seller, so there are as many as there have been settlements, and the
 * screen exists to answer "what do I owe whom", which a page boundary would cut in half. */
export async function listAuctionSales(
  ownerId: string,
  collectionId: string,
  filters: { status?: AuctionSaleStatus } = {}
): Promise<AuctionSaleListItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.auctionSale.findMany({
    where: { collectionId, ...(filters.status ? { status: filters.status } : {}) },
    orderBy: { createdAt: "desc" },
    select: SALE_SELECT,
  });
  return rows.map(toSaleListItem);
}

export interface AuctionSaleDetail extends AuctionSaleListItem {
  lots: AuctionLotListItem[];
}

/** A sale with its own fields and its lots — the settlement / shipping view. */
export async function getAuctionSaleDetail(
  ownerId: string,
  saleId: string
): Promise<AuctionSaleDetail> {
  await assertSaleOwner(ownerId, saleId);
  const [row, lots] = await Promise.all([
    prisma.auctionSale.findUniqueOrThrow({ where: { id: saleId }, select: SALE_SELECT }),
    prisma.auctionLot.findMany({
      where: { auctionSaleId: saleId },
      // The parcel reads in closing order: what is still running sits at the top of its own sale
      // exactly as it does on the flat list.
      orderBy: { endsAt: "asc" },
      select: LOT_SELECT,
    }),
  ]);
  return { ...toSaleListItem(row), lots: lots.map(toLotListItem) };
}

// ── Open-sale matching (#352) ───────────────────────────────────────────────

/** The open sale proposed for a seller + platform pair, as the add-lot dialog shows it. */
export interface AuctionSaleProposal {
  id: string;
  name: string;
  currency: string;
  endsAt: Date | null;
  lotCount: number;
}

/**
 * The `open` sale for this seller + platform pair, if there is one.
 *
 * This is what lets adding a lot start from seller and platform rather than from a sale (§9): the
 * collector knows who they are bidding with, and the settlement bucket follows. It is **proposed,
 * never applied silently** — winning something from the same seller after their parcel has already
 * shipped has to start a second sale, and only the collector knows that has happened.
 *
 * Newest first when more than one is open, which can only happen because the collector deliberately
 * started a second one.
 */
export async function findOpenAuctionSale(
  ownerId: string,
  collectionId: string,
  sellerId: string,
  platformId: string
): Promise<AuctionSaleProposal | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const sale = await prisma.auctionSale.findFirst({
    where: { collectionId, sellerId, platformId, status: "open" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      currency: true,
      endsAt: true,
      _count: { select: { lots: true } },
    },
  });
  if (!sale) return null;
  return {
    id: sale.id,
    name: sale.name,
    currency: sale.currency,
    endsAt: sale.endsAt,
    lotCount: sale._count.lots,
  };
}

// ── Sale mutations ──────────────────────────────────────────────────────────

/** The sale fields a form submits. Every money value is a normalised 2-dp string or null. */
export interface AuctionSaleInput {
  sellerId: string;
  platformId: string;
  /** Blank falls back to the derived `Seller · Platform`, which is what identifies a marketplace
   * basket; a house sale is named after the house's own sale (`Köhler 385`). */
  name: string | null;
  url: string | null;
  endsAt: Date | null;
  currency: string;
  shippingCost: string | null;
  premiumPercent: string | null;
  premiumFixed: string | null;
  status?: AuctionSaleStatus;
}

export interface AuctionSellerDefaults {
  defaultCurrency: string | null;
  defaultShippingCost: string | null;
  buyerPremiumPercent: string | null;
  buyerPremiumFixed: string | null;
  /** The platform this seller was last tracked on, for pre-filling the pair. Unlike the three above
   * it is **remembered, not configured**: {@link rememberSellerPlatform} writes it. */
  defaultPlatform: { id: string; name: string } | null;
}

/** The seller's defaults, as a new sale seeds them (#308/#319 seeding rule): read once at creation
 * and stored, so a seller raising their premium never re-prices a parcel already tracked. */
export async function getAuctionSellerDefaults(
  ownerId: string,
  collectionId: string,
  sellerId: string
): Promise<AuctionSellerDefaults | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const contact = await prisma.contact.findFirst({
    where: { id: sellerId, collectionId },
    select: {
      defaultCurrency: true,
      defaultShippingCost: true,
      buyerPremiumPercent: true,
      buyerPremiumFixed: true,
      defaultAuctionPlatform: { select: { id: true, name: true } },
    },
  });
  if (!contact) return null;
  return {
    defaultCurrency: contact.defaultCurrency,
    defaultShippingCost: money(contact.defaultShippingCost),
    buyerPremiumPercent: money(contact.buyerPremiumPercent),
    buyerPremiumFixed: money(contact.buyerPremiumFixed),
    defaultPlatform: contact.defaultAuctionPlatform,
  };
}

/**
 * Remember which platform a seller was last tracked on.
 *
 * Written here rather than by the client for the case that matters most: a seller and a platform
 * typed in by name are only contacts once the server has resolved them, so this is the first point
 * where both ids exist. A no-op when the memory already says this, so the common repeat costs
 * nothing.
 *
 * Never fails a create: a lot that was added is added, and a forgotten preference is not a reason
 * to refuse it.
 */
async function rememberSellerPlatform(sellerId: string, platformId: string): Promise<void> {
  try {
    await prisma.contact.updateMany({
      where: {
        id: sellerId,
        // The null branch is not redundant: `<> 'x'` is NULL — not true — for a NULL column, so a
        // seller who has never been tracked would never match the inequality alone.
        OR: [{ defaultAuctionPlatformId: null }, { defaultAuctionPlatformId: { not: platformId } }],
      },
      data: { defaultAuctionPlatformId: platformId },
    });
  } catch {
    // ignore
  }
}

/**
 * Create a sale. Anything the caller leaves unset is seeded from the seller's own defaults
 * (currency, shipping, both premium components) and then belongs to the sale: editing it here never
 * reaches back to the contact, and editing the contact never reaches forward to this sale.
 */
export async function createAuctionSale(
  ownerId: string,
  collectionId: string,
  input: AuctionSaleInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertContact(collectionId, input.sellerId, "seller");
  await assertContact(collectionId, input.platformId, "platform");

  const defaults = await getAuctionSellerDefaults(ownerId, collectionId, input.sellerId);
  const [seller, platform] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: input.sellerId }, select: { name: true } }),
    prisma.contact.findUniqueOrThrow({ where: { id: input.platformId }, select: { name: true } }),
  ]);

  const sale = await prisma.auctionSale.create({
    data: {
      collectionId,
      sellerId: input.sellerId,
      platformId: input.platformId,
      name: input.name ?? deriveAuctionSaleName(seller.name, platform.name),
      url: input.url,
      endsAt: input.endsAt,
      currency: input.currency || defaults?.defaultCurrency || "EUR",
      shippingCost: input.shippingCost ?? defaults?.defaultShippingCost ?? null,
      premiumPercent: input.premiumPercent ?? defaults?.buyerPremiumPercent ?? null,
      premiumFixed: input.premiumFixed ?? defaults?.buyerPremiumFixed ?? null,
      status: input.status ?? "open",
    },
    select: { id: true },
  });
  await rememberSellerPlatform(input.sellerId, input.platformId);
  return sale.id;
}

/** Edit a sale's own fields. The currency and fees stay editable in every status — the terms of a
 * parcel are exactly what one goes back and corrects — but a settled sale is left alone, because
 * its figures have already been transcribed into a purchase. */
export async function updateAuctionSale(
  ownerId: string,
  saleId: string,
  input: AuctionSaleInput
): Promise<void> {
  const sale = await assertSaleOwner(ownerId, saleId);
  if (sale.purchaseId) {
    throw new AuctionActionBlockedError(
      "settled",
      "This sale has been settled into a purchase. Edit the purchase instead."
    );
  }
  await assertContact(sale.collectionId, input.sellerId, "seller");
  await assertContact(sale.collectionId, input.platformId, "platform");
  const [seller, platform] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: input.sellerId }, select: { name: true } }),
    prisma.contact.findUniqueOrThrow({ where: { id: input.platformId }, select: { name: true } }),
  ]);

  await prisma.auctionSale.update({
    where: { id: saleId },
    data: {
      sellerId: input.sellerId,
      platformId: input.platformId,
      name: input.name ?? deriveAuctionSaleName(seller.name, platform.name),
      url: input.url,
      endsAt: input.endsAt,
      // A blank currency is a form that did not offer one, never an instruction to clear it: every
      // amount on the parcel is denominated in it.
      ...(input.currency ? { currency: input.currency } : {}),
      shippingCost: input.shippingCost,
      premiumPercent: input.premiumPercent,
      premiumFixed: input.premiumFixed,
      ...(input.status ? { status: input.status } : {}),
    },
  });
}

/** Set a sale's status. `open → closed` when nothing was won; `settled` is written by #28, not from
 * the UI, but is accepted here so the vocabulary has one gate. */
export async function setAuctionSaleStatus(
  ownerId: string,
  saleId: string,
  status: AuctionSaleStatus
): Promise<void> {
  const sale = await assertSaleOwner(ownerId, saleId);
  if (sale.purchaseId && status !== "settled") {
    throw new AuctionActionBlockedError(
      "settled",
      "This sale has been settled into a purchase and cannot be reopened here."
    );
  }
  await prisma.auctionSale.update({ where: { id: saleId }, data: { status } });
}

/** Delete a sale. Refused while it still holds lots: the FK cascades, so deleting the parcel would
 * silently take the bidding record — including the lost lots that are the price data (§7) — with
 * it. Empty it, or move the lots to another sale, first. */
export async function deleteAuctionSale(ownerId: string, saleId: string): Promise<void> {
  await assertSaleOwner(ownerId, saleId);
  const lotCount = await prisma.auctionLot.count({ where: { auctionSaleId: saleId } });
  if (lotCount > 0) {
    throw new AuctionActionBlockedError(
      "has-lots",
      `This sale still holds ${lotCount} lot${lotCount === 1 ? "" : "s"}. Delete or move them first.`
    );
  }
  await prisma.auctionSale.delete({ where: { id: saleId } });
}

// ── Lot mutations ───────────────────────────────────────────────────────────

/** The lot fields a form submits. */
export interface AuctionLotInput {
  auctionSaleId: string;
  lotNo: string | null;
  url: string | null;
  title: string | null;
  endsAt: Date;
  startingPrice: string | null;
  currentBid: string | null;
  myBid: string | null;
  maxBid: string | null;
  notes: string | null;
}

/** Verify the sale a lot is being written into belongs to this collection, returning its two
 * parties — which is what the seller → platform memory is written from. */
async function assertSaleInCollection(
  collectionId: string,
  saleId: string
): Promise<{ sellerId: string; platformId: string }> {
  const sale = await prisma.auctionSale.findFirst({
    where: { id: saleId, collectionId },
    select: { sellerId: true, platformId: true },
  });
  if (!sale) {
    throw new AuctionActionBlockedError("bad-sale", "That auction sale no longer exists.");
  }
  return sale;
}

/**
 * Add a lot. A recorded bid is an observation, so it stamps `checkedAt` — the field the staleness
 * signal reads — rather than leaving a figure on screen with no age.
 */
export async function createAuctionLot(
  ownerId: string,
  collectionId: string,
  input: AuctionLotInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const parties = await assertSaleInCollection(collectionId, input.auctionSaleId);
  const lot = await prisma.auctionLot.create({
    data: {
      auctionSaleId: input.auctionSaleId,
      lotNo: input.lotNo,
      url: input.url,
      title: input.title,
      endsAt: input.endsAt,
      startingPrice: input.startingPrice,
      currentBid: input.currentBid,
      checkedAt: input.currentBid !== null ? new Date() : null,
      myBid: input.myBid,
      maxBid: input.maxBid,
      notes: input.notes,
    },
    select: { id: true },
  });
  // Adding a lot is what "last used" means — it happens far more often than starting a sale, and
  // it is the moment the collector confirmed this seller is reached through this platform.
  await rememberSellerPlatform(parties.sellerId, parties.platformId);
  return lot.id;
}

/**
 * Edit a lot, including **moving it to another sale** — which is how a lot lands in the right
 * parcel after the fact, when the open sale proposed at creation turned out to be the wrong one.
 *
 * The bid stamps `checkedAt` only when it actually changed: reopening the dialog to fix a title
 * must not make a three-day-old observation look current.
 */
export async function updateAuctionLot(
  ownerId: string,
  lotId: string,
  input: AuctionLotInput
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await assertSaleInCollection(lot.collectionId, input.auctionSaleId);

  const current = await prisma.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    select: { currentBid: true },
  });
  const bidChanged = money(current.currentBid) !== input.currentBid;

  await prisma.auctionLot.update({
    where: { id: lotId },
    data: {
      auctionSaleId: input.auctionSaleId,
      lotNo: input.lotNo,
      url: input.url,
      title: input.title,
      endsAt: input.endsAt,
      startingPrice: input.startingPrice,
      currentBid: input.currentBid,
      ...(bidChanged ? { checkedAt: input.currentBid !== null ? new Date() : null } : {}),
      myBid: input.myBid,
      maxBid: input.maxBid,
      notes: input.notes,
    },
  });
}

/**
 * The inline bid refresh — one field, one click, from the list (#351).
 *
 * Always stamps `checkedAt`, including when the figure is unchanged: "still at 40" is exactly the
 * observation the staleness signal is asking for, and refusing to record it would leave the lot
 * looking neglected for having been checked. Clearing the field clears both, because there is then
 * no observation to date.
 */
export async function setAuctionLotBid(
  ownerId: string,
  lotId: string,
  currentBid: string | null
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await prisma.auctionLot.update({
    where: { id: lotId },
    data: { currentBid, checkedAt: currentBid !== null ? new Date() : null },
  });
}

/** Record that a lot was looked at and the bid had not moved. The same observation
 * {@link setAuctionLotBid} makes, without retyping a figure that has not changed. A lot with no bid
 * recorded at all is left alone — there is nothing to confirm. */
export async function touchAuctionLotChecked(ownerId: string, lotId: string): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  const current = await prisma.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    select: { currentBid: true },
  });
  if (current.currentBid === null) return;
  await prisma.auctionLot.update({ where: { id: lotId }, data: { checkedAt: new Date() } });
}

/**
 * Record the bid the collector has placed at the platform, from the list.
 *
 * Placing a bid is also *seeing* the lot — the price is right there on the screen you place it
 * from — but the price itself is not being reported here, so `checkedAt` is left alone: it dates
 * observations of `currentBid`, and inferring one from a different field would age wrong.
 */
export async function setAuctionLotMyBid(
  ownerId: string,
  lotId: string,
  myBid: string | null
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await prisma.auctionLot.update({ where: { id: lotId }, data: { myBid } });
}

/** Set the collector's ceiling from the list, the same one-click path the bid takes. */
export async function setAuctionLotMaxBid(
  ownerId: string,
  lotId: string,
  maxBid: string | null
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await prisma.auctionLot.update({ where: { id: lotId }, data: { maxBid } });
}

/** Delete a lot. Composition lines cascade with it; a lot already settled is refused, because the
 * purchase lot on the other side would be left pointing at nothing. */
export async function deleteAuctionLot(ownerId: string, lotId: string): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await prisma.auctionLot.delete({ where: { id: lotId } });
}
