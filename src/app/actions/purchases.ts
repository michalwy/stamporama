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

export type PurchaseActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

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
      platformId: optionalStr(formData, "platformId"),
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
