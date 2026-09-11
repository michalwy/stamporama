"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createStampSizePreset,
  deleteStampSizePreset,
  getStampSizePresets,
  reorderStampSizePresets,
  updateStampSizePreset,
  StampSizePresetFigureError,
  StampSizePresetPairTakenError,
  type StampSizePresetData,
  type StampSizePresetInput,
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
  const raw = ((formData.get(field) as string | null) ?? "").trim();
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
