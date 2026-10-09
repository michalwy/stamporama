"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { PhotoCoverValidationError, savePhotoCovers, type PhotoCoverState } from "@/lib/photo-covers";
import { markOfferPhotosNothingToCover, OfferPhotoGenerationError } from "@/lib/offer-photo-generation";

// The writes of covering symbols (#1665): a copy photo's covers replaced whole, which also marks it
// checked — an empty list is *nothing to cover* — and that same *nothing to cover* recorded on an
// offer's unchecked photos in one action (#1701).

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export type PhotoCoversActionState =
  | { status: "success"; state: PhotoCoverState }
  | { status: "error"; message: string };

export async function savePhotoCoversAction(
  photoId: string,
  covers: unknown
): Promise<PhotoCoversActionState> {
  const session = await getSession();
  try {
    return { status: "success", state: await savePhotoCovers(session.user.id, photoId, covers) };
  } catch (err) {
    if (err instanceof PhotoCoverValidationError) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to save the covers. Please try again." };
  }
}

export type NothingToCoverActionState =
  | { status: "success"; photoIds: string[] }
  | { status: "error"; message: string };

/** Mark the offer's unchecked photos *nothing to cover* (#1701) — all of them, or with `itemId` only
 *  that copy's. */
export async function markOfferNothingToCoverAction(
  offerId: string,
  itemId: string | null
): Promise<NothingToCoverActionState> {
  const session = await getSession();
  try {
    return {
      status: "success",
      photoIds: await markOfferPhotosNothingToCover(session.user.id, offerId, itemId),
    };
  } catch (err) {
    if (err instanceof OfferPhotoGenerationError) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to mark the photos. Please try again." };
  }
}
