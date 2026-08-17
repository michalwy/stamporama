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
  setOfferDelcampeListingProfile,
  updateDelcampeListingProfile,
} from "@/lib/delcampe-listing-profile";

// Settings → Delcampe (#608): which platform contact is Delcampe, and the listing profiles its
// uploads are built from. One file, unlike Allegro's two, because there is no connection half —
// Delcampe is listed to by uploading a file (#610), so a tab that names the platform and configures
// what its rows carry is the whole of it.
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
