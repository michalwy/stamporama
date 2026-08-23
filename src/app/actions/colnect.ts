"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getColnectListMappings,
  setColnectListMapping,
  ColnectListMappingValueError,
  type ColnectListMappingData,
} from "@/lib/colnect-list-sync";
import type {
  ColnectListSource,
  ColnectListSourceOfTruth,
} from "@/lib/colnect-list-sync-rules";
import {
  createColnectMapping,
  updateColnectMapping,
  deleteColnectMapping,
  getColnectMappings,
  getColnectConditionMappings,
  setColnectConditionMapping,
  getColnectPlatform,
  listPlatformContacts,
  setColnectPlatform,
  ColnectAbbrevTakenError,
  ColnectConditionValueError,
  type ColnectMappingData,
  type ColnectConditionMappingData,
} from "@/lib/colnect";

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

/** Every condition with the Colnect grade it maps to (#404), for the Settings panel. */
export async function getColnectConditionMappingsAction(
  collectionId: string
): Promise<ColnectConditionMappingData[]> {
  const session = await getSession();
  return getColnectConditionMappings(session.user.id, collectionId);
}

/**
 * Map one condition to a Colnect grade, or unmap it with an empty value (#404). One condition at a
 * time, because the panel's control *is* one select per row — there is no draft to save.
 */
export async function setColnectConditionMappingAction(
  stampConditionId: string,
  colnectValue: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectConditionMapping(session.user.id, stampConditionId, colnectValue || null);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectConditionValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save the condition mapping. Please try again." };
  }
}

/** The platform contact marked as Colnect (#406), and every platform that could be — the picker
 *  reads both at once, since a picker showing only the current answer cannot change it. */
export async function getColnectPlatformAction(collectionId: string): Promise<{
  selectedId: string | null;
  platforms: { id: string; name: string }[];
}> {
  const session = await getSession();
  const [selected, platforms] = await Promise.all([
    getColnectPlatform(session.user.id, collectionId),
    listPlatformContacts(session.user.id, collectionId),
  ]);
  return { selectedId: selected?.id ?? null, platforms };
}

/**
 * Point the Colnect settings at one platform contact, or clear it with an empty id (#406). One
 * write per change, like the condition mapping beside it: the select *is* the control. Exclusive —
 * the domain layer clears whoever held it, so this can never leave two.
 */
export async function setColnectPlatformAction(
  collectionId: string,
  contactId: string
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to save the Colnect platform. Please try again." };
  }
}

/** Every standard Colnect list with what it mirrors (#684), for the Settings panel — all four,
 *  configured or not, since the set is fixed and the screen lists it whole. */
export async function getColnectListMappingsAction(
  collectionId: string
): Promise<ColnectListMappingData[]> {
  const session = await getSession();
  return getColnectListMappings(session.user.id, collectionId);
}

/**
 * Configure one Colnect list (#684). One list and one field at a time, the condition mapping's
 * idiom beside it: each control on the panel *is* the write, so there is no draft to lose and no
 * way for a change to one field to carry a stale opinion about another.
 */
export async function setColnectListMappingAction(
  collectionId: string,
  lt: number,
  patch: {
    source?: ColnectListSource;
    sourceOfTruth?: ColnectListSourceOfTruth;
    enabled?: boolean;
  }
): Promise<ColnectActionState> {
  const session = await getSession();
  try {
    await setColnectListMapping(session.user.id, collectionId, lt, patch);
    return { status: "success" };
  } catch (err) {
    if (err instanceof ColnectListMappingValueError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save the list setting. Please try again." };
  }
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
