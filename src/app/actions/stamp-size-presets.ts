"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  applyStampSizePreset,
  createStampSizePreset,
  deleteStampSizePreset,
  getStampSizePresets,
  reorderStampSizePresets,
  updateStampSizePreset,
  StampSizePresetFigureError,
  StampSizePresetPairTakenError,
  type StampSizePresetApplyResult,
  type StampSizePresetData,
  type StampSizePresetInput,
  type StampSizePresetSubject,
} from "@/lib/stamp-size-presets";
import { parseSizeMm } from "@/lib/stamp-size";
import { STAMP_SIZE_LABELS } from "@/lib/stamp-attribute-kinds";

// Server actions for the stamp size presets (#804; ADR-0048), `actions/hawid-stock.ts`'s shape:
// `FormData` in, a parse result out, the Prisma module doing the writing.
//
// ## Why the form is parsed here rather than in `stamp-size.ts`
//
// ADR-0048's consequences open with *"`src/lib/stamp-size.ts` gains nothing"*, and a preset-form
// parser added to it would be the first thing to contradict that. The parse this form needs is not
// the one that file already exports either: `parseStampSizeInput` (#763) reads the **stamp's** two
// fields, where a blank is a real answer — *this stamp states no width* — while a preset is never
// half (`formatPair`), so a blank here is a mistake and has to be reported. `parseSizeMm` is the
// piece both readings share, and it is where the grammar actually lives: a comma read as a decimal
// point, the bounds, the rounding to `SIZE_DECIMALS`. Taking that and deciding what a blank means
// locally is `certificate-statuses.ts`'s arrangement, and it keeps the one rule that must not fork —
// *what counts as a figure* — in a single function.

export type StampSizePresetActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

/**
 * One of the two figures, required.
 *
 * **A blank is refused rather than stored as *no size*** — #763's asymmetry, which this form
 * inherits and sharpens. On a stamp, no width is a state the record is allowed to be in; a preset
 * with no width is not a preset at all, and one saved half-stated would sit in the picker offering
 * to write a null over a measurement. So an absent or unreadable figure is a message the dialog
 * shows, and nothing reaches the database.
 */
function parseFigure(
  formData: FormData,
  field: "widthMm" | "heightMm"
): { ok: true; mm: number } | { ok: false; message: string } {
  return parseFigureText(formData.get(field) as string | null, field);
}

/** {@link parseFigure} for a figure that arrives as text rather than on a form — the attributes
 *  tab's save button (#805), which sits inside the stamp form and cannot submit a form of its own. */
function parseFigureText(
  text: string | null,
  field: "widthMm" | "heightMm"
): { ok: true; mm: number } | { ok: false; message: string } {
  const raw = (text ?? "").trim();
  const label = STAMP_SIZE_LABELS[field].field;
  if (!raw) return { ok: false, message: `${label} is required — a preset states both figures.` };
  const parsed = parseSizeMm(raw);
  // `parseSizeMm` answers `null` for a blank, which the check above has already ruled out. Both
  // branches are the same refusal here, and neither may fall through to a stored figure.
  if (!parsed.ok || parsed.mm === null) {
    return { ok: false, message: `${label} must be a figure in millimetres, like 21.5.` };
  }
  return { ok: true, mm: parsed.mm };
}

/** The form's three fields: the pair, and the label that is not the identity. */
function parseForm(
  formData: FormData
): { ok: true; value: StampSizePresetInput } | { ok: false; message: string } {
  const width = parseFigure(formData, "widthMm");
  if (!width.ok) return width;
  const height = parseFigure(formData, "heightMm");
  if (!height.ok) return height;
  return {
    ok: true,
    value: {
      widthMm: width.mm,
      heightMm: height.mm,
      name: ((formData.get("name") as string | null) ?? "").trim() || null,
    },
  };
}

/** A duplicate pair and an impossible figure both say their own sentence. The pair is the identity
 *  (ADR-0048 §3), so a collision is *the pair you were reaching for is already on the list* rather
 *  than a failure — `HawidStripHeightTakenError`'s convention, one model up. */
function toErrorState(err: unknown, fallback: string): StampSizePresetActionState {
  if (err instanceof StampSizePresetPairTakenError || err instanceof StampSizePresetFigureError) {
    return { status: "error", message: err.message };
  }
  return { status: "error", message: fallback };
}

export async function getStampSizePresetsAction(
  collectionId: string
): Promise<StampSizePresetData[]> {
  const session = await getSession();
  return getStampSizePresets(session.user.id, collectionId);
}

export async function createStampSizePresetAction(
  collectionId: string,
  formData: FormData
): Promise<StampSizePresetActionState> {
  const session = await getSession();
  const parsed = parseForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await createStampSizePreset(session.user.id, collectionId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the preset. Please try again.");
  }
}

export async function updateStampSizePresetAction(
  presetId: string,
  formData: FormData
): Promise<StampSizePresetActionState> {
  const session = await getSession();
  const parsed = parseForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateStampSizePreset(session.user.id, presetId, parsed.value);
    return { status: "success" };
  } catch (err) {
    return toErrorState(err, "Failed to save the preset. Please try again.");
  }
}

export async function deleteStampSizePresetAction(
  presetId: string
): Promise<StampSizePresetActionState> {
  const session = await getSession();
  try {
    await deleteStampSizePreset(session.user.id, presetId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to delete the preset. Please try again." };
  }
}

export async function reorderStampSizePresetsAction(
  collectionId: string,
  orderedIds: string[]
): Promise<StampSizePresetActionState> {
  const session = await getSession();
  try {
    await reorderStampSizePresets(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder the presets. Please try again." };
  }
}

export type SaveStampSizePresetFromFieldsState =
  | { status: "saved"; preset: StampSizePresetData }
  | { status: "exists"; message: string }
  | { status: "error"; message: string };

/**
 * The attributes tab's **Save as preset** (#805; ADR-0048 §5): whatever the width and height fields
 * hold at that moment, saved with no name.
 *
 * The figures arrive as the text in the fields, not as numbers the client parsed, so the one grammar
 * (`parseSizeMm`) is applied here where it cannot be skipped — the button's own enabled state reads
 * the same function, but a disabled button is a hint, not a gate.
 *
 * **A pair already saved is its own status, not an error** (#805's *Done when*: "saving an existing
 * pair reports it rather than failing"). The collector reached for a size that is already on the
 * list, which is a fact to tell them rather than a failure to apologise for — so the caller can say
 * it in a neutral tone.
 */
export async function saveStampSizePresetFromFieldsAction(
  collectionId: string,
  widthText: string | null,
  heightText: string | null
): Promise<SaveStampSizePresetFromFieldsState> {
  const session = await getSession();
  const width = parseFigureText(widthText, "widthMm");
  if (!width.ok) return { status: "error", message: width.message };
  const height = parseFigureText(heightText, "heightMm");
  if (!height.ok) return { status: "error", message: height.message };
  try {
    const preset = await createStampSizePreset(session.user.id, collectionId, {
      widthMm: width.mm,
      heightMm: height.mm,
    });
    return { status: "saved", preset };
  } catch (err) {
    if (err instanceof StampSizePresetPairTakenError) {
      return { status: "exists", message: err.message };
    }
    const state = toErrorState(err, "Failed to save the preset. Please try again.");
    return {
      status: "error",
      message: state.status === "error" ? state.message : "Failed to save the preset.",
    };
  }
}

export type StampSizePresetApplyActionState =
  | { status: "success"; result: StampSizePresetApplyResult }
  | { status: "error"; message: string };

/**
 * The apply dialog's counts (#806; ADR-0048 §6), written nowhere.
 *
 * A separate action from {@link applyStampSizePresetAction} rather than a flag on it, so that a
 * preview can never become a write by a caller passing the wrong boolean: the only thing this can
 * call is the module with `preview: true`.
 */
export async function previewStampSizePresetAction(
  presetId: string,
  subject: StampSizePresetSubject
): Promise<StampSizePresetApplyActionState> {
  const session = await getSession();
  try {
    const result = await applyStampSizePreset(session.user.id, {
      presetId,
      subject,
      preview: true,
    });
    return { status: "success", result };
  } catch {
    return { status: "error", message: "Could not count the stamps. Please try again." };
  }
}

/**
 * Writes a preset's pair onto a subject's stamps (#806). `overwriteStated` is a required argument
 * here, not an optional one, so every caller states the decision it is taking — the module's own
 * default stays *skip*, and ADR-0048 §6 is why.
 *
 * The returned counts are the **write's**, recounted at the moment of writing, and they are what the
 * caller reports: a preview taken a moment earlier is what the collector agreed to, but the toast
 * says what actually happened.
 */
export async function applyStampSizePresetAction(
  presetId: string,
  subject: StampSizePresetSubject,
  overwriteStated: boolean
): Promise<StampSizePresetApplyActionState> {
  const session = await getSession();
  try {
    const result = await applyStampSizePreset(session.user.id, {
      presetId,
      subject,
      overwriteStated,
    });
    return { status: "success", result };
  } catch {
    return { status: "error", message: "Failed to apply the preset. Please try again." };
  }
}
