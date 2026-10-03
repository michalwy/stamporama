import "server-only";
import { prisma } from "./db";
import { detachFacebookLot } from "./facebook-auctions";
import { facebookPostRefusal } from "./facebook-post-rules";
import { isFacebookGroupUrl } from "./facebook-group-rules";
import { OfferActionBlockedError, setOfferState } from "./offers";

// A post holding several lots in one Facebook group (#1544; ADR-0061 §2, §3).
//
// The lots are ordinary Facebook auction offers; what a post adds is that they go up **together**:
// one group, one closing time, numbered in the order they were put in, and one link that — pasted
// once the post is up — activates all of them. An offer posted alone needs none of this; its own
// header records its link and activates it the way every other listing is published.
//
// This module sits on the far side of `offers.ts` (it goes through `setOfferState`, so every gate an
// activation asks is asked of each lot); `facebook-auctions.ts` is the half `offers.ts` imports.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

async function assertPostOwner(
  ownerId: string,
  postId: string
): Promise<{ collectionId: string; groupId: string; url: string | null }> {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: { collectionId: true, groupId: true, url: true },
  });
  if (!post) throw new Error("Post not found.");
  await assertCollectionOwner(ownerId, post.collectionId);
  return post;
}

/**
 * Put several Facebook auctions into one post, numbered as lots **in the order given** — the order
 * the collector ticked them is the order the album shows them.
 *
 * They must be auctions in one group, in no other post, and not yet up (ADR-0061 §2): a lot of a post
 * goes up with the post. Their closing time becomes one — the first lot's that has one — since the
 * lots of a post close together.
 */
export async function createFacebookPost(
  ownerId: string,
  collectionId: string,
  offerIds: readonly string[]
): Promise<{ postId: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const ids = [...new Set(offerIds)];
  const rows = await prisma.offer.findMany({
    where: { id: { in: ids }, collectionId },
    select: {
      id: true,
      offerNo: true,
      facebookGroupId: true,
      facebookPostId: true,
      state: true,
      url: true,
      endsAt: true,
    },
  });
  if (rows.length !== ids.length) throw new Error("Offer not found or access denied.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lots = ids.map((id) => byId.get(id)!);
  const refusal = facebookPostRefusal(lots);
  if (refusal) throw new OfferActionBlockedError("facebook-group", refusal);

  const endsAt = lots.find((l) => l.endsAt !== null)?.endsAt ?? null;
  return prisma.$transaction(async (tx) => {
    const post = await tx.facebookPost.create({
      data: { collectionId, groupId: lots[0].facebookGroupId! },
      select: { id: true },
    });
    for (const [index, lot] of lots.entries()) {
      await tx.offer.update({
        where: { id: lot.id },
        data: { facebookPostId: post.id, facebookLotNo: index + 1, endsAt },
      });
    }
    return { postId: post.id };
  });
}

/**
 * Take a lot out of its post before the post is up: the lots after it move up one, and a post left
 * with one lot is dissolved, that offer becoming a post of its own. Once the post's link is recorded
 * its lots are what was posted, and stay.
 */
export async function removeFacebookLot(ownerId: string, offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, facebookPost: { select: { url: true } } },
  });
  if (!offer) throw new Error("Offer not found or access denied.");
  await assertCollectionOwner(ownerId, offer.collectionId);
  if (!offer.facebookPost) return;
  if (offer.facebookPost.url) {
    throw new OfferActionBlockedError(
      "facebook-group",
      "The post is up, so its lots stay as they were posted. Withdraw this lot instead."
    );
  }
  await prisma.$transaction((tx) => detachFacebookLot(tx, offerId));
}

/**
 * Record the post's link, which activates its lots (ADR-0061 §3): the collector has posted the kit by
 * hand and pastes back where it went up.
 *
 * Each lot goes `ready → active` through the ordinary transition, so every gate an activation asks —
 * the price, a promised copy (#639), a copy in another Facebook auction (§5) — is asked of each. A lot
 * not yet Ready refuses the whole post, by number, before anything moves. A lot already active is
 * left as it is, so a refusal halfway through is finished by pasting the link again; the link itself
 * is written last, once every lot is up. On a post already up, pasting again corrects the link.
 */
export async function recordFacebookPostLink(
  ownerId: string,
  postId: string,
  rawUrl: string
): Promise<{ activated: number }> {
  const post = await assertPostOwner(ownerId, postId);
  const url = rawUrl.trim();
  if (!url) throw new OfferActionBlockedError("no-url", "Paste the post's link.");
  if (!isFacebookGroupUrl(url)) {
    throw new OfferActionBlockedError("no-url", "The link must be a web address, starting with https://.");
  }
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    orderBy: { facebookLotNo: "asc" },
    select: { id: true, offerNo: true, facebookLotNo: true, state: true },
  });
  if (post.url === null) {
    const waiting = lots.filter((l) => l.state !== "ready" && l.state !== "active");
    if (waiting.length > 0) {
      const named = waiting.map((l) => `lot ${l.facebookLotNo} (offer #${l.offerNo}, ${l.state})`).join(", ");
      throw new OfferActionBlockedError(
        "bad-transition",
        `Every lot must be Ready before the post goes up: ${named}.`
      );
    }
  }
  let activated = 0;
  for (const lot of lots) {
    if (lot.state !== "ready") continue;
    await setOfferState(ownerId, lot.id, "active");
    activated += 1;
  }
  await prisma.facebookPost.update({ where: { id: postId }, data: { url } });
  return { activated };
}
