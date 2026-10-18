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
  readScaleListPhotos,
  setCollectionPhotoScales,
  setCopyPhotoScales,
  type ScaleListPhotos,
} from "@/lib/photo-scales";

// The writes of a copy photo's scale (#2061): one copy's photos from its Photos card, the ticked
// copies' photos never given one from the Copies list, and the photos an offer's images lack a scale
// for from its Photos card or a one-off collage (#2067).

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

export async function readScaleListPhotosAction(
  collectionId: string,
  photoIds: string[]
): Promise<{ status: "success"; result: ScaleListPhotos } | Failure> {
  const session = await getSession();
  try {
    return { status: "success", result: await readScaleListPhotos(session.user.id, collectionId, photoIds) };
  } catch (err) {
    return failure(err, "Failed to read the photos.");
  }
}

export async function setCollectionPhotoScalesAction(
  collectionId: string,
  changes: { photoId: string; scale: unknown }[]
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  try {
    return { status: "success", count: await setCollectionPhotoScales(session.user.id, collectionId, changes) };
  } catch (err) {
    return failure(err, "Failed to save the scales. Please try again.");
  }
}
