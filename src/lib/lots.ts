import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  allocateItemNumbers,
  dispositionFilterWhere,
  listItemsPaginated,
  listUnpricedItemIds,
  lotCopyFilterWhere,
  valuateItemsByIds,
  type CopyDispositionFilter,
  type ItemListItem,
  type LotCopyFilter,
} from "./items";
import { parseDispositionFilter } from "./intake-filter-params";
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
import { syncTradePurchasePool, tradeLotCarryOverBlocker } from "./trade-intake";

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
  /** The trade this order is the incoming half of (#644), or null. There is no money on such an
   *  order: its lot prices are the carried-over cost basis of the copies that went the other way, so
   *  the link is not a nicety — it is where the figures came from. */
  trade: { id: string; tradeNo: number; partnerName: string } | null;
  /** Scan tiles on this **order** still waiting to become something (#566, re-parented by #586).
   * What the order header counts and what a lot close warns about — a **warning, never a block**,
   * matching the existing `N to sort`: a tile has no stamp, so no catalogue price, so no weight in
   * any lot's cost split, and closing without it is arithmetically fine. It is the collector's
   * memory that needs the nudge, not the sum. Discarded tiles are not counted: a discarded tile is
   * evidence, not a queue item (#567). */
  unidentifiedTileCount: number;
  /** Scan tiles on this order that are **parked** (#597) — still to be identified, but waiting on
   * something that is not at the desk: a watermark, two shades of one blue, a paper difference.
   * Counted apart from the waiting ones because both are outstanding work and only one of them is
   * work that can be done now; folding them together would put the parked pieces back into the
   * sweep they were parked to leave. */
  parkedTileCount: number;
  /** Retained card scans on this order (#566), so the section can say it has scans before any of
   * them has been cut. */
  scanSheetCount: number;
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
      trade: { select: { id: true, tradeNo: true, partner: { select: { name: true } } } },
      // The card scans and what is still waiting on them (#586). Counted through filtered
      // relations rather than by loading the tiles: a carton is fifty cards, and the header has no
      // other use for the rows.
      _count: { select: { scanSheets: true } },
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

  // The two outstanding tile states in one pass (#597), rather than two filtered relation counts:
  // Prisma's `_count` cannot carry the same relation twice under two `where`s, and the header wants
  // them apart — *N unidentified* is the sweep, *N to check* is the trip to the colour key.
  const tileStates = await prisma.scanTile.groupBy({
    by: ["state"],
    where: { purchaseId, state: { in: ["unidentified", "parked"] } },
    _count: { _all: true },
  });
  const tilesInState = (state: string) =>
    tileStates.find((g) => g.state === state)?._count._all ?? 0;

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
    trade: row.trade
      ? { id: row.trade.id, tradeNo: row.trade.tradeNo, partnerName: row.trade.partner.name }
      : null,
    unidentifiedTileCount: tilesInState("unidentified"),
    parkedTileCount: tilesInState("parked"),
    scanSheetCount: row._count.scanSheets,
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
    // Physical format of the copy (#573); single-stamp only, see `intakeStamps`.
    formatId?: string | null;
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
      formatId: input.formatId,
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
  // **Nothing scan-shaped is touched** (#586). Card scans and their tiles belong to the *purchase*
  // now, and a lot line being removed is not the card being thrown away — the parcel it was cut
  // from is still here, and so is every other lot the same card holds pieces of. A tile that had
  // already become a copy on this lot keeps its record and its `itemId` goes null through #567's
  // `SetNull`, which is the case the strip already draws in words as *copy deleted*.
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
 * A single-stamp intake may also name a **format** (#573) — the piece in the tweezers is a pair or
 * a block as often as it is a single, and this is the moment it is known.
 *
 * It may also ask for **several copies of that one stamp** (`copies`, #596), which is what a card
 * holding a run of one definitive comes to: one answer, N pieces. It is the same intake and not a
 * loop over it, so the copies take one consecutive range of internal numbers
 * (`allocateItemNumbers`) in the order the pieces were laid out.
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
    /**
     * How many copies of `stampId` to create (#596), defaulting to one. Single-stamp intake only —
     * a whole-checklist intake already fans out across its stamps, and multiplying that would give
     * one number two meanings.
     *
     * It exists for the scan-tile pass, where the collector ticks N tiles of the same stamp and
     * answers once. Each created copy is handed **its own tile's** images afterwards, so this is N
     * pieces of paper rather than N records of one.
     */
    copies?: number;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
    locationRef?: string | null;
    // Only honoured for a single-stamp intake (#148); a whole-checklist intake creates several
    // distinct copies, so the client never sends photos for it.
    photoChangeSet?: PhotoChangeSet | null;
    // The physical format of the copy (#573), null/omitted meaning *single* (`StampFormat`,
    // ADR-0020). Honoured for a single-stamp intake only, on the photo rule's reasoning and a
    // stronger version of it: a whole-checklist intake fans out across many stamps and one format
    // could not be true of all of them.
    formatId?: string | null;
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

  // The format, when one was named (#573). Null is *single* and needs no row, exactly as a null
  // certificate is "no certificate" — so only a named one is checked against the collection.
  const formatId = input.formatId?.trim() || null;
  if (formatId) {
    const format = await prisma.stampFormat.findFirst({
      where: { id: formatId, collectionId },
      select: { id: true },
    });
    if (!format) throw new Error("Format not found in this collection.");
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
    // Several copies of the one stamp (#596), which is what a card holding a run of one definitive
    // asks for. The list is the stamp repeated rather than a count carried separately, so
    // everything below — the number range, the `createMany`, the copies handed back to the want
    // review — keeps working on one list without learning a second shape.
    const count = Math.max(1, Math.floor(input.copies ?? 1));
    stampIds = Array.from({ length: count }, () => input.stampId as string);
  } else {
    throw new Error("Nothing selected to add.");
  }

  // A ref is meaningless without a location, so drop it unless a location is set (mirrors the
  // inventory copy form).
  const locationRef = locationId ? input.locationRef?.trim() || null : null;
  const singleStamp = !!input.stampId && !input.checklistId;
  // The format applies to the one copy a single-stamp intake makes, and to nothing a
  // whole-checklist intake makes: those are several distinct stamps, and "block of four" cannot be
  // true of all of them. Dropped here rather than refused, exactly as a checklist intake's photos
  // are (#148) — the client offers neither, so a value arriving is a stale form and not a mistake
  // worth failing the whole intake over.
  const copyFormatId = singleStamp ? formatId : null;
  const copyData = (stampId: string, itemNo: number) => ({
    collectionId,
    itemNo,
    stampId,
    conditionId,
    certificateStatusId,
    formatId: copyFormatId,
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
  // `createManyAndReturn` rather than `createMany`: the want review that follows needs each copy's
  // id and number, and re-reading the lot to find "the ones just added" would be a guess.
  const created: { id: string; itemNo: number; stampId: string }[] = [];
  // …and only when it is the *one* copy: a run of copies of one stamp (#596) is the scan-tile pass,
  // where every copy takes its own tile's crops afterwards and one shared change-set would be the
  // very thing that flow must not do.
  if (singleStamp && stampIds.length === 1 && input.photoChangeSet) {
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
  // The format the copies were written with, carried out rather than assumed: the want's format
  // axis reads it as a value, where null *is* "single" (`StampFormat`) and never "unknown", so a
  // block reported as null would be judged as satisfying a want for singles.
  return created.map((row) => ({
    itemId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    conditionId,
    certificateStatusId,
    formatId: copyFormatId,
  }));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Outcome of a close attempt. On block, `itemIds` names the copies to fix — except for
 * `trade-cost-pending`, whose subject is somebody else's order entirely and which therefore carries
 * its own sentence instead (#644). */
export type CloseLotResult =
  | { ok: true; snapshotCount: number }
  | {
      ok: false;
      reason: "missing-price" | "zero-weight" | "empty" | "trade-cost-pending";
      itemIds: string[];
      /** Set where the block is about something the copies on this lot cannot explain. */
      message?: string;
    };

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

  // A lot that came from a trade (#644) has no price of its own: its pool is the cost basis of the
  // copies that went the other way, and those may still be waiting on lots of their own — a large
  // auction lot is intaken over weeks and its copies are tradeable long before it closes. So the
  // trigger changes and nothing else does: this lot stays open while any source copy is `pending`,
  // its copies report `pending` of their own accord meanwhile, and the refusal names the orders to
  // go and close. Null for every ordinary purchase, which is nearly all of them.
  const carryOver = await tradeLotCarryOverBlocker(lotId);
  if (carryOver) return { ok: false, reason: "trade-cost-pending", itemIds: [], message: carryOver };
  // Past the gate every source basis is frozen, so this is the moment the provisional price written
  // at closing becomes the real one — read just before it is distributed, and never again after.
  await syncTradePurchasePool(purchaseId);

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

/**
 * One ticked container of the intake screen's selection (#571): a lot, an issue group, a lot's
 * issue group, or — with every field absent — everything the target holds. `filter` is the list's
 * chip at the moment it was ticked, so "all 40 to sort" is written as those 40 and never as all
 * 900 (#565).
 */
export interface LotBulkSelector {
  lotId?: string;
  /** An issue id, or `"__none__"` for copies belonging to no issue. */
  issueKey?: string;
  filter?: LotCopyFilter;
  /** The disposition axis the container was ticked under (#622), narrowing it the same way
   * `filter` does — the two are independent, and a container may carry both. */
  disposition?: CopyDispositionFilter;
}

export interface LotBulkScope {
  /** All copies identified into this purchase lot. */
  lotId?: string;
  /** All copies identified into any lot of this purchase (order-level view). */
  purchaseId?: string;
  /**
   * The ticked containers, **unioned** (#571). A list because a selection is one act however many
   * lots and issue groups it spans — a batch on the desk does not respect lot boundaries, and
   * splitting it into a write per container would leave the act half-done on a failure.
   */
  selectors?: LotBulkSelector[];
  /**
   * Copies ticked one by one, taken **in addition to** {@link selectors}. A selection routinely
   * mixes the two — a whole group plus a handful from the next one.
   */
  itemIds?: string[];
  /** Containers lifted back out of a broader tick. */
  excludeSelectors?: LotBulkSelector[];
  /** Copies lifted back out of a container above them. The container's other copies run past the
   *  loaded page, so unticking one is an exclusion and not a shorter list. */
  excludeItemIds?: string[];
  /** Only copies whose owning lot is still open (skips already-closed lots). */
  onlyOpenLots?: boolean;
}

const LOT_COPY_FILTERS = new Set<string>(["unpriced", "to-sort", "no-photos"]);

/** One selector off the wire, keeping only the fields it is allowed to carry. */
function parseSelector(raw: unknown): LotBulkSelector | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sel: LotBulkSelector = {};
  if (typeof o.lotId === "string" && o.lotId) sel.lotId = o.lotId;
  if (typeof o.issueKey === "string" && o.issueKey) sel.issueKey = o.issueKey;
  // An unknown chip is dropped rather than refused — it can only ever narrow the target.
  if (typeof o.filter === "string" && LOT_COPY_FILTERS.has(o.filter)) {
    sel.filter = o.filter as LotCopyFilter;
  }
  if (typeof o.disposition === "string") {
    const disposition = parseDispositionFilter(o.disposition);
    if (disposition) sel.disposition = disposition;
  }
  return sel;
}

function parseSelectors(raw: string | null | undefined): LotBulkSelector[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseSelector).filter((s): s is LotBulkSelector => s !== null);
}

/**
 * Read a {@link LotBulkScope} out of a request, whatever carries it: `lotId` or `purchaseId` for
 * the target, `onlyOpenLots=true`, the ticked containers as JSON (`selectors`,
 * `excludeSelectors`), and the ticked copies as comma-separated ids (`itemIds`,
 * `excludeItemIds`).
 *
 * Takes a getter rather than a `FormData` so the scoped write (a form) and the selection count (a
 * query string) read the *same* definition — the bar's number and the write it precedes must not
 * be able to disagree about what was selected (#571).
 */
export function readLotBulkScope(get: (name: string) => string | null): LotBulkScope {
  const scope: LotBulkScope = {};
  const one = (name: string) => get(name)?.trim() || undefined;
  const list = (name: string) =>
    (get(name) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  scope.lotId = one("lotId");
  scope.purchaseId = one("purchaseId");
  const selectors = parseSelectors(get("selectors"));
  if (selectors.length > 0) scope.selectors = selectors;
  const excludeSelectors = parseSelectors(get("excludeSelectors"));
  if (excludeSelectors.length > 0) scope.excludeSelectors = excludeSelectors;
  const itemIds = list("itemIds");
  if (itemIds.length > 0) scope.itemIds = itemIds;
  const excludeItemIds = list("excludeItemIds");
  if (excludeItemIds.length > 0) scope.excludeItemIds = excludeItemIds;
  if (get("onlyOpenLots") === "true") scope.onlyOpenLots = true;
  return scope;
}

/** One issue group as a `where`: an issue id, or `"__none__"` for copies belonging to none. */
function issueKeyWhere(issueKey: string): Prisma.ItemWhereInput {
  return issueKey === "__none__"
    ? { stamp: { issueMemberships: { none: {} } } }
    : { stamp: { issueMemberships: { some: { issueId: issueKey } } } };
}

/** One container as a `where`, minus the `unpriced` chip, which no column carries and which is
 *  resolved separately (see {@link resolveLotBulkScope}). */
function selectorWhere(sel: LotBulkSelector): Prisma.ItemWhereInput {
  return {
    ...(sel.lotId ? { lotId: sel.lotId } : {}),
    ...(sel.issueKey ? issueKeyWhere(sel.issueKey) : {}),
    ...lotCopyFilterWhere(sel.filter),
    ...dispositionFilterWhere(sel.disposition),
  };
}

/**
 * Build the collection-scoped Prisma `where` for a {@link LotBulkScope}.
 *
 * Three layers (#571). The **target** is what the screen is about — a lot, or a purchase's lots —
 * and every other layer sits inside it, so an id or a container the client names can only ever
 * reach a copy already in view. Inside it, the **union** of the ticked containers and the ticked
 * copies; a scope naming neither is the whole target, which is how a single-copy row action and
 * the old whole-lot buttons still resolve. Then the **exclusions**, which is how unticking
 * something under a container works at all — the container's other copies run past the loaded
 * page, so there is no shorter list to fall back to.
 */
function lotBulkScopeWhere(
  collectionId: string,
  scope: LotBulkScope,
  /** Per-selector id lists standing in for the `unpriced` chip, which no column carries. */
  unpriced?: { selectors: (string[] | null)[]; excludeSelectors: (string[] | null)[] }
): Prisma.ItemWhereInput {
  const lotRelation: Prisma.PurchaseLotWhereInput = {};
  if (scope.purchaseId) lotRelation.purchaseId = scope.purchaseId;
  if (scope.onlyOpenLots) lotRelation.status = "open";
  const and: Prisma.ItemWhereInput[] = [
    {
      collectionId,
      ...(scope.lotId ? { lotId: scope.lotId } : {}),
      ...(Object.keys(lotRelation).length > 0 ? { lot: lotRelation } : {}),
    },
  ];

  const withUnpriced = (
    sel: LotBulkSelector,
    ids: string[] | null | undefined
  ): Prisma.ItemWhereInput =>
    ids ? { AND: [selectorWhere(sel), { id: { in: ids } }] } : selectorWhere(sel);

  const named: Prisma.ItemWhereInput[] = [
    ...(scope.selectors ?? []).map((sel, i) => withUnpriced(sel, unpriced?.selectors[i])),
    ...(scope.itemIds?.length ? [{ id: { in: scope.itemIds } }] : []),
  ];
  if (named.length === 1) and.push(named[0]);
  else if (named.length > 1) and.push({ OR: named });

  if (scope.excludeSelectors?.length) {
    and.push({
      NOT: {
        OR: scope.excludeSelectors.map((sel, i) =>
          withUnpriced(sel, unpriced?.excludeSelectors[i])
        ),
      },
    });
  }
  if (scope.excludeItemIds?.length) and.push({ NOT: { id: { in: scope.excludeItemIds } } });
  return { AND: and };
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

  const where = await resolveLotBulkScope(collectionId, scope);
  const count = await prisma.item.count({ where });
  if (count === 0) return { count: 0, delivered: [] };
  const delivered = await applyLotBulkChanges(where, changes);
  return { count, delivered };
}

/** The scope as a fully-resolved `where`, including the one filter no column carries. */
async function resolveLotBulkScope(
  collectionId: string,
  scope: LotBulkScope
): Promise<Prisma.ItemWhereInput> {
  // `unpriced` is the one chip no column answers (#565): it is a derived valuation, so a container
  // carrying it is resolved to the ids that valuation selects — the same fallback the paged read
  // already makes under that chip — bounded by the container it belongs to, never the whole
  // collection.
  const target = lotBulkScopeWhere(collectionId, {
    lotId: scope.lotId,
    purchaseId: scope.purchaseId,
    onlyOpenLots: scope.onlyOpenLots,
  });
  const resolveOne = async (sel: LotBulkSelector): Promise<string[] | null> =>
    sel.filter === "unpriced"
      ? listUnpricedItemIds(collectionId, { AND: [target, selectorWhere(sel)] })
      : null;
  const unpriced = {
    selectors: await Promise.all((scope.selectors ?? []).map(resolveOne)),
    excludeSelectors: await Promise.all((scope.excludeSelectors ?? []).map(resolveOne)),
  };
  return lotBulkScopeWhere(collectionId, scope, unpriced);
}

/** How many copies a {@link LotBulkScope} holds (#571) — what the selection bar says it is about.
 *
 * The bar cannot count its own selection: a ticked issue group under a filter chip has no
 * client-side figure (the summaries count whole groups), and `unpriced` is a valuation rather than
 * a column. So the number shown and the number written are read from the same place, and cannot
 * drift apart. */
export async function countLotBulkScope(
  ownerId: string,
  collectionId: string,
  scope: LotBulkScope
): Promise<number> {
  await assertCollectionOwner(ownerId, collectionId);
  if (!scope.lotId && !scope.purchaseId) return 0;
  return prisma.item.count({ where: await resolveLotBulkScope(collectionId, scope) });
}
