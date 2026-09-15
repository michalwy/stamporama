"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { parseSnapshotRequest } from "@/lib/annotations";
import { saveAnnotatedSnapshot, type SnapshotOwner } from "@/lib/photo-snapshot";
import { PhotoAuthError, PhotoValidationError } from "@/lib/photos";
import {
  getStampSizeSources,
  StampMeasuredSizeError,
  writeMeasuredStampSize,
  type MeasuredSizeWriteResult,
  type StampSizeSources,
} from "@/lib/stamp-measured-size";

// The two writes the viewer makes (#674, #1290): a marked-up detail kept as a photo, and a size
// measured on a picture written onto its stamp. Everything else the viewer does is looking.
//
// The size write is also the page editor's for one box (#1309), whether the figures were measured,
// filled from a preset or typed: the gate — a stated size is never replaced silently — is the same
// whichever way they were arrived at, and there is no *measured* flag to tell them apart (#763).

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export type SnapshotActionState =
  | { status: "success"; owner: SnapshotOwner }
  | { status: "error"; message: string };

export async function saveAnnotatedSnapshotAction(
  collectionId: string,
  request: unknown
): Promise<SnapshotActionState> {
  const session = await getSession();
  const parsed = parseSnapshotRequest(request);
  if (!parsed) return { status: "error", message: "That snapshot could not be read." };
  try {
    const { owner } = await saveAnnotatedSnapshot(session.user.id, collectionId, parsed);
    return { status: "success", owner };
  } catch (err) {
    if (err instanceof PhotoAuthError || err instanceof PhotoValidationError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to save the snapshot. Please try again." };
  }
}

export type MeasuredSizeActionState = MeasuredSizeWriteResult | { status: "error"; message: string };

export async function setMeasuredStampSizeAction(
  stampId: string,
  widthMm: number,
  heightMm: number,
  replace: boolean
): Promise<MeasuredSizeActionState> {
  const session = await getSession();
  if (typeof widthMm !== "number" || typeof heightMm !== "number") {
    return { status: "error", message: "That is not a size a stamp can have." };
  }
  try {
    return await writeMeasuredStampSize(session.user.id, stampId, { widthMm, heightMm }, replace === true);
  } catch (err) {
    if (err instanceof StampMeasuredSizeError) return { status: "error", message: err.message };
    return { status: "error", message: "Failed to save the size. Please try again." };
  }
}

export type StampSizeSourcesActionState =
  | { status: "success"; sources: StampSizeSources }
  | { status: "error"; message: string };

/** What the page editor's box panel needs to set a stamp's size (#1309). */
export async function getStampSizeSourcesAction(
  stampId: string
): Promise<StampSizeSourcesActionState> {
  const session = await getSession();
  try {
    return { status: "success", sources: await getStampSizeSources(session.user.id, stampId) };
  } catch (err) {
    if (err instanceof StampMeasuredSizeError || err instanceof PhotoAuthError) {
      return { status: "error", message: err.message };
    }
    return { status: "error", message: "Failed to read the stamp's size. Please try again." };
  }
}
