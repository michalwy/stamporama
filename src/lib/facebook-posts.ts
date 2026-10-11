import "server-only";
import { prisma } from "./db";
import {
  detachFacebookLot,
  facebookGroupMixesTypes,
  readFacebookGroupSettings,
  setFrozenFacebookClosing,
} from "./facebook-auctions";
import {
  facebookPostLink,
  facebookPostRefusal,
  isFacebookLotPosted,
  type FacebookApprovalClosing,
} from "./facebook-post-rules";
import { OfferActionBlockedError, publishOffer, setOfferState } from "./offers";
import { isAuctionListing, normalizeListingType } from "./offer-rules";

// A post holding several lots in one Facebook group (#1544; ADR-0061 §2, §3).
//
// The lots are ordinary Facebook offers — auctions, or quick buys (#1671), of one type unless the
// group lets its posts mix them; what a post adds is that they go up **together**: one group, one
// closing time for its auctions, numbered in the order they were put in, and one activation that
// takes all of them live. The post's link is each lot's own listing link (#1668), given once when any lot is
// activated. An offer posted alone needs none of this; it is activated and its link recorded the way
// every other listing is published.
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

async function assertPostOwner(ownerId: string, postId: string): Promise<{ collectionId: string }> {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: { collectionId: true },
  });
  if (!post) throw new Error("Post not found.");
  await assertCollectionOwner(ownerId, post.collectionId);
  return post;
}

/**
 * Put several Facebook offers into one post, numbered as lots **in the order given** — the order
 * the collector ticked them is the order the album shows them.
 *
 * They must be offers in one group, in no other post, and not yet up (ADR-0061 §2): a lot of a post
 * goes up with the post. They share one listing type unless the group's posts may mix them (#1671).
 * The auctions' closing time becomes one — the first auction's that has one — since the lots of a
 * post close together; a quick buy closes at no time and keeps none.
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
      listingType: true,
      state: true,
      url: true,
      endsAt: true,
    },
  });
  if (rows.length !== ids.length) throw new Error("Offer not found or access denied.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lots = ids.map((id) => {
    const row = byId.get(id)!;
    return { ...row, listingType: normalizeListingType(row.listingType) };
  });
  const groupId = lots.find((l) => l.facebookGroupId !== null)?.facebookGroupId ?? null;
  const refusal = facebookPostRefusal(lots, {
    mixedListingTypes: groupId ? await facebookGroupMixesTypes(groupId) : false,
  });
  if (refusal) throw new OfferActionBlockedError("facebook-group", refusal);

  const auction = (l: (typeof lots)[number]) => isAuctionListing(l.listingType);
  const endsAt = lots.find((l) => auction(l) && l.endsAt !== null)?.endsAt ?? null;
  return prisma.$transaction(async (tx) => {
    const post = await tx.facebookPost.create({
      data: { collectionId, groupId: lots[0].facebookGroupId! },
      select: { id: true },
    });
    for (const [index, lot] of lots.entries()) {
      await tx.offer.update({
        where: { id: lot.id },
        data: { facebookPostId: post.id, facebookLotNo: index + 1, ...(auction(lot) ? { endsAt } : {}) },
      });
    }
    return { postId: post.id };
  });
}

/**
 * Take a lot out of its post before the post is up: the lots after it move up one, and a post left
 * with one lot is dissolved, that offer becoming a post of its own. Once one lot has gone up the lots
 * are what was posted, and stay.
 */
export async function removeFacebookLot(ownerId: string, offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, facebookPostId: true },
  });
  if (!offer) throw new Error("Offer not found or access denied.");
  await assertCollectionOwner(ownerId, offer.collectionId);
  if (!offer.facebookPostId) return;
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: offer.facebookPostId },
    select: { state: true },
  });
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError(
      "facebook-group",
      "The post is up, so its lots stay as they were posted. Withdraw this lot instead."
    );
  }
  await prisma.$transaction((tx) => detachFacebookLot(tx, offerId));
}

/**
 * Activate an offer with the listing link the collector pasted back (#1668) — for a Facebook offer
 * that is the post's link. An offer posted alone, and every offer off Facebook, is the ordinary
 * `publishOffer`; a lot of a post holding several takes the whole post live with it.
 *
 * `to` is `pending` when the post went to the group's administrator rather than straight up (#1778):
 * the link is then the pending post's. Approving a pending offer is this same call with `active`.
 */
export async function publishOfferOrPost(
  ownerId: string,
  offerId: string,
  url: string | null,
  to: "active" | "pending" = "active",
  endsAt?: Date | null
): Promise<void> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { facebookPostId: true } });
  // The auctions an approval may re-time (#1779), read before anything moves: once approved they are
  // no longer told apart from the post's lots that were already up.
  const approved =
    to === "active" && endsAt !== undefined ? await pendingFacebookAuctions(ownerId, offerId) : [];
  if (!offer?.facebookPostId) await publishOffer(ownerId, offerId, url, to);
  else await publishFacebookPost(ownerId, offer.facebookPostId, url, to);
  if (approved.length > 0) {
    await prisma.offer.updateMany({ where: { id: { in: approved } }, data: { endsAt } });
    // The post in the group is corrected to the closing time the approval states, so the text frozen
    // when it was submitted takes it too — and nothing else (#1800).
    await setFrozenFacebookClosing(approved, endsAt ?? null);
  }
}

/**
 * The Facebook auctions an approval takes up with this offer (#1779): the pending auction lots of
 * its post, or the offer itself when it is a pending auction posted alone. Empty off Facebook and for
 * a quick buy, which closes at no time.
 */
async function pendingFacebookAuctions(ownerId: string, offerId: string): Promise<string[]> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, facebookGroupId: true, facebookPostId: true },
  });
  if (!offer?.facebookGroupId) return [];
  await assertCollectionOwner(ownerId, offer.collectionId);
  const lots = await prisma.offer.findMany({
    where: {
      ...(offer.facebookPostId ? { facebookPostId: offer.facebookPostId } : { id: offerId }),
      state: "pending",
    },
    orderBy: { facebookLotNo: "asc" },
    select: { id: true, listingType: true },
  });
  return lots.filter((l) => isAuctionListing(normalizeListingType(l.listingType))).map((l) => l.id);
}

/**
 * What approving this offer asks about its closing time (#1779), or null when it asks nothing — off
 * Facebook, nothing pending, or no auction among what goes up. The closing time is the one the post's
 * auctions carry (they share it, #1544); the group's length and time of day are its settings **now**,
 * the ones a new auction there would be made with, so the browser can count them from today.
 */
export async function readFacebookApprovalClosing(
  ownerId: string,
  offerId: string
): Promise<FacebookApprovalClosing | null> {
  const auctions = await pendingFacebookAuctions(ownerId, offerId);
  if (auctions.length === 0) return null;
  const [first, offer] = await Promise.all([
    prisma.offer.findUniqueOrThrow({ where: { id: auctions[0] }, select: { endsAt: true } }),
    prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { facebookGroupId: true } }),
  ]);
  const settings = await readFacebookGroupSettings(offer.facebookGroupId!);
  return {
    endsAt: first.endsAt?.toISOString() ?? null,
    auctionDays: settings.auctionDays,
    closingTime: settings.closingTime,
  };
}

/**
 * Take a post holding several lots live (ADR-0061 §3, amended by #1668): the collector has posted the
 * kit by hand and pastes back where it went up.
 *
 * Each lot goes `ready → active` through the ordinary transition, so every gate an activation asks —
 * the price, a promised copy (#639), a copy in another Facebook auction (§5) — is asked of each. A lot
 * not yet Ready refuses the whole post, by number, before anything moves. A lot already active is
 * left as it is, so a refusal halfway through is finished by activating again. The link is written
 * last, once every lot is up, into **every lot with no listing link of its own** — a lot already
 * carrying its own photo's link keeps it. A blank link activates the lots and writes nothing, as it
 * does on every other platform.
 *
 * A post the group holds for approval (#1778) walks the same path twice. Submitted, `to` is `pending`:
 * each Ready lot goes `ready → pending` and the link is the pending post's. Approved, `to` is `active`:
 * each pending lot goes `pending → active`, and the final link replaces the post's pending link
 * ({@link facebookPostLink}) wherever a lot carries it, since that address is the one that moved; a
 * lot's own photo link is still left as it is.
 */
export async function publishFacebookPost(
  ownerId: string,
  postId: string,
  url: string | null,
  to: "active" | "pending" = "active"
): Promise<{ activated: number }> {
  await assertPostOwner(ownerId, postId);
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    orderBy: { facebookLotNo: "asc" },
    select: { id: true, offerNo: true, facebookLotNo: true, state: true, url: true },
  });
  // Where each lot may start from, and where it is already done: approving finishes a post that was
  // pending, and submitting one leaves a lot already pending where it is.
  const movable = to === "active" ? ["ready", "pending"] : ["ready"];
  const waiting = lots.filter((l) => !movable.includes(l.state) && l.state !== to);
  if (waiting.length > 0) {
    const named = waiting.map((l) => `lot ${l.facebookLotNo} (offer #${l.offerNo}, ${l.state})`).join(", ");
    throw new OfferActionBlockedError("bad-transition", `Every lot must be Ready before the post goes up: ${named}.`);
  }
  const approving = lots.some((l) => l.state === "pending") && to === "active";
  const pending = approving ? facebookPostLink(lots.filter((l) => l.state === "pending")) : null;
  let activated = 0;
  for (const lot of lots) {
    if (!movable.includes(lot.state)) continue;
    await setOfferState(ownerId, lot.id, to);
    activated += 1;
  }
  const link = url?.trim();
  if (link) {
    await prisma.offer.updateMany({
      where: {
        facebookPostId: postId,
        OR: [{ url: null }, { url: "" }, ...(approving && pending ? [{ url: pending }] : [])],
      },
      data: { url: link },
    });
  }
  return { activated };
}

/**
 * Record that a pending listing was **turned down** (#1778): `pending → ready`, the pending link
 * cleared. A lot of a post holding several takes the whole post back with it — the group approves or
 * rejects the post, not one lot of it — exactly as activating takes the whole post up.
 */
export async function rejectOfferOrPost(ownerId: string, offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { facebookPostId: true } });
  if (!offer?.facebookPostId) return setOfferState(ownerId, offerId, "ready");
  await assertPostOwner(ownerId, offer.facebookPostId);
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: offer.facebookPostId, state: "pending" },
    select: { id: true },
  });
  if (!lots.some((l) => l.id === offerId)) return setOfferState(ownerId, offerId, "ready");
  for (const lot of lots) await setOfferState(ownerId, lot.id, "ready");
}

/**
 * Withdraw an offer (#1779). A lot of a post still **waiting for approval** takes every pending lot of
 * the post with it — the post is taken back from the group, not one lot of it — exactly as approving
 * and rejecting do. A lot of a post that is up is withdrawn alone, as before: the post stays, and the
 * lot is simply no longer for sale. A lot already withdrawn with its post is left as it is, so a bulk
 * withdraw ticking several lots of one post reads as done rather than refused.
 */
export async function withdrawOfferOrPost(ownerId: string, offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { state: true, facebookPostId: true },
  });
  if (!offer?.facebookPostId) return setOfferState(ownerId, offerId, "withdrawn");
  await assertPostOwner(ownerId, offer.facebookPostId);
  if (offer.state === "withdrawn") return;
  if (offer.state !== "pending") return setOfferState(ownerId, offerId, "withdrawn");
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: offer.facebookPostId, state: "pending" },
    select: { id: true },
  });
  for (const lot of lots) await setOfferState(ownerId, lot.id, "withdrawn");
}
