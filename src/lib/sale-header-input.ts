import "server-only";
import { resolvePurchaseContact } from "./contacts";
import { parseAmount, parseSaleDate, CUSTOM_SHIPPING_METHOD } from "./sale-rules";
// The sale's transaction link (#292) follows the offer link's rule exactly — trim, blank clears —
// so it reuses that normaliser rather than restating it.
import { normalizeUrl } from "./offer-rules";
import type { SaleShippingInput } from "./sales";

/**
 * The sale header as a **form** submits it, and the one place that turns that into what the domain
 * layer takes.
 *
 * It lives here rather than in `src/app/actions/sales.ts` because two entry points now write a sale
 * header: the sale form itself, and the Allegro order flow (#463), which pre-fills the same form and
 * saves it through its own action. A `"use server"` module can only export async functions, so a
 * shared parser cannot live in one — and a second copy of "which anchor did the form send" is
 * exactly the drift #205's single-anchor rule cannot survive.
 */

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

export interface ResolvedSaleHeader {
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

/** Parse the form's shipping block into the domain's input (#468). A one-off carries its typed
 * name; a dictionary pick carries only the id, since the domain re-reads the row for the name. */
export function resolveSaleShipping(
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

export async function resolveSaleHeader(
  collectionId: string,
  raw: SaleHeaderRaw
): Promise<({ ok: true } & ResolvedSaleHeader) | { ok: false; message: string }> {
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
  const shipping = resolveSaleShipping(raw.shipping);
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
