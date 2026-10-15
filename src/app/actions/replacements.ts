"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  cancelReplacement,
  listCopyReplacements,
  listReplacementCandidates,
  listReplacements,
  recordReplacement,
  settleReplacements,
  type ReplacementCandidateData,
  type ReplacementPairData,
  type ReplacementsData,
  type SettleResult,
} from "@/lib/replacements";
import type { ReplacementSide } from "@/lib/replacement-rules";

// Server actions for replacement pairs (#1936, ADR-0070). Thin wrappers over `replacements.ts`,
// which holds every rule.

export type ReplacementActionState =
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(e: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

export async function listReplacementsAction(collectionId: string): Promise<ReplacementsData> {
  const session = await getSession();
  return listReplacements(session.user.id, collectionId);
}

export async function listCopyReplacementsAction(
  collectionId: string,
  itemId: string
): Promise<ReplacementPairData[]> {
  const session = await getSession();
  return listCopyReplacements(session.user.id, collectionId, itemId);
}

export async function listReplacementCandidatesAction(
  collectionId: string,
  itemId: string,
  side: ReplacementSide
): Promise<ReplacementCandidateData[]> {
  const session = await getSession();
  return listReplacementCandidates(session.user.id, collectionId, itemId, side);
}

export async function recordReplacementAction(
  collectionId: string,
  input: { newItemId: string; oldItemId: string }
): Promise<ReplacementActionState> {
  const session = await getSession();
  try {
    await recordReplacement(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (e) {
    return failure(e, "The replacement could not be recorded.");
  }
}

export async function cancelReplacementAction(
  collectionId: string,
  pairId: string
): Promise<ReplacementActionState> {
  const session = await getSession();
  try {
    await cancelReplacement(session.user.id, collectionId, pairId);
    return { status: "success" };
  } catch (e) {
    return failure(e, "The replacement could not be cancelled.");
  }
}

export async function settleReplacementsAction(
  collectionId: string,
  pairIds: string[],
  card: { locationId: string; locationRef: string | null }
): Promise<{ status: "success"; result: SettleResult } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const result = await settleReplacements(session.user.id, collectionId, pairIds, card);
    return { status: "success", result };
  } catch (e) {
    return failure(e, "The replacements could not be settled.");
  }
}
