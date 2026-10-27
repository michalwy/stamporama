import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import { readShareAddress, sealShareToken, type ShareAddress } from "./share-address";
import { getFacebookOfferKit, type FacebookOfferKit } from "./facebook-auctions";
import { syncFacebookPostLotPhotos } from "./facebook-lot-photos";
import { readOfferUploadPlans } from "./offer-photo-generation";
import { isAuctionListing, type OfferListingType } from "./offer-rules";
import { DEFAULT_CURRENCY_STYLE, writtenAmount } from "./template-amount";
import {
  facebookPostPreviewLink,
  facebookPostPreviewMark,
  facebookPostPreviewStanding,
  FACEBOOK_POST_PREVIEW_TOKEN_PREFIX,
  isFacebookPostPreviewTokenShape,
  type FacebookPostPreviewMark,
  type FacebookPostPreviewStanding,
} from "./facebook-post-preview-rules";

// **A Facebook post's preview for a buyer** (#2212) — the database half: what the preview shows,
// what mints and withdraws its link, what a raw token resolves to, and which photos it may serve.
//
// `offer-specification-share.ts`'s shape one table over, and the rule that holds it together is the
// same: **the token names one post, and nothing is ever read by any other key.**
// `verifyFacebookPostPreviewToken` hands back an access value carrying the post id it resolved to,
// and the page and the photo route take that value rather than anything from the URL.
//
// **The preview is the post as it will appear**: its text — rendered in the browser from the very
// kit the post's own screen renders (`renderFacebookKitPost`), so it is what Publish would send, and
// the frozen text once it is up — then each lot with its number, title, price as the post states it
// and the photos that go up with it. What leaves this module for a buyer is **scrubbed**
// (`scrubbedKit`): the kit's offer ids, the collection's id and anything the text does not print are
// replaced or emptied, so the page carries nothing from the collection the post does not show.

const HASH_ALGO = "sha256";

function sha256(value: string): string {
  return createHash(HASH_ALGO).update(value, "utf8").digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── The preview ─────────────────────────────────────────────────────────────────────────────────

/** One lot as the preview shows it. */
export interface FacebookPostPreviewLot {
  /** What ties the lot to its caption in the rendered text — the scrubbed kit's id for it. */
  key: string;
  /** Null for a post of one lot, which names no lot (#1989). */
  lotNo: number | null;
  title: string;
  listingType: OfferListingType;
  /** A quick buy's price as the post writes it; null on an auction. */
  price: string | null;
  /** An auction's starting price as the post writes it; null on a quick buy or where none is set. */
  startingPrice: string | null;
  /** An auction's closing time, ISO-8601 — written out in the browser, which knows the zone (#490). */
  endsAt: string | null;
  mark: FacebookPostPreviewMark;
  /** The photos that go up with the lot, in their order. */
  photoIds: string[];
}

/** What the preview page draws. `kit` and `lots` only while the post is `shown`. */
export interface FacebookPostPreview {
  postNo: number;
  /** The post's language — its platform's listing language, else the collection's. */
  language: string | null;
  standing: FacebookPostPreviewStanding;
  /** The post's title as it went up, or as it reads now; null where it has none. */
  title: string | null;
  /** The post in the group, once the group has approved it. */
  postLink: string | null;
  kit: FacebookOfferKit | null;
  lots: FacebookPostPreviewLot[];
}

/** The key a lot goes by on the page, in place of its offer's id. */
function lotKey(index: number): string {
  return `lot-${index + 1}`;
}

/**
 * The kit with everything the text does not print taken out: the offer ids become the lots' keys, and
 * the collection's id, the archive's address, the group's id and settings, sort keys, running bids and
 * the lots' links are emptied. The renderer reads none of them.
 */
function scrubbedKit(kit: FacebookOfferKit): FacebookOfferKit {
  return {
    collectionId: "",
    group: { ...kit.group, id: "", url: "", custom: [] },
    post: kit.post ? { ...kit.post, id: "" } : null,
    layout: kit.layout,
    lots: kit.lots.map((lot, index) => ({
      ...lot,
      offerId: lotKey(index),
      catalogSortKey: null,
      url: null,
      // An auction's price is its running bid, which the post does not print.
      price: isAuctionListing(lot.listingType) ? "0.00" : lot.price,
      priceCheckedAt: null,
    })),
    photoZipPath: "",
  };
}

/** The photos each lot puts up, by its offer id: in a captioned post its one stored photo once it is
 *  drawn (#1861), otherwise its upload set (#1848) — the files the post's ZIP carries. */
async function lotPhotoIds(
  ownerId: string,
  postId: string,
  kit: FacebookOfferKit,
  captioned: boolean
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (captioned) {
    for (const lot of (await syncFacebookPostLotPhotos(postId)) ?? []) {
      result.set(lot.offerId, lot.state.status === "ready" ? [lot.state.photoId] : []);
    }
    return result;
  }
  // Every lot's upload set in one read (#2222).
  const plans = await readOfferUploadPlans(
    ownerId,
    kit.lots.map((lot) => lot.offerId)
  );
  for (const lot of kit.lots) {
    const plan = plans.get(lot.offerId)?.plan;
    result.set(lot.offerId, !plan || "reason" in plan ? [] : plan.images.map((image) => image.photoId));
  }
  return result;
}

/** The post's lots' states and links, and its language — what the standing and the notice need. */
async function readPostHead(postId: string) {
  const post = await prisma.facebookPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      postNo: true,
      collectionId: true,
      collection: { select: { ownerId: true, defaultLanguage: true } },
      lots: {
        orderBy: { facebookLotNo: "asc" },
        select: { id: true, state: true, url: true, platform: { select: { titleLanguage: true } } },
      },
    },
  });
  if (!post || post.lots.length === 0) return null;
  return {
    ...post,
    language:
      normalizeLanguage(post.lots[0].platform.titleLanguage) ?? normalizeLanguage(post.collection.defaultLanguage),
  };
}

/** The preview of a post, unchecked — the callers have resolved the owner. Null for a post that is
 *  gone. */
async function buildPreview(ownerId: string, postId: string): Promise<FacebookPostPreview | null> {
  const head = await readPostHead(postId);
  if (!head) return null;
  const standing = facebookPostPreviewStanding(head.lots);
  const base = { postNo: head.postNo, language: head.language, standing };
  if (standing !== "shown") return { ...base, title: null, postLink: null, kit: null, lots: [] };

  const kit = await getFacebookOfferKit(head.lots[0].id);
  if (!kit) return null;
  // Laid out as it went up, read off its last lot's frozen text (#1841), else as it is set now.
  const captioned = (kit.lots.at(-1)?.frozen?.layout ?? kit.layout) === "captions";
  const photos = await lotPhotoIds(ownerId, postId, kit, captioned);
  const states = new Map(head.lots.map((l) => [l.id, l.state]));
  const lastFrozen = kit.lots.at(-1)?.frozen ?? null;

  return {
    ...base,
    title: (lastFrozen?.postTitle ?? kit.post?.title ?? null) || null,
    postLink: facebookPostPreviewLink(head.lots),
    kit: scrubbedKit(kit),
    lots: kit.lots.map((lot, index): FacebookPostPreviewLot => {
      // As the post states it: the published figures once it is up (#1800), the offer's now before.
      const figures = lot.frozen ?? lot;
      const style = lot.frozen?.currencyStyle ?? DEFAULT_CURRENCY_STYLE;
      const auction = isAuctionListing(figures.listingType);
      return {
        key: lotKey(index),
        lotNo: lot.lotNo,
        title: figures.title,
        listingType: figures.listingType,
        price: !auction && figures.price ? writtenAmount(figures.price, figures.currency, style) : null,
        startingPrice:
          auction && figures.startingPrice ? writtenAmount(figures.startingPrice, figures.currency, style) : null,
        endsAt: auction ? figures.endsAt : null,
        mark: facebookPostPreviewMark(states.get(lot.offerId) ?? ""),
        photoIds: photos.get(lot.offerId) ?? [],
      };
    }),
  };
}

/** The post is the caller's — and in `collectionId`, where one is named — or this throws. */
async function assertPostOwner(ownerId: string, postId: string, collectionId?: string): Promise<{ collectionId: string }> {
  const post = await prisma.facebookPost.findFirst({
    where: { id: postId, collection: { ownerId }, ...(collectionId ? { collectionId } : {}) },
    select: { collectionId: true },
  });
  if (!post) throw new Error("Post not found or access denied.");
  return post;
}

/** The preview as the collector's printable page draws it. Null for somebody else's post or one that
 *  is gone. */
export async function readFacebookPostPreview(
  ownerId: string,
  postId: string,
  collectionId?: string
): Promise<FacebookPostPreview | null> {
  try {
    await assertPostOwner(ownerId, postId, collectionId);
  } catch {
    return null;
  }
  return buildPreview(ownerId, postId);
}

// ── The collector's side of the link ────────────────────────────────────────────────────────────

/** A post's preview link as the collector's dialog reads it — the address included (#681). */
export interface FacebookPostPreviewLinkData {
  address: ShareAddress;
  createdAt: string;
  /** When a buyer last opened it, or null if nobody has. */
  lastUsedAt: string | null;
}

/** What the collector's dialog reads: the link, if there is one, what a buyer opening it sees now,
 *  and the post's language, which the page speaks. */
export interface FacebookPostPreviewShareState {
  link: FacebookPostPreviewLinkData | null;
  standing: FacebookPostPreviewStanding;
  language: string | null;
}

export async function readFacebookPostPreviewShareState(
  ownerId: string,
  postId: string,
  collectionId?: string
): Promise<FacebookPostPreviewShareState> {
  await assertPostOwner(ownerId, postId, collectionId);
  const [row, head] = await Promise.all([
    prisma.facebookPostPreviewToken.findUnique({
      where: { postId },
      select: { tokenSealed: true, createdAt: true, lastUsedAt: true },
    }),
    readPostHead(postId),
  ]);
  return {
    standing: facebookPostPreviewStanding(head?.lots ?? null),
    language: head?.language ?? null,
    link: row
      ? {
          address: readShareAddress(row.tokenSealed),
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Mint the post's preview link, replacing any it had. **Minting and regenerating are one act**: a
 * post has one link, and asking for a new one is asking for the old one to stop working. An upsert on
 * the unique `postId`, so there is never a window with two live links.
 */
export async function createFacebookPostPreviewToken(ownerId: string, postId: string): Promise<{ token: string }> {
  const { collectionId } = await assertPostOwner(ownerId, postId);
  const head = await readPostHead(postId);
  const rawToken = FACEBOOK_POST_PREVIEW_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);
  const tokenSealed = sealShareToken(rawToken);
  const language = head?.language ?? null;
  await prisma.facebookPostPreviewToken.upsert({
    where: { postId },
    create: { collectionId, postId, tokenHash, tokenSealed, language },
    update: {
      tokenHash,
      // Written on every regeneration, null included: a stale seal would show the replaced address.
      tokenSealed,
      language,
      lastUsedAt: null,
      createdAt: new Date(),
    },
  });
  return { token: rawToken };
}

/** Withdraw the link. The row is deleted rather than flagged: a revoked credential kept around is a
 *  credential someone can un-revoke. */
export async function revokeFacebookPostPreviewToken(ownerId: string, postId: string): Promise<void> {
  await assertPostOwner(ownerId, postId);
  await prisma.facebookPostPreviewToken.deleteMany({ where: { postId } });
}

// ── The buyer's side ────────────────────────────────────────────────────────────────────────────

/**
 * What a verified token authorises: one post's preview. `postId` is null once the post is gone — the
 * page then says only that the offer is no longer current, in `language`. The ids here are the only
 * ones the page and the photo route use, resolved from the token's own row.
 */
export interface FacebookPostPreviewAccess {
  postId: string | null;
  ownerId: string;
  collectionId: string;
  language: string | null;
}

/**
 * Resolve a raw token, or null when it is not a live link. The prefix is checked before anything is
 * hashed. `touch` — the page's serve, not each photo — records the visit and the post's language as
 * it reads now, which is what the notice speaks once the post is gone.
 */
export async function verifyFacebookPostPreviewToken(
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {}
): Promise<FacebookPostPreviewAccess | null> {
  const token = rawToken.trim();
  if (!isFacebookPostPreviewTokenShape(token)) return null;
  const hash = sha256(token);
  const row = await prisma.facebookPostPreviewToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      postId: true,
      language: true,
      collectionId: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;

  let language = row.language;
  if (options.touch ?? true) {
    const head = row.postId ? await readPostHead(row.postId) : null;
    if (head) language = head.language;
    await prisma.facebookPostPreviewToken.update({
      where: { id: row.id },
      data: { lastUsedAt: options.now ?? new Date(), language },
    });
  }
  return { postId: row.postId, ownerId: row.collection.ownerId, collectionId: row.collectionId, language };
}

/** What the buyer's page shows: the preview while the post is shown, else only the notice — the
 *  post's number where it still has one, and the language to say it in. */
export type SharedFacebookPostPreview =
  | { standing: "shown"; preview: FacebookPostPreview }
  | { standing: "updating" | "gone"; postNo: number | null; language: string | null };

export async function readSharedFacebookPostPreview(access: FacebookPostPreviewAccess): Promise<SharedFacebookPostPreview> {
  const preview = access.postId ? await buildPreview(access.ownerId, access.postId) : null;
  if (!preview) return { standing: "gone", postNo: null, language: access.language };
  if (preview.standing === "shown") return { standing: "shown", preview };
  return { standing: preview.standing, postNo: preview.postNo, language: preview.language };
}

/**
 * Whether a photo is one the shared preview may serve: while the post is shown, a generated image of
 * one of its lots — an image of its upload plan (#1848) or its stored caption photo (#1861). Anything
 * else — a copy's own scan, another offer's image, a photo of anything else in the collection — is
 * refused the way an invented id is, and so is everything while the page shows only a notice.
 *
 * It does not rebuild each lot's upload plan per photo, which is a plan read per thumbnail, so an image
 * the collector held back from a lot's upload is served if asked for: a picture of the same stamps
 * the page already shows.
 */
export async function canServeFacebookPostPreviewPhoto(
  access: FacebookPostPreviewAccess,
  photoId: string
): Promise<boolean> {
  if (!access.postId) return false;
  const lots = await prisma.offer.findMany({
    where: { facebookPostId: access.postId, collectionId: access.collectionId },
    select: { state: true },
  });
  if (facebookPostPreviewStanding(lots) !== "shown") return false;
  const lotOfThisPost = { facebookPostId: access.postId, collectionId: access.collectionId };
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      OR: [{ offerPhotoEntry: { offer: lotOfThisPost } }, { facebookLotPhoto: { offer: lotOfThisPost } }],
    },
    select: { id: true },
  });
  return photo !== null;
}
