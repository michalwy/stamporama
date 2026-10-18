"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { parsePostPhotoSettingsPatch } from "@/lib/facebook-post-photo-settings-rules";
import {
  getFacebookPostPhotoSettings,
  updateFacebookPostPhotoSettings,
  type FacebookPostPhotoSettings,
} from "@/lib/facebook-post-photo-settings";
import { readPhotoConfigFields } from "@/lib/offer-photo-config";

// A post's *Photo settings…* (#2032). Like the other Facebook actions, a refusal is reported as a
// message rather than thrown: the post is up, a number out of range.

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** What the post's photo-settings dialog opens on: each setting shared by every lot, or differing. */
export async function getFacebookPostPhotoSettingsAction(
  postId: string
): Promise<{ status: "success"; settings: FacebookPostPhotoSettings } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", settings: await getFacebookPostPhotoSettings(session.user.id, postId) };
  } catch (err) {
    return failure(err, "Failed to read the lots' photo settings.");
  }
}

/** Write the settings the dialog changed to every lot of the post. Answers the lots whose settings
 *  changed, for the regeneration the dialog asks for next. */
export async function updateFacebookPostPhotoSettingsAction(
  postId: string,
  formData: FormData
): Promise<{ status: "success"; changed: string[] } | { status: "error"; message: string }> {
  const session = await getSession();
  const str = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const changed = formData.getAll("changed").filter((v): v is string => typeof v === "string");
  const parsed = parsePostPhotoSettingsPatch(
    readPhotoConfigFields(str),
    changed,
    formData.has("collagePairSides") ? str("collagePairSides") : null
  );
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    return { status: "success", changed: await updateFacebookPostPhotoSettings(session.user.id, postId, parsed.value) };
  } catch (err) {
    return failure(err, "Failed to save the lots' photo settings.");
  }
}
