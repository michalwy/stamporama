"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStampAttribute,
  updateStampAttribute,
  deleteStampAttribute,
  reorderStampAttributes,
  getStampAttributeLists,
  StampAttributeInUseError,
  STAMP_ATTRIBUTE_TRANSLATION_FIELDS,
  type StampAttributeLists,
} from "@/lib/stamp-attributes";
import { STAMP_ATTRIBUTE_LABELS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";
import { parseTranslationValues } from "@/lib/translations";

// The four attribute dictionaries' actions (#72), one set dispatching over the kind — the panel
// renders the same list four times and only the noun in its messages changes.

export type StampAttributeActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getStampAttributeListsAction(
  collectionId: string
): Promise<StampAttributeLists> {
  const session = await getSession();
  return getStampAttributeLists(session.user.id, collectionId);
}

export async function createStampAttributeAction(
  collectionId: string,
  kind: StampAttributeKind,
  formData: FormData
): Promise<StampAttributeActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await createStampAttribute(session.user.id, collectionId, kind, {
      name,
      translations: parseTranslationValues(formData, STAMP_ATTRIBUTE_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch {
    return {
      status: "error",
      message: `Failed to create ${STAMP_ATTRIBUTE_LABELS[kind].noun}. Please try again.`,
    };
  }
}

export async function updateStampAttributeAction(
  kind: StampAttributeKind,
  attributeId: string,
  formData: FormData
): Promise<StampAttributeActionState> {
  const session = await getSession();
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) return { status: "error", message: "Name is required." };
  try {
    await updateStampAttribute(session.user.id, kind, attributeId, {
      name,
      translations: parseTranslationValues(formData, STAMP_ATTRIBUTE_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch {
    return {
      status: "error",
      message: `Failed to update ${STAMP_ATTRIBUTE_LABELS[kind].noun}. Please try again.`,
    };
  }
}

export async function deleteStampAttributeAction(
  kind: StampAttributeKind,
  attributeId: string
): Promise<StampAttributeActionState> {
  const session = await getSession();
  try {
    await deleteStampAttribute(session.user.id, kind, attributeId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof StampAttributeInUseError) {
      return {
        status: "error",
        message: `This ${STAMP_ATTRIBUTE_LABELS[kind].noun} is assigned to stamps and cannot be deleted.`,
      };
    }
    return {
      status: "error",
      message: `Failed to delete ${STAMP_ATTRIBUTE_LABELS[kind].noun}. Please try again.`,
    };
  }
}

export async function reorderStampAttributesAction(
  collectionId: string,
  kind: StampAttributeKind,
  orderedIds: string[]
): Promise<StampAttributeActionState> {
  const session = await getSession();
  try {
    await reorderStampAttributes(session.user.id, collectionId, kind, orderedIds);
    return { status: "success" };
  } catch {
    return {
      status: "error",
      message: `Failed to reorder ${STAMP_ATTRIBUTE_LABELS[kind].plural}. Please try again.`,
    };
  }
}
