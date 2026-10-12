import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  detachFacebookLot,
  facebookGroupMixesTypes,
  facebookPostLayout,
  getFacebookOfferKit,
  type FacebookOfferKit,
  readFacebookGroupSettings,
  setFrozenFacebookClosing,
} from "./facebook-auctions";
import { FACEBOOK_MULTI_LOT_LAYOUTS, type FacebookMultiLotLayout } from "./facebook-group-rules";
import { pruneFacebookLotPhotos, syncFacebookPostLotPhotos } from "./facebook-lot-photos";
import {
  facebookPostLink,
  facebookPostRefusal,
  facebookPostStage,
  facebookPostTitleRefusal,
  isFacebookLotPosted,
  type FacebookApprovalClosing,
  type FacebookPostStage,
} from "./facebook-post-rules";
import { allocateEntityNumber } from "./items";
import { OfferActionBlockedError, publishOffer, setOfferState } from "./offers";
import {
  CLOSED_OFFER_STATES,
  OFFER_STATES,
  isAuctionListing,
  normalizeListingType,
  type OfferState,
} from "./offer-rules";

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
 * post close together; a quick buy closes at no time and keeps none. Every post is given a title
 * (#1862), what tells it apart from the other posts running at once; a blank one is refused.
 */
export async function createFacebookPost(
  ownerId: string,
  collectionId: string,
  offerIds: readonly string[],
  title: string
): Promise<{ postId: string; postNo: number }> {
  const titleRefusal = facebookPostTitleRefusal(title);
  if (titleRefusal) throw new OfferActionBlockedError("facebook-group", titleRefusal);
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
  const created = await prisma.$transaction(async (tx) => {
    const postNo = await allocateEntityNumber(tx, collectionId, "facebookPost");
    const post = await tx.facebookPost.create({
      data: { collectionId, postNo, title: title.trim(), groupId: lots[0].facebookGroupId! },
      select: { id: true },
    });
    for (const [index, lot] of lots.entries()) {
      await tx.offer.update({
        where: { id: lot.id },
        data: { facebookPostId: post.id, facebookLotNo: index + 1, ...(auction(lot) ? { endsAt } : {}) },
      });
    }
    return { postId: post.id, postNo };
  });
  // A post captioned from the start has its lots' photos queued now (#1861), not when it is opened.
  await syncFacebookPostLotPhotos(created.postId);
  return created;
}

/** What a multi-lot post's own screen draws (#1842): the post's kit — the group, the lots in lot
 *  order, the text and photos — and, per lot, the sales it left on. */
export interface FacebookPostScreen {
  postId: string;
  postNo: number;
  /** The post's title (#1862); null on a post made before titles until it is given one. */
  title: string | null;
  collectionId: string;
  kit: FacebookOfferKit;
  /** The Facebook platform the lots are offered on — what *Sell* on a lot's row records the sale on. */
  platform: { id: string; name: string };
  /** Keyed by the lot's offer id; a lot sold on no sale is absent. Several only when its sets were
   *  sold apart. */
  sales: Record<string, { id: string; saleNo: number }[]>;
}

/** The post a collection numbers `postNo` (#1842), or null — what its screen's address is resolved by. */
export async function findFacebookPostId(
  ownerId: string,
  collectionId: string,
  postNo: number
): Promise<string | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const post = await prisma.facebookPost.findUnique({
    where: { collectionId_postNo: { collectionId, postNo } },
    select: { id: true },
  });
  return post?.id ?? null;
}

/**
 * A multi-lot post as its own screen shows it (#1842): the kit every lot's card used to repeat, read
 * once off its first lot, and each lot's sale. Null for a post that is gone — dissolved when it was
 * left with one lot.
 */
export async function getFacebookPostScreen(ownerId: string, postId: string): Promise<FacebookPostScreen | null> {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      postNo: true,
      title: true,
      collectionId: true,
      lots: {
        select: { id: true, platform: { select: { id: true, name: true } } },
        orderBy: { facebookLotNo: "asc" },
        take: 1,
      },
    },
  });
  if (!post || post.lots.length === 0) return null;
  await assertCollectionOwner(ownerId, post.collectionId);
  const kit = await getFacebookOfferKit(post.lots[0].id);
  if (!kit) return null;
  const lines = await prisma.saleLine.findMany({
    where: { offerId: { in: kit.lots.map((l) => l.offerId) } },
    select: { offerId: true, sale: { select: { id: true, saleNo: true } } },
    orderBy: { sale: { saleNo: "asc" } },
  });
  const sales: FacebookPostScreen["sales"] = {};
  for (const line of lines) {
    if (!line.offerId) continue;
    const list = (sales[line.offerId] ??= []);
    if (!list.some((s) => s.id === line.sale.id)) list.push(line.sale);
  }
  return {
    postId: post.id,
    postNo: post.postNo,
    title: post.title,
    collectionId: post.collectionId,
    kit,
    platform: post.lots[0].platform,
    sales,
  };
}

/** One multi-lot post as the list of posts draws it (#1850). */
export interface FacebookPostListItem {
  postId: string;
  postNo: number;
  /** The post's title (#1862); null on a post made before titles until it is given one. */
  title: string | null;
  group: { id: string; name: string; archived: boolean };
  lotCount: number;
  /** Lots neither sold nor withdrawn. */
  forSaleCount: number;
  stage: FacebookPostStage;
  layout: FacebookMultiLotLayout;
  /** The day the post went up — its earliest lot's listing date, `YYYY-MM-DD` — or null before then. */
  postedOn: string | null;
  link: string | null;
}

export interface FacebookPostListFilters {
  /** Any of these groups; empty is every group. */
  groupIds?: readonly string[];
  stage?: FacebookPostStage;
  /** Only the posts with no title (#1862) — those made before titles, to be named. */
  untitled?: boolean;
  offset?: number;
  pageSize?: number;
}

const POSTED_STATES: readonly OfferState[] = OFFER_STATES.filter((s) => isFacebookLotPosted(s));

/** The posts `facebookPostStage` would place at `stage`, as a query over their lots — the same
 *  precedence, so a filtered page holds exactly the rows whose chip says that stage. */
function facebookPostStageWhere(stage: FacebookPostStage): Prisma.FacebookPostWhereInput {
  switch (stage) {
    case "pending":
      return { lots: { some: { state: "pending" } } };
    case "up":
      return { AND: [{ lots: { none: { state: "pending" } } }, { lots: { some: { state: { in: ["active", "paused"] } } } }] };
    case "over":
      return {
        AND: [
          { lots: { none: { state: { in: ["pending", "active", "paused"] } } } },
          { lots: { some: { state: { in: [...POSTED_STATES] } } } },
        ],
      };
    case "ready":
      return { AND: [{ lots: { every: { state: "ready" } } }, { lots: { some: {} } }] };
    case "preparing":
      return { AND: [{ lots: { none: { state: { in: [...POSTED_STATES] } } } }, { lots: { some: { state: { not: "ready" } } } }] };
  }
}

/**
 * Every multi-lot post in a collection, newest first (#1850) — an offer posted alone has no post of
 * its own (ADR-0061 §2) and stays on the offers list. Paged by offset like the other lists; a post's
 * stage is read off its lots, so its filter is a query over them rather than a column.
 */
export async function listFacebookPostsPaginated(
  ownerId: string,
  collectionId: string,
  filters: FacebookPostListFilters = {}
): Promise<{ items: FacebookPostListItem[]; nextCursor: string | null }> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const where: Prisma.FacebookPostWhereInput = {
    collectionId,
    ...(filters.groupIds?.length ? { groupId: { in: [...filters.groupIds] } } : {}),
    ...(filters.stage ? facebookPostStageWhere(filters.stage) : {}),
    ...(filters.untitled ? { OR: [{ title: null }, { title: "" }] } : {}),
  };
  const rows = await prisma.facebookPost.findMany({
    where,
    orderBy: { postNo: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      postNo: true,
      title: true,
      layout: true,
      group: { select: { id: true, name: true, archivedAt: true } },
      lots: { orderBy: { facebookLotNo: "asc" }, select: { state: true, url: true, listingDate: true } },
    },
  });
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  // A post following its group's layout reads it live, as its screen does; a page names few groups.
  const settings = new Map<string, Awaited<ReturnType<typeof readFacebookGroupSettings>>>();
  for (const row of page) {
    if (row.layout === null && !settings.has(row.group.id)) {
      settings.set(row.group.id, await readFacebookGroupSettings(row.group.id));
    }
  }

  const items = page.map((row): FacebookPostListItem => {
    const posted = row.lots
      .map((l) => l.listingDate)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      postId: row.id,
      postNo: row.postNo,
      title: row.title,
      group: { id: row.group.id, name: row.group.name, archived: row.group.archivedAt !== null },
      lotCount: row.lots.length,
      forSaleCount: row.lots.filter((l) => !(CLOSED_OFFER_STATES as readonly string[]).includes(l.state)).length,
      stage: facebookPostStage(row.lots),
      layout: facebookPostLayout(row, settings.get(row.group.id) ?? { multiLotLayout: "text" }),
      postedOn: posted.length ? posted[0].toISOString().slice(0, 10) : null,
      link: facebookPostLink(row.lots),
    };
  });
  return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
}

/** The groups a collection's posts are in, by name — what the list of posts filters by (#1850). */
export async function listFacebookPostGroups(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string; archived: boolean }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const groups = await prisma.facebookGroup.findMany({
    where: { collectionId, posts: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, archivedAt: true },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, archived: g.archivedAt !== null }));
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
  // Its lot photo goes with it, and so does the last lot's of a post it dissolved (#1861).
  await pruneFacebookLotPhotos(offer.collectionId);
}

/**
 * Lay a post of several lots out its own way (#1841) — every lot in the post's text, or each lot in
 * its photo's caption — or, with null, follow its group's setting again. Only until a lot has gone
 * up: from then on the post is what was posted, and its frozen text says how (#1800).
 */
export async function setFacebookPostLayout(
  ownerId: string,
  postId: string,
  layout: FacebookMultiLotLayout | null
): Promise<void> {
  if (layout !== null && !(FACEBOOK_MULTI_LOT_LAYOUTS as readonly string[]).includes(layout)) {
    throw new Error("Unknown layout for a post of several lots.");
  }
  await assertPostOwner(ownerId, postId);
  const lots = await prisma.offer.findMany({ where: { facebookPostId: postId }, select: { state: true } });
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError(
      "facebook-group",
      "The post is up, so it stays laid out as it was posted."
    );
  }
  await prisma.facebookPost.update({ where: { id: postId }, data: { layout } });
  // Captioned now: its lots' photos are queued; laid out as text: they go (#1861).
  await syncFacebookPostLotPhotos(postId);
}

/**
 * Give a post its title, or another one (#1862) — at any time, the post being up included: the title
 * names the post here, and a post already up keeps the title it went up with in its frozen text
 * (#1800). Never blank, since every post has one.
 */
export async function setFacebookPostTitle(ownerId: string, postId: string, title: string): Promise<void> {
  const refusal = facebookPostTitleRefusal(title);
  if (refusal) throw new OfferActionBlockedError("facebook-group", refusal);
  await assertPostOwner(ownerId, postId);
  await prisma.facebookPost.update({ where: { id: postId }, data: { title: title.trim() } });
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
