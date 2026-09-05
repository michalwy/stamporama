"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createAlbumTemplate,
  updateAlbumTemplate,
  deleteAlbumTemplate,
  getAlbumTemplates,
  AlbumTemplateNameTakenError,
  type AlbumTemplateData,
} from "@/lib/album-templates";
import {
  parseAlbumTemplateInput,
  type AlbumTemplateRawInput,
  type AlbumTemplateInput,
} from "@/lib/album-template-rules";

// Server actions for the album templates (#766), `actions/ref-card-templates.ts`'s shape: `FormData`
// in, a parse result out, the pure rules file doing every piece of the deciding.

export type AlbumTemplateActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

/** Every field the form submits, as typed. Listed rather than looped so a field added to the preset
 *  without being added here is a type error instead of a value that silently stops being saved. */
function readForm(formData: FormData) {
  const str = (key: keyof AlbumTemplateInput) =>
    ((formData.get(key) as string | null) ?? "").trim();
  const raw: AlbumTemplateRawInput = {
    name: str("name"),
    pageWidthMm: str("pageWidthMm"),
    pageHeightMm: str("pageHeightMm"),
    marginTopMm: str("marginTopMm"),
    marginRightMm: str("marginRightMm"),
    marginBottomMm: str("marginBottomMm"),
    marginLeftMm: str("marginLeftMm"),
    columns: str("columns"),
    columnGapMm: str("columnGapMm"),
    borderStyle: str("borderStyle"),
    borderWidthMm: str("borderWidthMm"),
    borderInsetMm: str("borderInsetMm"),
    boxGapXMm: str("boxGapXMm"),
    boxGapYMm: str("boxGapYMm"),
    headingSpaceAboveMm: str("headingSpaceAboveMm"),
    headingSpaceBelowMm: str("headingSpaceBelowMm"),
    verticalClearanceMm: str("verticalClearanceMm"),
    horizontalMarginMm: str("horizontalMarginMm"),
    titleFace: str("titleFace"),
    titleSizePt: str("titleSizePt"),
    chapterFace: str("chapterFace"),
    chapterSizePt: str("chapterSizePt"),
    headingFace: str("headingFace"),
    headingSizePt: str("headingSizePt"),
    labelFace: str("labelFace"),
    labelSizePt: str("labelSizePt"),
    footerFace: str("footerFace"),
    footerSizePt: str("footerSizePt"),
    boxBorderStyle: str("boxBorderStyle"),
    boxBorderWidthMm: str("boxBorderWidthMm"),
    labelPosition: str("labelPosition"),
    printPhotos: str("printPhotos"),
    photoOpacityPercent: str("photoOpacityPercent"),
    chapterTemplate: str("chapterTemplate"),
    checklistTemplate: str("checklistTemplate"),
    boxLabelTemplate: str("boxLabelTemplate"),
    footerTemplate: str("footerTemplate"),
  };
  return parseAlbumTemplateInput(raw);
}

/** A duplicate name is reported in its own words: an album seeds from a template *by name*, so two
 *  of one name is worth a sentence rather than a "please try again". */
function toErrorState(err: unknown, fallback: string): AlbumTemplateActionState {
  if (err instanceof AlbumTemplateNameTakenError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: fallback };
}

export async function getAlbumTemplatesAction(
  collectionId: string
): Promise<AlbumTemplateData[]> {
  const session = await getSession();
  return getAlbumTemplates(session.user.id, collectionId);
}

export async function createAlbumTemplateAction(
  collectionId: string,
  formData: FormData
): Promise<AlbumTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createAlbumTemplate(session.user.id, collectionId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to add the template. Please try again.");
  }
}

export async function updateAlbumTemplateAction(
  templateId: string,
  formData: FormData
): Promise<AlbumTemplateActionState> {
  const session = await getSession();
  const parsed = readForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateAlbumTemplate(session.user.id, templateId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the template. Please try again.");
  }
}

export async function deleteAlbumTemplateAction(
  templateId: string
): Promise<AlbumTemplateActionState> {
  const session = await getSession();
  try {
    await deleteAlbumTemplate(session.user.id, templateId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the template. Please try again." };
  }
}
