"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStamp,
  createVariant,
  updateStamp,
  updateStampWithCatalog,
  deleteStamp,
  getStampChildCount,
  upsertStampCatalogNumber,
  deleteStampCatalogNumber,
  getStampCatalogPrices,
  upsertStampCatalogPrice,
  deleteStampCatalogPrice,
} from "@/lib/stamps";
import type { CatalogPriceInput, StampCatalogPriceDisplay } from "@/lib/stamps";

export type StampActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function parseCatalogPrices(formData: FormData): CatalogPriceInput[] {
  const prices: CatalogPriceInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("catalogPrice_")) {
      const catalogEditionId = key.slice("catalogPrice_".length);
      const price = (value as string).trim();
      if (!price) continue;
      const currency = ((formData.get(`catalogCurrency_${catalogEditionId}`) as string | null) ?? "").trim();
      if (!currency) continue;
      if (isNaN(Number(price))) continue;
      prices.push({ catalogEditionId, price, currency });
    }
  }
  return prices;
}

function parseIssuedDate(formData: FormData): {
  issuedDay: number | undefined;
  issuedMonth: number | undefined;
  issuedYear: number | undefined;
  error?: string;
} {
  const dayRaw = ((formData.get("issuedDay") as string | null) ?? "").trim();
  const monthRaw = ((formData.get("issuedMonth") as string | null) ?? "").trim();
  const yearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedDay = dayRaw ? parseInt(dayRaw, 10) : undefined;
  const issuedMonth = monthRaw ? parseInt(monthRaw, 10) : undefined;
  const issuedYear = yearRaw ? parseInt(yearRaw, 10) : undefined;
  if (yearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { issuedDay, issuedMonth, issuedYear, error: "Issued year must be a valid year (1840–2100)." };
  }
  if (monthRaw && (isNaN(issuedMonth!) || issuedMonth! < 1 || issuedMonth! > 12)) {
    return { issuedDay, issuedMonth, issuedYear, error: "Issued month must be between 1 and 12." };
  }
  if (dayRaw && (isNaN(issuedDay!) || issuedDay! < 1 || issuedDay! > 31)) {
    return { issuedDay, issuedMonth, issuedYear, error: "Issued day must be between 1 and 31." };
  }
  return { issuedDay, issuedMonth, issuedYear };
}

export async function createStampAction(
  collectionId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || undefined;
  const { issuedDay, issuedMonth, issuedYear, error } = parseIssuedDate(formData);
  if (error) return { status: "error", message: error };
  try {
    await createStamp(session.user.id, collectionId, { name, issuedDay, issuedMonth, issuedYear });
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
  const { issuedDay, issuedMonth, issuedYear, error } = parseIssuedDate(formData);
  if (error) return { status: "error", message: error };
  try {
    await createVariant(session.user.id, parentId, { name, issuedDay, issuedMonth, issuedYear });
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
  const dayRaw = ((formData.get("issuedDay") as string | null) ?? "").trim();
  const monthRaw = ((formData.get("issuedMonth") as string | null) ?? "").trim();
  const yearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedDay = dayRaw ? parseInt(dayRaw, 10) : null;
  const issuedMonth = monthRaw ? parseInt(monthRaw, 10) : null;
  const issuedYear = yearRaw ? parseInt(yearRaw, 10) : null;
  if (yearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { status: "error", message: "Issued year must be a valid year (1840–2100)." };
  }
  if (monthRaw && (isNaN(issuedMonth!) || issuedMonth! < 1 || issuedMonth! > 12)) {
    return { status: "error", message: "Issued month must be between 1 and 12." };
  }
  if (dayRaw && (isNaN(issuedDay!) || issuedDay! < 1 || issuedDay! > 31)) {
    return { status: "error", message: "Issued day must be between 1 and 31." };
  }
  try {
    await updateStamp(session.user.id, stampId, { name, issuedDay, issuedMonth, issuedYear });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update stamp. Please try again." };
  }
}

export async function updateStampWithCatalogAction(
  stampId: string,
  formData: FormData
): Promise<StampActionState> {
  const session = await getSession();
  const nameRaw = ((formData.get("name") as string | null) ?? "").trim();
  const name = nameRaw || null;
  const { issuedDay, issuedMonth, issuedYear, error } = parseIssuedDate(formData);
  if (error) return { status: "error", message: error };

  const catalogNumbers: { catalogVendorId: string; number: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("catalogNumber_")) {
      const catalogVendorId = key.slice("catalogNumber_".length);
      const num = (value as string).trim();
      if (num) catalogNumbers.push({ catalogVendorId, number: num });
    }
  }

  const hasPriceEntries = Array.from(formData.keys()).some((k) => k.startsWith("catalogPrice_"));
  const catalogPrices = hasPriceEntries ? parseCatalogPrices(formData) : undefined;

  const requiredRaw = formData.get("requiredForCompleteness") as string | null;
  const requiredForCompleteness =
    requiredRaw === null ? undefined : requiredRaw === "true";

  try {
    await updateStampWithCatalog(session.user.id, stampId, {
      name,
      issuedDay: issuedDay ?? null,
      issuedMonth: issuedMonth ?? null,
      issuedYear: issuedYear ?? null,
      catalogNumbers,
      catalogPrices,
      requiredForCompleteness,
    });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update stamp. Please try again." };
  }
}

export async function deleteStampAction(
  stampId: string,
  mode: "cascade" | "reparent" = "cascade"
): Promise<StampActionState> {
  const session = await getSession();
  try {
    await deleteStamp(session.user.id, stampId, mode);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete stamp. Please try again." };
  }
}

export async function getStampChildCountAction(
  stampId: string
): Promise<{ count: number } | { error: string }> {
  const session = await getSession();
  try {
    const count = await getStampChildCount(session.user.id, stampId);
    return { count };
  } catch {
    return { error: "Failed to check stamp children." };
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

export async function getStampCatalogPricesAction(
  stampId: string
): Promise<StampCatalogPriceDisplay[]> {
  const session = await getSession();
  return getStampCatalogPrices(session.user.id, stampId);
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
