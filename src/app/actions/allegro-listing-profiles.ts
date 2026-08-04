"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  type AllegroListingProfileInput,
  type AllegroSellerDictionaries,
  createAllegroListingProfile,
  deleteAllegroListingProfile,
  getAllegroSellerDictionaries,
  setDefaultAllegroListingProfile,
  updateAllegroListingProfile,
} from "@/lib/allegro-listing-profile";

// Settings → Allegro, the listing-profile half (#486; ADR-0025).
//
// Its own file rather than more of `allegro.ts`: that one is the platform marker and the connection,
// and this is the account settings a listing is published with. They share a tab and nothing else.
//
// Every action returns a message rather than throwing, exactly as the connection's do — these are
// all driven from one settings panel, where a refusal is an ordinary thing to report and not a
// crashed screen. The message is the domain layer's own, since "that is not a handling time Allegro
// accepts" and "the connection needs reconnecting" are fixed in two different places.

export type AllegroProfileActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/**
 * The account's own dictionaries, read live (#486).
 *
 * Called when the editor opens and again on **Refresh**, never cached: a rate set added on Allegro
 * five minutes ago should be selectable. A connection that is down is reported as a sentence, with
 * the profile editor still usable over what was already saved.
 */
export async function getAllegroSellerDictionariesAction(
  collectionId: string
): Promise<
  | { status: "success"; dictionaries: AllegroSellerDictionaries }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return {
      status: "success",
      dictionaries: await getAllegroSellerDictionaries(session.user.id, collectionId),
    };
  } catch (err) {
    return failure(err, "Allegro's shipping rates and after-sales services could not be read.");
  }
}

export async function createAllegroListingProfileAction(
  collectionId: string,
  input: AllegroListingProfileInput
): Promise<AllegroProfileActionState> {
  const session = await getSession();
  try {
    await createAllegroListingProfile(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The listing profile could not be saved.");
  }
}

export async function updateAllegroListingProfileAction(
  profileId: string,
  input: AllegroListingProfileInput
): Promise<AllegroProfileActionState> {
  const session = await getSession();
  try {
    await updateAllegroListingProfile(session.user.id, profileId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The listing profile could not be saved.");
  }
}

/** Make one profile the platform's default — what every listing is published with unless the offer
 *  names another. */
export async function setDefaultAllegroListingProfileAction(
  profileId: string
): Promise<AllegroProfileActionState> {
  const session = await getSession();
  try {
    await setDefaultAllegroListingProfile(session.user.id, profileId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The default listing profile could not be set.");
  }
}

/** Delete a profile. Nothing blocks it; the count of offers that were pointing at it comes back so
 *  the panel can say what just fell back to the default. */
export async function deleteAllegroListingProfileAction(
  profileId: string
): Promise<
  { status: "success"; offersReleased: number } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    const { offersReleased } = await deleteAllegroListingProfile(session.user.id, profileId);
    return { status: "success", offersReleased };
  } catch (err) {
    return failure(err, "The listing profile could not be deleted.");
  }
}
