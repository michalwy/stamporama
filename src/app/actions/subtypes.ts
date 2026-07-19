"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStampSubtype,
  updateStampSubtype,
  setSubtypeActsAsVariant,
  setDefaultSubtype,
  deleteStampSubtype,
  reorderStampSubtypes,
  getStampSubtypes,
  SubtypeInUseError,
  SubtypeIsDefaultError,
  type StampSubtypeData,
} from "@/lib/subtypes";

export type SubtypeActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getStampSubtypesAction(
  collectionId: string
): Promise<StampSubtypeData[]> {
  const session = await getSession();
  return getStampSubtypes(session.user.id, collectionId);
}

export async function createStampSubtypeAction(
  collectionId: string,
  formData: FormData
): Promise<SubtypeActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const actsAsVariant = formData.get("actsAsVariant") === "on";
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await createStampSubtype(session.user.id, collectionId, { name, actsAsVariant });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create subtype. Please try again." };
  }
}

export async function updateStampSubtypeAction(
  subtypeId: string,
  formData: FormData
): Promise<SubtypeActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateStampSubtype(session.user.id, subtypeId, { name });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update subtype. Please try again." };
  }
}

export async function setSubtypeActsAsVariantAction(
  subtypeId: string,
  actsAsVariant: boolean
): Promise<SubtypeActionState> {
  const session = await getSession();
  try {
    await setSubtypeActsAsVariant(session.user.id, subtypeId, actsAsVariant);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update subtype. Please try again." };
  }
}

export async function setDefaultSubtypeAction(
  subtypeId: string
): Promise<SubtypeActionState> {
  const session = await getSession();
  try {
    await setDefaultSubtype(session.user.id, subtypeId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to set default subtype. Please try again." };
  }
}

export async function deleteStampSubtypeAction(
  subtypeId: string
): Promise<SubtypeActionState> {
  const session = await getSession();
  try {
    await deleteStampSubtype(session.user.id, subtypeId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof SubtypeIsDefaultError) {
      return {
        status: "error",
        message: "This is the default subtype. Set another default before deleting it.",
      };
    }
    if (err instanceof SubtypeInUseError) {
      return {
        status: "error",
        message: "This subtype is assigned to stamps and cannot be deleted.",
      };
    }
    return { status: "error", message: "Failed to delete subtype. Please try again." };
  }
}

export async function reorderStampSubtypesAction(
  collectionId: string,
  orderedIds: string[]
): Promise<SubtypeActionState> {
  const session = await getSession();
  try {
    await reorderStampSubtypes(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder subtypes. Please try again." };
  }
}
