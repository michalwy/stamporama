"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createSale,
  updateSaleHeader,
  updateSaleAmount,
  updateSaleTransactionUrl,
  updateSaleShipping,
  addSaleLines,
  updateSaleLinePrice,
  removeSaleLine,
  deleteSale,
  setSaleStatus,
  setSaleLineItemPacked,
  isSaleStatus,
  SaleActionBlockedError,
  type SaleAmountField,
  type SaleShippingInput,
  type SaleStatus,
} from "@/lib/sales";
import { resolvePurchaseContact } from "@/lib/contacts";
import {
  parsePrice,
  parseAmount,
  parseSaleDate,
  CUSTOM_SHIPPING_METHOD,
} from "@/lib/sale-rules";
// The sale's transaction link (#292) follows the offer link's rule exactly — trim, blank clears —
// so it reuses that normaliser rather than restating it.
import { normalizeUrl } from "@/lib/offer-rules";

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

/** Raw sale-header fields. Platform and buyer are each a contact id or a typed name (find-or-
 * create, mirroring the offer/purchase pickers). Buyer handling + commission are the two shared
 * amounts known at sale time, so they live on the header. */
export interface SaleHeaderRaw {
  platformId: string | null;
  platformName: string | null;
  buyerId: string | null;
  buyerName: string | null;
  externalRef: string;
  /** Link to the transaction on the marketplace (#292). Blank clears it. */
  transactionUrl: string;
  soldAt: string;
  currency: string;
  /** Which buyer-side anchor the form submitted (#205): "direct" uses `buyerHandling`, "total" uses
   * `buyerPaidTotal` and derives handling. The unused field is ignored. */
  handlingMode: "direct" | "total";
  buyerHandling: string;
  buyerPaidTotal: string;
  commission: string;
  /** How the parcel is going and what it costs me (#468/#206), as the form's shipping block
   * submitted it. Absent when the form did not ask, which leaves an existing sale's shipping
   * untouched. */
  shipping?: SaleShippingRaw;
}

/** The shipping block of the sale form (#468). `methodId` is a dictionary row's id, or `CUSTOM_
 * SHIPPING_METHOD` for a one-off named in `methodName`; blank is no method at all. */
export interface SaleShippingRaw {
  methodId: string;
  methodName: string;
  cost: string;
  currency: string;
}

/** Parse the form's shipping block into the domain's input (#468). A one-off carries its typed
 * name; a dictionary pick carries only the id, since the domain re-reads the row for the name. */
function resolveShipping(
  raw: SaleShippingRaw | undefined
): { ok: true; value: SaleShippingInput | null } | { ok: false; message: string } {
  if (!raw) return { ok: true, value: null };
  const cost = parseAmount(raw.cost, "Shipping cost");
  if (!cost.ok) return { ok: false, message: cost.message };
  const custom = raw.methodId === CUSTOM_SHIPPING_METHOD;
  const methodName = raw.methodName.trim();
  if (custom && !methodName) {
    return { ok: false, message: "Name the shipping method, or pick one from the list." };
  }
  const currency = raw.currency.trim().toUpperCase();
  if (cost.value != null && !currency) {
    return { ok: false, message: "Choose the currency the shipping was paid in." };
  }
  return {
    ok: true,
    value: {
      methodId: custom ? null : raw.methodId.trim() || null,
      methodName: custom ? methodName : null,
      cost: cost.value,
      currency,
    },
  };
}

async function resolveHeader(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<
  | {
      ok: true;
      platformId: string;
      buyerId: string | null;
      externalRef: string | null;
      transactionUrl: string | null;
      soldAt: Date;
      currency: string;
      buyerHandling: string | null;
      buyerPaidTotal: string | null;
      commission: string | null;
      shipping: SaleShippingInput | null;
    }
  | { ok: false; message: string }
> {
  const soldAt = parseSaleDate(raw.soldAt);
  if (!soldAt) return { ok: false, message: "Enter a valid sale date." };
  // Currency is inherited from the platform (#196). The form only sends one as a first-sale
  // fallback (to set the platform's currency when unset); blank is fine when the platform already
  // has a currency. The domain resolves and locks it.
  const currency = raw.currency.trim();

  // Exactly one buyer-side anchor is stored (#205); the other is normalised to null. The offer
  // prices aren't known here (they live on the sale's lines), so the total ≥ gross check is done
  // in the dialog where gross is available; the domain clamps a shortfall on read.
  const buyerHandling = parseAmount(raw.buyerHandling, "Buyer handling");
  if (!buyerHandling.ok) return { ok: false, message: buyerHandling.message };
  const buyerPaidTotal = parseAmount(raw.buyerPaidTotal, "Total paid by buyer");
  if (!buyerPaidTotal.ok) return { ok: false, message: buyerPaidTotal.message };
  const commission = parseAmount(raw.commission, "Commission");
  if (!commission.ok) return { ok: false, message: commission.message };
  const shipping = resolveShipping(raw.shipping);
  if (!shipping.ok) return { ok: false, message: shipping.message };

  const platformId = await resolvePurchaseContact(collectionId, {
    id: raw.platformId,
    name: raw.platformName,
    role: "platform",
  });
  if (!platformId) return { ok: false, message: "Choose a platform this sale happened on." };

  // The buyer is optional — a blank name/id resolves to null (unknown/anonymous).
  const buyerId = await resolvePurchaseContact(collectionId, {
    id: raw.buyerId,
    name: raw.buyerName,
    role: "buyer",
  });

  return {
    ok: true,
    platformId,
    buyerId,
    externalRef: raw.externalRef.trim() || null,
    transactionUrl: normalizeUrl(raw.transactionUrl),
    soldAt,
    currency,
    buyerHandling: raw.handlingMode === "total" ? null : buyerHandling.value,
    buyerPaidTotal: raw.handlingMode === "total" ? buyerPaidTotal.value : null,
    commission: commission.value,
    shipping: shipping.value,
  };
}

export async function createSaleAction(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<CreateSaleActionState> {
  const session = await getSession();
  const header = await resolveHeader(collectionId, raw);
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
  const header = await resolveHeader(collectionId, raw);
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
  const shipping = resolveShipping(raw);
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
