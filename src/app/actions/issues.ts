"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createIssue,
  updateIssue,
  deleteIssue,
  addStampToIssue,
  toggleIssueMemberRequired,
  removeStampFromIssue,
  moveStampNode,
} from "@/lib/issues";

export type IssueActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
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
  try {
    await createIssue(session.user.id, collectionId, areaId, { name, year });
    return { status: "success" };
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
  try {
    await updateIssue(session.user.id, collectionId, issueId, { name, year });
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

export async function addStampToIssueAction(
  collectionId: string,
  issueId: string,
  formData: FormData
): Promise<IssueActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim() || null;
  const yearRaw = ((formData.get("issuedYear") as string | null) ?? "").trim();
  const issuedYear = yearRaw ? parseInt(yearRaw, 10) : null;
  if (yearRaw && (isNaN(issuedYear!) || issuedYear! < 1840 || issuedYear! > 2100)) {
    return { status: "error", message: "Issued year must be a valid year (1840–2100)." };
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
