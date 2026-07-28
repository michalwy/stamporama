"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  AuctionActionBlockedError,
  createAuctionLot,
  createAuctionSale,
  deleteAuctionLot,
  deleteAuctionSale,
  findOpenAuctionSale,
  setAuctionLotBid,
  setAuctionLotMaxBid,
  setAuctionLotMyBid,
  setAuctionSaleStatus,
  touchAuctionLotChecked,
  updateAuctionLot,
  updateAuctionSale,
} from "@/lib/auctions";
import { resolvePurchaseContact } from "@/lib/contacts";
import {
  normalizeAuctionText,
  normalizeAuctionUrl,
  parseAuctionAmount,
  parseAuctionInstant,
  parsePremiumPercent,
  type AuctionSaleStatus,
} from "@/lib/auction-rules";

// Server actions for auction tracking (#351/#352; ADR-0021). Thin wrappers over the `auctions`
// domain module, each returning a discriminated `{ status }` union the client renders.
//
// Seller and platform are resolved the way every other trading picker resolves a contact
// (`resolvePurchaseContact`): an id when a suggestion was picked, otherwise find-or-create from the
// typed name. A seller typed in for the first time is created carrying the `seller` role, so its
// auction defaults (#350) have somewhere to live from the next lot onwards.

export type AuctionActionState = { status: "success" } | { status: "error"; message: string };

export type CreateAuctionActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof AuctionActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

// ── Sales ───────────────────────────────────────────────────────────────────

/** Raw sale fields as the form submits them. Seller and platform are each an id or a typed name. */
export interface AuctionSaleRaw {
  sellerId: string | null;
  sellerName: string | null;
  platformId: string | null;
  platformName: string | null;
  name: string;
  url: string;
  /** ISO instant, converted from the `datetime-local` field in the browser — the only place the
   * collector's time zone is known. Blank means the sale has no single closing date, which is the
   * normal state of a marketplace basket. */
  endsAt: string;
  currency: string;
  shippingCost: string;
  premiumPercent: string;
  premiumFixed: string;
  status?: string;
}

type ResolvedSale = Awaited<ReturnType<typeof resolveSale>>;

async function resolveSale(collectionId: string, raw: AuctionSaleRaw) {
  const sellerId = await resolvePurchaseContact(collectionId, {
    id: raw.sellerId,
    name: raw.sellerName,
    role: "seller",
  });
  if (!sellerId) return { ok: false as const, message: "Name the seller this parcel comes from." };

  const platformId = await resolvePurchaseContact(collectionId, {
    id: raw.platformId,
    name: raw.platformName,
    role: "platform",
  });
  if (!platformId) {
    return { ok: false as const, message: "Name the platform this sale is running on." };
  }

  const shippingCost = parseAuctionAmount(raw.shippingCost, "Shipping");
  if (!shippingCost.ok) return { ok: false as const, message: shippingCost.message };
  const premiumPercent = parsePremiumPercent(raw.premiumPercent);
  if (!premiumPercent.ok) return { ok: false as const, message: premiumPercent.message };
  const premiumFixed = parseAuctionAmount(raw.premiumFixed, "Lot fee");
  if (!premiumFixed.ok) return { ok: false as const, message: premiumFixed.message };

  const endsAtRaw = raw.endsAt.trim();
  const endsAt = endsAtRaw ? parseAuctionInstant(endsAtRaw) : null;
  if (endsAtRaw && !endsAt) return { ok: false as const, message: "Enter a valid closing time." };

  return {
    ok: true as const,
    input: {
      sellerId,
      platformId,
      name: normalizeAuctionText(raw.name),
      url: normalizeAuctionUrl(raw.url),
      endsAt,
      currency: raw.currency.trim().toUpperCase(),
      shippingCost: shippingCost.value,
      premiumPercent: premiumPercent.value,
      premiumFixed: premiumFixed.value,
      status: raw.status as AuctionSaleStatus | undefined,
    },
  };
}

export async function createAuctionSaleAction(
  collectionId: string,
  raw: AuctionSaleRaw
): Promise<CreateAuctionActionState> {
  const session = await getSession();
  const resolved: ResolvedSale = await resolveSale(collectionId, raw);
  if (!resolved.ok) return { status: "error", message: resolved.message };
  try {
    const id = await createAuctionSale(session.user.id, collectionId, resolved.input);
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to start this auction sale. Please try again.");
  }
}

export async function updateAuctionSaleAction(
  collectionId: string,
  saleId: string,
  raw: AuctionSaleRaw
): Promise<AuctionActionState> {
  const session = await getSession();
  const resolved: ResolvedSale = await resolveSale(collectionId, raw);
  if (!resolved.ok) return { status: "error", message: resolved.message };
  try {
    await updateAuctionSale(session.user.id, saleId, resolved.input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the auction sale.");
  }
}

export async function setAuctionSaleStatusAction(
  saleId: string,
  status: AuctionSaleStatus
): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await setAuctionSaleStatus(session.user.id, saleId, status);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to change the sale's status.");
  }
}

export async function deleteAuctionSaleAction(saleId: string): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await deleteAuctionSale(session.user.id, saleId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the auction sale.");
  }
}

// ── Lots ────────────────────────────────────────────────────────────────────

/** Raw lot fields as the add/edit dialog submits them.
 *
 * The sale is reached in one of two ways, which is the whole point of #352: an existing
 * `auctionSaleId` (the proposed open sale, or one picked when moving a lot), or the seller +
 * platform pair with `startNewSale`, which creates the sale from the seller's defaults. */
export interface AuctionLotRaw {
  auctionSaleId: string | null;
  sale: AuctionSaleRaw | null;
  startNewSale: boolean;
  lotNo: string;
  url: string;
  title: string;
  /** ISO instant, converted in the browser (see {@link AuctionSaleRaw.endsAt}). Required: the
   * closing time is what the whole watchlist is ordered and aged against. */
  endsAt: string;
  /** What the lot opened at, when the listing states one. Optional, and never a stand-in for a
   * bid: it is recorded, not costed. */
  startingPrice: string;
  currentBid: string;
  /** What the collector has placed at the platform, when they have bid at all. */
  myBid: string;
  maxBid: string;
  notes: string;
}

async function resolveLot(collectionId: string, ownerId: string, raw: AuctionLotRaw) {
  const endsAt = parseAuctionInstant(raw.endsAt);
  if (!endsAt) return { ok: false as const, message: "Enter when this lot closes." };

  const startingPrice = parseAuctionAmount(raw.startingPrice, "Starting price");
  if (!startingPrice.ok) return { ok: false as const, message: startingPrice.message };
  const currentBid = parseAuctionAmount(raw.currentBid, "Current bid");
  if (!currentBid.ok) return { ok: false as const, message: currentBid.message };
  const myBid = parseAuctionAmount(raw.myBid, "My bid");
  if (!myBid.ok) return { ok: false as const, message: myBid.message };
  const maxBid = parseAuctionAmount(raw.maxBid, "My ceiling");
  if (!maxBid.ok) return { ok: false as const, message: maxBid.message };

  // Resolve the settlement bucket. An explicit sale wins; otherwise the seller + platform pair
  // either reuses the open sale the dialog proposed (re-read here rather than trusted from the
  // client) or starts a new one seeded from the seller's defaults.
  let auctionSaleId = raw.auctionSaleId?.trim() || "";
  if (!auctionSaleId) {
    if (!raw.sale) return { ok: false as const, message: "Name the seller and platform." };
    const resolved = await resolveSale(collectionId, raw.sale);
    if (!resolved.ok) return { ok: false as const, message: resolved.message };
    if (!raw.startNewSale) {
      const open = await findOpenAuctionSale(
        ownerId,
        collectionId,
        resolved.input.sellerId,
        resolved.input.platformId
      );
      if (open) auctionSaleId = open.id;
    }
    if (!auctionSaleId) {
      auctionSaleId = await createAuctionSale(ownerId, collectionId, {
        ...resolved.input,
        // A sale started from the add-lot dialog inherits the lot's closing time when it has none
        // of its own: for a house sale that is exactly the sale's date, and for a marketplace
        // basket it is a harmless default the next lot overrides nothing with.
        endsAt: resolved.input.endsAt ?? endsAt,
      });
    }
  }

  return {
    ok: true as const,
    input: {
      auctionSaleId,
      lotNo: normalizeAuctionText(raw.lotNo),
      url: normalizeAuctionUrl(raw.url),
      title: normalizeAuctionText(raw.title),
      endsAt,
      startingPrice: startingPrice.value,
      currentBid: currentBid.value,
      myBid: myBid.value,
      maxBid: maxBid.value,
      notes: normalizeAuctionText(raw.notes),
    },
  };
}

export async function createAuctionLotAction(
  collectionId: string,
  raw: AuctionLotRaw
): Promise<CreateAuctionActionState> {
  const session = await getSession();
  try {
    const resolved = await resolveLot(collectionId, session.user.id, raw);
    if (!resolved.ok) return { status: "error", message: resolved.message };
    const id = await createAuctionLot(session.user.id, collectionId, resolved.input);
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to add this lot. Please try again.");
  }
}

export async function updateAuctionLotAction(
  collectionId: string,
  lotId: string,
  raw: AuctionLotRaw
): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    const resolved = await resolveLot(collectionId, session.user.id, raw);
    if (!resolved.ok) return { status: "error", message: resolved.message };
    await updateAuctionLot(session.user.id, lotId, resolved.input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update this lot.");
  }
}

/** The inline bid refresh from the list. Blank clears both the bid and its timestamp — there is
 * then no observation to date. */
export async function setAuctionLotBidAction(
  lotId: string,
  rawBid: string
): Promise<AuctionActionState> {
  const session = await getSession();
  const bid = parseAuctionAmount(rawBid, "Current bid");
  if (!bid.ok) return { status: "error", message: bid.message };
  try {
    await setAuctionLotBid(session.user.id, lotId, bid.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record the bid.");
  }
}

/** The inline "what I placed" edit from the list. Unlike the bid it does not stamp `checkedAt`:
 * that dates observations of the *auction's* price, and this is a commitment of the collector's. */
export async function setAuctionLotMyBidAction(
  lotId: string,
  rawBid: string
): Promise<AuctionActionState> {
  const session = await getSession();
  const bid = parseAuctionAmount(rawBid, "My bid");
  if (!bid.ok) return { status: "error", message: bid.message };
  try {
    await setAuctionLotMyBid(session.user.id, lotId, bid.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record your bid.");
  }
}

/** The inline ceiling edit from the list. */
export async function setAuctionLotMaxBidAction(
  lotId: string,
  rawMax: string
): Promise<AuctionActionState> {
  const session = await getSession();
  const max = parseAuctionAmount(rawMax, "My ceiling");
  if (!max.ok) return { status: "error", message: max.message };
  try {
    await setAuctionLotMaxBid(session.user.id, lotId, max.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record your ceiling.");
  }
}

/** "Checked, unchanged": stamp `checkedAt` without retyping a figure that has not moved. */
export async function touchAuctionLotCheckedAction(lotId: string): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await touchAuctionLotChecked(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record the check.");
  }
}

export async function deleteAuctionLotAction(lotId: string): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await deleteAuctionLot(session.user.id, lotId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete this lot.");
  }
}
