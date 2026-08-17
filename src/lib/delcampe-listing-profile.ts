import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import {
  cleanDelcampeListingProfileValues,
  type DelcampeListingProfileValues,
} from "./delcampe-listing-profile-rules";

// Delcampe listing profiles (#608; ADR-0034) — everything an Easy Uploader row carries that is not a
// fact about the stamps: the shipping model it names, the renewal counters, the five paid promotion
// flags, and the bid-step rule.
//
// The shape this module exists to guarantee is the one #486 established for Allegro: a profile is a
// **named set of settings owned by the platform contact**, one of which the platform uploads with by
// default, and any of which an offer may name instead. Nothing here builds a file — #610 is the
// consumer, and the only thing it asks of this module is
// {@link resolveDelcampeListingProfileForOffer}.
//
// The shipping model is stored as a **name and nothing else**, and is never validated: the CSV
// carries the name itself, no id is held in reserve, and Delcampe's own list (`GET /shippingModels`)
// is behind the API Pass this integration deliberately does not buy. A model renamed there makes an
// upload fail, and the honest place to say so is the editor — not a check against a list this app
// invented.

/** One profile as the settings panel, the offer card and #610 read it. The money fields are plain
 *  numbers rather than `Decimal`s or strings: they are read by a client component, and the bid-step
 *  rule is arithmetic over two-decimal figures rather than a value to print back unchanged. */
export interface DelcampeListingProfileData extends DelcampeListingProfileValues {
  id: string;
  platformId: string;
  /** Whether the platform uploads with this one unless the offer says otherwise. */
  isDefault: boolean;
}

/** What Settings → Delcampe renders: the platform the profiles hang off, or the reason there is
 *  none. A collection that has not said which of its platforms is Delcampe has nowhere to put a
 *  profile, and that is a sentence rather than an empty list. */
export interface DelcampeListingProfileList {
  platformId: string | null;
  platformName: string | null;
  profiles: DelcampeListingProfileData[];
  defaultProfileId: string | null;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** Resolve the collection a profile belongs to, checking it is the caller's. Every write goes
 *  through this rather than trusting the id it was handed. */
async function assertProfileOwner(
  ownerId: string,
  profileId: string
): Promise<{ collectionId: string; platformId: string }> {
  const profile = await prisma.delcampeListingProfile.findUnique({
    where: { id: profileId },
    select: { collectionId: true, platformId: true },
  });
  if (!profile) throw new Error("Listing profile not found.");
  await assertCollectionOwner(ownerId, profile.collectionId);
  return profile;
}

/** The platform this collection calls Delcampe, which is the only thing a profile can hang off.
 *  Read through the same marker `setDelcampePlatform` writes, so "which platform is Delcampe" keeps
 *  having exactly one answer and this module is not a second place that decides it. */
async function delcampePlatformOf(
  collectionId: string
): Promise<{ id: string; name: string; defaultDelcampeListingProfileId: string | null } | null> {
  const platform = await prisma.contact.findFirst({
    where: { collectionId, platform: true, platformModule: DELCAMPE_PLATFORM_MODULE },
    select: { id: true, name: true, defaultDelcampeListingProfileId: true },
    orderBy: { name: "asc" },
  });
  return platform ?? null;
}

const PROFILE_SELECT = {
  id: true,
  platformId: true,
  name: true,
  shippingModel: true,
  renewDuration: true,
  renewTotalCount: true,
  hasRenewableOptions: true,
  optionStrongTitle: true,
  optionBackgroundColor: true,
  optionBorderColor: true,
  optionListPromotion: true,
  optionHomepagePromotion: true,
  minBidStepThreshold: true,
  minBidStepBelow: true,
  minBidStepAtOrAbove: true,
} as const;

/** A selected row, with the three money columns still `Decimal`s — the boundary this module exists
 *  to convert: a `Decimal` does not survive the trip to a client component. */
type ProfileRow = Omit<
  DelcampeListingProfileData,
  "isDefault" | "minBidStepThreshold" | "minBidStepBelow" | "minBidStepAtOrAbove"
> & {
  minBidStepThreshold: Decimal;
  minBidStepBelow: Decimal;
  minBidStepAtOrAbove: Decimal;
};

function toData(row: ProfileRow, defaultProfileId: string | null): DelcampeListingProfileData {
  return {
    ...row,
    minBidStepThreshold: row.minBidStepThreshold.toNumber(),
    minBidStepBelow: row.minBidStepBelow.toNumber(),
    minBidStepAtOrAbove: row.minBidStepAtOrAbove.toNumber(),
    isDefault: row.id === defaultProfileId,
  };
}

/** Every profile of the collection's Delcampe platform, ordered by name — a pick list is read by
 *  looking for the one you already know the name of, as the shipping methods and Allegro's profiles
 *  are. */
export async function listDelcampeListingProfiles(
  ownerId: string,
  collectionId: string
): Promise<DelcampeListingProfileList> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await delcampePlatformOf(collectionId);
  if (!platform) {
    return { platformId: null, platformName: null, profiles: [], defaultProfileId: null };
  }
  const rows = await prisma.delcampeListingProfile.findMany({
    where: { platformId: platform.id },
    orderBy: { name: "asc" },
    select: PROFILE_SELECT,
  });
  const defaultProfileId = platform.defaultDelcampeListingProfileId;
  return {
    platformId: platform.id,
    platformName: platform.name,
    profiles: rows.map((row) => toData(row, defaultProfileId)),
    defaultProfileId,
  };
}

export class DuplicateDelcampeListingProfileError extends Error {
  constructor() {
    super("A listing profile with this name already exists on this platform.");
    this.name = "DuplicateDelcampeListingProfileError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === "P2002";
}

/**
 * Create a profile on the collection's Delcampe platform.
 *
 * The **first** profile becomes the platform's default on its own — #486's rule, for its reason:
 * nothing is gained by making the collector set a default on a list of one, and a platform with
 * exactly one profile and no default is a state the export would refuse to build from for no reason
 * anybody could see.
 */
export async function createDelcampeListingProfile(
  ownerId: string,
  collectionId: string,
  input: DelcampeListingProfileValues
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await delcampePlatformOf(collectionId);
  if (!platform) {
    throw new Error(
      "This collection has no Delcampe platform yet. Name one at the top of this tab first."
    );
  }
  const data = cleanDelcampeListingProfileValues(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.delcampeListingProfile.create({
        data: { collectionId, platformId: platform.id, ...data },
        select: { id: true },
      });
      if (!platform.defaultDelcampeListingProfileId) {
        await tx.contact.update({
          where: { id: platform.id },
          data: { defaultDelcampeListingProfileId: created.id },
        });
      }
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateDelcampeListingProfileError();
    throw err;
  }
}

/** Edit a profile in place. Rows already uploaded to Delcampe are untouched — Delcampe holds their
 *  values from the moment the file went up, and nothing here reaches back into a live listing. */
export async function updateDelcampeListingProfile(
  ownerId: string,
  profileId: string,
  input: DelcampeListingProfileValues
): Promise<void> {
  await assertProfileOwner(ownerId, profileId);
  const data = cleanDelcampeListingProfileValues(input);
  try {
    await prisma.delcampeListingProfile.update({ where: { id: profileId }, data });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateDelcampeListingProfileError();
    throw err;
  }
}

/** Make one profile the platform's default — a single reference on the platform rather than a flag
 *  per row, so there is nothing to keep exclusive and no moment at which two rows both claim it. */
export async function setDefaultDelcampeListingProfile(
  ownerId: string,
  profileId: string
): Promise<void> {
  const { platformId } = await assertProfileOwner(ownerId, profileId);
  await prisma.contact.update({
    where: { id: platformId },
    data: { defaultDelcampeListingProfileId: profileId },
  });
}

/**
 * Delete a profile.
 *
 * Nothing blocks it: both references at a profile are `SetNull`, so an offer that named it falls
 * back to the platform's default and a platform that uploaded with it is left without one. Nothing
 * is promoted in its place, for #486's reason — which settings the next upload carries is the
 * collector's decision, and a silently inherited default is the one way this could list something
 * unmeant. The count of released offers comes back so the panel can say what just changed.
 */
export async function deleteDelcampeListingProfile(
  ownerId: string,
  profileId: string
): Promise<{ offersReleased: number }> {
  await assertProfileOwner(ownerId, profileId);
  const offersReleased = await prisma.offer.count({
    where: { delcampeListingProfileId: profileId },
  });
  await prisma.delcampeListingProfile.delete({ where: { id: profileId } });
  return { offersReleased };
}

// ---------------------------------------------------------------------------
// The offer side
// ---------------------------------------------------------------------------

/**
 * The profile one offer would be uploaded with: its own, or its platform's default.
 *
 * The whole of the fallback rule, in one place, so the export (#610), the offer card and the
 * settings panel cannot come to disagree about which settings a row carries. Null when the platform
 * has no default and the offer names nothing.
 */
export async function resolveDelcampeListingProfileForOffer(
  offerId: string
): Promise<DelcampeListingProfileData | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      delcampeListingProfileId: true,
      platform: { select: { defaultDelcampeListingProfileId: true } },
    },
  });
  if (!offer) return null;
  const defaultProfileId = offer.platform.defaultDelcampeListingProfileId;
  const profileId = offer.delcampeListingProfileId ?? defaultProfileId;
  if (!profileId) return null;

  const row = await prisma.delcampeListingProfile.findUnique({
    where: { id: profileId },
    select: PROFILE_SELECT,
  });
  return row ? toData(row, defaultProfileId) : null;
}

/** What the offer's own screen shows about the profile it will be uploaded with (#608), or null on
 *  every platform that is not Delcampe — the card is absent there rather than empty. */
export interface DelcampeOfferListingConfig {
  /** The profile that applies, resolved through the single fallback rule above. */
  profile: DelcampeListingProfileData | null;
  /** Whether the offer names one itself, as opposed to following the platform's default: "(platform
   *  default)" and "this offer only" are different answers and the card states which. */
  profileIsOverride: boolean;
  /** Every profile the platform has, so the card's select needs no read of its own. */
  profileOptions: { id: string; name: string; isDefault: boolean }[];
}

/** The offer's Delcampe configuration, or null when its platform is not the Delcampe one. Gated on
 *  the platform's own module marker, exactly as the Allegro card is, so no other platform's offer
 *  screen grows a section about a marketplace it has nothing to do with. */
export async function getDelcampeOfferListingConfig(
  ownerId: string,
  offerId: string
): Promise<DelcampeOfferListingConfig | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      delcampeListingProfileId: true,
      platform: {
        select: { id: true, platformModule: true, defaultDelcampeListingProfileId: true },
      },
    },
  });
  if (!offer || offer.platform.platformModule !== DELCAMPE_PLATFORM_MODULE) return null;
  await assertCollectionOwner(ownerId, offer.collectionId);

  const defaultProfileId = offer.platform.defaultDelcampeListingProfileId;
  const rows = await prisma.delcampeListingProfile.findMany({
    where: { platformId: offer.platform.id },
    orderBy: { name: "asc" },
    select: PROFILE_SELECT,
  });
  const profiles = rows.map((row) => toData(row, defaultProfileId));
  const appliedId = offer.delcampeListingProfileId ?? defaultProfileId;

  return {
    profile: profiles.find((profile) => profile.id === appliedId) ?? null,
    profileIsOverride: offer.delcampeListingProfileId !== null,
    profileOptions: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      isDefault: profile.isDefault,
    })),
  };
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
