import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import { readShareAddress, sealShareToken, type ShareAddress } from "./share-address";
import { zip, type ZipEntry } from "./zip";
import {
  OfferPhotoGenerationError,
  readOfferUploadPlans,
  readOfferUploadSet,
  type OfferPhotoGenerationStatus,
} from "./offer-photo-generation";
import type { OfferListingType, OfferState } from "./offer-rules";
import { DIRECT_PLATFORM_MODULE } from "./platform-modules";
import { DEFAULT_CURRENCY_STYLE, writtenAmount } from "./template-amount";
import { proposalLotPrice, proposalStatusOf, proposalTotal } from "./proposal-rules";
import { renderProposalMessage, unknownProposalMessagePlaceholders } from "./proposal-message-rules";
import {
  isProposalShareTokenShape,
  proposalDocumentMark,
  proposalDocumentStanding,
  proposalLotPhotoFileName,
  proposalPhotoArchiveName,
  PROPOSAL_SHARE_TOKEN_PREFIX,
  type ProposalDocumentMark,
  type ProposalDocumentStanding,
} from "./proposal-document-rules";

// **What a proposal's buyer is sent** (#2288) — the database half: the lots' photos (read for the
// screen, and as one archive), the message from the Direct platform's template, and the document with
// the link a buyer opens it by. The pure rules are `proposal-document-rules.ts` and
// `proposal-message-rules.ts`; what marks a proposal sent when any of these is made is
// `markProposalHandedOut` (`proposals.ts`).
//
// **Every one of them numbers the lots alike** — `Offer.proposalLotNo`, the number the proposal's
// screen shows — so the buyer's *I'll take 2, 5 and 7* means the same lots in all three.
//
// The link is a post's preview link (#2212) one table over, and the rule that holds it together is
// the same: **the token names one proposal, and nothing is ever read by any other key.**
// `verifyProposalShareToken` hands back an access value carrying the proposal id it resolved to, and
// the page and the photo route take that value rather than anything from the URL. What leaves this
// module for a buyer carries no ids of the collection's: a lot is keyed by its lot number.

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

const LOT_ORDER = [{ proposalLotNo: "asc" as const }, { offerNo: "asc" as const }];

/** The proposal with its lots in lot order and what every hand-out reads of them; null where it is
 *  gone. Unchecked — the callers have resolved the owner. */
async function readProposalHead(proposalId: string) {
  const row = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      proposalNo: true,
      collectionId: true,
      status: true,
      contact: { select: { name: true } },
      collection: { select: { ownerId: true, defaultLanguage: true, baseCurrency: true } },
      lots: {
        orderBy: LOT_ORDER,
        select: {
          id: true,
          offerNo: true,
          proposalLotNo: true,
          name: true,
          state: true,
          listingType: true,
          price: true,
          startingPrice: true,
          currency: true,
        },
      },
    },
  });
  if (!row) return null;
  const direct = await prisma.platform.findFirst({
    where: { collectionId: row.collectionId, platformModule: DIRECT_PLATFORM_MODULE },
    select: { titleLanguage: true, platformCurrency: true, proposalMessageTemplate: true },
  });
  const lots = row.lots.map((lot, index) => {
    const figures = {
      state: lot.state as OfferState,
      listingType: lot.listingType as OfferListingType,
      price: lot.price.toFixed(2),
      startingPrice: lot.startingPrice?.toFixed(2) ?? null,
    };
    return {
      offerId: lot.id,
      lotNo: lot.proposalLotNo ?? index + 1,
      title: lot.name?.trim() ?? "",
      currency: lot.currency,
      ...figures,
      offeredAt: proposalLotPrice(figures),
    };
  });
  return {
    proposalId: row.id,
    proposalNo: row.proposalNo,
    collectionId: row.collectionId,
    ownerId: row.collection.ownerId,
    status: proposalStatusOf(row.status),
    buyerName: row.contact.name,
    // The proposal's language: its platform's listing language, else the collection's, as a post's is.
    language: normalizeLanguage(direct?.titleLanguage) ?? normalizeLanguage(row.collection.defaultLanguage),
    currency: lots[0]?.currency ?? direct?.platformCurrency ?? row.collection.baseCurrency,
    template: direct?.proposalMessageTemplate ?? null,
    lots,
  };
}

type ProposalHead = NonNullable<Awaited<ReturnType<typeof readProposalHead>>>;

/** The proposal is the caller's — and in `collectionId`, where one is named — or this throws. */
async function assertProposalOwner(ownerId: string, proposalId: string, collectionId?: string): Promise<{ collectionId: string }> {
  const row = await prisma.proposal.findFirst({
    where: { id: proposalId, collection: { ownerId }, ...(collectionId ? { collectionId } : {}) },
    select: { collectionId: true },
  });
  if (!row) throw new Error("Proposal not found or access denied.");
  return row;
}

// ── The photos ──────────────────────────────────────────────────────────────────────────────────

/** One lot's photos as the proposal's screen shows them: its upload set by the offer photo rules,
 *  each under the name the archive gives it, and where its photo run stands. */
export interface ProposalLotPhotos {
  offerId: string;
  lotNo: number;
  status: OfferPhotoGenerationStatus | null;
  images: { photoId: string; fileName: string }[];
}

/** Every lot's photos, in lot order, in a few reads whatever the number of lots (#2222's read) — or,
 *  with `only`, those lots' alone: what the screen refreshes one lot by (#2313). */
export async function readProposalPhotos(
  ownerId: string,
  proposalId: string,
  collectionId?: string,
  only?: readonly string[]
): Promise<ProposalLotPhotos[]> {
  await assertProposalOwner(ownerId, proposalId, collectionId);
  const head = await readProposalHead(proposalId);
  if (!head) return [];
  const lots = only ? head.lots.filter((lot) => only.includes(lot.offerId)) : head.lots;
  const plans = await readOfferUploadPlans(
    ownerId,
    lots.map((lot) => lot.offerId)
  );
  return lots.map((lot) => {
    const read = plans.get(lot.offerId);
    const images = !read || "reason" in read.plan ? [] : read.plan.images;
    return {
      offerId: lot.offerId,
      lotNo: lot.lotNo,
      status: read?.status ?? null,
      images: images.map((image) => ({
        photoId: image.photoId,
        fileName: proposalLotPhotoFileName(lot.lotNo, image.fileName),
      })),
    };
  });
}

/**
 * The lots' photos as one ZIP, in lot order: every lot still offered — not withdrawn — with its upload
 * set, each file named for its lot (`lot-02-…`), flat, as a post's archive is (#1544). A lot with
 * nothing to upload is left out; the archive is refused only when no lot has anything.
 *
 * @throws {OfferPhotoGenerationError} when no lot has images to upload.
 */
export async function buildProposalPhotoArchive(
  ownerId: string,
  proposalId: string,
  collectionId?: string
): Promise<{ fileName: string; bytes: Buffer }> {
  try {
    await assertProposalOwner(ownerId, proposalId, collectionId);
  } catch {
    throw new OfferPhotoGenerationError("Proposal not found.");
  }
  const head = await readProposalHead(proposalId);
  if (!head) throw new OfferPhotoGenerationError("Proposal not found.");
  const offered = head.lots.filter((lot) => lot.state !== "withdrawn");
  const sets = await Promise.all(offered.map((lot) => readOfferUploadSet(ownerId, lot.offerId)));
  const entries: ZipEntry[] = [];
  sets.forEach((set, index) => {
    if ("reason" in set) return;
    for (const image of set.images) {
      entries.push({ name: proposalLotPhotoFileName(offered[index].lotNo, image.fileName), contents: image.bytes });
    }
  });
  if (entries.length === 0) {
    throw new OfferPhotoGenerationError("None of this proposal's lots has photos to send — generate them first.");
  }
  return { fileName: proposalPhotoArchiveName(head.proposalNo), bytes: zip(entries) };
}

// ── The message ─────────────────────────────────────────────────────────────────────────────────

/** The message as the proposal's screen shows it: the text, or null where the Direct platform has no
 *  template — then nothing is generated (#1692) — and the template's tokens that are not
 *  placeholders, which stay as typed. */
export interface ProposalMessage {
  text: string | null;
  unknownPlaceholders: string[];
}

function messageOf(head: ProposalHead): ProposalMessage {
  const offered = head.lots.filter((lot) => lot.state !== "withdrawn");
  return {
    text: renderProposalMessage(head.template, {
      proposalNo: head.proposalNo,
      buyerName: head.buyerName,
      currency: head.currency,
      lots: offered.map((lot) => ({ lotNo: lot.lotNo, title: lot.title, price: lot.offeredAt })),
      total: proposalTotal(head.lots).total,
    }),
    unknownPlaceholders: head.template ? unknownProposalMessagePlaceholders(head.template) : [],
  };
}

export async function readProposalMessage(
  ownerId: string,
  proposalId: string,
  collectionId?: string
): Promise<ProposalMessage> {
  await assertProposalOwner(ownerId, proposalId, collectionId);
  const head = await readProposalHead(proposalId);
  if (!head) throw new Error("Proposal not found.");
  return messageOf(head);
}

// ── The document ────────────────────────────────────────────────────────────────────────────────

/** One lot as the document shows it. */
export interface ProposalDocumentLot {
  /** What it goes by on the page, in place of its offer's id. */
  key: string;
  lotNo: number;
  /** The offer's title; empty where it has none, and the lot's number names it alone. */
  title: string;
  /** What it is offered at, written with its currency; null while it has no price. */
  price: string | null;
  mark: ProposalDocumentMark;
  /** Its upload set, in order. */
  photoIds: string[];
}

/** What the document draws. `lots` only while it is `shown`. */
export interface ProposalDocument {
  proposalNo: number;
  /** The proposal's language — the Direct platform's listing language, else the collection's. */
  language: string | null;
  standing: ProposalDocumentStanding;
  lots: ProposalDocumentLot[];
  /** The lots not withdrawn at their prices, written with the currency (`proposalTotal`). */
  total: string;
  /** How many of those have no price yet, which the total leaves out. */
  unpriced: number;
}

async function buildDocument(ownerId: string, head: ProposalHead): Promise<ProposalDocument> {
  const standing = proposalDocumentStanding(head.status);
  const base = { proposalNo: head.proposalNo, language: head.language, standing };
  const { total, unpriced } = proposalTotal(head.lots);
  const written = (amount: string) => writtenAmount(amount, head.currency, DEFAULT_CURRENCY_STYLE);
  if (standing !== "shown") return { ...base, lots: [], total: written(total), unpriced };

  const plans = await readOfferUploadPlans(
    ownerId,
    head.lots.map((lot) => lot.offerId)
  );
  return {
    ...base,
    total: written(total),
    unpriced,
    lots: head.lots.map((lot): ProposalDocumentLot => {
      const plan = plans.get(lot.offerId)?.plan;
      const mark = proposalDocumentMark(lot.state);
      return {
        key: `lot-${lot.lotNo}`,
        lotNo: lot.lotNo,
        title: lot.title,
        price: lot.offeredAt ? writtenAmount(lot.offeredAt, lot.currency, DEFAULT_CURRENCY_STYLE) : null,
        mark,
        // A lot no longer offered shows no photos: there is nothing of it to look at.
        photoIds: mark === "unavailable" || !plan || "reason" in plan ? [] : plan.images.map((image) => image.photoId),
      };
    }),
  };
}

/** The document as the collector's printable page draws it. Null for somebody else's proposal or one
 *  that is gone. */
export async function readProposalDocument(
  ownerId: string,
  proposalId: string,
  collectionId?: string
): Promise<ProposalDocument | null> {
  try {
    await assertProposalOwner(ownerId, proposalId, collectionId);
  } catch {
    return null;
  }
  const head = await readProposalHead(proposalId);
  return head ? buildDocument(ownerId, head) : null;
}

// ── The collector's side of the link ────────────────────────────────────────────────────────────

/** A proposal's link as the collector's dialog reads it — the address included (#681). */
export interface ProposalShareLinkData {
  address: ShareAddress;
  createdAt: string;
  /** When a buyer last opened it, or null if nobody has. */
  lastUsedAt: string | null;
}

/** What the collector's dialog reads: the link, if there is one, what a buyer opening it sees now,
 *  and the proposal's language, which the page speaks. */
export interface ProposalShareState {
  link: ProposalShareLinkData | null;
  standing: ProposalDocumentStanding;
  language: string | null;
}

export async function readProposalShareState(
  ownerId: string,
  proposalId: string,
  collectionId?: string
): Promise<ProposalShareState> {
  await assertProposalOwner(ownerId, proposalId, collectionId);
  const [row, head] = await Promise.all([
    prisma.proposalShareToken.findUnique({
      where: { proposalId },
      select: { tokenSealed: true, createdAt: true, lastUsedAt: true },
    }),
    readProposalHead(proposalId),
  ]);
  return {
    standing: proposalDocumentStanding(head?.status ?? null),
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
 * Mint the proposal's link, replacing any it had. **Minting and regenerating are one act**: a
 * proposal has one link, and asking for a new one is asking for the old one to stop working. An
 * upsert on the unique `proposalId`, so there is never a window with two live links. A closed
 * proposal gets none — there is nothing to show the buyer but a notice.
 */
export async function createProposalShareToken(ownerId: string, proposalId: string): Promise<{ token: string }> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  const head = await readProposalHead(proposalId);
  if (!head || proposalDocumentStanding(head.status) !== "shown") {
    throw new Error("This proposal is closed — a buyer opening a link would see only that.");
  }
  const rawToken = PROPOSAL_SHARE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);
  const tokenSealed = sealShareToken(rawToken);
  const language = head.language;
  await prisma.proposalShareToken.upsert({
    where: { proposalId },
    create: { collectionId, proposalId, tokenHash, tokenSealed, language },
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
export async function revokeProposalShareToken(ownerId: string, proposalId: string): Promise<void> {
  await assertProposalOwner(ownerId, proposalId);
  await prisma.proposalShareToken.deleteMany({ where: { proposalId } });
}

// ── The buyer's side ────────────────────────────────────────────────────────────────────────────

/**
 * What a verified token authorises: one proposal's document. `proposalId` is null once the proposal is
 * gone — the page then says only that the offer is closed, in `language`. The ids here are the only
 * ones the page and the photo route use, resolved from the token's own row.
 */
export interface ProposalShareAccess {
  proposalId: string | null;
  ownerId: string;
  collectionId: string;
  language: string | null;
}

/**
 * Resolve a raw token, or null when it is not a live link. The prefix is checked before anything is
 * hashed. `touch` — the page's serve, not each photo — records the visit and the proposal's language
 * as it reads now, which is what the notice speaks once the proposal is gone.
 */
export async function verifyProposalShareToken(
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {}
): Promise<ProposalShareAccess | null> {
  const token = rawToken.trim();
  if (!isProposalShareTokenShape(token)) return null;
  const hash = sha256(token);
  const row = await prisma.proposalShareToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      proposalId: true,
      language: true,
      collectionId: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;

  let language = row.language;
  if (options.touch ?? true) {
    const head = row.proposalId ? await readProposalHead(row.proposalId) : null;
    if (head) language = head.language;
    await prisma.proposalShareToken.update({
      where: { id: row.id },
      data: { lastUsedAt: options.now ?? new Date(), language },
    });
  }
  return { proposalId: row.proposalId, ownerId: row.collection.ownerId, collectionId: row.collectionId, language };
}

/** What the buyer's page shows: the document while the proposal is open, else only the notice. */
export type SharedProposalDocument =
  | { standing: "shown"; document: ProposalDocument }
  | { standing: "closed"; proposalNo: number | null; language: string | null };

export async function readSharedProposalDocument(access: ProposalShareAccess): Promise<SharedProposalDocument> {
  const head = access.proposalId ? await readProposalHead(access.proposalId) : null;
  if (!head || head.collectionId !== access.collectionId) {
    return { standing: "closed", proposalNo: null, language: access.language };
  }
  const document = await buildDocument(access.ownerId, head);
  if (document.standing === "shown") return { standing: "shown", document };
  return { standing: "closed", proposalNo: document.proposalNo, language: document.language };
}

/**
 * Whether a photo is one the shared document may serve: while the proposal is open, a generated image
 * of one of its lots still offered — an image of its upload plan. Anything else — a copy's own scan,
 * another offer's image, a photo of anything else in the collection — is refused the way an invented
 * id is, and so is everything once the page shows only the notice.
 *
 * As a post's preview does (#2212), it does not rebuild each lot's upload plan per photo, so an image
 * held back from a lot's upload is served if asked for: a picture of the same stamps the page shows.
 */
export async function canServeProposalSharePhoto(access: ProposalShareAccess, photoId: string): Promise<boolean> {
  if (!access.proposalId) return false;
  const proposal = await prisma.proposal.findFirst({
    where: { id: access.proposalId, collectionId: access.collectionId },
    select: { status: true },
  });
  if (!proposal || proposalDocumentStanding(proposalStatusOf(proposal.status)) !== "shown") {
    return false;
  }
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      offerPhotoEntry: {
        offer: { proposalId: access.proposalId, collectionId: access.collectionId, state: { not: "withdrawn" } },
      },
    },
    select: { id: true },
  });
  return photo !== null;
}
