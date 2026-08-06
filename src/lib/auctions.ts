import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  allIn,
  bidStanding,
  headroom,
  lotHasSignal,
  lotOutcome,
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
import { collidingLotIds, type AtRiskLine } from "./auction-duplicates";
import { offerUrlMatchClauses } from "./platform-offer-url";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { getOrFetchRate, getOrFetchRates } from "./exchange-rates";
import type { BaseCurrency } from "./currencies";
import { allocateEntityNumber, allocateItemNumbers } from "./items";
import { parseEntityNoSearch } from "./quick-jump";
import { resolvePurchaseContact } from "./contacts";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  deriveAuctionLotLabel,
  deriveAuctionSaleName,
  isAuctionLotStatus,
  isAuctionSaleStatus,
  AUCTION_LOT_OUTCOMES,
  type AuctionLotOutcome,
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
  // Closing a lot (§4): it went for exactly the collector's own maximum, so the money alone cannot
  // say whether they won it — bid order did, and only they know it.
  | "tie-unresolved"
  | "bad-sale"
  | "bad-line"
  | "settled"
  | "has-lots"
  // Settlement (#28): the parcel's outcome is not fully recorded yet, and nothing was picked to go
  // into it. Distinct because the first is answered on the lots and the second in the dialog.
  | "unresolved"
  | "no-lots"
  // Capture (#355): no platform of this collection is marked as the marketplace the page came from.
  // Distinct from `no-platform`, which is a lot being written without one — here the collector named
  // nothing and nothing is missing from the page; a setting has simply not been made yet.
  | "no-platform-module";

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

/** The guard every read starts with — and, since #498, the collection's base currency too: every
 * auction screen converts into it, and asking for it separately would be a second round trip for a
 * field the guard already has the row open for. */
async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<{ baseCurrency: string }> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { baseCurrency: true },
  });
  if (!collection) throw new Error("Collection not found");
  return collection;
}

/** Resolve a sale the owner may act on, returning what every mutation guard needs. */
async function assertSaleOwner(
  ownerId: string,
  saleId: string
): Promise<{
  id: string;
  collectionId: string;
  baseCurrency: string;
  status: string;
  purchaseId: string | null;
}> {
  const sale = await prisma.auctionSale.findFirst({
    where: { id: saleId, collection: { ownerId } },
    select: {
      id: true,
      collectionId: true,
      status: true,
      purchaseId: true,
      collection: { select: { baseCurrency: true } },
    },
  });
  if (!sale) throw new Error("Auction sale not found");
  return { ...sale, baseCurrency: sale.collection.baseCurrency };
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
  /** The collection's base currency (#498), so a screen can label what {@link baseRate} converts to. */
  baseCurrency: string;
  /**
   * Rate from the sale's currency into the base one (#498).
   *
   * **One rate for the whole lot**, not a converted figure per amount: every number on a lot — bid,
   * ceiling, all-in, catalogue value, headroom — is in the sale's currency, and the screens compute
   * several of them from the fees as they are typed. A rate converts what is *on screen*; a
   * server-converted field would go stale the moment a bid was edited in place.
   *
   * The lot's **frozen** `fxRateToBase` where it has one — a recorded result keeps the rate of the
   * day it was recorded (ADR-0009 §4), since the whole worth of a lost lot is that it is a *dated*
   * price observation. The live rate otherwise. Null when the sale already trades in the base
   * currency, and null when no rate could be had — nothing here fails for want of a conversion.
   */
  baseRate: number | null;
  /** Ours, per collection (#432) — what the quick-jump box takes after `lot`. Always present. */
  auctionLotNo: number;
  /** The **house's** number for the lot, as typed in or captured. Optional and free to repeat. */
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
  /** Where the lot is in its life, as recorded: `open | closed | cancelled`. */
  status: AuctionLotStatus;
  /** Who bid first, and only meaningful when `finalPrice` equals `myBid`. Carried so the row can
   * offer the tie question back for correction; it decides {@link outcome} in that one case. */
  wonTie: boolean | null;
  /** How the bidding went: `pending | won | lost | observed | cancelled`. **Derived on every read**
   * from `myBid` against `finalPrice` (ADR-0021 §4), never stored — the money is the record, and a
   * status kept in step by hand is a status that can contradict it. */
  outcome: AuctionLotOutcome;
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
  /**
   * The highest hammer price whose all-in cost still fits inside {@link catalogValue} — what
   * *Bid catalogue value* (#371) actually places.
   *
   * The same inverse {@link bidRoom} applies to a ceiling, and for the same reason: catalogue value
   * is an **all-in** figure (it is exactly what {@link headroom} subtracts the all-in cost from),
   * while a platform's bid box takes a hammer price. Bidding the catalogue figure itself would
   * overshoot it by the premium on every lot. Null without a composition value, and null when the
   * fees alone already exceed it.
   */
  catalogBidRoom: string | null;
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
  /**
   * The seller's premium as the sale carries it (ADR-0021 §1) — percentage and flat fee.
   *
   * Shipped on the row because the *Mine* and *Ceiling* columns are edited **from either side**: a
   * figure typed as an all-in cost is converted back into the hammer price that is stored, and one
   * typed as a bid into the all-in valuation that is. That is the same `allIn` / `maxBidWithin`
   * arithmetic this module applies, run over what is on screen — not a second implementation.
   */
  premiumPercent: string | null;
  premiumFixed: string | null;
  /** Whether the lot has been transcribed into a purchase (#28) — it is then read-only here. */
  settled: boolean;
  createdAt: Date;
}

const LOT_SELECT = {
  id: true,
  auctionLotNo: true,
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
  fxRateToBase: true,
  status: true,
  wonTie: true,
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

function toLotListItem(
  row: LotRow,
  baseCurrency: string,
  composition?: AuctionLotComposition
): AuctionLotListItem {
  const sale = row.auctionSale;
  const status = (isAuctionLotStatus(row.status) ? row.status : "open") as AuctionLotStatus;
  const outcome = lotOutcome({
    status,
    myBid: money(row.myBid),
    finalPrice: money(row.finalPrice),
    wonTie: row.wonTie,
  });
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
    baseCurrency,
    // The frozen rate is the lot's own answer and needs no lookup; the live one is filled in by
    // `attachBaseRates`, in one batch per currency for the whole page.
    baseRate: row.fxRateToBase === null ? null : Number(row.fxRateToBase),
    auctionLotNo: row.auctionLotNo,
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
    wonTie: row.wonTie,
    outcome,
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
    // Same inverse, same fees, same omission of shipping as `bidRoom` above — catalogue value is an
    // all-in figure and a bid box is not.
    catalogBidRoom: maxBidWithin(composition?.catalogValue ?? null, fees),
    unpricedLineCount: composition?.unpricedLines ?? 0,
    unconvertibleLineCount: composition?.unconvertibleLines ?? 0,
    // Against the same costed figure `allIn` used — the settled price once the lot closed, else the
    // last observed bid — so the two figures on the row are always about the same money.
    headroom: headroom(composition?.catalogValue ?? null, money(costed), fees),
    premiumPercent: fees.premiumPercent,
    premiumFixed: fees.premiumFixed,
    settled: row.purchaseLotId !== null,
    createdAt: row.createdAt,
  };
}

/**
 * Fill each item's `baseRate` with the live rate from its own currency into the base one (#498).
 *
 * Structural rather than typed to the two list items, because it serves both — a sale and its lots
 * are converted the same way, and the sale detail hands it one array of each.
 *
 * A rate already set is **left alone**: that is a lot's frozen `fxRateToBase`, and a recorded
 * result keeps the rate of its own day. Distinct currencies are fetched in one batch, and a lookup
 * that fails (nothing cached, offline) leaves the rate null rather than breaking the screen — the
 * same best-effort rule the offers list follows (#208).
 */
async function attachBaseRates(
  collectionId: string,
  baseCurrency: string,
  items: { currency: string; baseRate: number | null }[]
): Promise<void> {
  const currencies = [
    ...new Set(items.filter((i) => i.baseRate === null && i.currency !== baseCurrency).map((i) => i.currency)),
  ];
  if (currencies.length === 0) return;
  let rates: Map<string, { rate: number }>;
  try {
    rates = await getOrFetchRates(collectionId, baseCurrency as BaseCurrency, currencies);
  } catch {
    return;
  }
  for (const item of items) {
    if (item.baseRate !== null || item.currency === baseCurrency) continue;
    item.baseRate = rates.get(item.currency)?.rate ?? null;
  }
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
  /** How the bidding went — **derived**, so this is a set of predicates over the money rather than
   * one column (see {@link outcomeWhere}). The list filters by outcome and not by the recorded
   * lifecycle because that is what the collector is looking for: "what did I win", "what did I only
   * watch". `open | closed | cancelled` is bookkeeping and never appears as a chip. */
  outcome?: AuctionLotOutcome;
  /** Include lots that are **done** — won, lost, observed, cancelled (#504). Off by default: the
   * watchlist is a list of things still to do, and a lot that has been resolved is filed, not
   * pending. The offers list hides its closed listings on exactly this rule (#245). Ignored when an
   * explicit `outcome` is chosen — picking "Won" is asking for closed lots. */
  includeClosed?: boolean;
  closing?: AuctionClosingWindow;
  /** A **derived** state (`auction-lot.ts`) rather than a stored one — outbid, over ceiling, still
   * biddable. Resolved to ids in memory before the page query, exactly as the offers list resolves
   * its needs-action overlay (ADR-0013 §4): the comparison spans two tables and some arithmetic,
   * which no `where` can express, and a watchlist is small enough to walk. */
  signal?: LotSignal;
  /** Only lots still waiting to be described (#442) — no composition lines, and not cancelled.
   * Expressible as a `where` (unlike a signal) because it asks nothing of the arithmetic: it is a
   * relation being empty, which is exactly what the badge on the row reads off `lineCount`. */
  undescribed?: boolean;
  /** Only lots holding a stamp another lot **being won** also holds (#369). Derived like a signal
   * and for the same reason — it is a comparison across lots' compositions, which no `where` can
   * express — and hard matches only, so the chip means "on course to buy this twice" rather than
   * "related to something else in the list". */
  duplicate?: boolean;
  /** Free text the list is narrowed to (#484): the lot's title, its notes, the house's lot number or
   * its URL, the lot's own short number, and the sale / seller / platform it belongs to. Composes
   * with every other filter rather than replacing them. */
  search?: string;
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
 * (the `offerListWhere` pattern). `derivedIds` is the resolved id list for the derived filters —
 * already **intersected** by {@link resolveDerivedIds} when more than one is selected. */
function lotListWhere(
  collectionId: string,
  filters: AuctionLotFilters,
  derivedIds?: string[]
): Prisma.AuctionLotWhereInput {
  // Every narrowing goes into one `AND` list rather than onto the object as sibling keys. Several of
  // them touch `status` — the outcome predicates and the undescribed rule both do — and as sibling
  // keys the later one would silently overwrite the earlier instead of narrowing it.
  const and: Prisma.AuctionLotWhereInput[] = [];
  // An explicit outcome wins; otherwise the list is the watchlist and closed lots stay out of it
  // unless the collector opted in (#504). A sale's own lots are exempt — that screen is the
  // settlement of one parcel, where a won lot is the entire point.
  if (filters.outcome) and.push(outcomeWhere(filters.outcome));
  else if (!filters.includeClosed && !filters.saleId) and.push(outcomeWhere("pending"));
  if (filters.undescribed) and.push(UNDESCRIBED_WHERE);
  // Its own `AND` entry rather than a sibling key, for the same reason: the search is an `OR` over
  // several columns, and a second `OR` on the object would replace the outcome's rather than narrow
  // alongside it.
  if (filters.search?.trim()) and.push(lotSearchWhere(filters.search));

  return {
    ...(derivedIds ? { id: { in: derivedIds } } : {}),
    auctionSale: {
      collectionId,
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
      ...(filters.platformId ? { platformId: filters.platformId } : {}),
    },
    ...(filters.saleId ? { auctionSaleId: filters.saleId } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
    ...closingWhere(filters.closing),
  };
}

/**
 * `lotOutcome` restated as a `where` — the same rules the row's chip is drawn from, in SQL.
 *
 * Two implementations of one rule is exactly the kind of thing that drifts, and it is accepted here
 * for a specific reason: the alternative is loading every lot to filter it in memory, which is what
 * a *signal* has to do (the arithmetic spans two tables) and what an outcome pointedly does not —
 * every figure it reads sits on the row. `tests/unit/auction-lot.test.ts` pins the arithmetic and
 * `tests/integration/auction-tracking.test.ts` pins these against it.
 *
 * Comparing `finalPrice` to `myBid` is a **column-to-column** comparison, which is why the field
 * references are here rather than a plain value.
 */
function outcomeWhere(outcome: AuctionLotOutcome): Prisma.AuctionLotWhereInput {
  const mine = prisma.auctionLot.fields.myBid;
  switch (outcome) {
    case "pending":
      return { status: "open" };
    case "cancelled":
      return { status: "cancelled" };
    // No bid was ever placed: the lot was tracked to record what it fetched.
    case "observed":
      return { status: "closed", myBid: null };
    case "won":
      return {
        status: "closed",
        myBid: { not: null },
        finalPrice: { not: null },
        OR: [
          { finalPrice: { lt: mine } },
          // A tie is a win only when the collector said so at closing.
          { finalPrice: { equals: mine }, wonTie: true },
        ],
      };
    case "lost":
      return {
        status: "closed",
        myBid: { not: null },
        OR: [
          // Legacy rows only: bid, and the result was never seen. ADR-0021 §5 files these as lost,
          // and closing can no longer create one.
          { finalPrice: null },
          { finalPrice: { gt: mine } },
          // Includes `wonTie` null, which reads as lost exactly as `lotOutcome` has it.
          { finalPrice: { equals: mine }, NOT: { wonTie: true } },
        ],
      };
  }
}

/**
 * The `where` fragment for the lot list's search box (#484). Case-insensitive substring, over the
 * things a collector knows a lot by:
 *
 * - what it is called — its own `title`, and its `notes`, which is where the description of an
 *   untitled marketplace lot usually ends up;
 * - the **house's** lot number and the listing `url`, which are how a lot is referred to away from
 *   this app (for a captured Allegro listing `lotNo` is the offer id, #355);
 * - **our** short lot number (#432), a bare integer or behind a `#` like every other list that
 *   supports one — matched *in addition to* the text, since `12` is also a perfectly good house
 *   number;
 * - the sale it settles in, and that sale's seller and platform, so "philasearch" or a house's name
 *   narrows the flat list to that parcel without going through the selects.
 *
 * Deliberately **not** the composition: what a lot contains is searched on the copies and stamps
 * lists, and a lot list narrowed by a stamp name would answer a question the row cannot show.
 */
function lotSearchWhere(search: string): Prisma.AuctionLotWhereInput {
  const s = search.trim();
  const text = { contains: s, mode: "insensitive" as const };
  const or: Prisma.AuctionLotWhereInput[] = [
    { title: text },
    { notes: text },
    { lotNo: text },
    { url: text },
    { auctionSale: { name: text } },
    { auctionSale: { seller: { name: text } } },
    { auctionSale: { platform: { name: text } } },
  ];
  const auctionLotNo = parseEntityNoSearch(s);
  if (auctionLotNo !== null) or.push({ auctionLotNo });
  return { OR: or };
}

/** The stored side of `lotNeedsComposition` (#442), kept beside the `where` it is spliced into so
 * the filter and the row's badge state one rule twice rather than two rules once. */
const UNDESCRIBED_WHERE: Prisma.AuctionLotWhereInput = {
  lines: { none: {} },
  status: { not: "cancelled" },
};

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
    // A signal only says something about a lot still in play, so the candidate set is that.
    where: lotListWhere(collectionId, { ...filters, signal: undefined, outcome: "pending" }),
    select: SIGNAL_SELECT,
  });
  const now = new Date();
  const out = Object.fromEntries(LOT_SIGNALS.map((s) => [s, [] as string[]])) as Record<
    LotSignal,
    string[]
  >;
  for (const row of rows) {
    const input = {
      status: "open" as const,
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

/**
 * Every selected **derived** filter resolved to one id list, or undefined when none is selected.
 *
 * Two of them exist now — the signal and the duplicate chip (#369) — and both have to be walked in
 * memory rather than expressed as a `where`. Selecting both means *both*, so the lists are
 * intersected here: as two separate `id: { in: … }` keys they would overwrite each other and the
 * page would quietly answer the wrong question.
 *
 * An empty array is a real answer — "nothing matches" — and is kept distinct from undefined, which
 * is "this was not asked".
 */
async function resolveDerivedIds(
  collectionId: string,
  filters: AuctionLotFilters
): Promise<string[] | undefined> {
  const lists = await Promise.all([
    filters.signal
      ? resolveSignals(collectionId, filters).then((bySignal) => bySignal[filters.signal!])
      : null,
    filters.duplicate ? atRiskLotLines(collectionId).then(collidingLotIds) : null,
  ]);
  const selected = lists.filter((l): l is string[] => l !== null);
  if (selected.length === 0) return undefined;
  return selected.reduce((a, b) => {
    const keep = new Set(b);
    return a.filter((id) => keep.has(id));
  });
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
 * Order for a given outcome selection, and the one place the list's reading order is decided.
 *
 * A watchlist is scanned by **closing time**, so lots still in play come soonest-first: that is the
 * daily job, and the lot at the top is the one to look at. A finished selection is history, so it
 * reads most-recently-closed first. With no outcome chosen at all the two orders contradict each
 * other — a lot closing in six months would sit above one closing tonight — so the mixed list falls
 * back to newest-tracked first, which is meaningful for both halves.
 *
 * Since #504 the default selection is no longer mixed: with nothing chosen the list holds open lots
 * alone, so it reads as the watchlist it is. Only "Show closed" brings the mixed case back.
 */
function lotOrderBy(filters: AuctionLotFilters): Prisma.AuctionLotOrderByWithRelationInput {
  // A window of lots that have already closed is history, whatever became of them: most recent first.
  if (filters.closing === "ended") return { endsAt: "desc" };
  // Any other window is entirely in the future, so the soonest is the one to deal with.
  if (filters.closing) return { endsAt: "asc" };
  if (filters.outcome === "pending") return { endsAt: "asc" };
  if (filters.outcome) return { endsAt: "desc" };
  if (!filters.includeClosed && !filters.saleId) return { endsAt: "asc" };
  return { createdAt: "desc" };
}

/** The flat list of lots across all sales — the primary auction screen (ADR-0021 §9). Offset-
 * paginated for the shared infinite scroll, exactly like the offers list. */
export async function listAuctionLots(
  ownerId: string,
  collectionId: string,
  filters: AuctionLotFilters = {}
): Promise<PaginatedAuctionLotsResult> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  // A derived filter is resolved to ids first and then paginated as an ordinary `where`, so a page
  // never costs more than the lots it shows.
  const derivedIds = await resolveDerivedIds(collectionId, filters);
  if (derivedIds?.length === 0) return { items: [], nextCursor: null };

  const rows = await prisma.auctionLot.findMany({
    where: lotListWhere(collectionId, filters, derivedIds),
    orderBy: lotOrderBy(filters),
    take: pageSize + 1,
    skip: offset,
    select: LOT_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const compositions = await compositionsFor(collectionId, page);
  const items = page.map((row) => toLotListItem(row, baseCurrency, compositions.get(row.id)));
  await attachBaseRates(collectionId, baseCurrency, items);
  return {
    items,
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/**
 * How many lots a filter combination admits, without paginating them (#367).
 *
 * Over the same `lotListWhere` the list itself uses, so the notification centre's badge and the
 * screen it links to can never disagree about what "closing today" means — the window's boundary is
 * read from the server's clock in one place ({@link closingWhere}) and this is a second caller of
 * it, not a second copy. Deliberately not {@link auctionLotFilterCounts}, which resolves every
 * facet and every derived signal to answer a question about one of them.
 */
export async function countAuctionLots(
  ownerId: string,
  collectionId: string,
  filters: Omit<AuctionLotFilters, "offset" | "pageSize" | "signal"> = {}
): Promise<number> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.auctionLot.count({
    where: lotListWhere(collectionId, filters, await resolveDerivedIds(collectionId, filters)),
  });
}

export interface AuctionLotFilterCounts {
  /** Lots per derived outcome, under the selected seller / platform. Outcomes with none are absent. */
  outcomes: Partial<Record<AuctionLotOutcome, number>>;
  /** Lots per seller, under the selected outcome / platform. */
  sellers: Record<string, number>;
  /** Lots per platform, under the selected outcome / seller. */
  platforms: Record<string, number>;
  /** Lots carrying each derived signal, under everything else selected. */
  signals: Record<LotSignal, number>;
  /** Lots per closing window, under everything else selected. Each is counted on its own, so the
   * three overlap not at all (`ended` is in the past) or fully (`today` ⊂ `week`). */
  closing: Record<AuctionClosingWindow, number>;
  /** Lots with nothing described yet (#442), under everything else selected. */
  undescribed: number;
  /** Lots holding a stamp another lot being won also holds (#369), under everything else selected. */
  duplicate: number;
  /** Total under the selected outcome + seller + platform — what "All" would show. */
  total: number;
}

/**
 * The filters with the **derived** ones dropped — the signal and the duplicate chip.
 *
 * Neither is expressible in the `where` the facets are counted with, so rather than half-applying
 * them every other facet is read with them ignored, which is what the signal facet has always done.
 * The alternative is resolving both id lists for each of a dozen counts.
 */
function withoutDerived(
  filters: Omit<AuctionLotFilters, "offset" | "pageSize">
): Omit<AuctionLotFilters, "offset" | "pageSize" | "signal" | "duplicate"> {
  const rest = { ...filters };
  delete rest.signal;
  delete rest.duplicate;
  return rest;
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

  const { outcome, sellerId, platformId, closing, ...rest } = withoutDerived(filters);
  const [
    byOutcome,
    bySeller,
    byPlatform,
    closingCounts,
    signalIds,
    undescribed,
    duplicateCount,
    total,
  ] = await Promise.all([
    // One count per outcome rather than a `groupBy`: the outcome is derived, so there is no column
    // to group on — each is its own predicate over the money ({@link outcomeWhere}). Five cheap
    // indexed counts, and the alternative is loading every lot in the collection to bucket it.
    Promise.all(
      AUCTION_LOT_OUTCOMES.map((o) =>
        prisma.auctionLot.count({
          where: lotListWhere(collectionId, { ...rest, sellerId, platformId, closing, outcome: o }),
        })
      )
    ),
    // Seller and platform live on the sale, so their facets group over sales and are folded back
    // onto the lots by sale id — `groupBy` cannot reach through a relation.
    lotCountsBySale(collectionId, { ...rest, outcome, platformId, closing }),
    lotCountsBySale(collectionId, { ...rest, outcome, sellerId, closing }),
    // Each window counted with the *other* dimensions applied but its own ignored, like the rest.
    Promise.all(
      (["ended", "today", "week"] as const).map((w) =>
        prisma.auctionLot.count({
          where: lotListWhere(collectionId, { ...rest, outcome, sellerId, platformId, closing: w }),
        })
      )
    ),
    // The signal facet ignores the selected signal, like every other facet ignores its own.
    resolveSignals(collectionId, { ...rest, outcome, sellerId, platformId, closing }),
    // …and this one ignores whether it is itself selected, so its badge always says how many lots
    // clicking it would show.
    prisma.auctionLot.count({
      where: lotListWhere(collectionId, {
        ...rest,
        outcome,
        sellerId,
        platformId,
        closing,
        undescribed: true,
      }),
    }),
    // Likewise ignoring its own selection. The collision set is resolved over every lot being won
    // and then narrowed by the other chips, which is the only order that works: whether two lots
    // hold the same stamp is not a question the seller filter has any say in.
    (async () => {
      const ids = collidingLotIds(await atRiskLotLines(collectionId));
      if (ids.length === 0) return 0;
      return prisma.auctionLot.count({
        where: lotListWhere(
          collectionId,
          { ...rest, outcome, sellerId, platformId, closing },
          ids
        ),
      });
    })(),
    (async () =>
      prisma.auctionLot.count({
        where: lotListWhere(
          collectionId,
          filters,
          await resolveDerivedIds(collectionId, filters)
        ),
      }))(),
  ]);

  // Absent rather than zero, matching what `groupBy` used to hand back — the chips read a missing
  // key and a zero the same way, and keeping the shape spares every caller a change.
  const outcomes: Partial<Record<AuctionLotOutcome, number>> = {};
  AUCTION_LOT_OUTCOMES.forEach((o, i) => {
    if (byOutcome[i] > 0) outcomes[o] = byOutcome[i];
  });

  return {
    outcomes,
    sellers: foldByParty(bySeller, "sellerId"),
    platforms: foldByParty(byPlatform, "platformId"),
    closing: { ended: closingCounts[0], today: closingCounts[1], week: closingCounts[2] },
    signals: Object.fromEntries(
      LOT_SIGNALS.map((s) => [s, signalIds[s].length])
    ) as Record<LotSignal, number>,
    undescribed,
    duplicate: duplicateCount,
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
  /** The collection's base currency (#498). */
  baseCurrency: string;
  /**
   * Rate from the sale's currency into the base one (#498), or null in the base currency already
   * and when no rate could be had.
   *
   * The **live** rate, with no frozen counterpart: a parcel's totals are sums over lots that are
   * still being bid, so there is no one day they belong to. A settled sale's dated cost is the
   * purchase's (ADR-0009 §4), which is where it is read from once the parcel has been transcribed.
   */
  baseRate: number | null;
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
      // The parcel's totals count the lots the collector pays for, and which those are is now read
      // off the money (ADR-0021 §4) — so the rollup needs the two figures the outcome follows from.
      myBid: true,
      wonTie: true,
      // What the parcel's catalogue total is summed from (#353); the ids of the lots that have one
      // are what the batched valuation is asked for.
      _count: { select: { lines: true } },
    },
  },
} satisfies Prisma.AuctionSaleSelect;

type SaleRow = Prisma.AuctionSaleGetPayload<{ select: typeof SALE_SELECT }>;

function toSaleListItem(
  row: SaleRow,
  baseCurrency: string,
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
    baseCurrency,
    baseRate: null, // filled by `attachBaseRates` — it needs the current rate.
    endsAt: row.endsAt,
    shippingCost: fees.shippingCost,
    premiumPercent: fees.premiumPercent,
    premiumFixed: fees.premiumFixed,
    purchaseId: row.purchaseId,
    summary: summarizeAuctionSale(
      row.lots.map((lot) => ({
        status: (isAuctionLotStatus(lot.status) ? lot.status : "open") as AuctionLotStatus,
        myBid: money(lot.myBid),
        wonTie: lot.wonTie,
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

export interface AuctionSaleListFilters {
  status?: AuctionSaleStatus;
  /** Free text the settlement list is narrowed to (#484): the sale's name or catalogue URL, and the
   * seller / platform it is with — which, for a marketplace basket whose name is derived from the
   * pair, is the same two words either way. */
  search?: string;
}

/** The `where` fragment for the sale list's search box (#484). Case-insensitive substring over the
 * sale's own name and URL and the two parties on it. A sale's identifier is part of its name
 * (there is no separate sale-number column), so `Köhler 385` is found by either half. */
function saleSearchWhere(search: string): Prisma.AuctionSaleWhereInput {
  const text = { contains: search.trim(), mode: "insensitive" as const };
  return {
    OR: [{ name: text }, { url: text }, { seller: { name: text } }, { platform: { name: text } }],
  };
}

/** Every sale, newest first, each with its parcel totals — the settlement list. Unpaginated: a sale
 * is one parcel from one seller, so there are as many as there have been settlements, and the
 * screen exists to answer "what do I owe whom", which a page boundary would cut in half. */
export async function listAuctionSales(
  ownerId: string,
  collectionId: string,
  filters: AuctionSaleListFilters = {}
): Promise<AuctionSaleListItem[]> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.auctionSale.findMany({
    where: {
      collectionId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search?.trim() ? saleSearchWhere(filters.search) : {}),
    },
    orderBy: { createdAt: "desc" },
    select: SALE_SELECT,
  });
  // One valuation pass across every sale on the screen, for the same reason the lot list batches:
  // this list is unpaginated by design, so per-sale valuation would be a pricing run per parcel.
  const compositions = await compositionsFor(
    collectionId,
    rows.flatMap((row) => row.lots)
  );
  const items = rows.map((row) => toSaleListItem(row, baseCurrency, compositions));
  await attachBaseRates(collectionId, baseCurrency, items);
  return items;
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
  const detail = {
    ...toSaleListItem(row, sale.baseCurrency, compositions),
    lots: lots.map((lot) => ({
      ...toLotListItem(lot, sale.baseCurrency, compositions.get(lot.id)),
      lines: compositions.get(lot.id)?.lines ?? [],
    })),
  };
  // The parcel and its lots share one currency, so this is one rate lookup for the screen — the
  // lots that froze their own keep it (`attachBaseRates` leaves a set rate alone).
  await attachBaseRates(sale.collectionId, sale.baseCurrency, [detail, ...detail.lots]);
  return detail;
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

/**
 * The currency a **new** sale would open in.
 *
 * Three answers in order, and the order is the whole point. The seller's own `defaultCurrency`
 * first: currency belongs to the seller (#350), because an aggregator like philasearch carries
 * houses listing in EUR, CHF and GBP alike. Then the platform's fixed `platformCurrency` (#196) —
 * a marketplace that only ever trades in one currency *does* answer it, and a seller met for the
 * first time has no default to read, which is exactly when a lot on Allegro was landing in EUR.
 * Then the collection's base currency, which is at least a currency the collector uses, rather
 * than a hard-coded one.
 *
 * Seeded, never referenced: what comes out of here is written onto the sale at creation and edited
 * there afterwards, so changing a seller's or a platform's settings never re-prices a parcel
 * already being tracked.
 */
async function resolveNewSaleCurrency(
  collectionId: string,
  sellerId: string | null,
  platformId: string | null
): Promise<string> {
  const [seller, platform, collection] = await Promise.all([
    sellerId
      ? prisma.contact.findFirst({
          where: { id: sellerId, collectionId },
          select: { defaultCurrency: true },
        })
      : null,
    platformId
      ? prisma.contact.findFirst({
          where: { id: platformId, collectionId },
          select: { platformCurrency: true },
        })
      : null,
    prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { baseCurrency: true },
    }),
  ]);
  return seller?.defaultCurrency || platform?.platformCurrency || collection.baseCurrency;
}

/** {@link resolveNewSaleCurrency}, for the dialogs: what to *show* as the currency a new sale will
 * open in, before it exists. Either party may still be unnamed — a seller typed in for the first
 * time has no id yet — and the answer then falls through to whatever is known. */
export async function getNewAuctionSaleCurrency(
  ownerId: string,
  collectionId: string,
  sellerId: string | null,
  platformId: string | null
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  return resolveNewSaleCurrency(collectionId, sellerId, platformId);
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
      currency:
        input.currency ||
        (await resolveNewSaleCurrency(collectionId, input.sellerId, input.platformId)),
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
  // In a transaction for the number's sake (#432): the counter bump and the lot it belongs to stand
  // or fall together, composition included.
  const lot = await prisma.$transaction(async (tx) =>
    tx.auctionLot.create({
      data: {
        auctionSaleId: input.auctionSaleId,
        // Ours, per collection — distinct from `lotNo`, the house's own number for the lot.
        auctionLotNo: await allocateEntityNumber(tx, collectionId, "auctionLot"),
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
    })
  );
  // Adding a lot is what "last used" means — it happens far more often than starting a sale, and
  // it is the moment the collector confirmed this seller is reached through this platform.
  await rememberSellerPlatform(parties.sellerId, parties.platformId);
  return lot.id;
}

// ── Capture from a marketplace page (#355) ──────────────────────────────────
//
// The Assistant reads a listing and hands over what the page already knows. Everything here is the
// add-lot dialog's own behaviour (#352) reached without a dialog: the platform, the seller, the open
// sale and the lot, in that order, each decided server-side rather than trusted from a browser
// extension. What the capture deliberately does **not** carry is composition — it cannot be derived
// from a listing, and a wrong one is worse than none, so it stays something the collector enters
// here.

/** One listing as a marketplace page states it. Platform-neutral: Allegro is the first module to
 *  produce one, and nothing in this shape is Allegro's. */
export interface AuctionLotCaptureInput {
  /**
   * The marketplace's own id for the listing — the one thing that survives a slug change, a
   * redirect, or the collector having stored the URL in a different shape. It is what makes a
   * re-capture a **refresh** instead of a duplicate.
   */
  platformOfferId: string;
  /** The listing's address as the module decided to record it. */
  url: string;
  title: string | null;
  /** The marketplace's own number for the listing, for the lot's own number field — the same slot a
   *  house sale's lot number occupies, so the watchlist reads the same however a lot got there. */
  lotNo: string | null;
  /** The seller as printed on the page. Resolved against the collection's contacts by name, and
   *  created as a seller when it matches none — exactly as a name typed into the dialog is. */
  sellerName: string | null;
  endsAt: Date;
  /** What the listing opened at, when the page says so and nobody has bid yet. A record, never a
   *  cost (#351). */
  startingPrice: string | null;
  /** What it stands at — an observation, so writing it stamps `checkedAt`. Null while no bid has
   *  been placed: a lot nobody has bid on costs nothing, whatever it opens at. */
  currentBid: string | null;
}

/** What a capture did, or — on a dry run — what it would do. Both halves are stated in the same
 *  shape so the Assistant's window can show the collector the outcome before and after. */
export interface AuctionLotCaptureResult {
  /** `created` writes a new lot; `refreshed` finds the lot already tracking this listing and
   *  re-records its bid, which is what makes the extension the fastest way to check a price. */
  outcome: "created" | "refreshed";
  /** Null on a dry run of a `created`, where nothing exists yet. */
  lotId: string | null;
  saleId: string | null;
  saleName: string;
  saleCurrency: string;
  /** True when this capture starts the seller's parcel rather than joining an open one. */
  saleCreated: boolean;
  sellerId: string | null;
  sellerName: string;
  /** True when the page's seller matches no contact and one would be (or was) created. */
  sellerCreated: boolean;
  platformName: string;
  /** What the lot carried before a refresh, so the window can say whether the price moved. */
  previousBid: string | null;
}

/**
 * The lot already tracking this listing, found by the marketplace's own **offer id** — never by URL
 * equality, because the same listing is reachable through several addresses (the canonical one a
 * capture stores, the slug the collector pasted, the product page that carries the offer in a
 * parameter) and the id is the part of every one of them that is the listing.
 *
 * The id is looked for in **two places**, because it is recorded in two:
 *
 *  • `lotNo`, where a capture writes the marketplace's own number. This is the exact half — an offer
 *    number is unique on the marketplace, so equality is the whole test — and it is scoped to sales
 *    on *this* platform, since `lotNo` is a shared field and a house sale's `Lot 42` is a different
 *    vocabulary that must never collide with an offer number.
 *  • the `url`, at the **address's own boundaries** — `offerUrlMatchClauses`, shared with the sold
 *    worklist's own matching (#467) since both are the same question about the same marketplace, and
 *    never a bare substring: an id is a run of digits, and a plain `contains` would let a short one
 *    match the middle of an unrelated listing's number and refresh the wrong lot's bid.
 *
 * Both, rather than the better one, because a lot added by hand carries whichever of the two the
 * collector happened to type — the number off the listing, or the link to it — and either is enough
 * to recognise that this auction is already being watched.
 */
async function findCapturedLot(collectionId: string, platformId: string, platformOfferId: string) {
  return prisma.auctionLot.findFirst({
    where: {
      auctionSale: { collectionId },
      OR: [
        { lotNo: platformOfferId, auctionSale: { collectionId, platformId } },
        ...offerUrlMatchClauses(platformOfferId),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      currentBid: true,
      purchaseLotId: true,
      auctionSale: { select: { id: true, name: true, currency: true } },
    },
  });
}

/**
 * Write — or refresh — the lot a captured listing describes.
 *
 * `dryRun` answers the same question without touching anything, which is what the Assistant's window
 * shows before the collector presses Save: which parcel this lands in, whether the seller is new
 * here, and whether this listing is already being watched. It resolves nothing into existence, so a
 * previewed seller and a previewed sale are reported as *would be created*.
 */
export async function captureAuctionLot(
  ownerId: string,
  collectionId: string,
  input: AuctionLotCaptureInput,
  opts: { dryRun?: boolean } = {}
): Promise<AuctionLotCaptureResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const dryRun = opts.dryRun ?? true;

  // The one fact a listing page cannot state: which of this collection's platforms Allegro is. It
  // is a setting rather than a question the capture asks, so an unset one is a refusal pointing at
  // the tab that answers it (#355).
  const platform = await getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
  if (!platform) {
    throw new AuctionActionBlockedError(
      "no-platform-module",
      "No platform in this collection is marked as Allegro. Set one under Settings → Allegro, then capture again."
    );
  }

  const existing = await findCapturedLot(collectionId, platform.id, input.platformOfferId);
  if (existing) {
    assertLotEditable(existing);
    const previousBid = money(existing.currentBid);
    // Only the bid and its timestamp. A capture is an observation of a price, not a re-import of the
    // listing: the title, the closing time and everything the collector has since typed onto the lot
    // are theirs, and a refresh that overwrote them would punish keeping the watchlist tidy.
    if (!dryRun) await setAuctionLotBid(ownerId, existing.id, input.currentBid);
    return {
      outcome: "refreshed",
      lotId: existing.id,
      saleId: existing.auctionSale.id,
      saleName: existing.auctionSale.name,
      saleCurrency: existing.auctionSale.currency,
      saleCreated: false,
      sellerId: null,
      sellerName: input.sellerName ?? "",
      sellerCreated: false,
      platformName: platform.name,
      previousBid,
    };
  }

  const sellerName = input.sellerName?.trim() ?? "";
  if (!sellerName) {
    throw new AuctionActionBlockedError(
      "no-seller",
      "This listing names no seller. Name the seller in the window before saving."
    );
  }

  // A dry run must leave no trace, so it looks the seller up instead of resolving them: a name that
  // matches nothing is reported as a contact that *would* be created, which is the answer the
  // collector is checking before they press Save.
  const existingSeller = await prisma.contact.findFirst({
    where: { collectionId, name: { equals: sellerName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const sellerId = dryRun
    ? existingSeller?.id ?? null
    : await resolvePurchaseContact(collectionId, { name: sellerName, role: "seller" });
  if (!dryRun && !sellerId) {
    throw new AuctionActionBlockedError("no-seller", "That seller could not be resolved.");
  }

  const open = sellerId
    ? await findOpenAuctionSale(ownerId, collectionId, sellerId, platform.id)
    : null;

  if (dryRun) {
    return {
      outcome: "created",
      lotId: null,
      saleId: open?.id ?? null,
      saleName: open?.name ?? deriveAuctionSaleName(existingSeller?.name ?? sellerName, platform.name),
      saleCurrency:
        open?.currency ?? (await resolveNewSaleCurrency(collectionId, sellerId, platform.id)),
      saleCreated: !open,
      sellerId,
      sellerName: existingSeller?.name ?? sellerName,
      sellerCreated: !existingSeller,
      platformName: platform.name,
      previousBid: null,
    };
  }

  const saleId =
    open?.id ??
    (await createAuctionSale(ownerId, collectionId, {
      sellerId: sellerId!,
      platformId: platform.id,
      name: null,
      url: null,
      // A marketplace basket has no closing date of its own; the first lot's is a harmless seed the
      // sale's own screen edits, exactly as the add-lot dialog seeds it (#352).
      endsAt: input.endsAt,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    }));

  const lotId = await createAuctionLot(ownerId, collectionId, {
    auctionSaleId: saleId,
    lotNo: input.lotNo,
    url: input.url,
    title: input.title,
    endsAt: input.endsAt,
    startingPrice: input.startingPrice,
    currentBid: input.currentBid,
    myBid: null,
    maxBid: null,
    notes: null,
  });

  const sale = await prisma.auctionSale.findUniqueOrThrow({
    where: { id: saleId },
    select: { name: true, currency: true },
  });
  return {
    outcome: "created",
    lotId,
    saleId,
    saleName: sale.name,
    saleCurrency: sale.currency,
    saleCreated: !open,
    sellerId: sellerId!,
    sellerName: existingSeller?.name ?? sellerName,
    sellerCreated: !existingSeller,
    platformName: platform.name,
    previousBid: null,
  };
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
 * What the row's ⋮ menu records: a move along the lot's **lifecycle**, never an outcome.
 *
 * Won/lost/observed are not recordable and never were facts — they follow from the money (ADR-0021
 * §4). What the collector actually does at the end of an auction is go and look at the figures, so
 * that is what this takes: `closed` carries what the lot fetched, `cancelled` says there was no
 * result to have, and `open` is the undo.
 *
 * `wonTie` rides along with `closed` because it is the one thing the figures cannot say. It is
 * required exactly when `finalPrice` equals the collector's own maximum and meaningless otherwise;
 * {@link recordAuctionLotTransition} enforces both halves.
 */
export type AuctionLotTransition =
  | { status: "closed"; finalPrice: string | null; wonTie: boolean | null }
  | { status: "cancelled" }
  | { status: "open" };

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
 * Move a lot along its lifecycle — the fork at the end of ADR-0021 §7 (#354), rewritten for §4.
 *
 * Closing a lot is **confirming its figures**, not filing a verdict. What comes back out is derived
 * by `lotOutcome`, so the only judgements this makes are about whether the figures can be read at
 * all, and there are exactly two:
 *
 * - **A price is required unless no bid was placed.** A lot the collector bid on and then lost sight
 *   of used to be filed "lost with no figure", and that state is retired: the honest way to say "I
 *   never saw what it went for" is to leave the lot `open`, or to clear the bid if it was really
 *   never placed. Nothing is inferred from the last observed bid — that figure is a lower bound, and
 *   promoting it to a result would poison the very data #24 consumes.
 * - **A tie needs answering.** Equal figures are the one case the arithmetic cannot resolve, so
 *   `wonTie` is demanded there and refused everywhere else, where it would mean nothing.
 *
 * `cancelled` and `open` clear the price, its rate and the tie-break together: a cancelled listing
 * carries no result, and a lot put back in play must not keep a figure describing how it ended.
 *
 * Settlement (#28) still starts from a sale holding won lots — it just reads them off the money now
 * instead of off a flag, so a sale reaches that state by having its figures entered rather than by
 * being told twice.
 */
export async function recordAuctionLotTransition(
  ownerId: string,
  lotId: string,
  transition: AuctionLotTransition
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertLotEditable(lot);

  if (transition.status !== "closed") {
    await prisma.auctionLot.update({
      where: { id: lotId },
      data: { status: transition.status, finalPrice: null, fxRateToBase: null, wonTie: null },
    });
    return;
  }

  const row = await prisma.auctionLot.findUniqueOrThrow({
    where: { id: lotId },
    select: {
      myBid: true,
      auctionSale: {
        select: { currency: true, collection: { select: { baseCurrency: true } } },
      },
    },
  });

  if (row.myBid !== null && transition.finalPrice === null) {
    throw new AuctionActionBlockedError(
      "no-price",
      "Enter what this lot went for. If you never actually bid on it, clear your own bid first — that records it as one you only watched."
    );
  }

  // The tie is the sole thing about the outcome that the money cannot say, so it is stored only
  // where it means something and demanded only there. Anywhere else it would be a second, silently
  // disagreeing answer to a question the figures already settle.
  const tie = row.myBid !== null && transition.finalPrice !== null && row.myBid.equals(transition.finalPrice);
  if (tie && transition.wonTie === null) {
    throw new AuctionActionBlockedError(
      "tie-unresolved",
      "This lot went for exactly your own maximum, so the figures cannot say whether it was yours — whoever bid that amount first won it. Say which it was."
    );
  }

  // A rate exists to convert a figure. With no price recorded there is nothing to convert, and
  // storing today's rate against an absent observation would only look like data.
  const fxRateToBase =
    transition.finalPrice === null
      ? null
      : await freezeLotFxRate(
          lot.collectionId,
          row.auctionSale.currency,
          row.auctionSale.collection.baseCurrency
        );

  await prisma.auctionLot.update({
    where: { id: lotId },
    // Re-freezing on a corrected price is intended: the rate travels with the figure it converts.
    data: {
      status: "closed",
      finalPrice: transition.finalPrice,
      fxRateToBase,
      wonTie: tie ? transition.wonTie : null,
    },
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

// ── Duplicate warning (#369) ────────────────────────────────────────────────

/** How far the family walk climbs or descends before giving up. A variant tree is two or three
 * levels deep in practice; the cap is only there so a cycle cannot turn this into a loop. */
const MAX_VARIANT_DEPTH = 8;

/**
 * Each stamp's variant family **through the umbrella** — its unknown-variant ancestors and all of
 * its variant descendants, excluding itself and excluding its siblings (see `sameStamp`).
 *
 * Resolved by level rather than per stamp: the input is the handful of stamps sitting in lots the
 * collector is currently winning, and a tree that shallow costs a couple of round trips whichever
 * way it is walked.
 */
async function variantFamilies(stampIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map(stampIds.map((id) => [id, new Set<string>()]));
  if (stampIds.length === 0) return new Map();

  // Upward: a node contributes its parent only when the node itself *acts as* a variant. A child
  // that does not is a stamp in its own right, and its parent is no umbrella over it.
  let up = new Map(stampIds.map((id) => [id, new Set([id])]));
  for (let depth = 0; depth < MAX_VARIANT_DEPTH && up.size > 0; depth++) {
    const rows = await prisma.stamp.findMany({
      where: { id: { in: [...up.keys()] } },
      select: { id: true, parentId: true, ...VARIANT_FLAG_SELECT },
    });
    const next = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.parentId || !childIsVariant(row)) continue;
      const origins = up.get(row.id)!;
      for (const origin of origins) out.get(origin)!.add(row.parentId);
      const carried = next.get(row.parentId) ?? new Set<string>();
      for (const origin of origins) carried.add(origin);
      next.set(row.parentId, carried);
    }
    up = next;
  }

  // Downward: every variant child, and their variant children in turn. An umbrella's descendants
  // are the specific variants "variant unrecorded" could turn out to mean.
  let down = new Map(stampIds.map((id) => [id, new Set([id])]));
  for (let depth = 0; depth < MAX_VARIANT_DEPTH && down.size > 0; depth++) {
    const rows = await prisma.stamp.findMany({
      where: { parentId: { in: [...down.keys()] } },
      select: { id: true, parentId: true, ...VARIANT_FLAG_SELECT },
    });
    const next = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.parentId || !childIsVariant(row)) continue;
      const origins = down.get(row.parentId)!;
      for (const origin of origins) out.get(origin)!.add(row.id);
      const carried = next.get(row.id) ?? new Set<string>();
      for (const origin of origins) carried.add(origin);
      next.set(row.id, carried);
    }
    down = next;
  }

  return new Map([...out].map(([id, family]) => [id, [...family]]));
}

/** The rows the at-risk read needs: the signal inputs, plus enough of each line to name it. */
const AT_RISK_SELECT = {
  ...SIGNAL_SELECT,
  auctionLotNo: true,
  title: true,
  auctionSaleId: true,
  lines: {
    select: {
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      condition: { select: { name: true, abbreviation: true } },
      certificateStatus: { select: { name: true, abbreviation: true } },
      format: { select: { name: true, abbreviation: true } },
      stamp: {
        select: {
          name: true,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          issueMemberships: { select: { issueId: true }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.AuctionLotSelect;

/**
 * The lines of every lot the collector is **winning** — what the duplicate warning is checked
 * against (#369).
 *
 * "Winning" is the existing `leading` signal (open, the collector's bid still covers the price) plus
 * `won-pending` (past `endsAt`, was leading, outcome not yet confirmed), computed by the very
 * helpers the lot list's chips use so the two can never disagree about which lots are in play.
 * Outbid, merely watched and historical lots are deliberately absent: a lot somebody else is
 * winning costs nothing to also bid on, and a lot lost last year means "still looking".
 *
 * Returned whole rather than queried per line. The set is bounded by what one person is bidding on
 * at one time, so the dialogs fetch it once and match every keystroke against it in memory.
 */
export async function listAtRiskLotLines(
  ownerId: string,
  collectionId: string
): Promise<AtRiskLine[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return atRiskLotLines(collectionId);
}

/** {@link listAtRiskLotLines} without the ownership check, for callers inside this module that have
 * already made it — the lot list's duplicate filter and its facet count. */
async function atRiskLotLines(collectionId: string): Promise<AtRiskLine[]> {
  const rows = await prisma.auctionLot.findMany({
    // A signal only says something about a lot still in play, hence `open` — `won-pending` is an
    // open lot whose `endsAt` has passed, not a closed one.
    where: { status: "open", auctionSale: { collectionId } },
    select: AT_RISK_SELECT,
  });

  const now = new Date();
  const winning = rows.filter((row) => {
    const input = {
      status: "open" as const,
      endsAt: row.endsAt,
      currentBid: money(row.currentBid),
      myBid: money(row.myBid),
      maxBid: money(row.maxBid),
      fees: {
        premiumPercent: money(row.auctionSale.premiumPercent),
        premiumFixed: money(row.auctionSale.premiumFixed),
      },
    };
    return lotHasSignal("leading", input, now) || lotHasSignal("won-pending", input, now);
  });

  const stampIds = [...new Set(winning.flatMap((row) => row.lines.map((l) => l.stampId)))];
  if (stampIds.length === 0) return [];

  const [families, areas, issuePrefixes] = await Promise.all([
    variantFamilies(stampIds),
    // Named the way every other stamp surface names them (#357/#377), so the banner and the line
    // list the collector is looking at print the same catalog number the same way.
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  return winning.flatMap((row) =>
    row.lines.map((line) => {
      const link =
        line.stamp.stampAreaLinks.find((l) => l.isPrimary) ?? line.stamp.stampAreaLinks[0];
      const areaId = link?.collectionAreaId ?? null;
      const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
      const leading =
        line.stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ??
        line.stamp.catalogNumbers[0] ??
        null;
      const issueId = line.stamp.issueMemberships[0]?.issueId ?? null;
      const catalogLabel = leading
        ? formatStampCN(leading.number, vendorMapFor(areaId, issueId).get(leading.catalogVendorId))
        : null;
      return {
        lotId: row.id,
        auctionLotNo: row.auctionLotNo,
        saleId: row.auctionSaleId,
        lotTitle: row.title,
        stampId: line.stampId,
        familyIds: families.get(line.stampId) ?? [],
        // A stamp with neither a number nor a name is still worth warning about, so the label falls
        // through to a dash rather than the warning falling through to silence.
        stampLabel: catalogLabel ?? line.stamp.name ?? "—",
        conditionId: line.conditionId,
        conditionLabel: line.condition.abbreviation || line.condition.name,
        formatId: line.formatId,
        formatLabel: line.format ? line.format.abbreviation || line.format.name : null,
        certificateStatusId: line.certificateStatusId,
        certificateStatusLabel: line.certificateStatus
          ? line.certificateStatus.abbreviation || line.certificateStatus.name
          : null,
      };
    })
  );
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
  // The three the outcome is derived from — settlement acts on won lots, and won is no longer a
  // stored flag it could simply read (ADR-0021 §4).
  myBid: true,
  finalPrice: true,
  wonTie: true,
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

/** `lotOutcome` over a settlement row, with the stored status validated on the way in. One helper so
 * the two places settlement asks — "is anything still open?" and "is this one won?" — cannot answer
 * the question differently. */
function settlementOutcome(lot: {
  status: string;
  myBid: Prisma.Decimal | null;
  finalPrice: Prisma.Decimal | null;
  wonTie: boolean | null;
}): AuctionLotOutcome {
  return lotOutcome({
    status: (isAuctionLotStatus(lot.status) ? lot.status : "open") as AuctionLotStatus,
    myBid: money(lot.myBid),
    finalPrice: money(lot.finalPrice),
    wonTie: lot.wonTie,
  });
}

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

  const open = sale.lots.filter((lot) => settlementOutcome(lot) === "pending").length;
  if (open > 0) {
    throw new AuctionActionBlockedError(
      "unresolved",
      `${open} lot${open === 1 ? " is" : "s are"} still open. Close ${open === 1 ? "it" : "them"} — confirming what ${open === 1 ? "it went" : "they went"} for — before settling the parcel.`
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
    // Won-ness is read off the money like everywhere else (ADR-0021 §4). A settled lot's figures are
    // then frozen by `assertLotEditable`, so what settlement wrote and what the lot derives to stay
    // in step — which is the constraint that made deriving it safe here in the first place.
    if (settlementOutcome(lot) !== "won" || lot.purchaseLotId) {
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
        purchaseNo: await allocateEntityNumber(tx, sale.collectionId, "purchase"),
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
