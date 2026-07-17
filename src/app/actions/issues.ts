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
  toggleIssueMemberRequired,
  removeStampFromIssue,
  moveStampNode,
} from "@/lib/issues";
import type { IssueDeletionPreview } from "@/lib/issues";

export type IssueActionState =
  | { status: "idle" }
  | { status: "success"; issueId?: string }
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

  let autoCreateStamps: { rangeFrom: number; rangeTo: number; vendorIds: string[] } | undefined;
  if (formData.get("autoCreateStamps") === "true") {
    const vendorIds: string[] = [];
    for (const key of formData.keys()) {
      if (key.startsWith("autoCreateVendor_")) {
        vendorIds.push(key.slice("autoCreateVendor_".length));
      }
    }
    if (vendorIds.length === 0) {
      return { status: "error", message: "Select at least one catalog vendor for auto-create." };
    }
    const rangeVendor = catalogNumbers.find((cn) => vendorIds.includes(cn.catalogVendorId) && cn.firstNumber);
    if (!rangeVendor) {
      return { status: "error", message: "Enter a First catalog number for at least one selected vendor." };
    }
    const rangeFrom = parseInt(rangeVendor.firstNumber, 10);
    const rangeTo = rangeVendor.lastNumber ? parseInt(rangeVendor.lastNumber, 10) : rangeFrom;
    if (isNaN(rangeFrom) || rangeFrom < 1) {
      return { status: "error", message: "First catalog number must be a positive integer for auto-create." };
    }
    if (isNaN(rangeTo) || rangeTo < 1) {
      return { status: "error", message: "Last catalog number must be a positive integer for auto-create." };
    }
    if (rangeFrom > rangeTo) {
      return { status: "error", message: "First catalog number must be ≤ Last." };
    }
    if (rangeTo - rangeFrom + 1 > 50) {
      return { status: "error", message: "Range cannot exceed 50 stamps." };
    }
    autoCreateStamps = { rangeFrom, rangeTo, vendorIds };
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

  const catalogNumbers: { catalogVendorId: string; number: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("catalogNumber_")) {
      const catalogVendorId = key.slice("catalogNumber_".length);
      const num = (value as string).trim();
      if (num) catalogNumbers.push({ catalogVendorId, number: num });
    }
  }

  try {
    await addStampToIssue(session.user.id, collectionId, issueId, {
      name,
      issuedDay,
      issuedMonth,
      issuedYear,
      parentStampId,
      requiredForCompleteness,
      catalogNumbers,
    });
    return { status: "success" };
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
