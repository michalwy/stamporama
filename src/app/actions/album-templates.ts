"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
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
  albumRenderPreset,
  type AlbumTemplateRawInput,
  type AlbumTemplateInput,
} from "@/lib/album-template-rules";
import {
  albumTemplateSamplePreview,
  albumTemplateAlbumPreview,
  type AlbumTemplatePreview,
} from "@/lib/album-preview";
import { getAlbums, type AlbumSummary } from "@/lib/albums";

// Server actions for the album templates (#766), `actions/ref-card-templates.ts`'s shape: `FormData`
// in, a parse result out, the pure rules file doing every piece of the deciding.

export type AlbumTemplateActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Every field the form submits, as typed. Listed rather than looped so a field added to the preset
 *  without being added here is a type error instead of a value that silently stops being saved.
 *
 *  `nameFallback` is for the **preview** (#795) and for nothing else: a template being written has no
 *  name yet, and refusing to draw its page until it is given one would put the one field that
 *  changes nothing on the sheet in front of every field that does. A save still requires a real
 *  name — {@link createAlbumTemplateAction} passes no fallback. */
function readForm(formData: FormData, nameFallback: string | null = null) {
  const str = (key: keyof AlbumTemplateInput) =>
    ((formData.get(key) as string | null) ?? "").trim();
  const raw: AlbumTemplateRawInput = {
    name: str("name") || (nameFallback ?? ""),
    pageWidthMm: str("pageWidthMm"),
    pageHeightMm: str("pageHeightMm"),
    marginTopMm: str("marginTopMm"),
    marginRightMm: str("marginRightMm"),
    marginBottomMm: str("marginBottomMm"),
    marginLeftMm: str("marginLeftMm"),
    blocksPerBand: str("blocksPerBand"),
    blockGapMm: str("blockGapMm"),
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
    printTitle: str("printTitle"),
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

// ── The live preview (#795) ──────────────────────────────────────────────────
//
// The dialog re-reads its own `FormData` as the collector types and asks for the page that preset
// produces. It goes through the *same* parser a save does, so a preview can never be drawn from a
// figure the template would refuse — a preview of a page that cannot be saved is a page nobody will
// ever print.
//
// The preview is planned on the server for the reason ADR-0045 §7 gives: text is measured against
// the faces the PDF embeds, those bytes are on disk, and **the client is not allowed to measure**.
// A browser laying out its own preview would break a heading in one place and the printer in
// another, which is the confident wrong answer this whole track is arranged against.

/** Where the preview's stamps come from. Synthetic by default; a real album is the option the
 *  collector asked for beside it, not instead of it (decided 2026-09-06, #795). */
export type AlbumPreviewSource =
  | { kind: "sample" }
  | { kind: "album"; albumId: string };

export type AlbumPreviewResult =
  | { status: "ok"; preview: AlbumTemplatePreview }
  /** The form does not currently describe a template that could be saved. The dialog keeps the last
   *  sheet it drew and says why this one is not it — blanking a field mid-edit is an ordinary thing
   *  to do, and a preview that vanished on every keystroke would be worse than one that lags. */
  | { status: "invalid"; message: string };

/** The name the preview stands in with while the collector has not chosen one. It is never printed:
 *  a running head carries the **album's** name, and the preview's album is the same stand-in the
 *  four text builders resolve `{albumName}` against. */
const PREVIEW_TEMPLATE_NAME = "Untitled template";

export async function albumTemplatePreviewAction(
  collectionId: string,
  formData: FormData,
  source: AlbumPreviewSource
): Promise<AlbumPreviewResult> {
  const session = await getSession();
  const parsed = readForm(formData, PREVIEW_TEMPLATE_NAME);
  if (!parsed.ok) return { status: "invalid", message: parsed.message };
  // The preset alone: a template's own name and id are not values a page is set in, and
  // `albumRenderPreset` is the one list of what a preset holds (#766).
  const preset = albumRenderPreset(parsed.value);
  if (source.kind === "album") {
    const preview = await albumTemplateAlbumPreview(session.user.id, source.albumId, preset);
    if (!preview) {
      return { status: "invalid", message: "That album is no longer available." };
    }
    return { status: "ok", preview };
  }
  const preview = await albumTemplateSamplePreview(session.user.id, collectionId, preset);
  return { status: "ok", preview };
}

/** The albums the preview may be pointed at. Read on demand rather than passed down through the
 *  settings screen: the list is only ever needed once a template dialog is open, and the Settings
 *  tab shell is a file several sessions share. */
export async function albumPreviewAlbumsAction(
  collectionId: string
): Promise<AlbumSummary[]> {
  const session = await getSession();
  return getAlbums(session.user.id, collectionId);
}
