"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createPurchase,
  updatePurchase,
  setPurchaseStatus,
  deletePurchase,
  type PurchaseCreateInput,
  type PurchaseStatus,
} from "@/lib/purchases";
import {
  createLot,
  createLotWithStamps,
  updateLot,
  deleteLot,
  removeLotItem,
  intakeStamps,
  closeLot,
  reopenLot,
  markPurchaseArrived,
  bulkUpdateLotItems,
  bulkUpdateLotItemsScoped,
  type LotBulkChanges,
  type LotBulkScope,
} from "@/lib/lots";
import { parsePhotoChangeSet } from "@/lib/photos";

export type PurchaseActionState =
  | { status: "idle" }
  | { status: "success"; id?: string }
  | { status: "error"; message: string };

/** Create returns the new purchase's id so the caller can navigate straight to its
 * detail view (#139). */
export type CreatePurchaseActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

/** Result of a lot-close attempt exposed to the client: success, a friendly error, or a
 * structured block naming the copies that must be fixed before the lot can close. */
export type CloseLotActionState =
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "blocked"; reason: "missing-price" | "zero-weight" | "empty"; itemIds: string[]; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function optionalStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v || null;
}

/** The three disposition flags an intake form can preset on its copies (#160). A flag counts
 * as on only when its field is the string "true"; absent fields default off. */
function parseDisposition(formData: FormData): {
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
} {
  return {
    inCollection: str(formData, "inCollection") === "true",
    forSale: str(formData, "forSale") === "true",
    forTrade: str(formData, "forTrade") === "true",
  };
}

/** A price string → number in whole cents precision, or `null` when blank/invalid. */
function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

const VALID_STATUS = new Set<PurchaseStatus>(["preparing", "in_transit", "arrived"]);

/** Parse the purchase header from the dialog form. The order's line items — inventory
 * lots and non-inventory expenses — are not captured here; they are managed during lot
 * intake (#121). */
function parseFields(formData: FormData): { data: PurchaseCreateInput; error?: string } {
  const purchasedAt = str(formData, "purchasedAt");
  if (!purchasedAt) return { data: {} as PurchaseCreateInput, error: "A purchase date is required." };
  const currency = str(formData, "currency");
  if (!currency) return { data: {} as PurchaseCreateInput, error: "A currency is required." };
  const statusRaw = str(formData, "status") as PurchaseStatus;
  const status = VALID_STATUS.has(statusRaw) ? statusRaw : "preparing";

  return {
    data: {
      contactId: optionalStr(formData, "contactId"),
      contactName: optionalStr(formData, "contactName"),
      platformId: optionalStr(formData, "platformId"),
      platformName: optionalStr(formData, "platformName"),
      purchasedAt,
      currency,
      shippingCost: parseMoney(str(formData, "shippingCost")),
      status,
    },
  };
}

export async function createPurchaseAction(
  collectionId: string,
  formData: FormData
): Promise<CreatePurchaseActionState> {
  const session = await getSession();
  const { data, error } = parseFields(formData);
  if (error) return { status: "error", message: error };
  try {
    const purchase = await createPurchase(session.user.id, collectionId, data);
    return { status: "success", id: purchase.id };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to create purchase. Please try again.",
    };
  }
}

export async function updatePurchaseAction(
  purchaseId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const { data, error } = parseFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await updatePurchase(session.user.id, purchaseId, data);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update purchase. Please try again.",
    };
  }
}

/** Set a purchase's delivery status inline from the detail view (#141). Only handles the
 * `preparing` / `in_transit` transitions; marking arrived has copy side-effects and goes
 * through `markPurchaseArrivedAction`. */
export async function setPurchaseStatusAction(
  purchaseId: string,
  status: PurchaseStatus
): Promise<PurchaseActionState> {
  const session = await getSession();
  if (status === "arrived") {
    return { status: "error", message: "Use “Mark arrived” to mark a purchase arrived." };
  }
  try {
    await setPurchaseStatus(session.user.id, purchaseId, status);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update status. Please try again.",
    };
  }
}

export async function deletePurchaseAction(
  purchaseId: string
): Promise<PurchaseActionState> {
  const session = await getSession();
  try {
    await deletePurchase(session.user.id, purchaseId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to delete purchase. Please try again.",
    };
  }
}

// --- Lot lifecycle + intake (ADR-0009 §3/§5, #121) -------------------------

export async function createLotAction(
  purchaseId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const price = parseMoney(str(formData, "price"));
  if (price == null) return { status: "error", message: "A valid lot price is required." };
  try {
    const lotId = await createLot(
      session.user.id,
      purchaseId,
      price,
      optionalStr(formData, "title")
    );
    return { status: "success", id: lotId };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add lot. Please try again.",
    };
  }
}

/** Create a lot and identify stamps into it in one step (the "add lot with stamps" flow,
 * #121). Expects the combined form: title/price plus the intake selection (stampId or
 * issueId) and condition/certificate/location. */
export async function createLotWithStampsAction(
  purchaseId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const price = parseMoney(str(formData, "price"));
  if (price == null) return { status: "error", message: "A valid lot price is required." };
  const conditionId = str(formData, "conditionId");
  if (!conditionId) return { status: "error", message: "A condition must be selected." };
  const stampId = optionalStr(formData, "stampId");
  const issueId = optionalStr(formData, "issueId");
  if (!stampId && !issueId) {
    return { status: "error", message: "Select a stamp or an issue to add." };
  }
  try {
    const { lotId } = await createLotWithStamps(session.user.id, purchaseId, {
      price,
      title: optionalStr(formData, "title"),
      stampId,
      issueId,
      conditionId,
      certificateStatusId: optionalStr(formData, "certificateStatusId"),
      locationId: optionalStr(formData, "locationId"),
      locationRef: optionalStr(formData, "locationRef"),
      photoChangeSet: parsePhotoChangeSet(formData),
      ...parseDisposition(formData),
    });
    return { status: "success", id: lotId };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add lot. Please try again.",
    };
  }
}

export async function updateLotAction(
  lotId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const price = parseMoney(str(formData, "price"));
  if (price == null) return { status: "error", message: "A valid lot price is required." };
  try {
    await updateLot(session.user.id, lotId, { price, title: optionalStr(formData, "title") });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update lot. Please try again.",
    };
  }
}

export async function deleteLotAction(lotId: string): Promise<PurchaseActionState> {
  const session = await getSession();
  try {
    await deleteLot(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to delete lot. Please try again.",
    };
  }
}

export async function removeLotItemAction(itemId: string): Promise<PurchaseActionState> {
  const session = await getSession();
  try {
    await removeLotItem(session.user.id, itemId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to remove copy. Please try again.",
    };
  }
}

/** Identify stamps into an open lot (intake, ADR-0009 §5, #121). The client sends either a
 * single `stampId` or an `issueId` (which fans out to the issue's required stamps), plus a
 * shared condition and optional certificate. Every created copy is `ordered` and not yet in
 * the collection; cost-basis stays pending until the lot closes. */
export async function intakeStampsAction(
  lotId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const conditionId = str(formData, "conditionId");
  if (!conditionId) return { status: "error", message: "A condition must be selected." };
  const stampId = optionalStr(formData, "stampId");
  const issueId = optionalStr(formData, "issueId");
  if (!stampId && !issueId) {
    return { status: "error", message: "Select a stamp or an issue to add." };
  }
  try {
    await intakeStamps(session.user.id, lotId, {
      stampId,
      issueId,
      conditionId,
      certificateStatusId: optionalStr(formData, "certificateStatusId"),
      locationId: optionalStr(formData, "locationId"),
      locationRef: optionalStr(formData, "locationRef"),
      photoChangeSet: parsePhotoChangeSet(formData),
      ...parseDisposition(formData),
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add copies. Please try again.",
    };
  }
}

export async function closeLotAction(lotId: string): Promise<CloseLotActionState> {
  const session = await getSession();
  try {
    const result = await closeLot(session.user.id, lotId);
    if (result.ok) return { status: "success" };
    const message =
      result.reason === "missing-price"
        ? `Cannot close: ${result.itemIds.length} cop${result.itemIds.length === 1 ? "y lacks" : "ies lack"} a primary-catalog price for their condition. Add the catalog price, or fix the copy.`
        : result.reason === "zero-weight"
          ? "Cannot close: the lot has a cost to split but every copy has a zero catalog price."
          : "Cannot close an empty lot. Identify at least one copy first.";
    return { status: "blocked", reason: result.reason, itemIds: result.itemIds, message };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to close lot. Please try again.",
    };
  }
}

export async function reopenLotAction(lotId: string): Promise<PurchaseActionState> {
  const session = await getSession();
  try {
    await reopenLot(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to reopen lot. Please try again.",
    };
  }
}

/** Mark a purchase arrived: status → arrived, its `ordered` copies → `to_sort`, and (when a
 * location is chosen) file every order copy into it (#121). */
export async function markPurchaseArrivedAction(
  purchaseId: string,
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  try {
    await markPurchaseArrived(session.user.id, purchaseId, {
      locationId: optionalStr(formData, "locationId"),
    });
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to mark arrived. Please try again.",
    };
  }
}

/** Bulk sorting change over a set of copies (#121): file them into a location and/or mark
 * them sorted. `itemIds` is a comma-separated list; `locationId` present (even blank = clear)
 * applies a location change; `markSorted=true` moves not-yet-sorted copies to delivered. */
/** Parse the shared bulk-change fields (location / delivery / disposition / mark-sorted) off a
 * form, present in both the id-list and scoped bulk actions. */
function parseBulkChanges(formData: FormData): LotBulkChanges {
  const changes: LotBulkChanges = {};
  // A present `locationId` field (even empty) signals a location change; absent means leave it.
  if (formData.has("locationId")) changes.locationId = optionalStr(formData, "locationId");
  const deliveryState = optionalStr(formData, "deliveryState");
  if (deliveryState) changes.deliveryState = deliveryState;
  // A present disposition field (value "true"/"false") signals a flag change; absent leaves it.
  if (formData.has("inCollection")) changes.inCollection = str(formData, "inCollection") === "true";
  if (formData.has("forSale")) changes.forSale = str(formData, "forSale") === "true";
  if (formData.has("forTrade")) changes.forTrade = str(formData, "forTrade") === "true";
  if (str(formData, "markSorted") === "true") changes.markSorted = true;
  return changes;
}

export async function bulkUpdateLotItemsAction(
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const itemIds = str(formData, "itemIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (itemIds.length === 0) {
    return { status: "error", message: "No copies selected." };
  }
  try {
    await bulkUpdateLotItems(session.user.id, itemIds, parseBulkChanges(formData));
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update copies. Please try again.",
    };
  }
}

/** Bulk-update every copy matching a server-resolved scope (a whole lot, an issue group within
 * a lot, or an issue across a purchase's open lots), so "mark all sorted" / "move all" are
 * correct for lots with more copies than one loaded page (#172). The scope is read from the
 * form: `collectionId` (required) plus `lotId` or `purchaseId`, optional `issueKey`, and
 * `onlyOpenLots=true`. Change fields are the same as {@link bulkUpdateLotItemsAction}. */
export async function bulkUpdateLotItemsScopedAction(
  formData: FormData
): Promise<PurchaseActionState> {
  const session = await getSession();
  const collectionId = str(formData, "collectionId");
  if (!collectionId) {
    return { status: "error", message: "Missing collection." };
  }
  const scope: LotBulkScope = {};
  const lotId = optionalStr(formData, "lotId");
  if (lotId) scope.lotId = lotId;
  const purchaseId = optionalStr(formData, "purchaseId");
  if (purchaseId) scope.purchaseId = purchaseId;
  const issueKey = optionalStr(formData, "issueKey");
  if (issueKey) scope.issueKey = issueKey;
  if (str(formData, "onlyOpenLots") === "true") scope.onlyOpenLots = true;
  if (!scope.lotId && !scope.purchaseId) {
    return { status: "error", message: "No lot selected." };
  }
  try {
    await bulkUpdateLotItemsScoped(session.user.id, collectionId, scope, parseBulkChanges(formData));
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to update copies. Please try again.",
    };
  }
}
