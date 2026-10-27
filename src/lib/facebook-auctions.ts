import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import {
  effectiveFacebookGroupSettings,
  toFacebookMultiLotLayout,
  type FacebookEffectiveSettings,
  type FacebookGroupSetting,
  type FacebookMultiLotLayout,
  type FacebookStartingPriceMode,
} from "./facebook-group-rules";
import { readFacebookDefaults, toCustomSettings, toPostingSettings } from "./facebook-groups";
import {
  describeFacebookAuctionCopies,
  facebookLayoutLotTemplate,
  facebookMixedTypesRefusal,
  isFacebookLotPosted,
  readFacebookFrozenLot,
  type FacebookAuctionCopy,
  type FacebookFrozenLot,
} from "./facebook-post-rules";
import { makeOfferLabeller, orderedLabelItems, STAMP_LABEL_SELECT } from "./offer-labels";
import { offerDisplayLabel } from "./offer-set-rules";
import { compactCatalogNumberGroups, type CatalogNumberGroupEntry } from "./offer-title-template";
import { catalogSortKeyOf, compareCatalogSortKeys } from "./catalog-sort-key";
import { isAuctionListing, normalizeListingType, type OfferListingType, type OfferState } from "./offer-rules";
import { DEFAULT_CURRENCY_STYLE } from "./template-amount";

// A Facebook offer (#1544; ADR-0061 §2, §3, §5) — the half the offers domain reads.
//
// An offer on Facebook is **in one group**: it names the group (`Offer.facebookGroupId`), takes the
// group's defaults when it is created and owns them from then on. It is an auction or, since #1671, a
// quick buy — the group says which a new one starts as, and the offer can change it. This module answers what
// `offers.ts` has to ask while it creates, edits and composes one — which group, which currency, which
// figures, and whether a copy is already in another Facebook auction — and reads the card the offer's
// own screen draws its kit from.
//
// It imports nothing from `offers.ts`, which imports it; the writes that go through the offer
// lifecycle (posting, activating) are `facebook-posts.ts`, on the far side of that edge.

/**
 * The states in which a Facebook auction holds its copies (ADR-0061 §5): it is up in its group.
 * Paused counts — a post taken down for a while still has bids under it — and so does Pending (#1778),
 * a post the group's administrator may approve at any moment. A draft does not: a collector preparing
 * a second auction out of the same stamps competes for nothing until it goes up.
 */
export const FACEBOOK_AUCTION_HOLDING_STATES: readonly OfferState[] = ["pending", "active", "paused"];

/** A group row's settings as it posts with them: its own where it holds one, the platform's
 *  otherwise (#1661). The one place a group row is read for its settings. */
function groupSettings(
  row: Parameters<typeof toPostingSettings>[0] & { currency: string | null; customSettings: string[] },
  platform: Awaited<ReturnType<typeof readFacebookDefaults>>
): FacebookEffectiveSettings {
  return effectiveFacebookGroupSettings(
    { ...toPostingSettings(row), currency: row.currency, custom: toCustomSettings(row.customSettings) },
    platform
  );
}

/** A group's settings as they read now — its own, or Facebook's it follows (#1661). */
export async function readFacebookGroupSettings(groupId: string): Promise<FacebookEffectiveSettings> {
  const group = await prisma.facebookGroup.findUniqueOrThrow({ where: { id: groupId } });
  return groupSettings(group, await readFacebookDefaults(group.platformId));
}

/** A group as the offer form offers it: what a new auction there starts from. Money as 2-dp strings,
 *  the boundary's convention. */
export interface FacebookGroupChoice {
  id: string;
  name: string;
  archived: boolean;
  /** How a new offer here is sold (#1671) — the group's own, or Facebook's it follows. */
  listingType: OfferListingType;
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
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, collectionId },
    select: { platformModule: true, platformCurrency: true },
  });
  if (platform?.platformModule !== FACEBOOK_PLATFORM_MODULE) return { isFacebook: false, groups: [] };
  const [rows, defaults] = await Promise.all([
    prisma.facebookGroup.findMany({
      where: {
        platformId,
        OR: [{ archivedAt: null }, ...(includeGroupId ? [{ id: includeGroupId }] : [])],
      },
      orderBy: { name: "asc" },
    }),
    readFacebookDefaults(platformId),
  ]);
  return {
    isFacebook: true,
    groups: rows.map((g) => {
      const settings = groupSettings(g, defaults);
      return {
        id: g.id,
        name: g.name,
        archived: g.archivedAt !== null,
        listingType: settings.listingType,
        currency: settings.currency ?? platform.platformCurrency,
        startingPriceMode: settings.startingPriceMode,
        startingPriceValue: settings.startingPriceValue,
        bidIncrement: settings.bidIncrement?.toFixed(2) ?? null,
        auctionDays: settings.auctionDays,
        closingTime: settings.closingTime,
      };
    }),
  };
}

/** What an offer's Facebook half is, once resolved for a write. */
export type FacebookOfferResolution =
  | { ok: false; message: string }
  | {
      ok: true;
      /** Null on every platform that is not Facebook — and then everything below is null too. */
      facebookGroupId: string | null;
      /** How a new offer in the group is sold when the form says nothing (#1671) — on create only. */
      listingType: OfferListingType | null;
      /** The increment, whatever the offer's type: the caller drops it on a quick buy, once the
       *  type is resolved. */
      bidIncrement: string | null;
      /** The group's own currency (ADR-0061 consequences, settled 2026-10-03: an auction in a group
       *  with a currency of its own is in that currency), or null for the platform's (#196). */
      currency: string | null;
      /** The group's starting price as a fallback for a blank submission — `amount` only, since a
       *  percentage of catalogue value is worked out by the form over the copies it was opened on. */
      defaultStartingPrice: string | null;
      /** The group's starting price as a share of the copies' catalogue value, in percent — `catalogPercent`
       *  only, on create only. The offer's own creation works it out over the copies it is seeded with
       *  (#1663), the figure a shortcut with no form has nowhere else to come from. */
      startingPricePercent: number | null;
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
    return {
      ok: true,
      facebookGroupId: null,
      listingType: null,
      bidIncrement: null,
      currency: null,
      defaultStartingPrice: null,
      startingPricePercent: null,
    };
  }
  const groupId = input.facebookGroupId?.trim() || null;
  if (!groupId) {
    return { ok: false, message: "Choose the Facebook group this offer is in." };
  }
  const group = await prisma.facebookGroup.findFirst({
    where: { id: groupId, collectionId, platformId: platform.id },
  });
  if (!group) return { ok: false, message: "That group is not one of this platform's groups." };
  if (group.archivedAt !== null && group.id !== mode.currentGroupId) {
    return {
      ok: false,
      message: `${group.name} is archived — restore it in Settings → Facebook to post in it again.`,
    };
  }
  const settings = groupSettings(group, await readFacebookDefaults(group.platformId));
  const submittedIncrement = input.bidIncrement?.trim() || null;
  return {
    ok: true,
    facebookGroupId: group.id,
    listingType: mode.create ? settings.listingType : null,
    bidIncrement:
      submittedIncrement ?? (mode.create ? (settings.bidIncrement?.toFixed(2) ?? null) : null),
    currency: settings.currency,
    defaultStartingPrice:
      mode.create && settings.startingPriceMode === "amount"
        ? (settings.startingPriceValue?.toFixed(2) ?? null)
        : null,
    startingPricePercent:
      mode.create && settings.startingPriceMode === "catalogPercent" ? settings.startingPriceValue : null,
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

/** Whether a group's posts may mix auctions and quick buys (#1671) — its own setting, or Facebook's. */
export async function facebookGroupMixesTypes(groupId: string): Promise<boolean> {
  const group = await prisma.facebookGroup.findUniqueOrThrow({ where: { id: groupId } });
  return groupSettings(group, await readFacebookDefaults(group.platformId)).mixedListingTypes;
}

/**
 * Why a lot of a post cannot become `listingType` while it stays in the post (#1671), or null: in a
 * group keeping one type per post, it would leave the post holding both. The lot leaves the post
 * first, or the group's posts are allowed to mix.
 */
export async function facebookLotTypeRefusal(
  postId: string,
  offerId: string,
  listingType: OfferListingType
): Promise<string | null> {
  const post = await prisma.facebookPost.findUniqueOrThrow({
    where: { id: postId },
    select: { groupId: true, lots: { select: { id: true, offerNo: true, listingType: true } } },
  });
  if (await facebookGroupMixesTypes(post.groupId)) return null;
  const lots = post.lots.map((lot) => ({
    offerNo: lot.offerNo,
    listingType: lot.id === offerId ? listingType : normalizeListingType(lot.listingType),
  }));
  return facebookMixedTypesRefusal(lots)
    ? "This offer is a lot of a post whose lots share one listing type — take it out of the post before changing its type, or let the group's posts mix types in Settings → Facebook."
    : null;
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
 * Take an offer out of its post, inside the caller's transaction: the lots after it move up one, and a
 * post left with no lot is deleted — its number is never given again. A post left with one lot stays,
 * a post of one with the title it had (#2116; until then one not yet up was dissolved): every Facebook
 * offer is in a post. Where the offer goes is the caller's — into another post, a new post of one
 * (`removeFacebookLot`), off Facebook or nowhere, deleted. A no-op for an offer in no post.
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
  if (rest.length === 0) {
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
  /** Null for an offer posted alone — in no post yet, or the one lot of its post (#1989). */
  lotNo: number | null;
  /** Which template the lot's text is built from (#1671): an auction's, or a quick buy's. */
  listingType: OfferListingType;
  /** `{title}`: the offer's display title. */
  title: string;
  /** `{description}`: the offer's description, empty when it has none — never its title (#1692). */
  description: string;
  /** `{catalog}`, retired (#1671) but still filled in: every copy's catalogue number, compacted as a
   *  title's `{catalog}` is. */
  catalog: string;
  /** The lowest of its copies' catalogue numbers as a sort key (`catalogSortKeyOf`), null when none
   *  carries one — what *Sort by catalogue number* orders a post by (#1986). */
  catalogSortKey: string | null;
  startingPrice: string | null;
  bidIncrement: string | null;
  currency: string;
  /** ISO-8601, or null. */
  endsAt: string | null;
  state: OfferState;
  /** The lot's listing link — the post's, or in a multi-lot post its own photo's where it has one. */
  url: string | null;
  /** An auction's standing bid typed while it runs (#1545), `0.00` when none is, and when it was
   *  recorded; a quick buy's asking price (#1671). */
  price: string;
  priceCheckedAt: string | null;
  /** The offer's own post template (#1780), written for its type — null follows the group's. */
  ownTemplate: string | null;
  /** The lot as it was published (#1800), drawn instead of the fields above once it has gone up;
   *  null while it has not. */
  frozen: FacebookFrozenLot | null;
}

/** What the offer's Facebook card draws (ADR-0061 §3): the group, the post and its lots, and where
 *  the photos come from. Null on an offer that is not on Facebook. */
export interface FacebookOfferKit {
  /** The collection the post is in — what a lot's photos are read and drawn through (#1848). */
  collectionId: string;
  group: {
    id: string;
    name: string;
    url: string;
    archived: boolean;
    /** An auction's post template. */
    postTemplate: string;
    /** A quick buy's post template (#1671). */
    quickBuyTemplate: string;
    standingNote: string;
    /** The settings the group holds as its own (#1661) — the rest it follows from Facebook's — so the
     *  card links a missing template or note to where it is set (#1692). */
    custom: FacebookGroupSetting[];
    /** How the group lays out a post of several lots, and a captioned post's templates (#1841). */
    multiLotLayout: FacebookMultiLotLayout;
    auctionCaptionTemplate: string;
    quickBuyCaptionTemplate: string;
    captionPostTemplate: string;
  };
  /** The post this offer is a lot of — of several lots, or of this offer alone once it is published
   *  (#1989) — or null for an offer in no post yet. Its link is each
   *  lot's own `url` (#1668), so the post carries none. `postNo` is its short number (#1842), what its
   *  screen is reached by; `title` its title (#1862), null on a post made before titles until it is
   *  given one; `layout` is the post's own choice (#1841), or null while it follows its group's. */
  post: { id: string; postNo: number; title: string | null; layout: FacebookMultiLotLayout | null } | null;
  /** How the post is laid out now (#1841): the post's own choice, else its group's; always `text` for
   *  an offer posted alone, its post holding one lot or none yet. A published post is drawn in the
   *  layout it went up in, which its frozen lots carry. */
  layout: FacebookMultiLotLayout;
  /** The post's lots in lot order — or this offer alone. A post of one lot reads as an offer posted
   *  alone (#1989): its lot carries no number, so `{lot}` is empty. */
  lots: FacebookKitLot[];
  /** Where one click downloads the photos, in lot order: the post's archive whenever the offer is in a
   *  post — of one lot too (#2133), named by the post with `lot-NN-…` files — one photo per lot in a
   *  captioned post (#1841); the offer's own archive only for an offer in no post. */
  photoZipPath: string;
}

/** How a post is laid out (#1841): its own choice, else its group's. An offer posted alone — in no
 *  post yet, or the one lot of its post (#1989) — is no post of several lots and always `text`. */
export function facebookPostLayout(
  post: { layout: string | null; lotCount: number } | null,
  settings: Pick<FacebookEffectiveSettings, "multiLotLayout">
): FacebookMultiLotLayout {
  if (!post || post.lotCount < 2) return "text";
  return post.layout === null ? settings.multiLotLayout : toFacebookMultiLotLayout(post.layout);
}

/** What a lot's text is built from, read for a kit or a freeze (#1800). */
const KIT_LOT_SELECT = {
  id: true,
  offerNo: true,
  facebookLotNo: true,
  facebookPostId: true,
  listingType: true,
  name: true,
  description: true,
  startingPrice: true,
  bidIncrement: true,
  currency: true,
  endsAt: true,
  state: true,
  url: true,
  price: true,
  priceCheckedAt: true,
  facebookPostTemplate: true,
  facebookPostSnapshot: true,
  sets: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      title: true,
      items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
    },
  },
} satisfies Prisma.OfferSelect;

/** The lots of one collection as their post is written from them, in lot order — and, by the post's
 *  screen, the offers that could join it as further lots (#1870), read the same way. */
export async function readKitLots(collectionId: string, where: Prisma.OfferWhereInput): Promise<FacebookKitLot[]> {
  const rows = await prisma.offer.findMany({
    where: { ...where, collectionId },
    orderBy: [{ facebookLotNo: "asc" }, { offerNo: "asc" }],
    select: KIT_LOT_SELECT,
  });
  if (rows.length === 0) return [];
  const labeller = await makeOfferLabeller(collectionId);
  return rows.map((row): FacebookKitLot => {
    const title = offerDisplayLabel(row.name, row.sets, labeller);
    const numbers = row.sets
      .flatMap((s) => orderedLabelItems(s.items))
      .map((li) => labeller.catalogOf(li.item.stamp))
      .filter((c): c is CatalogNumberGroupEntry => c !== null);
    return {
      offerId: row.id,
      offerNo: row.offerNo,
      lotNo: row.facebookPostId ? row.facebookLotNo : null,
      listingType: normalizeListingType(row.listingType),
      title,
      description: row.description?.trim() ?? "",
      catalog: compactCatalogNumberGroups(numbers),
      catalogSortKey:
        numbers.map((n) => catalogSortKeyOf(n.number)).sort(compareCatalogSortKeys)[0] ?? null,
      startingPrice: row.startingPrice?.toFixed(2) ?? null,
      bidIncrement: row.bidIncrement?.toFixed(2) ?? null,
      currency: row.currency,
      endsAt: row.endsAt?.toISOString() ?? null,
      state: row.state as OfferState,
      url: row.url,
      price: row.price.toFixed(2),
      priceCheckedAt: row.priceCheckedAt?.toISOString() ?? null,
      ownTemplate: row.facebookPostTemplate,
      frozen: readFacebookFrozenLot(row.facebookPostSnapshot),
    };
  });
}

/** `lotOnly` reads the offer's own lot and no other (#2221) — what its post's screen refreshes one lot
 *  by — the post-wide part, its layout included, still the whole post's. */
export async function getFacebookOfferKit(
  offerId: string,
  { lotOnly = false }: { lotOnly?: boolean } = {}
): Promise<FacebookOfferKit | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      facebookPostId: true,
      facebookPost: { select: { id: true, postNo: true, title: true, layout: true } },
      facebookGroup: true,
    },
  });
  if (!offer?.facebookGroup) return null;
  const lots = await readKitLots(
    offer.collectionId,
    offer.facebookPostId && !lotOnly ? { facebookPostId: offer.facebookPostId } : { id: offerId }
  );
  const lotCount =
    lotOnly && offer.facebookPostId
      ? await prisma.offer.count({ where: { facebookPostId: offer.facebookPostId } })
      : lots.length;
  // A post of one lot is written as an offer posted alone is (#1989): no lot number, so `{lot}` stays
  // empty and nothing is named as missing for it.
  const alone = lotCount < 2;
  if (alone) for (const lot of lots) lot.lotNo = null;
  const base = `/api/collections/${offer.collectionId}`;
  // The post reads as the group posts now — its own template, or the platform's it follows (#1661).
  // A lot already published is drawn from its snapshot instead (#1800); these are for the rest, and
  // for a repost, which puts the current template up again.
  const settings = groupSettings(
    offer.facebookGroup,
    await readFacebookDefaults(offer.facebookGroup.platformId)
  );
  return {
    collectionId: offer.collectionId,
    group: {
      id: offer.facebookGroup.id,
      name: offer.facebookGroup.name,
      url: offer.facebookGroup.url,
      archived: offer.facebookGroup.archivedAt !== null,
      postTemplate: settings.postTemplate,
      quickBuyTemplate: settings.quickBuyTemplate,
      standingNote: settings.standingNote,
      custom: toCustomSettings(offer.facebookGroup.customSettings),
      multiLotLayout: settings.multiLotLayout,
      auctionCaptionTemplate: settings.auctionCaptionTemplate,
      quickBuyCaptionTemplate: settings.quickBuyCaptionTemplate,
      captionPostTemplate: settings.captionPostTemplate,
    },
    post: offer.facebookPost
      ? {
          id: offer.facebookPost.id,
          postNo: offer.facebookPost.postNo,
          title: offer.facebookPost.title,
          layout: offer.facebookPost.layout === null ? null : toFacebookMultiLotLayout(offer.facebookPost.layout),
        }
      : null,
    layout: facebookPostLayout(
      offer.facebookPost && { layout: offer.facebookPost.layout, lotCount },
      settings
    ),
    lots,
    photoZipPath: offer.facebookPost
      ? `${base}/facebook-posts/${offer.facebookPost.id}/photos/zip`
      : `${base}/offers/${offerId}/photos/zip`,
  };
}

// ── The post as published (#1800) ───────────────────────────────────────────────────────────────

/**
 * Freeze the post text of these offers as it reads **now** (#1800): each lot's template — its own, or
 * its group's for its type; in a captioned post (#1841) its caption's, with the post's shared text and
 * the layout itself — the group's note, the post's title (#1862) and the lot's figures, written into
 * `Offer.facebookPostSnapshot` and drawn instead of the live ones from then on. Called when an offer
 * first goes up (Pending or Active, whichever comes first) and by a repost, which puts the current
 * text up again.
 *
 * Offers off Facebook are skipped. `onlyUnfrozen` leaves a lot that already has a snapshot as it is —
 * the transition's case, where approving a pending post or resuming a paused one is no new
 * publication; a repost passes false and takes every lot it names afresh.
 */
export async function freezeFacebookPostText(
  offerIds: readonly string[],
  { onlyUnfrozen }: { onlyUnfrozen: boolean }
): Promise<number> {
  if (offerIds.length === 0) return 0;
  const targets = await prisma.offer.findMany({
    where: {
      id: { in: [...offerIds] },
      facebookGroupId: { not: null },
      ...(onlyUnfrozen ? { facebookPostSnapshot: { equals: Prisma.DbNull } } : {}),
    },
    select: {
      id: true,
      collectionId: true,
      facebookGroupId: true,
      facebookPost: { select: { layout: true, title: true, _count: { select: { lots: true } } } },
    },
  });
  const now = new Date().toISOString();
  const settingsByGroup = new Map<string, FacebookEffectiveSettings>();
  let frozen = 0;
  for (const collectionId of new Set(targets.map((t) => t.collectionId))) {
    const ids = targets.filter((t) => t.collectionId === collectionId).map((t) => t.id);
    const lots = await readKitLots(collectionId, { id: { in: ids } });
    for (const lot of lots) {
      const target = targets.find((t) => t.id === lot.offerId)!;
      const groupId = target.facebookGroupId!;
      if (!settingsByGroup.has(groupId)) settingsByGroup.set(groupId, await readFacebookGroupSettings(groupId));
      const settings = settingsByGroup.get(groupId)!;
      const post = target.facebookPost;
      const layout = facebookPostLayout(post && { layout: post.layout, lotCount: post._count.lots }, settings);
      const snapshot: FacebookFrozenLot = {
        frozenAt: now,
        listingType: lot.listingType,
        template: facebookLayoutLotTemplate(
          layout,
          { auction: settings.postTemplate, quickBuy: settings.quickBuyTemplate },
          {
            auction: settings.auctionCaptionTemplate,
            quickBuy: settings.quickBuyCaptionTemplate,
            post: settings.captionPostTemplate,
          },
          { listingType: lot.listingType, ownTemplate: lot.ownTemplate }
        ),
        standingNote: settings.standingNote,
        title: lot.title,
        description: lot.description,
        catalog: lot.catalog,
        startingPrice: lot.startingPrice,
        bidIncrement: lot.bidIncrement,
        price: isAuctionListing(lot.listingType) ? null : lot.price,
        currency: lot.currency,
        endsAt: lot.endsAt,
        layout,
        postText: layout === "captions" ? settings.captionPostTemplate : "",
        postTitle: target.facebookPost?.title ?? "",
        currencyStyle: DEFAULT_CURRENCY_STYLE,
      };
      await prisma.offer.update({
        where: { id: lot.offerId },
        data: { facebookPostSnapshot: snapshot as unknown as Prisma.InputJsonObject },
      });
      frozen += 1;
    }
  }
  return frozen;
}

/** Let these offers' post text follow the template again (#1800): an offer back in Ready is posted
 *  anew, with whatever the template says by then. */
export async function thawFacebookPostText(offerIds: readonly string[]): Promise<void> {
  if (offerIds.length === 0) return;
  await prisma.offer.updateMany({
    where: { id: { in: [...offerIds] }, facebookPostSnapshot: { not: Prisma.DbNull } },
    data: { facebookPostSnapshot: Prisma.DbNull },
  });
}

/**
 * An approval that states the auctions' closing time writes it into their frozen text too (#1800,
 * decided with the collector on 2026-10-11): the post in the group is corrected to it, and the text
 * here has to read as the post does. Nothing else of the snapshot moves.
 */
export async function setFrozenFacebookClosing(offerIds: readonly string[], endsAt: Date | null): Promise<void> {
  if (offerIds.length === 0) return;
  const rows = await prisma.offer.findMany({
    where: { id: { in: [...offerIds] } },
    select: { id: true, facebookPostSnapshot: true },
  });
  for (const row of rows) {
    const frozen = readFacebookFrozenLot(row.facebookPostSnapshot);
    if (!frozen) continue;
    const next: FacebookFrozenLot = { ...frozen, endsAt: endsAt?.toISOString() ?? null };
    await prisma.offer.update({
      where: { id: row.id },
      data: { facebookPostSnapshot: next as unknown as Prisma.InputJsonObject },
    });
  }
}

/**
 * Freeze every Facebook offer that has gone up and carries no snapshot (#1800) — the offers already
 * up when #1800 landed, frozen with the text they showed then; nothing earlier is recovered. Run once
 * at start-up and idempotent: an offer published since is frozen by its transition and not touched.
 */
export async function freezeUnfrozenFacebookPosts(): Promise<number> {
  const rows = await prisma.offer.findMany({
    where: { facebookGroupId: { not: null }, facebookPostSnapshot: { equals: Prisma.DbNull } },
    select: { id: true, state: true },
  });
  const posted = rows.filter((r) => isFacebookLotPosted(r.state)).map((r) => r.id);
  return freezeFacebookPostText(posted, { onlyUnfrozen: true });
}
