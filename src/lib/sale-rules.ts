// Pure, Prisma-free rules for the sale transaction flow (ADR-0012 §4/§5, #166). A `Sale` records
// that one or more `Offer`s sold on a single platform in a single currency; each `SaleLine` is a
// unit lot or a whole sub-lot that left, carrying the exact physical `Item`s. These helpers own
// the small validation/normalisation the domain module and server actions share, so they can be
// unit-tested without a DB. No side effects.

import type { OfferState } from "./offer-rules";
import { normalizeDecimalInput, roundAmount } from "./decimal-input";

/** Offer states a sale can be recorded against: an offer must still be live (`active`), merely
 * `paused` on the platform, or `pending` its approval (#1778) — a buyer may answer a post the
 * collector can see before anyone else can. A `sold` offer is already spent and a `withdrawn` one
 * was taken down. */
export const SELLABLE_OFFER_STATES: readonly OfferState[] = ["pending", "active", "paused"];

export function isSellableOfferState(state: OfferState): boolean {
  return state === "pending" || state === "active" || state === "paused";
}

/** The shipping-option select's value for **a one-off option** (#468) — one not worth adding to
 * the platform's list, named on the sale itself. A token rather than a blank, because
 * "sent by nothing I recorded" and "sent by something I am about to name" are different answers,
 * and only the second one asks for a name. */
export const CUSTOM_SHIPPING_OPTION = "custom";

/** Validate and normalise a required, non-negative sale amount (a line price). Returns the 2-dp
 * string on success or a human-readable message on failure. */
export function parsePrice(
  raw: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: false, message: "Enter a sale price." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Sale price must be a number." };
  if (n < 0) return { ok: false, message: "Sale price cannot be negative." };
  return { ok: true, value: roundAmount(n) };
}

/** Validate and normalise an **optional** non-negative shared amount (buyer handling, my
 * shipping, commission). Blank normalises to `null` (not recorded); a negative or non-numeric
 * value is rejected — the allocation engine assigns the sign, so every stored amount is ≥ 0. */
export function parseAmount(
  raw: string,
  label: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: `${label} must be a number.` };
  if (n < 0) return { ok: false, message: `${label} cannot be negative.` };
  return { ok: true, value: roundAmount(n) };
}

/** Parse a `YYYY-MM-DD` sale date into a UTC `Date` (the FX-freeze date). Returns `null` on a
 * malformed / impossible date so the caller can reject it. */
export function parseSaleDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against JS date rollover (e.g. 2026-02-31 → Mar 3).
  if (d.toISOString().slice(0, 10) !== trimmed) return null;
  return d;
}

/**
 * What the parcel is going by, as the shipment step names it (#491, #1923): the service the sale
 * says it was *sent as* when that is not its option's, else the option's snapshot name — null when
 * the sale names neither. Shared by the desk's shipment dialog and the phone's (#2007).
 */
export function shipmentGoingBy(sale: {
  sentAsDiffers: boolean;
  sentAsServiceName: string | null;
  shippingOptionName: string | null;
}): string | null {
  return sale.sentAsDiffers && sale.sentAsServiceName
    ? sale.sentAsServiceName
    : sale.shippingOptionName;
}
