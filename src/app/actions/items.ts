"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createItem,
  updateItem,
  deleteItem,
  resolveItemVariant,
  getItemListItem,
} from "@/lib/items";
import type { ItemListItem } from "@/lib/items";
import { applyPhotoChangeSet, parsePhotoChangeSet } from "@/lib/photos";

export type ItemActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/** Result of the quick-offer create path (#241): the freshly created copy, enriched as an
 * {@link ItemListItem} so the flow can hand it straight to the offer step. */
export type CreateItemForOfferState =
  | { status: "success"; item: ItemListItem }
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
  notes: string | null;
  locationId: string | null;
  locationRef: string | null;
  deliveryState: string | null;
}

interface ParsedItemFields {
  data: ItemFields;
  error?: string;
}

/** Parse and validate the shared add/edit copy form. Disposition flags, condition and
 * certificate are hidden inputs carrying selected ids. Acquisition/cost now live on the
 * purchase model (ADR-0009), so the copy form no longer captures them. */
function parseItemFields(formData: FormData): ParsedItemFields {
  const stampId = str(formData, "stampId");
  const conditionId = str(formData, "conditionId");
  const certRaw = str(formData, "certificateStatusId");

  const data: ItemFields = {
    stampId,
    conditionId,
    certificateStatusId: certRaw || null,
    inCollection: bool(formData, "inCollection"),
    forSale: bool(formData, "forSale"),
    forTrade: bool(formData, "forTrade"),
    notes: str(formData, "notes") || null,
    locationId: str(formData, "locationId") || null,
    // A ref without a location is meaningless; drop it unless a location is set.
    locationRef: str(formData, "locationId")
      ? str(formData, "locationRef") || null
      : null,
    deliveryState: str(formData, "deliveryState") || null,
  };

  if (!stampId) return { data, error: "A stamp must be selected." };
  if (!conditionId) return { data, error: "A condition must be selected." };
  return { data };
}

export async function createItemAction(
  collectionId: string,
  formData: FormData
): Promise<ItemActionState> {
  const session = await getSession();
  const { data, error } = parseItemFields(formData);
  if (error) return { status: "error", message: error };
  const changeSet = parsePhotoChangeSet(formData);
  try {
    const item = await createItem(session.user.id, collectionId, data);
    if (changeSet) {
      await applyPhotoChangeSet(session.user.id, item.id, changeSet);
    }
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to add copy. Please try again." };
  }
}

/** Create a copy and return it enriched, for the end-to-end quick-offer flow (#241). Same
 * validation and photo handling as {@link createItemAction}; differs only in returning the
 * created {@link ItemListItem} so the caller can seed the offer step with it. */
export async function createItemForOfferAction(
  collectionId: string,
  formData: FormData
): Promise<CreateItemForOfferState> {
  const session = await getSession();
  const { data, error } = parseItemFields(formData);
  if (error) return { status: "error", message: error };
  const changeSet = parsePhotoChangeSet(formData);
  try {
    const created = await createItem(session.user.id, collectionId, data);
    if (changeSet) {
      await applyPhotoChangeSet(session.user.id, created.id, changeSet);
    }
    const item = await getItemListItem(session.user.id, created.id);
    return { status: "success", item };
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
  const changeSet = parsePhotoChangeSet(formData);
  try {
    // Re-pointing stampId is handled by the domain (appends ItemVariantHistory).
    await updateItem(session.user.id, itemId, {
      ...data,
      variantChangeNote: str(formData, "variantChangeNote") || null,
    });
    if (changeSet) {
      await applyPhotoChangeSet(session.user.id, itemId, changeSet);
    }
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update copy. Please try again." };
  }
}

/** First-class "Identify variant" action (ADR-0007 §6): re-point an unknown-variant copy
 * to a specific descendant variant, recording the change in its refinement history. */
export async function resolveItemVariantAction(
  itemId: string,
  formData: FormData
): Promise<ItemActionState> {
  const session = await getSession();
  const toStampId = str(formData, "stampId");
  if (!toStampId) return { status: "error", message: "A variant must be selected." };
  try {
    await resolveItemVariant(
      session.user.id,
      itemId,
      toStampId,
      str(formData, "variantChangeNote") || null
    );
    return { status: "success" };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to identify variant. Please try again.";
    return { status: "error", message };
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
