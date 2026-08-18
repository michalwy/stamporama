import "server-only";
import { prisma } from "./db";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import {
  type DelcampeListingProfileData,
  listDelcampeListingProfiles,
  resolveDelcampeListingProfileForOffer,
} from "./delcampe-listing-profile";
import {
  assertCollectionOwner,
  getPlatformCategoryKeyForOffer,
  lookupPlatformCategoryLesson,
  matchedPartNames,
  recordPlatformCategoryLesson,
} from "./platform-category";
import { explainLearnedCategoryMatch } from "./platform-category-rules";
import { delcampeItemUrl } from "./delcampe-import-rules";

// What an offer is configured to be uploaded as on Delcampe (#608 for the profile, #609 for the
// category) — the two questions an Easy Uploader row asks that are not answered by the stamps
// themselves or by the offer's own price.
//
// **Why it lives on the offer**, which is #494's reasoning arriving at the same place: the value is
// settled while the listing is being *prepared*, and the file that carries it is built days later
// (#610). A category worked out inside the exporter would be a category nobody saw before it went to
// a marketplace, and one nobody could correct without re-exporting.
//
// **Nothing here is a gate.** The category is filled in the moment the offer gains its first copy,
// and whatever was matched is what the file carries; it is correctable in place and never asks to be
// confirmed. What the card carries instead is *provenance* — learned from what was prepared before,
// or picked by hand — because a value nobody can account for is one that gets re-checked by hand
// every time, which is the cost this was meant to remove.
//
// **Two sources rather than Allegro's three.** Allegro will guess a category from a listing title;
// Delcampe has no such endpoint and no API at all here, so an unmatched key falls through to the
// picker — which is a person, not a source. The picker is not a failure: it is the first offer of a
// kind, and the register is what makes it the only one.
//
// **The per-offer override is the design, not a nicety.** Delcampe files a souvenir sheet under its
// own category (`7911` for Poland) while the same country and condition as a single stamp goes to
// `7938`, and nothing in this collection records "this is a souvenir sheet" dependably enough to key
// on. So the register answers for the common case and the offer says otherwise where it must — which
// is exactly why a hand-maintained key → category table was rejected and this was not.

/** What the last import saw of this offer's own listing (#611). */
export interface DelcampeOfferListingState {
  /** Delcampe's own listing id, and the address composed from it. */
  itemId: string;
  url: string;
  /** `ACTIVE` — carried by the newest import — or `ENDED`, meaning it has come down. */
  status: string;
  /** When the listing was last seen **up**, which on an ended row is the only date there is. */
  lastSeenAt: string;
  endsAt: string | null;
  presentPrice: string | null;
  currency: string | null;
  bidsCount: number | null;
}

/** Where a stored category came from. Display only — nothing branches on it. */
export type DelcampeCategorySourceKind = "learned" | "manual";

/** What the offer's own screen shows about the row it will be uploaded as, or null on every platform
 *  that is not Delcampe — the card is absent there rather than empty. */
export interface DelcampeOfferListingConfig {
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  source: DelcampeCategorySourceKind | null;
  /** One sentence saying what the category was matched on, or null on a hand-picked one — a manual
   *  choice answers for itself. */
  matchedOn: string | null;
  /** The profile that applies, resolved through #608's single fallback rule. */
  profile: DelcampeListingProfileData | null;
  /** Whether the offer names one itself, as opposed to following the platform's default: "(platform
   *  default)" and "this offer only" are different answers and the card states which. */
  profileIsOverride: boolean;
  /** Every profile the platform has, so the card's select needs no read of its own. */
  profileOptions: { id: string; name: string; isDefault: boolean }[];
  /** What Delcampe's own active-items export last said about this listing (#611), or null where no
   *  import has ever carried it. The list's *Came down* row and this are the same fact from the same
   *  place, which is the rule for every flag shown on a list. */
  listing: DelcampeOfferListingState | null;
  /** What the picker's search opens on — the offer's key in words, "Poland used". Computed **only
   *  while the offer has no category**, which is the one case the picker is reached from: the key is
   *  derived from every copy of every set, and paying for that on an offer whose category is already
   *  settled would be a read nothing on the screen uses. Null otherwise, and null where the offer is
   *  mixed enough that no word is honest. */
  categorySearchTerm: string | null;
}

const CONFIG_SELECT = {
  collectionId: true,
  delcampeListingProfileId: true,
  delcampeCategoryId: true,
  delcampeCategoryName: true,
  delcampeCategoryPath: true,
  delcampeCategorySource: true,
  delcampeCategoryMatchedOn: true,
  delcampeItemId: true,
  platform: { select: { id: true, platformModule: true } },
} as const;

function readSource(raw: string | null): DelcampeCategorySourceKind | null {
  return raw === "learned" || raw === "manual" ? raw : null;
}

/** Whether this offer is even on the platform this collection calls Delcampe. Everything below is a
 *  no-op for one that is not — an offer on Colnect has no Delcampe category, and asking for one would
 *  be #471's mistake in a new place. */
async function delcampeOfferRef(offerId: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: CONFIG_SELECT });
  if (!offer || offer.platform.platformModule !== DELCAMPE_PLATFORM_MODULE) return null;
  return offer;
}

/** What this offer would be uploaded as, or null when it is not a Delcampe offer. */
export async function getDelcampeOfferListingConfig(
  ownerId: string,
  offerId: string
): Promise<DelcampeOfferListingConfig | null> {
  const offer = await delcampeOfferRef(offerId);
  if (!offer) return null;
  await assertCollectionOwner(ownerId, offer.collectionId);

  const [profile, profiles] = await Promise.all([
    resolveDelcampeListingProfileForOffer(offerId),
    listDelcampeListingProfiles(ownerId, offer.collectionId),
  ]);

  return {
    categoryId: offer.delcampeCategoryId,
    categoryName: offer.delcampeCategoryName,
    categoryPath: offer.delcampeCategoryPath,
    source: readSource(offer.delcampeCategorySource),
    matchedOn: offer.delcampeCategoryMatchedOn,
    profile,
    listing: await readOfferListingState(offerId),
    profileIsOverride: offer.delcampeListingProfileId !== null,
    profileOptions: profiles.profiles.map((row) => ({
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
    })),
    categorySearchTerm: offer.delcampeCategoryId
      ? null
      : await categorySearchTermFor(offer.collectionId, offerId),
  };
}

/**
 * The newest thing an import has said about this offer's listing.
 *
 * Read from the `DelcampeListing` row rather than from `Offer.delcampeItemId`, and the difference is
 * the whole point: the offer holds the id it is up as, while the row holds *when it was last seen*
 * and whether it still is. The card has to be able to say "came down on the 14th", which is a fact
 * about an observation and not about the offer.
 *
 * The newest by `observedAt`, since a relisted offer legitimately has an older row beside its
 * current one.
 */
async function readOfferListingState(offerId: string): Promise<DelcampeOfferListingState | null> {
  const listing = await prisma.delcampeListing.findFirst({
    where: { offerId },
    orderBy: { observedAt: "desc" },
    select: {
      itemId: true,
      status: true,
      observedAt: true,
      endsAt: true,
      presentPrice: true,
      currency: true,
      bidsCount: true,
    },
  });
  if (!listing) return null;
  return {
    itemId: listing.itemId,
    url: delcampeItemUrl(listing.itemId),
    status: listing.status,
    lastSeenAt: listing.observedAt.toISOString(),
    endsAt: listing.endsAt?.toISOString() ?? null,
    presentPrice: listing.presentPrice?.toFixed(2) ?? null,
    currency: listing.currency,
    bidsCount: listing.bidsCount,
  };
}

/** The offer's key as a search — its area and its condition, which is what Delcampe's own tree is cut
 *  by. A head start and never an answer: Delcampe splits by *period* where this collection splits by
 *  area, so the words get the collector to the right country and the rest is theirs. */
async function categorySearchTermFor(
  collectionId: string,
  offerId: string
): Promise<string | null> {
  const keyView = await getPlatformCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) return null;
  const words = [keyView.areaName, keyView.conditionName].filter(Boolean);
  return words.length > 0 ? words.join(" ") : null;
}

/**
 * Name a profile on one offer, or clear the override with null so it follows the platform's default
 * again.
 *
 * The profile is re-read against the **offer's own platform and collection** rather than trusted
 * from the client: a profile id is a pick-list value, and one from another collection's platform
 * would otherwise become a setting nothing on this screen could explain.
 */
export async function setOfferDelcampeListingProfile(
  ownerId: string,
  offerId: string,
  profileId: string | null
): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, platformId: true },
  });
  if (!offer) throw new Error("Offer not found.");
  await assertCollectionOwner(ownerId, offer.collectionId);

  if (profileId) {
    const profile = await prisma.delcampeListingProfile.findFirst({
      where: { id: profileId, platformId: offer.platformId, collectionId: offer.collectionId },
      select: { id: true },
    });
    if (!profile) throw new Error("That listing profile is not one of this platform's.");
  }

  await prisma.offer.update({
    where: { id: offerId },
    data: { delcampeListingProfileId: profileId },
  });
}

// ---------------------------------------------------------------------------
// The category
// ---------------------------------------------------------------------------

/** What a category write stores. The name and the breadcrumb are **display snapshots** kept beside
 *  the id (the ADR-0025 §3 rule): the id is what the file carries, and a screen must be able to name
 *  a category without reading the catalogue back. */
export interface DelcampeCategoryChoiceInput {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
}

/**
 * Write a category the collector chose by hand.
 *
 * `source` becomes `manual` and `matchedOn` is cleared: a choice somebody made answers for itself,
 * and leaving the old sentence beside it would have the card explaining a match that is no longer the
 * reason this category is here.
 */
export async function setDelcampeOfferCategory(
  ownerId: string,
  offerId: string,
  input: DelcampeCategoryChoiceInput
): Promise<DelcampeOfferListingConfig | null> {
  const offer = await delcampeOfferRef(offerId);
  if (!offer) return null;
  await assertCollectionOwner(ownerId, offer.collectionId);

  const categoryId = input.categoryId.trim();
  if (!categoryId) throw new Error("A Delcampe listing needs a category.");
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      delcampeCategoryId: categoryId,
      delcampeCategoryName: input.categoryName?.trim() || null,
      delcampeCategoryPath: input.categoryPath?.trim() || null,
      delcampeCategorySource: "manual",
      delcampeCategoryMatchedOn: null,
    },
  });
  return getDelcampeOfferListingConfig(ownerId, offerId);
}

/**
 * Fill the category in when the offer first has something to categorise.
 *
 * Called from the same three mutations that add copies as the Allegro backfill (#494), and with the
 * same one deliberate difference from `syncGeneratedTexts`: this is a **backfill, never a refresh**.
 * A generated title follows the composition because it *describes* it; a category is a decision about
 * what the goods are, and re-deriving it under a collector who has corrected it would undo that
 * silently. So it writes only while the offer has none, and re-matching is an explicit ↻.
 *
 * **It can never fail the mutation it hangs off.** Adding a set is the collector's own act and has
 * nothing to do with Delcampe.
 */
export async function backfillDelcampeCategory(offerId: string): Promise<void> {
  try {
    const offer = await delcampeOfferRef(offerId);
    if (!offer || offer.delcampeCategoryId) return;
    await matchAndStore(offer.collectionId, offer.platform.id, offerId);
  } catch {
    // Deliberately silent — see above.
  }
}

/**
 * Match the category again, overwriting whatever is stored — the ↻ on the offer's Delcampe card.
 *
 * Explicit, and destructive by design: it is the one way back to the register's own answer after a
 * correction, and after the composition has changed enough that the first match no longer describes
 * the goods. A key nothing matches leaves the offer **without** a category rather than keeping the
 * old one: ↻ is the collector asking what the register says now, and answering with a value the
 * register did not give would be the one thing this card must not do.
 */
export async function rematchDelcampeOfferCategory(
  ownerId: string,
  offerId: string
): Promise<DelcampeOfferListingConfig | null> {
  const offer = await delcampeOfferRef(offerId);
  if (!offer) return null;
  await assertCollectionOwner(ownerId, offer.collectionId);
  await matchAndStore(offer.collectionId, offer.platform.id, offerId, { clearOnMiss: true });
  return getDelcampeOfferListingConfig(ownerId, offerId);
}

/** Run the register's lookup for this offer and write what it said. */
async function matchAndStore(
  collectionId: string,
  platformId: string,
  offerId: string,
  options: { clearOnMiss?: boolean } = {}
): Promise<void> {
  const keyView = await getPlatformCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) return;
  const learned = await lookupPlatformCategoryLesson(collectionId, platformId, keyView);

  if (!learned) {
    if (!options.clearOnMiss) return;
    await prisma.offer.update({
      where: { id: offerId },
      data: {
        delcampeCategoryId: null,
        delcampeCategoryName: null,
        delcampeCategoryPath: null,
        delcampeCategorySource: null,
        delcampeCategoryMatchedOn: null,
      },
    });
    return;
  }

  await prisma.offer.update({
    where: { id: offerId },
    data: {
      delcampeCategoryId: learned.categoryId,
      delcampeCategoryName: learned.categoryName,
      delcampeCategoryPath: learned.categoryPath,
      delcampeCategorySource: "learned",
      delcampeCategoryMatchedOn: explainLearnedCategoryMatch({
        matchedOn: matchedPartNames(keyView, learned.relaxed),
        relaxed: learned.relaxed,
        timesUsed: learned.timesUsed,
      }),
    },
  });
}

/**
 * Record what an offer the collector has finished preparing is categorised as.
 *
 * Called from `setOfferState` on the move to **`ready`**, beside the Allegro one and for a reason
 * that applies here with more force: a Delcampe listing is published by uploading a CSV days after
 * the offer was described, so a register that learned at publication would ask the same question
 * twenty times and answer it long after it stopped mattering. `ready` is where the collector has said
 * what these stamps are, which is the whole of what a lesson claims.
 *
 * Swallows its own failures: a register write is not worth failing a transition over, and the lesson
 * is an optimisation for the next listing rather than a part of this one.
 */
export async function learnDelcampeCategoryFromReadyOffer(offerId: string): Promise<void> {
  try {
    const offer = await delcampeOfferRef(offerId);
    if (!offer?.delcampeCategoryId) return;
    const keyView = await getPlatformCategoryKeyForOffer(offer.collectionId, offerId);
    if (!keyView) return;
    await recordPlatformCategoryLesson(offer.collectionId, offer.platform.id, keyView.key, {
      categoryId: offer.delcampeCategoryId,
      categoryName: offer.delcampeCategoryName,
      categoryPath: offer.delcampeCategoryPath,
    });
  } catch {
    // Deliberately silent — see above.
  }
}

/** The stored configuration as the export (#610) consumes it: the category and the resolved profile,
 *  with nothing worked out a second time. */
export async function readDelcampeListingInputs(offerId: string): Promise<{
  categoryId: string | null;
  categoryName: string | null;
  profile: DelcampeListingProfileData | null;
} | null> {
  const offer = await delcampeOfferRef(offerId);
  if (!offer) return null;
  return {
    categoryId: offer.delcampeCategoryId,
    categoryName: offer.delcampeCategoryName,
    profile: await resolveDelcampeListingProfileForOffer(offerId),
  };
}
