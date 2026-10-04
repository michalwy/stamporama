"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  AuctionActionBlockedError,
  confirmAuctionLotReviews,
  confirmAuctionSaleReview,
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  deleteAuctionLot,
  deleteAuctionLotLine,
  resolveAuctionLineStamps,
  deleteAuctionSale,
  findOpenAuctionSale,
  recordAuctionLotTransition,
  setAuctionLotBid,
  setAuctionLotMaxBid,
  setAuctionLotMyBid,
  setAuctionLotMyBidAndCeiling,
  setAuctionLotNotStamps,
  setAuctionSaleStatus,
  settleAuctionSale,
  touchAuctionLotChecked,
  updateAuctionLot,
  updateAuctionLotLine,
  updateAuctionSale,
  type AuctionLotTransition,
  type AuctionSettlementInput,
} from "@/lib/auctions";
import { resolvePurchaseContact } from "@/lib/contacts";
import { normalizeLineCondition } from "@/lib/auction-line-condition";
import {
  applyAuctionLotTagChanges,
  setAuctionLotTagEntries,
  type ItemTagChanges,
} from "@/lib/tags";
import { tagEntriesFrom, type TagEntry } from "@/lib/tag-entry";
import {
  normalizeAuctionText,
  normalizeAuctionUrl,
  parseAuctionAmount,
  parseAuctionInstant,
  parseLotQuantity,
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
  if (!session) redirect(await signInPath());
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

/** Settle a parcel into a purchase (#28). Returns the purchase's id so the dialog can send the
 * collector straight to the intake screen — that is where the work continues. */
export async function settleAuctionSaleAction(
  saleId: string,
  input: AuctionSettlementInput
): Promise<CreateAuctionActionState> {
  const session = await getSession();
  try {
    const { purchaseId } = await settleAuctionSale(session.user.id, saleId, input);
    return { status: "success", id: purchaseId };
  } catch (e) {
    return fail(e, "Failed to settle this sale into a purchase.");
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
  /** The lot's composition, entered while the lot is being captured (#353). Empty is the normal
   * state — a lot can always be described later from the sale's screen. Create only. */
  lines?: AuctionLotLineRaw[];
  /** The tag field's chips (#1625): the whole set, replacing the lot's. Absent — the field had not
   *  loaded, or the caller has none — leaves the lot's tags as they are. */
  tags?: TagEntry[];
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

  // The composition, if any came with the lot. Refused as a whole on the first bad line rather than
  // silently dropping it: the collector typed it, and a lot created without it looks entered.
  const lines = [];
  for (const rawLine of raw.lines ?? []) {
    const resolved = await resolveLine(collectionId, rawLine);
    if (!resolved.ok) return { ok: false as const, message: resolved.message };
    lines.push(...resolved.inputs);
  }

  return {
    ok: true as const,
    input: {
      auctionSaleId,
      lines,
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
    await applyTypedLotTags(session.user.id, id, raw, "add");
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
    await applyTypedLotTags(session.user.id, lotId, raw, "edit");
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update this lot.");
  }
}

/**
 * The tags typed into the lot dialog (#1625), written after the lot itself — the copy dialog's rule
 * (`applyTypedTags` in `items.ts`): when adding, an empty set writes nothing; when editing, a
 * submitted set replaces the lot's tags, and an absent one leaves them alone. Re-read through
 * `tagEntriesFrom` because a server action's argument is whatever the wire carried.
 */
async function applyTypedLotTags(
  ownerId: string,
  lotId: string,
  raw: AuctionLotRaw,
  mode: "add" | "edit"
): Promise<void> {
  const entries = raw.tags === undefined ? undefined : tagEntriesFrom(raw.tags);
  if (!entries || (mode === "add" && entries.length === 0)) return;
  await setAuctionLotTagEntries(ownerId, lotId, entries);
}

export type AuctionLotTagsActionState =
  | { status: "success"; count: number }
  | { status: "error"; message: string };

/**
 * Put tags on and take tags off the lots ticked on the lots list (#1625) — never a replace: every
 * tag the pass does not name stays where it is on each lot. See `applyAuctionLotTagChanges`.
 */
export async function applyAuctionLotTagChangesAction(
  collectionId: string,
  lotIds: string[],
  changes: ItemTagChanges
): Promise<AuctionLotTagsActionState> {
  const session = await getSession();
  try {
    // A server action's arguments are whatever the wire carried, so only strings go on.
    const ids = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
    const count = await applyAuctionLotTagChanges(session.user.id, collectionId, ids(lotIds), {
      addTagIds: ids(changes?.addTagIds),
      removeTagIds: ids(changes?.removeTagIds),
    });
    return { status: "success", count };
  } catch (e) {
    return fail(e, "Failed to change the tags on these lots.");
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

/** *Bid this* and its undo (#1515): the bid and the separate ceiling in one write. A blank ceiling
 * is the ordinary case — it then follows the bid. */
export async function setAuctionLotMyBidAndCeilingAction(
  lotId: string,
  rawBid: string,
  rawMax: string
): Promise<AuctionActionState> {
  const session = await getSession();
  const bid = parseAuctionAmount(rawBid, "My bid");
  if (!bid.ok) return { status: "error", message: bid.message };
  const max = parseAuctionAmount(rawMax, "My ceiling");
  if (!max.ok) return { status: "error", message: max.message };
  try {
    await setAuctionLotMyBidAndCeiling(session.user.id, lotId, {
      myBid: bid.value,
      maxBid: max.value,
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record your bid.");
  }
}

/** The ceiling set apart from the bid (#1515), from the list. Blank clears it, and the ceiling
 * follows the bid again. */
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

/**
 * *Confirm* the *to review* marker on one lot or on the ticked lots in view (#1626). The collector's
 * act alone: no agent API operation reaches this, and editing a lot does not do it on the way.
 */
export async function confirmAuctionLotReviewsAction(
  collectionId: string,
  lotIds: string[]
): Promise<{ status: "success"; confirmed: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const confirmed = await confirmAuctionLotReviews(session.user.id, collectionId, lotIds);
    return { status: "success", confirmed };
  } catch (e) {
    return fail(e, "Failed to confirm the review.");
  }
}

/** *Confirm* for a whole sale (#1626): its own marker and every one of its lots'. */
export async function confirmAuctionSaleReviewAction(
  saleId: string
): Promise<{ status: "success"; confirmed: number } | { status: "error"; message: string }> {
  const session = await getSession();
  try {
    const confirmed = await confirmAuctionSaleReview(session.user.id, saleId);
    return { status: "success", confirmed };
  } catch (e) {
    return fail(e, "Failed to confirm the review.");
  }
}

/**
 * Move a lot along its lifecycle, or take the move back (#354, rewritten for ADR-0021 §4).
 *
 * This records **figures**, not a verdict: won, lost and observed are derived from what the lot
 * fetched against what the collector placed, so there is no outcome to submit. `rawFinalPrice`
 * matters only when closing, and the domain refuses a blank one unless no bid was ever placed —
 * the lot then reads as observed, which is what tracking a price without bidding actually is.
 *
 * `wonTie` is passed through untouched, including as null. Null is not "no" but "not answered", and
 * the domain is the one place that knows whether the figures even tie and so whether the question
 * had to be answered at all.
 */
export async function setAuctionLotStatusAction(
  lotId: string,
  status: "closed" | "cancelled" | "open",
  rawFinalPrice = "",
  wonTie: boolean | null = null
): Promise<AuctionActionState> {
  const session = await getSession();
  let transition: AuctionLotTransition;
  if (status === "closed") {
    const finalPrice = parseAuctionAmount(rawFinalPrice, "Final price");
    if (!finalPrice.ok) return { status: "error", message: finalPrice.message };
    transition = { status: "closed", finalPrice: finalPrice.value, wonTie };
  } else {
    transition = { status };
  }
  try {
    await recordAuctionLotTransition(session.user.id, lotId, transition);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to record the lot.");
  }
}

/** Mark a lot *not stamps* with what it is, restate that, or remove the mark (#1624). */
export async function setAuctionLotNotStampsAction(
  lotId: string,
  notStamps: boolean,
  description = ""
): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await setAuctionLotNotStamps(session.user.id, lotId, {
      notStamps,
      description: description.trim() || null,
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update this lot.");
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

// ── Composition (#353) ──────────────────────────────────────────────────────

/** Raw composition-line fields as the editor submits them: a stamp × condition × certificate ×
 * format × quantity — the same shape a catalogue price is keyed on. */
export interface AuctionLotLineRaw {
  stampId: string;
  /** A **whole checklist** picked instead of a single stamp (#353; #531), as the purchase intake
   * offers: it expands here into one line per stamp on it. Blank for a plain
   * stamp pick, and never set when editing — an edit turning one line into twelve is not an edit. */
  checklistId?: string;
  /** The condition the line is settled at. Blank while it is not (#1623) — then one of
   * {@link possibleConditionIds}, or unknown when {@link conditionUnknown} says so. */
  conditionId: string;
  /** *MNH or MH*: the conditions the line may be in. A set of one is that condition. */
  possibleConditionIds?: string[];
  /** The listing does not say, and the line stands for any of the collection's conditions. Said
   * explicitly, so a condition simply not picked is still refused rather than read as unknown. */
  conditionUnknown?: boolean;
  /** Blank is **no certificate** — the unmarked default, as on a copy (ADR-0006 §2). */
  certificateStatusId: string;
  /** Blank is the single, which is not a dictionary row (ADR-0020). */
  formatId: string;
  quantity: string;
}

/**
 * One submitted line into the line inputs it actually means — **plural**, because a whole-checklist
 * pick fans out into one line per stamp on it. The expansion lives here rather than in the
 * domain so a line stays "a stamp at a condition" everywhere below this point.
 */
async function resolveLine(collectionId: string, raw: AuctionLotLineRaw) {
  const stampId = raw.stampId.trim();
  const checklistId = raw.checklistId?.trim() ?? "";
  if (!stampId && !checklistId) {
    return { ok: false as const, message: "Pick the stamp this line is about." };
  }
  const condition = normalizeLineCondition({
    conditionId: raw.conditionId,
    possibleConditionIds: raw.possibleConditionIds,
  });
  if (condition.conditionId === null && condition.possibleConditionIds.length === 0 && !raw.conditionUnknown) {
    return { ok: false as const, message: "Pick the condition this line is described in." };
  }
  const quantity = parseLotQuantity(raw.quantity);
  if (!quantity.ok) return { ok: false as const, message: quantity.message };

  let stampIds: string[];
  try {
    stampIds = await resolveAuctionLineStamps(collectionId, { stampId, checklistId });
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Could not resolve what to add.",
    };
  }

  // Every stamp on a checklist is described the same way — one condition, one certificate, one
  // format, the same count each. That is what "the lot contains this set" means; a lot that mixes
  // conditions within a set is entered stamp by stamp.
  return {
    ok: true as const,
    inputs: stampIds.map((id) => ({
      stampId: id,
      conditionId: condition.conditionId,
      possibleConditionIds: condition.possibleConditionIds,
      certificateStatusId: raw.certificateStatusId.trim() || null,
      formatId: raw.formatId.trim() || null,
      quantity: quantity.value,
    })),
  };
}

/** Add one or more lines: a stamp gives one, a whole issue one per required member. */
export async function createAuctionLotLineAction(
  collectionId: string,
  lotId: string,
  raw: AuctionLotLineRaw
): Promise<CreateAuctionActionState> {
  const session = await getSession();
  const resolved = await resolveLine(collectionId, raw);
  if (!resolved.ok) return { status: "error", message: resolved.message };
  try {
    let last = "";
    for (const input of resolved.inputs) {
      last = await createAuctionLotLine(session.user.id, lotId, input);
    }
    return { status: "success", id: last };
  } catch (e) {
    return fail(e, "Failed to add this line.");
  }
}

export async function updateAuctionLotLineAction(
  collectionId: string,
  lineId: string,
  raw: AuctionLotLineRaw
): Promise<AuctionActionState> {
  const session = await getSession();
  const resolved = await resolveLine(collectionId, { ...raw, checklistId: undefined });
  if (!resolved.ok) return { status: "error", message: resolved.message };
  // An edit re-points one line at one stamp; the issue shortcut is an *add* affordance, and is
  // stripped above rather than silently multiplying the line it was applied to.
  const [input] = resolved.inputs;
  try {
    await updateAuctionLotLine(session.user.id, lineId, input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update this line.");
  }
}

export async function deleteAuctionLotLineAction(lineId: string): Promise<AuctionActionState> {
  const session = await getSession();
  try {
    await deleteAuctionLotLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove this line.");
  }
}
