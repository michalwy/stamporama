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
  getBulkQuickCatalogPriceContext,
  getQuickCatalogPriceContext,
  quickSetCatalogPrices,
  getStampTranslations,
  STAMP_TRANSLATION_FIELDS,
} from "@/lib/stamps";
import type {
  BulkQuickPriceCatalog,
  BulkQuickPriceRow,
  BulkQuickPriceSubject,
  StampSubtypeAssignment,
  QuickCatalogPriceContext,
} from "@/lib/stamps";
import {
  applyStampPhotoChangeSet,
  listStampPhotos,
  parsePhotoChangeSet,
  promoteCopyPhotoToStamp,
  type PhotoRole,
  type PhotoSummary,
} from "@/lib/photos";
import { getStampMarketValueByStamp } from "@/lib/market-values";
import type { StampMarketValue } from "@/lib/market-values";
import { getStampEstimatedValue } from "@/lib/estimated-values";
import type { StampEstimatedValue } from "@/lib/estimated-values";
import { getStampPurchaseCosts } from "@/lib/purchase-costs";
import type { StampPurchaseCosts } from "@/lib/purchase-costs";
import type {
  CatalogPriceInput,
  StampCatalogPriceDisplay,
  StampPriceDetails,
} from "@/lib/stamps";
import { enforceStampCatalogDuplicates } from "@/lib/duplicate-catalog";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { parseTranslationValues } from "@/lib/translations";
import { parseStampAttributes } from "@/lib/stamp-attribute-kinds";

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
 * current amount) for a stamp at a condition × certificate (#121). The editor prices the
 * **single**; `displayFormatId` is only the format the caller is showing, and it buys the read-only
 * line saying what the typed figure works out at for a copy in that format (#343). */
export async function getQuickCatalogPriceContextAction(
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  displayFormatId: string | null = null
): Promise<QuickPriceContextState> {
  const session = await getSession();
  try {
    const context = await getQuickCatalogPriceContext(
      session.user.id,
      stampId,
      conditionId,
      certificateStatusId,
      displayFormatId
    );
    return { status: "success", context };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not load catalog context.",
    };
  }
}

/** Quickly set catalog values for a stamp at a condition × certificate, one per catalog vendor
 * active on the stamp's area — each lands on that catalog's latest edition (#170), **at the
 * single**, whatever format the calling screen is showing (see `quickSetCatalogPrices`). `entries`
 * carries raw amount strings from the inputs; only non-empty ones are submitted. */
export async function quickSetCatalogPricesAction(
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  entries: Array<{ catalogNameId: string; amount: string }>
): Promise<StampActionState> {
  const session = await getSession();
  const parsed: Array<{ catalogNameId: string; amount: number }> = [];
  for (const e of entries) {
    if (!e.amount.trim()) continue;
    const n = Number(normalizeDecimalInput(e.amount));
    if (!Number.isFinite(n) || n < 0) {
      return { status: "error", message: "Enter a valid non-negative amount." };
    }
    parsed.push({ catalogNameId: e.catalogNameId, amount: n });
  }
  if (parsed.length === 0) {
    return { status: "error", message: "Enter at least one catalog value." };
  }
  try {
    await quickSetCatalogPrices(session.user.id, stampId, conditionId, certificateStatusId, parsed);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to set the catalog price.",
    };
  }
}

/** Result of loading the bulk quick-price grid's context (#720): its columns and one row per
 *  subject, with whatever is already recorded. */
export type BulkQuickPriceContextState =
  | { status: "success"; catalogs: BulkQuickPriceCatalog[]; rows: BulkQuickPriceRow[] }
  | { status: "error"; message: string };

/** Load the quick catalog-price context for many `stamp × condition × certificate` subjects at once
 *  (#720) — the offer-wide grid's read. One round trip for a whole listing, where the per-row dialog
 *  makes one per row; see `getBulkQuickCatalogPriceContext` for what it deliberately leaves out. */
export async function getBulkQuickCatalogPriceContextAction(
  subjects: BulkQuickPriceSubject[]
): Promise<BulkQuickPriceContextState> {
  const session = await getSession();
  try {
    const { catalogs, rows } = await getBulkQuickCatalogPriceContext(session.user.id, subjects);
    return { status: "success", catalogs, rows };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not load catalog context.",
    };
  }
}

/** One row of a bulk save: a subject and the amounts typed for it, raw from the inputs. */
export interface BulkQuickPriceRowInput extends BulkQuickPriceSubject {
  entries: Array<{ catalogNameId: string; amount: string }>;
}

/** How a bulk save ended. `savedRows` is stated on both outcomes because a refusal part-way through
 *  has already written the rows before it — the grid reloads on that number rather than guessing. */
export type BulkQuickPriceSaveState =
  | { status: "success"; savedRows: number }
  | { status: "error"; message: string; savedRows: number };

/**
 * Set catalog values for **many** subjects in one submit (#720), each row landing exactly where the
 * per-row quick editor would put it: `quickSetCatalogPrices`, the latest edition of each catalog, at
 * the single. One save for a whole listing, which is the walk the offer's Items card exists to end.
 *
 * Every amount is **parsed before anything is written**: a typo in the last row must not leave the
 * first ten written and the grid claiming success. A row with no non-blank entry is *skipped* rather
 * than refused — a grid lists rows the collector may have nothing to say about, unlike the one-row
 * dialog where an empty submit is a mistake. A blank cell therefore records nothing and **deletes
 * nothing**: removing a price is an act on the stamp's own Prices tab, where what is being removed
 * is on screen.
 *
 * The writes are sequential and a failure stops there, reporting how many rows went in. Nothing is
 * rolled back: each row is an independent fact, and unwriting nine good rows because the tenth's
 * catalog vanished would throw away exactly the typing this dialog exists to save.
 */
export async function quickSetCatalogPricesBulkAction(
  rows: BulkQuickPriceRowInput[]
): Promise<BulkQuickPriceSaveState> {
  const session = await getSession();
  const parsed: Array<{ row: BulkQuickPriceRowInput; entries: Array<{ catalogNameId: string; amount: number }> }> =
    [];
  for (const row of rows) {
    const entries: Array<{ catalogNameId: string; amount: number }> = [];
    for (const e of row.entries) {
      if (!e.amount.trim()) continue;
      const n = Number(normalizeDecimalInput(e.amount));
      if (!Number.isFinite(n) || n < 0) {
        return { status: "error", message: "Enter a valid non-negative amount.", savedRows: 0 };
      }
      entries.push({ catalogNameId: e.catalogNameId, amount: n });
    }
    if (entries.length > 0) parsed.push({ row, entries });
  }
  if (parsed.length === 0) {
    return { status: "error", message: "Enter at least one catalog value.", savedRows: 0 };
  }
  let savedRows = 0;
  for (const { row, entries } of parsed) {
    try {
      await quickSetCatalogPrices(
        session.user.id,
        row.stampId,
        row.conditionId,
        row.certificateStatusId,
        entries
      );
      savedRows += 1;
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : "Failed to set the catalog prices.",
        savedRows,
      };
    }
  }
  return { status: "success", savedRows };
}

// Price cells are serialized as `catalogPrice_<editionId>~<conditionId>~<certId>~<formatId>`
// (an empty segment means "none" for the certificate and "single" for the format; `~` never
// occurs in a cuid). The format segment is trailing and optional, so a payload written before
// formats existed still parses — `split` simply yields undefined for it.
// Currency is per-edition: `catalogCurrency_<editionId>`.
function parseCatalogPrices(formData: FormData): CatalogPriceInput[] {
  const prices: CatalogPriceInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("catalogPrice_")) continue;
    const [catalogEditionId, conditionId, certRaw, formatRaw] = key
      .slice("catalogPrice_".length)
      .split("~");
    if (!catalogEditionId || !conditionId) continue;
    const price = normalizeDecimalInput((value as string).trim());
    if (!price) continue;
    const currency = ((formData.get(`catalogCurrency_${catalogEditionId}`) as string | null) ?? "").trim();
    if (!currency) continue;
    if (isNaN(Number(price))) continue;
    prices.push({
      catalogEditionId,
      conditionId,
      certificateStatusId: certRaw ? certRaw : null,
      formatId: formatRaw ? formatRaw : null,
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

  // Which checklists of the edited stamp's issue it should be on afterwards (#531). Present only
  // when the form rendered the picker, which needs an issue to render against — absent means the
  // caller is not managing checklists and every membership is left alone.
  const checklistIds = formData.has("checklistIds")
    ? ((formData.get("checklistIds") as string) || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
  const checklistIssueId = (formData.get("checklistIssueId") as string | null) || null;

  // Colnect item-ID (#247): present only when the edit form rendered the field.
  // Absent → undefined → leave the stored value untouched.
  const colnectId = formData.has("colnectId")
    ? ((formData.get("colnectId") as string).trim() || null)
    : undefined;

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

  const photoChangeSet = parsePhotoChangeSet(formData);

  // Catalogue attributes (#736), present only when the form rendered them — a dictionary select is
  // absent while its dictionary is empty, and every one of them is absent until the stored values
  // have loaded. Absent → undefined → the stored value is left alone; a blank clears it.
  const attributes = parseStampAttributes(formData);

  // Block-mode duplicate guard (#85): reject before mutating when the collection
  // blocks duplicate catalog identities. Warn mode passes through (the form shows
  // the non-blocking warning instead).
  const blockMessage = await enforceStampCatalogDuplicates(
    session.user.id,
    stampId,
    catalogNumbers
  );
  if (blockMessage) return { status: "error", message: blockMessage };

  try {
    await updateStampWithCatalog(session.user.id, stampId, {
      name,
      issuedDay: issuedDay ?? null,
      issuedMonth: issuedMonth ?? null,
      issuedYear: issuedYear ?? null,
      catalogNumbers,
      catalogPrices,
      colnectId,
      checklistIds,
      checklistIssueId,
      subtypeId,
      actsAsVariantOverride,
      ...attributes,
      translations: parseTranslationValues(formData, STAMP_TRANSLATION_FIELDS),
    });
    if (photoChangeSet) {
      await applyStampPhotoChangeSet(session.user.id, stampId, photoChangeSet);
    }
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update stamp. Please try again." };
  }
}

/** A stamp's stored per-language names (#296), for seeding the edit dialog's translation fields.
 * Fetched by id like the subtype assignment and the photos, so no caller's row shape has to carry
 * them. */
export async function getStampTranslationsAction(
  stampId: string
): Promise<Record<string, string>> {
  const session = await getSession();
  return getStampTranslations(session.user.id, stampId);
}

/** Load a stamp's committed photos for the edit dialog's photo tab (#137). Metadata only — the
 * collection-scoped serving route addresses variant bytes by photo id. */
export async function listStampPhotosAction(
  stampId: string
): Promise<PhotoSummary[]> {
  const session = await getSession();
  const photos = await listStampPhotos(session.user.id, stampId);
  return photos.map((p) => ({
    id: p.id,
    role: p.role,
    title: p.title,
    sortOrder: p.sortOrder,
  }));
}

/** Promote a copy photo to its stamp (#137): create an independent duplicated `Photo` on the
 * stamp the copy is identified to. The copy keeps its own photo unchanged. */
export async function promoteCopyPhotoAction(
  photoId: string,
  role: PhotoRole,
  title: string | null
): Promise<StampActionState> {
  const session = await getSession();
  try {
    await promoteCopyPhotoToStamp(session.user.id, photoId, { role, title });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to promote photo. Please try again." };
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

/** What the market paid for this stamp, per `condition × certificate × format` key with evidence
 * (#457; ADR-0022 §8). Read on demand beside the catalogue prices in the Valuation dialog —
 * nothing is stored, so a lot's final price edited on the auctions screen changes the next answer.
 * Empty for a stamp with no closed lots behind it. */
export async function getStampMarketValueAction(stampId: string): Promise<StampMarketValue[]> {
  const session = await getSession();
  return getStampMarketValueByStamp(session.user.id, stampId);
}

/** What this stamp is **likely** worth where nothing has been recorded for it: catalogue value ×
 * the learned realization ratio (#602; #520). An extrapolation, never a measurement — a key the
 * market has actually measured is left to the Market value section and absent here. Read on demand
 * beside the two figures above it; nothing is stored (ADR-0022 §7). */
export async function getStampEstimatedValueAction(
  stampId: string
): Promise<StampEstimatedValue> {
  const session = await getSession();
  return getStampEstimatedValue(session.user.id, stampId);
}

/** What the collector has paid for this stamp, per `condition × certificate × format` key over the
 * copies still held (#560). The third answer in the Valuation dialog, and the only one that is a
 * fact about this collection rather than about the stamp. Read on demand like the two beside it:
 * a lot closing freezes a cost basis, and the next read shows it. */
export async function getStampPurchaseCostsAction(
  stampId: string
): Promise<StampPurchaseCosts> {
  const session = await getSession();
  return getStampPurchaseCosts(session.user.id, stampId);
}
