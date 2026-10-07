import "server-only";
import { prisma } from "./db";
import { patchOffer, setOfferState } from "./offers";
import { addSaleLines, createSale, deleteSale, type SaleLineDraft } from "./sales";
import { FACEBOOK_AUCTION_HOLDING_STATES } from "./facebook-auctions";
import {
  cleanFacebookWin,
  normalizeFacebookProfileUrl,
  splitAuctionPrice,
  type FacebookWinInput,
} from "./facebook-result-rules";
import { isAuctionListing, normalizeListingType, type OfferState } from "./offer-rules";
import type { SaleStatus } from "./sale-status";

// A Facebook offer's result (#1545; ADR-0061 §4, decided with the collector on 2026-10-03) — an
// auction's, and since #1671 a quick buy's, which is recorded the same way: who bought it and for how
// much, the buyer found or created exactly as an auction's winner is.
//
// Bids on a Facebook auction are comments under the post, so nothing reports them: the standing bid
// is typed onto the offer while it runs (the ordinary in-place price edit, dated by `priceCheckedAt`),
// and when it ends the collector records **who won and for how much** — or that nobody bid. The win
// is recorded as every other platform's result is: a `Sale` to a buyer contact, its lines the offer's
// sets, which flips the offer to `sold`. *No bids* withdraws the offer, which frees its copies.
//
// The winner is a contact recognised by their **Facebook profile link** first and their name second,
// since names repeat on Facebook; the link is kept on the contact (`Contact.facebookProfileUrl`). The
// lot goes into a new sale, or into one of the winner's sales still open on Facebook — the collector
// is asked which, because several lots won by one person are usually one parcel.
//
// This module imports `offers.ts` and `sales.ts` and nothing imports it but the actions, so it closes
// no cycle — lib cycles throw at module-init (`docs/agents/facebook.md`).

/** The statuses a sale is still open to another lot in: not yet sent. */
const OPEN_SALE_STATUSES: readonly SaleStatus[] = ["ordered", "paid", "packed"];

/** An offer as the result is recorded against: a Facebook offer that is up, with its sets. */
async function readFacebookOffer(ownerId: string, offerId: string) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      collectionId: true,
      platformId: true,
      currency: true,
      state: true,
      listingType: true,
      facebookGroupId: true,
      collection: { select: { ownerId: true } },
      sets: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, items: { select: { itemId: true } }, saleLines: { select: { id: true }, take: 1 } },
      },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) throw new Error("Offer not found or access denied.");
  if (!offer.facebookGroupId) throw new Error("Only a Facebook offer records its result here.");
  const listingType = normalizeListingType(offer.listingType);
  if (!(FACEBOOK_AUCTION_HOLDING_STATES as readonly string[]).includes(offer.state)) {
    throw new Error(
      `This ${isAuctionListing(listingType) ? "auction" : "offer"} is ${offer.state as OfferState} — only one that is up has a result to record.`
    );
  }
  return { ...offer, listingType };
}

/** The winner as the lookup found them. */
export interface FacebookWinnerMatch {
  id: string;
  name: string;
  facebookProfileUrl: string | null;
  /** How they were found: by the profile link, or by name alone. */
  matchedBy: "profile" | "name";
}

/** One of the winner's sales still open to another lot. */
export interface FacebookOpenSale {
  id: string;
  saleNo: number;
  /** `YYYY-MM-DD`. */
  soldOn: string;
  status: SaleStatus;
  lineCount: number;
}

export interface FacebookWinnerLookup {
  /** The contact the winner already is, or null — a new buyer is created on save. */
  contact: FacebookWinnerMatch | null;
  /** Why the result cannot be saved as typed, or null. */
  conflict: string | null;
  /** The winner's open sales on this auction's platform, in its currency, newest first. */
  openSales: FacebookOpenSale[];
}

/**
 * The contact a winner is, found by the profile link first and the name second (case-insensitive,
 * any role — someone who has only sold to the collector is still the same person). A name match
 * whose contact carries a **different** profile link is somebody else with the same name: it is
 * reported as a conflict rather than merged, and the contact name, unique per collection, cannot be
 * taken by a second one either.
 */
async function findWinner(
  collectionId: string,
  winnerName: string,
  profileUrl: string | null
): Promise<{ contact: FacebookWinnerMatch | null; conflict: string | null }> {
  const select = { id: true, name: true, facebookProfileUrl: true } as const;
  if (profileUrl) {
    const byProfile = await prisma.contact.findFirst({
      where: { collectionId, facebookProfileUrl: profileUrl },
      orderBy: { createdAt: "asc" },
      select,
    });
    if (byProfile) return { contact: { ...byProfile, matchedBy: "profile" }, conflict: null };
  }
  if (!winnerName) return { contact: null, conflict: null };
  const byName = await prisma.contact.findFirst({
    where: { collectionId, name: { equals: winnerName, mode: "insensitive" } },
    select,
  });
  if (!byName) return { contact: null, conflict: null };
  if (profileUrl && byName.facebookProfileUrl && byName.facebookProfileUrl !== profileUrl) {
    return {
      contact: null,
      conflict: `The contact ${byName.name} has a different Facebook profile — if the winner is somebody else, give them a name of their own.`,
    };
  }
  return { contact: { ...byName, matchedBy: "name" }, conflict: null };
}

async function openSalesOf(
  collectionId: string,
  platformId: string,
  currency: string,
  buyerId: string
): Promise<FacebookOpenSale[]> {
  const rows = await prisma.sale.findMany({
    where: { collectionId, platformId, currency, buyerId, status: { in: [...OPEN_SALE_STATUSES] } },
    orderBy: [{ soldAt: "desc" }, { saleNo: "desc" }],
    select: { id: true, saleNo: true, soldAt: true, status: true, _count: { select: { lines: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    saleNo: s.saleNo,
    soldOn: s.soldAt.toISOString().slice(0, 10),
    status: s.status as SaleStatus,
    lineCount: s._count.lines,
  }));
}

/** Who the typed winner is, and which of their sales the lot could join — what the result dialog
 *  shows while it is filled in, so what it says and what the save does cannot disagree. */
export async function lookupFacebookWinner(
  ownerId: string,
  offerId: string,
  input: { winnerName: string; profileUrl: string }
): Promise<FacebookWinnerLookup> {
  const offer = await readFacebookOffer(ownerId, offerId);
  const profile = normalizeFacebookProfileUrl(input.profileUrl);
  if (!profile.ok) return { contact: null, conflict: profile.message, openSales: [] };
  const { contact, conflict } = await findWinner(offer.collectionId, input.winnerName.trim(), profile.value);
  return {
    contact,
    conflict,
    openSales: contact ? await openSalesOf(offer.collectionId, offer.platformId, offer.currency, contact.id) : [],
  };
}

/**
 * Record that somebody won the auction, or bought the quick buy (#1671): them as a buyer contact, and
 * the sale — a new one, or their open sale named by `saleId` — holding every set the offer still has,
 * the price split over them in cents. The offer is `sold` once every set is (`addSaleLines`). On an
 * auction the winning bid is also the offer's final price, the observation the lists show; a quick
 * buy's asking price is the seller's own and stays as it was. Returns the sale the lot went into.
 */
export async function recordFacebookSale(
  ownerId: string,
  offerId: string,
  input: FacebookWinInput
): Promise<{ saleId: string; buyerId: string }> {
  const offer = await readFacebookOffer(ownerId, offerId);
  const auction = isAuctionListing(offer.listingType);
  const cleaned = cleanFacebookWin(input, offer.listingType);
  if (!cleaned.ok) throw new Error(cleaned.message);
  const win = cleaned.value;

  const sets = offer.sets.filter((s) => s.saleLines.length === 0 && s.items.length > 0);
  if (sets.length === 0) {
    throw new Error(`Nothing is left to sell on this ${auction ? "auction" : "offer"} — every set has sold.`);
  }

  const { contact, conflict } = await findWinner(offer.collectionId, win.winnerName, win.profileUrl);
  if (conflict) throw new Error(conflict);

  // The target sale is checked before anything is written: a stale choice (the sale was sent, or
  // deleted, since the dialog read it) is refused with nothing changed.
  if (win.saleId) {
    const open = contact
      ? await openSalesOf(offer.collectionId, offer.platformId, offer.currency, contact.id)
      : [];
    if (!open.some((s) => s.id === win.saleId)) {
      throw new Error("That sale is no longer open to this winner — choose again.");
    }
  }

  // The winner: an existing contact takes the buyer role and, where it has none, the profile link; a
  // new one is created as a buyer with both.
  const buyerId = contact
    ? (
        await prisma.contact.update({
          where: { id: contact.id },
          data: { buyer: true, ...(win.profileUrl && !contact.facebookProfileUrl ? { facebookProfileUrl: win.profileUrl } : {}) },
          select: { id: true },
        })
      ).id
    : (
        await prisma.contact.create({
          data: { collectionId: offer.collectionId, name: win.winnerName, buyer: true, facebookProfileUrl: win.profileUrl },
          select: { id: true },
        })
      ).id;

  // The winning bid is the auction's final figure — the observation the lists show — before it sells.
  if (auction) await patchOffer(ownerId, offerId, { price: win.price });

  const prices = splitAuctionPrice(win.price, sets.length);
  const lines: SaleLineDraft[] = sets.map((s, i) => ({
    offerId,
    offerSetId: s.id,
    price: prices[i],
    itemIds: s.items.map((it) => it.itemId),
  }));

  if (win.saleId) {
    await addSaleLines(ownerId, win.saleId, lines);
    return { saleId: win.saleId, buyerId };
  }
  const saleId = await createSale(
    ownerId,
    offer.collectionId,
    {
      platformId: offer.platformId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: win.soldAt,
      currency: offer.currency,
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    },
    { offerCurrency: offer.currency }
  );
  try {
    await addSaleLines(ownerId, saleId, lines);
  } catch (err) {
    // A header with nothing in it is not a sale anyone recorded: take it back and report why.
    await deleteSale(ownerId, saleId);
    throw err;
  }
  return { saleId, buyerId };
}

/** Record that nobody bid: the auction is withdrawn, which frees its copies. Listing them again is a
 *  new offer (decided with the collector on 2026-10-03). A quick buy has no bids to lack, so it is
 *  withdrawn the ordinary way. */
export async function recordFacebookAuctionNoBids(ownerId: string, offerId: string): Promise<void> {
  const offer = await readFacebookOffer(ownerId, offerId);
  if (!isAuctionListing(offer.listingType)) {
    throw new Error("A quick buy has no bids — withdraw it from the offer's actions instead.");
  }
  await setOfferState(ownerId, offerId, "withdrawn");
}
