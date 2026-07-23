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
  toggleIssueMemberRequired,
  removeStampFromIssue,
  moveStampNode,
  moveIssueToArea,
  mergeIssues,
  previewIssueMerge,
  listIssueReferencedVendors,
  getIssuePriceDetails,
  getIssueAreaId,
  getIssueRangeSuggestions,
  setIssueCatalogRange,
} from "@/lib/issues";
import type {
  AutoCreateStampsInput,
  IssueDeletionPreview,
  IssueMergePreview,
  IssuePriceDetails,
  IssueReferencedVendor,
  IssueRangeSuggestion,
} from "@/lib/issues";
import { applyStampPhotoChangeSet, parsePhotoChangeSet } from "@/lib/photos";
import {
  resolveCatalogRange,
  generateCatalogNumbers,
  type CatalogRangeScheme,
} from "@/lib/catalog-number";
import { enforceCandidateCatalogDuplicates } from "@/lib/duplicate-catalog";

export async function getIssuePriceDetailsAction(
  collectionId: string,
  issueId: string
): Promise<IssuePriceDetails> {
  const session = await getSession();
  return getIssuePriceDetails(session.user.id, collectionId, issueId);
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

/** Resolve the `autoCreateVendor_*` selection plus each vendor's First/Last range into a
 *  generated {@link AutoCreateStampsInput}, or an error message. Shared by issue creation
 *  (#70) and post-creation add-range (#219): each selected vendor generates catalog numbers
 *  from its own range (numeric, prefixed, or suffix-sequence); stamps are matched across
 *  vendors by position, so every explicit range must span the same number of stamps. */
function buildAutoCreateStamps(
  formData: FormData,
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[]
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

  const resolved: { catalogVendorId: string; scheme: CatalogRangeScheme }[] = [];
  let count: number | null = null;
  for (const vendorId of vendorIds) {
    const cn = catalogNumbers.find((c) => c.catalogVendorId === vendorId);
    if (!cn || !cn.firstNumber) {
      return { error: "Enter a First catalog number for each selected vendor." };
    }
    const range = resolveCatalogRange(cn.firstNumber, cn.lastNumber ?? null);
    if ("error" in range) {
      return { error: range.error };
    }
    resolved.push({ catalogVendorId: vendorId, scheme: range.scheme });
    if (range.span !== null) {
      if (count === null) {
        count = range.span;
      } else if (count !== range.span) {
        return { error: "Selected vendors must span the same number of stamps." };
      }
    }
  }
  if (count === null) count = 1;
  if (count > 50) {
    return { error: "Range cannot exceed 50 stamps." };
  }
  const vendors = resolved.map((r) => ({
    catalogVendorId: r.catalogVendorId,
    numbers: generateCatalogNumbers(r.scheme, count!),
  }));
  return { input: { count, vendors } };
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
  const catalogNumbers = parseCatalogNumbers(formData);

  let autoCreateStamps: AutoCreateStampsInput | undefined;
  if (formData.get("autoCreateStamps") === "true") {
    const built = buildAutoCreateStamps(formData, catalogNumbers);
    if ("error" in built) return { status: "error", message: built.error };
    autoCreateStamps = built.input;

    // Block-mode duplicate guard (#85): the generated numbers become real stamps,
    // so reject up front when any collides and the collection blocks duplicates.
    const blockMessage = await enforceCandidateCatalogDuplicates(
      session.user.id,
      collectionId,
      areaId,
      autoCreateCandidates(autoCreateStamps)
    );
    if (blockMessage) return { status: "error", message: blockMessage };
  }

  try {
    const result = await createIssue(session.user.id, collectionId, areaId, { name, year, catalogNumbers, autoCreateStamps });
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
    await updateIssue(session.user.id, collectionId, issueId, { name, year, catalogNumbers });
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
  const requiredForCompleteness = formData.get("requiredForCompleteness") === "true";

  // Child subtype classification (ignored server-side for top-level stamps).
  const subtypeId = (formData.get("subtypeId") as string | null) || null;
  const overrideRaw = formData.get("actsAsVariantOverride") as string | null;
  const actsAsVariantOverride =
    overrideRaw === "true" ? true : overrideRaw === "false" ? false : null;

  const catalogNumbers: { catalogVendorId: string; number: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("catalogNumber_")) {
      const catalogVendorId = key.slice("catalogNumber_".length);
      const num = (value as string).trim();
      if (num) catalogNumbers.push({ catalogVendorId, number: num });
    }
  }

  // Price cells: `catalogPrice_<editionId>~<conditionId>~<certId>` (empty cert
  // segment = no certificate status). Currency is per-edition.
  const catalogPrices: {
    catalogEditionId: string;
    conditionId: string;
    certificateStatusId: string | null;
    price: string;
    currency: string;
  }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("catalogPrice_")) continue;
    const [catalogEditionId, conditionId, certRaw] = key
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
      price,
      currency,
    });
  }

  // Block-mode duplicate guard (#85): use the issue's area as the prefix context.
  const blockMessage = await enforceCandidateCatalogDuplicates(
    session.user.id,
    collectionId,
    await getIssueAreaId(issueId),
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
      requiredForCompleteness,
      catalogNumbers,
      catalogPrices: catalogPrices.length > 0 ? catalogPrices : undefined,
    });
    // Direct photo upload in add mode (#137): apply the dialog's staged change-set to the
    // freshly created stamp, mirroring how `createItemAction` attaches copy photos on add.
    const photoChangeSet = parsePhotoChangeSet(formData);
    if (photoChangeSet) {
      await applyStampPhotoChangeSet(session.user.id, stampId, photoChangeSet);
    }
    // The user chose to widen the issue's declared range to cover this stamp
    // (required-for-completeness extensions only; see the add-stamp dialog). Recompute
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

export async function toggleIssueMemberRequiredAction(
  collectionId: string,
  issueId: string,
  stampId: string,
  required: boolean
): Promise<IssueActionState> {
  const session = await getSession();
  try {
    await toggleIssueMemberRequired(session.user.id, collectionId, issueId, stampId, required);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update stamp. Please try again." };
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

/** Bulk-add a catalog-number range of stamps to an existing issue (#219). */
export async function addStampRangeToIssueAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const catalogNumbers = parseCatalogNumbers(formData);
  const built = buildAutoCreateStamps(formData, catalogNumbers);
  if ("error" in built) return { status: "error", message: built.error };

  // Block-mode duplicate guard (#85): the generated numbers become real stamps, so reject
  // up front when any collides and the collection blocks duplicates. The issue's own area
  // supplies the prefix context.
  const areaId = await getIssueAreaId(issueId);
  const blockMessage = await enforceCandidateCatalogDuplicates(
    session.user.id,
    collectionId,
    areaId,
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
