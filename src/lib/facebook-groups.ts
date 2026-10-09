import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import {
  cleanFacebookDefaults,
  cleanFacebookGroupValues,
  FACEBOOK_BLANK_SETTINGS,
  isFacebookGroupSetting,
  toFacebookListingType,
  type FacebookGroupValues,
  type FacebookPostingSettings,
  type FacebookStartingPriceMode,
} from "./facebook-group-rules";

// The Facebook groups a collection auctions in (#1543; ADR-0061).
//
// Facebook is **one platform and its groups sit under it**: a group is a row owned by the platform
// contact this collection calls Facebook, and is not a platform of its own. What a group holds is its
// customs — how a new offer is sold (#1671), the auction and quick-buy post templates, the standing
// note, and the defaults a new auction starts from — each read when an offer is created (#1544) and
// then owned by the offer.
//
// Each setting of a group **follows the platform's** unless the group marks it custom (#1661): the
// platform's own settings are a `FacebookDefaults` row, and `readFacebookDefaults` is the one reader
// of it — a platform without a row reads as every setting blank.
//
// The rule this module exists to keep is **archive, never delete, once a group has offers**: an offer
// names its group, and the sales reports per group need that group to still exist. A group nobody has
// used yet can go outright; `Offer.facebookGroupId` restricts as the backstop, and the refusal here is
// the sentence the collector reads.

/** One group as the settings page reads it. Money is a plain number, for the client component. */
export interface FacebookGroupData extends FacebookGroupValues {
  id: string;
  platformId: string;
  /** When it was archived, ISO-8601, or null while it is in use. */
  archivedAt: string | null;
  /** How many offers name it — what decides whether it can be deleted. */
  offerCount: number;
}

/** What Settings → Facebook renders: the platform the groups hang off, or the reason there is none. */
export interface FacebookGroupList {
  platformId: string | null;
  platformName: string | null;
  /** The platform's own currency (#196) — what a group with no currency of its own states figures in. */
  platformCurrency: string | null;
  /** The platform's settings every group follows unless it holds its own (#1661). */
  defaults: FacebookPostingSettings;
  /** In use first, then archived; each by name. */
  groups: FacebookGroupData[];
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** Resolve the collection a group belongs to, checking it is the caller's. Every write goes through
 *  this rather than trusting the id it was handed. */
async function assertGroupOwner(ownerId: string, groupId: string): Promise<{ name: string }> {
  const group = await prisma.facebookGroup.findUnique({
    where: { id: groupId },
    select: { collectionId: true, name: true },
  });
  if (!group) throw new Error("Group not found.");
  await assertCollectionOwner(ownerId, group.collectionId);
  return group;
}

/** The platform this collection calls Facebook — read through the marker `setFacebookPlatform`
 *  writes, so this module is not a second place that decides it. */
async function facebookPlatformOf(
  collectionId: string
): Promise<{ id: string; name: string; platformCurrency: string | null } | null> {
  return prisma.contact.findFirst({
    where: { collectionId, platform: true, platformModule: FACEBOOK_PLATFORM_MODULE },
    select: { id: true, name: true, platformCurrency: true },
    orderBy: { name: "asc" },
  });
}

interface SettingsRow {
  listingType: string;
  mixedListingTypes: boolean;
  postTemplate: string;
  quickBuyTemplate: string;
  standingNote: string;
  startingPriceMode: string | null;
  startingPriceValue: Decimal | null;
  bidIncrement: Decimal | null;
  auctionDays: number | null;
  closingTime: string | null;
  refreshQuickBuysAfterDays: number | null;
}

/** A settings row's columns as the plain values the rules and the client hold. */
export function toPostingSettings(row: SettingsRow): FacebookPostingSettings {
  return {
    listingType: toFacebookListingType(row.listingType),
    mixedListingTypes: row.mixedListingTypes,
    postTemplate: row.postTemplate,
    quickBuyTemplate: row.quickBuyTemplate,
    standingNote: row.standingNote,
    // Only ever written through the rules' cleaning, which admits the two modes alone.
    startingPriceMode: row.startingPriceMode as FacebookStartingPriceMode | null,
    startingPriceValue: row.startingPriceValue?.toNumber() ?? null,
    bidIncrement: row.bidIncrement?.toNumber() ?? null,
    auctionDays: row.auctionDays,
    closingTime: row.closingTime,
    refreshQuickBuysAfterDays: row.refreshQuickBuysAfterDays,
  };
}

/** The settings of a group's stored `customSettings`, keeping only keys the rules know. */
export function toCustomSettings(stored: readonly string[]) {
  return stored.filter(isFacebookGroupSetting);
}

/**
 * The Facebook platform's own settings (#1661) — what every group follows unless it holds its own.
 * A platform nobody has stated any for has no row and reads as every setting blank.
 */
export async function readFacebookDefaults(
  platformId: string,
  db: Pick<typeof prisma, "facebookDefaults"> = prisma
): Promise<FacebookPostingSettings> {
  const row = await db.facebookDefaults.findUnique({ where: { platformId } });
  return row ? toPostingSettings(row) : { ...FACEBOOK_BLANK_SETTINGS };
}

const GROUP_SELECT = {
  id: true,
  platformId: true,
  name: true,
  url: true,
  archivedAt: true,
  customSettings: true,
  listingType: true,
  mixedListingTypes: true,
  postTemplate: true,
  quickBuyTemplate: true,
  standingNote: true,
  startingPriceMode: true,
  startingPriceValue: true,
  bidIncrement: true,
  auctionDays: true,
  closingTime: true,
  refreshQuickBuysAfterDays: true,
  currency: true,
  _count: { select: { offers: true } },
} as const;

interface GroupRow {
  id: string;
  platformId: string;
  name: string;
  url: string;
  archivedAt: Date | null;
  customSettings: string[];
  currency: string | null;
  _count: { offers: number };
}

function toData(row: GroupRow & SettingsRow): FacebookGroupData {
  return {
    id: row.id,
    platformId: row.platformId,
    name: row.name,
    url: row.url,
    ...toPostingSettings(row),
    currency: row.currency,
    custom: toCustomSettings(row.customSettings),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    offerCount: row._count.offers,
  };
}

/** Every group of the collection's Facebook platform: those in use first, the archived after them,
 *  each by name — a pick list is read by looking for the name you already know. */
export async function listFacebookGroups(
  ownerId: string,
  collectionId: string
): Promise<FacebookGroupList> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await facebookPlatformOf(collectionId);
  if (!platform) {
    return {
      platformId: null,
      platformName: null,
      platformCurrency: null,
      defaults: { ...FACEBOOK_BLANK_SETTINGS },
      groups: [],
    };
  }
  const [rows, defaults] = await Promise.all([
    prisma.facebookGroup.findMany({
      where: { platformId: platform.id },
      orderBy: { name: "asc" },
      select: GROUP_SELECT,
    }),
    readFacebookDefaults(platform.id),
  ]);
  const groups = rows.map(toData);
  return {
    platformId: platform.id,
    platformName: platform.name,
    platformCurrency: platform.platformCurrency,
    defaults,
    groups: [
      ...groups.filter((g) => g.archivedAt === null),
      ...groups.filter((g) => g.archivedAt !== null),
    ],
  };
}

export class DuplicateFacebookGroupError extends Error {
  constructor() {
    super("A group with this name already exists on this platform.");
    this.name = "DuplicateFacebookGroupError";
  }
}

export class FacebookGroupInUseError extends Error {
  constructor(name: string, offers: number) {
    super(
      `${name} has ${offers} offer${offers === 1 ? "" : "s"}, so it cannot be deleted — archive it instead.`
    );
    this.name = "FacebookGroupInUseError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === "P2002";
}

function settingsColumns(values: FacebookPostingSettings) {
  return {
    listingType: values.listingType,
    mixedListingTypes: values.mixedListingTypes,
    postTemplate: values.postTemplate,
    quickBuyTemplate: values.quickBuyTemplate,
    standingNote: values.standingNote,
    startingPriceMode: values.startingPriceMode,
    startingPriceValue: values.startingPriceValue,
    bidIncrement: values.bidIncrement,
    auctionDays: values.auctionDays,
    closingTime: values.closingTime,
    refreshQuickBuysAfterDays: values.refreshQuickBuysAfterDays,
  };
}

function toColumns(values: FacebookGroupValues) {
  return {
    name: values.name,
    url: values.url,
    customSettings: values.custom,
    ...settingsColumns(values),
    currency: values.currency,
  };
}

/**
 * State the Facebook platform's own settings (#1661): every group following one sees the change at
 * once, and no auction already made does — a group's settings are read when an offer is created
 * (#1544) and then owned by the offer.
 */
export async function updateFacebookDefaults(
  ownerId: string,
  collectionId: string,
  input: FacebookPostingSettings
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await facebookPlatformOf(collectionId);
  if (!platform) {
    throw new Error("This collection has no Facebook platform yet. Choose one at the top of this page first.");
  }
  const columns = settingsColumns(cleanFacebookDefaults(input));
  await prisma.facebookDefaults.upsert({
    where: { platformId: platform.id },
    create: { platformId: platform.id, ...columns },
    update: columns,
  });
}

/** Add a group to the collection's Facebook platform. */
export async function createFacebookGroup(
  ownerId: string,
  collectionId: string,
  input: FacebookGroupValues
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await facebookPlatformOf(collectionId);
  if (!platform) {
    throw new Error("This collection has no Facebook platform yet. Choose one at the top of this page first.");
  }
  const values = cleanFacebookGroupValues(input);
  try {
    return await prisma.facebookGroup.create({
      data: { collectionId, platformId: platform.id, ...toColumns(values) },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFacebookGroupError();
    throw err;
  }
}

/** Edit a group in place. Offers already created keep what they were created with — a group's
 *  defaults are read once, when an offer is made (#1544), and never reach back into one. */
export async function updateFacebookGroup(
  ownerId: string,
  groupId: string,
  input: FacebookGroupValues
): Promise<void> {
  await assertGroupOwner(ownerId, groupId);
  const values = cleanFacebookGroupValues(input);
  try {
    await prisma.facebookGroup.update({ where: { id: groupId }, data: toColumns(values) });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFacebookGroupError();
    throw err;
  }
}

/** Archive a group the collector no longer uses, or bring one back. Nothing about its offers
 *  changes: an archived group is only no longer offered to a new auction. */
export async function setFacebookGroupArchived(
  ownerId: string,
  groupId: string,
  archived: boolean
): Promise<void> {
  await assertGroupOwner(ownerId, groupId);
  await prisma.facebookGroup.update({
    where: { id: groupId },
    data: { archivedAt: archived ? new Date() : null },
  });
}

/**
 * Delete a group — **only one no offer names**. A group with offers is where sales happened, and the
 * reports per group need it, so it is archived instead; the refusal says so. The foreign key
 * restricts as well, so an offer created between the count and the delete still cannot orphan.
 */
export async function deleteFacebookGroup(ownerId: string, groupId: string): Promise<void> {
  const { name } = await assertGroupOwner(ownerId, groupId);
  const offers = await prisma.offer.count({ where: { facebookGroupId: groupId } });
  if (offers > 0) throw new FacebookGroupInUseError(name, offers);
  try {
    await prisma.facebookGroup.delete({ where: { id: groupId } });
  } catch (err) {
    // P2003: the restricting key, when an offer arrived after the count.
    if ((err as { code?: unknown })?.code === "P2003") {
      throw new FacebookGroupInUseError(
        name,
        await prisma.offer.count({ where: { facebookGroupId: groupId } })
      );
    }
    throw err;
  }
}
