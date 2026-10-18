import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import {
  detachFacebookLot,
  facebookGroupMixesTypes,
  facebookPostLayout,
  getFacebookOfferKit,
  readKitLots,
  type FacebookKitLot,
  type FacebookOfferKit,
  readFacebookGroupSettings,
  setFrozenFacebookClosing,
} from "./facebook-auctions";
import { FACEBOOK_MULTI_LOT_LAYOUTS, type FacebookMultiLotLayout } from "./facebook-group-rules";
import { pruneFacebookLotPhotos, syncFacebookPostLotPhotos } from "./facebook-lot-photos";
import {
  describeRefusedLots,
  facebookBackToReadyPlan,
  facebookLayoutLotTemplate,
  facebookLotAddRefusal,
  facebookLotOrderRefusal,
  facebookLotPrintedTexts,
  facebookPostLink,
  facebookPostRefusal,
  facebookPostStage,
  facebookPostTitleRefusal,
  isFacebookLotPosted,
  type FacebookApprovalClosing,
  type FacebookPostStage,
} from "./facebook-post-rules";
import { allocateEntityNumber } from "./items";
import {
  OfferActionBlockedError,
  offersPrintedTextGaps,
  offersTextStatus,
  publishOffer,
  readOwnOfferState,
  regenerateOfferTitleAndDescription,
  readSoldElsewhereRefusal,
  setOfferState,
  syncGeneratedTexts,
  takeFacebookOfferBackToReady,
  type OfferTextStatus,
} from "./offers";
import { titleFallbackKey, type TitleFallback } from "./offer-title-template";
import {
  CLOSED_OFFER_STATES,
  OFFER_STATES,
  isAuctionListing,
  isOfferState,
  normalizeListingType,
  type OfferListingType,
  type OfferState,
} from "./offer-rules";

// A post in one Facebook group (#1544; ADR-0061 §2, §3) — several lots, or one offer posted alone.
//
// The lots are ordinary Facebook offers — auctions, or quick buys (#1671), of one type unless the
// group lets its posts mix them; what a post adds is that they go up **together**: one group, one
// closing time for its auctions, numbered in the order they were put in, and one activation that
// takes all of them live. The post's link is each lot's own listing link (#1668), given once when any lot is
// activated. Every Facebook offer that has gone up is in a post (#1989): one published in no post is
// published the ordinary way, and `setOfferState` makes its post of one lot as it goes up — which
// from then on reads, renders and moves as an offer posted alone always did.
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
  const created = await prisma.$transaction((tx) => writeFacebookPost(tx, collectionId, offerIds, title));
  // A post captioned from the start has its lots' photos queued now (#1861), not when it is opened.
  await syncFacebookPostLotPhotos(created.postId);
  return created;
}

/**
 * The write half of {@link createFacebookPost}, inside the caller's transaction — so Generate offers
 * can make its offers and their post as one write (#2030). The offers are read and asked
 * `facebookPostRefusal` here, in the transaction, and a refusal rolls the caller's write back; the
 * title is the caller's to have refused before anything was written. The caller queues the lot
 * photos (`syncFacebookPostLotPhotos`) once the transaction is over.
 */
export async function writeFacebookPost(
  tx: DbTransaction,
  collectionId: string,
  offerIds: readonly string[],
  title: string
): Promise<{ postId: string; postNo: number }> {
  const ids = [...new Set(offerIds)];
  const rows = await tx.offer.findMany({
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
}

/** What adding offers to a post did (#1870): the lots they became, in order; each offer turned away,
 *  with why; and the same as one sentence naming them, null when every offer was added. */
export interface FacebookLotsAdded {
  postNo: number;
  added: { offerId: string; offerNo: number; lotNo: number }[];
  refused: { offerId: string; offerNo: number; reason: string }[];
  notAdded: string | null;
}

/**
 * Add offers to an existing multi-lot post as its next lots (#1870), **in the order given** — the
 * order the collector ticked or picked them — before the post is up: a post pending or live keeps the
 * lots it went up with, and is refused whole.
 *
 * Each offer is asked what *Post together* asks of every offer (`facebookLotAddRefusal`): one that
 * fails is turned away by number with its reason and the rest are added; when none qualifies nothing
 * is written and the refusal names them all. The auctions among the lots then share one closing time,
 * the post's — its first auction's that has one, in lot order — as `createFacebookPost` sets it.
 */
export async function addFacebookLots(
  ownerId: string,
  postId: string,
  offerIds: readonly string[]
): Promise<FacebookLotsAdded> {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: {
      collectionId: true,
      postNo: true,
      groupId: true,
      lots: {
        orderBy: { facebookLotNo: "asc" },
        select: { id: true, facebookLotNo: true, listingType: true, state: true, endsAt: true },
      },
    },
  });
  if (!post) throw new Error("Post not found.");
  await assertCollectionOwner(ownerId, post.collectionId);
  if (post.lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError(
      "facebook-group",
      `Post #${post.postNo} is up, so it takes no new lots — they go up with a post, not after it.`
    );
  }

  const ids = [...new Set(offerIds)];
  const rows = await prisma.offer.findMany({
    where: { id: { in: ids }, collectionId: post.collectionId },
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
  const byId = new Map(rows.map((r) => [r.id, { ...r, listingType: normalizeListingType(r.listingType) }]));
  const target = {
    postId,
    groupId: post.groupId,
    mixedListingTypes: await facebookGroupMixesTypes(post.groupId),
    lotTypes: [...new Set(post.lots.map((l) => normalizeListingType(l.listingType)))],
  };
  const joining: NonNullable<ReturnType<typeof byId.get>>[] = [];
  const refused: FacebookLotsAdded["refused"] = [];
  for (const id of ids) {
    const offer = byId.get(id)!;
    const reason = facebookLotAddRefusal(offer, target);
    if (reason) refused.push({ offerId: offer.id, offerNo: offer.offerNo, reason });
    else joining.push(offer);
  }
  const notAdded = describeRefusedLots(refused);
  if (joining.length === 0) throw new OfferActionBlockedError("facebook-group", notAdded!);

  const lots = [
    ...post.lots.map((l) => ({ id: l.id, listingType: normalizeListingType(l.listingType), endsAt: l.endsAt })),
    ...joining,
  ];
  const auctions = lots.filter((l) => isAuctionListing(l.listingType));
  const endsAt = auctions.find((l) => l.endsAt !== null)?.endsAt ?? null;
  const first = Math.max(0, ...post.lots.map((l) => l.facebookLotNo ?? 0)) + 1;
  const added = await prisma.$transaction(async (tx) => {
    const numbered: FacebookLotsAdded["added"] = [];
    for (const [index, offer] of joining.entries()) {
      await tx.offer.update({
        where: { id: offer.id },
        data: { facebookPostId: postId, facebookLotNo: first + index },
      });
      numbered.push({ offerId: offer.id, offerNo: offer.offerNo, lotNo: first + index });
    }
    const retimed = auctions.filter((l) => (l.endsAt?.getTime() ?? null) !== (endsAt?.getTime() ?? null));
    if (retimed.length > 0) {
      await tx.offer.updateMany({ where: { id: { in: retimed.map((l) => l.id) } }, data: { endsAt } });
    }
    return numbered;
  });
  // A captioned post's new lots have their photos queued now, as a new post's are (#1861).
  await syncFacebookPostLotPhotos(postId);
  return { postNo: post.postNo, added, refused, notAdded };
}

/**
 * The offers that could join a post as further lots (#1870) — what its screen's *Add lots…* picks
 * from: Facebook offers in the post's group, in no post, not yet up, and of a type the post holds
 * unless the group's posts may mix them — the same conditions `addFacebookLots` asks again on save.
 * Empty once the post is up, since it then takes none. In offer order, read as a post's lots are.
 */
export async function listFacebookLotCandidates(
  ownerId: string,
  collectionId: string,
  postId: string
): Promise<FacebookKitLot[]> {
  const post = await prisma.facebookPost.findFirst({
    where: { id: postId, collectionId },
    select: { collectionId: true, groupId: true, lots: { select: { listingType: true, state: true } } },
  });
  if (!post) throw new Error("Post not found.");
  await assertCollectionOwner(ownerId, post.collectionId);
  if (post.lots.some((l) => isFacebookLotPosted(l.state))) return [];
  const mixes = await facebookGroupMixesTypes(post.groupId);
  const types = [...new Set(post.lots.map((l) => normalizeListingType(l.listingType)))];
  const offers = await readKitLots(post.collectionId, {
    facebookGroupId: post.groupId,
    facebookPostId: null,
    state: { in: OFFER_STATES.filter((s) => !isFacebookLotPosted(s)) },
  });
  return mixes ? offers : offers.filter((o) => types.includes(o.listingType));
}

/** What a post's own screen draws (#1842): the post's kit — the group, the lots in lot
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
  /** The names its text and captions print untranslated (#1889), or null once the post is up — its
   *  text is frozen then (#1800) and a translation would change nothing in it. */
  translations: FacebookPostTranslations | null;
  /** By the lot's offer id: where its title and description stand against their templates (#1983) —
   *  out of date, written by hand — or null once the post is up, its text frozen (#1800). */
  lotTexts: Record<string, OfferTextStatus> | null;
}

/** The untranslated names a post not yet up prints (#1889), each once, and which lot prints each. */
export interface FacebookPostTranslations {
  /** The post's language — its platform's listing language; null, the collection's default, can fall
   *  back to nothing. */
  language: string | null;
  /** Every name across the lots, once each, in lot order. */
  gaps: TitleFallback[];
  /** By the lot's offer id: the keys (`titleFallbackKey`) of the names its part of the post prints. A
   *  lot printing none is absent. */
  byLot: Record<string, string[]>;
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
 * A post as its own screen shows it (#1842): the kit every lot's card used to repeat, read once off its
 * first lot, and each lot's sale. Null for a post that is gone — dissolved when it was left with one
 * lot not yet up, or removed with its last lot.
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
  const posted = kit.lots.some((l) => isFacebookLotPosted(l.state));
  return {
    postId: post.id,
    postNo: post.postNo,
    title: post.title,
    collectionId: post.collectionId,
    kit,
    platform: post.lots[0].platform,
    sales,
    translations: posted ? null : await facebookPostTranslations(ownerId, post.collectionId, kit),
    lotTexts: posted
      ? null
      : Object.fromEntries(
          await offersTextStatus(
            ownerId,
            post.collectionId,
            kit.lots.map((l) => l.offerId)
          )
        ),
  };
}

/**
 * What a post not yet up prints untranslated (#1889): for each lot, the names behind the texts its
 * template prints (`{title}`, `{description}` — `facebookLotPrintedTexts`), read off the template it
 * is written from in the post's layout — its text's, or its caption's — and only while that text
 * follows its own template (`offersPrintedTextGaps`): a title written by hand prints no template's
 * names.
 */
async function facebookPostTranslations(
  ownerId: string,
  collectionId: string,
  kit: FacebookOfferKit
): Promise<FacebookPostTranslations> {
  const { group } = kit;
  const templates = { auction: group.postTemplate, quickBuy: group.quickBuyTemplate };
  const captions = {
    auction: group.auctionCaptionTemplate,
    quickBuy: group.quickBuyCaptionTemplate,
    post: group.captionPostTemplate,
  };
  const wanted = new Map(
    kit.lots.map((lot) => [
      lot.offerId,
      facebookLotPrintedTexts(facebookLayoutLotTemplate(kit.layout, templates, captions, lot)),
    ])
  );
  const found = await offersPrintedTextGaps(ownerId, collectionId, wanted);
  const gaps = new Map<string, TitleFallback>();
  const byLot: Record<string, string[]> = {};
  let language: string | null = null;
  for (const lot of kit.lots) {
    const lotGaps = found.get(lot.offerId);
    if (!lotGaps) continue;
    language ??= lotGaps.language;
    if (lotGaps.gaps.length === 0) continue;
    byLot[lot.offerId] = lotGaps.gaps.map(titleFallbackKey);
    for (const gap of lotGaps.gaps) if (!gaps.has(titleFallbackKey(gap))) gaps.set(titleFallbackKey(gap), gap);
  }
  return { language, gaps: [...gaps.values()], byLot };
}

/**
 * Bring a post's lots' titles and descriptions back in step with their templates (#1889) — what the
 * post's screen asks once a missing translation is entered there, so its text and captions read the
 * new name at once. `syncGeneratedTexts` is the rule: a text written by hand keeps its words. Only
 * while no lot is up: a published post's text is frozen (#1800).
 */
export async function refreshFacebookPostTexts(ownerId: string, postId: string): Promise<void> {
  await assertPostOwner(ownerId, postId);
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    select: { id: true, state: true },
  });
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError("facebook-group", "The post is up, so its text stays as it was posted.");
  }
  for (const lot of lots) await syncGeneratedTexts(ownerId, lot.id, ["name", "description"]);
}

/**
 * *Regenerate lot texts* on a post's screen (#1983): the given lots' titles and descriptions rendered
 * again from their templates, in lot order — the twenty round trips of each offer's own ↻ in one.
 * A lot in `overwrite` is regenerated as ↻ does, its hand-written text replaced (the collector ticked
 * it); any other is brought back in step by `syncGeneratedTexts`, which keeps hand-written words. Only
 * while no lot is up — a published post's text is frozen (#1800) — and only the post's own lots.
 * Answers how many lots were gone through.
 */
export async function regenerateFacebookLotTexts(
  ownerId: string,
  postId: string,
  offerIds: readonly string[],
  overwrite: readonly string[]
): Promise<number> {
  await assertPostOwner(ownerId, postId);
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    select: { id: true, state: true },
    orderBy: { facebookLotNo: "asc" },
  });
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError("facebook-group", "The post is up, so its text stays as it was posted.");
  }
  const own = new Set(lots.map((l) => l.id));
  if (offerIds.some((id) => !own.has(id)) || overwrite.some((id) => !own.has(id))) {
    throw new OfferActionBlockedError("facebook-group", "Only this post's own lots can be regenerated here.");
  }
  const asked = new Set(offerIds);
  const replace = new Set(overwrite);
  const chosen = lots.filter((l) => asked.has(l.id) || replace.has(l.id));
  for (const lot of chosen) {
    if (replace.has(lot.id)) await regenerateOfferTitleAndDescription(ownerId, lot.id);
    else await syncGeneratedTexts(ownerId, lot.id, ["name", "description"]);
  }
  return chosen.length;
}

/** One post as the list of posts draws it (#1850) — of several lots, or of one offer posted alone
 *  (#1989). */
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
  /** Only the posts not yet up — being prepared or ready — the ones that still take lots (#1870). */
  notUp?: boolean;
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
 * Every post in a collection, newest first (#1850) — of several lots or of one, since every Facebook
 * offer that has gone up is in a post (#1989). Paged by offset like the other lists; a post's stage is
 * read off its lots, so its filter is a query over them rather than a column. The Facebook offers not
 * yet in a post are `listFacebookOffersNotInPost`'s.
 */
export async function listFacebookPostsPaginated(
  ownerId: string,
  collectionId: string,
  filters: FacebookPostListFilters = {}
): Promise<{ items: FacebookPostListItem[]; nextCursor: string | null }> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  // The stage and *not yet up* (#1870) are both queries over the lots, so each is its own AND clause
  // rather than spread in, where one would overwrite the other's `lots` or `AND`.
  const where: Prisma.FacebookPostWhereInput = {
    collectionId,
    ...(filters.groupIds?.length ? { groupId: { in: [...filters.groupIds] } } : {}),
    AND: [
      ...(filters.stage ? [facebookPostStageWhere(filters.stage)] : []),
      ...(filters.notUp ? [{ lots: { none: { state: { in: [...POSTED_STATES] } } } }] : []),
    ],
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
      layout: facebookPostLayout(
        { layout: row.layout, lotCount: row.lots.length },
        settings.get(row.group.id) ?? { multiLotLayout: "text" }
      ),
      postedOn: posted.length ? posted[0].toISOString().slice(0, 10) : null,
      link: facebookPostLink(row.lots),
    };
  });
  return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
}

/** A Facebook offer not yet in a post (#1989), as the list of posts names it under *Not in a post
 *  yet*: still being prepared or Ready, its post made when it is published or grouped. */
export interface FacebookOfferNotInPost {
  offerId: string;
  offerNo: number;
  title: string;
  listingType: OfferListingType;
  state: OfferState;
  group: { id: string; name: string; archived: boolean };
}

/** The states a Facebook offer is in while it has no post yet — what *Not in a post yet* lists, and
 *  what the list's *Being prepared* and *Ready to post* chips narrow it to. */
const NOT_YET_POSTED_STATES: readonly OfferState[] = OFFER_STATES.filter((s) => !isFacebookLotPosted(s));

/**
 * The Facebook offers in a collection that are in no post and not yet up (#1989) — so the list of posts
 * is a complete picture of Facebook, published or not. Each gets its post when it is published alone
 * (a post of one lot) or put into one with others. In offer order; `groupIds` and `states` narrow it as
 * the list's group filter and stage chips do.
 */
export async function listFacebookOffersNotInPost(
  ownerId: string,
  collectionId: string,
  filters: { groupIds?: readonly string[]; states?: readonly OfferState[] } = {}
): Promise<FacebookOfferNotInPost[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const states = (filters.states ?? NOT_YET_POSTED_STATES).filter((s) => NOT_YET_POSTED_STATES.includes(s));
  const where: Prisma.OfferWhereInput = {
    facebookGroupId: filters.groupIds?.length ? { in: [...filters.groupIds] } : { not: null },
    facebookPostId: null,
    state: { in: [...states] },
  };
  const [lots, groups] = await Promise.all([
    readKitLots(collectionId, where),
    prisma.offer.findMany({
      where: { ...where, collectionId },
      select: { id: true, facebookGroup: { select: { id: true, name: true, archivedAt: true } } },
    }),
  ]);
  const groupOf = new Map(groups.map((o) => [o.id, o.facebookGroup!]));
  return lots.map((lot) => {
    const group = groupOf.get(lot.offerId)!;
    return {
      offerId: lot.offerId,
      offerNo: lot.offerNo,
      title: lot.title,
      listingType: lot.listingType,
      state: lot.state,
      group: { id: group.id, name: group.name, archived: group.archivedAt !== null },
    };
  });
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
 * Put a post's lots in a new order (#1986): `offerIds` is every lot of the post, once, in the order
 * they are to be numbered — dragged into it on the post's screen, or sorted there by catalogue number
 * or price. The lot numbers are the order, so the post's text, its captions and the photos' download
 * follow at once. Only until the post is up: a published post's lots stay as they were posted
 * (#1800). An order naming a lot the post no longer holds, or missing one, is refused as stale.
 */
export async function reorderFacebookLots(
  ownerId: string,
  postId: string,
  offerIds: readonly string[]
): Promise<void> {
  await assertPostOwner(ownerId, postId);
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: postId },
    select: { id: true, state: true },
  });
  if (lots.some((l) => isFacebookLotPosted(l.state))) {
    throw new OfferActionBlockedError(
      "facebook-group",
      "The post is up, so its lots stay in the order they were posted."
    );
  }
  const refusal = facebookLotOrderRefusal(
    lots.map((l) => l.id),
    offerIds
  );
  if (refusal) throw new OfferActionBlockedError("facebook-group", refusal);
  // Renumbered in two passes, as `detachFacebookLot` does: the unique (post, lot) index would refuse
  // a lot moved onto a number another has not left yet.
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of offerIds.entries()) {
      await tx.offer.update({ where: { id }, data: { facebookLotNo: -1 - index } });
    }
    for (const [index, id] of offerIds.entries()) {
      await tx.offer.update({ where: { id }, data: { facebookLotNo: index + 1 } });
    }
  });
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
 * that is the post's link. A lot of a post takes the whole post live with it. An offer in no post,
 * and every offer off Facebook, is the ordinary `publishOffer` — which, for a Facebook offer, makes
 * its post of one lot as it goes up (#1989); `postTitle` is that post's title, a blank one leaving it
 * untitled (#1692).
 *
 * `to` is `pending` when the post went to the group's administrator rather than straight up (#1778):
 * the link is then the pending post's. Approving a pending offer is this same call with `active`.
 */
export async function publishOfferOrPost(
  ownerId: string,
  offerId: string,
  url: string | null,
  to: "active" | "pending" = "active",
  endsAt?: Date | null,
  postTitle?: string
): Promise<void> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { facebookPostId: true } });
  // The auctions an approval may re-time (#1779), read before anything moves: once approved they are
  // no longer told apart from the post's lots that were already up.
  const approved =
    to === "active" && endsAt !== undefined ? await pendingFacebookAuctions(ownerId, offerId) : [];
  if (!offer?.facebookPostId) {
    await publishOffer(ownerId, offerId, url, to);
    const title = postTitle?.trim();
    if (title) {
      const placed = await prisma.offer.findUnique({ where: { id: offerId }, select: { facebookPostId: true } });
      if (placed?.facebookPostId) await setFacebookPostTitle(ownerId, placed.facebookPostId, title);
    }
  } else await publishFacebookPost(ownerId, offer.facebookPostId, url, to);
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
  // A lot holding a set sold elsewhere keeps the whole post down (#1876): asked of every lot before
  // any of them moves, since the loop below would otherwise put the lots ahead of it up alone.
  for (const lot of lots) {
    if (!isOfferState(lot.state)) continue;
    const refusal = await readSoldElsewhereRefusal(lot.id, lot.state, to);
    if (refusal) {
      throw new OfferActionBlockedError("sold-elsewhere", `Lot ${lot.facebookLotNo} (offer #${lot.offerNo}): ${refusal}`);
    }
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

/** What taking a post back to Ready did (#1998): the post the lots are Ready in now — the same one,
 *  or the new one they moved into when lots sold or withdrawn stayed behind — and whether it split. */
export interface FacebookBackToReady {
  postId: string;
  postNo: number;
  /** The post left holding the lots that stayed, when the post was split; null otherwise. */
  keptPostNo: number | null;
}

/**
 * Take a Facebook post that is up back to Ready (#1998) — the Publish was a mistake, or the post is
 * gone from the group — asked of any lot of it, since the post moves as one.
 *
 * Only the lots still for sale go back ({@link facebookBackToReadyPlan}); each goes through
 * `takeFacebookOfferBackToReady`, which clears its link, unfreezes its text, stops its days up and
 * clears an auction's recorded bids. A lot sold or withdrawn stays as it is, and then the post is
 * **split**: those lots stay in the post as it went up — its number, lot numbers, links and frozen
 * text — and the lots going back move into a new post in the same group, with the same title and
 * layout, numbered in their lot order. When every lot goes back the post itself is Ready again and
 * nothing new is made.
 *
 * The move into the new post comes first, so a refusal halfway through leaves the lots that went
 * back and the ones still up in one post with nothing sold in it — and asking again finishes it.
 * Refused while the post waits for the group's approval (that is *Rejected — back to Ready*) and
 * once nothing in it is up any more.
 */
export async function takeFacebookPostBackToReady(ownerId: string, offerId: string): Promise<FacebookBackToReady> {
  await readOwnOfferState(ownerId, offerId);
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { facebookPostId: true } });
  // Every Facebook offer that has gone up is in a post (#1989), so one in none has nothing up.
  if (!offer.facebookPostId) {
    throw new OfferActionBlockedError("bad-transition", "Only a Facebook post that is up goes back to Ready — this offer is in no post.");
  }
  const postId = offer.facebookPostId;
  await assertPostOwner(ownerId, postId);
  const post = await prisma.facebookPost.findUniqueOrThrow({
    where: { id: postId },
    select: {
      collectionId: true,
      groupId: true,
      postNo: true,
      title: true,
      layout: true,
      lots: {
        orderBy: { facebookLotNo: "asc" },
        select: { id: true, state: true, listingType: true, price: true },
      },
    },
  });
  const lots = post.lots.map((l) => ({
    ...l,
    listingType: normalizeListingType(l.listingType),
    price: l.price.toFixed(2),
  }));
  if (lots.some((l) => l.state === "pending")) {
    throw new OfferActionBlockedError(
      "bad-transition",
      `Post #${post.postNo} is waiting for the group's approval — if the group turned it down, it is *Rejected — back to Ready*.`
    );
  }
  if (!lots.some((l) => l.state === "active" || l.state === "paused")) {
    throw new OfferActionBlockedError(
      "bad-transition",
      `Post #${post.postNo} has nothing up for sale to take back to Ready.`
    );
  }
  const { going, staying } = facebookBackToReadyPlan(lots);

  let target = { postId, postNo: post.postNo, keptPostNo: null as number | null };
  if (staying.length > 0) {
    target = await prisma.$transaction(async (tx) => {
      const postNo = await allocateEntityNumber(tx, post.collectionId, "facebookPost");
      const split = await tx.facebookPost.create({
        data: {
          collectionId: post.collectionId,
          postNo,
          title: post.title,
          groupId: post.groupId,
          layout: post.layout,
        },
        select: { id: true },
      });
      for (const [index, lot] of going.entries()) {
        await tx.offer.update({
          where: { id: lot.id },
          data: { facebookPostId: split.id, facebookLotNo: index + 1 },
        });
      }
      return { postId: split.id, postNo, keptPostNo: post.postNo };
    });
  }
  for (const lot of going) {
    if (lot.state === "active" || lot.state === "paused") await takeFacebookOfferBackToReady(ownerId, lot.id);
  }
  // The lots' photos follow where they are now: the text they went up with no longer holds them (#1861).
  await syncFacebookPostLotPhotos(target.postId);
  if (target.postId !== postId) await syncFacebookPostLotPhotos(postId);
  return target;
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
