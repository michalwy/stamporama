"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createChecklist,
  renameChecklist,
  deleteChecklist,
  reorderChecklists,
  reorderChecklistStamps,
  setChecklistStamps,
  getChecklistsForIssue,
  getRunChecklist,
  listSpanningChecklists,
  type ChecklistData,
  type SpanningChecklistSummary,
} from "@/lib/checklists";
import type { RunChecklist } from "@/lib/issue-run";
import type { TranslationValueMap } from "@/lib/translations";

// Server actions for the checklists editor (#531). Scoped to one issue, because that is the only
// place a checklist is edited from — ADR-0020 §7's rule, and the reason none of these take an
// anchor the calling screen has already answered.

export type ChecklistActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** The checklists anchored to one issue, with their stamps — what the editor dialog reads. */
export async function getChecklistsForIssueAction(
  collectionId: string,
  issueId: string
): Promise<ChecklistData[]> {
  const session = await getSession();
  return getChecklistsForIssue(session.user.id, collectionId, issueId);
}

/** One checklist as a run of scan tiles reads it (#1225) — its stamps in its own order and the
 *  issues it covers. Null when it is gone. */
export async function getRunChecklistAction(
  collectionId: string,
  checklistId: string
): Promise<RunChecklist | null> {
  const session = await getSession();
  return getRunChecklist(session.user.id, collectionId, checklistId);
}

/** The collection's checklists that span issues — what the run picker offers beside an issue's own
 *  (#1225). */
export async function listSpanningChecklistsAction(
  collectionId: string
): Promise<SpanningChecklistSummary[]> {
  const session = await getSession();
  return listSpanningChecklists(session.user.id, collectionId);
}

export async function createChecklistAction(
  collectionId: string,
  issueId: string,
  name: string,
  translations?: TranslationValueMap
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await createChecklist(session.user.id, collectionId, { issueId, name, translations });
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to create checklist. Please try again.",
    };
  }
}

export async function renameChecklistAction(
  checklistId: string,
  name: string,
  translations?: TranslationValueMap
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await renameChecklist(session.user.id, checklistId, name, translations);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to rename checklist. Please try again.",
    };
  }
}

export async function deleteChecklistAction(
  checklistId: string
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await deleteChecklist(session.user.id, checklistId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete checklist. Please try again." };
  }
}

export async function reorderChecklistsAction(
  collectionId: string,
  issueId: string,
  checklistIds: string[]
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await reorderChecklists(session.user.id, collectionId, issueId, checklistIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder checklists. Please try again." };
  }
}

/** Replace a checklist's stamps with exactly this set — the editor submits the ticked boxes of the
 *  whole tree, so a diff computed server-side could not match what was on screen. */
export async function setChecklistStampsAction(
  checklistId: string,
  stampIds: string[]
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await setChecklistStamps(session.user.id, checklistId, stampIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the checklist. Please try again." };
  }
}

/** Put a checklist's stamps in the order the set reads (#764) — the collection-wide answer an
 *  album page then prints as a row of boxes. Sent whole, like every other reorder here. */
export async function reorderChecklistStampsAction(
  checklistId: string,
  stampIds: string[]
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await reorderChecklistStamps(session.user.id, checklistId, stampIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the stamps. Please try again." };
  }
}
