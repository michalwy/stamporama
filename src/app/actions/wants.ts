"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createWant,
  updateWant,
  narrowWant,
  closeWant,
  reopenWant,
  deleteWant,
  findWantsSatisfiedBy,
  createWantsForMissing,
  isWantPriority,
  type ArrivingCopy,
  type WantAcceptanceInput,
  type WantCreateInput,
  type WantInput,
  type WantMatchForCopy,
} from "@/lib/wants";

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

/** What the generator did, so the completeness card can say it in words (ADR-0032 §6). */
export type AddMissingWantsState =
  | { status: "success"; created: number; missing: number }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
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

/** "Add missing to want list" from a checklist's completeness card (ADR-0032 §6). */
export async function addMissingToWantListAction(
  collectionId: string,
  checklistId: string
): Promise<AddMissingWantsState> {
  const session = await getSession();
  try {
    const result = await createWantsForMissing(session.user.id, collectionId, checklistId);
    return { status: "success", ...result };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to add the missing stamps.",
    };
  }
}
