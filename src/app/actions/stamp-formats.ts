"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
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
import { isPieceKind, type PieceKind } from "@/lib/piece-valuation";

export type StampFormatActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** A copy's formats; with `withCoverPrices`, the cover-price rows too (#2356) — for a price
 *  surface only. */
export async function getStampFormatsAction(
  collectionId: string,
  withCoverPrices = false
): Promise<StampFormatData[]> {
  const session = await getSession();
  return getStampFormats(session.user.id, collectionId, { withCoverPrices });
}

function parseFields(formData: FormData): {
  name: string;
  abbreviation: string;
  pieceKind?: PieceKind | null;
  translations: TranslationValueMap;
} {
  // What a copy in the format is (#2359): blank is neither; absent leaves it alone.
  const kindRaw = formData.get("pieceKind");
  return {
    pieceKind:
      typeof kindRaw === "string" ? (isPieceKind(kindRaw) ? kindRaw : null) : undefined,
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
  const { name, abbreviation, pieceKind, translations } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createStampFormat(session.user.id, collectionId, {
      name,
      abbreviation,
      pieceKind,
      translations,
    });
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
  const { name, abbreviation, pieceKind, translations } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateStampFormat(session.user.id, formatId, {
      name,
      abbreviation,
      pieceKind,
      translations,
    });
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
