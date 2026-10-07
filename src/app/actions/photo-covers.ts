"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { PhotoCoverValidationError, savePhotoCovers, type PhotoCoverState } from "@/lib/photo-covers";

// The one write of covering symbols (#1665): a copy photo's covers replaced whole, which also marks
// it checked. An empty list is *nothing to cover*.

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
