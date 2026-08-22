import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { assertTradeOwner } from "./trade-access";
import { listTradeLinePage, type TradeLinePageItem } from "./trade-lines";
import { readTradeBalance, type TradeLineValueRead, type TradeRateRead } from "./trade-valuation";
import { isTradeSide, TRADE_STATUS_LABEL, type TradeSide, type TradeStatus } from "./trade-rules";
import { readTradeLineFulfillments } from "./trade-realisation";
import { tradeShareFulfillmentLabel } from "./trade-realisation-rules";
import type { TradeGroupHeading, TradeGroupLevel } from "./trade-grouping";
import { readCollectionAreas } from "./areas";
import { buildAreaPath } from "./area-path";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import {
  isTradeShareTokenShape,
  resolveTradeShareAccess,
  tradeShareSideHeading,
  TRADE_SHARE_TOKEN_PREFIX,
  type TradeShareRefusal,
} from "./trade-share-rules";

// **The partner's copy of the list** (#640; ADR-0039 §9). The database half of the share link: what
// mints one, what a raw token resolves to, and what a resolved one may read.
//
// Two rules hold this module together and everything else in it follows from them.
//
// **The token names one trade, and nothing is ever read by any other key.** `verifyTradeShareToken`
// hands back a `TradeShareAccess` carrying the trade id it resolved to, and every read below takes
// that value rather than anything from a URL, a query string or a form. There is no path by which a
// second trade id, a collection id or a stamp id supplied by the reader reaches a `where` clause. So
// a leaked link exposes exactly the list the collector chose to hand over — the point the issue makes
// twice, and the one property that has to survive every later change to this file.
//
// **The payload is what is printed, and only what is printed.** The page is assembled here into
// display-ready strings rather than shipped as domain rows for a component to pick over. A give line
// is a copy the collection knows a great deal about — its number, where it is filed, what it cost —
// and none of that is the partner's business; the surest way to keep it out of the page is for it
// never to be in the payload. What the reader gets per line is what a collector would write on paper:
// the catalogue number, the stamp, the condition, how many, and (at the collector's choice) what it
// is worth.

const HASH_ALGO = "sha256";

/** SHA-256 hex of a raw token — the only form persisted, exactly as for an Assistant token. */
function hashToken(rawToken: string): string {
  return createHash(HASH_ALGO).update(rawToken, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── The collector's side ────────────────────────────────────────────────────────────────────────

/** A trade's share link as the collector's dialog reads it. Never the raw token: that exists for one
 *  moment, in the response that minted it, and is not recoverable afterwards. */
export interface TradeShareLinkData {
  showValues: boolean;
  expiresAt: string | null;
  createdAt: string;
  /** When the partner last opened it, or null if they never have. The only read receipt there is. */
  lastUsedAt: string | null;
}

export interface TradeShareOptions {
  showValues: boolean;
  /** Null is "no expiry", which is the default and the common case. */
  expiresAt: Date | null;
}

/** The link on a trade, or null when it has none. */
export async function readTradeShareLink(
  ownerId: string,
  tradeId: string
): Promise<TradeShareLinkData | null> {
  await assertTradeOwner(ownerId, tradeId);
  const row = await prisma.tradeShareToken.findUnique({
    where: { tradeId },
    select: { showValues: true, expiresAt: true, createdAt: true, lastUsedAt: true },
  });
  return row ? toLinkData(row) : null;
}

function toLinkData(row: {
  showValues: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): TradeShareLinkData {
  return {
    showValues: row.showValues,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * Mint the trade's link, replacing any it already had.
 *
 * **Minting and regenerating are one act**, because they are: a trade has one link, and asking for a
 * new one is asking for the old one to stop working. Written as an upsert on the unique `tradeId` so
 * there is never a window in which a trade has two live links, and the old hash is gone the moment
 * the new one lands.
 *
 * Returns the raw token **once**. It is not stored and cannot be recovered; a collector who loses it
 * regenerates, which is the same trade `AssistantToken` makes and for the same reason.
 */
export async function createTradeShareToken(
  ownerId: string,
  tradeId: string,
  options: TradeShareOptions
): Promise<{ token: string; record: TradeShareLinkData }> {
  await assertTradeOwner(ownerId, tradeId);
  const rawToken = TRADE_SHARE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const row = await prisma.tradeShareToken.upsert({
    where: { tradeId },
    create: {
      tradeId,
      tokenHash,
      showValues: options.showValues,
      expiresAt: options.expiresAt,
    },
    update: {
      tokenHash,
      showValues: options.showValues,
      expiresAt: options.expiresAt,
      // A regenerated link has never been opened. Carrying the old receipt over would have the
      // dialog report that a partner had read a list they cannot reach.
      lastUsedAt: null,
      createdAt: new Date(),
    },
    select: { showValues: true, expiresAt: true, createdAt: true, lastUsedAt: true },
  });
  return { token: rawToken, record: toLinkData(row) };
}

/**
 * Change what an existing link shows, without changing the address.
 *
 * Separate from minting because they are separate decisions: turning the figures off on a list the
 * partner is already reading must not also break their link. Refused when there is no link, rather
 * than quietly creating one — an option set on nothing is a setting the collector cannot see.
 */
export async function setTradeShareOptions(
  ownerId: string,
  tradeId: string,
  options: TradeShareOptions
): Promise<TradeShareLinkData> {
  await assertTradeOwner(ownerId, tradeId);
  const existing = await prisma.tradeShareToken.findUnique({
    where: { tradeId },
    select: { id: true },
  });
  if (!existing) throw new Error("This trade has no share link.");
  const row = await prisma.tradeShareToken.update({
    where: { tradeId },
    data: { showValues: options.showValues, expiresAt: options.expiresAt },
    select: { showValues: true, expiresAt: true, createdAt: true, lastUsedAt: true },
  });
  return toLinkData(row);
}

/** Withdraw the link. The row is deleted rather than flagged: a revoked credential kept around is a
 *  credential someone can un-revoke, and there is nothing here worth an audit trail. */
export async function revokeTradeShareToken(ownerId: string, tradeId: string): Promise<void> {
  await assertTradeOwner(ownerId, tradeId);
  await prisma.tradeShareToken.deleteMany({ where: { tradeId } });
}

// ── The partner's side ──────────────────────────────────────────────────────────────────────────

/**
 * What a verified token authorises.
 *
 * The trade id in here is the **only** one any read below uses. It is resolved from the token's own
 * row, never from anything the reader supplied, which is what makes "nothing outside the named trade
 * is reachable" a property of the code rather than a promise.
 */
export interface TradeShareAccess {
  tradeId: string;
  /** The trade's owner. Reads reuse the collector's own domain functions, which are written to take
   *  one — the token acts as the owner **for this one trade**, and for nothing else. */
  ownerId: string;
  collectionId: string;
  showValues: boolean;
  status: TradeStatus;
}

/**
 * Resolve a raw token, or say why not.
 *
 * The prefix is checked before anything is hashed, so a crawler walking `/t/…` costs a string
 * comparison rather than a query. `lastUsedAt` is bumped on success — the collector's one signal that
 * the list was actually opened — and deliberately not on a refusal, which would turn a revoked link
 * into a way to keep touching the row.
 */
export async function verifyTradeShareToken(
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {}
): Promise<{ ok: true; access: TradeShareAccess } | { ok: false; reason: TradeShareRefusal }> {
  const now = options.now ?? new Date();
  // The **page** is the visit; the thumbnails on it are not. One opened list writes one receipt, or
  // `lastUsedAt` would say more about how many pictures a trade carries than about being read.
  const touch = options.touch ?? true;
  const token = rawToken.trim();
  if (!isTradeShareTokenShape(token)) return { ok: false, reason: "unknown" };
  const hash = hashToken(token);
  const row = await prisma.tradeShareToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      showValues: true,
      expiresAt: true,
      trade: {
        select: { id: true, status: true, collectionId: true, collection: { select: { ownerId: true } } },
      },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return { ok: false, reason: "unknown" };

  const status = row.trade.status as TradeStatus;
  const allowed = resolveTradeShareAccess({ expiresAt: row.expiresAt }, status, now);
  if (!allowed.ok) return allowed;

  if (touch) {
    await prisma.tradeShareToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return {
    ok: true,
    access: {
      tradeId: row.trade.id,
      ownerId: row.trade.collection.ownerId,
      collectionId: row.trade.collectionId,
      showValues: row.showValues,
      status,
    },
  };
}

/**
 * Whether a photo may be served through this token.
 *
 * The same scoping rule as everything else: a picture is reachable when a line **of this trade**
 * points at the thing it hangs on — a copy on the give side, or the stamp a receive line names, whose
 * pictures are the collection's own (the partner has photographed nothing). Asked as one query
 * anchored on the photo, so a trade with two thousand lines does not turn into a two-thousand-item
 * `IN` list on every thumbnail.
 */
export async function canServeTradeSharePhoto(
  access: TradeShareAccess,
  photoId: string
): Promise<boolean> {
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      OR: [
        { item: { tradeLines: { some: { tradeId: access.tradeId, side: "give" } } } },
        { stamp: { tradeLines: { some: { tradeId: access.tradeId, side: "receive" } } } },
      ],
    },
    select: { id: true },
  });
  return photo !== null;
}

// ── The page ────────────────────────────────────────────────────────────────────────────────────

/**
 * How many lines of one side of one section the page will print.
 *
 * A cap, and a stated one: the page is one server render with every row in it, because a partner
 * printing the list needs the whole list on the paper — endless scroll would print whatever happened
 * to be loaded. Real exchanges run to tens of lines and this is far above them, but a silent
 * truncation would read as "that is all of it", so a side that hits the cap says so on the page.
 */
export const TRADE_SHARE_SIDE_LIMIT = 500;

/** One line's figure, per piece, with where it came from. */
export interface TradeShareValueView {
  amount: number;
  currency: string;
  /** The book behind this one figure, printed only where the header cannot say it for every line —
   *  the fallback valuation, where each line may have been read in a different catalogue, and the
   *  odd line the two sides agreed to look up in a different publisher's. */
  attribution: string | null;
  /** An unknown-variant rollup (#238) — a real figure, and an estimate, and says so. */
  uncertain: boolean;
  /** The collector's own typed figure rather than a published price. Marked wherever it is shown, so
   *  a printed list cannot present one as the other. */
  manual: boolean;
}

/** One line as the partner reads it. Everything here is meant to be printed; nothing here is an
 *  internal handle. */
export interface TradeShareLineView {
  lineId: string;
  /** The heading keys this row sits under, outermost first — empty when the list is flat. */
  path: string[];
  /** The primary vendor's number for the stamp's area, prefixed as every other stamp surface prints
   *  it (#357/#377), so the partner's copy and the collector's screen say the same string. */
  primaryNumber: string | null;
  otherNumbers: string[];
  name: string | null;
  areaPath: string | null;
  issueLabel: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  condition: string;
  certificate: string | null;
  format: string | null;
  quantity: number;
  /** The variant is not pinned down — "one of these, which one is not recorded". Shown because it is
   *  exactly the kind of thing a partner would otherwise discover in the envelope. */
  unknownVariant: boolean;
  /** Addressed through the token's own photo route; the ids mean nothing without it. */
  photoIds: string[];
  value: TradeShareValueView | null;
  /**
   * **What changed since the handshake** (#642), or null for nothing to say.
   *
   * A neutral word — *Withdrawn*, *Never arrived* — because the collector's own per-side wording
   * (*I withdrew it*) would be a lie read from this end of the table, and the two sides are already
   * headed by name here. A line that went as agreed prints nothing: what a partner opens this page
   * for after the handshake is what has **changed**, and a mark on every unchanged line would bury
   * the two that did.
   *
   * The figures beside it are untouched. What was agreed is what was agreed, and this is what is
   * recorded against it.
   */
  realisation: string | null;
}

/** One side's tally. Pieces and lines are counted apart — three lines can be thirty stamps. */
export interface TradeShareTotalsView {
  lines: number;
  pieces: number;
  /** Null when the link hides figures. Missing figures are **counted, never summed as zero**. */
  value: number | null;
  valueMissing: number;
}

export interface TradeShareSideView {
  side: TradeSide;
  /** Who the material comes from, by name — see `tradeShareSideHeading`. */
  heading: string;
  lines: TradeShareLineView[];
  headings: Record<string, TradeGroupHeading>;
  totals: TradeShareTotalsView;
  /** True when the side ran past {@link TRADE_SHARE_SIDE_LIMIT} and the page is not the whole list. */
  truncated: boolean;
}

export interface TradeShareSectionView {
  id: string;
  name: string;
  sides: TradeShareSideView[];
  /** The Colnect lists **this part** of the exchange is about (#645; re-parented in #680), grouped
   *  by side over the two columns below. Empty on a section that names none. */
  colnectLists: TradeShareColnectListView[];
}

export interface TradeShareView {
  tradeNo: number;
  /** The collection the list comes from, which is how the partner knows whose it is. */
  collectorName: string;
  partnerName: string;
  statusLabel: string;
  showValues: boolean;
  /**
   * What the figures are, or null when the link hides them.
   *
   * `agreed` is the catalogue both sides named, in the trade's currency, and the book is stated once
   * here rather than on every line. `own` is the fallback — the collector's own valuation, in the
   * collection's base currency, with each line saying which book it was read in, because a column of
   * numbers out of different books with nothing to say so cannot be read.
   */
  valuation: {
    kind: "agreed" | "own";
    currency: string;
    catalogName: string | null;
    /** The rates the figures were converted through, with the day each was taken. Usually empty —
     *  most lists are single-currency — and printed as a footnote when it is not. */
    rates: TradeRateRead[];
    /** The figures are the ones both sides shook hands on, not today's. */
    frozen: boolean;
  } | null;
  levels: TradeGroupLevel[];
  sections: TradeShareSectionView[];
  totals: { give: TradeShareTotalsView; receive: TradeShareTotalsView };
}

/** One Colnect list as the partner's page prints it — an address and what to call it. It hangs off
 *  the section it was imported into (#680), which is where its stamps are; the side decides which of
 *  the two columns it is printed over. Printed for the partner above all: they are reading a list of
 *  stamps they wrote themselves, and this is their way back to their own copy of it. */
export interface TradeShareColnectListView {
  url: string;
  /** Blank where the collector named none, which the page prints as the bare address. */
  label: string;
  side: TradeSide;
}

/**
 * Assemble the partner's page.
 *
 * Everything is read for the **one** trade the token resolved to, through the collector's own domain
 * functions rather than a second set of queries: `listTradeLinePage` arranges and counts a side
 * exactly as the trade screen's column does, and `readTradeBalance` values it exactly as the balance
 * panel does. That is the point — a partner reading a figure the collector cannot see on their own
 * screen would be reading a different trade.
 *
 * What differs is the **shape of the answer**, not the answer: the whole side comes back in one go
 * rather than a page at a time (a printed list is not scrolled), and the rows are reduced to what is
 * printed on the way out.
 */
export async function readTradeShareView(
  access: TradeShareAccess,
  levels: readonly TradeGroupLevel[]
): Promise<TradeShareView | null> {
  const trade = await prisma.trade.findUnique({
    where: { id: access.tradeId },
    select: {
      id: true,
      tradeNo: true,
      status: true,
      partner: { select: { name: true } },
      collection: { select: { name: true } },
      sections: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          colnectLists: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { url: true, label: true, side: true },
          },
        },
      },
    },
  });
  if (!trade) return null;

  // The figures are read once for the whole trade — the balance engine's own rule, since the totals
  // and the lines have to come off one set of numbers taken at one moment.
  const balance = access.showValues ? await readTradeBalance(access.ownerId, access.tradeId) : null;
  const byLine = new Map<string, TradeLineValueRead>(
    (balance?.lines ?? []).map((line) => [line.lineId, line])
  );
  // Which of the two valuations the page prints, decided once: the agreed catalogue when the trade
  // names one, the collector's own when it does not. Never both — they are two units and merging
  // them is the failure ADR-0039 §7 exists to prevent.
  const kind: "agreed" | "own" = balance?.agreedCatalogVendorId ? "agreed" : "own";
  const currency = balance ? (kind === "agreed" ? balance.tradeCurrency : balance.baseCurrency) : "";

  const [areas, issuePrefixes, fulfillments] = await Promise.all([
    readCollectionAreas(access.collectionId),
    loadIssuePrefixMap(access.collectionId),
    // **What the partner is shown to have changed** (#642). One read over the trade's own lines,
    // beside the figures rather than folded into them: a verdict changes no figure, and the totals
    // below stay the agreed ones because the agreement is what it is.
    readTradeLineFulfillments(access.tradeId),
  ]);
  const maps = buildAreaVendorMaps(areas, issuePrefixes);

  function realisationOf(lineId: string): string | null {
    const line = fulfillments.get(lineId);
    return line ? tradeShareFulfillmentLabel(line.fulfillment) : null;
  }

  /** The figure a line contributes, in the printed valuation — the same choice `valueOf` makes, so a
   *  total and the rows under it can never disagree about which of the two books they are in. */
  function amountOf(read: TradeLineValueRead): number | null {
    return kind === "agreed" ? read.agreed : read.own;
  }

  // Side totals are summed over **every** line of the side, not over the rows printed: a side that
  // ran past the cap still states what the whole of it is worth, and a total that quietly counted
  // only the first five hundred would be a figure nobody could reproduce.
  const sideValues = new Map<string, { value: number; missing: number }>();
  for (const read of balance?.lines ?? []) {
    const key = `${read.sectionId}:${read.side}`;
    const bucket = sideValues.get(key) ?? { value: 0, missing: 0 };
    const amount = amountOf(read);
    if (amount === null) bucket.missing += 1;
    else bucket.value += amount * read.quantity;
    sideValues.set(key, bucket);
  }

  function valueOf(lineId: string): TradeShareValueView | null {
    const read = byLine.get(lineId);
    if (!read) return null;
    const amount = amountOf(read);
    if (amount === null) return null;
    return {
      amount,
      currency,
      // In the agreed valuation the header names the book for every line, so the only attribution
      // worth the space is the line that was deliberately read somewhere else.
      attribution:
        kind === "agreed"
          ? read.catalogVendorName
          : catalogAttribution(read.ownCatalogName, read.ownEditionYear),
      uncertain: kind === "agreed" ? read.agreedUncertain : read.ownUncertain,
      manual: kind === "agreed" ? read.agreedManual : read.ownManual,
    };
  }

  const sections: TradeShareSectionView[] = [];
  for (const section of trade.sections) {
    const sides: TradeShareSideView[] = [];
    for (const side of ["give", "receive"] as const) {
      const page = await listTradeLinePage(access.ownerId, access.tradeId, {
        sectionId: section.id,
        side,
        levels,
        pageSize: TRADE_SHARE_SIDE_LIMIT,
      });
      const lines = page.items.map((item) =>
        toShareLine(item, maps, areas, valueOf, realisationOf)
      );
      sides.push({
        side,
        heading: tradeShareSideHeading(side, trade.collection.name, trade.partner.name),
        lines,
        headings: page.headings,
        totals: tallySide(
          page.total,
          page.pieces,
          access.showValues ? (sideValues.get(`${section.id}:${side}`) ?? EMPTY_SIDE_VALUE) : null
        ),
        truncated: page.nextCursor !== null,
      });
    }
    sections.push({
      id: section.id,
      name: section.name,
      sides,
      colnectLists: section.colnectLists.map((list) => ({
        url: list.url,
        label: list.label,
        side: isTradeSide(list.side) ? list.side : "give",
      })),
    });
  }

  const flatSides = sections.flatMap((s) => s.sides);
  return {
    tradeNo: trade.tradeNo,
    collectorName: trade.collection.name,
    partnerName: trade.partner.name,
    statusLabel: TRADE_STATUS_LABEL[trade.status as TradeStatus],
    showValues: access.showValues,
    valuation: balance
      ? {
          kind,
          currency,
          catalogName: kind === "agreed" ? balance.agreedCatalogVendorName : null,
          // Only the rates that actually convert into the printed unit. A trade converts toward two
          // targets and a note listing the other one's would be a rate for a figure not on the page.
          rates: balance.rates.filter((rate) => rate.toCurrency === currency),
          frozen: balance.frozen,
        }
      : null,
    levels: [...levels],
    sections,
    totals: {
      give: sumTotals(flatSides.filter((s) => s.side === "give").map((s) => s.totals)),
      receive: sumTotals(flatSides.filter((s) => s.side === "receive").map((s) => s.totals)),
    },
  };
}

/** `Fischer 2024` — the book and the edition it was read at, which is what makes a column of figures
 *  out of several catalogues readable at all. */
function catalogAttribution(name: string | null, year: number | null): string | null {
  if (!name) return null;
  return year ? `${name} ${year}` : name;
}

const EMPTY_SIDE_VALUE = { value: 0, missing: 0 };

/** A side's tally. Every figure in it describes the **whole** side — the counts come from the page's
 *  own totals and the money from the balance read, neither of them from the rows printed — so a side
 *  that ran past the cap still states how long it is and what it is worth. */
function tallySide(
  total: number,
  pieces: number,
  money: { value: number; missing: number } | null
): TradeShareTotalsView {
  if (!money) return { lines: total, pieces, value: null, valueMissing: 0 };
  return {
    lines: total,
    pieces,
    value: Math.round(money.value * 100) / 100,
    valueMissing: money.missing,
  };
}

function sumTotals(all: readonly TradeShareTotalsView[]): TradeShareTotalsView {
  const out: TradeShareTotalsView = { lines: 0, pieces: 0, value: null, valueMissing: 0 };
  for (const t of all) {
    out.lines += t.lines;
    out.pieces += t.pieces;
    out.valueMissing += t.valueMissing;
    if (t.value !== null) out.value = Math.round(((out.value ?? 0) + t.value) * 100) / 100;
  }
  return out;
}

/**
 * One row of either side, reduced to what the partner's page prints.
 *
 * The two sides arrive as different things — a copy the collection holds, and a want key describing
 * material in nobody's inventory — and this is the one place they are made to read alike. That is
 * right here and wrong on the collector's screen, where the asymmetry *is* the model showing through
 * (a copy has a number, a location and a cost basis; a want key has none of it). On the partner's
 * page none of that exists to show: both sides are simply stamps, described the way a collector would
 * write them on a list, and the copy's internal handles are dropped here rather than merely left
 * undrawn — a field absent from the payload cannot be printed by a later edit to the page.
 */
function toShareLine(
  item: TradeLinePageItem,
  maps: ReturnType<typeof buildAreaVendorMaps>,
  areas: Awaited<ReturnType<typeof readCollectionAreas>>,
  valueOf: (lineId: string) => TradeShareValueView | null,
  realisationOf: (lineId: string) => string | null
): TradeShareLineView {
  const source =
    item.side === "give"
      ? {
          catalogNumbers: item.copy.catalogNumbers,
          name: item.copy.stampName,
          areaId: item.copy.areaId,
          issueId: item.copy.issueId,
          issueName: item.copy.issueName,
          issueYear: item.copy.issueYear,
          issuedDay: item.copy.issuedDay,
          issuedMonth: item.copy.issuedMonth,
          issuedYear: item.copy.issuedYear,
          condition: item.copy.conditionAbbreviation || item.copy.conditionName,
          certificate: item.copy.certificateStatusName,
          format: item.copy.formatAbbreviation || item.copy.formatName,
          // A give line is one copy, always — a multiple is one copy in one format, never N singles.
          quantity: 1,
          unknownVariant: item.copy.unknownVariant,
          photos: item.copy.photos,
        }
      : {
          catalogNumbers: item.line.catalogNumbers,
          name: item.line.stampName,
          areaId: item.line.areaId,
          issueId: item.line.issueId,
          issueName: item.line.issueName,
          issueYear: item.line.issueYear,
          issuedDay: item.line.issuedDay,
          issuedMonth: item.line.issuedMonth,
          issuedYear: item.line.issuedYear,
          condition: item.line.conditionAbbreviation || item.line.conditionName,
          certificate: item.line.certificateStatusName,
          format: item.line.formatAbbreviation || item.line.formatName,
          quantity: item.line.quantity,
          unknownVariant: item.line.unknownVariant,
          photos: item.line.photos,
        };

  const primaryVendorId = source.areaId
    ? (maps.primaryVendorByArea.get(source.areaId) ?? null)
    : null;
  const vendorMap = maps.vendorMapFor(source.areaId, source.issueId);
  const primary =
    source.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null;

  return {
    lineId: item.lineId,
    path: item.path,
    primaryNumber: primary ? formatStampCN(primary.number, vendorMap.get(primary.catalogVendorId)) : null,
    otherNumbers: source.catalogNumbers
      .filter((cn) => cn !== primary)
      .map((cn) => formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))),
    name: source.name,
    areaPath: source.areaId ? (buildAreaPath(areas, source.areaId) ?? null) : null,
    issueLabel: issueLabelOf(source.issueName, source.issueYear),
    issuedDay: source.issuedDay,
    issuedMonth: source.issuedMonth,
    issuedYear: source.issuedYear,
    condition: source.condition,
    certificate: source.certificate,
    format: source.format,
    quantity: source.quantity,
    unknownVariant: source.unknownVariant,
    photoIds: source.photos.map((photo) => photo.id),
    value: valueOf(item.lineId),
    realisation: realisationOf(item.lineId),
  };
}

/** `Chopin (1949)`, or whichever half of it there is. */
function issueLabelOf(name: string | null, year: number | null): string | null {
  if (name && year) return `${name} (${year})`;
  return name ?? (year ? String(year) : null);
}
