"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createChecklist,
  renameChecklist,
  deleteChecklist,
  reorderChecklists,
  reorderChecklistStamps,
  setChecklistStamps,
  getChecklistsForIssue,
  type ChecklistData,
} from "@/lib/checklists";

// Server actions for the checklists editor (#531). Scoped to one issue, because that is the only
// place a checklist is edited from — ADR-0020 §7's rule, and the reason none of these take an
// anchor the calling screen has already answered.

export type ChecklistActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
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

export async function createChecklistAction(
  collectionId: string,
  issueId: string,
  name: string
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await createChecklist(session.user.id, collectionId, { issueId, name });
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
  name: string
): Promise<ChecklistActionState> {
  const session = await getSession();
  try {
    await renameChecklist(session.user.id, checklistId, name);
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
