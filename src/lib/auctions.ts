import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  allIn,
  bidStanding,
  headroom,
  lotHasSignal,
  maxBidWithin,
  summarizeAuctionSale,
  LOT_SIGNALS,
  type AuctionSaleSummary,
  type LotSignal,
} from "./auction-lot";
import {
  emptyComposition,
  valuateAuctionLotLines,
  type AuctionLotComposition,
  type AuctionLotLineInput,
  type AuctionLotLineItem,
} from "./auction-lines";
import { getOrFetchRate } from "./exchange-rates";
import { allocateItemNumbers } from "./items";
import {
  deriveAuctionLotLabel,
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
// Composition (`AuctionLotLine`, #353) is written here too, but everything about what it is *worth*
// lives in `auction-lines.ts`: the catalogue rules it reuses (unknown-variant rollup, format
// pricing) are the copy valuation's, and this module only hands the figures on. **Settlement** (#28)
// is here too, at the bottom: it is a transcription of these tables into `Purchase`/`PurchaseLot`
// and nothing more, so it borrows the same ownership guards rather than growing a module.

// ── Errors ──────────────────────────────────────────────────────────────────

export type AuctionBlockReason =
  | "no-seller"
  | "no-platform"
  | "no-sale"
  | "no-price"
  | "bad-sale"
  | "bad-line"
  | "settled"
  | "has-lots"
  // Settlement (#28): the parcel's outcome is not fully recorded yet, and nothing was picked to go
  // into it. Distinct because the first is answered on the lots and the second in the dialog.
  | "unresolved"
  | "no-lots";

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
  /**
   * What to call a lot the collector never named, derived from what it holds (#353) — collapsed
   * catalogue numbers and the issue, e.g. `1-12 · Definitives (1950)`.
   *
   * **Derived on every read, never stored.** Unlike an offer's title (#209/#365) this one is never
   * published anywhere: it is read on our own screens only, and a lot is described line by line, so
   * a stored value would freeze on the first stamp and then disagree with the rest. Null until
   * something has been described, which is where every lot starts.
   */
  derivedTitle: string | null;
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
  /**
   * What the lot's composition is worth at catalogue, in the **sale's currency** (#353).
   *
   * Null when nothing has been entered, or when nothing entered carries a price — never `0.00`,
   * which would make the headroom below read as a catastrophic overbid on a lot nobody has priced.
   */
  catalogValue: string | null;
  /** The value leans on a lowest-variant estimate (#238) — *inferred, not recorded*, and rendered
   * with the same `~` + italics vocabulary the issue list uses. */
  catalogUncertain: boolean;
  /** Lines with no catalogue price at their condition × format. Surfaced rather than hidden: a
   * total that silently omits half the lot looks complete. */
  unpricedLineCount: number;
  /** Lines priced in a currency with no rate into the sale's — they exist and cannot be counted. */
  unconvertibleLineCount: number;
  /**
   * `catalogValue − allIn`: what is left over if the lot is taken at the price it stands at.
   *
   * Measured against the all-in cost, never the hammer price — a ceiling set against the hammer
   * price alone systematically overpays on cheap lots, where the premium is a large share of what
   * leaves the bank account. Like {@link allIn} it carries **premium only**: shipping belongs to the
   * parcel and the sale's own total adds it once ({@link AuctionSaleSummary.headroom}).
   */
  headroom: string | null;
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

function toLotListItem(row: LotRow, composition?: AuctionLotComposition): AuctionLotListItem {
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
    derivedTitle: deriveAuctionLotLabel(
      (composition?.lines ?? []).map((line) => ({
        // Prefix-formatted (`Mi·PL 12`): `1-12` alone does not say which catalogue it is 1–12 of,
        // and the collapsing works on it unchanged — the prefix is just a longer numbering family.
        catalogNumbers: line.catalogLabel ? [line.catalogLabel] : [],
        stampName: line.stampName,
        issueId: line.issueId,
        issueName: line.issueName,
        issueYear: line.issueYear,
        quantity: line.quantity,
      }))
    ),
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
    catalogValue: composition?.catalogValue ?? null,
    catalogUncertain: composition?.uncertain ?? false,
    unpricedLineCount: composition?.unpricedLines ?? 0,
    unconvertibleLineCount: composition?.unconvertibleLines ?? 0,
    // Against the same costed figure `allIn` used — the settled price once the lot closed, else the
    // last observed bid — so the two figures on the row are always about the same money.
    headroom: headroom(composition?.catalogValue ?? null, money(costed), fees),
    settled: row.purchaseLotId !== null,
    createdAt: row.createdAt,
  };
}

/**
 * Catalogue values for a whole page of lots in **one** valuation pass (#353).
 *
 * Lots with no composition are left out of the query altogether — that is most of them while a
 * watchlist is being worked — and the rest are valued together, so the format-factor rows and the
 * area tree are loaded once for the page rather than once per row.
 */
async function compositionsFor(
  collectionId: string,
  rows: { id: string; _count: { lines: number } }[]
): Promise<Map<string, AuctionLotComposition>> {
  const withLines = rows.filter((r) => r._count.lines > 0).map((r) => r.id);
  if (withLines.length === 0) return new Map();
  return valuateAuctionLotLines(collectionId, withLines);
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
  const compositions = await compositionsFor(collectionId, page);
  return {
    items: page.map((row) => toLotListItem(row, compositions.get(row.id))),
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
  lots: {
    select: {
      id: true,
      status: true,
      currentBid: true,
      finalPrice: true,
      // What the parcel's catalogue total is summed from (#353); the ids of the lots that have one
      // are what the batched valuation is asked for.
      _count: { select: { lines: true } },
    },
  },
} satisfies Prisma.AuctionSaleSelect;

type SaleRow = Prisma.AuctionSaleGetPayload<{ select: typeof SALE_SELECT }>;

function toSaleListItem(
  row: SaleRow,
  compositions: Map<string, AuctionLotComposition>
): AuctionSaleListItem {
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
        // Already in this sale's currency (#353) — the conversion happens once per sale currency in
        // `auction-lines.ts`, precisely so the parcel's totals never mix two.
        catalogValue: compositions.get(lot.id)?.catalogValue ?? null,
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
  // One valuation pass across every sale on the screen, for the same reason the lot list batches:
  // this list is unpaginated by design, so per-sale valuation would be a pricing run per parcel.
  const compositions = await compositionsFor(
    collectionId,
    rows.flatMap((row) => row.lots)
  );
  return rows.map((row) => toSaleListItem(row, compositions));
}

/**
 * A lot on the **sale's own screen**, where it is drawn as a collapsible card over its composition
 * — the purchase-order and offer detail layout (#121/#165), applied to a parcel.
 *
 * The lines ride along with the lot rather than being fetched per card: a sale is one parcel from
 * one seller, so the whole screen is bounded, and a card-per-request would make expanding the
 * second lot a round trip. The **flat watchlist** deliberately does not carry them — forty lots
 * there would mean forty compositions fetched to draw forty collapsed rows, and the row only needs
 * the total, which `AuctionLotListItem` already has.
 */
export interface AuctionLotDetailItem extends AuctionLotListItem {
  lines: AuctionLotLineItem[];
}

export interface AuctionSaleDetail extends AuctionSaleListItem {
  lots: AuctionLotDetailItem[];
}

/** A sale with its own fields and its lots — the settlement / shipping view. */
export async function getAuctionSaleDetail(
  ownerId: string,
  saleId: string
): Promise<AuctionSaleDetail> {
  const sale = await assertSaleOwner(ownerId, saleId);
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
  // The sale's own lot rows and the detail's are the same lots, so one pass serves both the parcel
  // total and each row's catalogue-value cell.
  const compositions = await compositionsFor(sale.collectionId, lots);
  return {
    ...toSaleListItem(row, compositions),
    lots: lots.map((lot) => ({
      ...toLotListItem(lot, compositions.get(lot.id)),
      lines: compositions.get(lot.id)?.lines ?? [],
    })),
  };
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
  /**
   * The lot's composition, written **with** the lot in one operation (#353).
   *
   * Capturing a listing and saying what is in it is one act, not two: the collector is reading the
   * lot description as they type, and making them save an empty lot and then go find it again to
   * describe it is the shape that leaves compositions unentered. Only on create — growing a lot
   * afterwards happens on the sale's own screen, where the lines are already on display.
   */
  lines?: AuctionLotLineInput[];
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
  const lines = input.lines ?? [];
  // Every line is checked before anything is written, so a lot is never created with half of the
  // composition the collector entered — the nested create below is one statement either way.
  for (const line of lines) await assertLineTargets(collectionId, line);
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
      ...(lines.length > 0
        ? {
            lines: {
              create: lines.map((line) => ({
                stampId: line.stampId,
                conditionId: line.conditionId,
                certificateStatusId: line.certificateStatusId,
                formatId: line.formatId,
                quantity: line.quantity,
              })),
            },
          }
        : {}),
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

// ── Outcome (#354) ──────────────────────────────────────────────────────────

/**
 * What became of a lot that stopped running, as the row's ⋮ menu records it.
 *
 * Two of the four carry a price. `lost` produces the datapoint #24 consumes — a real price against
 * a known composition on a known date — and `won` records what the lot actually cost, which is what
 * settlement (#28) transcribes into a `PurchaseLot` and what makes the parcel's rollup exact rather
 * than an estimate from the last bid anyone happened to see. `cancelled` is a listing withdrawn or
 * ended without a sale and carries nothing; `watching` is the undo.
 *
 * The two prices differ in one way, and only one: a lost lot's is **optional**, a won lot's is
 * **required**. Losing sight of a lot before the result is normal; not knowing what you paid for
 * something you won is not, and #28 cannot price a purchase line without it.
 */
export type AuctionLotOutcome =
  | { status: "lost"; finalPrice: string | null }
  | { status: "won"; finalPrice: string }
  | { status: "cancelled" }
  | { status: "watching" };

/** Whether an outcome carries a price at all — the two that do are the two that cost or earn the
 * collector something, and they are handled identically from there on. */
function outcomeHasPrice(
  outcome: AuctionLotOutcome
): outcome is Extract<AuctionLotOutcome, { finalPrice: string | null }> {
  return outcome.status === "lost" || outcome.status === "won";
}

/**
 * Freeze the base-currency rate for a lot's result (ADR-0009 §4, the rule `Purchase` follows at
 * `purchasedAt`). Best-effort: a lookup that fails with nothing cached stores `null` rather than
 * refusing to record the outcome — the observation is the valuable half, and an unconvertible
 * figure is still a figure in the sale's own currency.
 */
async function freezeLotFxRate(
  collectionId: string,
  currency: string,
  baseCurrency: string
): Promise<Prisma.Decimal | null> {
  if (currency === baseCurrency) return null;
  try {
    const { rate } = await getOrFetchRate(collectionId, currency, baseCurrency);
    return new Prisma.Decimal(rate);
  } catch {
    return null;
  }
}

/**
 * Record what became of a lot — the fork at the end of ADR-0021 §7 (#354).
 *
 * A lost lot's `finalPrice` stays **optional** on purpose. A lot that vanished from view before the
 * collector saw the result simply yields no datapoint; forcing a number would poison the very data
 * the feature exists to produce with a guess. The last bid anyone recorded is not it either — it is
 * a lower bound — so nothing is inferred here.
 *
 * Marking a lot **won** is where settlement starts (#28): that action's input is a sale holding
 * `won` lots, so without this the sale could never reach the state it acts on. It stops at the
 * status and the price, and writes no `Purchase` — the parcel is settled as a whole, once, when the
 * seller has invoiced it, and a per-lot purchase would be exactly the acquisition path ADR-0021 §7
 * refuses to grow.
 *
 * `cancelled` and `watching` clear both the price and its rate: a cancelled listing carries no
 * result, and a lot put back on the watchlist must not keep a figure describing how it ended.
 */
export async function recordAuctionLotOutcome(
  ownerId: string,
  lotId: string,
  outcome: AuctionLotOutcome
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);

  if (!outcomeHasPrice(outcome)) {
    await prisma.auctionLot.update({
      where: { id: lotId },
      data: { status: outcome.status, finalPrice: null, fxRateToBase: null },
    });
    return;
  }

  // A won lot without a price cannot be settled — #28 prices its purchase line from exactly this
  // figure — and unlike a lost one there is nothing to have missed: you paid it.
  if (outcome.status === "won" && outcome.finalPrice === null) {
    throw new AuctionActionBlockedError(
      "no-price",
      "Enter what you paid for this lot — the purchase it settles into is priced from it."
    );
  }

  const row = await prisma.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    select: {
      auctionSale: {
        select: { currency: true, collection: { select: { baseCurrency: true } } },
      },
    },
  });
  // A rate exists to convert a figure. With no price recorded there is nothing to convert, and
  // storing today's rate against an absent observation would only look like data.
  const fxRateToBase =
    outcome.finalPrice === null
      ? null
      : await freezeLotFxRate(
          lot.collectionId,
          row.auctionSale.currency,
          row.auctionSale.collection.baseCurrency
        );

  await prisma.auctionLot.update({
    where: { id: lotId },
    // Re-freezing on a corrected price is intended: the rate travels with the figure it converts.
    data: { status: outcome.status, finalPrice: outcome.finalPrice, fxRateToBase },
  });
}

// ── Composition (#353) ──────────────────────────────────────────────────────

/** The lot's own currency and fees, for costing its composition against what it will cost. */
async function lotCostingContext(
  lotId: string
): Promise<{ currency: string; costed: string | null; fees: { premiumPercent: string | null; premiumFixed: string | null } }> {
  const lot = await prisma.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    select: {
      currentBid: true,
      finalPrice: true,
      auctionSale: { select: { currency: true, premiumPercent: true, premiumFixed: true } },
    },
  });
  return {
    currency: lot.auctionSale.currency,
    costed: money(lot.finalPrice ?? lot.currentBid),
    fees: {
      premiumPercent: money(lot.auctionSale.premiumPercent),
      premiumFixed: money(lot.auctionSale.premiumFixed),
    },
  };
}

/** What one lot is made of, valued — the composition editor's read (#353). Empty rather than absent
 * for a lot nothing has been entered against, which is where every lot starts. */
export async function getAuctionLotComposition(
  ownerId: string,
  lotId: string
): Promise<AuctionLotComposition & { allIn: string | null; headroom: string | null }> {
  const lot = await assertLotOwner(ownerId, lotId);
  const [context, compositions] = await Promise.all([
    lotCostingContext(lotId),
    valuateAuctionLotLines(lot.collectionId, [lotId]),
  ]);
  const composition = compositions.get(lotId) ?? emptyComposition(lotId, context.currency);
  return {
    ...composition,
    // Premium only, shipping excluded — the row's rule, so the dialog and the row it was opened
    // from can never disagree about what the lot costs.
    allIn: allIn(context.costed, context.fees),
    headroom: headroom(composition.catalogValue, context.costed, context.fees),
  };
}

/** Verify the dictionary rows a line points at belong to this collection. Both FKs are `Restrict`,
 * and a stamp from another collection would otherwise be caught only by the database. */
async function assertLineTargets(collectionId: string, input: AuctionLotLineInput): Promise<void> {
  const [stamp, condition, certificate, format] = await Promise.all([
    prisma.stamp.findFirst({ where: { id: input.stampId, collectionId }, select: { id: true } }),
    prisma.stampCondition.findFirst({
      where: { id: input.conditionId, collectionId },
      select: { id: true },
    }),
    input.certificateStatusId
      ? prisma.certificateStatus.findFirst({
          where: { id: input.certificateStatusId, collectionId },
          select: { id: true },
        })
      : Promise.resolve(null),
    input.formatId
      ? prisma.stampFormat.findFirst({
          where: { id: input.formatId, collectionId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!stamp) throw new AuctionActionBlockedError("bad-line", "Pick the stamp this line is about.");
  if (!condition) {
    throw new AuctionActionBlockedError("bad-line", "Pick the condition this line is described in.");
  }
  // Null is "none" and needs no row (ADR-0006 §2 / ADR-0020); a non-null id that resolved to
  // nothing does.
  if (input.certificateStatusId && !certificate) {
    throw new AuctionActionBlockedError("bad-line", "That certificate status no longer exists.");
  }
  if (input.formatId && !format) {
    throw new AuctionActionBlockedError("bad-line", "That format no longer exists.");
  }
}

/**
 * The stamps a line target names: one stamp, or **every required member of a whole issue**.
 *
 * Picking a series is how a lot that says "Michel 1–12, complete" is described without twelve trips
 * through the picker — the same convenience the purchase-order intake offers (#121), resolved the
 * same way, to the members marked *required for completeness*. A lot's composition stays a list of
 * per-stamp lines: the issue is an entry shortcut, never a thing a line points at, because the
 * catalogue value has to be summed per stamp and a lost lot has to be attributable per stamp.
 */
export async function resolveAuctionLineStamps(
  collectionId: string,
  target: { stampId?: string | null; issueId?: string | null }
): Promise<string[]> {
  if (target.issueId) {
    const issue = await prisma.issue.findFirst({
      where: { id: target.issueId, collectionId },
      select: {
        members: { where: { requiredForCompleteness: true }, select: { stampId: true } },
      },
    });
    if (!issue) {
      throw new AuctionActionBlockedError("bad-line", "That issue no longer exists.");
    }
    if (issue.members.length === 0) {
      throw new AuctionActionBlockedError(
        "bad-line",
        "This issue has no stamps marked required for completeness, so there is nothing to add."
      );
    }
    return issue.members.map((m) => m.stampId);
  }
  if (target.stampId) return [target.stampId];
  throw new AuctionActionBlockedError("bad-line", "Pick the stamp this line is about.");
}

/** Add a line to a lot's composition. */
export async function createAuctionLotLine(
  ownerId: string,
  lotId: string,
  input: AuctionLotLineInput
): Promise<string> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await assertLineTargets(lot.collectionId, input);
  const line = await prisma.auctionLotLine.create({
    data: {
      auctionLotId: lotId,
      stampId: input.stampId,
      conditionId: input.conditionId,
      certificateStatusId: input.certificateStatusId,
      formatId: input.formatId,
      quantity: input.quantity,
    },
    select: { id: true },
  });
  return line.id;
}

/** Resolve a line the owner may act on, along with the lot it belongs to. */
async function assertLineOwner(
  ownerId: string,
  lineId: string
): Promise<{ id: string; auctionLotId: string; collectionId: string; purchaseLotId: string | null }> {
  const line = await prisma.auctionLotLine.findFirst({
    where: { id: lineId, auctionLot: { auctionSale: { collection: { ownerId } } } },
    select: {
      id: true,
      auctionLotId: true,
      auctionLot: {
        select: { purchaseLotId: true, auctionSale: { select: { collectionId: true } } },
      },
    },
  });
  if (!line) throw new Error("Composition line not found");
  return {
    id: line.id,
    auctionLotId: line.auctionLotId,
    collectionId: line.auctionLot.auctionSale.collectionId,
    purchaseLotId: line.auctionLot.purchaseLotId,
  };
}

/** Edit a line — its stamp, condition, format or quantity. */
export async function updateAuctionLotLine(
  ownerId: string,
  lineId: string,
  input: AuctionLotLineInput
): Promise<void> {
  const line = await assertLineOwner(ownerId, lineId);
  assertLotEditable(line);
  await assertLineTargets(line.collectionId, input);
  await prisma.auctionLotLine.update({
    where: { id: lineId },
    data: {
      stampId: input.stampId,
      conditionId: input.conditionId,
      certificateStatusId: input.certificateStatusId,
      formatId: input.formatId,
      quantity: input.quantity,
    },
  });
}

/** Remove a line from a lot's composition. */
export async function deleteAuctionLotLine(ownerId: string, lineId: string): Promise<void> {
  const line = await assertLineOwner(ownerId, lineId);
  assertLotEditable(line);
  await prisma.auctionLotLine.delete({ where: { id: lineId } });
}

/** Delete a lot. Composition lines cascade with it; a lot already settled is refused, because the
 * purchase lot on the other side would be left pointing at nothing. */
export async function deleteAuctionLot(ownerId: string, lotId: string): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);
  await prisma.auctionLot.delete({ where: { id: lotId } });
}

// ── Settlement (#28) ────────────────────────────────────────────────────────

/** What the review step submits: the parcel's own figures, and which won lots are in it.
 *
 * Prices arrive from the dialog rather than being recomputed here, because the whole point of the
 * review is that the seller's invoice is the authority — a house that rounds its premium, waives a
 * lot fee, or bills a different postage than it quoted is the normal case, not an error. What is
 * pre-filled is `settlementLinePrice`; what is stored is what the collector confirmed. */
export interface AuctionSettlementInput {
  /** `yyyy-mm-dd`. The moment money was spent, and what the purchase's FX rate is frozen at. */
  purchasedAt: string;
  /** Shipping for the whole parcel, distributed across the lines by ADR-0009 §3. */
  shippingCost: number | null;
  /** The won lots going into this parcel, each at its confirmed line price. */
  lots: { lotId: string; price: number }[];
}

const SETTLEMENT_LOT_SELECT = {
  id: true,
  title: true,
  status: true,
  purchaseLotId: true,
  _count: { select: { lines: true } },
  lines: {
    select: {
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      quantity: true,
    },
  },
} satisfies Prisma.AuctionLotSelect;

/**
 * Settle a sale into a `Purchase` — the 1:1 transcription of ADR-0021 §7.
 *
 * By the time a parcel is settled the grouping work is already done: a sale *is* one settlement with
 * one seller (§1), so there is no "which purchase does this lot go into?" left to ask, and this is
 * transcription rather than a decision. Seller, platform, currency and shipping come off the sale;
 * each `won` lot becomes one `PurchaseLot` priced at hammer + premium; shipping is then distributed
 * across those lines by the existing ADR-0009 §3 mechanism, which is why several auctions won from
 * one seller in one parcel need no special case.
 *
 * The lots' composition is **written as copies**, not proposed: the lines already say
 * `stamp × condition × certificate × format × quantity`, which is exactly what a copy is, and they
 * were entered to decide the bid rather than to be retyped afterwards. The copies land in the
 * purchase's normal intake state — not in the collection, `ordered`, cost pending — so identification
 * is already done and the existing intake runs unchanged from there: sorting, close, cost-basis
 * freeze. A lot with no composition entered yields a priced line and no copies, which is what an
 * un-described lot honestly is.
 *
 * Won lots the collector leaves out stay `won` and unsettled. That is deliberate: the review exists
 * because the invoice is the authority, and a house that ships a lot separately is a fact about the
 * parcel, not an error to refuse.
 *
 * Refused while any lot is still `watching` — the parcel's outcome is not known yet, and the rollup
 * this is transcribed from is still costing those lots as payable.
 */
export async function settleAuctionSale(
  ownerId: string,
  saleId: string,
  input: AuctionSettlementInput
): Promise<{ purchaseId: string }> {
  const owned = await assertSaleOwner(ownerId, saleId);
  if (owned.purchaseId) {
    throw new AuctionActionBlockedError(
      "settled",
      "This sale has already been settled into a purchase."
    );
  }

  const sale = await prisma.auctionSale.findUniqueOrThrow({
    where: { id: saleId },
    select: {
      collectionId: true,
      sellerId: true,
      platformId: true,
      currency: true,
      collection: { select: { baseCurrency: true } },
      lots: { select: SETTLEMENT_LOT_SELECT },
    },
  });

  const watching = sale.lots.filter((lot) => lot.status === "watching").length;
  if (watching > 0) {
    throw new AuctionActionBlockedError(
      "unresolved",
      `${watching} lot${watching === 1 ? " is" : "s are"} still being watched. Record ${watching === 1 ? "its outcome" : "their outcomes"} before settling the parcel.`
    );
  }

  if (input.lots.length === 0) {
    throw new AuctionActionBlockedError(
      "no-lots",
      "Pick at least one won lot to settle. A sale where nothing was won is closed instead."
    );
  }

  const byId = new Map(sale.lots.map((lot) => [lot.id, lot]));
  const selected = input.lots.map((line) => {
    const lot = byId.get(line.lotId);
    if (!lot) throw new AuctionActionBlockedError("bad-sale", "That lot is not in this sale.");
    if (lot.status !== "won" || lot.purchaseLotId) {
      throw new AuctionActionBlockedError(
        "bad-sale",
        "Only won lots that have not been settled yet can go into a purchase."
      );
    }
    if (!Number.isFinite(line.price) || line.price < 0) {
      throw new AuctionActionBlockedError("no-price", "Each lot needs a price of zero or more.");
    }
    return { lot, price: line.price };
  });

  const purchasedAt = new Date(`${input.purchasedAt}T00:00:00.000Z`);
  if (Number.isNaN(purchasedAt.getTime())) throw new Error("Invalid purchase date.");

  // Frozen exactly as a hand-entered purchase freezes it (ADR-0009 §4). The lots' own rates (#354)
  // are dated observations of how each result converted and are not a substitute: a parcel is paid
  // for on one day, whatever days its lots closed on.
  const fxRateToBase = await freezeLotFxRate(
    sale.collectionId,
    sale.currency,
    sale.collection.baseCurrency
  );

  // A lot the collector never named is titled after what it holds — the same derived label the
  // watchlist shows, resolved once here so the purchase line reads the same as the lot did. Stored
  // rather than derived on the purchase side, because from here on the line is a purchase's, and a
  // purchase lot's title is a plain stored string (#121).
  const labels = await lotTitlesFor(
    sale.collectionId,
    selected.map(({ lot }) => lot)
  );

  const copyCount = selected.reduce(
    (n, { lot }) => n + lot.lines.reduce((q, line) => q + Math.max(0, line.quantity), 0),
    0
  );

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        collectionId: sale.collectionId,
        // A sale's seller and platform are already the two contacts a purchase carries (§1), so
        // this is a rename rather than a mapping.
        contactId: sale.sellerId,
        platformId: sale.platformId,
        purchasedAt,
        currency: sale.currency,
        fxRateToBase,
        shippingCost:
          input.shippingCost != null ? new Prisma.Decimal(input.shippingCost.toFixed(2)) : null,
        // The parcel has been paid for, not received — the collector marks it arrived when it lands,
        // exactly as with any other order.
        status: "preparing",
      },
      select: { id: true },
    });

    // One consecutive range for the whole settlement, so a parcel's copies are numbered in the
    // order its lots are listed (#268).
    const itemNos = await allocateItemNumbers(tx, sale.collectionId, copyCount);
    let nextNo = 0;

    for (const { lot, price } of selected) {
      const purchaseLot = await tx.purchaseLot.create({
        data: {
          purchaseId: purchase.id,
          title: lot.title ?? labels.get(lot.id) ?? null,
          price: new Prisma.Decimal(price.toFixed(2)),
          status: "open",
        },
        select: { id: true },
      });

      // A line of quantity N is N copies: a copy is one physical piece, and a multiple is one copy
      // in a format (ADR-0020), which `formatId` carries over unchanged.
      const copies = lot.lines.flatMap((line) =>
        Array.from({ length: Math.max(0, line.quantity) }, () => ({
          collectionId: sale.collectionId,
          itemNo: itemNos[nextNo++],
          stampId: line.stampId,
          conditionId: line.conditionId,
          certificateStatusId: line.certificateStatusId,
          formatId: line.formatId,
          lotId: purchaseLot.id,
          // The intake state a purchased copy starts in: bought, not yet in hand, not a holding
          // until it has been sorted (ADR-0009 §5).
          deliveryState: "ordered",
          inCollection: false,
          forSale: false,
          forTrade: false,
        }))
      );
      if (copies.length > 0) await tx.item.createMany({ data: copies });

      await tx.auctionLot.update({
        where: { id: lot.id },
        data: { purchaseLotId: purchaseLot.id },
      });
    }

    await tx.auctionSale.update({
      where: { id: saleId },
      data: { purchaseId: purchase.id, status: "settled" },
    });

    return { purchaseId: purchase.id };
  });
}

/** Derived names for the lots being settled, for the ones the collector never titled. One valuation
 * pass for the whole parcel, mirroring how the lists build `derivedTitle`. */
async function lotTitlesFor(
  collectionId: string,
  lots: { id: string; title: string | null; _count: { lines: number } }[]
): Promise<Map<string, string>> {
  const needed = lots.filter((lot) => !lot.title && lot._count.lines > 0).map((lot) => lot.id);
  if (needed.length === 0) return new Map();
  const compositions = await valuateAuctionLotLines(collectionId, needed);
  const labels = new Map<string, string>();
  for (const id of needed) {
    const label = deriveAuctionLotLabel(
      (compositions.get(id)?.lines ?? []).map((line) => ({
        catalogNumbers: line.catalogLabel ? [line.catalogLabel] : [],
        stampName: line.stampName,
        issueId: line.issueId,
        issueName: line.issueName,
        issueYear: line.issueYear,
        quantity: line.quantity,
      }))
    );
    if (label) labels.set(id, label);
  }
  return labels;
}
