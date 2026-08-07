"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createItem,
  updateItem,
  deleteItem,
  disposeItem,
  restoreItem,
  resolveItemVariant,
  getItemListItem,
  setItemPlatformExclusion,
} from "@/lib/items";
import type { ItemListItem } from "@/lib/items";
import { isDisposalReason } from "@/lib/disposal";
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
  formatId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  notes: string | null;
  locationId: string | null;
  locationRef: string | null;
  deliveryState: string | null;
  /** Platforms this copy is never listed on (#506), as the form's comma-separated hidden field.
   * Always present (an empty list clears the set) — the form is one of the surfaces that owns the
   * whole answer, unlike the row and bulk toggles which change one platform. */
  excludedPlatformIds: string[];
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
  // Blank means single — the dictionary holds only the multiples.
  const formatRaw = str(formData, "formatId");

  const data: ItemFields = {
    stampId,
    conditionId,
    certificateStatusId: certRaw || null,
    formatId: formatRaw || null,
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
    excludedPlatformIds: str(formData, "excludedPlatformIds")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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

/** Mark a copy as no longer held (#394/#395). The domain's refusals are surfaced verbatim: they
 * name the offer to withdraw first, or say why the copy cannot be disposed of yet — a blocked path
 * that only said "failed" would be unguessable. */
export async function disposeItemAction(
  itemId: string,
  formData: FormData
): Promise<ItemActionState> {
  const session = await getSession();
  const reason = str(formData, "disposalReason");
  if (!isDisposalReason(reason)) {
    return { status: "error", message: "Pick why this copy is no longer held." };
  }
  try {
    await disposeItem(session.user.id, itemId, {
      reason,
      note: str(formData, "disposalNote") || null,
    });
    return { status: "success" };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to update this copy. Please try again.";
    return { status: "error", message };
  }
}

/** Set aside copies from one platform, or bring them back (#506). One action for the row's own ⋮
 * entry and the bulk bar, because they are the same decision at two sizes; the domain narrows the
 * ids to the collection and refuses an unknown platform. */
export async function setItemPlatformExclusionAction(
  collectionId: string,
  itemIds: string[],
  platformId: string,
  excluded: boolean
): Promise<ItemActionState> {
  const session = await getSession();
  try {
    await setItemPlatformExclusion(
      session.user.id,
      collectionId,
      itemIds,
      platformId,
      excluded
    );
    return { status: "success" };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to update this copy. Please try again.";
    return { status: "error", message };
  }
}

/** Reverse a disposal — the copy turned up again (#394). */
export async function restoreItemAction(itemId: string): Promise<ItemActionState> {
  const session = await getSession();
  try {
    await restoreItem(session.user.id, itemId);
    return { status: "success" };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to update this copy. Please try again.";
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
