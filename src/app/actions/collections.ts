"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createCollection,
  getCollectionItemNoPad,
  resetCollectionToDemo,
  setCollectionBidPercents,
  setCollectionClosedOfferPhotoTtl,
  setCollectionDefaultLanguage,
  setCollectionItemNoPad,
  type BidPercentPatch,
} from "@/lib/collections";
import { BASE_CURRENCIES, DEFAULT_BASE_CURRENCY } from "@/lib/currencies";

export type CreateCollectionState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function createCollectionAction(
  _prev: CreateCollectionState,
  formData: FormData
): Promise<CreateCollectionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return { status: "error", message: "Collection name is required." };
  }
  if (name.length > 100) {
    return {
      status: "error",
      message: "Collection name must be 100 characters or fewer.",
    };
  }

  const rawCurrency = (formData.get("baseCurrency") as string | null) ?? "";
  const baseCurrency = (BASE_CURRENCIES as readonly string[]).includes(rawCurrency)
    ? rawCurrency
    : DEFAULT_BASE_CURRENCY;

  const seedDemo = formData.get("seedDemoData") === "on";

  let slug: string;
  try {
    const collection = await createCollection(session.user.id, name, baseCurrency, { seedDemo });
    slug = collection.slug;
  } catch {
    return {
      status: "error",
      message: "Failed to create collection. Please try again.",
    };
  }

  redirect(`/c/${slug}`);
}

export type ResetToDemoState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function resetToDemoDataAction(
  collectionId: string
): Promise<ResetToDemoState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  try {
    await resetCollectionToDemo(session.user.id, collectionId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Reset failed. Please try again." };
  }
}

export type DefaultLanguageState =
  | { status: "idle" }
  | { status: "success"; language: string }
  | { status: "error"; message: string };

/** Set the collection's default language (#293) from the Settings → General picker. */
export async function updateCollectionDefaultLanguageAction(
  collectionId: string,
  language: string
): Promise<DefaultLanguageState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await setCollectionDefaultLanguage(session.user.id, collectionId, language);
    return { status: "success", language };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the default language.",
    };
  }
}

export type ItemNoPadState =
  | { status: "idle" }
  | { status: "success"; pad: number }
  | { status: "error"; message: string };

/** Set the internal copy-number width (#268) from the Settings → General picker. */
export async function updateCollectionItemNoPadAction(
  collectionId: string,
  pad: number
): Promise<ItemNoPadState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await setCollectionItemNoPad(session.user.id, collectionId, pad);
    return { status: "success", pad };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the copy-number width.",
    };
  }
}

export type ClosedOfferPhotoTtlState =
  | { status: "idle" }
  | { status: "success"; setting: string | null }
  | { status: "error"; message: string };

/**
 * Save this collection's closed-offer photo retention (#577) from Settings → General.
 *
 * `null` clears the setting, which is not "unset it and take a default" but the collection saying
 * it has no opinion and defers to the instance — the one answer no column default could express.
 */
export async function updateCollectionClosedOfferPhotoTtlAction(
  collectionId: string,
  setting: string | null
): Promise<ClosedOfferPhotoTtlState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await setCollectionClosedOfferPhotoTtl(session.user.id, collectionId, setting);
    return { status: "success", setting };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the retention period.",
    };
  }
}

export type BidPercentsState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/** Save one of the bid-recommendation percentages (#508) from the Settings → General section. */
export async function updateCollectionBidPercentsAction(
  collectionId: string,
  patch: BidPercentPatch
): Promise<BidPercentsState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    await setCollectionBidPercents(session.user.id, collectionId, patch);
    return { status: "success" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to save the bid settings.",
    };
  }
}

/** The collection's copy-number width, for the client rows that render one (#268). */
export async function getCollectionItemNoPadAction(collectionId: string): Promise<number> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return getCollectionItemNoPad(session.user.id, collectionId);
}
