"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createWant,
  updateWant,
  narrowWant,
  closeWant,
  reopenWant,
  deleteWant,
  findWantsSatisfiedBy,
  createWantsForIssue,
  previewIssueMissingWants,
  isWantPriority,
  type IssueWantGapChecklist,
  type ArrivingCopy,
  type WantAcceptanceInput,
  type WantCreateInput,
  type WantInput,
  type WantMatchForCopy,
  type WantPriority,
} from "@/lib/wants";
import { isWantDepth, type WantDepth } from "@/lib/want-depth-rules";

// Server actions for the want list (#532; ADR-0032).
//
// The acceptance sets cross as **arrays that may contain `null`**, not as comma-joined strings the
// way a copy form's hidden fields do: `null` is a member here — "no certificate", "single" — and a
// separated string cannot carry an empty-vs-null distinction without inventing a sentinel.

export type WantActionState =
  | { status: "idle" }
  /** `created`/`skipped` are set by the create path alone, where a **whole set** may add several
   *  wants at once and pass over the stamps already on the list. */
  | { status: "success"; created?: number; skipped?: number }
  | { status: "error"; message: string };

/** What the generator did, so the dialog can say it in words (ADR-0032 §6). */
export type AddMissingWantsState =
  | { status: "success"; created: number; missing: number }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Normalize the form's fields, leaving the acceptance sets exactly as sent. */
function toWantInput(input: WantInput): WantInput {
  return {
    ...input,
    priority: isWantPriority(input.priority) ? input.priority : "normal",
  };
}

/** Add one want, or one per stamp of a checklist. `created`/`skipped` ride on the success so the
 *  panel can say what a whole-set add actually did (#532). */
export async function createWantAction(
  collectionId: string,
  input: WantCreateInput
): Promise<WantActionState> {
  const session = await getSession();
  try {
    const result = await createWant(session.user.id, collectionId, {
      ...input,
      priority: isWantPriority(input.priority) ? input.priority : "normal",
    });
    return { status: "success", ...result };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to add the want. Please try again.",
    };
  }
}

export async function updateWantAction(
  wantId: string,
  input: WantInput
): Promise<WantActionState> {
  const session = await getSession();
  try {
    await updateWant(session.user.id, wantId, toWantInput(input));
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to save the want. Please try again.",
    };
  }
}

/** The intake review's middle choice: refine the acceptance, touch nothing else. */
export async function narrowWantAction(
  wantId: string,
  acceptance: WantAcceptanceInput
): Promise<WantActionState> {
  const session = await getSession();
  try {
    await narrowWant(session.user.id, wantId, acceptance);
    return { status: "success" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to narrow the want. Please try again.",
    };
  }
}

export async function closeWantAction(wantId: string): Promise<WantActionState> {
  const session = await getSession();
  try {
    await closeWant(session.user.id, wantId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to close the want. Please try again." };
  }
}

export async function reopenWantAction(wantId: string): Promise<WantActionState> {
  const session = await getSession();
  try {
    await reopenWant(session.user.id, wantId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reopen the want. Please try again." };
  }
}

export async function deleteWantAction(wantId: string): Promise<WantActionState> {
  const session = await getSession();
  try {
    await deleteWant(session.user.id, wantId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the want. Please try again." };
  }
}

/** The open wants these freshly taken-in copies could satisfy — a read, so the collector decides. */
export async function findWantsSatisfiedByAction(
  collectionId: string,
  copies: ArrivingCopy[]
): Promise<WantMatchForCopy[]> {
  const session = await getSession();
  return findWantsSatisfiedBy(session.user.id, collectionId, copies);
}

/** What an issue's checklists are each missing **on the stated terms and at the stated depth**, for
 *  the bulk-add confirmation (#548, #1240). Both halves of the gap move with either, so the preview
 *  is re-read whenever they change rather than filtered in the browser. */
export async function previewIssueMissingWantsAction(
  collectionId: string,
  issueId: string,
  acceptance: WantAcceptanceInput,
  depth: WantDepth
): Promise<IssueWantGapChecklist[]> {
  const session = await getSession();
  return previewIssueMissingWants(
    session.user.id,
    collectionId,
    issueId,
    acceptance,
    isWantDepth(depth) ? depth : "main"
  );
}

/** "Add missing to want list" for a whole issue (#548) — the checklists the collector ticked, on
 *  the terms and at the priority they chose (#695), at the depth they chose (#1240). An unknown
 *  priority falls back to `normal`, the way the want form's own does, and an unknown depth to
 *  `main`, the dialog's own cold start, rather than failing the run over a word. */
export async function addIssueMissingToWantListAction(
  collectionId: string,
  issueId: string,
  checklistIds: string[],
  acceptance: WantAcceptanceInput,
  priority: WantPriority,
  depth: WantDepth
): Promise<AddMissingWantsState> {
  const session = await getSession();
  try {
    const result = await createWantsForIssue(
      session.user.id,
      collectionId,
      issueId,
      checklistIds,
      acceptance,
      isWantPriority(priority) ? priority : "normal",
      isWantDepth(depth) ? depth : "main"
    );
    return { status: "success", ...result };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to add the missing stamps.",
    };
  }
}
