import "server-only";
import { prisma } from "./db";
import { intakeStamps } from "./lots";
import { updateItem, type ItemUpdateInput } from "./items";
import { hasPurchaseArrived } from "./purchase-status";
import { CONFIRMED_API_REVIEW, nextApiReview } from "./auction-review";
import type { CopyReviewField } from "./copy-review";
import type { ArrivingCopy } from "./want-rules";

// The copies of a purchase lot, as the agent API writes them (#2551) — and the collector's *Confirm*
// that takes its marker off.
//
// #1390 kept the assistant away from copies altogether; the collector lifted that for purchase lots
// on 2026-11-16, so an assistant reading an order email can say what is in a lot rather than leave
// the collector to retype it. Three writes, each a narrower door onto the purchase screen's own:
//
// - **adding** goes through `intakeStamps`, the screen's intake, with the *to review* marker set in
//   the same write that creates the copies;
// - **correcting** a copy's stamp, condition or format goes through `updateItem`, the copy form's own
//   write, again with the marker in the same update;
// - **removing** deletes the copy, as the screen's *Remove from lot* does — with every condition
//   below part of the delete's own `where`, so a copy that arrives or a lot that closes between the
//   check and the delete is left standing.
//
// **What none of them touches**: a lot that is closed (its cost is frozen onto the copies, #122), an
// order that is the incoming half of a trade (its lot prices are carried-over cost, #644), an opening
// balance (not reachable through this surface at all), and a copy that is no longer *ordered* — one
// that has arrived is the collector's. An order that has arrived takes no new copies either: the
// screen would create them *to sort*, already in hand, and the assistant only ever describes what is
// still on its way.
//
// The domain functions the screen uses stay on the boundary test's forbidden map (`intakeStamps`,
// `removeLotItem`, `bulkUpdateLotItems`); these are the only doors the operations module is given.

/**
 * A write the agent API asked for that this module refuses, in a sentence written for the agent —
 * the operations module relays it as `invalid_request`. Anything else thrown here is a defect.
 */
export class LotCopyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LotCopyRefusedError";
  }
}

const CLOSED_LOT =
  "This lot is closed: its cost has been frozen onto its copies, so its copies are not changed through this surface. Reopening it is the collector's decision.";
const TRADE_ORDER =
  "This purchase is the incoming half of a trade: its copies are what the partner sent, recorded on the trade, and are not written through this surface.";
const ARRIVED_ORDER =
  "This order has arrived, so what is in it is the collector's to sort; copies are added through this surface only while the order is still on its way.";
const NOT_ORDERED = (state: string) =>
  `This copy is no longer ordered (it is ${state.replace(/_/g, " ")}): once a copy has arrived it is the collector's, and nothing on this surface changes it.`;

/** The lot a copy write is about, with what decides whether it takes one. */
interface LotGuard {
  readonly collectionId: string;
  readonly purchaseId: string;
  readonly status: string;
  readonly purchaseKind: string;
  readonly purchaseStatus: string;
  readonly fromTrade: boolean;
}

function refuseLot(lot: LotGuard): void {
  if (lot.purchaseKind !== "purchase") throw new Error("Lot not found or access denied.");
  if (lot.fromTrade) throw new LotCopyRefusedError(TRADE_ORDER);
  if (lot.status !== "open") throw new LotCopyRefusedError(CLOSED_LOT);
}

async function loadLotGuard(ownerId: string, lotId: string): Promise<LotGuard> {
  const lot = await prisma.purchaseLot.findFirst({
    where: { id: lotId, purchase: { collection: { ownerId } } },
    select: {
      status: true,
      purchaseId: true,
      purchase: { select: { collectionId: true, kind: true, status: true, tradeId: true } },
    },
  });
  if (!lot) throw new Error("Lot not found or access denied.");
  return {
    collectionId: lot.purchase.collectionId,
    purchaseId: lot.purchaseId,
    status: lot.status,
    purchaseKind: lot.purchase.kind,
    purchaseStatus: lot.purchase.status,
    fromTrade: lot.purchase.tradeId !== null,
  };
}

/**
 * Add copies to an open lot, marked for review (#2551): one stamp in a quantity, or every stamp of a
 * checklist once — the purchase screen's intake, with its defaults for everything the agent does not
 * name (no certificate, no location, no photos, none of the disposition flags). Returns the copies.
 */
export async function addLotCopiesByApi(
  ownerId: string,
  lotId: string,
  input: {
    stampId?: string | null;
    checklistId?: string | null;
    copies?: number;
    conditionId: string;
    formatId?: string | null;
  }
): Promise<ArrivingCopy[]> {
  const lot = await loadLotGuard(ownerId, lotId);
  refuseLot(lot);
  if (hasPurchaseArrived(lot.purchaseStatus)) throw new LotCopyRefusedError(ARRIVED_ORDER);
  return intakeStamps(ownerId, { lotId }, {
    stampId: input.stampId ?? null,
    checklistId: input.checklistId ?? null,
    copies: input.copies,
    conditionId: input.conditionId,
    formatId: input.formatId ?? null,
    apiReviewAt: new Date(),
  });
}

/** A copy a correction or a removal is about, with its lot. */
async function loadCopyGuard(ownerId: string, itemId: string) {
  const item = await prisma.item.findFirst({
    where: { id: itemId, collection: { ownerId } },
    select: {
      lotId: true,
      stampId: true,
      conditionId: true,
      formatId: true,
      deliveryState: true,
      apiReviewAt: true,
      apiReviewCreated: true,
      apiReviewFields: true,
    },
  });
  if (!item || !item.lotId) throw new Error("Copy not found or access denied.");
  const lot = await loadLotGuard(ownerId, item.lotId);
  refuseLot(lot);
  if (item.deliveryState !== "ordered") throw new LotCopyRefusedError(NOT_ORDERED(item.deliveryState));
  return { item, lot };
}

/**
 * Correct a copy still ordered on an open lot (#2551): its stamp, its condition, its format — each
 * only when sent. The marker accumulates what changed; a field sent as it already stands is not a
 * change and is not named. Returns the fields that changed, empty when nothing did (nothing is then
 * written and the marker is left as it was).
 */
export async function correctLotCopyByApi(
  ownerId: string,
  itemId: string,
  changes: { stampId?: string; conditionId?: string; formatId?: string | null }
): Promise<CopyReviewField[]> {
  const { item, lot } = await loadCopyGuard(ownerId, itemId);
  const data: ItemUpdateInput = {};
  const fields: CopyReviewField[] = [];
  if (changes.stampId !== undefined && changes.stampId !== item.stampId) {
    data.stampId = changes.stampId;
    fields.push("stamp");
  }
  if (changes.conditionId !== undefined && changes.conditionId !== item.conditionId) {
    data.conditionId = changes.conditionId;
    fields.push("condition");
  }
  if (changes.formatId !== undefined && changes.formatId !== item.formatId) {
    data.formatId = changes.formatId;
    fields.push("format");
  }
  if (fields.length === 0) return [];
  const review = nextApiReview(item, { kind: "changed", fields }, new Date());
  // A row of the purchase's screen: a move recorded from it names the purchase (#2277).
  await updateItem(ownerId, itemId, data, { source: "purchase", sourceId: lot.purchaseId }, review);
  return fields;
}

/**
 * Remove a copy still ordered from its open lot (#2551) — it is deleted, as the screen's *Remove from
 * lot* deletes it: a copy that exists only to populate a lot is not orphaned. Every condition is in
 * the delete's own `where`, so one that stopped holding since the check leaves the copy standing.
 */
export async function removeLotCopyByApi(ownerId: string, itemId: string): Promise<void> {
  const { lot } = await loadCopyGuard(ownerId, itemId);
  const { count } = await prisma.item.deleteMany({
    where: {
      id: itemId,
      collectionId: lot.collectionId,
      deliveryState: "ordered",
      lot: { status: "open", purchase: { kind: "purchase", tradeId: null } },
    },
  });
  if (count === 0) {
    // Something moved between the check and the delete; say what, from the copy as it now stands.
    await loadCopyGuard(ownerId, itemId);
    throw new LotCopyRefusedError("This copy changed while it was being removed. Read the purchase again.");
  }
}

/**
 * The collector's *Confirm* (#2551): the marker comes off the named copies, or off every marked copy
 * of a lot. Copies without a marker are simply already confirmed. Returns how many were confirmed.
 * The only writer that clears a copy's marker — on the boundary test's `REVIEW_CLEARERS`.
 */
export async function confirmCopyApiReviews(
  ownerId: string,
  scope: { itemIds: readonly string[] } | { lotId: string }
): Promise<number> {
  const where =
    "lotId" in scope
      ? { lotId: scope.lotId }
      : { id: { in: [...new Set(scope.itemIds)] } };
  const { count } = await prisma.item.updateMany({
    where: { ...where, collection: { ownerId }, apiReviewAt: { not: null } },
    data: CONFIRMED_API_REVIEW,
  });
  return count;
}
