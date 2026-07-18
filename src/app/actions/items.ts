"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createItem, updateItem, deleteItem } from "@/lib/items";

export type ItemActionState =
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

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

interface ItemFields {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  contactId: string | null;
  acquiredDate: string | null;
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  notes: string | null;
}

interface ParsedItemFields {
  data: ItemFields;
  error?: string;
}

/** Parse and validate the shared add/edit copy form. Disposition flags, condition and
 * certificate are hidden inputs carrying selected ids; date/money mirror the stamp form. */
function parseItemFields(formData: FormData): ParsedItemFields {
  const stampId = str(formData, "stampId");
  const conditionId = str(formData, "conditionId");
  const certRaw = str(formData, "certificateStatusId");
  const priceRaw = str(formData, "purchasePrice");
  const currencyRaw = str(formData, "purchaseCurrency");
  const acquiredRaw = str(formData, "acquiredDate");

  const data: ItemFields = {
    stampId,
    conditionId,
    certificateStatusId: certRaw || null,
    inCollection: bool(formData, "inCollection"),
    forSale: bool(formData, "forSale"),
    forTrade: bool(formData, "forTrade"),
    contactId: str(formData, "contactId") || null,
    acquiredDate: acquiredRaw || null,
    purchasePrice: priceRaw || null,
    purchaseCurrency: currencyRaw || null,
    notes: str(formData, "notes") || null,
  };

  if (!stampId) return { data, error: "A stamp must be selected." };
  if (!conditionId) return { data, error: "A condition must be selected." };
  // A date control submits `YYYY-MM-DD`; reject anything else.
  if (acquiredRaw && !/^\d{4}-\d{2}-\d{2}$/.test(acquiredRaw)) {
    return { data, error: "Acquired date must be a valid date." };
  }
  if (priceRaw && isNaN(Number(priceRaw))) {
    return { data, error: "Purchase price must be a number." };
  }
  if (priceRaw && !currencyRaw) {
    return { data, error: "Currency is required when a purchase price is set." };
  }
  return { data };
}

export async function createItemAction(
  collectionId: string,
  formData: FormData
): Promise<ItemActionState> {
  const session = await getSession();
  const { data, error } = parseItemFields(formData);
  if (error) return { status: "error", message: error };
  try {
    await createItem(session.user.id, collectionId, data);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to add copy. Please try again." };
  }
}

export async function updateItemAction(
  itemId: string,
  formData: FormData
): Promise<ItemActionState> {
  const session = await getSession();
  const { data, error } = parseItemFields(formData);
  if (error) return { status: "error", message: error };
  try {
    // Re-pointing stampId is handled by the domain (appends ItemVariantHistory).
    await updateItem(session.user.id, itemId, {
      ...data,
      variantChangeNote: str(formData, "variantChangeNote") || null,
    });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update copy. Please try again." };
  }
}

export async function deleteItemAction(itemId: string): Promise<ItemActionState> {
  const session = await getSession();
  try {
    await deleteItem(session.user.id, itemId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete copy. Please try again." };
  }
}
