import "server-only";
import { prisma } from "./db";
import { getAllegroAccessToken } from "./allegro-connection";
import {
  type AllegroNamedOption,
  listAllegroImpliedWarranties,
  listAllegroReturnPolicies,
  listAllegroShippingRates,
} from "./allegro-api";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  isAllegroHandlingTime,
  isAllegroListingDuration,
  isAllegroInvoiceType,
} from "./allegro-listing-profile-vocabulary";

// Allegro listing profiles (#486; ADR-0025) — the seller-side settings every published listing needs
// and no offer has any notion of: delivery, after-sales services, location, invoicing.
//
// The shape this module exists to guarantee: a profile is a **named set of account settings owned by
// the Allegro platform contact**, one of which the platform publishes with by default, and any of
// which an offer may name instead. Nothing here publishes anything — #477 is the consumer, and the
// only thing it asks of this module is {@link resolveAllegroListingProfileForOffer}.
//
// The three dictionary references are Allegro's own ids and are **not re-validated on save**
// (ADR-0025 §3). The editor reads the account live every time it is opened, so a rate set deleted on
// Allegro is seen there; making a save call the marketplace would only mean that a settings screen
// stops working whenever the connection is down, and it would still not prove anything about the
// moment the listing actually goes out.

/** One profile as the settings panel and #477 read it. Carries the snapshot names beside the ids so
 *  a screen can say what a profile points at without a live call. */
export interface AllegroListingProfileData {
  id: string;
  platformId: string;
  name: string;
  shippingRatesId: string;
  shippingRatesName: string | null;
  handlingTime: string;
  /** How long the listing runs (#493) — null leaves Allegro's sale form as it was served. */
  durationLimit: string | null;
  /** Whether Allegro re-lists it when that runs out (#493). */
  autoRepublish: boolean;
  returnPolicyId: string | null;
  returnPolicyName: string | null;
  impliedWarrantyId: string | null;
  impliedWarrantyName: string | null;
  locationCountryCode: string;
  locationCity: string;
  locationPostCode: string;
  invoiceType: string;
  /** Whether the platform publishes with this one unless the offer says otherwise. */
  isDefault: boolean;
}

/** What Settings → Allegro renders: the platform the profiles hang off, or the reason there is
 *  none. A collection that has not said which of its platforms is Allegro has nowhere to put a
 *  profile, and that is a sentence rather than an empty list. */
export interface AllegroListingProfileList {
  platformId: string | null;
  platformName: string | null;
  profiles: AllegroListingProfileData[];
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
  const profile = await prisma.allegroListingProfile.findUnique({
    where: { id: profileId },
    select: { collectionId: true, platformId: true },
  });
  if (!profile) throw new Error("Listing profile not found.");
  await assertCollectionOwner(ownerId, profile.collectionId);
  return profile;
}

/** The platform this collection calls Allegro, which is the only thing a profile can hang off.
 *  Null when none has been named — the state the panel explains rather than works around.
 *
 *  Read through the same marker `setAllegroPlatform` writes (`module-platform.ts`), so "which
 *  platform is Allegro" keeps having exactly one answer and this module is not a second place that
 *  decides it. */
async function allegroPlatformOf(
  collectionId: string
): Promise<{ id: string; name: string; defaultAllegroListingProfileId: string | null } | null> {
  const platform = await prisma.contact.findFirst({
    where: { collectionId, platform: true, platformModule: ALLEGRO_PLATFORM_MODULE },
    select: { id: true, name: true, defaultAllegroListingProfileId: true },
    orderBy: { name: "asc" },
  });
  return platform ?? null;
}

function toData(
  row: {
    id: string;
    platformId: string;
    name: string;
    shippingRatesId: string;
    shippingRatesName: string | null;
    handlingTime: string;
    durationLimit: string | null;
    autoRepublish: boolean;
    returnPolicyId: string | null;
    returnPolicyName: string | null;
    impliedWarrantyId: string | null;
    impliedWarrantyName: string | null;
    locationCountryCode: string;
    locationCity: string;
    locationPostCode: string;
    invoiceType: string;
  },
  defaultProfileId: string | null
): AllegroListingProfileData {
  return { ...row, isDefault: row.id === defaultProfileId };
}

const PROFILE_SELECT = {
  id: true,
  platformId: true,
  name: true,
  shippingRatesId: true,
  shippingRatesName: true,
  handlingTime: true,
  durationLimit: true,
  autoRepublish: true,
  returnPolicyId: true,
  returnPolicyName: true,
  impliedWarrantyId: true,
  impliedWarrantyName: true,
  locationCountryCode: true,
  locationCity: true,
  locationPostCode: true,
  invoiceType: true,
} as const;

/** Every profile of the collection's Allegro platform, ordered by name — a pick-list is read by
 *  looking for the one you already know the name of, exactly as the shipping methods are. */
export async function listAllegroListingProfiles(
  ownerId: string,
  collectionId: string
): Promise<AllegroListingProfileList> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await allegroPlatformOf(collectionId);
  if (!platform) {
    return { platformId: null, platformName: null, profiles: [], defaultProfileId: null };
  }
  const rows = await prisma.allegroListingProfile.findMany({
    where: { platformId: platform.id },
    orderBy: { name: "asc" },
    select: PROFILE_SELECT,
  });
  const defaultProfileId = platform.defaultAllegroListingProfileId;
  return {
    platformId: platform.id,
    platformName: platform.name,
    profiles: rows.map((row) => toData(row, defaultProfileId)),
    defaultProfileId,
  };
}

// ---------------------------------------------------------------------------
// The account's own dictionaries
// ---------------------------------------------------------------------------

/** What the editor offers as choices, read live from the connected account. An **empty** list is a
 *  fact rather than a failure — an account that has defined no return policies is an ordinary
 *  private account — and the panel says so and points at Allegro, since none of these can be created
 *  from here. */
export interface AllegroSellerDictionaries {
  shippingRates: AllegroNamedOption[];
  returnPolicies: AllegroNamedOption[];
  impliedWarranties: AllegroNamedOption[];
}

/**
 * The three dictionaries a profile is built from, in one pass over the connection.
 *
 * Read on demand — when the editor opens, and again when the collector asks — and never cached: a
 * rate set added on Allegro five minutes ago should be selectable, and a list this app remembered
 * would be wrong the first time anything changed there. The cost is three requests against an
 * account's own configuration, which is the cheapest thing Allegro serves.
 */
export async function getAllegroSellerDictionaries(
  ownerId: string,
  collectionId: string
): Promise<AllegroSellerDictionaries> {
  const token = await getAllegroAccessToken(ownerId, collectionId);
  const [shippingRates, returnPolicies, impliedWarranties] = await Promise.all([
    listAllegroShippingRates(token),
    listAllegroReturnPolicies(token),
    listAllegroImpliedWarranties(token),
  ]);
  return { shippingRates, returnPolicies, impliedWarranties };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** What a profile is saved from. The `*Name` fields are the snapshot the editor read off the
 *  account beside each id — a label, never the truth about what will be published. */
export interface AllegroListingProfileInput {
  name: string;
  shippingRatesId: string;
  shippingRatesName: string | null;
  handlingTime: string;
  /** How long the listing runs (#493), or null to leave the form as Allegro served it. */
  durationLimit: string | null;
  /** Whether Allegro re-lists it when that runs out (#493). */
  autoRepublish: boolean;
  returnPolicyId: string | null;
  returnPolicyName: string | null;
  impliedWarrantyId: string | null;
  impliedWarrantyName: string | null;
  locationCountryCode: string;
  locationCity: string;
  locationPostCode: string;
  invoiceType: string;
}

export class DuplicateAllegroListingProfileError extends Error {
  constructor() {
    super("A listing profile with this name already exists on this platform.");
    this.name = "DuplicateAllegroListingProfileError";
  }
}

/**
 * The only validation a save does: that the fields Allegro requires are present and that the two
 * vocabularies are ones this app knows.
 *
 * Deliberately **not** a check against the account (ADR-0025 §3). Whether a rate set still exists is
 * a question with one honest answer time — the moment of publishing — and asking it here would trade
 * a settings screen that always works for a check that proves nothing about then.
 */
function cleanInput(input: AllegroListingProfileInput): AllegroListingProfileInput {
  const name = input.name.trim();
  if (!name) throw new Error("A profile needs a name.");

  const shippingRatesId = input.shippingRatesId.trim();
  if (!shippingRatesId) {
    throw new Error("A profile needs a shipping rate set — a listing cannot be published without one.");
  }

  const handlingTime = input.handlingTime.trim();
  if (!isAllegroHandlingTime(handlingTime)) {
    throw new Error("That is not a handling time Allegro accepts.");
  }

  // Null is a state, not a gap: a profile that says nothing about duration leaves the sale form's own
  // choice standing, which is what every profile written before #493 says.
  const durationLimit = input.durationLimit?.trim() || null;
  if (durationLimit && !isAllegroListingDuration(durationLimit)) {
    throw new Error("That is not a listing duration Allegro's sale form offers.");
  }

  const invoiceType = input.invoiceType.trim();
  if (!isAllegroInvoiceType(invoiceType)) {
    throw new Error("That is not an invoice type Allegro accepts.");
  }

  // The country is a code rather than a name, because that is what Allegro takes and because "PL"
  // and "Poland" being both storable is how a publish fails on a field nobody thought was a choice.
  const locationCountryCode = input.locationCountryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(locationCountryCode)) {
    throw new Error("The country must be a two-letter code, e.g. PL.");
  }
  const locationCity = input.locationCity.trim();
  const locationPostCode = input.locationPostCode.trim();
  if (!locationCity || !locationPostCode) {
    throw new Error("A profile needs the city and post code the parcel is sent from.");
  }

  const trimmedOrNull = (value: string | null) => value?.trim() || null;
  const returnPolicyId = trimmedOrNull(input.returnPolicyId);
  const impliedWarrantyId = trimmedOrNull(input.impliedWarrantyId);

  return {
    name,
    shippingRatesId,
    shippingRatesName: trimmedOrNull(input.shippingRatesName),
    handlingTime,
    durationLimit,
    autoRepublish: input.autoRepublish,
    returnPolicyId,
    // A name without its id names nothing, so the pair travels together or not at all.
    returnPolicyName: returnPolicyId ? trimmedOrNull(input.returnPolicyName) : null,
    impliedWarrantyId,
    impliedWarrantyName: impliedWarrantyId ? trimmedOrNull(input.impliedWarrantyName) : null,
    locationCountryCode,
    locationCity,
    locationPostCode,
    invoiceType,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === "P2002";
}

/**
 * Create a profile on the collection's Allegro platform.
 *
 * The **first** profile becomes the platform's default on its own. Nothing is gained by making the
 * collector set a default on a list of one, and a platform with exactly one profile and no default
 * is a state #477 would refuse to publish from for no reason the collector could see.
 */
export async function createAllegroListingProfile(
  ownerId: string,
  collectionId: string,
  input: AllegroListingProfileInput
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await allegroPlatformOf(collectionId);
  if (!platform) {
    throw new Error(
      "This collection has no Allegro platform yet. Name one at the top of this tab first."
    );
  }
  const data = cleanInput(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.allegroListingProfile.create({
        data: { collectionId, platformId: platform.id, ...data },
        select: { id: true },
      });
      if (!platform.defaultAllegroListingProfileId) {
        await tx.contact.update({
          where: { id: platform.id },
          data: { defaultAllegroListingProfileId: created.id },
        });
      }
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateAllegroListingProfileError();
    throw err;
  }
}

/** Edit a profile in place. Listings already published with it are untouched — Allegro holds their
 *  values from the moment they went out, and nothing here reaches back into a live listing. */
export async function updateAllegroListingProfile(
  ownerId: string,
  profileId: string,
  input: AllegroListingProfileInput
): Promise<void> {
  await assertProfileOwner(ownerId, profileId);
  const data = cleanInput(input);
  try {
    await prisma.allegroListingProfile.update({ where: { id: profileId }, data });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateAllegroListingProfileError();
    throw err;
  }
}

/**
 * Make one profile the platform's default.
 *
 * A single reference on the platform rather than a flag per row, so there is nothing to keep
 * exclusive and no moment at which two rows both claim it.
 */
export async function setDefaultAllegroListingProfile(
  ownerId: string,
  profileId: string
): Promise<void> {
  const { platformId } = await assertProfileOwner(ownerId, profileId);
  await prisma.contact.update({
    where: { id: platformId },
    data: { defaultAllegroListingProfileId: profileId },
  });
}

/**
 * Delete a profile.
 *
 * Nothing blocks it: both references at a profile are `SetNull`, so an offer that named it falls
 * back to the platform's default and a platform that published with it is left without one — both
 * defined states the screens already say out loud. The count of offers that were pointing at it
 * comes back so the panel can report what just changed, which is the useful half of a guard without
 * the half that stops the collector from tidying up.
 */
export async function deleteAllegroListingProfile(
  ownerId: string,
  profileId: string
): Promise<{ offersReleased: number }> {
  await assertProfileOwner(ownerId, profileId);
  const offersReleased = await prisma.offer.count({
    where: { allegroListingProfileId: profileId },
  });
  // The FK clears the platform's default where this was it. Nothing is promoted in its place:
  // choosing which settings the next listing goes out with is the collector's decision, not this
  // module's, and a silently inherited default is the one way this could publish something unmeant.
  await prisma.allegroListingProfile.delete({ where: { id: profileId } });
  return { offersReleased };
}

// ---------------------------------------------------------------------------
// The resolver #477 calls
// ---------------------------------------------------------------------------

/**
 * The profile one offer would be published with: its own, or its platform's default.
 *
 * The whole of the fallback rule, in one place, so that publishing (#477) never has to restate it —
 * and so the settings panel and the publish path can never disagree about which settings a listing
 * goes out with. Null when the platform has no default and the offer names nothing, which is the
 * state #477 refuses to publish from.
 */
export async function resolveAllegroListingProfileForOffer(
  offerId: string
): Promise<AllegroListingProfileData | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      allegroListingProfileId: true,
      platform: { select: { defaultAllegroListingProfileId: true } },
    },
  });
  if (!offer) return null;
  const defaultProfileId = offer.platform.defaultAllegroListingProfileId;
  const profileId = offer.allegroListingProfileId ?? defaultProfileId;
  if (!profileId) return null;

  const row = await prisma.allegroListingProfile.findUnique({
    where: { id: profileId },
    select: PROFILE_SELECT,
  });
  return row ? toData(row, defaultProfileId) : null;
}
