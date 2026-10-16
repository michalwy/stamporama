"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createPlatform,
  deletePlatform,
  getModulePlatformSettings,
  getPlatform,
  listPlatforms,
  PlatformFieldError,
  PlatformInUseError,
  PlatformNameTakenError,
  updatePlatform,
  type PlatformInput,
  type PlatformListItem,
} from "@/lib/platforms";
import { parsePlatformPhotoLimits } from "@/lib/offer-photo-config";
import { parsePlatformTextLimits } from "@/lib/listing-text-limits";
import { normalizeDecimalInput } from "@/lib/decimal-input";

// The platforms' own actions (#1955; ADR-0071): Settings → Platforms for the generic ones, and each
// module page's Platform tab for its module platform. One form shape for both — the settings the
// contact form's Platform tab carried until #1955, market and currency included.

export type PlatformActionState =
  | { status: "success"; platform: PlatformListItem }
  | { status: "error"; message: string };

export type PlatformDeleteState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "true";
}

/** Raised when one of the platform's hard limits — photos (#308) or listing-text lengths (#403) —
 * doesn't parse, so the caller can surface the rule's own message instead of a generic failure. */
class LimitsError extends Error {}

/** Read the platform's settings from its form. Blank limits mean "no limit stated"; amounts accept
 *  either decimal separator (#233). */
function parsePlatformFields(formData: FormData): PlatformInput {
  const limits = parsePlatformPhotoLimits({
    maxPhotos: str(formData, "maxPhotos"),
    maxPhotoEdge: str(formData, "maxPhotoEdge"),
    maxPhotoFileSizeMib: str(formData, "maxPhotoFileSizeMib"),
  });
  if (!limits.ok) throw new LimitsError(limits.message);
  const textLimits = parsePlatformTextLimits({
    maxTitleLength: str(formData, "maxTitleLength"),
    maxDescriptionLength: str(formData, "maxDescriptionLength"),
    maxPrivateNoteLength: str(formData, "maxPrivateNoteLength"),
  });
  if (!textLimits.ok) throw new LimitsError(textLimits.message);
  const refresh = str(formData, "refreshQuickBuysAfterDays");

  return {
    name: str(formData, "name"),
    enabled: bool(formData, "enabled"),
    notes: str(formData, "notes") || null,
    market: str(formData, "market") || null,
    platformCurrency: str(formData, "platformCurrency") || null,
    titleTemplate: str(formData, "titleTemplate") || null,
    descriptionTemplate: str(formData, "descriptionTemplate") || null,
    privateNoteTemplate: str(formData, "privateNoteTemplate") || null,
    descriptionFormat: str(formData, "descriptionFormat"),
    titleLanguage: str(formData, "titleLanguage") || null,
    defaultStartingPrice: normalizeDecimalInput(str(formData, "defaultStartingPrice")) || null,
    minimumPrice: normalizeDecimalInput(str(formData, "minimumPrice")) || null,
    defaultListingType: str(formData, "defaultListingType") || null,
    refreshQuickBuysAfterDays: refresh !== "" ? Number(refresh) : null,
    buyerMessageTemplate: str(formData, "buyerMessageTemplate") || null,
    ...limits.value,
    ...textLimits.value,
    photoSides: str(formData, "photoSides"),
    photoPreferSingles: bool(formData, "photoPreferSingles"),
    coverSymbols: bool(formData, "coverSymbols"),
    coverStyle: str(formData, "coverStyle") || null,
    coverColor: str(formData, "coverColor") || null,
    tileLabelLeftTemplate: str(formData, "tileLabelLeftTemplate") || null,
    tileLabelRightTemplate: str(formData, "tileLabelRightTemplate") || null,
    defaultCollageTemplateId: str(formData, "defaultCollageTemplateId") || null,
    photoGroupByChecklist: bool(formData, "photoGroupByChecklist"),
    defaultGroupCollageTemplateId: str(formData, "defaultGroupCollageTemplateId") || null,
  };
}

function isUserError(err: unknown): err is Error {
  return (
    err instanceof PlatformNameTakenError ||
    err instanceof PlatformFieldError ||
    err instanceof PlatformInUseError ||
    err instanceof LimitsError
  );
}

/** The generic platforms, for Settings → Platforms. */
export async function listGenericPlatformsAction(collectionId: string): Promise<PlatformListItem[]> {
  const session = await getSession();
  return listPlatforms(session.user.id, collectionId, "generic");
}

/** A module's platform, for its page's Platform tab — made first if the collection lacks it. */
export async function getModulePlatformAction(
  collectionId: string,
  module: string
): Promise<PlatformListItem> {
  const session = await getSession();
  return getModulePlatformSettings(session.user.id, collectionId, module);
}

/** Add a generic platform from Settings → Platforms, with whatever settings the new form carried. */
export async function createPlatformAction(
  collectionId: string,
  formData: FormData
): Promise<PlatformActionState> {
  const session = await getSession();
  try {
    const created = await createPlatform(session.user.id, collectionId, parsePlatformFields(formData));
    return { status: "success", platform: { ...created, referenceCount: 0 } };
  } catch (err) {
    if (isUserError(err)) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to add the platform. Please try again." };
  }
}

/** Save a platform's settings from its form — a generic one's name included. */
export async function updatePlatformAction(
  platformId: string,
  formData: FormData
): Promise<PlatformActionState> {
  const session = await getSession();
  try {
    const saved = await updatePlatform(session.user.id, platformId, parsePlatformFields(formData));
    return { status: "success", platform: (await getPlatform(session.user.id, saved.id))! };
  } catch (err) {
    if (isUserError(err)) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to save the platform. Please try again." };
  }
}

/** Delete a generic platform nothing names. */
export async function deletePlatformAction(platformId: string): Promise<PlatformDeleteState> {
  const session = await getSession();
  try {
    await deletePlatform(session.user.id, platformId);
    return { status: "success" };
  } catch (err) {
    if (isUserError(err)) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to delete the platform. Please try again." };
  }
}
