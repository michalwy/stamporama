import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { resolvePurchaseContact } from "./contacts";
import { allocateEntityNumber } from "./items";
import {
  canTransitionTrade,
  isTradeContentEditable,
  isTradeStatus,
  TRADE_STATUS_LABEL,
  type TradeStatus,
} from "./trade-rules";
import { assertContentEditable, assertSectionOwner, assertTradeOwner } from "./trade-access";
import { tradeListingRefusal } from "./trade-reservations";
import {
  freezeTradeRates,
  freezeTradeValuations,
  readTradeGateBlockers,
  releaseTradeValuations,
} from "./trade-valuation";

/** The access guards live one module down (`trade-access.ts`), below both this module and the
 *  balancing engine that also asks them — see that file's header. Re-exported here because
 *  `trade-lines.ts` and the routes have always asked this module for them, and where a guard is
 *  defined is not their business. */
export { assertContentEditable, assertSectionOwner, assertTradeOwner };

// Server-side domain for trades (#646; ADR-0039): exchanges with another collector, their sections,
// and the lifecycle they move through. The vocabulary — statuses, transitions, sides, balance rules
// — lives in the pure `trade-rules.ts`; this module is the database half.
//
// What this module deliberately does **not** own: the lines themselves (#637 edits them), the
// valuations and verdicts (#638), the reservation of committed copies (#639), the partner's link
// (#640) and everything downstream of it. Each ships with the issue that reads it.
//
// All access is collection-owner-scoped and the checks live here, server-side.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The section a trade is created with, so that `TradeLine.sectionId` always has somewhere to
 * point. Named for what it is rather than for what will go in it — the collector renames it the
 * moment the trade has a shape, and "Mint" pre-filled would be a guess about their material. */
export const DEFAULT_TRADE_SECTION_NAME = "Main";

export type TradeSortBy = "createdAt" | "tradeNo";

/** One section, with its balance override read as the unit it is written as. */
export interface TradeSectionData {
  id: string;
  name: string;
  position: number;
  /** Null on all four = this section inherits the trade's rule whole. See `resolveBalanceRule`. */
  balanceByValue: boolean | null;
  countTolerance: number | null;
  valueTolerancePct: number | null;
  ownValueWarnPct: number | null;
  giveCount: number;
  receiveCount: number;
  /** Pieces on the receive side, which is not its line count — three lines can be thirty stamps. */
  receiveQuantity: number;
}

/** A trade with its sections, for the header dialog and the trade's own screen. */
export interface TradeData {
  id: string;
  collectionId: string;
  tradeNo: number;
  partnerId: string;
  partnerName: string;
  status: TradeStatus;
  currency: string;
  notes: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  catalogVendorId: string | null;
  catalogVendorName: string | null;
  balanceByValue: boolean;
  countTolerance: number;
  valueTolerancePct: number;
  ownValueWarnPct: number;
  createdAt: Date;
  sections: TradeSectionData[];
}

/**
 * A row in the trades list.
 *
 * Both sides are counted, and separately, because that difference is the trade: ten cheap ones for
 * two good ones is a normal value trade, and a single total would hide exactly the fact a collector
 * opens this list to see. `receiveQuantity` is counted apart from `receiveCount` for the same
 * reason — three lines can be thirty stamps.
 */
export interface TradeListItem {
  id: string;
  tradeNo: number;
  partnerId: string;
  partnerName: string;
  status: TradeStatus;
  currency: string;
  /** `notes` and `catalogVendorId` are not drawn on the row: they are here because the edit dialog
   *  is opened from this list and would otherwise need a second fetch to fill two fields. */
  notes: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  catalogVendorId: string | null;
  /** The vendor's abbreviation (`Mi`, `SW`) — what a row has room for and what a collector reads a
   *  catalog by. */
  catalogVendorName: string | null;
  balanceByValue: boolean;
  countTolerance: number;
  valueTolerancePct: number;
  ownValueWarnPct: number;
  sectionCount: number;
  giveCount: number;
  receiveCount: number;
  /** Pieces on the receive side — the sum of the lines' quantities, which is not their count. */
  receiveQuantity: number;
  createdAt: Date;
}

export interface TradeListFilters {
  offset?: number;
  status?: TradeStatus;
  partnerId?: string;
  /** Narrows to one trade number, which is what the quick jump and the search box both produce. */
  tradeNo?: number;
  /** Case-insensitive match on the partner's name. */
  partnerSearch?: string;
  sortBy?: TradeSortBy;
  sortDir?: "asc" | "desc";
  pageSize?: number;
}

export interface PaginatedTradesResult {
  items: TradeListItem[];
  nextCursor: string | null;
}

export interface TradeCreateInput {
  // The partner may arrive as a picked id or as a typed name resolved (or created) on save, exactly
  // as a purchase's supplier does. Unlike a supplier it may not end up null: an exchange is with
  // somebody, and a trade with no partner is half a record.
  partnerId?: string | null;
  partnerName?: string | null;
  currency: string;
  notes?: string | null;
  /** The agreed catalog **vendor**, not one of its books — see `Trade.catalogVendorId`. */
  catalogVendorId?: string | null;
  balanceByValue?: boolean;
  countTolerance?: number;
  valueTolerancePct?: number;
  ownValueWarnPct?: number;
}

export type TradeUpdateInput = TradeCreateInput;

/** What a section states, or clears. `balanceByValue: null` clears all four — a section states its
 * own rule whole or inherits the trade's whole. */
export interface TradeSectionInput {
  name: string;
  balanceByValue?: boolean | null;
  countTolerance?: number | null;
  valueTolerancePct?: number | null;
  ownValueWarnPct?: number | null;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value.toFixed(2));
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function readStatus(value: string): TradeStatus {
  return isTradeStatus(value) ? value : "preparing";
}

/** The balancing terms as Prisma writes them, shared by create and update so the two cannot come to
 * disagree about a default. */
function balanceData(data: TradeCreateInput) {
  return {
    balanceByValue: data.balanceByValue ?? false,
    countTolerance: Math.max(0, Math.trunc(data.countTolerance ?? 0)),
    valueTolerancePct: decimal(Math.max(0, data.valueTolerancePct ?? 0)),
    ownValueWarnPct: decimal(Math.max(0, data.ownValueWarnPct ?? 25)),
  };
}

const SECTION_SELECT = {
  id: true,
  name: true,
  position: true,
  balanceByValue: true,
  countTolerance: true,
  valueTolerancePct: true,
  ownValueWarnPct: true,
  lines: { select: { side: true, quantity: true } },
} satisfies Prisma.TradeSectionSelect;

function toSectionData(row: {
  id: string;
  name: string;
  position: number;
  balanceByValue: boolean | null;
  countTolerance: number | null;
  valueTolerancePct: Prisma.Decimal | null;
  ownValueWarnPct: Prisma.Decimal | null;
  lines: { side: string; quantity: number }[];
}): TradeSectionData {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    balanceByValue: row.balanceByValue,
    countTolerance: row.countTolerance,
    valueTolerancePct: decimalToNumber(row.valueTolerancePct),
    ownValueWarnPct: decimalToNumber(row.ownValueWarnPct),
    giveCount: row.lines.filter((l) => l.side === "give").length,
    receiveCount: row.lines.filter((l) => l.side === "receive").length,
    receiveQuantity: row.lines
      .filter((l) => l.side === "receive")
      .reduce((sum, l) => sum + l.quantity, 0),
  };
}

/**
 * Paginated trades for a collection (offset-based, mirroring `listPurchasesPaginated`).
 *
 * Newest first by default: a trade is worked on for a few weeks and then filed, so the ones being
 * negotiated now are the ones the screen is opened for.
 */
export async function listTradesPaginated(
  ownerId: string,
  collectionId: string,
  filters: TradeListFilters = {}
): Promise<PaginatedTradesResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const dir = filters.sortDir ?? "desc";
  const sortBy = filters.sortBy ?? "createdAt";
  const orderBy: Prisma.TradeOrderByWithRelationInput[] =
    sortBy === "tradeNo" ? [{ tradeNo: dir }] : [{ createdAt: dir }, { tradeNo: dir }];

  const rows = await prisma.trade.findMany({
    where: {
      collectionId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
      ...(filters.tradeNo ? { tradeNo: filters.tradeNo } : {}),
      ...(filters.partnerSearch
        ? { partner: { name: { contains: filters.partnerSearch, mode: "insensitive" } } }
        : {}),
    },
    orderBy,
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      tradeNo: true,
      partnerId: true,
      status: true,
      currency: true,
      notes: true,
      sentAt: true,
      receivedAt: true,
      catalogVendorId: true,
      balanceByValue: true,
      countTolerance: true,
      valueTolerancePct: true,
      ownValueWarnPct: true,
      createdAt: true,
      partner: { select: { name: true } },
      catalogVendor: { select: { abbreviation: true } },
      // Counted here rather than by five aggregate queries: a trade holds tens of lines, not
      // thousands, and the page is 50 rows — the same call `listPurchasesPaginated` makes for its
      // lot and expense totals.
      lines: { select: { side: true, quantity: true } },
      _count: { select: { sections: true } },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const items: TradeListItem[] = page.map((row) => ({
    id: row.id,
    tradeNo: row.tradeNo,
    partnerId: row.partnerId,
    partnerName: row.partner.name,
    status: readStatus(row.status),
    currency: row.currency,
    notes: row.notes,
    sentAt: isoOrNull(row.sentAt),
    receivedAt: isoOrNull(row.receivedAt),
    catalogVendorId: row.catalogVendorId,
    catalogVendorName: row.catalogVendor?.abbreviation ?? null,
    balanceByValue: row.balanceByValue,
    countTolerance: row.countTolerance,
    valueTolerancePct: decimalToNumber(row.valueTolerancePct) ?? 0,
    ownValueWarnPct: decimalToNumber(row.ownValueWarnPct) ?? 0,
    sectionCount: row._count.sections,
    giveCount: row.lines.filter((l) => l.side === "give").length,
    receiveCount: row.lines.filter((l) => l.side === "receive").length,
    receiveQuantity: row.lines
      .filter((l) => l.side === "receive")
      .reduce((sum, l) => sum + l.quantity, 0),
    createdAt: row.createdAt,
  }));

  return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
}

/** One trade with its sections. Returns `null` if not found / not owned. */
export async function getTrade(ownerId: string, tradeId: string): Promise<TradeData | null> {
  const row = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true,
      collectionId: true,
      tradeNo: true,
      partnerId: true,
      status: true,
      currency: true,
      notes: true,
      sentAt: true,
      receivedAt: true,
      catalogVendorId: true,
      balanceByValue: true,
      countTolerance: true,
      valueTolerancePct: true,
      ownValueWarnPct: true,
      createdAt: true,
      collection: { select: { ownerId: true } },
      partner: { select: { name: true } },
      catalogVendor: { select: { abbreviation: true } },
      sections: { select: SECTION_SELECT, orderBy: [{ position: "asc" }, { name: "asc" }] },
    },
  });
  if (!row || row.collection.ownerId !== ownerId) return null;

  return {
    id: row.id,
    collectionId: row.collectionId,
    tradeNo: row.tradeNo,
    partnerId: row.partnerId,
    partnerName: row.partner.name,
    status: readStatus(row.status),
    currency: row.currency,
    notes: row.notes,
    sentAt: isoOrNull(row.sentAt),
    receivedAt: isoOrNull(row.receivedAt),
    catalogVendorId: row.catalogVendorId,
    catalogVendorName: row.catalogVendor?.abbreviation ?? null,
    balanceByValue: row.balanceByValue,
    countTolerance: row.countTolerance,
    valueTolerancePct: decimalToNumber(row.valueTolerancePct) ?? 0,
    ownValueWarnPct: decimalToNumber(row.ownValueWarnPct) ?? 0,
    createdAt: row.createdAt,
    sections: row.sections.map(toSectionData),
  };
}

/** The agreed catalog vendor, verified to belong to this collection — a tampered or
 * cross-collection id is dropped rather than stored. */
async function resolveCatalogVendor(
  collectionId: string,
  catalogVendorId: string | null | undefined
): Promise<string | null> {
  const id = catalogVendorId?.trim();
  if (!id) return null;
  const found = await prisma.catalogVendor.findFirst({
    where: { id, collectionId },
    select: { id: true },
  });
  return found?.id ?? null;
}

/**
 * Create a trade against an exchange partner.
 *
 * The partner is resolved (or created on the fly) exactly as a purchase's supplier is, carrying the
 * `exchangePartner` role — the same find-or-create the trading pickers use everywhere else, so a
 * partner typed here and one picked from Contacts are the same row.
 *
 * A trade is created **with one section**, because `TradeLine.sectionId` is required and a trade
 * with no sections is a trade nothing can be put into. One section is also the honest default: most
 * exchanges are one bag of stamps for another, and splitting mint from used is a decision the
 * collector makes when their material asks for it.
 */
export async function createTrade(
  ownerId: string,
  collectionId: string,
  data: TradeCreateInput
): Promise<TradeData> {
  await assertCollectionOwner(ownerId, collectionId);

  const currency = data.currency.trim();
  if (!currency) throw new Error("A trade currency is required.");

  const partnerId = await resolvePurchaseContact(collectionId, {
    id: data.partnerId,
    name: data.partnerName,
    role: "exchangePartner",
  });
  if (!partnerId) throw new Error("An exchange partner is required.");

  const catalogVendorId = await resolveCatalogVendor(collectionId, data.catalogVendorId);

  // In a transaction for the number's sake (#432): the counter bump, the trade and its first section
  // stand or fall together, or a failed create would burn a number or leave a sectionless trade.
  const created = await prisma.$transaction(async (tx) =>
    tx.trade.create({
      data: {
        collectionId,
        tradeNo: await allocateEntityNumber(tx, collectionId, "trade"),
        partnerId,
        currency,
        notes: data.notes?.trim() || null,
        catalogVendorId,
        ...balanceData(data),
        sections: { create: [{ name: DEFAULT_TRADE_SECTION_NAME, position: 0 }] },
      },
      select: { id: true },
    })
  );

  return (await getTrade(ownerId, created.id))!;
}

/**
 * Update a trade's header and its balancing terms.
 *
 * Its sections and lines are deliberately untouched here, and so is its status: a status change is a
 * transition with rules of its own (`setTradeStatus`), not a field on a form that can be typed past
 * a lock.
 */
export async function updateTrade(
  ownerId: string,
  tradeId: string,
  data: TradeUpdateInput
): Promise<TradeData> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);

  const currency = data.currency.trim();
  if (!currency) throw new Error("A trade currency is required.");

  const partnerId = await resolvePurchaseContact(collectionId, {
    id: data.partnerId,
    name: data.partnerName,
    role: "exchangePartner",
  });
  if (!partnerId) throw new Error("An exchange partner is required.");

  const catalogVendorId = await resolveCatalogVendor(collectionId, data.catalogVendorId);

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      partnerId,
      currency,
      notes: data.notes?.trim() || null,
      catalogVendorId,
      ...balanceData(data),
    },
  });

  return (await getTrade(ownerId, tradeId))!;
}

/**
 * Move a trade along its lifecycle.
 *
 * The transition table is the authority (`trade-rules.ts`), and an illegal move is refused by name
 * rather than silently ignored: "Cannot move a closed trade back to preparing" is something the
 * collector can act on, where a no-op looks like a broken button.
 *
 * Three of the transitions do more than write a column (#638), and all three are here rather than in
 * the engine because they are things that happen to a *trade* when its status changes:
 *
 *   - **Into `shared` or `agreed`**: the valuation gates. A trade may not be sent to a partner, nor
 *     agreed, while a line on either side has no value at all — a total resting on an unspoken zero
 *     is a total that lies. Re-run on every attempt rather than stamped once, so a line added while
 *     the trade was `shared` cannot slip through on a check that passed last week, and refused
 *     **by name** (#418's shape): "3 lines are unvalued" and nothing more sends the collector
 *     hunting through both sides of every section.
 *   - **Into `shared`**: the rates freeze. From here the trade's figures are read at the rates the
 *     two sides negotiated under, refreshable while the negotiation runs (`refreshTradeRates`).
 *   - **Into `agreed`**: both valuations freeze onto the lines, and back out of it they are
 *     released. One rule: what is editable is not frozen.
 *
 * And one more at `agreed` alone (#639): the give side is committed there, so a copy already live on
 * a marketplace is refused by name. See `trade-reservations.ts` — it is the mirror of the gate the
 * offer's own move to `active` runs, one collision refused from whichever end it is met at.
 */
export async function setTradeStatus(
  ownerId: string,
  tradeId: string,
  status: TradeStatus
): Promise<void> {
  const { status: from } = await assertTradeOwner(ownerId, tradeId);
  if (from === status) return;
  if (!canTransitionTrade(from, status)) {
    throw new Error(
      `A ${TRADE_STATUS_LABEL[from].toLowerCase()} trade cannot become ${TRADE_STATUS_LABEL[
        status
      ].toLowerCase()}.`
    );
  }

  if (status === "shared" || status === "agreed") {
    const blockers = await readTradeGateBlockers(tradeId);
    if (blockers.length > 0) {
      const verb = status === "shared" ? "shared with your partner" : "agreed";
      throw new Error(
        `This trade cannot be ${verb} yet. ${blockers.map((b) => b.message).join(" ")}`
      );
    }
  }

  // Agreeing is the moment the give side is committed (#639), so it is the moment a copy already up
  // on a marketplace has to be dealt with: promising a partner a stamp a stranger can buy in the
  // next minute is a promise the collector cannot keep. Refused by name, like every other refusal a
  // trade makes, and asked **only** at `agreed` — sharing a list is showing someone what you have,
  // not committing it, and the mirror of this gate on the offer's end refuses at `active` for the
  // same reason. Re-run on every attempt rather than stamped once: a copy listed the day after a
  // failed attempt must not slip through on a check that passed then.
  if (status === "agreed") {
    const refusal = await tradeListingRefusal(tradeId);
    if (refusal) throw new Error(`This trade cannot be agreed yet. ${refusal}`);
  }

  await prisma.trade.update({ where: { id: tradeId }, data: { status } });

  // After the write, so a trade that failed to move is never left carrying the new state's
  // snapshot. Each of the three is idempotent, and none of them is reached by a transition that
  // does not call for it.
  if (status === "shared") await freezeTradeRates(tradeId);
  if (status === "agreed") await freezeTradeValuations(tradeId);
  if (isTradeContentEditable(status)) await releaseTradeValuations(tradeId);
}

/**
 * Record that a parcel went out, or that one arrived.
 *
 * Two independent timestamps, set in either order and clearable — which is the whole reason they are
 * not statuses. Not gated on the lifecycle either: a parcel that has already been posted is a fact,
 * and an app that refused to write it down would just be wrong.
 */
export async function setTradeShipping(
  ownerId: string,
  tradeId: string,
  shipping: { sentAt?: Date | null; receivedAt?: Date | null }
): Promise<void> {
  await assertTradeOwner(ownerId, tradeId);
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      ...(shipping.sentAt !== undefined ? { sentAt: shipping.sentAt } : {}),
      ...(shipping.receivedAt !== undefined ? { receivedAt: shipping.receivedAt } : {}),
    },
  });
}

/** Delete a trade with its sections and lines (cascade). The copies it named are untouched — a
 * `give` line is a promise about a copy, never a claim on it, and `onDelete: Restrict` runs the
 * other way (a copy cannot be deleted while a trade names it). */
export async function deleteTrade(ownerId: string, tradeId: string): Promise<void> {
  await assertTradeOwner(ownerId, tradeId);
  await prisma.trade.delete({ where: { id: tradeId } });
}

// ── Sections ─────────────────────────────────────────────────────────────────────────────────────
//
// Managed here so the trade screen (#637) is a screen over rules that already exist. A section is a
// name and a balance rule; nothing is ever assigned to one automatically — mint separate from used
// is the motivating case and nothing about it needs a mechanism.

/** The override columns as Prisma writes them. Written and cleared **as a unit**: a section states
 * its own rule whole or inherits the trade's whole, so `balanceByValue: null` nulls all four. */
function sectionOverrideData(data: TradeSectionInput) {
  if (data.balanceByValue === null || data.balanceByValue === undefined) {
    return {
      balanceByValue: null,
      countTolerance: null,
      valueTolerancePct: null,
      ownValueWarnPct: null,
    };
  }
  return {
    balanceByValue: data.balanceByValue,
    countTolerance: Math.max(0, Math.trunc(data.countTolerance ?? 0)),
    valueTolerancePct: decimal(Math.max(0, data.valueTolerancePct ?? 0)),
    ownValueWarnPct:
      data.ownValueWarnPct === null || data.ownValueWarnPct === undefined
        ? null
        : decimal(Math.max(0, data.ownValueWarnPct)),
  };
}

/** Add a section, appended after the existing ones. */
export async function createTradeSection(
  ownerId: string,
  tradeId: string,
  data: TradeSectionInput
): Promise<TradeSectionData> {
  const { status } = await assertTradeOwner(ownerId, tradeId);
  assertContentEditable(status);

  const name = data.name.trim();
  if (!name) throw new Error("A section name is required.");

  const last = await prisma.tradeSection.findFirst({
    where: { tradeId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const created = await prisma.tradeSection.create({
    data: {
      tradeId,
      name,
      position: (last?.position ?? -1) + 1,
      ...sectionOverrideData(data),
    },
    select: SECTION_SELECT,
  });
  return toSectionData(created);
}

/** Rename a section and/or restate its balance rule. */
export async function updateTradeSection(
  ownerId: string,
  sectionId: string,
  data: TradeSectionInput
): Promise<TradeSectionData> {
  const { status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);

  const name = data.name.trim();
  if (!name) throw new Error("A section name is required.");

  const updated = await prisma.tradeSection.update({
    where: { id: sectionId },
    data: { name, ...sectionOverrideData(data) },
    select: SECTION_SELECT,
  });
  return toSectionData(updated);
}

/**
 * Rename a section, touching **nothing else** (#637).
 *
 * Separate from `updateTradeSection` because that one writes the balance override as a unit — which
 * is right when the rule is what is being edited, and wrong when a name is being corrected in place:
 * a rename would have to restate all four columns to keep them, and a caller that forgot one would
 * silently drop a section's own rule.
 */
export async function renameTradeSection(
  ownerId: string,
  sectionId: string,
  name: string
): Promise<void> {
  const { status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A section name is required.");
  await prisma.tradeSection.update({ where: { id: sectionId }, data: { name: trimmed } });
}

/** Hand-ordered sections, dragged rather than typed. Ids not belonging to the trade are ignored. */
export async function reorderTradeSections(
  ownerId: string,
  tradeId: string,
  orderedIds: string[]
): Promise<void> {
  const { status } = await assertTradeOwner(ownerId, tradeId);
  assertContentEditable(status);

  const own = await prisma.tradeSection.findMany({
    where: { tradeId },
    select: { id: true },
  });
  const ownIds = new Set(own.map((s) => s.id));
  const ordered = orderedIds.filter((id) => ownIds.has(id));

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.tradeSection.update({ where: { id }, data: { position: index } })
    )
  );
}

/**
 * Delete a section.
 *
 * Only when it is empty — moving lines somewhere by implication is exactly the kind of silent
 * reshuffle a trade both sides are reading must never do — and never the last one, because
 * `TradeLine.sectionId` is required and a sectionless trade is a trade nothing can be put into.
 */
export async function deleteTradeSection(ownerId: string, sectionId: string): Promise<void> {
  const { tradeId, status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);

  const lineCount = await prisma.tradeLine.count({ where: { sectionId } });
  if (lineCount > 0) {
    throw new Error("Only an empty section can be deleted. Move or remove its lines first.");
  }

  const sectionCount = await prisma.tradeSection.count({ where: { tradeId } });
  if (sectionCount <= 1) {
    throw new Error("A trade keeps at least one section. Rename this one instead.");
  }

  await prisma.tradeSection.delete({ where: { id: sectionId } });
}
