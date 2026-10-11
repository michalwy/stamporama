import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { readShareAddress, sealShareToken, type ShareAddress } from "./share-address";
import { soldItemIds } from "./sales";
import { readOfferSpecification, type OfferSpecification } from "./offer-specification";
import { specificationContentsKey } from "./offer-specification-rules";
import { CLOSED_OFFER_STATES } from "./offer-rules";
import {
  isOfferSpecificationShareTokenShape,
  OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX,
} from "./offer-specification-share-rules";

// **A buyer's link to an offer's specification** (#1760) — the database half: what mints one, what
// a raw token resolves to, what the page behind it shows, and which thumbnails it may serve.
//
// `sale-share.ts`'s shape one table over, and the rule that holds it together is the same: **the
// token names one offer, and nothing is ever read by any other key.** `verifyOfferSpecificationShareToken`
// hands back an access value carrying the offer id it resolved to, and the page and the photo route
// take that value rather than anything from the URL.
//
// **A link is a promise about one specification**, the one the collector sent. Its contents are
// hashed when the link is made (`contentsHash`), and the page shows the specification only while
// today's read hashes the same and the offer is still open. Once anything a buyer reads has changed —
// a copy sold or added, a condition, the title — or the offer has closed, the address still opens
// and says so in the offer's language, rather than showing a buyer something they were not sent. A
// new link records the specification afresh.

const HASH_ALGO = "sha256";

/** SHA-256 hex of a string — a raw token for lookups, a specification's contents for comparison. */
function sha256(value: string): string {
  return createHash(HASH_ALGO).update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** The hash a link records of the specification it was made from. */
function contentsHashOf(spec: OfferSpecification): string {
  return sha256(specificationContentsKey(spec));
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

/**
 * Whether the link still shows the specification it was made from.
 *
 * - `current` — it does.
 * - `changed` — something a buyer reads has changed since; they are asked to contact the seller.
 * - `closed` — the offer is sold or withdrawn; they are told the same.
 */
export type OfferSpecificationShareStanding = "current" | "changed" | "closed";

/** An offer's specification link as the collector's dialog reads it — the address included (#681),
 *  since a link the owner cannot see is a link they cannot send twice. */
export interface OfferSpecificationShareLinkData {
  address: ShareAddress;
  createdAt: string;
  /** When a buyer last opened it, or null if nobody has. */
  lastUsedAt: string | null;
  standing: OfferSpecificationShareStanding;
}

function standingOf(spec: OfferSpecification, contentsHash: string): OfferSpecificationShareStanding {
  if (spec.closed) return "closed";
  return hashesEqual(contentsHashOf(spec), contentsHash) ? "current" : "changed";
}

/** What the collector's dialog reads: the link, if there is one, and the offer's language — which
 *  the buyer's page speaks, and which the dialog warns about when the page has no words in it. */
export interface OfferSpecificationShareState {
  link: OfferSpecificationShareLinkData | null;
  language: string | null;
}

/** The offer's specification link and language. Throws when the offer is not the caller's, or not in
 *  `collectionId` where one is named. */
export async function readOfferSpecificationShareState(
  ownerId: string,
  offerId: string,
  collectionId?: string
): Promise<OfferSpecificationShareState> {
  await assertOfferOwner(ownerId, offerId, collectionId);
  const [row, spec] = await Promise.all([
    prisma.offerSpecificationShareToken.findUnique({
      where: { offerId },
      select: { tokenSealed: true, createdAt: true, lastUsedAt: true, contentsHash: true },
    }),
    readOfferSpecification(ownerId, offerId),
  ]);
  if (!spec) throw new Error("Offer not found or access denied.");
  return {
    language: spec.language,
    link: row
      ? {
          address: readShareAddress(row.tokenSealed),
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          standing: standingOf(spec, row.contentsHash),
        }
      : null,
  };
}

/**
 * Mint the offer's specification link, replacing any it already had, and record the specification
 * it is a link to.
 *
 * **Minting and regenerating are one act**, the trade and sale links' rule: an offer has one link,
 * and asking for a new one is asking for the old one to stop working — which is also how a collector
 * re-sends a specification that has changed. An upsert on the unique `offerId`, so there is never a
 * window with two live links. The raw token is returned as well as sealed, because the dialog that
 * pressed the button shows the address before any refetch lands.
 */
export async function createOfferSpecificationShareToken(
  ownerId: string,
  offerId: string
): Promise<{ token: string }> {
  await assertOfferOwner(ownerId, offerId);
  const spec = await readOfferSpecification(ownerId, offerId);
  if (!spec) throw new Error("Offer not found or access denied.");
  const rawToken = OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);
  const tokenSealed = sealShareToken(rawToken);
  const contentsHash = contentsHashOf(spec);
  await prisma.offerSpecificationShareToken.upsert({
    where: { offerId },
    create: { offerId, tokenHash, tokenSealed, contentsHash },
    update: {
      tokenHash,
      // Written on every regeneration, null included: a stale seal would show the address of the
      // link just replaced.
      tokenSealed,
      contentsHash,
      // A new link has never been opened.
      lastUsedAt: null,
      createdAt: new Date(),
    },
  });
  return { token: rawToken };
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
 * What a verified token authorises: one offer's specification, as it was when the link was made.
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
  /** The specification's contents when the link was made. */
  contentsHash: string;
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
  const hash = sha256(token);
  const row = await prisma.offerSpecificationShareToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      contentsHash: true,
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
    contentsHash: row.contentsHash,
  };
}

/**
 * What the buyer's page shows for a verified link.
 *
 * `current` carries the specification — the printable page's own read, unchanged since the link was
 * made. Otherwise only what the notice needs: the offer's number, so the buyer can name it to the
 * seller, and its language, so the notice is in it. Nothing of the contents.
 */
export type SharedOfferSpecification =
  | { standing: "current"; spec: OfferSpecification }
  | { standing: "changed" | "closed"; offerNo: number; language: string | null };

export async function readSharedOfferSpecification(
  access: OfferSpecificationShareAccess
): Promise<SharedOfferSpecification | null> {
  const spec = await readOfferSpecification(access.ownerId, access.offerId);
  if (!spec) return null;
  const standing = standingOf(spec, access.contentsHash);
  if (standing === "current") return { standing, spec };
  return { standing, offerNo: spec.offerNo, language: spec.language };
}

/**
 * Whether a photo is a thumbnail the shared specification shows — and so one its link may serve.
 *
 * Exactly the page's own choice, asked without rebuilding the page: the photo is the **front** of a
 * copy the specification lists, or its **back** where it has no front; and the copy is listed when
 * it is in one of this offer's sets that did not sell through it, and has not sold anywhere else
 * (`readOfferSpecification`'s two filters). Anything else — another scan of a listed copy, a copy
 * that has gone, a photo of anything else in the collection — is refused the way an invented id is,
 * and so is everything once the offer has closed, when the page shows no specification at all.
 *
 * It does **not** recompute whether the contents have changed — that is a whole specification read
 * per thumbnail — so a link whose offer changed while staying open still serves the thumbnails of
 * copies the offer still lists: pictures that link already showed.
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
          some: {
            offerSet: {
              offerId: access.offerId,
              saleLines: { none: {} },
              offer: { state: { notIn: [...CLOSED_OFFER_STATES] } },
            },
          },
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
