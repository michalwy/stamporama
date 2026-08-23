"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createSale,
  updateSaleHeader,
  updateSaleAmount,
  updateSaleTransactionUrl,
  updateSaleShipment,
  updateSaleShipping,
  addSaleLines,
  updateSaleLinePrice,
  removeSaleLine,
  swapSaleLineSet,
  deleteSale,
  setSaleStatus,
  setSaleLineItemPacked,
  isSaleStatus,
  SaleActionBlockedError,
  type SaleAmountField,
  type SaleStatus,
} from "@/lib/sales";
import {
  createSaleShareToken,
  revokeSaleShareToken,
  setSaleShareOptions,
} from "@/lib/sale-share";
import { parseAmount, parsePrice } from "@/lib/sale-rules";
// The sale's transaction link (#292) follows the offer link's rule exactly — trim, blank clears —
// so it reuses that normaliser rather than restating it.
import { normalizeUrl } from "@/lib/offer-rules";
import { normalizeTrackingCode } from "@/lib/tracking-rules";
// The form → domain parsing lives beside the domain (`sale-header-input.ts`) rather than here,
// because the Allegro order flow (#463) writes the same header through its own action and a
// `"use server"` module cannot export a shared parser.
import {
  resolveSaleHeader,
  resolveSaleShipping,
  type SaleHeaderRaw,
  type SaleShippingRaw,
} from "@/lib/sale-header-input";

export type { SaleHeaderRaw, SaleShippingRaw };

// Server actions for the sale transaction flow (ADR-0012, #166). Thin wrappers over the `sales`
// domain module. The flow mirrors purchases (#120/#121): a small header (platform + date +
// currency) is created first, then sold units and shared amounts are managed on the detail
// screen. Each returns a discriminated `{ status }` union the client renders.

export type SaleActionState =
  | { status: "success" }
  | { status: "error"; message: string };

export type CreateSaleActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof SaleActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

export async function createSaleAction(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<CreateSaleActionState> {
  const session = await getSession();
  const header = await resolveSaleHeader(collectionId, raw);
  if (!header.ok) return { status: "error", message: header.message };
  try {
    const id = await createSale(session.user.id, collectionId, {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      transactionUrl: header.transactionUrl,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
      shipping: header.shipping,
    });
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to start this sale. Please try again.");
  }
}

export async function updateSaleHeaderAction(
  collectionId: string,
  saleId: string,
  raw: SaleHeaderRaw
): Promise<SaleActionState> {
  const session = await getSession();
  const header = await resolveSaleHeader(collectionId, raw);
  if (!header.ok) return { status: "error", message: header.message };
  try {
    await updateSaleHeader(session.user.id, saleId, {
      platformId: header.platformId,
      buyerId: header.buyerId,
      externalRef: header.externalRef,
      transactionUrl: header.transactionUrl,
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
      shipping: header.shipping,
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the sale.");
  }
}

/** Set (or clear) the sale's link to the transaction on the marketplace (#292), in place from the
 * detail screen. Blank clears it. Allowed in any fulfillment status, like the offer link (#213). */
export async function updateSaleTransactionUrlAction(
  saleId: string,
  raw: string
): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await updateSaleTransactionUrl(session.user.id, saleId, normalizeUrl(raw));
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the transaction link.");
  }
}

/** Record who carried the parcel and its tracking number (#491), from the prompt shown while a sale
 * is marked Sent or the same dialog reopened from the detail header. A blank carrier means "no
 * answer of my own" and falls back to the shipping method's default on read; a blank number clears
 * it. Nothing else is done to the text — every carrier numbers its consignments its own way. */
export async function updateSaleShipmentAction(
  saleId: string,
  carrierId: string,
  rawTrackingCode: string
): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await updateSaleShipment(session.user.id, saleId, {
      carrierId: carrierId.trim() || null,
      trackingCode: normalizeTrackingCode(rawTrackingCode),
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the shipment details.");
  }
}

const AMOUNT_LABEL: Record<SaleAmountField, string> = {
  buyerHandling: "Buyer handling",
  buyerPaidTotal: "Total paid by buyer",
  commission: "Commission",
};

/** Set one single-currency shared amount (buyer handling / total / commission) in place from the
 * detail screen. Blank normalises to null (not recorded). */
export async function updateSaleAmountAction(
  saleId: string,
  field: SaleAmountField,
  raw: string
): Promise<SaleActionState> {
  const session = await getSession();
  const parsed = parseAmount(raw, AMOUNT_LABEL[field] ?? "Amount");
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateSaleAmount(session.user.id, saleId, field, parsed.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the amount.");
  }
}

/** Set (or clear) how the sale was shipped and what it cost me (#206/#468), in place from the
 * detail screen. The rate to base is frozen server-side; a blank amount clears the cost and leaves
 * the method standing. */
export async function updateSaleShippingAction(
  saleId: string,
  raw: SaleShippingRaw
): Promise<SaleActionState> {
  const session = await getSession();
  const shipping = resolveSaleShipping(raw);
  if (!shipping.ok) return { status: "error", message: shipping.message };
  try {
    await updateSaleShipping(session.user.id, saleId, shipping.value!);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the shipping cost.");
  }
}

/** A sold set added on the detail screen: an offer, its set, price, and copies. */
export interface SaleLineRaw {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
}

export async function addSaleLinesAction(
  saleId: string,
  raw: SaleLineRaw[]
): Promise<SaleActionState> {
  const session = await getSession();
  if (raw.length === 0) {
    return { status: "error", message: "Choose at least one set to add." };
  }
  const lines: { offerId: string; offerSetId: string; price: string; itemIds: string[] }[] = [];
  for (const line of raw) {
    const priced = parsePrice(line.price);
    if (!priced.ok) return { status: "error", message: priced.message };
    if (!line.offerId || !line.offerSetId || line.itemIds.length === 0) {
      return { status: "error", message: "Each sold set needs an offer and its copies." };
    }
    lines.push({
      offerId: line.offerId,
      offerSetId: line.offerSetId,
      price: priced.value,
      itemIds: line.itemIds,
    });
  }
  try {
    await addSaleLines(session.user.id, saleId, lines);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add the sold sets.");
  }
}

/** Override a sold unit's line sale price in place (#258). Independent of the offer's asking price —
 * only this sale record changes. Blank / invalid is rejected (a sold set always has a price). */
export async function updateSaleLinePriceAction(
  lineId: string,
  rawPrice: string
): Promise<SaleActionState> {
  const session = await getSession();
  const priced = parsePrice(rawPrice);
  if (!priced.ok) return { status: "error", message: priced.message };
  try {
    await updateSaleLinePrice(session.user.id, lineId, priced.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the sale price.");
  }
}

/** Say which of the offer's interchangeable sets actually left on this line (#697) — and, where the
 * chosen set is the one the line already names, confirm it. The price and the line itself stand;
 * only the copies (and their `packed` marks) move. */
export async function swapSaleLineSetAction(
  lineId: string,
  offerSetId: string
): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await swapSaleLineSet(session.user.id, lineId, offerSetId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to change which set left on this line.");
  }
}

export async function removeSaleLineAction(lineId: string): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await removeSaleLine(session.user.id, lineId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the sold unit.");
  }
}

/** Set a sale's fulfillment status inline from the detail view (#191). Appends a timestamped
 * transition event server-side. No side effects on copies or offers. */
export async function setSaleStatusAction(
  saleId: string,
  status: string
): Promise<SaleActionState> {
  const session = await getSession();
  if (!isSaleStatus(status)) {
    return { status: "error", message: "Unknown sale status." };
  }
  try {
    await setSaleStatus(session.user.id, saleId, status as SaleStatus);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the sale status.");
  }
}

/** Mark a single sold copy packed/unpacked (#192), independent of the sale's overall status. */
export async function setSaleLineItemPackedAction(
  itemId: string,
  packed: boolean
): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await setSaleLineItemPacked(session.user.id, itemId, packed);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the packed status.");
  }
}

export async function deleteSaleAction(saleId: string): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await deleteSale(session.user.id, saleId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the sale.");
  }
}

// ── The buyer's link (#699) ──────────────────────────────────────────────────────────────────────
//
// Which of an offer's interchangeable sets left is the seller's own fulfilment choice (#697) — but
// on a listing of three identical copies the seller is not the best person to make it. The buyer
// bought a stamp from a picture, and the three are the same thing only as far as the listing was
// concerned. Asking them costs a link.

export type SaleShareLinkActionState =
  | { status: "success"; token: string }
  | { status: "error"; message: string };

/**
 * A day from a date input → the moment that day ends.
 *
 * End of the day rather than its start, because a seller who types a date means "good through then".
 * Blank means no expiry, which is the default and the common case — the question closes when the
 * parcel is packed anyway.
 */
function parseShareExpiry(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Generate the sale's buyer link, replacing any it had. Regeneration is the same act, because a
 *  sale has one link and asking for a new one is asking for the old one to stop working. */
export async function createSaleShareLinkAction(
  saleId: string,
  rawExpiresAt: string
): Promise<SaleShareLinkActionState> {
  const session = await getSession();
  try {
    const { token } = await createSaleShareToken(session.user.id, saleId, {
      expiresAt: parseShareExpiry(rawExpiresAt),
    });
    return { status: "success", token };
  } catch (e) {
    return fail(e, "Failed to create the link. Please try again.");
  }
}

/** Change when the link runs out without changing the address — extending a link the buyer is
 *  halfway through answering must not break it. */
export async function setSaleShareOptionsAction(
  saleId: string,
  rawExpiresAt: string
): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await setSaleShareOptions(session.user.id, saleId, {
      expiresAt: parseShareExpiry(rawExpiresAt),
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the link. Please try again.");
  }
}

export async function revokeSaleShareLinkAction(saleId: string): Promise<SaleActionState> {
  const session = await getSession();
  try {
    await revokeSaleShareToken(session.user.id, saleId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to withdraw the link. Please try again.");
  }
}
