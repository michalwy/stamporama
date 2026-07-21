import "server-only";
import { prisma } from "./db";
import { valuateItemsByIds, listItemsPaginated, type ItemListItem } from "./items";
import {
  type LotKind,
  type LotState,
  type LotSaleStatus,
  isLotKind,
  canHoldItems,
  canHoldSubLots,
  checkKindInvariant,
  checkReadyable,
  deriveLotSaleStatus,
  deriveLotLabel,
  wouldCreateCycle,
  sameShape,
  isSingleComponentShape,
} from "./sale-lot-rules";

// Server-side domain logic for **sale-lot composition** (ADR-0012 §2/§3, #164). A `Lot` is
// the platform-agnostic package the collector composes from inventory copies and later lists
// (#165) / sells (#166). This module owns:
//   - lot create / rename / delete;
//   - membership: add/remove copies (unit lots), add/remove sub-lots (quantity lots);
//   - lifecycle: draft ↔ ready, and dissolve (unpack members back into inventory);
//   - the list + detail read models, and the eligible-copies / eligible-sub-lots pickers.
// The recursive-lot **kind invariants**, the derived sale status, and the cycle guard are the
// pure rules in `sale-lot-rules.ts`. All access is collection-owner-scoped. Composition never
// mutates the underlying `Item`s — a copy's inventory state is independent of its packaging,
// so dissolving a lot only drops the join rows.

// ── Errors ────────────────────────────────────────────────────────────────

export type LotBlockReason =
  | "empty"
  | "sold-member"
  | "wrong-kind"
  | "cycle"
  | "dissolved"
  | "shape"
  | "duplicate-item";

/** Raised when a composition/lifecycle action is refused by a domain guard. `message` is
 * user-facing; the server action maps it to an `{ status: "error" }` response. */
export class LotActionBlockedError extends Error {
  readonly reason: LotBlockReason;
  constructor(reason: LotBlockReason, message: string) {
    super(message);
    this.name = "LotActionBlockedError";
    this.reason = reason;
  }
}

// ── Ownership helpers ───────────────────────────────────────────────────────

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

interface LotRef {
  collectionId: string;
  kind: LotKind;
  state: LotState;
}

async function assertLotOwner(ownerId: string, lotId: string): Promise<LotRef> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: {
      collectionId: true,
      kind: true,
      state: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!lot || lot.collection.ownerId !== ownerId) {
    throw new Error("Lot not found or access denied.");
  }
  return {
    collectionId: lot.collectionId,
    kind: (isLotKind(lot.kind) ? lot.kind : "unit") as LotKind,
    state: lot.state as LotState,
  };
}

function assertNotDissolved(lot: LotRef): void {
  if (lot.state === "dissolved") {
    throw new LotActionBlockedError("dissolved", "This lot has been dissolved and is read-only.");
  }
}

// ── Sold-state derivation ───────────────────────────────────────────────────

/** Lot ids that have left on a sale line (ADR-0012 §3 — a unit lot / sub-lot is "sold" once
 * a `SaleLine` references it). Batched to avoid an N+1 across sub-lots. */
async function soldLotIds(lotIds: string[]): Promise<Set<string>> {
  if (lotIds.length === 0) return new Set();
  const rows = await prisma.saleLine.findMany({
    where: { lotId: { in: lotIds } },
    select: { lotId: true },
    distinct: ["lotId"],
  });
  return new Set(rows.map((r) => r.lotId));
}

/** Item ids that have left on a sale line (the DB-level no-double-sale guard, ADR-0012 §5). */
async function soldItemIds(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await prisma.saleLineItem.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface LotSubLotSummary {
  lotId: string;
  kind: LotKind;
  state: LotState;
  title: string | null;
  label: string;
  saleStatus: LotSaleStatus;
  /** Member copies (unit sub-lot) or member sub-lots (nested quantity sub-lot). */
  memberCount: number;
  value: string | null;
  sold: boolean;
  /** The sub-lot's copies as fully-enriched inventory rows, for the expandable detail view. */
  items: ItemListItem[];
}

export interface LotListItem {
  id: string;
  kind: LotKind;
  state: LotState;
  title: string | null;
  label: string;
  saleStatus: LotSaleStatus;
  /** Direct members: copies for a unit lot, sub-lots for a quantity lot. */
  memberCount: number;
  value: string | null;
  offerCount: number;
  /** How many quantity lots hold this lot as a sub-lot (0 = standalone). A grouped unit lot
   * still lists on the main screen — it can be offered on its own — but is flagged (#164). */
  groupedInto: number;
  createdAt: Date;
}

export interface LotDetail extends LotListItem {
  collectionId: string;
  /** Packaged copies as fully-enriched inventory rows (unit lots) — rendered with the same
   * `InventoryItemRow` grouped-by-issue view as a purchase order's lot (#164). */
  items: ItemListItem[];
  /** Item ids on this lot that have already left on a sale line (no-double-sale). */
  soldItemIds: string[];
  subLots: LotSubLotSummary[];
}

/** Sum base-currency catalog values across copies; null when nothing could be valued. */
async function valueItems(
  collectionId: string,
  itemIds: string[]
): Promise<string | null> {
  if (itemIds.length === 0) return null;
  const valuations = await valuateItemsByIds(collectionId, itemIds);
  let total = 0;
  let any = false;
  for (const id of itemIds) {
    const base = valuations.get(id)?.baseAmount;
    if (base != null) {
      total += base;
      any = true;
    }
  }
  return any ? total.toFixed(2) : null;
}

/** Direct copy ids of a unit lot, or the union of the copies under a quantity lot's
 * sub-lots (one level — sub-lots are unit lots in practice). Used for value aggregation. */
async function itemIdsUnderLot(lotId: string, kind: LotKind): Promise<string[]> {
  if (kind === "unit") {
    const rows = await prisma.lotItem.findMany({
      where: { lotId },
      select: { itemId: true },
    });
    return rows.map((r) => r.itemId);
  }
  const subLots = await prisma.lotSubLot.findMany({
    where: { parentLotId: lotId },
    select: { child: { select: { items: { select: { itemId: true } } } } },
  });
  return subLots.flatMap((s) => s.child.items.map((i) => i.itemId));
}

export interface LotListFilters {
  kind?: LotKind;
  state?: LotState;
  /** Drop unit lots that are grouped as a sub-lot of a quantity lot (default: keep + flag). */
  hideGrouped?: boolean;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedLotsResult {
  items: LotListItem[];
  nextCursor: string | null;
}

/** Paginated lot list for the Lots screen. Filters by kind + explicit state; the derived
 * sale status is computed per row (offset-paginated to feed the shared infinite-scroll). */
export async function listSaleLotsPaginated(
  ownerId: string,
  collectionId: string,
  filters: LotListFilters = {}
): Promise<PaginatedLotsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await prisma.lot.findMany({
    where: {
      collectionId,
      // Grouped unit lots stay on the list by default (they can be offered standalone) but are
      // flagged; the `hideGrouped` toggle drops them for a cleaner view (#164).
      ...(filters.hideGrouped ? { parentLots: { none: {} } } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.state ? { state: filters.state } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      kind: true,
      state: true,
      title: true,
      createdAt: true,
      items: { select: { item: { select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } } } } },
      subLots: {
        select: {
          childLotId: true,
          child: {
            select: {
              title: true,
              kind: true,
              items: { select: { item: { select: { stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } } } } } },
            },
          },
        },
      },
      _count: { select: { offers: true, parentLots: true } },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  // Batch the sold-status lookup: unit lots key on their own id; quantity lots on sub-lot ids.
  const soldLookupIds = page.flatMap((r) =>
    r.kind === "quantity" ? r.subLots.map((s) => s.childLotId) : [r.id]
  );
  const sold = await soldLotIds(soldLookupIds);

  const items: LotListItem[] = await Promise.all(
    page.map(async (row) => {
      const kind = (isLotKind(row.kind) ? row.kind : "unit") as LotKind;
      const memberCount = kind === "unit" ? row.items.length : row.subLots.length;
      const memberLabels =
        kind === "unit"
          ? row.items.map((li) => copyLabel(li.item.stamp))
          : row.subLots.map(
              (s) =>
                s.child.title ??
                deriveLotLabel(
                  (isLotKind(s.child.kind) ? s.child.kind : "unit") as LotKind,
                  s.child.title,
                  s.child.items.map((li) => copyLabel(li.item.stamp))
                )
            );
      const saleStatus = deriveLotSaleStatus({
        kind,
        selfSold: sold.has(row.id),
        subLotSold: kind === "quantity" ? row.subLots.map((s) => sold.has(s.childLotId)) : [],
      });
      return {
        id: row.id,
        kind,
        state: row.state as LotState,
        title: row.title,
        label: deriveLotLabel(kind, row.title, memberLabels),
        saleStatus,
        memberCount,
        value: await valueItems(collectionId, await itemIdsUnderLot(row.id, kind)),
        offerCount: row._count.offers,
        groupedInto: row._count.parentLots,
        createdAt: row.createdAt,
      };
    })
  );

  return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
}

/** Short copy label from a stamp select — primary catalog number, else name. */
function copyLabel(stamp: {
  name: string | null;
  catalogNumbers: { number: string }[];
}): string {
  return stamp.catalogNumbers[0]?.number ?? stamp.name ?? "Copy";
}

/** Full composition read model for the lot detail screen. */
export async function getSaleLotDetail(
  ownerId: string,
  lotId: string
): Promise<LotDetail | null> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: {
      id: true,
      collectionId: true,
      kind: true,
      state: true,
      title: true,
      createdAt: true,
      collection: { select: { ownerId: true } },
      items: { select: { itemId: true } },
      subLots: { select: { childLotId: true } },
      _count: { select: { offers: true, parentLots: true } },
    },
  });
  if (!lot || lot.collection.ownerId !== ownerId) return null;

  const kind = (isLotKind(lot.kind) ? lot.kind : "unit") as LotKind;
  const itemIds = lot.items.map((i) => i.itemId);
  const childLotIds = lot.subLots.map((s) => s.childLotId);

  // Unit-lot copies are rendered with the full inventory row, so load them as enriched
  // `ItemListItem`s (same shape/valuation as the Copies screen), matching a purchase lot.
  const [enriched, subLots, sold] = await Promise.all([
    itemIds.length > 0
      ? listItemsPaginated(ownerId, lot.collectionId, { ids: itemIds, pageSize: itemIds.length })
      : Promise.resolve({ items: [] as ItemListItem[], nextCursor: null }),
    loadSubLotSummaries(ownerId, lot.collectionId, childLotIds),
    soldItemIds(itemIds),
  ]);
  const items = enriched.items;

  const memberLabels =
    kind === "unit"
      ? items.map((it) => copyLabelFromItem(it))
      : subLots.map((s) => s.label);
  const memberCount = kind === "unit" ? items.length : subLots.length;
  const selfSold = (await soldLotIds([lot.id])).has(lot.id);
  const saleStatus = deriveLotSaleStatus({
    kind,
    selfSold,
    subLotSold: subLots.map((s) => s.sold),
  });

  return {
    id: lot.id,
    collectionId: lot.collectionId,
    kind,
    state: lot.state as LotState,
    title: lot.title,
    label: deriveLotLabel(kind, lot.title, memberLabels),
    saleStatus,
    memberCount,
    value: await valueItems(lot.collectionId, await itemIdsUnderLot(lot.id, kind)),
    offerCount: lot._count.offers,
    groupedInto: lot._count.parentLots,
    createdAt: lot.createdAt,
    items,
    soldItemIds: [...sold],
    subLots,
  };
}

/** Short copy label from an enriched item — primary catalog number, else stamp name. */
function copyLabelFromItem(item: ItemListItem): string {
  return item.catalogNumbers[0]?.number ?? item.stampName ?? "Copy";
}

/** Sum base-currency catalog values of enriched copies; null when nothing could be valued. */
function sumCopyValue(items: ItemListItem[]): string | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    if (it.value.baseAmount != null) {
      total += it.value.baseAmount;
      any = true;
    }
  }
  return any ? total.toFixed(2) : null;
}

async function loadSubLotSummaries(
  ownerId: string,
  collectionId: string,
  childLotIds: string[]
): Promise<LotSubLotSummary[]> {
  if (childLotIds.length === 0) return [];
  const [rows, sold] = await Promise.all([
    prisma.lot.findMany({
      where: { id: { in: childLotIds }, collectionId },
      select: {
        id: true,
        kind: true,
        state: true,
        title: true,
        items: { select: { itemId: true } },
        subLots: { select: { childLotId: true } },
      },
    }),
    soldLotIds(childLotIds),
  ]);

  // Enrich all sub-lot copies in one query, then distribute back to their sub-lot.
  const allItemIds = rows.flatMap((r) => r.items.map((li) => li.itemId));
  const enriched = allItemIds.length
    ? (await listItemsPaginated(ownerId, collectionId, { ids: allItemIds, pageSize: allItemIds.length })).items
    : [];
  const byItemId = new Map(enriched.map((it) => [it.id, it]));

  return rows.map((row) => {
    const kind = (isLotKind(row.kind) ? row.kind : "unit") as LotKind;
    const items = row.items
      .map((li) => byItemId.get(li.itemId))
      .filter((it): it is ItemListItem => it != null);
    const memberLabels = items.map((it) => copyLabelFromItem(it));
    const memberCount = kind === "unit" ? items.length : row.subLots.length;
    return {
      lotId: row.id,
      kind,
      state: row.state as LotState,
      title: row.title,
      label: deriveLotLabel(kind, row.title, memberLabels),
      saleStatus: deriveLotSaleStatus({ kind, selfSold: sold.has(row.id), subLotSold: [] }),
      memberCount,
      value: sumCopyValue(items),
      sold: sold.has(row.id),
      items,
    };
  });
}

// ── Pickers ─────────────────────────────────────────────────────────────────

/**
 * Copies **sellable** into a unit lot (ADR-0012 §2, #164): flagged **For sale**, physically
 * **delivered** (in hand — you can't package a copy still in transit), not already sold, and
 * not already in the target lot. `forSale` is the only disposition gate — a copy held purely
 * for sale need not also be marked *In collection* (the flags are orthogonal), so requiring
 * `inCollection` here would wrongly hide sale-only duplicates. Returned as fully
 * enriched `ItemListItem`s so the inventory picker can render them with the same rows,
 * catalog numbers, and valuation as the Copies screen, grouped issue → stamp → variant.
 * The `areaIds` / `search` / `year` filters mirror the inventory list so the picker filters
 * identically. Capped high — a collection's for-sale set is bounded in practice.
 */
export async function listSellableCopies(
  ownerId: string,
  collectionId: string,
  opts: {
    lotId?: string;
    areaIds?: string[];
    search?: string;
    year?: number | "none";
    /** Restrict to one stamp — the quantity-lot copy picker passes the lot's shape stamp so
     * only interchangeable copies show. */
    stampId?: string;
    /** Restrict to one condition — the quantity-lot copy picker passes the lot's shape
     * condition (condition must match for interchangeability). */
    conditionId?: string;
    /** Copy ids to hide (already represented under the target quantity lot). */
    excludeIds?: string[];
  } = {}
): Promise<ItemListItem[]> {
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    forSale: true,
    deliveryState: "delivered",
    excludeSold: true,
    notInSaleLotId: opts.lotId,
    stampId: opts.stampId,
    conditionId: opts.conditionId,
    excludeIds: opts.excludeIds,
    areaIds: opts.areaIds,
    search: opts.search,
    year: opts.year,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

/**
 * Unit lots eligible to add as sub-lots of a quantity lot (ADR-0012 §2): non-dissolved,
 * not-yet-grouped unit lots in this collection whose stamp **shape** matches the lot's (or any,
 * when the lot is still empty). Excludes the target lot. Sub-lots are unit lots — a quantity
 * lot groups interchangeable atomic units; nesting quantity lots is not offered.
 */
export async function listEligibleSubLots(
  ownerId: string,
  collectionId: string,
  parentLotId: string,
  opts: { limit?: number } = {}
): Promise<LotSubLotSummary[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const limit = Math.min(opts.limit ?? 100, 200);

  const rows = await prisma.lot.findMany({
    where: {
      collectionId,
      kind: "unit",
      state: { not: "dissolved" },
      id: { not: parentLotId },
      // Only unit lots that aren't already grouped under a quantity lot.
      parentLots: { none: {} },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      items: { select: { itemId: true, item: { select: { stampId: true, conditionId: true } } } },
    },
  });

  // Shape filter: keep only lots whose stamp × condition shape matches the parent's, and which
  // share no copy with what's already in the lot (a copy can be in only one sub-lot).
  const shape = await quantityLotShape(parentLotId);
  const alreadyUnder = new Set(await itemIdsUnderLot(parentLotId, "quantity"));
  const eligible = rows.filter((r) => {
    if (r.items.length === 0) return false;
    if (r.items.some((li) => alreadyUnder.has(li.itemId))) return false;
    const sig = r.items.map((li) => copyShapeKey(li.item.stampId, li.item.conditionId));
    return shape == null || sameShape(shape, sig);
  });
  return loadSubLotSummaries(ownerId, collectionId, eligible.map((r) => r.id));
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Create an empty lot of the given kind. Composition follows on the detail screen. */
export async function createSaleLot(
  ownerId: string,
  collectionId: string,
  kind: LotKind,
  title?: string | null
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const lot = await prisma.lot.create({
    data: { collectionId, kind, title: title?.trim() || null, state: "draft" },
    select: { id: true },
  });
  return lot.id;
}

/** Rename a lot (kind is fixed at creation; state has its own transitions). */
export async function updateSaleLot(
  ownerId: string,
  lotId: string,
  title: string | null
): Promise<void> {
  await assertLotOwner(ownerId, lotId);
  await prisma.lot.update({
    where: { id: lotId },
    data: { title: title?.trim() || null },
  });
}

/** Delete a lot. Blocked once anything on it has sold (the sale record must survive). */
export async function deleteSaleLot(ownerId: string, lotId: string): Promise<void> {
  await assertLotOwner(ownerId, lotId);
  const lines = await prisma.saleLine.count({ where: { lotId } });
  if (lines > 0) {
    throw new LotActionBlockedError(
      "sold-member",
      "This lot has sold and cannot be deleted."
    );
  }
  // Cascades drop lot_item / lot_sub_lot / offer rows; the underlying copies are untouched.
  await prisma.lot.delete({ where: { id: lotId } });
}

/** Add copies to a unit lot (idempotent on already-present copies). */
export async function addLotItems(
  ownerId: string,
  lotId: string,
  itemIds: string[]
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertNotDissolved(lot);
  if (!canHoldItems(lot.kind)) {
    throw new LotActionBlockedError(
      "wrong-kind",
      checkKindInvariant("unit", { itemCount: 1, subLotCount: 0 }) ??
        "Only unit lots hold copies directly."
    );
  }
  if (itemIds.length === 0) return;

  // Every copy must belong to this collection; a sold copy cannot be repackaged.
  const valid = await prisma.item.findMany({
    where: { id: { in: itemIds }, collectionId: lot.collectionId },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const sold = await soldItemIds([...validIds]);
  const addable = [...validIds].filter((id) => !sold.has(id));
  if (addable.length === 0) {
    throw new LotActionBlockedError("sold-member", "None of those copies can be added.");
  }
  await prisma.lotItem.createMany({
    data: addable.map((itemId) => ({ lotId, itemId })),
    skipDuplicates: true,
  });
}

export async function removeLotItem(
  ownerId: string,
  lotId: string,
  itemId: string
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertNotDissolved(lot);
  await prisma.lotItem.deleteMany({ where: { lotId, itemId } });
}

/** A copy's shape component — what makes two copies interchangeable: stamp × condition
 * (ADR-0012 §2, #164). Certificate is not part of the shape (a cert difference is a warning). */
function copyShapeKey(stampId: string, conditionId: string): string {
  return `${stampId}::${conditionId}`;
}

/** Shape component keys of the copies directly under a unit lot (stamp × condition). */
async function lotCopyShapeKeys(lotId: string): Promise<string[]> {
  const rows = await prisma.lotItem.findMany({
    where: { lotId },
    select: { item: { select: { stampId: true, conditionId: true } } },
  });
  return rows.map((r) => copyShapeKey(r.item.stampId, r.item.conditionId));
}

/** The established shape of a quantity lot — the component keys of one of its sub-lots (they are
 * all the same shape by construction) — or null when it has no sub-lots yet. */
async function quantityLotShape(parentLotId: string): Promise<string[] | null> {
  const first = await prisma.lotSubLot.findFirst({
    where: { parentLotId },
    select: { childLotId: true },
  });
  if (!first) return null;
  return lotCopyShapeKeys(first.childLotId);
}

const SHAPE_MISMATCH =
  "All sub-lots of a quantity lot must be interchangeable — the same stamp and condition.";

/** Add existing unit lots as sub-lots of a quantity lot, guarding kind, self-reference,
 * cycles, and shape (interchangeability — every sub-lot must have the same stamp shape). */
export async function addSubLots(
  ownerId: string,
  parentLotId: string,
  childLotIds: string[]
): Promise<void> {
  const lot = await assertLotOwner(ownerId, parentLotId);
  assertNotDissolved(lot);
  if (!canHoldSubLots(lot.kind)) {
    throw new LotActionBlockedError(
      "wrong-kind",
      checkKindInvariant("quantity", { itemCount: 0, subLotCount: 1 }) ??
        "Only quantity lots hold sub-lots."
    );
  }
  if (childLotIds.length === 0) return;

  // Children must be non-dissolved lots in the same collection.
  const children = await prisma.lot.findMany({
    where: {
      id: { in: childLotIds },
      collectionId: lot.collectionId,
      state: { not: "dissolved" },
    },
    select: { id: true },
  });
  const candidateIds = children.map((c) => c.id);
  if (candidateIds.length === 0) {
    throw new LotActionBlockedError("wrong-kind", "None of those lots can be added as sub-lots.");
  }

  // Cycle guard: build the current parent → child edge map and reject any edge that closes a
  // loop (a self-edge or one whose child already reaches the parent).
  const edgeRows = await prisma.lotSubLot.findMany({
    where: { parent: { collectionId: lot.collectionId } },
    select: { parentLotId: true, childLotId: true },
  });
  const edges = new Map<string, string[]>();
  for (const e of edgeRows) {
    const list = edges.get(e.parentLotId) ?? [];
    list.push(e.childLotId);
    edges.set(e.parentLotId, list);
  }
  for (const childId of candidateIds) {
    if (wouldCreateCycle(parentLotId, childId, edges)) {
      throw new LotActionBlockedError(
        "cycle",
        "That sub-lot would create a circular membership."
      );
    }
  }

  // Batch the candidates' copies: shape component keys (for the shape guard) and item ids (for
  // the no-duplicate guard).
  const memberRows = await prisma.lotItem.findMany({
    where: { lotId: { in: candidateIds } },
    select: { lotId: true, itemId: true, item: { select: { stampId: true, conditionId: true } } },
  });
  const keysByLot = new Map<string, string[]>();
  const itemsByLot = new Map<string, string[]>();
  for (const r of memberRows) {
    (keysByLot.get(r.lotId) ?? keysByLot.set(r.lotId, []).get(r.lotId)!).push(
      copyShapeKey(r.item.stampId, r.item.conditionId)
    );
    (itemsByLot.get(r.lotId) ?? itemsByLot.set(r.lotId, []).get(r.lotId)!).push(r.itemId);
  }

  // Shape guard: the lot's existing shape (or the first candidate's) fixes the stamp × condition
  // shape every other sub-lot must match.
  let shape = await quantityLotShape(parentLotId);
  for (const childId of candidateIds) {
    const sig = keysByLot.get(childId) ?? [];
    if (sig.length === 0) {
      throw new LotActionBlockedError("empty", "An empty lot cannot be added as a sub-lot.");
    }
    if (shape == null) shape = sig;
    else if (!sameShape(shape, sig)) {
      throw new LotActionBlockedError("shape", SHAPE_MISMATCH);
    }
  }

  // No-duplicate guard: a physical copy must appear at most once across the quantity lot's
  // sub-lots — you can't sell the same copy twice as two interchangeable units. Checks against
  // copies already in the lot and against the other candidates being added in this batch.
  const seenItems = new Set<string>(await itemIdsUnderLot(parentLotId, "quantity"));
  for (const childId of candidateIds) {
    for (const itemId of itemsByLot.get(childId) ?? []) {
      if (seenItems.has(itemId)) {
        throw new LotActionBlockedError(
          "duplicate-item",
          "That would put the same copy in the lot twice — each copy can belong to only one sub-lot."
        );
      }
      seenItems.add(itemId);
    }
  }

  await prisma.lotSubLot.createMany({
    data: candidateIds.map((childLotId) => ({ parentLotId, childLotId })),
    skipDuplicates: true,
  });
}

/**
 * Add inventory copies to a quantity lot (#164): each selected copy becomes its own `ready`
 * single-copy unit lot, wired in as a sub-lot — the fast path for a stock of interchangeable
 * duplicates. Copies must be **For sale**, **delivered**, unsold, and all the same stamp **and
 * condition**; that shape must match the lot's established single-component shape (or set it
 * when the lot is empty). Certificate is not checked here — a certificate difference only warns.
 */
export async function addCopiesAsSubLots(
  ownerId: string,
  parentLotId: string,
  itemIds: string[]
): Promise<void> {
  const lot = await assertLotOwner(ownerId, parentLotId);
  assertNotDissolved(lot);
  if (!canHoldSubLots(lot.kind)) {
    throw new LotActionBlockedError("wrong-kind", "Only quantity lots hold sub-lots.");
  }
  if (itemIds.length === 0) return;

  // Only sellable copies (For sale + delivered + unsold), in this collection, not already
  // represented under this quantity lot.
  const alreadyUnder = new Set(await itemIdsUnderLot(parentLotId, "quantity"));
  const valid = await prisma.item.findMany({
    where: {
      id: { in: itemIds.filter((id) => !alreadyUnder.has(id)) },
      collectionId: lot.collectionId,
      forSale: true,
      deliveryState: "delivered",
      saleLineItems: { none: {} },
    },
    select: { id: true, stampId: true, conditionId: true },
  });
  if (valid.length === 0) {
    throw new LotActionBlockedError("sold-member", "None of those copies can be added.");
  }

  // Every copy must share one stamp × condition component (certificate may differ — warned in
  // the UI, not blocked here).
  const keySet = new Set(valid.map((v) => copyShapeKey(v.stampId, v.conditionId)));
  if (keySet.size > 1) {
    throw new LotActionBlockedError(
      "shape",
      "Copies added to one quantity lot must all be the same stamp and condition (interchangeable units)."
    );
  }
  const key = [...keySet][0];

  const shape = await quantityLotShape(parentLotId);
  if (shape != null && !(isSingleComponentShape(shape) && sameShape(shape, [key]))) {
    throw new LotActionBlockedError("shape", SHAPE_MISMATCH);
  }

  await prisma.$transaction(async (tx) => {
    for (const v of valid) {
      const child = await tx.lot.create({
        data: { collectionId: lot.collectionId, kind: "unit", state: "ready", title: null },
        select: { id: true },
      });
      await tx.lotItem.create({ data: { lotId: child.id, itemId: v.id } });
      await tx.lotSubLot.create({ data: { parentLotId, childLotId: child.id } });
    }
  });
}

export async function removeSubLot(
  ownerId: string,
  parentLotId: string,
  childLotId: string
): Promise<void> {
  const lot = await assertLotOwner(ownerId, parentLotId);
  assertNotDissolved(lot);
  await prisma.$transaction(async (tx) => {
    await tx.lotSubLot.deleteMany({ where: { parentLotId, childLotId } });
    // Clean up an auto-created single-copy unit lot (untitled, one copy, no offers/sales) once
    // it is no longer grouped under any quantity lot — otherwise the "add copies" flow would
    // leave stray one-copy lots behind. User-made unit lots (titled or multi-copy) are kept.
    const child = await tx.lot.findUnique({
      where: { id: childLotId },
      select: {
        title: true,
        _count: { select: { parentLots: true, offers: true, saleLines: true, items: true } },
      },
    });
    if (
      child &&
      child.title == null &&
      child._count.parentLots === 0 &&
      child._count.offers === 0 &&
      child._count.saleLines === 0 &&
      child._count.items === 1
    ) {
      await tx.lot.delete({ where: { id: childLotId } });
    }
  });
}

/** Move a lot between `draft` and `ready`. Marking ready requires a non-empty lot. */
export async function setSaleLotState(
  ownerId: string,
  lotId: string,
  state: "draft" | "ready"
): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  assertNotDissolved(lot);
  if (state === "ready") {
    const [itemCount, subLotCount] = await Promise.all([
      prisma.lotItem.count({ where: { lotId } }),
      prisma.lotSubLot.count({ where: { parentLotId: lotId } }),
    ]);
    const violation = checkReadyable(lot.kind, { itemCount, subLotCount });
    if (violation) throw new LotActionBlockedError("empty", violation);
  }
  await prisma.lot.update({ where: { id: lotId }, data: { state } });
}

/**
 * Dissolve a lot: mark it `dissolved` and unpack its members back into inventory (drop the
 * join rows). The underlying copies are never touched, so they simply become available to
 * repackage. Blocked once anything on the lot has sold.
 */
export async function dissolveSaleLot(ownerId: string, lotId: string): Promise<void> {
  const lot = await assertLotOwner(ownerId, lotId);
  if (lot.state === "dissolved") return;
  const lines = await prisma.saleLine.count({ where: { lotId } });
  if (lines > 0) {
    throw new LotActionBlockedError("sold-member", "A sold lot cannot be dissolved.");
  }
  await prisma.$transaction([
    prisma.lotItem.deleteMany({ where: { lotId } }),
    prisma.lotSubLot.deleteMany({ where: { parentLotId: lotId } }),
    // Detach it from any quantity lot that held it as a sub-lot — it is no longer sellable.
    prisma.lotSubLot.deleteMany({ where: { childLotId: lotId } }),
    prisma.lot.update({ where: { id: lotId }, data: { state: "dissolved" } }),
  ]);
}
