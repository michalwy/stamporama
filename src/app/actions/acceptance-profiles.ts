"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  listAcceptanceProfiles,
  createAcceptanceProfile,
  updateAcceptanceProfile,
  deleteAcceptanceProfile,
  reorderAcceptanceProfiles,
  AcceptanceProfileNameTakenError,
  type AcceptanceProfileData,
  type AcceptanceProfileInput,
} from "@/lib/acceptance-profiles";

// Server actions for the acceptance-profile dictionary (#533; ADR-0032 §9).
//
// Typed object arguments rather than `FormData`, for the reason `actions/wants.ts` already gives:
// `null` is a **member** of two of the three sets — "no certificate", "single" — and a form field
// cannot carry an empty-vs-null distinction without inventing a sentinel.

export type AcceptanceProfileActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getAcceptanceProfilesAction(
  collectionId: string
): Promise<AcceptanceProfileData[]> {
  const session = await getSession();
  return listAcceptanceProfiles(session.user.id, collectionId);
}

/** A name clash is reported in its own words — "already exists" is an answer, "please try again"
 *  is not. */
function toErrorState(err: unknown, fallback: string): AcceptanceProfileActionState {
  if (err instanceof AcceptanceProfileNameTakenError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

export async function createAcceptanceProfileAction(
  collectionId: string,
  input: AcceptanceProfileInput
): Promise<AcceptanceProfileActionState> {
  const session = await getSession();
  try {
    await createAcceptanceProfile(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to create the profile. Please try again.");
  }
}

export async function updateAcceptanceProfileAction(
  profileId: string,
  input: AcceptanceProfileInput
): Promise<AcceptanceProfileActionState> {
  const session = await getSession();
  try {
    await updateAcceptanceProfile(session.user.id, profileId, input);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the profile. Please try again.");
  }
}

export async function deleteAcceptanceProfileAction(
  profileId: string
): Promise<AcceptanceProfileActionState> {
  const session = await getSession();
  try {
    await deleteAcceptanceProfile(session.user.id, profileId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the profile. Please try again." };
  }
}

export async function reorderAcceptanceProfilesAction(
  collectionId: string,
  orderedIds: string[]
): Promise<AcceptanceProfileActionState> {
  const session = await getSession();
  try {
    await reorderAcceptanceProfiles(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the profiles. Please try again." };
  }
}
