import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { valuateItemsByIds } from "./items";
import {
  computeLotPool,
  allocateLot,
  LotCloseBlockedError,
  type PurchaseCosts,
  type LotItem,
  type DeliveryState,
} from "./purchase-allocation";

// Server-side domain logic for the lot intake + open/close lifecycle (ADR-0009 §3/§5,
// #121). A `PurchaseLot` is a priced inventory line that resolves into `Item`s over
// time. This module owns:
//   - lot create / edit-price / delete (the purchase CRUD dialog does not manage lines);
//   - lot close (run the pure allocation engine, freeze per-item cost-basis snapshots)
//     and reopen (return items to pending);
//   - the purchase-detail read model that the intake screen renders.
// Item intake itself (`intakeStamps`) bulk-creates the `Item`s linked to a lot, marked
// `ordered` and not yet in the collection (a purchased copy is a holding only once it
// arrives). All access is collection-owner-scoped.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve the owning collection + purchase of a lot, asserting ownership. */
async function assertLotOwner(
  ownerId: string,
  lotId: string
): Promise<{ collectionId: string; purchaseId: string; status: string }> {
  const lot = await prisma.purchaseLot.findUnique({
    where: { id: lotId },
    select: {
      status: true,
      purchaseId: true,
      purchase: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!lot || lot.purchase.collection.ownerId !== ownerId) {
    throw new Error("Lot not found or access denied.");
  }
  return {
    collectionId: lot.purchase.collectionId,
    purchaseId: lot.purchaseId,
    status: lot.status,
  };
}

async function assertPurchaseOwner(
  ownerId: string,
  purchaseId: string
): Promise<{ collectionId: string }> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new Error("Purchase not found or access denied.");
  }
  return { collectionId: purchase.collectionId };
}

function money(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2));
}

function parsePrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("A lot price must be a non-negative number.");
  }
  return Math.round(price * 100) / 100;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/** A lot as shown on the purchase-detail screen: its price, lifecycle status, how many
 * copies have been identified into it, and its resolved cost pool (ADR-0009 §3.2) in
 * both the transaction and base currency. */
export interface LotSummary {
  id: string;
  /** Stored free-text title, or null when the lot has none. The UI derives a label from the
   * lot's copies' catalog numbers when this is null (#121). */
  title: string | null;
  price: string;
  status: string;
  itemCount: number;
  /** price + share of shared cost, transaction currency (2 dp). */
  poolTx: string;
  /** poolTx at the frozen FX rate, base currency (2 dp), or null when no rate is known. */
  poolBase: string | null;
}

export interface PurchaseDetail {
  id: string;
  collectionId: string;
  contactName: string | null;
  platformName: string | null;
  purchasedAt: string;
  currency: string;
  baseCurrency: string;
  fxRateToBase: string | null;
  shippingCost: string | null;
  status: string;
  lots: LotSummary[];
  expenseCount: number;
  /** lots + expenses + shipping, transaction currency (2 dp). */
  total: string;
}

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Full purchase with its lots (each carrying an item count and resolved pool) for the
 * intake screen. Returns null if not found / not owned. */
export async function getPurchaseDetail(
  ownerId: string,
  purchaseId: string
): Promise<PurchaseDetail | null> {
  const row = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      collectionId: true,
      purchasedAt: true,
      currency: true,
      fxRateToBase: true,
      shippingCost: true,
      status: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
      contact: { select: { name: true } },
      platform: { select: { name: true } },
      lots: {
        select: {
          id: true,
          title: true,
          price: true,
          status: true,
          _count: { select: { items: true } },
        },
        orderBy: { id: "asc" },
      },
      expenses: { select: { id: true, price: true } },
    },
  });
  if (!row || row.collection.ownerId !== ownerId) return null;

  const fxRateToBase = row.fxRateToBase != null ? Number(row.fxRateToBase) : null;
  // The pool can be expressed in the base currency either when a rate is frozen, or when
  // the transaction currency IS the base currency (an implicit 1:1 rate — `fxRateToBase`
  // is deliberately left null in that case). Only a genuinely-unknown cross-currency rate
  // leaves the base pool unavailable.
  const canExpressBase =
    fxRateToBase != null || row.currency === row.collection.baseCurrency;
  const costs: PurchaseCosts = {
    shippingCost: row.shippingCost != null ? Number(row.shippingCost) : 0,
    lots: row.lots.map((l) => ({ id: l.id, price: Number(l.price) })),
    expenses: row.expenses.map((e) => ({ id: e.id, price: Number(e.price) })),
    fxRateToBase,
  };

  const lots: LotSummary[] = row.lots.map((l) => {
    const pool = computeLotPool(costs, l.id);
    return {
      id: l.id,
      title: l.title,
      price: l.price.toFixed(2),
      status: l.status,
      itemCount: l._count.items,
      poolTx: pool.poolTx.toFixed(2),
      poolBase: canExpressBase ? pool.poolBase.toFixed(2) : null,
    };
  });

  const linesTotal = [...row.lots, ...row.expenses].reduce(
    (sum, l) => sum.add(l.price),
    new Prisma.Decimal(0)
  );
  const total = row.shippingCost ? linesTotal.add(row.shippingCost) : linesTotal;

  return {
    id: row.id,
    collectionId: row.collectionId,
    contactName: row.contact?.name ?? null,
    platformName: row.platform?.name ?? null,
    purchasedAt: dateToIso(row.purchasedAt),
    currency: row.currency,
    baseCurrency: row.collection.baseCurrency,
    fxRateToBase: row.fxRateToBase?.toString() ?? null,
    shippingCost: row.shippingCost?.toFixed(2) ?? null,
    status: row.status,
    lots,
    expenseCount: row.expenses.length,
    total: total.toFixed(2),
  };
}

// The enriched per-copy rows for a lot come from `listLotCopies` (items.ts), which reuses
// the same valuation pipeline as the Copies screen so lot rows render identically.

// ---------------------------------------------------------------------------
// Lot mutations
// ---------------------------------------------------------------------------

/** Add a new open lot to a purchase. Lines are managed here (during intake), not in the
 * purchase header dialog (ADR-0009, #120/#121). */
export async function createLot(
  ownerId: string,
  purchaseId: string,
  price: number,
  title?: string | null
): Promise<string> {
  await assertPurchaseOwner(ownerId, purchaseId);
  const lot = await prisma.purchaseLot.create({
    data: {
      purchaseId,
      title: title?.trim() || null,
      price: money(parsePrice(price)),
      status: "open",
    },
    select: { id: true },
  });
  return lot.id;
}

/** Create a new open lot and immediately identify stamps into it (the "add lot with stamps"
 * intake flow, #121) — the inverse of creating an empty lot and filling it later. Reuses
 * `createLot` + `intakeStamps`; if the intake fails (e.g. a bad condition or an issue with no
 * required members) the just-created lot is removed so no empty lot is left behind. Returns
 * the new lot id and how many copies were created. */
export async function createLotWithStamps(
  ownerId: string,
  purchaseId: string,
  input: {
    price: number;
    title?: string | null;
    stampId?: string | null;
    issueId?: string | null;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
  }
): Promise<{ lotId: string; count: number }> {
  const lotId = await createLot(ownerId, purchaseId, input.price, input.title);
  try {
    const count = await intakeStamps(ownerId, lotId, {
      stampId: input.stampId,
      issueId: input.issueId,
      conditionId: input.conditionId,
      certificateStatusId: input.certificateStatusId,
      locationId: input.locationId,
    });
    return { lotId, count };
  } catch (err) {
    // Compensate: drop the empty lot we created so a failed intake doesn't strand it.
    await prisma.purchaseLot.delete({ where: { id: lotId } }).catch(() => {});
    throw err;
  }
}

/** Edit a lot's price while it is still open. A closed lot's price is frozen into the
 * cost-basis snapshots; changing it is a structural recompute (ADR-0009 §3.5, #122), so
 * it is rejected here — reopen the lot first. */
export async function updateLot(
  ownerId: string,
  lotId: string,
  data: { price: number; title?: string | null }
): Promise<void> {
  const { status } = await assertLotOwner(ownerId, lotId);
  if (status !== "open") {
    throw new Error("Reopen the lot before changing its price.");
  }
  await prisma.purchaseLot.update({
    where: { id: lotId },
    data: { title: data.title?.trim() || null, price: money(parsePrice(data.price)) },
  });
}

/** Delete a lot **and all of its copies** (#121). A lot's copies exist only to populate it
 * (they are created `ordered`, not in the collection — see `intakeStamps` / `removeLotItem`),
 * so deleting the lot deletes them too rather than stranding them; `Item.lotId onDelete:
 * Restrict` would otherwise block the delete. Done in one transaction. */
export async function deleteLot(ownerId: string, lotId: string): Promise<void> {
  const { collectionId } = await assertLotOwner(ownerId, lotId);
  await prisma.$transaction(async (tx) => {
    await tx.item.deleteMany({ where: { lotId, collectionId } });
    await tx.purchaseLot.delete({ where: { id: lotId } });
  });
}

/** Remove a copy from its lot. Copies are created by intake purely to populate the lot
 * (ADR-0009 §5, #121), so removing one from the lot **deletes** the underlying `Item`
 * rather than orphaning an `ordered` copy that was never really in the collection. */
export async function removeLotItem(ownerId: string, itemId: string): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true },
  });
  if (!item) throw new Error("Copy not found.");
  await assertCollectionOwner(ownerId, item.collectionId);
  await prisma.item.delete({ where: { id: itemId } });
}

/** Identify stamps into an open lot (intake, ADR-0009 §5, #121). Accepts either a single
 * `stampId` or an `issueId` (which fans out to every **required-for-completeness** member
 * of that issue). Every created copy shares the given condition, certificate, and storage
 * location, is linked to the lot, and is **not** in the collection — a purchased copy is not a
 * holding until it is sorted. New copies enter as `ordered`, or `to_sort` when the order has
 * already arrived (they were identified during the sort pass). Returns how many were created. */
export async function intakeStamps(
  ownerId: string,
  lotId: string,
  input: {
    stampId?: string | null;
    issueId?: string | null;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
  }
): Promise<number> {
  const { collectionId, purchaseId, status } = await assertLotOwner(ownerId, lotId);
  if (status !== "open") {
    throw new Error("This lot is closed. Reopen it before identifying more copies.");
  }

  // Once the order has arrived, copies identified during the sort pass skip `ordered` and
  // land straight in `to_sort` — they are already in hand, just not filed yet (#121).
  const purchase = await prisma.purchase.findUniqueOrThrow({
    where: { id: purchaseId },
    select: { status: true },
  });
  const deliveryState = purchase.status === "arrived" ? "to_sort" : "ordered";

  const conditionId = input.conditionId?.trim();
  if (!conditionId) throw new Error("A condition is required.");
  const condition = await prisma.stampCondition.findFirst({
    where: { id: conditionId, collectionId },
    select: { id: true },
  });
  if (!condition) throw new Error("Condition not found in this collection.");

  const certificateStatusId = input.certificateStatusId?.trim() || null;
  if (certificateStatusId) {
    const cert = await prisma.certificateStatus.findFirst({
      where: { id: certificateStatusId, collectionId },
      select: { id: true },
    });
    if (!cert) throw new Error("Certificate status not found in this collection.");
  }

  // Storage location is optional at intake; when set it must be an assignable node of this
  // collection (grouping-only nodes cannot hold copies, #56).
  const locationId = input.locationId?.trim() || null;
  if (locationId) {
    const location = await prisma.location.findFirst({
      where: { id: locationId, collectionId },
      select: { assignable: true },
    });
    if (!location) throw new Error("Location not found in this collection.");
    if (!location.assignable) {
      throw new Error("This location cannot hold copies. Pick an assignable location.");
    }
  }

  // Resolve the target stamp ids: a whole issue expands to its required members.
  let stampIds: string[];
  if (input.issueId) {
    const issue = await prisma.issue.findFirst({
      where: { id: input.issueId, collectionId },
      select: {
        members: {
          where: { requiredForCompleteness: true },
          select: { stampId: true },
        },
      },
    });
    if (!issue) throw new Error("Issue not found in this collection.");
    stampIds = issue.members.map((m) => m.stampId);
    if (stampIds.length === 0) {
      throw new Error("This issue has no stamps marked required for completeness.");
    }
  } else if (input.stampId) {
    const stamp = await prisma.stamp.findFirst({
      where: { id: input.stampId, collectionId },
      select: { id: true },
    });
    if (!stamp) throw new Error("Stamp not found in this collection.");
    stampIds = [input.stampId];
  } else {
    throw new Error("Nothing selected to add.");
  }

  await prisma.item.createMany({
    data: stampIds.map((stampId) => ({
      collectionId,
      stampId,
      conditionId,
      certificateStatusId,
      locationId,
      inCollection: false,
      forSale: false,
      forTrade: false,
      lotId,
      deliveryState,
    })),
  });
  return stampIds.length;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Outcome of a close attempt. On block, `itemIds` names the copies to fix. */
export type CloseLotResult =
  | { ok: true; snapshotCount: number }
  | { ok: false; reason: "missing-price" | "zero-weight" | "empty"; itemIds: string[] };

/** Close a lot: resolve its pool from the whole-purchase costs, distribute it across its
 * copies by catalog-price weight (ADR-0009 §3), and freeze each copy's base-currency
 * cost-basis snapshot — all in one transaction, alongside flipping the lot to `closed`.
 * Not-delivered copies are dropped from the split and keep a null cost-basis. Returns a
 * structured block result instead of throwing when the pool cannot be split. */
export async function closeLot(ownerId: string, lotId: string): Promise<CloseLotResult> {
  const { collectionId, purchaseId, status } = await assertLotOwner(ownerId, lotId);
  if (status !== "open") {
    // Idempotent-ish: closing an already-closed lot is a no-op success.
    return { ok: true, snapshotCount: 0 };
  }

  // Value the lot's copies from reference data (catalog prices, FX rates) — data the close
  // itself never mutates, so it stays outside the write transaction. Copies added or removed
  // between here and the txn are reconciled below: a copy present in the txn but absent from
  // `valuations` resolves to a null weight and blocks the close (never a wrong snapshot).
  const valuationItems = await prisma.item.findMany({
    where: { lotId, collectionId },
    select: { id: true },
  });
  // Empty-lot guard up front, so we can return the friendly `empty` block without opening a
  // transaction (the authoritative re-read inside the txn still guards concurrent emptying).
  if (valuationItems.length === 0) {
    return { ok: false, reason: "empty", itemIds: [] };
  }
  const valuations = await valuateItemsByIds(
    collectionId,
    valuationItems.map((it) => it.id)
  );

  try {
    return await prisma.$transaction(async (tx) => {
      // Re-read the authoritative state inside the transaction so the snapshot we freeze is
      // consistent with the purchase costs, item set, and lifecycle status at write time —
      // and two concurrent closes cannot both write.
      const lot = await tx.purchaseLot.findUnique({
        where: { id: lotId },
        select: { status: true },
      });
      if (!lot) throw new Error("Lot not found or access denied.");
      if (lot.status !== "open") {
        throw new Error("This lot was already closed. Refresh and try again.");
      }

      const purchase = await tx.purchase.findUniqueOrThrow({
        where: { id: purchaseId },
        select: {
          shippingCost: true,
          fxRateToBase: true,
          lots: { select: { id: true, price: true } },
          expenses: { select: { id: true, price: true } },
        },
      });
      const items = await tx.item.findMany({
        where: { lotId, collectionId },
        select: { id: true, deliveryState: true },
      });
      if (items.length === 0) {
        throw new Error("The lot became empty during close. Refresh and try again.");
      }

      const costs: PurchaseCosts = {
        shippingCost: purchase.shippingCost != null ? Number(purchase.shippingCost) : 0,
        lots: purchase.lots.map((l) => ({ id: l.id, price: Number(l.price) })),
        expenses: purchase.expenses.map((e) => ({ id: e.id, price: Number(e.price) })),
        fxRateToBase: purchase.fxRateToBase != null ? Number(purchase.fxRateToBase) : null,
      };
      const poolBase = computeLotPool(costs, lotId).poolBase;

      const lotItems: LotItem[] = items.map((it) => ({
        id: it.id,
        catalogPrice: valuations.get(it.id)?.baseAmount ?? null,
        deliveryState: it.deliveryState as DeliveryState,
      }));

      // A block throws `LotCloseBlockedError`, which rolls the transaction back (no partial
      // writes) and is converted to a structured result by the catch below.
      const allocation = allocateLot(poolBase, lotItems);

      for (const snap of allocation.snapshots) {
        await tx.item.update({
          where: { id: snap.itemId },
          data: { costBasis: money(snap.costBasis) },
        });
      }
      // Not-delivered copies stay attached but keep a pending (null) cost-basis.
      for (const id of allocation.notDeliveredItemIds) {
        await tx.item.update({ where: { id }, data: { costBasis: null } });
      }
      await tx.purchaseLot.update({ where: { id: lotId }, data: { status: "closed" } });

      return { ok: true, snapshotCount: allocation.snapshots.length };
    });
  } catch (err) {
    if (err instanceof LotCloseBlockedError) {
      return { ok: false, reason: err.reason, itemIds: err.itemIds };
    }
    throw err;
  }
}

/** Reopen a closed lot for corrections (ADR-0009 §5): flip it back to `open` and return
 * every copy's cost-basis to pending (null), since the frozen split no longer holds. */
export async function reopenLot(ownerId: string, lotId: string): Promise<void> {
  const { collectionId, status } = await assertLotOwner(ownerId, lotId);
  if (status === "open") return;
  await prisma.$transaction(async (tx) => {
    await tx.item.updateMany({
      where: { lotId, collectionId },
      data: { costBasis: null },
    });
    await tx.purchaseLot.update({ where: { id: lotId }, data: { status: "open" } });
  });
}

// ---------------------------------------------------------------------------
// Arrival & sorting (ADR-0009 §5, #121)
// ---------------------------------------------------------------------------

/** A copy is only assignable to a location that lives in this collection and can hold
 * copies (grouping-only nodes are rejected, #56). Shared by arrival + bulk sorting. */
async function assertLocationAssignable(collectionId: string, locationId: string): Promise<void> {
  const location = await prisma.location.findFirst({
    where: { id: locationId, collectionId },
    select: { assignable: true },
  });
  if (!location) throw new Error("Location not found in this collection.");
  if (!location.assignable) {
    throw new Error("This location cannot hold copies. Pick an assignable location.");
  }
}

/** Mark a whole purchase as arrived (#121): flip its status to `arrived`, transition every
 * `ordered` copy across its lots to `to_sort` (arrived, awaiting sorting), and — when a
 * location is given — file every not-yet-sorted order copy (`ordered`/`to_sort`) into it
 * (e.g. an "Incoming box"). One transaction, owner-scoped. Returns how many copies moved. */
export async function markPurchaseArrived(
  ownerId: string,
  purchaseId: string,
  opts: { locationId?: string | null } = {}
): Promise<{ toSortCount: number }> {
  const { collectionId } = await assertPurchaseOwner(ownerId, purchaseId);

  const locationId = opts.locationId?.trim() || null;
  if (locationId) await assertLocationAssignable(collectionId, locationId);

  return prisma.$transaction(async (tx) => {
    await tx.purchase.update({ where: { id: purchaseId }, data: { status: "arrived" } });
    const moved = await tx.item.updateMany({
      where: { collectionId, lot: { purchaseId }, deliveryState: "ordered" },
      data: { deliveryState: "to_sort" },
    });
    if (locationId) {
      await tx.item.updateMany({
        where: {
          collectionId,
          lot: { purchaseId },
          deliveryState: { in: ["ordered", "to_sort"] },
        },
        data: { locationId },
      });
    }
    return { toSortCount: moved.count };
  });
}

/** The delivery states a copy may carry (mirrors `VALID_DELIVERY_STATES` in items.ts). */
const DELIVERY_STATES = new Set([
  "ordered",
  "to_sort",
  "in_transit",
  "delivered",
  "not_delivered",
  "damaged",
]);

/** How setting a delivery state affects collection membership (#121): the pre-arrival states
 * (`ordered`/`to_sort`/`in_transit`) are never a holding → not in collection. `delivered`
 * deliberately leaves membership **untouched** — the collector picks the disposition (in
 * collection / for sale / for trade) themselves. `damaged`/`not_delivered` also leave it as-is. */
function inCollectionForDelivery(state: string): boolean | undefined {
  if (state === "ordered" || state === "to_sort" || state === "in_transit") return false;
  return undefined;
}

/** Apply a bulk change to a set of lot copies during sorting (#121). `itemIds` is assembled
 * by the client — a free selection, one copy, or every copy of a lot/issue. Every id must be
 * an owner copy in a single collection; unknown/foreign ids are rejected. Changes (any
 * combination):
 *  - `locationId` defined → file the copies there (null clears location + ref);
 *  - `deliveryState` → set that exact state (and couple `inCollection`, see above);
 *  - `inCollection` / `forSale` / `forTrade` defined → set that disposition flag (applied
 *    after `deliveryState`, so an explicit flag always wins);
 *  - `markSorted` → move to `delivered` + `inCollection`, but only from a not-yet-sorted
 *    state (already-sorted / damaged / not-delivered copies are left untouched).
 * Returns the number of targeted copies. One transaction. */
export async function bulkUpdateLotItems(
  ownerId: string,
  itemIds: string[],
  changes: {
    locationId?: string | null;
    deliveryState?: string;
    inCollection?: boolean;
    forSale?: boolean;
    forTrade?: boolean;
    markSorted?: boolean;
  }
): Promise<number> {
  const ids = [...new Set(itemIds.filter((id) => id))];
  if (ids.length === 0) return 0;
  if (changes.deliveryState && !DELIVERY_STATES.has(changes.deliveryState)) {
    throw new Error("Unknown delivery state.");
  }
  const hasDisposition =
    changes.inCollection !== undefined ||
    changes.forSale !== undefined ||
    changes.forTrade !== undefined;
  if (
    changes.locationId === undefined &&
    !changes.deliveryState &&
    !hasDisposition &&
    !changes.markSorted
  ) {
    return 0;
  }

  const rows = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (rows.length !== ids.length || rows.some((r) => r.collection.ownerId !== ownerId)) {
    throw new Error("One or more copies were not found or access denied.");
  }
  const collectionIds = new Set(rows.map((r) => r.collectionId));
  if (collectionIds.size !== 1) {
    throw new Error("Copies must belong to a single collection.");
  }
  const collectionId = [...collectionIds][0];

  const { locationId } = changes;
  if (locationId) await assertLocationAssignable(collectionId, locationId);

  await prisma.$transaction(async (tx) => {
    if (locationId !== undefined) {
      await tx.item.updateMany({
        where: { id: { in: ids } },
        data: locationId ? { locationId } : { locationId: null, locationRef: null },
      });
    }
    if (changes.deliveryState) {
      const inCollection = inCollectionForDelivery(changes.deliveryState);
      await tx.item.updateMany({
        where: { id: { in: ids } },
        data: {
          deliveryState: changes.deliveryState,
          ...(inCollection !== undefined ? { inCollection } : {}),
        },
      });
    }
    const dispositionData = {
      ...(changes.inCollection !== undefined ? { inCollection: changes.inCollection } : {}),
      ...(changes.forSale !== undefined ? { forSale: changes.forSale } : {}),
      ...(changes.forTrade !== undefined ? { forTrade: changes.forTrade } : {}),
    };
    if (changes.markSorted) {
      // Mark-sorted transitions only the not-yet-sorted copies to `delivered`, and files them
      // with the chosen disposition — or `inCollection` by default when none was given. The
      // disposition rides along here (same filtered set) rather than in the block below.
      await tx.item.updateMany({
        where: { id: { in: ids }, deliveryState: { in: ["ordered", "to_sort", "in_transit"] } },
        data: {
          deliveryState: "delivered",
          ...(hasDisposition ? dispositionData : { inCollection: true }),
        },
      });
    } else if (hasDisposition) {
      await tx.item.updateMany({ where: { id: { in: ids } }, data: dispositionData });
    }
  });
  return ids.length;
}
