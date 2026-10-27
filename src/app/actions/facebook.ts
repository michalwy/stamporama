"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import type {
  FacebookGroupValues,
  FacebookMultiLotLayout,
  FacebookPostingSettings,
} from "@/lib/facebook-group-rules";
import {
  createFacebookGroup,
  deleteFacebookGroup,
  setFacebookGroupArchived,
  updateFacebookDefaults,
  updateFacebookGroup,
} from "@/lib/facebook-groups";
import { listFacebookGroupChoices, type FacebookPlatformChoices } from "@/lib/facebook-auctions";
import {
  addFacebookLots,
  changeFacebookLotTitleWords,
  createFacebookPost,
  deleteFacebookPost,
  readFacebookPostDeletion,
  refreshFacebookPostTexts,
  regenerateFacebookLotTexts,
  removeFacebookLot,
  reorderFacebookLots,
  setFacebookPostLayout,
  setFacebookPostTitle,
  setFacebookPostTitleTemplate,
  takeFacebookPostBackToPreparing,
  takeFacebookPostBackToReady,
  type FacebookBackToReady,
  type FacebookLotsAdded,
} from "@/lib/facebook-posts";
import type { FacebookPostDeletion, FacebookTitleEdge, FacebookTitleWordsMode } from "@/lib/facebook-post-rules";
import { refreshFacebookGroupLotPhotos, refreshFacebookLotPhotos } from "@/lib/facebook-lot-photos";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";
import { lookupFacebookBuyer, type FacebookBuyerLookup } from "@/lib/facebook-sales";
import { createFacebookPostPreviewToken, revokeFacebookPostPreviewToken } from "@/lib/facebook-post-preview";
import { patchOffer } from "@/lib/offers";
import { assertCollectionOwner } from "@/lib/platform-category";

// Settings → Facebook (#1543; ADR-0061): the groups under the Facebook platform. The platform's own
// settings are `platforms.ts`' (#1955).
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

/** State the platform's own settings, which every group follows unless it holds its own (#1661). */
export async function updateFacebookDefaultsAction(
  collectionId: string,
  input: FacebookPostingSettings
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await updateFacebookDefaults(session.user.id, collectionId, input);
    // A post following them may have turned captioned, or away from it (#1861).
    await refreshFacebookLotPhotos(collectionId);
    kickOfferPhotoWorker();
    return { status: "success" };
  } catch (err) {
    return failure(err, "Facebook's settings could not be saved.");
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
    // A post following the group may have turned captioned, or away from it (#1861).
    await refreshFacebookGroupLotPhotos(groupId);
    kickOfferPhotoWorker();
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

// ── Offers in a group (#1544; ADR-0061 §2, §3; quick buys #1671) ─────────────────────────────────

/** Whether `platformId` is Facebook and which groups a new offer there may name — what the offer
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
  | { status: "success"; postId: string; postNo: number }
  | { status: "error"; message: string };

/** Put the ticked Facebook offers into one post, as lots in the order given, under its title (#1862). */
export async function createFacebookPostAction(
  collectionId: string,
  offerIds: string[],
  title: string
): Promise<FacebookPostActionState> {
  const session = await getSession();
  try {
    const { postId, postNo } = await createFacebookPost(session.user.id, collectionId, offerIds, title);
    kickOfferPhotoWorker(); // a captioned post's lot photos were queued (#1861)
    return { status: "success", postId, postNo };
  } catch (err) {
    return failure(err, "Failed to put the offers into one post.");
  }
}

export type FacebookLotsAddedState =
  | ({ status: "success" } & FacebookLotsAdded)
  | { status: "error"; message: string };

/** Add offers to a post not yet up as its next lots, in the order given (#1870). The ones that cannot
 *  join are named in `refused`; when none can, nothing is added and the error names them. */
export async function addFacebookLotsAction(postId: string, offerIds: string[]): Promise<FacebookLotsAddedState> {
  const session = await getSession();
  try {
    const result = await addFacebookLots(session.user.id, postId, offerIds);
    kickOfferPhotoWorker(); // a captioned post's new lots had their photos queued (#1861)
    return { status: "success", ...result };
  } catch (err) {
    return failure(err, "Failed to add the offers to the post.");
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

/** What deleting a post would take with it, and which lots are in the way (#2060). */
export async function readFacebookPostDeletionAction(
  postId: string
): Promise<({ status: "success" } & FacebookPostDeletion) | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", ...(await readFacebookPostDeletion(session.user.id, postId)) };
  } catch (err) {
    return failure(err, "Failed to read the post.");
  }
}

/** Delete a post together with every offer in it (#2060); refused while a lot has a sold set. */
export async function deleteFacebookPostAction(
  postId: string
): Promise<{ status: "success"; postNo: number; offerCount: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    return { status: "success", ...(await deleteFacebookPost(session.user.id, postId)) };
  } catch (err) {
    return failure(err, "Failed to delete the post.");
  }
}

/** Take a post that is up back to Ready (#1998), asked of any lot of it: the lots still for sale go
 *  back, into a new post when lots sold or withdrawn stay behind. */
export async function takeFacebookPostBackToReadyAction(
  offerId: string
): Promise<({ status: "success" } & FacebookBackToReady) | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const moved = await takeFacebookPostBackToReady(session.user.id, offerId);
    kickOfferPhotoWorker(); // a captioned post's lot photos may have been queued (#1861)
    return { status: "success", ...moved };
  } catch (err) {
    return failure(err, "Failed to take the post back to Ready.");
  }
}

/** Take a post not yet up back to Preparing (#2115): every Ready lot of it, as its own *Back to
 *  preparing* would. */
export async function takeFacebookPostBackToPreparingAction(
  postId: string
): Promise<{ status: "success"; count: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const count = await takeFacebookPostBackToPreparing(session.user.id, postId);
    return { status: "success", count };
  } catch (err) {
    return failure(err, "Failed to take the post back to Preparing.");
  }
}

/** Put a post's lots in a new order (#1986): every lot's offer id, in the order to number them. */
export async function reorderFacebookLotsAction(postId: string, offerIds: string[]): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await reorderFacebookLots(session.user.id, postId, offerIds);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to put the lots in the new order.");
  }
}

/** Give a post of several lots its title, or another one (#1862). */
export async function setFacebookPostTitleAction(postId: string, title: string): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await setFacebookPostTitle(session.user.id, postId, title);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to save the post's title.");
  }
}

/** Re-render a post's lots' titles and descriptions after a translation was entered on its screen
 *  (#1889), so its text and captions read the new name at once. */
export async function refreshFacebookPostTextsAction(postId: string): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await refreshFacebookPostTexts(session.user.id, postId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to bring the post's text up to date.");
  }
}

/** *Regenerate lot texts* on a post's screen (#1983): the lots' titles and descriptions from their
 *  templates, the ticked hand-written ones replaced too. */
export async function regenerateFacebookLotTextsAction(
  postId: string,
  offerIds: string[],
  overwrite: string[]
): Promise<{ status: "success"; count: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const count = await regenerateFacebookLotTexts(session.user.id, postId, offerIds, overwrite);
    return { status: "success", count };
  } catch (err) {
    return failure(err, "Failed to regenerate the lots' texts.");
  }
}

/** *Title template for all lots…* on a post's screen (#2033): every lot's own title template, and
 *  their titles regenerated from it — the ticked hand-written ones too. */
export async function setFacebookPostTitleTemplateAction(
  postId: string,
  template: string,
  overwrite: string[]
): Promise<{ status: "success"; count: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const count = await setFacebookPostTitleTemplate(session.user.id, postId, template, overwrite);
    return { status: "success", count };
  } catch (err) {
    return failure(err, "Failed to give the lots the title template.");
  }
}

/** *Add to titles…* / *Remove from titles…* on a post's screen (#2033). */
export async function changeFacebookLotTitleWordsAction(
  postId: string,
  words: string,
  edge: FacebookTitleEdge,
  mode: FacebookTitleWordsMode
): Promise<{ status: "success"; count: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    if ((edge !== "start" && edge !== "end") || (mode !== "add" && mode !== "remove")) {
      return { status: "error", message: "Choose where the words go." };
    }
    const count = await changeFacebookLotTitleWords(session.user.id, postId, words, edge, mode);
    return { status: "success", count };
  } catch (err) {
    return failure(err, "Failed to change the lots' titles.");
  }
}

/** Lay a post of several lots out its own way (#1841), or follow its group's again with null. */
export async function setFacebookPostLayoutAction(
  postId: string,
  layout: FacebookMultiLotLayout | null
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await setFacebookPostLayout(session.user.id, postId, layout);
    kickOfferPhotoWorker(); // captioned now, its lot photos were queued (#1861)
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to change how the post is laid out.");
  }
}

/** Give a Facebook offer its own post template (#1780), or hand it back to its group's with null. The
 *  text is kept as written — an empty one is the offer's own, not the group's. */
export async function setFacebookOfferTemplateAction(
  offerId: string,
  template: string | null
): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await patchOffer(session.user.id, offerId, { facebookPostTemplate: template });
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to save the offer's post template.");
  }
}

// ── The buyer (#1777; ADR-0061 §4) ────────────────────────────────────────────────────────────────

/** Who the buyer typed into a Facebook offer's *Sell* is — read while the sale form is filled in; the
 *  save resolves them the same way (`resolveFacebookBuyer`). */
export async function lookupFacebookBuyerAction(
  collectionId: string,
  name: string,
  profileUrl: string
): Promise<FacebookBuyerLookup> {
  const session = await getSession();
  await assertCollectionOwner(session.user.id, collectionId);
  return lookupFacebookBuyer(collectionId, { name, profileUrl });
}

// ── The buyer's preview of a post (#2212) ─────────────────────────────────────────────────────────

export type FacebookPostPreviewLinkActionState =
  | { status: "success"; token: string }
  | { status: "error"; message: string };

/** Generate the post's preview link, replacing any it had — a post has one link, and asking for a new
 *  one is asking for the old one to stop working. */
export async function createFacebookPostPreviewLinkAction(postId: string): Promise<FacebookPostPreviewLinkActionState> {
  const session = await getSession();
  try {
    const { token } = await createFacebookPostPreviewToken(session.user.id, postId);
    return { status: "success", token };
  } catch (err) {
    return failure(err, "Failed to create the link. Please try again.");
  }
}

/** Withdraw the link: from then on its address shows nothing of the post. */
export async function revokeFacebookPostPreviewLinkAction(postId: string): Promise<FacebookActionState> {
  const session = await getSession();
  try {
    await revokeFacebookPostPreviewToken(session.user.id, postId);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Failed to withdraw the link. Please try again.");
  }
}
