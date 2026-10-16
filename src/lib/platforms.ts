import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import { normalizePhotoSides } from "./offer-photo-config";
import { normalizePhotoCoverStyle, normalizePlatformCoverColor } from "./photo-cover-rules";
import { normalizeDescriptionFormat } from "./description-format";
import { isOfferListingType } from "./offer-rules";
import { normalizeMarketCode } from "./market-anchoring";
import { cleanRefreshQuickBuysAfterDays } from "./offer-refresh-rules";
import {
  FACEBOOK_PLATFORM_MODULE,
  MODULE_PLATFORMS,
  isModulePlatformName,
  modulePlatformName,
} from "./platform-modules";

// Server-side domain logic for the collection's platforms (#1955; ADR-0071) — the marketplaces it
// sells and buys on. A platform was a `Contact` carrying the Platform role until #1955; it is now a
// record of its own, configured in one place in Settings, and the address book holds only people
// and firms.
//
// Two kinds. The five **module platforms** (Allegro, Delcampe, Facebook, Philasearch, Colnect) exist
// once each per collection, carry their module's fixed name and are configured on that module's own
// Settings page — `ensureModulePlatforms` makes them. Any number of **generic platforms** are added
// under Settings → Platforms. Every platform has an on/off switch: one switched off is offered in no
// platform picker for a new record, and every record already naming it keeps showing it.
//
// All access is collection-owner-scoped; checks live here, server-side.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve a platform to its collection and module, verifying the caller owns it. */
async function assertPlatformOwner(
  ownerId: string,
  platformId: string
): Promise<{ collectionId: string; platformModule: string | null }> {
  const platform = await prisma.platform.findUnique({
    where: { id: platformId },
    select: {
      collectionId: true,
      platformModule: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!platform || platform.collection.ownerId !== ownerId) {
    throw new Error("Platform not found or access denied.");
  }
  return { collectionId: platform.collectionId, platformModule: platform.platformModule };
}

/** Raised when a name is taken in the collection — by another platform, or by one of the module
 *  platforms' fixed names. */
export class PlatformNameTakenError extends Error {
  constructor(name: string) {
    super(`A platform named "${name}" already exists in this collection.`);
    this.name = "PlatformNameTakenError";
  }
}

/** Raised when a field's value is refused by its own rule, so the form can say which and why. */
export class PlatformFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformFieldError";
  }
}

/** Raised when a delete is refused: a module platform, or a platform something still names. */
export class PlatformInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformInUseError";
  }
}

export interface PlatformData {
  id: string;
  collectionId: string;
  name: string;
  notes: string | null;
  /** Which module this platform is (`platform-modules.ts`), or null for a generic platform. */
  platformModule: string | null;
  /** Whether the pickers offer it for a new record (#1955). */
  enabled: boolean;
  /** The country this platform sells in (#1634; ADR-0064), ISO 3166-1 alpha-2 — where results on it
   * count when their auction house states none. Null is *not known*, the collection's home market. */
  market: string | null;
  /** The platform's fixed transaction currency (#196), or null when unset. */
  platformCurrency: string | null;
  /** Free-text title template for this platform's listings (#210), or null (falls back to the
   * built-in default). */
  titleTemplate: string | null;
  /** Templates for the platform's longer listing texts — the public description (#266) and the
   * seller-only private note (#267) — or null, which means the field is simply not generated (there
   * is no built-in default). */
  descriptionTemplate: string | null;
  privateNoteTemplate: string | null;
  /** What this platform's description field accepts (#319) — plain text, HTML or Markdown. Seeded
   * onto every offer created here, which is where rendering and copying read it (ADR-0019).
   * Normalised on write (like `photoSides`), so a reader can take it at face value. */
  descriptionFormat: string;
  /** ISO 639-1 language the platform's generated listing text is written in (#293), or null when
   * unset. Drives which entity translations the title tokens resolve. */
  titleLanguage: string | null;
  /** Fallback **starting price** for a new auction on this platform (#362, narrowed in #449), a 2-dp
   * string in the platform's own currency, or null. It outranks the suggestions read off the goods
   * (#553) — a lot is opened below its worth to attract bids — and seeds an offer at creation only;
   * afterwards it is merely offered back, on an auction still carrying no starting price of its own
   * (#1283). Kept only while {@link defaultListingType} is `auction`; a quick buy has no such
   * figure. */
  defaultStartingPrice: string | null;
  /** The floor this platform lists at (#731), a 2-dp string in the platform's own currency, or null
   * when it states none — the normal case. **Advisory only**: nothing seeds it onto an offer, nothing
   * clamps a price to it, and no gate refuses a price under it. It is offered back beside the price
   * on the offer's screen, one button away. Unlike {@link defaultStartingPrice} it is kept whatever
   * {@link defaultListingType} says — a floor is a floor on whatever figure the seller states. */
  minimumPrice: string | null;
  /** How a new offer on this platform is sold by default (#449) — `fixed` | `auction`, or null when
   * the platform states no preference (which reads as `fixed`). Read at offer creation exactly as
   * {@link defaultStartingPrice} is, never seeded-and-followed. */
  defaultListingType: string | null;
  /** After how many days an active quick buy here needs posting again (#1718), or null for never.
   * Not read for the Facebook platform, whose threshold is on Settings → Facebook (#1661). */
  refreshQuickBuysAfterDays: number | null;
  /** The message a buyer is sent after a sale here (#1815), or null for none. Not read for the
   * Facebook platform, whose message is on Settings → Facebook (#1661). */
  buyerMessageTemplate: string | null;
  /** The platform's hard photo limits (#308), each null when the platform states none. Read live by
   * the renderer (#310) rather than seeded onto offers. */
  maxPhotos: number | null;
  maxPhotoEdge: number | null;
  maxPhotoFileSizeMib: number | null;
  /** The platform's listing-text caps (#403, the title one #610), each null when it states none —
   * the same kind of hard technical limit as the photo ones above, and read live for the same
   * reason. */
  maxTitleLength: number | null;
  maxDescriptionLength: number | null;
  maxPrivateNoteLength: number | null;
  /** Photo defaults seeded onto every offer created on this platform (#308): which scan sides to
   * include, the per-tile label template (#312), and which collage template (#307) supplies the
   * render numbers. Changing them never touches an offer already prepared. */
  photoSides: string;
  /** #521's grouping, seeded onto new offers: single-copy sets photographed on their own while this
   * platform's photo limit has room. */
  photoPreferSingles: boolean;
  /** Whether offers here need symbols covered on their photos (#1665), and the style a new cover
   * starts as. Read live, unlike the seeded defaults around them. */
  coverSymbols: boolean;
  coverStyle: string;
  /** The colour the first bar starts in (#1702), `#rrggbb`. */
  coverColor: string;
  tileLabelLeftTemplate: string | null;
  tileLabelRightTemplate: string | null;
  defaultCollageTemplateId: string | null;
  /** #1673, seeded onto new offers: group a set's copies by checklist on photos of their own, laid
   * out on this template — null leaves the groups on the template above. */
  photoGroupByChecklist: boolean;
  defaultGroupCollageTemplateId: string | null;
  createdAt: Date;
}

const PLATFORM_SELECT = {
  id: true,
  collectionId: true,
  name: true,
  notes: true,
  platformModule: true,
  enabled: true,
  market: true,
  platformCurrency: true,
  titleTemplate: true,
  descriptionTemplate: true,
  privateNoteTemplate: true,
  descriptionFormat: true,
  titleLanguage: true,
  defaultStartingPrice: true,
  minimumPrice: true,
  defaultListingType: true,
  refreshQuickBuysAfterDays: true,
  buyerMessageTemplate: true,
  maxPhotos: true,
  maxPhotoEdge: true,
  maxPhotoFileSizeMib: true,
  maxTitleLength: true,
  maxDescriptionLength: true,
  maxPrivateNoteLength: true,
  photoSides: true,
  photoPreferSingles: true,
  coverSymbols: true,
  coverStyle: true,
  coverColor: true,
  tileLabelLeftTemplate: true,
  tileLabelRightTemplate: true,
  defaultCollageTemplateId: true,
  photoGroupByChecklist: true,
  defaultGroupCollageTemplateId: true,
  createdAt: true,
} as const;

type PlatformRow = Omit<PlatformData, "defaultStartingPrice" | "minimumPrice"> & {
  defaultStartingPrice: Decimal | null;
  minimumPrice: Decimal | null;
};

/** Money leaves this module as a 2-dp string, the convention the rest of the domain layer follows
 * (`offers.ts`, `valuation.ts`) — a `Decimal` does not survive the server/client boundary. */
function toPlatformData(row: PlatformRow): PlatformData {
  return {
    ...row,
    defaultStartingPrice: row.defaultStartingPrice?.toFixed(2) ?? null,
    minimumPrice: row.minimumPrice?.toFixed(2) ?? null,
  };
}

/** A platform for the Settings list: the platform plus how many records name it. A non-zero
 *  `referenceCount` means delete is refused (see {@link deletePlatform}). */
export interface PlatformListItem extends PlatformData {
  referenceCount: number;
}

/** What names a platform and stops it being deleted — every `onDelete: Restrict` reference. The
 *  rows a platform owns (its shipping options, profiles, groups) go with it and are not counted. */
const REFERENCE_COUNT = {
  _count: {
    select: {
      offers: true,
      salesPlatform: true,
      platformPurchases: true,
      auctionSalesPlatform: true,
      priceObservationsPlatform: true,
    },
  },
} as const;

function referenceCountOf(count: {
  offers: number;
  salesPlatform: number;
  platformPurchases: number;
  auctionSalesPlatform: number;
  priceObservationsPlatform: number;
}): number {
  return (
    count.offers +
    count.salesPlatform +
    count.platformPurchases +
    count.auctionSalesPlatform +
    count.priceObservationsPlatform
  );
}

export interface PlatformInput {
  /** Required for a generic platform; ignored for a module platform, whose name is its module's. */
  name: string;
  /** Whether the pickers offer it (#1955). Omitted leaves it as it is — on, for a new platform. */
  enabled?: boolean;
  notes?: string | null;
  /** The market (#1634), as typed — normalised on write, refused when it is not a two-letter code. */
  market?: string | null;
  /** The platform's fixed currency (#196), or null. */
  platformCurrency?: string | null;
  /** The platform's title template (#210), or null. */
  titleTemplate?: string | null;
  /** The platform's description (#266) / private-note (#267) templates, or null (generate none). */
  descriptionTemplate?: string | null;
  privateNoteTemplate?: string | null;
  /** What the platform's description field accepts (#319). Normalised on write, so an unknown or
   * missing value simply stores plain text. */
  descriptionFormat?: string | null;
  /** The platform's listing language (#293), or null. */
  titleLanguage?: string | null;
  /** The platform's fallback starting price for a new auction (#362/#449), or null. A blank or
   * unparseable amount stores null — a platform with no default, not a free one — and so does any
   * value sent while `defaultListingType` is not `auction`. */
  defaultStartingPrice?: string | null;
  /** The floor this platform lists at (#731), or null when it states none. */
  minimumPrice?: string | null;
  /** How a new offer on this platform is sold by default (#449), or null for "no preference". */
  defaultListingType?: string | null;
  /** The quick-buy refresh threshold (#1718) in days, or null for never. Out of range is refused. */
  refreshQuickBuysAfterDays?: number | null;
  /** The message to a buyer after a sale here (#1815), or null for none. Blank stores null. */
  buyerMessageTemplate?: string | null;
  /** The platform's photo limits (#308) — null each means "no limit stated". */
  maxPhotos?: number | null;
  maxPhotoEdge?: number | null;
  maxPhotoFileSizeMib?: number | null;
  /** The platform's listing-text caps (#403, #610) — null each means "no limit stated". */
  maxTitleLength?: number | null;
  maxDescriptionLength?: number | null;
  maxPrivateNoteLength?: number | null;
  /** The photo defaults new offers on this platform are seeded from (#308). */
  photoSides?: string | null;
  /** #521's grouping default. Absent leaves it on. */
  photoPreferSingles?: boolean | null;
  /** #1665: whether offers here need symbols covered (absent is off), and the style new covers
   * start as (normalised; unknown is pixelate). */
  coverSymbols?: boolean | null;
  coverStyle?: string | null;
  /** #1702: the colour the first bar starts in (normalised; unusable is black). */
  coverColor?: string | null;
  tileLabelLeftTemplate?: string | null;
  tileLabelRightTemplate?: string | null;
  /** The collage template (#307) new offers copy their render numbers from, or null for none. A
   * template id from another collection is dropped. */
  defaultCollageTemplateId?: string | null;
  /** #1673's grouping default (absent is off), and the group template — verified like the one above. */
  photoGroupByChecklist?: boolean | null;
  defaultGroupCollageTemplateId?: string | null;
}

/** The quick-buy refresh threshold (#1718), held to its shape — the rule's own message on a bad one. */
function refreshDays(value: number | null | undefined): number | null {
  try {
    return cleanRefreshQuickBuysAfterDays(value);
  } catch (err) {
    throw new PlatformFieldError((err as Error).message);
  }
}

/** A market as written (#1634): blank is none, anything else must be a two-letter country code. */
function marketData(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === "") return null;
  const code = normalizeMarketCode(raw);
  if (!code) throw new PlatformFieldError("A market is a two-letter country code, such as DE.");
  return code;
}

/** Blank normalises to null; an unparseable amount is dropped rather than stored as zero. */
function amount(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return Number.isFinite(Number(value)) ? value : null;
}

/**
 * What a new offer on this platform starts as (#449): how it is sold, and — **only** for an auction
 * platform — the figure it opens at. Written together because the price is meaningless without the
 * format; an unknown listing type stores null, which reads as `fixed` wherever it is used.
 */
function listingDefaults(
  data: PlatformInput
): { defaultListingType: string | null; defaultStartingPrice: string | null } {
  const defaultListingType = isOfferListingType(data.defaultListingType)
    ? data.defaultListingType
    : null;
  return {
    defaultListingType,
    defaultStartingPrice:
      defaultListingType === "auction" ? amount(data.defaultStartingPrice) : null,
  };
}

/** Every settings column as Prisma writes it, with the collage-template references verified to
 *  belong to the same collection — a tampered id from another collection is simply dropped. */
async function settingsData(collectionId: string, data: PlatformInput) {
  const ownTemplate = async (raw: string | null | undefined) => {
    const id = raw?.trim() || null;
    return id
      ? prisma.collageTemplate.findFirst({ where: { id, collectionId }, select: { id: true } })
      : null;
  };
  const [template, groupTemplate] = await Promise.all([
    ownTemplate(data.defaultCollageTemplateId),
    ownTemplate(data.defaultGroupCollageTemplateId),
  ]);
  return {
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    notes: data.notes?.trim() || null,
    market: marketData(data.market),
    platformCurrency: data.platformCurrency?.trim() || null,
    titleTemplate: data.titleTemplate ?? null,
    descriptionTemplate: data.descriptionTemplate ?? null,
    privateNoteTemplate: data.privateNoteTemplate ?? null,
    descriptionFormat: normalizeDescriptionFormat(data.descriptionFormat),
    titleLanguage: normalizeLanguage(data.titleLanguage),
    ...listingDefaults(data),
    // The platform's floor (#731). Written on its own rather than through the helper above,
    // because it is the one per-listing figure that does not depend on the listing type.
    minimumPrice: amount(data.minimumPrice),
    refreshQuickBuysAfterDays: refreshDays(data.refreshQuickBuysAfterDays),
    buyerMessageTemplate: data.buyerMessageTemplate?.trim() || null,
    maxTitleLength: data.maxTitleLength ?? null,
    maxDescriptionLength: data.maxDescriptionLength ?? null,
    maxPrivateNoteLength: data.maxPrivateNoteLength ?? null,
    maxPhotos: data.maxPhotos ?? null,
    maxPhotoEdge: data.maxPhotoEdge ?? null,
    maxPhotoFileSizeMib: data.maxPhotoFileSizeMib ?? null,
    photoSides: normalizePhotoSides(data.photoSides),
    photoPreferSingles: data.photoPreferSingles ?? true,
    coverSymbols: data.coverSymbols ?? false,
    coverStyle: normalizePhotoCoverStyle(data.coverStyle),
    coverColor: normalizePlatformCoverColor(data.coverColor),
    tileLabelLeftTemplate: data.tileLabelLeftTemplate ?? null,
    tileLabelRightTemplate: data.tileLabelRightTemplate ?? null,
    defaultCollageTemplateId: template?.id ?? null,
    photoGroupByChecklist: data.photoGroupByChecklist ?? false,
    defaultGroupCollageTemplateId: groupTemplate?.id ?? null,
  };
}

/**
 * The name a generic platform may carry, or a refusal: required, and none of the module
 * platforms' names (ignoring case) — those belong to the five, which every collection holds.
 */
function genericName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new PlatformFieldError("A platform needs a name.");
  if (isModulePlatformName(name)) throw new PlatformNameTakenError(name);
  return name;
}

/**
 * Make sure the collection holds its five module platforms (#1955), creating any that is missing —
 * switched off, so nothing is offered until the collector turns it on on its page. Idempotent and
 * cheap once they exist: one read. The Facebook platform starts needing covers on its photos, since
 * Facebook's rules are why covering exists (#1665).
 *
 * The caller must already have asserted ownership of `collectionId`.
 */
export async function ensureModulePlatforms(collectionId: string): Promise<void> {
  const existing = await prisma.platform.findMany({
    where: { collectionId, platformModule: { not: null } },
    select: { platformModule: true },
  });
  const have = new Set(existing.map((p) => p.platformModule));
  const missing = modulePlatformRows(collectionId).filter((row) => !have.has(row.platformModule));
  if (missing.length === 0) return;
  await prisma.platform.createMany({
    data: missing,
    // Two requests creating them at once: the unique index answers, and the loser's rows are skipped.
    skipDuplicates: true,
  });
}

/** The five module platforms as a new collection is created with them (`createCollection`) —
 *  switched off, the Facebook one already needing covers. */
export function modulePlatformRows(collectionId: string): {
  collectionId: string;
  name: string;
  platformModule: string;
  enabled: boolean;
  coverSymbols: boolean;
}[] {
  return MODULE_PLATFORMS.map((m) => ({
    collectionId,
    name: m.name,
    platformModule: m.module,
    enabled: false,
    coverSymbols: m.module === FACEBOOK_PLATFORM_MODULE,
  }));
}

/** Every platform of the collection, name-ordered, each with the count of records naming it.
 *  `kind` narrows to the generic ones (Settings → Platforms) or the module ones. */
export async function listPlatforms(
  ownerId: string,
  collectionId: string,
  kind: "all" | "generic" | "module" = "all"
): Promise<PlatformListItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.platform.findMany({
    where: {
      collectionId,
      ...(kind === "generic"
        ? { platformModule: null }
        : kind === "module"
          ? { platformModule: { not: null } }
          : {}),
    },
    select: { ...PLATFORM_SELECT, ...REFERENCE_COUNT },
    orderBy: { name: "asc" },
  });
  return rows.map(({ _count, ...row }) => ({
    ...toPlatformData(row),
    referenceCount: referenceCountOf(_count),
  }));
}

/** One platform with its reference count, or null when not found or not the caller's. */
export async function getPlatform(
  ownerId: string,
  platformId: string
): Promise<PlatformListItem | null> {
  const row = await prisma.platform.findUnique({
    where: { id: platformId },
    select: { ...PLATFORM_SELECT, ...REFERENCE_COUNT, collection: { select: { ownerId: true } } },
  });
  if (!row || row.collection.ownerId !== ownerId) return null;
  const { _count, collection: _collection, ...platform } = row;
  void _collection;
  return { ...toPlatformData(platform), referenceCount: referenceCountOf(_count) };
}

/** A module's platform, created first if the collection does not hold it yet — what that module's
 *  Settings page edits. */
export async function getModulePlatformSettings(
  ownerId: string,
  collectionId: string,
  module: string
): Promise<PlatformListItem> {
  await assertCollectionOwner(ownerId, collectionId);
  if (!modulePlatformName(module)) throw new Error(`Unknown platform module "${module}".`);
  await ensureModulePlatforms(collectionId);
  const row = await prisma.platform.findFirstOrThrow({
    where: { collectionId, platformModule: module },
    select: { id: true },
  });
  return (await getPlatform(ownerId, row.id))!;
}

/** Add a generic platform (#1955). Switched on, so the pickers offer it at once. */
export async function createPlatform(
  ownerId: string,
  collectionId: string,
  data: PlatformInput
): Promise<PlatformData> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = genericName(data.name);
  const settings = await settingsData(collectionId, data);
  try {
    return toPlatformData(
      await prisma.platform.create({
        data: { collectionId, name, ...settings },
        select: PLATFORM_SELECT,
      })
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PlatformNameTakenError(name);
    throw err;
  }
}

/** Save a platform's settings. Every field is replaced, so the caller sends the whole set; a module
 *  platform keeps its module's name whatever `name` says. */
export async function updatePlatform(
  ownerId: string,
  platformId: string,
  data: PlatformInput
): Promise<PlatformData> {
  const { collectionId, platformModule } = await assertPlatformOwner(ownerId, platformId);
  const name = platformModule ? undefined : genericName(data.name);
  const settings = await settingsData(collectionId, data);
  try {
    return toPlatformData(
      await prisma.platform.update({
        where: { id: platformId },
        data: { ...(name ? { name } : {}), ...settings },
        select: PLATFORM_SELECT,
      })
    );
  } catch (err) {
    if (isUniqueViolation(err) && name) throw new PlatformNameTakenError(name);
    throw err;
  }
}

/** Switch a platform on or off (#1955). Off takes it out of every picker for a new record and
 *  changes nothing that already names it. */
export async function setPlatformEnabled(
  ownerId: string,
  platformId: string,
  enabled: boolean
): Promise<void> {
  await assertPlatformOwner(ownerId, platformId);
  await prisma.platform.update({ where: { id: platformId }, data: { enabled } });
}

/** Delete a generic platform. Refused for a module platform — there is always one of each — and
 *  while any offer, sale, purchase, auction or price observation names it. What the platform owns
 *  (its shipping options, profiles and the like) goes with it. */
export async function deletePlatform(ownerId: string, platformId: string): Promise<void> {
  const { platformModule } = await assertPlatformOwner(ownerId, platformId);
  if (platformModule) {
    throw new PlatformInUseError("A module platform cannot be deleted; switch it off instead.");
  }
  const row = await prisma.platform.findUniqueOrThrow({
    where: { id: platformId },
    select: REFERENCE_COUNT,
  });
  const count = referenceCountOf(row._count);
  if (count > 0) {
    throw new PlatformInUseError(
      `This platform is named by ${count} record${count === 1 ? "" : "s"} and cannot be deleted. Switch it off instead.`
    );
  }
  await prisma.platform.delete({ where: { id: platformId } });
}

/** What a platform picker shows for one suggestion: the platform and what it says a new offer on it
 *  starts as. */
export interface PlatformOption {
  id: string;
  name: string;
  platformCurrency: string | null;
  defaultStartingPrice: string | null;
  defaultListingType: string | null;
}

/**
 * The platforms a picker offers for a **new** record (#1955): switched on, matching `query` by name
 * case-insensitively, at most 20, name-ordered. A platform switched off is not among them; a record
 * that already names one shows it from the record itself.
 */
export async function searchPlatforms(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<PlatformOption[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.platform.findMany({
    where: { collectionId, enabled: true, name: { contains: query, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      platformCurrency: true,
      defaultStartingPrice: true,
      defaultListingType: true,
    },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows.map((r) => ({ ...r, defaultStartingPrice: r.defaultStartingPrice?.toFixed(2) ?? null }));
}

/**
 * Resolve a platform field typed into a form to a platform id, creating a generic platform when the
 * name is new (#120's create-on-type, kept from the contact days).
 *
 *  1. An explicit `id` is honoured only if it belongs to `collectionId`.
 *  2. A `name` matches an existing platform case-insensitively — a module platform's included.
 *  3. Failing both, a generic platform of that name is created. Null when neither is given.
 *
 * The caller must already have asserted ownership of `collectionId`.
 */
export async function resolvePlatform(
  collectionId: string,
  input: { id?: string | null; name?: string | null }
): Promise<string | null> {
  const id = input.id?.trim();
  if (id) {
    const existing = await prisma.platform.findFirst({
      where: { id, collectionId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const name = input.name?.trim();
  if (!name) return null;

  const findByName = () =>
    prisma.platform.findFirst({
      where: { collectionId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
  const byName = await findByName();
  if (byName) return byName.id;
  // A module's name that matched nothing: the collection predates its module platforms being made.
  if (isModulePlatformName(name)) {
    await ensureModulePlatforms(collectionId);
    return (await findByName())?.id ?? null;
  }

  try {
    const created = await prisma.platform.create({
      data: { collectionId, name },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Lost a race (or an exact-case duplicate slipped past the insensitive match): re-read.
    if (isUniqueViolation(err)) {
      const again = await findByName();
      if (again) return again.id;
    }
    throw err;
  }
}

/** Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
