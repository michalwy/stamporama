"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createFormatFactor,
  updateFormatFactor,
  deleteFormatFactor,
  getCollectionFormatFactors,
  getFormatFactorsForScope,
  DuplicateFormatFactorError,
  type FormatFactorScope,
  type FormatFactorData,
  type FormatFactorInput,
} from "@/lib/format-factors";

export type FormatFactorActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** Settings' list: the collection default and area anchors only — see `getCollectionFormatFactors`
 *  for why issue-anchored rows are deliberately not here. */
export async function getFormatFactorsAction(
  collectionId: string
): Promise<FormatFactorData[]> {
  const session = await getSession();
  return getCollectionFormatFactors(session.user.id, collectionId);
}

/** The multipliers set directly on one area or issue, for the scoped dialog opened from its row. */
export async function getFormatFactorsForScopeAction(
  collectionId: string,
  scope: FormatFactorScope
): Promise<FormatFactorData[]> {
  const session = await getSession();
  return getFormatFactorsForScope(session.user.id, collectionId, scope);
}

/** Reads the form. A blank anchor is "any" and stored as null; the factor must be a positive
 *  number — a zero or negative multiplier has no meaning against a catalog price. */
function parseInput(formData: FormData): FormatFactorInput | { error: string } {
  const formatId = ((formData.get("formatId") as string | null) ?? "").trim();
  if (!formatId) return { error: "Format is required." };

  const raw = ((formData.get("factor") as string | null) ?? "").trim().replace(",", ".");
  const factor = Number(raw);
  if (!raw || !Number.isFinite(factor) || factor <= 0) {
    return { error: "Multiplier must be a positive number." };
  }

  const optional = (key: string): string | null => {
    const v = ((formData.get(key) as string | null) ?? "").trim();
    return v === "" ? null : v;
  };

  return {
    formatId,
    factor,
    collectionAreaId: optional("collectionAreaId"),
    issueId: optional("issueId"),
    conditionId: optional("conditionId"),
  };
}

export async function createFormatFactorAction(
  collectionId: string,
  formData: FormData
): Promise<FormatFactorActionState> {
  const session = await getSession();
  const parsed = parseInput(formData);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  try {
    await createFormatFactor(session.user.id, collectionId, parsed);
    return { status: "success" };
  } catch (err) {
    if (err instanceof DuplicateFormatFactorError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to create multiplier. Please try again." };
  }
}

export async function updateFormatFactorAction(
  factorId: string,
  formData: FormData
): Promise<FormatFactorActionState> {
  const session = await getSession();
  const parsed = parseInput(formData);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  try {
    await updateFormatFactor(session.user.id, factorId, parsed);
    return { status: "success" };
  } catch (err) {
    if (err instanceof DuplicateFormatFactorError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to update multiplier. Please try again." };
  }
}

export async function deleteFormatFactorAction(
  factorId: string
): Promise<FormatFactorActionState> {
  const session = await getSession();
  try {
    await deleteFormatFactor(session.user.id, factorId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete multiplier. Please try again." };
  }
}
