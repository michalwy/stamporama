"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createPurchase,
  updatePurchase,
  deletePurchase,
  type PurchaseCreateInput,
  type PurchaseStatus,
} from "@/lib/purchases";
import {
  createLot,
  updateLot,
  deleteLot,
  removeLotItem,
  intakeStamps,
  closeLot,
  reopenLot,
} from "@/lib/lots";

export type PurchaseActionState =
  | { status: "idle" }
  | { status: "success" }
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
): Promise<PurchaseActionState> {
  const session = await getSession();
  const { data, error } = parseFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await createPurchase(session.user.id, collectionId, data);
    return { status: "success" };
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
    await createLot(session.user.id, purchaseId, price, optionalStr(formData, "title"));
    return { status: "success" };
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
