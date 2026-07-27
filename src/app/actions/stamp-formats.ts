"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createStampFormat,
  updateStampFormat,
  deleteStampFormat,
  reorderStampFormats,
  getStampFormats,
  FormatInUseError,
  FORMAT_TRANSLATION_FIELDS,
  type StampFormatData,
} from "@/lib/stamp-formats";
import { parseTranslationValues, type TranslationValueMap } from "@/lib/translations";

export type StampFormatActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

export async function getStampFormatsAction(
  collectionId: string
): Promise<StampFormatData[]> {
  const session = await getSession();
  return getStampFormats(session.user.id, collectionId);
}

function parseFields(formData: FormData): {
  name: string;
  abbreviation: string;
  translations: TranslationValueMap;
} {
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    abbreviation: ((formData.get("abbreviation") as string | null) ?? "").trim(),
    // The `<field>:<lang>` hidden inputs the form renders (#344), parsed against the same field
    // list the form built them from.
    translations: parseTranslationValues(formData, FORMAT_TRANSLATION_FIELDS),
  };
}

export async function createStampFormatAction(
  collectionId: string,
  formData: FormData
): Promise<StampFormatActionState> {
  const session = await getSession();
  const { name, abbreviation, translations } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createStampFormat(session.user.id, collectionId, { name, abbreviation, translations });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create format. Please try again." };
  }
}

export async function updateStampFormatAction(
  formatId: string,
  formData: FormData
): Promise<StampFormatActionState> {
  const session = await getSession();
  const { name, abbreviation, translations } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateStampFormat(session.user.id, formatId, { name, abbreviation, translations });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update format. Please try again." };
  }
}

export async function deleteStampFormatAction(
  formatId: string
): Promise<StampFormatActionState> {
  const session = await getSession();
  try {
    await deleteStampFormat(session.user.id, formatId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof FormatInUseError) {
      return {
        status: "error",
        message: "This format is used by catalog prices or copies and cannot be deleted.",
      };
    }
    return { status: "error", message: "Failed to delete format. Please try again." };
  }
}

export async function reorderStampFormatsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<StampFormatActionState> {
  const session = await getSession();
  try {
    await reorderStampFormats(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder formats. Please try again." };
  }
}
