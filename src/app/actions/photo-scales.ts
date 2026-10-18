"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { PhotoValidationError } from "@/lib/photos";
import {
  countUnscaledCopyPhotos,
  giveUnscaledCopyPhotosScale,
  PhotoScaleError,
  setCopyPhotoScales,
} from "@/lib/photo-scales";

// The writes of a copy photo's scale (#2061): one copy's photos from its Photos card, and the
// ticked copies' photos that have none from the Copies list.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

type Failure = { status: "error"; message: string };

function failure(err: unknown, fallback: string): Failure {
  if (err instanceof PhotoScaleError || err instanceof PhotoValidationError) {
    return { status: "error", message: err.message };
  }
  console.error("[photo-scales]", err);
  return { status: "error", message: fallback };
}

export async function setCopyPhotoScalesAction(
  itemId: string,
  changes: { photoId: string; scale: unknown }[]
): Promise<{ status: "success" } | Failure> {
  const session = await getSession();
  try {
    await setCopyPhotoScales(session.user.id, itemId, changes);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to save the scales. Please try again.");
  }
}

export async function countUnscaledCopyPhotosAction(
  collectionId: string,
  itemIds: string[]
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  try {
    return { status: "success", count: await countUnscaledCopyPhotos(session.user.id, collectionId, itemIds) };
  } catch (err) {
    return failure(err, "Failed to count the photos.");
  }
}

export async function giveUnscaledCopyPhotosScaleAction(
  collectionId: string,
  itemIds: string[],
  scale: unknown
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  try {
    return {
      status: "success",
      count: await giveUnscaledCopyPhotosScale(session.user.id, collectionId, itemIds, scale),
    };
  } catch (err) {
    return failure(err, "Failed to give the photos a scale. Please try again.");
  }
}
