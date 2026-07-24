"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createSale,
  updateSaleHeader,
  updateSaleAmount,
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
  type SaleStatus,
} from "@/lib/sales";
import { resolvePurchaseContact } from "@/lib/contacts";
import { parsePrice, parseAmount, parseSaleDate } from "@/lib/sale-rules";

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
  soldAt: string;
  currency: string;
  /** Which buyer-side anchor the form submitted (#205): "direct" uses `buyerHandling`, "total" uses
   * `buyerPaidTotal` and derives handling. The unused field is ignored. */
  handlingMode: "direct" | "total";
  buyerHandling: string;
  buyerPaidTotal: string;
  commission: string;
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
      soldAt: Date;
      currency: string;
      buyerHandling: string | null;
      buyerPaidTotal: string | null;
      commission: string | null;
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
    soldAt,
    currency,
    buyerHandling: raw.handlingMode === "total" ? null : buyerHandling.value,
    buyerPaidTotal: raw.handlingMode === "total" ? buyerPaidTotal.value : null,
    commission: commission.value,
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
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
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
      soldAt: header.soldAt,
      currency: header.currency,
      buyerHandling: header.buyerHandling,
      buyerPaidTotal: header.buyerPaidTotal,
      commission: header.commission,
    });
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the sale.");
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

/** Set (or clear) my shipping cost in any currency (#206). The rate to base is frozen server-side.
 * A blank amount clears the shipping cost regardless of the currency passed. */
export async function updateSaleShippingAction(
  saleId: string,
  rawAmount: string,
  currency: string
): Promise<SaleActionState> {
  const session = await getSession();
  const parsed = parseAmount(rawAmount, "Shipping cost");
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const ccy = currency.trim().toUpperCase();
  if (parsed.value != null && !ccy) {
    return { status: "error", message: "Choose the currency the shipping was paid in." };
  }
  try {
    await updateSaleShipping(session.user.id, saleId, parsed.value, ccy);
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
