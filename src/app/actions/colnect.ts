"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createColnectMapping,
  updateColnectMapping,
  deleteColnectMapping,
  getColnectMappings,
  ColnectAbbrevTakenError,
  type ColnectMappingData,
} from "@/lib/colnect";
import { createAssistantToken, revokeAssistantToken } from "@/lib/api-tokens";

export type ColnectActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getColnectMappingsAction(
  collectionId: string
): Promise<ColnectMappingData[]> {
  const session = await getSession();
  return getColnectMappings(session.user.id, collectionId);
}

function parseFields(formData: FormData): { colnectAbbrev: string; catalogVendorId: string } {
  return {
    colnectAbbrev: ((formData.get("colnectAbbrev") as string | null) ?? "").trim(),
    catalogVendorId: ((formData.get("catalogVendorId") as string | null) ?? "").trim(),
  };
}

export async function createColnectMappingAction(
  collectionId: string,
  formData: FormData
): Promise<ColnectActionState> {
  const session = await getSession();
  const { colnectAbbrev, catalogVendorId } = parseFields(formData);
  if (!colnectAbbrev) return { status: "error", message: "Colnect abbreviation is required." };
  if (!catalogVendorId) return { status: "error", message: "Pick a local catalog to map to." };
  try {
    await createColnectMapping(session.user.id, collectionId, { colnectAbbrev, catalogVendorId });
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectAbbrevTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to create mapping. Please try again." };
  }
}

export async function updateColnectMappingAction(
  mappingId: string,
  formData: FormData
): Promise<ColnectActionState> {
  const session = await getSession();
  const { colnectAbbrev, catalogVendorId } = parseFields(formData);
  if (!colnectAbbrev) return { status: "error", message: "Colnect abbreviation is required." };
  if (!catalogVendorId) return { status: "error", message: "Pick a local catalog to map to." };
  try {
    await updateColnectMapping(session.user.id, mappingId, { colnectAbbrev, catalogVendorId });
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectAbbrevTakenError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to update mapping. Please try again." };
  }
}

export async function deleteColnectMappingAction(
  mappingId: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await deleteColnectMapping(session.user.id, mappingId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete mapping. Please try again." };
  }
}

// ── Assistant tokens (#253) ──────────────────────────────────────────────────
// Minimal generator behind the browser extension's bearer auth. The full registration/code-exchange
// UX is #252; here the owner mints a token and copies it once into the extension's options.

export type AssistantTokenCreateState =
  | { status: "idle" }
  | { status: "success"; token: string }
  | { status: "error"; message: string };

export async function createAssistantTokenAction(
  collectionId: string,
  formData: FormData
): Promise<AssistantTokenCreateState> {
  const session = await getSession();
  const label = ((formData.get("label") as string | null) ?? "").trim();
  try {
    const { token } = await createAssistantToken(session.user.id, collectionId, label || null);
    return { status: "success", token };
  } catch {
    return { status: "error", message: "Failed to generate token. Please try again." };
  }
}

export async function revokeAssistantTokenAction(
  collectionId: string,
  tokenId: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await revokeAssistantToken(session.user.id, collectionId, tokenId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to revoke token. Please try again." };
  }
}
