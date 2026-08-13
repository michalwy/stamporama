import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  allocateItemNumbers,
  listItemsPaginated,
  listUnpricedItemIds,
  lotCopyFilterWhere,
  valuateItemsByIds,
  type ItemListItem,
  type LotCopyFilter,
} from "./items";
import { applyPhotoChangeSet, type PhotoChangeSet } from "./photos";
import { isDeliveryState } from "./delivery-state";
import type { ArrivingCopy } from "./want-rules";
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
  /** The auction sale this purchase was settled from (#28), or null for a hand-entered one. The
   * link is worth carrying because the bidding record is where the lots' figures came from, and it
   * survives this purchase being deleted. */
  auctionSale: { id: string; name: string } | null;
}

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Distinct issue ids across every copy identified into any of a purchase's lots (#172).
 * Lets the intake page load issue headers for the grouped-by-issue view without first
 * loading every copy — the copies themselves now stream in paginated pages. */
export async function getPurchaseIssueIds(purchaseId: string): Promise<string[]> {
  const rows = await prisma.issueMember.findMany({
    where: { stamp: { items: { some: { lot: { purchaseId } } } } },
    select: { issueId: true },
    distinct: ["issueId"],
  });
  return rows.map((r) => r.issueId);
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
      // The auction settlement this purchase was transcribed from (#28), when it came from one.
      auctionSale: { select: { id: true, name: true } },
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
    auctionSale: row.auctionSale ? { id: row.auctionSale.id, name: row.auctionSale.name } : null,
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
    checklistId?: string | null;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
    locationRef?: string | null;
    photoChangeSet?: PhotoChangeSet | null;
    // Disposition flags chosen during intake (#160); default off when omitted.
    inCollection?: boolean;
    forSale?: boolean;
    forTrade?: boolean;
  }
): Promise<{ lotId: string; count: number; copies: ArrivingCopy[] }> {
  const lotId = await createLot(ownerId, purchaseId, input.price, input.title);
  try {
    const copies = await intakeStamps(ownerId, lotId, {
      stampId: input.stampId,
      checklistId: input.checklistId,
      conditionId: input.conditionId,
      certificateStatusId: input.certificateStatusId,
      locationId: input.locationId,
      locationRef: input.locationRef,
      photoChangeSet: input.photoChangeSet,
      inCollection: input.inCollection,
      forSale: input.forSale,
      forTrade: input.forTrade,
    });
    return { lotId, count: copies.length, copies };
  } catch (err) {
    // Compensate: drop the empty lot we created so a failed intake doesn't strand it.
    await prisma.purchaseLot.delete({ where: { id: lotId } }).catch(() => {});
    throw err;
  }
}

/** Edit a lot's price while it is still open. A closed lot's price is frozen into the
 * cost-basis snapshots, which are never recomputed in place (ADR-0009 §3.5, #122), so a
 * price change on a closed lot is rejected here — reopen the lot first, then close again. */
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

/** The copies an open lot could take on (#388): every copy in the collection that is not already
 * on it and not frozen into a closed lot's cost split. Unpaginated like the offer composition
 * picker it mirrors — the dialog filters client-side over an area/year scope the collector picks.
 *
 * Sold and disposed copies are left out by the list's own defaults: this is an intake correction,
 * and a piece that has left the collection is not what one is filing a receipt against. */
export async function listAttachableCopies(
  ownerId: string,
  lotId: string,
  opts: { areaIds?: string[] | null; search?: string; year?: number | "none" } = {}
): Promise<ItemListItem[]> {
  const { collectionId } = await assertLotOwner(ownerId, lotId);
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    attachableToLotId: lotId,
    areaIds: opts.areaIds ?? undefined,
    search: opts.search,
    year: opts.year,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

/** A copy that cannot be attached, with the reason a person can act on (#388). */
export interface AttachRefusal {
  itemId: string;
  reason: string;
}

/** Attach copies that already exist to an open lot (#388) — the third verb beside `intakeStamps`
 * (which *creates* copies) and `removeLotItem` (which deletes them). What it is for: a copy
 * entered by hand before the order was recorded, or one filed under the wrong purchase.
 *
 * Only `lotId` changes. Delivery state, dispositions, location, `itemNo` and photos all stay as
 * they are — a copy already in hand does not go back to `ordered` because its cost was recorded
 * late, and its internal number is written on the physical piece (#268).
 *
 * Both ends must be **open**, because a cost basis is frozen at close (ADR-0009 §3):
 *  - a closed *target* would not include the copy in the split it has already made;
 *  - a closed *source* has already distributed its pool over a set this would silently shrink,
 *    leaving the copies that stayed under-costed. Reopening it is the honest way through, and it
 *    is what the refusal says.
 *
 * Moving a copy off another **open** lot is allowed but never silent: the caller has to pass
 * `allowRelink`, which the dialog only sets once the collector has confirmed a warning naming the
 * purchase being left. Copies already on this lot are a no-op, not an error — re-confirming a
 * selection should not fail.
 *
 * Refusals are **collected, not thrown**: one copy stuck on a closed lot is no reason to abandon
 * the other nineteen. Returns what was attached and what was not, with the reason for each.
 */
export async function attachItemsToLot(
  ownerId: string,
  lotId: string,
  itemIds: string[],
  opts: { allowRelink?: boolean } = {}
): Promise<{ attached: number; refused: AttachRefusal[] }> {
  const { collectionId, status } = await assertLotOwner(ownerId, lotId);
  if (status !== "open") {
    throw new Error("This lot is closed. Reopen it before attaching copies.");
  }
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("Nothing selected to attach.");

  const items = await prisma.item.findMany({
    where: { id: { in: ids }, collectionId },
    select: {
      id: true,
      lotId: true,
      lot: {
        select: {
          status: true,
          purchase: {
            select: { id: true, purchasedAt: true, contact: { select: { name: true } } },
          },
        },
      },
    },
  });
  const found = new Set(items.map((i) => i.id));
  const refused: AttachRefusal[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ itemId: id, reason: "Copy not found in this collection." }));

  const toAttach: string[] = [];
  for (const item of items) {
    if (item.lotId === lotId) continue; // already here — nothing to do
    if (item.lot && item.lot.status !== "open") {
      const label = item.lot.purchase.contact?.name ?? "another purchase";
      refused.push({
        itemId: item.id,
        reason: `This copy belongs to a closed lot (${label}). Reopen that lot before moving it.`,
      });
      continue;
    }
    if (item.lot && !opts.allowRelink) {
      refused.push({
        itemId: item.id,
        reason: "This copy already belongs to another purchase. Confirm the move to continue.",
      });
      continue;
    }
    toAttach.push(item.id);
  }

  if (toAttach.length > 0) {
    await prisma.item.updateMany({
      where: { id: { in: toAttach }, collectionId },
      // The cost basis is written when the lot closes, so a copy joining an open lot has a
      // pending one. A copy coming off another *open* lot has one already pending; setting it
      // explicitly keeps the invariant true whichever way the copy arrived.
      data: { lotId, costBasis: null },
    });
  }
  return { attached: toAttach.length, refused };
}

/** Identify stamps into an open lot (intake, ADR-0009 §5, #121). Accepts either a single
 * `stampId` or a `checklistId` (which fans out to every stamp on that checklist, #531 — an issue
 * may carry several, so the caller names the goal rather than the publication). Every created copy
 * shares the given condition, certificate, and storage
 * location, is linked to the lot, and is **not** in the collection — a purchased copy is not a
 * holding until it is sorted. New copies enter as `ordered`, or `to_sort` when the order has
 * already arrived (they were identified during the sort pass).
 *
 * Returns the copies it created, not a count (#532): taking a copy in is the moment the want list
 * is consulted (ADR-0032 §7), and the review that follows has to name each copy and read its
 * condition. The count callers used to get is the array's length. */
export async function intakeStamps(
  ownerId: string,
  lotId: string,
  input: {
    stampId?: string | null;
    checklistId?: string | null;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
    locationRef?: string | null;
    // Only honoured for a single-stamp intake (#148); a whole-checklist intake creates several
    // distinct copies, so the client never sends photos for it.
    photoChangeSet?: PhotoChangeSet | null;
    // Disposition flags chosen during intake (#160). Copies are still created not-yet-sorted
    // (ordered / to_sort); these only preset where the copy will land once sorted. Default off.
    inCollection?: boolean;
    forSale?: boolean;
    forTrade?: boolean;
  }
): Promise<ArrivingCopy[]> {
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

  // Resolve the target stamp ids: a whole checklist expands to the stamps on it.
  let stampIds: string[];
  if (input.checklistId) {
    const checklist = await prisma.checklist.findFirst({
      where: { id: input.checklistId, collectionId },
      select: { name: true, stamps: { select: { stampId: true } } },
    });
    if (!checklist) throw new Error("Checklist not found in this collection.");
    stampIds = checklist.stamps.map((cs) => cs.stampId);
    if (stampIds.length === 0) {
      throw new Error(`"${checklist.name}" has no stamps on it yet.`);
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

  // A ref is meaningless without a location, so drop it unless a location is set (mirrors the
  // inventory copy form).
  const locationRef = locationId ? input.locationRef?.trim() || null : null;
  const copyData = (stampId: string, itemNo: number) => ({
    collectionId,
    itemNo,
    stampId,
    conditionId,
    certificateStatusId,
    locationId,
    locationRef,
    inCollection: input.inCollection ?? false,
    forSale: input.forSale ?? false,
    forTrade: input.forTrade ?? false,
    lotId,
    deliveryState,
  });

  // A single-stamp intake may carry photos for the one created copy (#148). Create that copy
  // individually so we have its id to attach the photos to; whole-issue intake fans out into
  // several distinct copies and never carries photos, so it keeps the bulk `createMany`.
  // Internal copy numbers (#268) are reserved as one consecutive range for the whole intake, so a
  // whole-issue expansion numbers its copies in the order the stamps were resolved.
  const itemNos = await allocateItemNumbers(prisma, collectionId, stampIds.length);
  const singleStamp = !!input.stampId && !input.checklistId;
  // `createManyAndReturn` rather than `createMany`: the want review that follows needs each copy's
  // id and number, and re-reading the lot to find "the ones just added" would be a guess.
  const created: { id: string; itemNo: number; stampId: string }[] = [];
  if (singleStamp && input.photoChangeSet) {
    const item = await prisma.item.create({
      data: copyData(stampIds[0], itemNos[0]),
      select: { id: true, itemNo: true, stampId: true },
    });
    await applyPhotoChangeSet(ownerId, item.id, input.photoChangeSet);
    created.push(item);
  } else {
    const rows = await prisma.item.createManyAndReturn({
      data: stampIds.map((stampId, i) => copyData(stampId, itemNos[i])),
      select: { id: true, itemNo: true, stampId: true },
    });
    created.push(...rows);
  }
  // Intake records no format, so every copy it makes is a single (a null `formatId` *is* "single",
  // see `StampFormat`) — stated here rather than left implicit, since the want's format axis reads
  // it as a value.
  return created.map((row) => ({
    itemId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    conditionId,
    certificateStatusId,
    formatId: null,
  }));
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

      // Cost-basis is money in cents, so a lot has a bounded number of distinct values.
      // Group by the stored (2-decimal) value and issue one updateMany per value, plus one
      // for the not-delivered set, collapsing thousands of sequential UPDATEs into a handful
      // and shortening how long the transaction holds row locks (#173).
      const idsByBasis = new Map<string, string[]>();
      for (const snap of allocation.snapshots) {
        const key = snap.costBasis.toFixed(2);
        const ids = idsByBasis.get(key);
        if (ids) ids.push(snap.itemId);
        else idsByBasis.set(key, [snap.itemId]);
      }
      for (const [basis, ids] of idsByBasis) {
        await tx.item.updateMany({
          where: { id: { in: ids } },
          data: { costBasis: money(Number(basis)) },
        });
      }
      // Not-delivered copies stay attached but keep a pending (null) cost-basis.
      if (allocation.notDeliveredItemIds.length > 0) {
        await tx.item.updateMany({
          where: { id: { in: allocation.notDeliveredItemIds } },
          data: { costBasis: null },
        });
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

// Cost-basis snapshots are frozen for good at close (ADR-0009 §3.5): a later variant
// reassignment, condition change, or catalog-price edit does NOT retroactively recompute a
// closed lot. Auto-recompute was deliberately rejected — a single catalog-price edit would
// have to cascade across every lot holding that stamp (and every catalog re-import), which is
// more cost than benefit. To correct a closed lot, reopen it, fix the copies, and close again.

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

/** How setting a delivery state affects collection membership (#121): the pre-arrival states
 * (`ordered`/`to_sort`/`in_transit`) are never a holding → not in collection. `delivered`
 * deliberately leaves membership **untouched** — the collector picks the disposition (in
 * collection / for sale / for trade) themselves. `damaged`/`not_delivered` also leave it as-is. */
function inCollectionForDelivery(state: string): boolean | undefined {
  if (state === "ordered" || state === "to_sort" || state === "in_transit") return false;
  return undefined;
}

export interface LotBulkChanges {
  locationId?: string | null;
  /** The in-location ref written on the filed copies (#565) — the ref card the transport card
   * carries. Only meaningful alongside a `locationId`, since a ref identifies a place *within* a
   * location; sending one without is refused rather than silently dropped. Empty/blank clears it,
   * and clearing the location clears the ref with it (a ref means nothing on an unfiled copy). */
  locationRef?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
  /** Mark-sorted only (#274): leave every copy's disposition exactly as it is, instead of
   * writing the given flags or falling back to `inCollection`. The location and the
   * `delivered` transition still apply — this is the disposition's "leave as is", mirroring
   * the one the location picker already offers. Ignored when any flag is given. */
  keepDisposition?: boolean;
}

/** A ref addresses a place *inside* a location, so one arriving without a location to sit in is a
 * caller mistake and is refused rather than written where nothing can read it back (#565). */
function assertRefHasLocation(changes: LotBulkChanges): void {
  if (changes.locationRef !== undefined && !changes.locationId) {
    throw new Error("A location is needed before copies can be given a ref.");
  }
}

/** True when `changes` would touch nothing (used to short-circuit a no-op bulk update). */
function isNoopBulk(changes: LotBulkChanges): boolean {
  const hasDisposition =
    changes.inCollection !== undefined ||
    changes.forSale !== undefined ||
    changes.forTrade !== undefined;
  return (
    changes.locationId === undefined &&
    !changes.deliveryState &&
    !hasDisposition &&
    !changes.markSorted
  );
}

/** Apply the bulk `changes` to every copy matching `baseWhere`, in one transaction. The
 * `baseWhere` is trusted to already scope to owner copies in a single collection (the callers
 * assert that). Shared by the id-list and server-scoped bulk entry points (#121/#172). */
async function applyLotBulkChanges(
  baseWhere: Prisma.ItemWhereInput,
  changes: LotBulkChanges
): Promise<ArrivingCopy[]> {
  const hasDisposition =
    changes.inCollection !== undefined ||
    changes.forSale !== undefined ||
    changes.forTrade !== undefined;
  return prisma.$transaction(async (tx) => {
    // Which copies this change could move **into** `delivered` — read before the write, because
    // afterwards there is no telling a copy that has just arrived from one that was already here.
    // That transition is the moment the want review belongs to (ADR-0032 §7): a copy that is
    // ordered, in transit or waiting to be sorted is not yet in the collector's hands, and asking
    // "does this close a want?" about something still in the post is asking too early.
    const candidateIds = movesToDelivered(changes)
      ? (
          await tx.item.findMany({
            where: { AND: [baseWhere, { deliveryState: { not: "delivered" } }] },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [];

    if (changes.locationId !== undefined) {
      await tx.item.updateMany({
        where: baseWhere,
        data: changes.locationId
          ? {
              locationId: changes.locationId,
              // The ref rides with the location it belongs to, so filing a batch onto one card is
              // a single write (#565). Absent means "leave whatever each copy carries" — the plain
              // move action still has no ref to say anything about.
              ...(changes.locationRef !== undefined
                ? { locationRef: changes.locationRef?.trim() || null }
                : {}),
            }
          : { locationId: null, locationRef: null },
      });
    }
    if (changes.deliveryState) {
      const inCollection = inCollectionForDelivery(changes.deliveryState);
      await tx.item.updateMany({
        where: baseWhere,
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
      // with the chosen disposition — or `inCollection` by default when none was given, unless
      // `keepDisposition` asks for each copy's own to be left standing (#274). The disposition
      // rides along here (same filtered set) rather than in the block below.
      const sortedDisposition = hasDisposition
        ? dispositionData
        : changes.keepDisposition
          ? {}
          : { inCollection: true };
      await tx.item.updateMany({
        where: { AND: [baseWhere, { deliveryState: { in: ["ordered", "to_sort", "in_transit"] } }] },
        data: { deliveryState: "delivered", ...sortedDisposition },
      });
    } else if (hasDisposition) {
      await tx.item.updateMany({ where: baseWhere, data: dispositionData });
    }

    if (candidateIds.length === 0) return [];
    const delivered = await tx.item.findMany({
      where: { id: { in: candidateIds }, deliveryState: "delivered" },
      select: {
        id: true,
        itemNo: true,
        stampId: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
      },
    });
    return delivered.map((row) => ({
      itemId: row.id,
      itemNo: row.itemNo,
      stampId: row.stampId,
      conditionId: row.conditionId,
      certificateStatusId: row.certificateStatusId,
      formatId: row.formatId,
    }));
  });
}

/** Whether a bulk change can land a copy in `delivered` — the only transition the want review
 *  hangs off. `markSorted` is that move by definition; an explicit state is only that move when
 *  it names `delivered` itself. */
function movesToDelivered(changes: LotBulkChanges): boolean {
  return !!changes.markSorted || changes.deliveryState === "delivered";
}

/** Apply a bulk change to a set of lot copies during sorting (#121). `itemIds` is assembled
 * by the client — a free selection or one copy. Every id must be an owner copy in a single
 * collection; unknown/foreign ids are rejected. Changes (any combination):
 *  - `locationId` defined → file the copies there (null clears location + ref);
 *  - `deliveryState` → set that exact state (and couple `inCollection`, see above);
 *  - `inCollection` / `forSale` / `forTrade` defined → set that disposition flag (applied
 *    after `deliveryState`, so an explicit flag always wins);
 *  - `markSorted` → move to `delivered` + `inCollection` (or the given flags, or nothing at
 *    all with `keepDisposition`), but only from a not-yet-sorted state (already-sorted /
 *    damaged / not-delivered copies are left untouched).
 * Returns the number of targeted copies. One transaction. For whole-lot/issue bulk actions
 * over a set too large to enumerate client-side, use {@link bulkUpdateLotItemsScoped}. */
export async function bulkUpdateLotItems(
  ownerId: string,
  itemIds: string[],
  changes: LotBulkChanges
): Promise<BulkUpdateResult> {
  const ids = [...new Set(itemIds.filter((id) => id))];
  if (ids.length === 0) return { count: 0, delivered: [] };
  if (changes.deliveryState && !isDeliveryState(changes.deliveryState)) {
    throw new Error("Unknown delivery state.");
  }
  assertRefHasLocation(changes);
  if (isNoopBulk(changes)) return { count: 0, delivered: [] };

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

  if (changes.locationId) await assertLocationAssignable(collectionId, changes.locationId);

  const delivered = await applyLotBulkChanges({ id: { in: ids } }, changes);
  return { count: ids.length, delivered };
}

/** A server-resolved bulk target — every copy matching the scope is updated, so "mark all
 * copies sorted" / "move all copies to a location" cover an entire lot (or an issue group
 * within it, or an issue across a purchase's open lots) without the client enumerating ids.
 * This is what makes bulk actions correct for lots larger than one loaded page (#172). */
/** What a bulk change did: how many copies it targeted, and which of them **became delivered** —
 *  the transition the want review hangs off (ADR-0032 §7). */
export interface BulkUpdateResult {
  count: number;
  delivered: ArrivingCopy[];
}

export interface LotBulkScope {
  /** All copies identified into this purchase lot. */
  lotId?: string;
  /** All copies identified into any lot of this purchase (order-level view). */
  purchaseId?: string;
  /** Narrow to a single issue group: an issue id, or `"__none__"` for copies with no issue. */
  issueKey?: string;
  /** Only copies whose owning lot is still open (skips already-closed lots). */
  onlyOpenLots?: boolean;
  /**
   * Narrow to the copies the list is currently showing (#565). "Select everything matching the
   * current filter" has to mean the whole filtered set on the server, not the rows scrolled into
   * view, so the chip the collector pressed travels with the scope and is applied to the write —
   * exactly the rule `Mark all copies sorted` already follows for the unfiltered lot.
   */
  filter?: LotCopyFilter;
}

/** Build the collection-scoped Prisma `where` for a {@link LotBulkScope}. */
function lotBulkScopeWhere(collectionId: string, scope: LotBulkScope): Prisma.ItemWhereInput {
  const lotRelation: Prisma.PurchaseLotWhereInput = {};
  if (scope.purchaseId) lotRelation.purchaseId = scope.purchaseId;
  if (scope.onlyOpenLots) lotRelation.status = "open";
  return {
    collectionId,
    ...(scope.lotId ? { lotId: scope.lotId } : {}),
    ...(Object.keys(lotRelation).length > 0 ? { lot: lotRelation } : {}),
    ...lotCopyFilterWhere(scope.filter),
    ...(scope.issueKey
      ? scope.issueKey === "__none__"
        ? { stamp: { issueMemberships: { none: {} } } }
        : { stamp: { issueMemberships: { some: { issueId: scope.issueKey } } } }
      : {}),
  };
}

/** Apply a bulk change to every copy matching a server-resolved {@link LotBulkScope} (#172).
 * Mirrors {@link bulkUpdateLotItems}'s change semantics but targets by scope instead of an id
 * list, so it is correct for lots with more copies than a single page. Returns the number of
 * copies in the scope. */
export async function bulkUpdateLotItemsScoped(
  ownerId: string,
  collectionId: string,
  scope: LotBulkScope,
  changes: LotBulkChanges
): Promise<BulkUpdateResult> {
  await assertCollectionOwner(ownerId, collectionId);
  if (!scope.lotId && !scope.purchaseId) {
    throw new Error("A lot or purchase must be given for a scoped bulk update.");
  }
  if (changes.deliveryState && !isDeliveryState(changes.deliveryState)) {
    throw new Error("Unknown delivery state.");
  }
  assertRefHasLocation(changes);
  if (isNoopBulk(changes)) return { count: 0, delivered: [] };
  if (changes.locationId) await assertLocationAssignable(collectionId, changes.locationId);

  const scopeWhere = lotBulkScopeWhere(collectionId, scope);
  // `unpriced` is the one filter no column answers (#565): it is a derived valuation, so the scope
  // is resolved to the ids that valuation selects, the same fallback the paged read already makes
  // under that chip. Every other filter is already in the `where`.
  const where =
    scope.filter === "unpriced"
      ? { AND: [scopeWhere, { id: { in: await listUnpricedItemIds(collectionId, scopeWhere) } }] }
      : scopeWhere;
  const count = await prisma.item.count({ where });
  if (count === 0) return { count: 0, delivered: [] };
  const delivered = await applyLotBulkChanges(where, changes);
  return { count, delivered };
}
