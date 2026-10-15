"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  cancelReplacement,
  keepAllDuplicates,
  keepDuplicate,
  listDuplicateReview,
  unkeepAllDuplicates,
  listCopyReplacements,
  listReplacementCandidates,
  listReplaceableCopies,
  listReplacements,
  recordReplacement,
  settleReplacements,
  type DuplicateReviewFilters,
  type DuplicateReviewPage,
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

export async function listReplaceableCopiesAction(
  collectionId: string,
  stampId: string,
  excludeItemId: string | null
): Promise<ReplacementCandidateData[]> {
  const session = await getSession();
  return listReplaceableCopies(session.user.id, collectionId, stampId, excludeItemId);
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

// ── Duplicate review (#1938) ─────────────────────────────────────────────────

export async function listDuplicateReviewAction(
  collectionId: string,
  filters: DuplicateReviewFilters,
  offset: number
): Promise<DuplicateReviewPage> {
  const session = await getSession();
  return listDuplicateReview(session.user.id, collectionId, filters, { offset });
}

export async function keepDuplicateAction(
  collectionId: string,
  input: { keeperId: string; otherIds: string[] }
): Promise<{ status: "success"; recorded: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const { recorded } = await keepDuplicate(session.user.id, collectionId, input);
    return { status: "success", recorded };
  } catch (e) {
    return failure(e, "The replacements could not be recorded.");
  }
}

export async function keepAllDuplicatesAction(
  collectionId: string,
  itemIds: string[]
): Promise<{ status: "success"; marked: string[] } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const { marked } = await keepAllDuplicates(session.user.id, collectionId, itemIds);
    return { status: "success", marked };
  } catch (e) {
    return failure(e, "The copies could not be kept.");
  }
}

export async function unkeepAllDuplicatesAction(
  collectionId: string,
  itemIds: string[]
): Promise<ReplacementActionState> {
  const session = await getSession();
  try {
    await unkeepAllDuplicates(session.user.id, collectionId, itemIds);
    return { status: "success" };
  } catch (e) {
    return failure(e, "The copies could not be brought back.");
  }
}
