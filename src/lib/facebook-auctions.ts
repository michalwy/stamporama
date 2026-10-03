import "server-only";
import { prisma, type DbTransaction } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import type { FacebookStartingPriceMode } from "./facebook-group-rules";
import {
  describeFacebookAuctionCopies,
  type FacebookAuctionCopy,
} from "./facebook-post-rules";
import { makeOfferLabeller, orderedLabelItems, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { compactCatalogNumberGroups, type CatalogNumberGroupEntry } from "./offer-title-template";
import type { OfferState } from "./offer-rules";

// A Facebook auction offer (#1544; ADR-0061 §2, §3, §5) — the half the offers domain reads.
//
// An offer on Facebook is an **auction in one group**: it names the group (`Offer.facebookGroupId`),
// takes the group's defaults when it is created and owns them from then on. This module answers what
// `offers.ts` has to ask while it creates, edits and composes one — which group, which currency, which
// figures, and whether a copy is already in another Facebook auction — and reads the card the offer's
// own screen draws its kit from.
//
// It imports nothing from `offers.ts`, which imports it; the writes that go through the offer
// lifecycle (posting, activating) are `facebook-posts.ts`, on the far side of that edge.

/**
 * The states in which a Facebook auction holds its copies (ADR-0061 §5): it is up in its group.
 * Paused counts — a post taken down for a while still has bids under it — and a draft does not: a
 * collector preparing a second auction out of the same stamps competes for nothing until it goes up.
 */
export const FACEBOOK_AUCTION_HOLDING_STATES: readonly OfferState[] = ["active", "paused"];

/** A group as the offer form offers it: what a new auction there starts from. Money as 2-dp strings,
 *  the boundary's convention. */
export interface FacebookGroupChoice {
  id: string;
  name: string;
  archived: boolean;
  /** The group's own currency, else the platform's, else null when neither states one yet. */
  currency: string | null;
  startingPriceMode: FacebookStartingPriceMode | null;
  startingPriceValue: number | null;
  bidIncrement: string | null;
  auctionDays: number | null;
  closingTime: string | null;
}

/** What the offer form needs to know about a platform: whether it is Facebook, and its groups. */
export interface FacebookPlatformChoices {
  isFacebook: boolean;
  /** In use, by name — plus the one `includeGroupId` names when it is archived, so an existing
   *  offer's own group still reads as chosen. */
  groups: FacebookGroupChoice[];
}

export async function listFacebookGroupChoices(
  ownerId: string,
  collectionId: string,
  platformId: string,
  includeGroupId: string | null = null
): Promise<FacebookPlatformChoices> {
  const owned = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!owned) throw new Error("Collection not found");
  const platform = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { platformModule: true, platformCurrency: true },
  });
  if (platform?.platformModule !== FACEBOOK_PLATFORM_MODULE) return { isFacebook: false, groups: [] };
  const rows = await prisma.facebookGroup.findMany({
    where: {
      platformId,
      OR: [{ archivedAt: null }, ...(includeGroupId ? [{ id: includeGroupId }] : [])],
    },
    orderBy: { name: "asc" },
  });
  return {
    isFacebook: true,
    groups: rows.map((g) => ({
      id: g.id,
      name: g.name,
      archived: g.archivedAt !== null,
      currency: g.currency ?? platform.platformCurrency,
      startingPriceMode: g.startingPriceMode as FacebookStartingPriceMode | null,
      startingPriceValue: g.startingPriceValue?.toNumber() ?? null,
      bidIncrement: g.bidIncrement?.toFixed(2) ?? null,
      auctionDays: g.auctionDays,
      closingTime: g.closingTime,
    })),
  };
}

/** What an offer's Facebook half is, once resolved for a write. */
export type FacebookOfferResolution =
  | { ok: false; message: string }
  | {
      ok: true;
      /** Null on every platform that is not Facebook — and then everything below is null too. */
      facebookGroupId: string | null;
      bidIncrement: string | null;
      /** The group's own currency (ADR-0061 consequences, settled 2026-10-03: an auction in a group
       *  with a currency of its own is in that currency), or null for the platform's (#196). */
      currency: string | null;
      /** The group's starting price as a fallback for a blank submission — `amount` only, since a
       *  percentage of catalogue value is worked out by the form over the copies it was opened on. */
      defaultStartingPrice: string | null;
    };

/**
 * Resolve the Facebook half of an offer being created or edited on `platformId`.
 *
 * On Facebook the offer **must** name a group of that platform (ADR-0061 §1), and a new auction may
 * only name one in use — an archived group is offered to no new auction; an edit may keep the
 * archived group it already has. Off Facebook everything is null, so moving an offer to another
 * platform leaves nothing of Facebook on it.
 *
 * `create` decides whether the group's defaults are read at all: they are read once, when the offer
 * is made (§6), and an edit never re-applies them.
 */
export async function resolveFacebookOffer(
  collectionId: string,
  platform: { id: string; platformModule: string | null },
  input: { facebookGroupId?: string | null; bidIncrement?: string | null },
  mode: { create: boolean; currentGroupId?: string | null }
): Promise<FacebookOfferResolution> {
  if (platform.platformModule !== FACEBOOK_PLATFORM_MODULE) {
    return { ok: true, facebookGroupId: null, bidIncrement: null, currency: null, defaultStartingPrice: null };
  }
  const groupId = input.facebookGroupId?.trim() || null;
  if (!groupId) {
    return { ok: false, message: "Choose the Facebook group this auction is in." };
  }
  const group = await prisma.facebookGroup.findFirst({
    where: { id: groupId, collectionId, platformId: platform.id },
  });
  if (!group) return { ok: false, message: "That group is not one of this platform's groups." };
  if (group.archivedAt !== null && group.id !== mode.currentGroupId) {
    return {
      ok: false,
      message: `${group.name} is archived — restore it in Settings → Facebook to auction in it again.`,
    };
  }
  const submittedIncrement = input.bidIncrement?.trim() || null;
  return {
    ok: true,
    facebookGroupId: group.id,
    bidIncrement:
      submittedIncrement ?? (mode.create ? (group.bidIncrement?.toFixed(2) ?? null) : null),
    currency: group.currency,
    defaultStartingPrice:
      mode.create && group.startingPriceMode === "amount"
        ? (group.startingPriceValue?.toFixed(2) ?? null)
        : null,
  };
}

/**
 * Why these copies cannot go into a Facebook auction (ADR-0061 §5), or null: each that is already in
 * **another** Facebook auction that is up, in any group, named with the auction it is in.
 *
 * `excludeOfferId` is the auction being composed or activated — its own copies are not a collision
 * with itself. Asked only by a Facebook offer: an offer on another platform may hold a copy that is
 * also up for auction on Facebook, which is listing in two places and the collector's own business.
 */
export async function facebookAuctionRefusal(
  collectionId: string,
  excludeOfferId: string | null,
  itemIds: readonly string[]
): Promise<string | null> {
  if (itemIds.length === 0) return null;
  const rows = await prisma.offerSetItem.findMany({
    where: {
      itemId: { in: [...itemIds] },
      offerSet: {
        offer: {
          collectionId,
          facebookGroupId: { not: null },
          state: { in: [...FACEBOOK_AUCTION_HOLDING_STATES] },
          ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
        },
      },
    },
    select: {
      itemId: true,
      item: { select: { itemNo: true } },
      offerSet: { select: { offer: { select: { offerNo: true, facebookGroup: { select: { name: true } } } } } },
    },
  });
  if (rows.length === 0) return null;
  // One line per copy, in the order the caller named them: the refusal reads as the selection did.
  const byItem = new Map(rows.map((r) => [r.itemId, r]));
  const copies: FacebookAuctionCopy[] = [...new Set(itemIds)].flatMap((id) => {
    const row = byItem.get(id);
    return row
      ? [
          {
            itemNo: row.item.itemNo,
            offerNo: row.offerSet.offer.offerNo,
            groupName: row.offerSet.offer.facebookGroup?.name ?? "a Facebook group",
          },
        ]
      : [];
  });
  return describeFacebookAuctionCopies(copies);
}

/** The copies an offer holds now — what its activation is asked about. */
export async function offerItemIds(offerId: string): Promise<string[]> {
  const rows = await prisma.offerSetItem.findMany({
    where: { offerSet: { offerId } },
    select: { itemId: true },
  });
  return rows.map((r) => r.itemId);
}

/**
 * Take an offer out of its multi-lot post, inside the caller's transaction: the lots after it move up
 * one, and a post left with a single lot is **dissolved** — one offer is a post of its own, which
 * needs no row (ADR-0061 §2). A no-op for an offer in no post.
 */
export async function detachFacebookLot(tx: DbTransaction, offerId: string): Promise<void> {
  const offer = await tx.offer.findUnique({
    where: { id: offerId },
    select: { facebookPostId: true },
  });
  const postId = offer?.facebookPostId;
  if (!postId) return;
  await tx.offer.update({
    where: { id: offerId },
    data: { facebookPostId: null, facebookLotNo: null },
  });
  const rest = await tx.offer.findMany({
    where: { facebookPostId: postId },
    orderBy: { facebookLotNo: "asc" },
    select: { id: true },
  });
  if (rest.length < 2) {
    await tx.offer.updateMany({
      where: { facebookPostId: postId },
      data: { facebookPostId: null, facebookLotNo: null },
    });
    await tx.facebookPost.delete({ where: { id: postId } });
    return;
  }
  // Renumbered in two passes: the unique (post, lot) index would refuse a lot moved onto a number
  // the next one has not left yet.
  for (const [index, lot] of rest.entries()) {
    await tx.offer.update({ where: { id: lot.id }, data: { facebookLotNo: -1 - index } });
  }
  for (const [index, lot] of rest.entries()) {
    await tx.offer.update({ where: { id: lot.id }, data: { facebookLotNo: index + 1 } });
  }
}

// ── The kit ─────────────────────────────────────────────────────────────────────────────────────

/** One lot as the kit fills the template in with it. Figures raw; the card writes them out, since
 *  the closing time is a local time and only the browser knows the zone (#490). */
export interface FacebookKitLot {
  offerId: string;
  offerNo: number;
  /** Null for an offer posted alone. */
  lotNo: number | null;
  title: string;
  /** `{description}`: the offer's description, else its title. */
  description: string;
  /** `{catalog}`: every copy's catalogue number, compacted as a title's `{catalog}` is. */
  catalog: string;
  startingPrice: string | null;
  bidIncrement: string | null;
  currency: string;
  /** ISO-8601, or null. */
  endsAt: string | null;
  state: OfferState;
  /** The lot's own link — in a multi-lot post, the link of its photo. */
  url: string | null;
}

/** What the offer's Facebook card draws (ADR-0061 §3): the group, the post and its lots, and where
 *  the photos come from. Null on an offer that is not a Facebook auction. */
export interface FacebookOfferKit {
  group: { id: string; name: string; url: string; archived: boolean; postTemplate: string; standingNote: string };
  /** The multi-lot post this offer is a lot of, or null when it is posted alone. */
  post: { id: string; url: string | null } | null;
  /** The post's lots in lot order — or this offer alone. */
  lots: FacebookKitLot[];
  /** Where one click downloads the photos, in lot order: the offer's own archive when it is posted
   *  alone, the post's when it is a lot. */
  photoZipPath: string;
}

export async function getFacebookOfferKit(offerId: string): Promise<FacebookOfferKit | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      facebookPostId: true,
      facebookPost: { select: { id: true, url: true } },
      facebookGroup: {
        select: { id: true, name: true, url: true, archivedAt: true, postTemplate: true, standingNote: true },
      },
    },
  });
  if (!offer?.facebookGroup) return null;
  const lotRows = await prisma.offer.findMany({
    where: offer.facebookPostId ? { facebookPostId: offer.facebookPostId } : { id: offerId },
    orderBy: { facebookLotNo: "asc" },
    select: {
      id: true,
      offerNo: true,
      facebookLotNo: true,
      name: true,
      description: true,
      startingPrice: true,
      bidIncrement: true,
      currency: true,
      endsAt: true,
      state: true,
      url: true,
      sets: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          title: true,
          items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
        },
      },
    },
  });
  const labeller = await makeOfferLabeller(offer.collectionId);
  const lots = lotRows.map((row): FacebookKitLot => {
    const title = offerDisplayLabel(row.name, row.sets, labeller);
    const numbers = row.sets
      .flatMap((s) => orderedLabelItems(s.items))
      .map((li) => labeller.catalogOf(li.item.stamp))
      .filter((c): c is CatalogNumberGroupEntry => c !== null);
    return {
      offerId: row.id,
      offerNo: row.offerNo,
      lotNo: offer.facebookPostId ? row.facebookLotNo : null,
      title,
      description: row.description?.trim() || title,
      catalog: compactCatalogNumberGroups(numbers),
      startingPrice: row.startingPrice?.toFixed(2) ?? null,
      bidIncrement: row.bidIncrement?.toFixed(2) ?? null,
      currency: row.currency,
      endsAt: row.endsAt?.toISOString() ?? null,
      state: row.state as OfferState,
      url: row.url,
    };
  });
  const base = `/api/collections/${offer.collectionId}`;
  return {
    group: {
      id: offer.facebookGroup.id,
      name: offer.facebookGroup.name,
      url: offer.facebookGroup.url,
      archived: offer.facebookGroup.archivedAt !== null,
      postTemplate: offer.facebookGroup.postTemplate,
      standingNote: offer.facebookGroup.standingNote,
    },
    post: offer.facebookPost,
    lots,
    photoZipPath: offer.facebookPost
      ? `${base}/facebook-posts/${offer.facebookPost.id}/photos/zip`
      : `${base}/offers/${offerId}/photos/zip`,
  };
}
