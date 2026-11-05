"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createStampIssueFormat,
  updateStampIssueFormat,
  deleteStampIssueFormat,
  reorderStampIssueFormats,
  getStampIssueFormats,
  setStampIssueFormatColnectValue,
  IssueFormatColnectValueError,
  IssueFormatInUseError,
  type StampIssueFormatData,
  type StampIssueFormatInput,
} from "@/lib/stamp-issue-formats";
import { ISSUE_FORMAT_TRANSLATION_FIELDS } from "@/lib/stamp-issue-format-defaults";
import { parseTranslationValues } from "@/lib/translations";
import { isTagColor } from "@/lib/tag-colors";

export type StampIssueFormatActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** The collection's issue formats (#2439), with how many stamps carry each. */
export async function getStampIssueFormatsAction(
  collectionId: string
): Promise<StampIssueFormatData[]> {
  const session = await getSession();
  return getStampIssueFormats(session.user.id, collectionId);
}

function parseFields(formData: FormData): StampIssueFormatInput {
  const color = (formData.get("color") as string | null) ?? "";
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    abbreviation: ((formData.get("abbreviation") as string | null) ?? "").trim(),
    color: isTagColor(color) ? color : null,
    translations: parseTranslationValues(formData, ISSUE_FORMAT_TRANSLATION_FIELDS),
  };
}

function missingField(fields: StampIssueFormatInput): StampIssueFormatActionState | null {
  if (!fields.name) return { status: "error", message: "Name is required." };
  if (!fields.abbreviation) return { status: "error", message: "Abbreviation is required." };
  return null;
}

export async function createStampIssueFormatAction(
  collectionId: string,
  formData: FormData
): Promise<StampIssueFormatActionState> {
  const session = await getSession();
  const fields = parseFields(formData);
  const missing = missingField(fields);
  if (missing) return missing;
  try {
    await createStampIssueFormat(session.user.id, collectionId, fields);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create issue format. Please try again." };
  }
}

export async function updateStampIssueFormatAction(
  issueFormatId: string,
  formData: FormData
): Promise<StampIssueFormatActionState> {
  const session = await getSession();
  const fields = parseFields(formData);
  const missing = missingField(fields);
  if (missing) return missing;
  try {
    await updateStampIssueFormat(session.user.id, issueFormatId, fields);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update issue format. Please try again." };
  }
}

export async function deleteStampIssueFormatAction(
  issueFormatId: string
): Promise<StampIssueFormatActionState> {
  const session = await getSession();
  try {
    await deleteStampIssueFormat(session.user.id, issueFormatId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof IssueFormatInUseError) {
      const n = err.stampCount;
      return {
        status: "error",
        message: `This issue format is set on ${n} stamp${n === 1 ? "" : "s"} and cannot be deleted.`,
      };
    }
    return { status: "error", message: "Failed to delete issue format. Please try again." };
  }
}

export async function reorderStampIssueFormatsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<StampIssueFormatActionState> {
  const session = await getSession();
  try {
    await reorderStampIssueFormats(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder issue formats. Please try again." };
  }
}

/**
 * Say what Colnect prints in "Format" for one issue format (#2443) — the Settings → Colnect →
 * Attributes field, one write per change as the attribute dictionaries' own. A refused word (a
 * clash, or Colnect's "Stamp") is reported in its own words.
 */
export async function setStampIssueFormatColnectValueAction(
  issueFormatId: string,
  colnectValue: string
): Promise<StampIssueFormatActionState> {
  const session = await getSession();
  try {
    await setStampIssueFormatColnectValue(session.user.id, issueFormatId, colnectValue);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof IssueFormatColnectValueError
          ? err.message
          : "Failed to map that issue format. Please try again.",
    };
  }
}
