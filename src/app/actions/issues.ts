"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createIssue,
  updateIssue,
  deleteIssue,
  previewIssueDeletion,
  addStampToIssue,
  addStampRangeToIssue,
  addVariantRangeToStamp,
  removeStampFromIssue,
  reorderIssueMembers,
  moveStampNode,
  reparentStampNode,
  moveIssueToArea,
  mergeIssues,
  previewIssueMerge,
  listIssueReferencedVendors,
  getChecklistPriceDetails,
  getIssueAreaId,
  getIssueRangeSuggestions,
  setIssueCatalogRange,
  ISSUE_TRANSLATION_FIELDS,
} from "@/lib/issues";
import type {
  AutoCreateStampsInput,
  IssueDeletionPreview,
  IssueMergePreview,
  ChecklistPriceDetails,
  IssueReferencedVendor,
  IssueRangeSuggestion,
} from "@/lib/issues";
import { getChecklistMarketValue } from "@/lib/market-values";
import type { ChecklistMarketValue } from "@/lib/market-values";
import { getChecklistEstimatedValue } from "@/lib/estimated-values";
import type { ChecklistEstimatedValue } from "@/lib/estimated-values";
import { applyStampPhotoChangeSet, parsePhotoChangeSet } from "@/lib/photos";
import { parseTranslationValues } from "@/lib/translations";
import { STAMP_TRANSLATION_FIELDS, getStampCatalogNumber } from "@/lib/stamps";
import { parseStampAttributes, parseStampSizeInput } from "@/lib/stamp-attribute-kinds";
import {
  parseCatalogNumberSpec,
  parseVariantNumberSpec,
  AUTO_CREATE_MAX_STAMPS,
  type CatalogNumberSpec,
} from "@/lib/catalog-number";
import { enforceCandidateCatalogDuplicates } from "@/lib/duplicate-catalog";

export async function getChecklistPriceDetailsAction(
  collectionId: string,
  checklistId: string
): Promise<ChecklistPriceDetails> {
  const session = await getSession();
  return getChecklistPriceDetails(session.user.id, collectionId, checklistId);
}

/** What the market paid for the whole set (#457; ADR-0022 §8) — the members' medians summed per
 * `condition × certificate × format` key, with the count of members behind each figure. Read on
 * demand beside the catalogue totals in the Valuation dialog. */
export async function getChecklistMarketValueAction(
  collectionId: string,
  checklistId: string
): Promise<ChecklistMarketValue> {
  const session = await getSession();
  return getChecklistMarketValue(session.user.id, collectionId, checklistId);
}

/** What the set is **likely** worth where its members have no recorded result: each member's
 * catalogue value × the learned realization ratio, summed per key (#602). An extrapolation, with
 * its own coverage count — a member with a measured median at a key is counted by the Market value
 * total instead, never by both. */
export async function getChecklistEstimatedValueAction(
  collectionId: string,
  checklistId: string
): Promise<ChecklistEstimatedValue> {
  const session = await getSession();
  return getChecklistEstimatedValue(session.user.id, collectionId, checklistId);
}

/** Coverage suggestions for an issue: vendors whose members extend the declared range. */
export async function getIssueRangeSuggestionsAction(
  collectionId: string,
  issueId: string
): Promise<IssueRangeSuggestion[]> {
  const session = await getSession();
  try {
    return await getIssueRangeSuggestions(session.user.id, collectionId, issueId);
  } catch {
    return [];
  }
}

/** Apply one coverage suggestion by widening a vendor's declared range on the issue. */
export async function applyIssueRangeSuggestionAction(
  collectionId: string,
  issueId: string,
  catalogVendorId: string,
  firstNumber: string,
  lastNumber: string | null
): Promise<IssueActionState> {
  const session = await getSession();
  try {
    await setIssueCatalogRange(session.user.id, collectionId, issueId, catalogVendorId, firstNumber, lastNumber);
    return { status: "success", issueId };
  } catch {
    return { status: "error", message: "Failed to update the catalog range. Please try again." };
  }
}

export type IssueActionState =
  | { status: "idle" }
  | { status: "success"; issueId?: string; stampId?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function parseCatalogNumbers(formData: FormData): { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[] {
  const result: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[] = [];
  const vendorIds = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith("issueCatalogFirst_")) {
      vendorIds.add(key.slice("issueCatalogFirst_".length));
    }
  }
  for (const catalogVendorId of vendorIds) {
    const first = ((formData.get(`issueCatalogFirst_${catalogVendorId}`) as string | null) ?? "").trim();
    const last = ((formData.get(`issueCatalogLast_${catalogVendorId}`) as string | null) ?? "").trim() || null;
    if (first) result.push({ catalogVendorId, firstNumber: first, lastNumber: last });
  }
  return result;
}

/**
 * Per-vendor prefix overrides typed into the issue dialog (#377), as `issueCatalogPrefix_<vendorId>`.
 * A blank field means "inherit the area's prefix" and is simply left out, so the returned array
 * *is* the issue's whole override set — {@link updateIssue} replaces on it.
 */
function parseCatalogPrefixes(formData: FormData): { catalogVendorId: string; areaPrefix: string }[] {
  const result: { catalogVendorId: string; areaPrefix: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("issueCatalogPrefix_")) continue;
    const catalogVendorId = key.slice("issueCatalogPrefix_".length);
    const areaPrefix = ((value as string) ?? "").trim();
    if (catalogVendorId && areaPrefix) result.push({ catalogVendorId, areaPrefix });
  }
  return result;
}

/** The same overrides as a plain record, for the duplicate check's prefix context (#85/#377): on
 * create the issue does not exist yet, so its prefixes can only come from the form. */
function prefixContext(
  prefixes: { catalogVendorId: string; areaPrefix: string }[]
): Record<string, string> {
  return Object.fromEntries(prefixes.map((p) => [p.catalogVendorId, p.areaPrefix]));
}

/**
 * Each vendor's catalog-number spec (#452), as `issueCatalogNumbers_<vendorId>`. One field per
 * catalog holding a comma-separated list of ranges, from which both the numbers to generate and
 * the series range the issue declares are derived. Blank fields are left out; the first field
 * that cannot be parsed stops the parse, since a half-understood spec must not create stamps.
 *
 * `updateIssueAction` still posts First/Last — on the edit dialog the pair *is* the declared
 * range, and nothing is generated — so {@link parseCatalogNumbers} stays beside this.
 */
function parseCatalogNumberSpecs(
  formData: FormData
): { specs: { catalogVendorId: string; spec: CatalogNumberSpec }[] } | { error: string } {
  const specs: { catalogVendorId: string; spec: CatalogNumberSpec }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("issueCatalogNumbers_")) continue;
    const catalogVendorId = key.slice("issueCatalogNumbers_".length);
    const raw = ((value as string) ?? "").trim();
    if (!catalogVendorId || !raw) continue;
    const spec = parseCatalogNumberSpec(raw);
    if ("error" in spec) return spec;
    specs.push({ catalogVendorId, spec });
  }
  return { specs };
}

/** The series range each spec declares, in the shape the issue stores (#452). Written for every
 *  catalog with numbers typed, whether or not it was ticked to generate stamps: the declared
 *  range is a fact about the issue, not about auto-create. */
function declaredCatalogNumbers(
  specs: { catalogVendorId: string; spec: CatalogNumberSpec }[]
): { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[] {
  return specs.map(({ catalogVendorId, spec }) => ({
    catalogVendorId,
    firstNumber: spec.declared.firstNumber,
    lastNumber: spec.declared.lastNumber,
  }));
}

/** Resolve the `autoCreateVendor_*` selection plus each vendor's spec into a generated
 *  {@link AutoCreateStampsInput}, or an error message. Shared by issue creation (#70) and
 *  post-creation add-range (#219): each selected vendor contributes the numbers its own spec
 *  generates, and stamps are matched across vendors by position, so every selected catalog must
 *  produce the same number of stamps. */
function buildAutoCreateStamps(
  formData: FormData,
  specs: { catalogVendorId: string; spec: CatalogNumberSpec }[]
): { input: AutoCreateStampsInput } | { error: string } {
  const vendorIds: string[] = [];
  for (const key of formData.keys()) {
    if (key.startsWith("autoCreateVendor_")) {
      vendorIds.push(key.slice("autoCreateVendor_".length));
    }
  }
  if (vendorIds.length === 0) {
    return { error: "Select at least one catalog vendor." };
  }

  const vendors: { catalogVendorId: string; numbers: string[] }[] = [];
  let count: number | null = null;
  for (const catalogVendorId of vendorIds) {
    const found = specs.find((s) => s.catalogVendorId === catalogVendorId);
    if (!found) {
      return { error: "Enter catalog numbers for each selected catalog." };
    }
    const numbers = found.spec.numbers;
    if (count === null) {
      count = numbers.length;
    } else if (count !== numbers.length) {
      return { error: "Selected catalogs must span the same number of stamps." };
    }
    vendors.push({ catalogVendorId, numbers });
  }
  if (count === null) count = 1;
  if (count > AUTO_CREATE_MAX_STAMPS) {
    return { error: `Range cannot exceed ${AUTO_CREATE_MAX_STAMPS} stamps.` };
  }
  return { input: { count, vendors } };
}

/** Whether the create form asked for stamps at all (#451). The ticked catalogs *are* the
 *  decision — the form carries no separate auto-create flag any more. */
function hasAutoCreateVendors(formData: FormData): boolean {
  for (const key of formData.keys()) {
    if (key.startsWith("autoCreateVendor_")) return true;
  }
  return false;
}

/** Flatten a generated range into duplicate-check candidates (#85). */
function autoCreateCandidates(
  input: AutoCreateStampsInput
): { catalogVendorId: string; number: string }[] {
  return input.vendors.flatMap((v) =>
    v.numbers.map((number) => ({ catalogVendorId: v.catalogVendorId, number }))
  );
}

export async function createIssueAction(
  collectionId: string,
  areaId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || null;
  const yearRaw = ((formData.get("year") as string | null) ?? "").trim();
  const year = yearRaw ? parseInt(yearRaw, 10) : null;
  if (yearRaw && (isNaN(year!) || year! < 1840 || year! > 2100)) {
    return { status: "error", message: "Year must be a valid year (1840–2100)." };
  }
  // The create dialog posts one spec per catalog (#452); the range it declares is derived
  // from it rather than typed.
  const parsedSpecs = parseCatalogNumberSpecs(formData);
  if ("error" in parsedSpecs) return { status: "error", message: parsedSpecs.error };
  const catalogNumbers = declaredCatalogNumbers(parsedSpecs.specs);
  const catalogPrefixes = parseCatalogPrefixes(formData);

  let autoCreateStamps: AutoCreateStampsInput | undefined;
  if (hasAutoCreateVendors(formData)) {
    const built = buildAutoCreateStamps(formData, parsedSpecs.specs);
    if ("error" in built) return { status: "error", message: built.error };
    autoCreateStamps = built.input;

    // Block-mode duplicate guard (#85): the generated numbers become real stamps,
    // so reject up front when any collides and the collection blocks duplicates. The prefixes
    // typed into this very form decide the candidates' identity (#377) — the issue they belong to
    // does not exist yet, so there is nothing stored to read them from.
    const blockMessage = await enforceCandidateCatalogDuplicates(
      session.user.id,
      collectionId,
      { areaId, prefixes: prefixContext(catalogPrefixes) },
      autoCreateCandidates(autoCreateStamps)
    );
    if (blockMessage) return { status: "error", message: blockMessage };
  }

  try {
    const result = await createIssue(session.user.id, collectionId, areaId, {
      name,
      year,
      catalogNumbers,
      catalogPrefixes,
      translations: parseTranslationValues(formData, ISSUE_TRANSLATION_FIELDS),
      autoCreateStamps,
    });
    return { status: "success", issueId: result.id };
  } catch {
    return { status: "error", message: "Failed to create issue. Please try again." };
  }
}

export async function updateIssueAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || null;
  const yearRaw = ((formData.get("year") as string | null) ?? "").trim();
  const year = yearRaw ? parseInt(yearRaw, 10) : null;
  if (yearRaw && (isNaN(year!) || year! < 1840 || year! > 2100)) {
    return { status: "error", message: "Year must be a valid year (1840–2100)." };
  }
  const catalogNumbers = parseCatalogNumbers(formData);
  try {
    await updateIssue(session.user.id, collectionId, issueId, {
      name,
      year,
      catalogNumbers,
      catalogPrefixes: parseCatalogPrefixes(formData),
      translations: parseTranslationValues(formData, ISSUE_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update issue. Please try again." };
  }
}

export async function deleteIssueAction(
  collectionId: string,
  issueId: string
): Promise<IssueActionState> {
  const session = await getSession();
  try {
    await deleteIssue(session.user.id, collectionId, issueId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete issue. Please try again." };
  }
}

export async function previewIssueDeletionAction(
  collectionId: string,
  issueId: string
): Promise<IssueDeletionPreview | { error: string }> {
  const session = await getSession();
  try {
    return await previewIssueDeletion(session.user.id, collectionId, issueId);
  } catch {
    return { error: "Failed to check issue stamps." };
  }
}

export async function addStampToIssueAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || null;

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

  const parentStampId = (formData.get("parentStampId") as string | null) || null;
  // Which of the issue's checklists the new stamp joins (#531). The `default` sentinel means the
  // issue's own set, created from its name when it has none — what the old *Required for
  // completeness* box did on an issue being started from scratch.
  const checklistIds = ((formData.get("checklistIds") as string | null) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const colnectId = ((formData.get("colnectId") as string | null) ?? "").trim() || null;

  // Child subtype classification (ignored server-side for top-level stamps).
  const subtypeId = (formData.get("subtypeId") as string | null) || null;
  const overrideRaw = formData.get("actsAsVariantOverride") as string | null;
  const actsAsVariantOverride =
    overrideRaw === "true" ? true : overrideRaw === "false" ? false : null;

  // Catalogue attributes (#736). A field the form did not render — a dictionary with no entries —
  // is simply not set on the new stamp.
  const attributes = parseStampAttributes(formData);
  // The size (#763) apart from them: a figure this app cannot read is reported, never stored as
  // *no size* — see `parseStampSizeInput`.
  const size = parseStampSizeInput(formData);
  if (size.error) return { status: "error", message: size.error };

  const catalogNumbers: { catalogVendorId: string; number: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("catalogNumber_")) {
      const catalogVendorId = key.slice("catalogNumber_".length);
      const num = (value as string).trim();
      if (num) catalogNumbers.push({ catalogVendorId, number: num });
    }
  }

  // Price cells: `catalogPrice_<editionId>~<conditionId>~<certId>~<formatId>` (an empty segment
  // means "none" for the certificate and "single" for the format). Currency is per-edition.
  const catalogPrices: {
    catalogEditionId: string;
    conditionId: string;
    certificateStatusId: string | null;
    formatId: string | null;
    price: string;
    currency: string;
  }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("catalogPrice_")) continue;
    const [catalogEditionId, conditionId, certRaw, formatRaw] = key
      .slice("catalogPrice_".length)
      .split("~");
    if (!catalogEditionId || !conditionId) continue;
    const price = (value as string).trim();
    if (!price || isNaN(Number(price))) continue;
    const currency = ((formData.get(`catalogCurrency_${catalogEditionId}`) as string | null) ?? "").trim();
    if (!currency) continue;
    catalogPrices.push({
      catalogEditionId,
      conditionId,
      certificateStatusId: certRaw ? certRaw : null,
      formatId: formatRaw ? formatRaw : null,
      price,
      currency,
    });
  }

  // Block-mode duplicate guard (#85): the issue supplies the prefix context — its own overrides
  // when it sets any (#377), else its area's inherited prefixes.
  const blockMessage = await enforceCandidateCatalogDuplicates(
    session.user.id,
    collectionId,
    { areaId: await getIssueAreaId(issueId), issueId },
    catalogNumbers
  );
  if (blockMessage) return { status: "error", message: blockMessage };

  try {
    const { stampId } = await addStampToIssue(session.user.id, collectionId, issueId, {
      name,
      issuedDay,
      issuedMonth,
      issuedYear,
      parentStampId,
      subtypeId,
      actsAsVariantOverride,
      checklistIds,
      colnectId,
      ...attributes,
      ...size.input,
      catalogNumbers,
      catalogPrices: catalogPrices.length > 0 ? catalogPrices : undefined,
      translations: parseTranslationValues(formData, STAMP_TRANSLATION_FIELDS),
    });
    // Direct photo upload in add mode (#137): apply the dialog's staged change-set to the
    // freshly created stamp, mirroring how `createItemAction` attaches copy photos on add.
    const photoChangeSet = parsePhotoChangeSet(formData);
    if (photoChangeSet) {
      await applyStampPhotoChangeSet(session.user.id, stampId, photoChangeSet);
    }
    // The user chose to widen the issue's declared range to cover this stamp
    // (checklist stamps only; see the add-stamp dialog). Recompute
    // and apply every current suggestion now that the new member exists.
    if (formData.get("widenIssueRange") === "true") {
      const suggestions = await getIssueRangeSuggestions(session.user.id, collectionId, issueId);
      for (const s of suggestions) {
        await setIssueCatalogRange(
          session.user.id,
          collectionId,
          issueId,
          s.catalogVendorId,
          s.proposedFirst,
          s.proposedLast
        );
      }
    }
    return { status: "success", stampId };
  } catch {
    return { status: "error", message: "Failed to add stamp. Please try again." };
  }
}

export async function removeStampFromIssueAction(
  collectionId: string,
  issueId: string,
  stampId: string
): Promise<IssueActionState> {
  const session = await getSession();
  try {
    await removeStampFromIssue(session.user.id, collectionId, issueId, stampId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to remove stamp. Please try again." };
  }
}

/**
 * Put one level of an issue's stamp tree in the order given (#549) — the roots, or one parent's
 * variants. `orderedStampIds` is the **whole** group; a partial one is refused server-side.
 */
export async function reorderIssueStampsAction(
  collectionId: string,
  issueId: string,
  orderedStampIds: string[]
): Promise<IssueActionState> {
  const session = await getSession();
  try {
    await reorderIssueMembers(session.user.id, collectionId, issueId, orderedStampIds);
    return { status: "success", issueId };
  } catch {
    return { status: "error", message: "Failed to reorder the stamps. Please try again." };
  }
}

export async function listIssueReferencedVendorsAction(
  collectionId: string,
  issueId: string
): Promise<IssueReferencedVendor[] | { error: string }> {
  const session = await getSession();
  try {
    return await listIssueReferencedVendors(session.user.id, collectionId, issueId);
  } catch {
    return { error: "Failed to load issue catalog vendors." };
  }
}

export async function moveIssueToAreaAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const targetAreaId = (formData.get("targetAreaId") as string | null) ?? "";
  if (!targetAreaId) {
    return { status: "error", message: "Please select a target area." };
  }
  try {
    await moveIssueToArea(session.user.id, collectionId, issueId, targetAreaId);
    return { status: "success", issueId };
  } catch {
    return { status: "error", message: "Failed to move issue. Please try again." };
  }
}

export async function moveStampNodeAction(
  collectionId: string,
  issueId: string,
  stampId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const targetIssueId = (formData.get("targetIssueId") as string | null) ?? "";
  if (!targetIssueId) {
    return { status: "error", message: "Please select a target issue." };
  }
  try {
    await moveStampNode(session.user.id, collectionId, issueId, stampId, targetIssueId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to move stamp. Please try again." };
  }
}

/**
 * Reassign a stamp to a different parent within its issue (#656).
 *
 * An empty `parentStampId` is the top level, and is a real answer rather than a missing one — which
 * is why this action does not refuse a blank the way {@link moveStampNodeAction} refuses a target
 * issue: "under no stamp at all" is exactly what the collector picks to undo a misfiling.
 */
export async function reparentStampNodeAction(
  collectionId: string,
  issueId: string,
  stampId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const parentStampId = ((formData.get("parentStampId") as string | null) ?? "").trim() || null;
  try {
    await reparentStampNode(session.user.id, collectionId, issueId, stampId, parentStampId);
    return { status: "success" };
  } catch (e) {
    // The refusals here name the thing the collector picked — a stamp under its own variant, a
    // parent from another issue — so they are worth saying rather than flattening into "try again".
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to reassign the stamp. Please try again.",
    };
  }
}

/** Bulk-add a catalog-number range of stamps to an existing issue (#219). */
export async function addStampRangeToIssueAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const parsedSpecs = parseCatalogNumberSpecs(formData);
  if ("error" in parsedSpecs) return { status: "error", message: parsedSpecs.error };
  const built = buildAutoCreateStamps(formData, parsedSpecs.specs);
  if ("error" in built) return { status: "error", message: built.error };

  // Block-mode duplicate guard (#85): the generated numbers become real stamps, so reject
  // up front when any collides and the collection blocks duplicates. The issue supplies the prefix
  // context — its own overrides when it sets any (#377), else its area's inherited prefixes.
  const areaId = await getIssueAreaId(issueId);
  const blockMessage = await enforceCandidateCatalogDuplicates(
    session.user.id,
    collectionId,
    { areaId, issueId },
    autoCreateCandidates(built.input)
  );
  if (blockMessage) return { status: "error", message: blockMessage };

  try {
    await addStampRangeToIssue(session.user.id, collectionId, issueId, built.input);
    return { status: "success", issueId };
  } catch {
    return { status: "error", message: "Failed to add stamps. Please try again." };
  }
}

/**
 * Bulk-add a range of variants under one base stamp (#722).
 *
 * The spec is parsed **here** against the base stamp's own number in the chosen catalogue rather
 * than trusting the numbers the dialog previewed: the client typed `a-f`, and what `a-f` means is a
 * fact about a stored stamp.
 */
export async function addVariantRangeAction(
  collectionId: string,
  issueId: string,
  parentStampId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const catalogVendorId = ((formData.get("catalogVendorId") as string | null) ?? "").trim();
  if (!catalogVendorId) return { status: "error", message: "Select a catalog." };
  const raw = ((formData.get("variantNumbers") as string | null) ?? "").trim();
  const subtypeId = ((formData.get("subtypeId") as string | null) ?? "").trim() || null;

  const baseNumber = await getStampCatalogNumber(
    session.user.id,
    collectionId,
    parentStampId,
    catalogVendorId
  );
  const parsed = parseVariantNumberSpec(raw, baseNumber ?? "");
  if ("error" in parsed) return { status: "error", message: parsed.error };
  if (parsed.numbers.length > AUTO_CREATE_MAX_STAMPS) {
    return { status: "error", message: `Range cannot exceed ${AUTO_CREATE_MAX_STAMPS} stamps.` };
  }

  // Block-mode duplicate guard (#85), with the issue supplying the prefix context (#377) — the
  // same check the issue's own range dialog runs, over numbers that are about to become stamps.
  const areaId = await getIssueAreaId(issueId);
  const blockMessage = await enforceCandidateCatalogDuplicates(
    session.user.id,
    collectionId,
    { areaId, issueId },
    parsed.numbers.map((number) => ({ catalogVendorId, number }))
  );
  if (blockMessage) return { status: "error", message: blockMessage };

  try {
    await addVariantRangeToStamp(session.user.id, collectionId, issueId, parentStampId, {
      catalogVendorId,
      numbers: parsed.numbers,
      subtypeId,
    });
    return { status: "success", issueId };
  } catch (e) {
    // The refusals name what the collector picked — a base stamp filed on another issue, a subtype
    // from another collection — so they are worth saying rather than flattening into "try again".
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to add variants. Please try again.",
    };
  }
}

/** Summarize a prospective issue merge — stamp count + catalog-number conflicts (#218). */
export async function previewIssueMergeAction(
  collectionId: string,
  sourceIssueId: string,
  targetIssueId: string
): Promise<IssueMergePreview | { error: string }> {
  const session = await getSession();
  try {
    return await previewIssueMerge(session.user.id, collectionId, sourceIssueId, targetIssueId);
  } catch {
    return { error: "Failed to prepare the merge. Please try again." };
  }
}

/** Merge one issue into another: reassign its stamps, then delete it (#218). */
export async function mergeIssuesAction(
  collectionId: string,
  sourceIssueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const targetIssueId = (formData.get("targetIssueId") as string | null) ?? "";
  if (!targetIssueId) {
    return { status: "error", message: "Please select a target issue." };
  }
  try {
    await mergeIssues(session.user.id, collectionId, sourceIssueId, targetIssueId);
    return { status: "success", issueId: targetIssueId };
  } catch {
    return { status: "error", message: "Failed to merge issues. Please try again." };
  }
}
