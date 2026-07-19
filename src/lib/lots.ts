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
// Item intake itself (creating the `Item` linked to a lot) reuses `createItem` (items.ts)
// with `lotId` + `deliveryState = in_transit`. All access is collection-owner-scoped.

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

/** Delete a lot. Blocked when it still has copies (detach them first) — the DB enforces
 * this via `Item.lotId onDelete: Restrict`; surfaced as a friendly error. */
export async function deleteLot(ownerId: string, lotId: string): Promise<void> {
  await assertLotOwner(ownerId, lotId);
  try {
    await prisma.purchaseLot.delete({ where: { id: lotId } });
  } catch (err) {
    if (isRestrictViolation(err)) {
      throw new Error("Cannot delete a lot that has copies. Detach the copies first.");
    }
    throw err;
  }
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
 * of that issue). Every created copy shares the given condition and certificate, is linked
 * to the lot, and is marked `ordered` and **not** in the collection — a purchased copy is
 * not a holding until it arrives. Returns how many copies were created. */
export async function intakeStamps(
  ownerId: string,
  lotId: string,
  input: {
    stampId?: string | null;
    issueId?: string | null;
    conditionId: string;
    certificateStatusId?: string | null;
  }
): Promise<number> {
  const { collectionId, status } = await assertLotOwner(ownerId, lotId);
  if (status !== "open") {
    throw new Error("This lot is closed. Reopen it before identifying more copies.");
  }

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
      inCollection: false,
      forSale: false,
      forTrade: false,
      lotId,
      deliveryState: "ordered",
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

  const purchase = await prisma.purchase.findUniqueOrThrow({
    where: { id: purchaseId },
    select: {
      shippingCost: true,
      fxRateToBase: true,
      lots: { select: { id: true, price: true } },
      expenses: { select: { id: true, price: true } },
    },
  });

  const items = await prisma.item.findMany({
    where: { lotId, collectionId },
    select: { id: true, deliveryState: true },
  });
  if (items.length === 0) {
    return { ok: false, reason: "empty", itemIds: [] };
  }

  const costs: PurchaseCosts = {
    shippingCost: purchase.shippingCost != null ? Number(purchase.shippingCost) : 0,
    lots: purchase.lots.map((l) => ({ id: l.id, price: Number(l.price) })),
    expenses: purchase.expenses.map((e) => ({ id: e.id, price: Number(e.price) })),
    fxRateToBase: purchase.fxRateToBase != null ? Number(purchase.fxRateToBase) : null,
  };
  const poolBase = computeLotPool(costs, lotId).poolBase;

  const valuations = await valuateItemsByIds(
    collectionId,
    items.map((it) => it.id)
  );
  const lotItems: LotItem[] = items.map((it) => ({
    id: it.id,
    catalogPrice: valuations.get(it.id)?.baseAmount ?? null,
    deliveryState: it.deliveryState as DeliveryState,
  }));

  let allocation;
  try {
    allocation = allocateLot(poolBase, lotItems);
  } catch (err) {
    if (err instanceof LotCloseBlockedError) {
      return { ok: false, reason: err.reason, itemIds: err.itemIds };
    }
    throw err;
  }

  await prisma.$transaction(async (tx) => {
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
  });

  return { ok: true, snapshotCount: allocation.snapshots.length };
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

/** Prisma FK-restrict violation (P2003) / required-relation guard (P2014). */
function isRestrictViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    ((err as { code?: string }).code === "P2003" ||
      (err as { code?: string }).code === "P2014")
  );
}
