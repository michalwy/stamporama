"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import type { FacebookTitleEdge, FacebookTitleWordsMode } from "@/lib/facebook-post-rules";
import { parsePostPhotoSettingsPatch } from "@/lib/facebook-post-photo-settings-rules";
import { parseLotGroup } from "@/lib/offer-lot-group-rules";
import {
  changeLotGroupTitleWords,
  getLotGroupPhotoSettings,
  regenerateLotGroupTexts,
  reorderLotGroup,
  setLotGroupTitleTemplate,
  updateLotGroupPhotoSettings,
  type LotGroupPhotoSettings,
} from "@/lib/offer-lot-groups";
import { readPhotoConfigFields } from "@/lib/offer-photo-config";

// The tools a group of lots is worked on with from its screen (#2313) — a Facebook post's, or a
// proposal's: photo settings (#2032), texts (#1983), titles (#2033) and order (#1986). Each names the
// group it works on; the server checks it is the caller's and may still change. A refusal is reported
// as a message rather than thrown: the post is up, the proposal sent, a number out of range.

type Failure = { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, fallback: string): Failure {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

const NO_GROUP: Failure = { status: "error", message: "Those lots could not be found." };

/** What the group's photo-settings dialog opens on: each setting shared by every lot, or differing. */
export async function getLotGroupPhotoSettingsAction(
  rawGroup: unknown
): Promise<{ status: "success"; settings: LotGroupPhotoSettings } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
  try {
    return { status: "success", settings: await getLotGroupPhotoSettings(session.user.id, group) };
  } catch (err) {
    return failure(err, "Failed to read the lots' photo settings.");
  }
}

/** Write the settings the dialog changed to every lot of the group. Answers the lots whose settings
 *  changed, for the regeneration the dialog asks for next. */
export async function updateLotGroupPhotoSettingsAction(
  rawGroup: unknown,
  formData: FormData
): Promise<{ status: "success"; changed: string[] } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
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
    return { status: "success", changed: await updateLotGroupPhotoSettings(session.user.id, group, parsed.value) };
  } catch (err) {
    return failure(err, "Failed to save the lots' photo settings.");
  }
}

/** *Regenerate lot texts…* (#1983): the lots' titles and descriptions from their templates, the ticked
 *  hand-written ones replaced too. */
export async function regenerateLotGroupTextsAction(
  rawGroup: unknown,
  offerIds: string[],
  overwrite: string[]
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
  try {
    return { status: "success", count: await regenerateLotGroupTexts(session.user.id, group, offerIds, overwrite) };
  } catch (err) {
    return failure(err, "Failed to regenerate the lots' texts.");
  }
}

/** *Title template for all lots…* (#2033): every lot's own title template, and their titles
 *  regenerated from it — the ticked hand-written ones too. */
export async function setLotGroupTitleTemplateAction(
  rawGroup: unknown,
  template: string,
  overwrite: string[]
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
  try {
    return { status: "success", count: await setLotGroupTitleTemplate(session.user.id, group, template, overwrite) };
  } catch (err) {
    return failure(err, "Failed to give the lots the title template.");
  }
}

/** *Add to titles…* / *Remove from titles…* (#2033). */
export async function changeLotGroupTitleWordsAction(
  rawGroup: unknown,
  words: string,
  edge: FacebookTitleEdge,
  mode: FacebookTitleWordsMode
): Promise<{ status: "success"; count: number } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
  if ((edge !== "start" && edge !== "end") || (mode !== "add" && mode !== "remove")) {
    return { status: "error", message: "Choose where the words go." };
  }
  try {
    return { status: "success", count: await changeLotGroupTitleWords(session.user.id, group, words, edge, mode) };
  } catch (err) {
    return failure(err, "Failed to change the lots' titles.");
  }
}

/** Put the group's lots in a new order (#1986): every lot's offer id, in the order to number them. */
export async function reorderLotGroupAction(
  rawGroup: unknown,
  offerIds: string[]
): Promise<{ status: "success" } | Failure> {
  const session = await getSession();
  const group = parseLotGroup(rawGroup);
  if (!group) return NO_GROUP;
  try {
    await reorderLotGroup(session.user.id, group, offerIds);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to put the lots in the new order.");
  }
}
