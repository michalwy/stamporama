import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import { normalizeFacebookProfileUrl } from "./facebook-profile-rules";

// What a Facebook offer's sale adds to the ordinary one (#1777, carrying over #1545; ADR-0061 §4).
//
// A Facebook offer is sold with the ordinary *Sell* and taken down with the ordinary *Withdraw*
// (decided with the collector on 2026-10-11). Facebook adds two things. **Who the buyer is**: names
// repeat on Facebook, so a buyer is recognised by their **profile link** first and their name second,
// and the links are kept on the contact (`ContactFacebookProfile` — several since #2042, since some
// buyers bid from more than one account, and any of them finds the contact). The sale form asks
// `lookupFacebookBuyer` while it is filled in and the save goes through `resolveFacebookBuyer`, both
// over `findFacebookBuyer` — so what the form says and what the save does cannot disagree. And **the
// sale's currency**: a group may have a currency of its own, so a new sale for the offer is in the
// offer's currency (`facebookOfferSaleCurrency`), not the platform's.
//
// Imported by `sale-header-input.ts` and the actions; it imports nothing of the sale or offer
// modules, so it closes no cycle — lib cycles throw at module-init (`docs/agents/facebook.md`).

/** The buyer as the lookup found them. */
export interface FacebookBuyerMatch {
  id: string;
  name: string;
  /** Every profile the contact has (#2042), in the order they were added. */
  facebookProfileUrls: string[];
  /** How they were found: by the profile link, or by name alone. */
  matchedBy: "profile" | "name";
}

export interface FacebookBuyerLookup {
  /** The contact the buyer already is, or null — a new buyer is created on save. */
  contact: FacebookBuyerMatch | null;
  /** Why the buyer cannot be saved as typed, or null. */
  conflict: string | null;
}

/** A contact's Facebook profiles as every reader selects them (#2042): the links, in the order they
 *  were added — the id breaks the tie between profiles added in one save. */
export const FACEBOOK_PROFILES_SELECT = {
  select: { url: true },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }] as Prisma.ContactFacebookProfileOrderByWithRelationInput[],
} satisfies Prisma.Contact$facebookProfilesArgs;

const BUYER_SELECT = { id: true, name: true, facebookProfiles: FACEBOOK_PROFILES_SELECT } as const;

function toMatch(
  row: { id: string; name: string; facebookProfiles: { url: string }[] },
  matchedBy: FacebookBuyerMatch["matchedBy"]
): FacebookBuyerMatch {
  return { id: row.id, name: row.name, facebookProfileUrls: row.facebookProfiles.map((p) => p.url), matchedBy };
}

/**
 * The contact a buyer is, found by the profile link first — **any** of a contact's profiles (#2042),
 * and a profile is one contact's only — and the name second (case-insensitive, any role — someone who
 * has only sold to the collector is still the same person). A name match whose contact has profiles,
 * none of them this one, is reported as a conflict rather than merged: it is somebody else with the
 * same name, or the same person on an account not yet on their contact, and only the collector can
 * tell which. The contact name, unique per collection, cannot be taken by a second one either.
 */
async function findFacebookBuyer(
  collectionId: string,
  name: string,
  profileUrl: string | null
): Promise<FacebookBuyerLookup> {
  if (profileUrl) {
    const byProfile = await prisma.contact.findFirst({
      where: { collectionId, facebookProfiles: { some: { url: profileUrl } } },
      select: BUYER_SELECT,
    });
    if (byProfile) return { contact: toMatch(byProfile, "profile"), conflict: null };
  }
  if (!name) return { contact: null, conflict: null };
  const byName = await prisma.contact.findFirst({
    where: { collectionId, name: { equals: name, mode: "insensitive" } },
    select: BUYER_SELECT,
  });
  if (!byName) return { contact: null, conflict: null };
  if (profileUrl && byName.facebookProfiles.length > 0) {
    return {
      contact: null,
      conflict: `The contact ${byName.name} has a different Facebook profile — if the buyer is the same person on another account, add this profile to the contact first; if somebody else, give them a name of their own.`,
    };
  }
  return { contact: toMatch(byName, "name"), conflict: null };
}

/** Who the typed buyer is — what the sale form shows while it is filled in. The caller has checked
 *  the collection is the collector's. */
export async function lookupFacebookBuyer(
  collectionId: string,
  input: { name: string; profileUrl: string }
): Promise<FacebookBuyerLookup> {
  const profile = normalizeFacebookProfileUrl(input.profileUrl);
  if (!profile.ok) return { contact: null, conflict: profile.message };
  return findFacebookBuyer(collectionId, input.name.trim(), profile.value);
}

/**
 * The buyer of a sale on the Facebook platform, by their profile: {@link findOrCreateBuyer}, refusing
 * a platform that is not Facebook's. The caller has checked the collection is the collector's.
 */
export async function resolveFacebookBuyer(
  collectionId: string,
  platformId: string,
  input: { name: string; profileUrl: string }
): Promise<{ ok: true; buyerId: string | null } | { ok: false; message: string }> {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, collectionId },
    select: { platformModule: true },
  });
  if (platform?.platformModule !== FACEBOOK_PLATFORM_MODULE) {
    return { ok: false, message: "A buyer is found by their Facebook profile only on the Facebook platform." };
  }
  const resolved = await findOrCreateBuyer(collectionId, input);
  return resolved.ok ? { ok: true, buyerId: resolved.buyerId } : resolved;
}

/** Who {@link findOrCreateBuyer} settled on. */
export interface BuyerResolved {
  ok: true;
  /** The buyer contact, or null when nothing was typed — no buyer, as on any sale. */
  buyerId: string | null;
  /** A contact was created for them, rather than found. */
  created: boolean;
  /** How an existing contact was found; null when one was created, or nobody named. */
  matchedBy: "profile" | "name" | null;
}

/**
 * A buyer found by any of their profile links first and their name second, or created: an existing
 * contact takes the buyer role and, where it has no profile yet, the profile link; otherwise a buyer
 * is created with both. Nothing typed is no buyer. Refuses a link that is not a profile, a name held by somebody with
 * a different link, and a link alone that matches nobody — a contact needs a name. *Sell*'s rule on
 * Facebook (#1777), and the agent API's `find_or_create_buyer` (#1949), which reaches it with or
 * without a link. The caller has checked the collection is the collector's.
 */
export async function findOrCreateBuyer(
  collectionId: string,
  input: { name: string; profileUrl: string }
): Promise<BuyerResolved | { ok: false; message: string }> {
  const name = input.name.trim();
  const profile = normalizeFacebookProfileUrl(input.profileUrl);
  if (!profile.ok) return profile;
  if (!name && !profile.value) return { ok: true, buyerId: null, created: false, matchedBy: null };

  const { contact, conflict } = await findFacebookBuyer(collectionId, name, profile.value);
  if (conflict) return { ok: false, message: conflict };
  if (contact) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        buyer: true,
        ...(profile.value && contact.facebookProfileUrls.length === 0
          ? { facebookProfiles: { create: { collectionId, url: profile.value } } }
          : {}),
      },
    });
    return { ok: true, buyerId: contact.id, created: false, matchedBy: contact.matchedBy };
  }
  if (!name) return { ok: false, message: "Nobody has that profile yet — name the buyer as their profile shows it." };
  const created = await prisma.contact.create({
    data: {
      collectionId,
      name,
      buyer: true,
      ...(profile.value ? { facebookProfiles: { create: { collectionId, url: profile.value } } } : {}),
    },
    select: { id: true },
  });
  return { ok: true, buyerId: created.id, created: true, matchedBy: null };
}

/**
 * The currency a new sale for this offer is created in, when that is the offer's own rather than its
 * platform's: a Facebook offer's (#1545's rule — a group may have a currency of its own, and the sale
 * follows the offer, leaving the platform's lock unread and unwritten). Null for any other offer,
 * whose sale takes the platform's currency as always. Refuses an offer that is not the collector's or
 * not in this collection.
 */
export async function facebookOfferSaleCurrency(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<string | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, currency: true, facebookGroupId: true, collection: { select: { ownerId: true } } },
  });
  if (!offer || offer.collection.ownerId !== ownerId || offer.collectionId !== collectionId) {
    throw new Error("Offer not found or access denied.");
  }
  return offer.facebookGroupId ? offer.currency : null;
}
