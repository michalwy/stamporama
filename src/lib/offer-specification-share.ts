import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { readShareAddress, sealShareToken, type ShareAddress } from "./share-address";
import { soldItemIds } from "./sales";
import {
  isOfferSpecificationShareTokenShape,
  OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX,
} from "./offer-specification-share-rules";

// **A buyer's link to an offer's specification** (#1760) — the database half: what mints one, what
// a raw token resolves to, and which thumbnails a resolved one may serve.
//
// `sale-share.ts`'s shape one table over, and the rule that holds it together is the same: **the
// token names one offer, and nothing is ever read by any other key.** `verifyOfferSpecificationShareToken`
// hands back an access value carrying the offer id it resolved to, and the page and the photo route
// take that value rather than anything from the URL. So a leaked link exposes exactly the
// specification the collector chose to hand over — the same read as the printable page
// (`readOfferSpecification`), so the same rows in the same order, as they stand when it is opened.

const HASH_ALGO = "sha256";

/** SHA-256 hex of a raw token — what every lookup here runs on. */
function hashToken(rawToken: string): string {
  return createHash(HASH_ALGO).update(rawToken, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** The offer is the caller's — and in `collectionId`, where one is named — or this throws. */
async function assertOfferOwner(ownerId: string, offerId: string, collectionId?: string): Promise<void> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, collection: { ownerId }, ...(collectionId ? { collectionId } : {}) },
    select: { id: true },
  });
  if (!offer) throw new Error("Offer not found or access denied.");
}

// ── The collector's side ────────────────────────────────────────────────────────────────────────

/** An offer's specification link as the collector's dialog reads it — the address included (#681),
 *  since a link the owner cannot see is a link they cannot send twice. */
export interface OfferSpecificationShareLinkData {
  address: ShareAddress;
  createdAt: string;
  /** When a buyer last opened it, or null if nobody has. */
  lastUsedAt: string | null;
}

const LINK_SELECT = { tokenSealed: true, createdAt: true, lastUsedAt: true } as const;

function toLinkData(row: {
  tokenSealed: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): OfferSpecificationShareLinkData {
  return {
    address: readShareAddress(row.tokenSealed),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** The link on an offer's specification, or null when it has none. Throws when the offer is not the
 *  caller's, or not in `collectionId` where one is named. */
export async function readOfferSpecificationShareLink(
  ownerId: string,
  offerId: string,
  collectionId?: string
): Promise<OfferSpecificationShareLinkData | null> {
  await assertOfferOwner(ownerId, offerId, collectionId);
  const row = await prisma.offerSpecificationShareToken.findUnique({
    where: { offerId },
    select: LINK_SELECT,
  });
  return row ? toLinkData(row) : null;
}

/**
 * Mint the offer's specification link, replacing any it already had.
 *
 * **Minting and regenerating are one act**, the trade and sale links' rule: an offer has one link,
 * and asking for a new one is asking for the old one to stop working. An upsert on the unique
 * `offerId`, so there is never a window with two live links. The raw token is returned as well as
 * sealed, because the dialog that pressed the button shows the address before any refetch lands.
 */
export async function createOfferSpecificationShareToken(
  ownerId: string,
  offerId: string
): Promise<{ token: string; record: OfferSpecificationShareLinkData }> {
  await assertOfferOwner(ownerId, offerId);
  const rawToken = OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const tokenSealed = sealShareToken(rawToken);
  const row = await prisma.offerSpecificationShareToken.upsert({
    where: { offerId },
    create: { offerId, tokenHash, tokenSealed },
    update: {
      tokenHash,
      // Written on every regeneration, null included: a stale seal would show the address of the
      // link just replaced.
      tokenSealed,
      // A new link has never been opened.
      lastUsedAt: null,
      createdAt: new Date(),
    },
    select: LINK_SELECT,
  });
  return { token: rawToken, record: toLinkData(row) };
}

/** Withdraw the link. The row is deleted rather than flagged: a revoked credential kept around is a
 *  credential someone can un-revoke. */
export async function revokeOfferSpecificationShareToken(
  ownerId: string,
  offerId: string
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  await prisma.offerSpecificationShareToken.deleteMany({ where: { offerId } });
}

// ── The buyer's side ────────────────────────────────────────────────────────────────────────────

/**
 * What a verified token authorises: one offer's specification.
 *
 * The offer id here is the **only** one the page and the photo route use, resolved from the token's
 * own row and never from anything the reader supplied. `ownerId` is there because the specification
 * read takes one — the token reads as the owner **for this one offer's specification**, and for
 * nothing else.
 */
export interface OfferSpecificationShareAccess {
  offerId: string;
  ownerId: string;
  collectionId: string;
}

/**
 * Resolve a raw token, or null when it is not a live link.
 *
 * The prefix is checked before anything is hashed, so a crawler walking `/spec/…` costs a string
 * comparison rather than a query. `lastUsedAt` is bumped on the page's serve (`touch`), and not on
 * each thumbnail: one opened page writes one receipt.
 */
export async function verifyOfferSpecificationShareToken(
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {}
): Promise<OfferSpecificationShareAccess | null> {
  const token = rawToken.trim();
  if (!isOfferSpecificationShareTokenShape(token)) return null;
  const hash = hashToken(token);
  const row = await prisma.offerSpecificationShareToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      offer: { select: { id: true, collectionId: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;

  if (options.touch ?? true) {
    await prisma.offerSpecificationShareToken.update({
      where: { id: row.id },
      data: { lastUsedAt: options.now ?? new Date() },
    });
  }
  return {
    offerId: row.offer.id,
    ownerId: row.offer.collection.ownerId,
    collectionId: row.offer.collectionId,
  };
}

/**
 * Whether a photo is a thumbnail the shared specification shows — and so one its link may serve.
 *
 * Exactly the page's own choice, asked without rebuilding the page: the photo is the **front** of a
 * copy the specification lists, or its **back** where it has no front; and the copy is listed when
 * it is in one of this offer's sets that did not sell through it, and has not sold anywhere else
 * (`readOfferSpecification`'s two filters). Anything else — another scan of a listed copy, a copy
 * that has gone, a photo of anything else in the collection — is refused the way an invented id is.
 */
export async function canServeOfferSpecificationPhoto(
  access: OfferSpecificationShareAccess,
  photoId: string
): Promise<boolean> {
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      role: { in: ["front", "back"] },
      item: {
        collectionId: access.collectionId,
        offerSetMemberships: {
          some: { offerSet: { offerId: access.offerId, saleLines: { none: {} } } },
        },
      },
    },
    select: {
      role: true,
      itemId: true,
      item: { select: { photos: { where: { role: "front" }, select: { id: true }, take: 1 } } },
    },
  });
  if (!photo?.itemId) return false;
  // A back is the thumbnail only where the copy has no front.
  if (photo.role === "back" && photo.item && photo.item.photos.length > 0) return false;
  const sold = await soldItemIds([photo.itemId]);
  return !sold.has(photo.itemId);
}
