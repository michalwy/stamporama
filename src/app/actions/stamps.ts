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
  getStampSubtypeAssignment,
  upsertStampCatalogNumber,
  deleteStampCatalogNumber,
  getStampCatalogPrices,
  getStampPriceDetails,
  getQuickCatalogPriceContext,
  quickSetCatalogPrice,
} from "@/lib/stamps";
import type { StampSubtypeAssignment, QuickCatalogPriceContext } from "@/lib/stamps";
import type {
  CatalogPriceInput,
  StampCatalogPriceDisplay,
  StampPriceDetails,
} from "@/lib/stamps";

export type StampActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/** Result of loading quick-price context: the resolved target + any existing amount. */
export type QuickPriceContextState =
  | { status: "success"; context: QuickCatalogPriceContext }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** Load the quick catalog-price editor's context (target catalog/edition/currency and the
 * current amount) for a stamp at a condition × certificate (#121). */
export async function getQuickCatalogPriceContextAction(
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null
): Promise<QuickPriceContextState> {
  const session = await getSession();
  try {
    const context = await getQuickCatalogPriceContext(
      session.user.id,
      stampId,
      conditionId,
      certificateStatusId
    );
    return { status: "success", context };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not load catalog context.",
    };
  }
}

/** Quickly set a single catalog value for a stamp at a condition × certificate on its
 * primary catalog's latest edition (#121). `amount` is the raw string from the input. */
export async function quickSetCatalogPriceAction(
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  amount: string
): Promise<StampActionState> {
  const session = await getSession();
  const n = Number(amount);
  if (!amount.trim() || !Number.isFinite(n) || n < 0) {
    return { status: "error", message: "Enter a valid non-negative amount." };
  }
  try {
    await quickSetCatalogPrice(session.user.id, stampId, conditionId, certificateStatusId, n);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to set the catalog price.",
    };
  }
}

// Price cells are serialized as `catalogPrice_<editionId>~<conditionId>~<certId>`
// (empty cert segment = no certificate status; `~` never occurs in a cuid).
// Currency is per-edition: `catalogCurrency_<editionId>`.
function parseCatalogPrices(formData: FormData): CatalogPriceInput[] {
  const prices: CatalogPriceInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("catalogPrice_")) continue;
    const [catalogEditionId, conditionId, certRaw] = key
      .slice("catalogPrice_".length)
      .split("~");
    if (!catalogEditionId || !conditionId) continue;
    const price = (value as string).trim();
    if (!price) continue;
    const currency = ((formData.get(`catalogCurrency_${catalogEditionId}`) as string | null) ?? "").trim();
    if (!currency) continue;
    if (isNaN(Number(price))) continue;
    prices.push({
      catalogEditionId,
      conditionId,
      certificateStatusId: certRaw ? certRaw : null,
      price,
      currency,
    });
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

  // Subtype fields are present only when the edit form renders them (child stamps).
  // `undefined` leaves the stored values untouched.
  const subtypeId = formData.has("subtypeId")
    ? ((formData.get("subtypeId") as string) || null)
    : undefined;
  const overrideRaw = formData.get("actsAsVariantOverride") as string | null;
  const actsAsVariantOverride =
    overrideRaw === null
      ? undefined
      : overrideRaw === "true"
        ? true
        : overrideRaw === "false"
          ? false
          : null;

  try {
    await updateStampWithCatalog(session.user.id, stampId, {
      name,
      issuedDay: issuedDay ?? null,
      issuedMonth: issuedMonth ?? null,
      issuedYear: issuedYear ?? null,
      catalogNumbers,
      catalogPrices,
      requiredForCompleteness,
      subtypeId,
      actsAsVariantOverride,
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

export async function getStampSubtypeAssignmentAction(
  stampId: string
): Promise<StampSubtypeAssignment> {
  const session = await getSession();
  return getStampSubtypeAssignment(session.user.id, stampId);
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

export async function getStampPriceDetailsAction(
  stampId: string
): Promise<StampPriceDetails> {
  const session = await getSession();
  return getStampPriceDetails(session.user.id, stampId);
}
