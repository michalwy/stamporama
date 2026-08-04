"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  describeAllegroOfferParameters,
  getAllegroOfferListingConfig,
  rematchAllegroOfferCategory,
  setAllegroOfferCategory,
  setAllegroOfferProfile,
  type AllegroOfferListingConfig,
  type AllegroOfferParameterView,
} from "@/lib/allegro-offer-listing";

// The offer's own Allegro card (#494) — what it reads and the three things it writes.
//
// Every one of them **returns** its failure rather than throwing, as #486's and #488's do: a
// connection that is down and a category tree that has moved are ordinary things to say on a card,
// not crashed screens.

export type AllegroListingConfigState =
  | { status: "success"; config: AllegroOfferListingConfig | null }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function failed(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** The category's parameters as the card lists them: Allegro's questions, this offer's answers. */
export async function getAllegroOfferParametersAction(
  collectionId: string,
  offerId: string
): Promise<
  | {
      status: "success";
      parameters: AllegroOfferParameterView[];
      /** The category's breadcrumb as Allegro states it today, so a category matched before the path
       *  was recorded still reads as a path rather than as a bare leaf name. */
      categoryPath?: string | null;
      categoryName?: string | null;
    }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    const answer = await describeAllegroOfferParameters(session.user.id, collectionId, offerId);
    if (answer === null) return { status: "success", parameters: [] };
    if ("error" in answer) return { status: "error", message: answer.error };
    return {
      status: "success",
      parameters: answer.parameters,
      categoryName: answer.categoryName,
      categoryPath: answer.categoryPath,
    };
  } catch (err) {
    return failed(err, "This category's parameters could not be read.");
  }
}

/** Store a category and its answers picked by hand. */
export async function setAllegroOfferCategoryAction(
  collectionSlug: string,
  offerId: string,
  input: Parameters<typeof setAllegroOfferCategory>[2]
): Promise<AllegroListingConfigState> {
  const session = await getSession();
  try {
    const config = await setAllegroOfferCategory(session.user.id, offerId, input);
    revalidatePath(`/c/${collectionSlug}/offers/${offerId}`);
    return { status: "success", config };
  } catch (err) {
    return failed(err, "That category could not be saved.");
  }
}

/** Match the category again from scratch — the ↻ on the card, and the manual counterpart of the
 *  backfill that runs when the offer gains its first copy. */
export async function rematchAllegroOfferCategoryAction(
  collectionSlug: string,
  offerId: string
): Promise<AllegroListingConfigState> {
  const session = await getSession();
  try {
    const config = await rematchAllegroOfferCategory(session.user.id, offerId);
    revalidatePath(`/c/${collectionSlug}/offers/${offerId}`);
    return { status: "success", config };
  } catch (err) {
    return failed(err, "A category could not be matched for this offer.");
  }
}

/** Which listing profile this offer publishes with. `null` hands it back to the platform's default,
 *  which is a state rather than a gap. */
export async function setAllegroOfferProfileAction(
  collectionSlug: string,
  offerId: string,
  profileId: string | null
): Promise<AllegroListingConfigState> {
  const session = await getSession();
  try {
    const config = await setAllegroOfferProfile(session.user.id, offerId, profileId);
    revalidatePath(`/c/${collectionSlug}/offers/${offerId}`);
    return { status: "success", config };
  } catch (err) {
    return failed(err, "That listing profile could not be applied.");
  }
}

/** Re-read the card after a write elsewhere. */
export async function getAllegroOfferListingConfigAction(
  offerId: string
): Promise<AllegroListingConfigState> {
  const session = await getSession();
  try {
    return { status: "success", config: await getAllegroOfferListingConfig(session.user.id, offerId) };
  } catch (err) {
    return failed(err, "This offer's Allegro settings could not be read.");
  }
}
