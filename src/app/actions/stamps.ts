"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStamp,
  createVariant,
  updateStamp,
  deleteStamp,
  upsertStampCatalogNumber,
  deleteStampCatalogNumber,
  upsertStampCatalogPrice,
  deleteStampCatalogPrice,
} from "@/lib/stamps";

export type StampActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function createStampAction(
  collectionId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || undefined;
  const issuedYearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedYear = issuedYearRaw ? parseInt(issuedYearRaw, 10) : undefined;
  if (issuedYearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { status: "error", message: "Issued year must be a valid year." };
  }
  try {
    await createStamp(session.user.id, collectionId, { name, issuedYear });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create stamp. Please try again." };
  }
}

export async function createVariantAction(
  parentId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || undefined;
  const issuedYearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedYear = issuedYearRaw ? parseInt(issuedYearRaw, 10) : undefined;
  if (issuedYearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { status: "error", message: "Issued year must be a valid year." };
  }
  try {
    await createVariant(session.user.id, parentId, { name, issuedYear });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create variant. Please try again." };
  }
}

export async function updateStampAction(
  stampId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const nameRaw = ((formData.get("name") as string | null) ?? "").trim();
  const name = nameRaw || null;
  const issuedYearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedYear = issuedYearRaw ? parseInt(issuedYearRaw, 10) : null;
  if (issuedYearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { status: "error", message: "Issued year must be a valid year." };
  }
  try {
    await updateStamp(session.user.id, stampId, { name, issuedYear });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update stamp. Please try again." };
  }
}

export async function deleteStampAction(stampId: string): Promise<StampActionState> {
  const session = await getSession();
  try {
    await deleteStamp(session.user.id, stampId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete stamp. Please try again." };
  }
}

export async function upsertStampCatalogNumberAction(
  stampId: string,
  catalogVendorId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const number = ((formData.get("number") as string | null) ?? "").trim();
  if (!number) return { status: "error", message: "Catalog number is required." };
  try {
    await upsertStampCatalogNumber(session.user.id, stampId, catalogVendorId, number);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save catalog number. Please try again." };
  }
}

export async function deleteStampCatalogNumberAction(
  stampId: string,
  catalogVendorId: string
): Promise<StampActionState> {
  const session = await getSession();
  try {
    await deleteStampCatalogNumber(session.user.id, stampId, catalogVendorId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete catalog number. Please try again." };
  }
}

export async function upsertStampCatalogPriceAction(
  stampId: string,
  catalogEditionId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const priceRaw = ((formData.get("price") as string | null) ?? "").trim();
  const currency = ((formData.get("currency") as string | null) ?? "").trim();
  if (!priceRaw) return { status: "error", message: "Price is required." };
  if (!currency) return { status: "error", message: "Currency is required." };
  if (isNaN(Number(priceRaw))) return { status: "error", message: "Price must be a valid number." };
  try {
    await upsertStampCatalogPrice(session.user.id, stampId, catalogEditionId, priceRaw, currency);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save catalog price. Please try again." };
  }
}

export async function deleteStampCatalogPriceAction(
  stampId: string,
  catalogEditionId: string
): Promise<StampActionState> {
  const session = await getSession();
  try {
    await deleteStampCatalogPrice(session.user.id, stampId, catalogEditionId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete catalog price. Please try again." };
  }
}
