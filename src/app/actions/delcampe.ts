"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { setDelcampePlatform } from "@/lib/delcampe";
import type { DelcampeListingProfileValues } from "@/lib/delcampe-listing-profile-rules";
import {
  createDelcampeListingProfile,
  deleteDelcampeListingProfile,
  setDefaultDelcampeListingProfile,
  updateDelcampeListingProfile,
} from "@/lib/delcampe-listing-profile";
import {
  type DelcampeOfferListingConfig,
  rematchDelcampeOfferCategory,
  setDelcampeOfferCategory,
  setOfferDelcampeListingProfile,
} from "@/lib/delcampe-offer-listing";
import type { DelcampeCategoryRow } from "@/lib/delcampe-category-catalog-rules";
import {
  type DelcampeCatalogStatus,
  delcampeCategoryCatalogStatus,
  readDelcampeCategories,
  refreshDelcampeCategories,
} from "@/lib/delcampe-category-catalog";
import {
  deletePlatformCategoryLesson,
  updatePlatformCategoryLesson,
} from "@/lib/platform-category";

// Settings → Delcampe (#608, #609): which platform contact is Delcampe, the listing profiles its
// uploads are built from, and what the collection has learned about Delcampe's categories. One file,
// unlike Allegro's two, because there is no connection half — Delcampe is listed to by uploading a
// file (#610), so a tab that names the platform and configures what its rows carry is the whole of
// it.
//
// Every action reports a message rather than throwing: they are all driven from one settings panel
// (and one card on the offer screen), where a refusal is an ordinary thing to state and not a
// crashed screen. The message is the domain layer's own, since "a profile needs a shipping model"
// and "that profile is not one of this platform's" are fixed in two different places.

export type DelcampeActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** Point the Delcampe settings at one platform contact, or clear it with an empty id. One write per
 *  change — the select *is* the control — and exclusive, so the collection always has exactly one
 *  answer to "which platform is Delcampe". */
export async function setDelcampePlatformAction(
  collectionId: string,
  contactId: string
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await setDelcampePlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The Delcampe platform could not be set.");
  }
}

export async function createDelcampeListingProfileAction(
  collectionId: string,
  input: DelcampeListingProfileValues
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await createDelcampeListingProfile(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The listing profile could not be saved.");
  }
}

export async function updateDelcampeListingProfileAction(
  profileId: string,
  input: DelcampeListingProfileValues
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await updateDelcampeListingProfile(session.user.id, profileId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The listing profile could not be saved.");
  }
}

/** Make one profile the platform's default — what every upload row carries unless its offer names
 *  another. */
export async function setDefaultDelcampeListingProfileAction(
  profileId: string
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await setDefaultDelcampeListingProfile(session.user.id, profileId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The default listing profile could not be set.");
  }
}

/** Delete a profile. Nothing blocks it; the count of offers that were pointing at it comes back so
 *  the panel can say what just fell back to the default. */
export async function deleteDelcampeListingProfileAction(
  profileId: string
): Promise<{ status: "success"; offersReleased: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const { offersReleased } = await deleteDelcampeListingProfile(session.user.id, profileId);
    return { status: "success", offersReleased };
  } catch (err) {
    return failure(err, "The listing profile could not be deleted.");
  }
}

/** Name a profile on one offer, or clear the override with an empty id so it follows the platform's
 *  default again. */
export async function setOfferDelcampeListingProfileAction(
  offerId: string,
  profileId: string
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await setOfferDelcampeListingProfile(session.user.id, offerId, profileId || null);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The listing profile could not be set on this offer.");
  }
}

// ---------------------------------------------------------------------------
// Categories (#609)
// ---------------------------------------------------------------------------

/**
 * Delcampe's whole published category list, for the picker to build its tree from.
 *
 * Sent **once per picker**, not once per keystroke. The list is around seven thousand rows of short
 * text — a few tens of kilobytes compressed — and having it in the browser is what makes the tree a
 * tree: expanding a node, and narrowing on a search, are then instant and consistent with each
 * other, where a server round trip per interaction would be neither. It is also public data with
 * nothing of the collector's in it, so there is nothing here to scope.
 */
export async function readDelcampeCategoriesAction(): Promise<
  { status: "success"; categories: DelcampeCategoryRow[] } | { status: "error"; message: string }
> {
  await getSession();
  try {
    return { status: "success", categories: await readDelcampeCategories() };
  } catch (err) {
    return failure(err, "Delcampe's category list could not be read.");
  }
}

/** Read Delcampe's published category list again, now. The daily pass does this on its own; the
 *  button exists for the instance that has just been set up and for the one whose last pass was
 *  refused. */
export async function refreshDelcampeCategoriesAction(): Promise<
  { status: "success"; read: number; complete: boolean; message: string | null }
  | { status: "error"; message: string }
> {
  await getSession();
  try {
    const result = await refreshDelcampeCategories();
    return {
      status: "success",
      read: result.read,
      complete: result.complete,
      message: result.message,
    };
  } catch (err) {
    return failure(err, "Delcampe's category list could not be read.");
  }
}

/** How current the catalogue is. Read by the settings panel so it can say whether the picker is
 *  working from something a day old or from nothing at all. */
export async function delcampeCategoryCatalogStatusAction(): Promise<
  ({ status: "success" } & DelcampeCatalogStatus) | { status: "error"; message: string }
> {
  await getSession();
  try {
    return { status: "success", ...(await delcampeCategoryCatalogStatus()) };
  } catch (err) {
    return failure(err, "The category list's state could not be read.");
  }
}

/** Set the category one offer is uploaded in, by hand. */
export async function setDelcampeOfferCategoryAction(
  offerId: string,
  input: { categoryId: string; categoryName: string | null; categoryPath: string | null }
): Promise<
  { status: "success"; config: DelcampeOfferListingConfig | null }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return { status: "success", config: await setDelcampeOfferCategory(session.user.id, offerId, input) };
  } catch (err) {
    return failure(err, "That category could not be set on this offer.");
  }
}

/** Ask the register again — the ↻ on the offer's Delcampe card. */
export async function rematchDelcampeOfferCategoryAction(
  offerId: string
): Promise<
  { status: "success"; config: DelcampeOfferListingConfig | null }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return { status: "success", config: await rematchDelcampeOfferCategory(session.user.id, offerId) };
  } catch (err) {
    return failure(err, "This offer's category could not be matched again.");
  }
}

/** Point one learned association at a different category — the correction that does not require
 *  preparing something wrong again. The register is shared with Allegro (#609), so both are the same
 *  two calls; they are exposed per tab because a panel should not have to know that. */
export async function updateDelcampeCategoryLessonAction(
  lessonId: string,
  category: { categoryId: string; categoryName?: string | null; categoryPath?: string | null }
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await updatePlatformCategoryLesson(session.user.id, lessonId, category);
    return { status: "success" };
  } catch (err) {
    return failure(err, "That learned category could not be changed.");
  }
}

/** Forget one association. Rows already uploaded keep the category they went out with. */
export async function deleteDelcampeCategoryLessonAction(
  lessonId: string
): Promise<DelcampeActionState> {
  const session = await getSession();
  try {
    await deletePlatformCategoryLesson(session.user.id, lessonId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "That learned category could not be deleted.");
  }
}
