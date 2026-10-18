"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  CopiesCollageError,
  getCollagePlatformSeed,
  makeCopiesCollage,
  type CollagePlatformSeed,
  type CopiesCollageResult,
} from "@/lib/copies-collage";
import { normalizeCollagePackaging } from "@/lib/copies-collage-rules";
import { parseOfferPhotoConfigInput, readPhotoConfigFields } from "@/lib/offer-photo-config";

// The one-off collage of ticked copies (#2052). A refusal the collector can act on — no template, no
// platform — comes back as a message; anything else is reported as a failure to make it.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

type Failure = { status: "error"; message: string };

function failure(err: unknown, fallback: string): Failure {
  if (!(err instanceof CopiesCollageError)) console.error("[copies-collage]", err);
  return { status: "error", message: err instanceof CopiesCollageError ? err.message : fallback };
}

/** The photo settings a collage starts from on a platform: what a new offer there would carry. */
export async function getCollagePlatformSeedAction(
  collectionId: string,
  platformId: string
): Promise<{ status: "success"; seed: CollagePlatformSeed } | Failure> {
  const session = await getSession();
  try {
    return { status: "success", seed: await getCollagePlatformSeed(session.user.id, collectionId, platformId) };
  } catch (err) {
    return failure(err, "Failed to read the platform's photo settings.");
  }
}

/** Make the collage from the dialog's form: its photo settings, plus `itemId` once per ticked copy,
 *  `platformId` and `packaging`. Nothing is stored; the images come back in the answer. */
export async function makeCopiesCollageAction(
  collectionId: string,
  formData: FormData
): Promise<{ status: "success"; result: CopiesCollageResult } | Failure> {
  const session = await getSession();
  const str = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = parseOfferPhotoConfigInput(readPhotoConfigFields(str));
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const itemIds = formData.getAll("itemId").filter((v): v is string => typeof v === "string" && v !== "");
  if (itemIds.length === 0) return { status: "error", message: "Tick the copies to make a collage of." };
  try {
    return {
      status: "success",
      result: await makeCopiesCollage(session.user.id, collectionId, {
        itemIds,
        platformId: str("platformId"),
        packaging: normalizeCollagePackaging(str("packaging")),
        config: parsed.value,
      }),
    };
  } catch (err) {
    return failure(err, "Failed to make the collage.");
  }
}
