"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createAlbumTemplate,
  updateAlbumTemplate,
  deleteAlbumTemplate,
  duplicateAlbumTemplate,
  getAlbumTemplate,
  getAlbumTemplates,
  AlbumTemplateNameTakenError,
  type AlbumTemplateData,
} from "@/lib/album-templates";
import {
  parseAlbumTemplateInput,
  albumRenderPreset,
  readAlbumPresetFields,
  type AlbumRenderPreset,
  type AlbumTemplateRawInput,
} from "@/lib/album-template-rules";
import {
  albumTemplateSamplePreview,
  albumTemplateAlbumPreview,
  type AlbumTemplatePreview,
} from "@/lib/album-preview";
import { getAlbums, type AlbumSummary } from "@/lib/albums";
import {
  AlbumOrnamentError,
  deleteAlbumOrnament,
  getAlbumOrnaments,
  type AlbumOrnamentData,
} from "@/lib/album-ornament-store";

// Server actions for the album templates (#766), `actions/ref-card-templates.ts`'s shape: `FormData`
// in, a parse result out, the pure rules file doing every piece of the deciding.

export type AlbumTemplateActionState =
  | { status: "idle" }
  /** `id` is the template a create or a duplicate made, which the Settings page then selects
   *  (#1474); an edit or a delete has none to hand back. */
  | { status: "success"; id?: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/** Every field the form submits, as typed — the preset's own list is `readAlbumPresetFields`.
 *
 *  `nameFallback` is for the **preview** (#795) and for nothing else: a template being written has no
 *  name yet, and refusing to draw its page until it is given one would put the one field that
 *  changes nothing on the sheet in front of every field that does. A save still requires a real
 *  name — {@link createAlbumTemplateAction} passes no fallback. The album's own values dialog
 *  (#1215) has no name field at all and previews through the same fallback. */
function readForm(formData: FormData, nameFallback: string | null = null) {
  const raw: AlbumTemplateRawInput = {
    name: ((formData.get("name") as string | null) ?? "").trim() || (nameFallback ?? ""),
    ...readAlbumPresetFields(formData),
  };
  return parseAlbumTemplateInput(raw);
}

/** A duplicate name is reported in its own words: an album seeds from a template *by name*, so two
 *  of one name is worth a sentence rather than a "please try again". */
function toErrorState(err: unknown, fallback: string): AlbumTemplateActionState {
  if (err instanceof AlbumTemplateNameTakenError || err instanceof AlbumOrnamentError) {
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
    const id = await createAlbumTemplate(session.user.id, collectionId, parsed.value);
    return { status: "success", id };
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

/** A copy of the template under a *(copy)* name, every value carried over (#1474). */
export async function duplicateAlbumTemplateAction(
  templateId: string
): Promise<AlbumTemplateActionState> {
  const session = await getSession();
  try {
    const id = await duplicateAlbumTemplate(session.user.id, templateId);
    return { status: "success", id };
  } catch (err) {
    return toErrorState(err, "Failed to duplicate the template. Please try again.");
  }
}

// ── Corner ornaments (#1427) ─────────────────────────────────────────────────
//
// Uploading is a route (`/api/collections/[collectionId]/album-ornaments`), because it carries a
// file. Listing and deleting are ordinary actions.

export async function getAlbumOrnamentsAction(collectionId: string): Promise<AlbumOrnamentData[]> {
  const session = await getSession();
  return getAlbumOrnaments(session.user.id, collectionId);
}

export async function deleteAlbumOrnamentAction(
  ornamentId: string
): Promise<AlbumTemplateActionState> {
  const session = await getSession();
  try {
    await deleteAlbumOrnament(session.user.id, ornamentId);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to delete the ornament. Please try again.");
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

/** One preset drawn over the chosen source — the one path both previews below take. */
async function planPreview(
  userId: string,
  collectionId: string,
  preset: AlbumRenderPreset,
  source: AlbumPreviewSource
): Promise<AlbumPreviewResult> {
  if (source.kind === "album") {
    const preview = await albumTemplateAlbumPreview(userId, source.albumId, preset);
    if (!preview) {
      return { status: "invalid", message: "That album is no longer available." };
    }
    return { status: "ok", preview };
  }
  const preview = await albumTemplateSamplePreview(userId, collectionId, preset);
  return { status: "ok", preview };
}

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
  return planPreview(session.user.id, collectionId, preset, source);
}

/**
 * The same page for a template **as it is stored** — the Settings page's preview beside the list
 * (#1474), where there is no form to read. It is planned by the same two functions from the same
 * preset, so the sheet here and the sheet in the editor opened on that template cannot differ: the
 * editor's fields start at exactly these values, and its parser gives them back unchanged.
 */
export async function albumTemplateStoredPreviewAction(
  collectionId: string,
  templateId: string,
  source: AlbumPreviewSource
): Promise<AlbumPreviewResult> {
  const session = await getSession();
  const template = await getAlbumTemplate(session.user.id, collectionId, templateId);
  if (!template) return { status: "invalid", message: "That template is no longer available." };
  const preset = albumRenderPreset(template);
  return planPreview(session.user.id, collectionId, preset, source);
}

/** The albums the preview may be pointed at. Read on demand rather than passed down through the
 *  settings screen: the list is only needed where a preview is drawn — a template dialog, or the
 *  Album templates page (#1474) — and the Settings shell is a file several sessions share. */
export async function albumPreviewAlbumsAction(
  collectionId: string
): Promise<AlbumSummary[]> {
  const session = await getSession();
  return getAlbums(session.user.id, collectionId);
}
