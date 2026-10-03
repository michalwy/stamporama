"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { setFacebookPlatform } from "@/lib/facebook";
import type { FacebookGroupValues } from "@/lib/facebook-group-rules";
import {
  createFacebookGroup,
  deleteFacebookGroup,
  setFacebookGroupArchived,
  updateFacebookGroup,
} from "@/lib/facebook-groups";
import { listFacebookGroupChoices, type FacebookPlatformChoices } from "@/lib/facebook-auctions";
import { createFacebookPost, recordFacebookPostLink, removeFacebookLot } from "@/lib/facebook-posts";

// Settings → Facebook (#1543; ADR-0061): which platform contact is Facebook, and the groups under it.
//
// Every action reports a message rather than throwing, the Delcampe actions' rule: they are driven
// from one settings page, where a refusal — a duplicate name, a group with offers that cannot be
// deleted — is an ordinary thing to state and not a crashed screen.

export type FacebookActionState = { status: "success" } | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

function failure(err: unknown, fallback: string): { status: "error"; message: string } {
  return { status: "error", message: err instanceof Error ? err.message : fallback };
}

/** Point the Facebook page at one platform contact, or clear it with an empty id. */
export async function setFacebookPlatformAction(
  collectionId: string,
  contactId: string
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await setFacebookPlatform(session.user.id, collectionId, contactId || null);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The Facebook platform could not be set.");
  }
}

export async function createFacebookGroupAction(
  collectionId: string,
  input: FacebookGroupValues
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await createFacebookGroup(session.user.id, collectionId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The group could not be saved.");
  }
}

export async function updateFacebookGroupAction(
  groupId: string,
  input: FacebookGroupValues
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await updateFacebookGroup(session.user.id, groupId, input);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The group could not be saved.");
  }
}

/** Archive a group, or bring an archived one back. */
export async function setFacebookGroupArchivedAction(
  groupId: string,
  archived: boolean
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await setFacebookGroupArchived(session.user.id, groupId, archived);
    return { status: "success" };
  } catch (err) {
    return failure(err, archived ? "The group could not be archived." : "The group could not be restored.");
  }
}

/** Delete a group no offer names. One with offers is refused, with the reason. */
export async function deleteFacebookGroupAction(groupId: string): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await deleteFacebookGroup(session.user.id, groupId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "The group could not be deleted.");
  }
}

// ── Auctions in a group (#1544; ADR-0061 §2, §3) ────────────────────────────────────────────────

/** Whether `platformId` is Facebook and which groups a new auction there may name — what the offer
 *  form asks when a platform is picked. `includeGroupId` keeps an edited offer's own archived group. */
export async function facebookGroupChoicesAction(
  collectionId: string,
  platformId: string,
  includeGroupId: string | null
): Promise<FacebookPlatformChoices> {
  const session = await getSession();
  return listFacebookGroupChoices(session.user.id, collectionId, platformId, includeGroupId);
}

export type FacebookPostActionState =
  | { status: "success"; postId: string }
  | { status: "error"; message: string };

/** Put the ticked Facebook auctions into one post, as lots in the order given. */
export async function createFacebookPostAction(
  collectionId: string,
  offerIds: string[]
): Promise<FacebookPostActionState> {
  const session = await getSession();
  try {
    const { postId } = await createFacebookPost(session.user.id, collectionId, offerIds);
    return { status: "success", postId };
  } catch (err) {
    return failure(err, "Failed to put the offers into one post.");
  }
}

/** Take a lot out of its post, before the post is up. */
export async function removeFacebookLotAction(offerId: string): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await removeFacebookLot(session.user.id, offerId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to take the lot out of its post.");
  }
}

export type FacebookPostLinkState =
  | { status: "success"; activated: number }
  | { status: "error"; message: string };

/** Record a multi-lot post's link, which activates its lots. */
export async function recordFacebookPostLinkAction(
  postId: string,
  url: string
): Promise<FacebookPostLinkState> {
  const session = await getSession();
  try {
    const { activated } = await recordFacebookPostLink(session.user.id, postId, url);
    return { status: "success", activated };
  } catch (err) {
    return failure(err, "Failed to record the post's link.");
  }
}
