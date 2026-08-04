"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  AllegroPublishBlockedError,
  activateAllegroDraft,
  getAllegroPublishPlan,
  publishOfferToAllegro,
  type AllegroPublishPlan,
  type AllegroPublishResult,
} from "@/lib/allegro-publish";
import type { AllegroPublishBlocker, AllegroPublicationStatus } from "@/lib/allegro-publish-rules";
import { AllegroApiError } from "@/lib/allegro-api";

// Publishing an offer to Allegro (#477; ADR-0027) — the three calls the offer's own screen makes.
//
// Every one of them **returns** its failure rather than throwing, exactly as #486's and #488's do: a
// connection that is down, a profile that was deleted and a listing Allegro refused are all ordinary
// things to say in a dialog, not crashed screens. A refusal named before the request keeps its
// blockers as a list — each is fixed somewhere different, and flattening them into one sentence is
// what makes a collector fix one fault at a time.

export type AllegroPublishActionState =
  | { status: "success"; result: AllegroPublishResult }
  | { status: "blocked"; blockers: AllegroPublishBlocker[] }
  | {
      status: "error";
      message: string;
      /** Allegro's own `errors[]`, one line per field it objected to. A validation refusal is a
       *  *list* of faults, and flattening it into one sentence is what made "Request contains
       *  invalid data" the only thing the collector ever saw. */
      details?: string[];
    };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function toState(err: unknown, fallback: string): AllegroPublishActionState {
  if (err instanceof AllegroPublishBlockedError) {
    return { status: "blocked", blockers: err.blockers };
  }
  if (err instanceof AllegroApiError && err.details.length > 0) {
    return {
      status: "error",
      message: `Allegro refused the listing (HTTP ${err.status ?? "?"}).`,
      details: [
        ...new Set(err.details.map((d) => (d.path ? `${d.path} — ${d.text}` : d.text))),
      ],
    };
  }
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** Whether this offer can be published, and what it would go out as — what the dialog opens on. */
export async function getAllegroPublishPlanAction(
  collectionId: string,
  offerId: string
): Promise<
  { status: "success"; plan: AllegroPublishPlan | null } | { status: "error"; message: string }
> {
  const session = await getSession();
  try {
    return {
      status: "success",
      plan: await getAllegroPublishPlan(session.user.id, collectionId, offerId),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "This offer's Allegro readiness could not be read.",
    };
  }
}

/**
 * Publish the offer — as a draft left in the account for a last look, or live.
 *
 * The **only** thing the dialog decides is which of the two. The category, its parameter answers and
 * the listing profile are read from the offer (#494), where they were set and can be corrected, so
 * both listing paths post the same values and neither has a second opinion.
 */
export async function publishOfferToAllegroAction(
  collectionSlug: string,
  collectionId: string,
  offerId: string,
  publication: AllegroPublicationStatus
): Promise<AllegroPublishActionState> {
  const session = await getSession();
  try {
    const result = await publishOfferToAllegro(session.user.id, collectionId, offerId, {
      publication,
    });
    revalidatePath(`/c/${collectionSlug}/offers/${offerId}`);
    return { status: "success", result };
  } catch (err) {
    return toState(err, "This offer could not be published to Allegro.");
  }
}

/** Take a draft live — the second half of the draft path, from the same place it was created. */
export async function activateAllegroDraftAction(
  collectionSlug: string,
  collectionId: string,
  offerId: string
): Promise<AllegroPublishActionState> {
  const session = await getSession();
  try {
    const result = await activateAllegroDraft(session.user.id, collectionId, offerId);
    revalidatePath(`/c/${collectionSlug}/offers/${offerId}`);
    return { status: "success", result };
  } catch (err) {
    return toState(err, "This Allegro draft could not be activated.");
  }
}
