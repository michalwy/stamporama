// Pure, Prisma-free rules for the sale transaction flow (ADR-0012 §4/§5, #166). A `Sale` records
// that one or more `Offer`s sold on a single platform in a single currency; each `SaleLine` is a
// unit lot or a whole sub-lot that left, carrying the exact physical `Item`s. These helpers own
// the small validation/normalisation the domain module and server actions share, so they can be
// unit-tested without a DB. No side effects.

import type { OfferState } from "./offer-rules";

/** Offer states a sale can be recorded against: an offer must still be live (`active`) or merely
 * `paused` on the platform — a `sold` offer is already spent and a `withdrawn` one was taken
 * down. */
export const SELLABLE_OFFER_STATES: readonly OfferState[] = ["active", "paused"];

export function isSellableOfferState(state: OfferState): boolean {
  return state === "active" || state === "paused";
}

/** Validate and normalise a required, non-negative sale amount (a line price). Returns the 2-dp
 * string on success or a human-readable message on failure. */
export function parsePrice(
  raw: string
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Enter a sale price." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Sale price must be a number." };
  if (n < 0) return { ok: false, message: "Sale price cannot be negative." };
  return { ok: true, value: n.toFixed(2) };
}

/** Validate and normalise an **optional** non-negative shared amount (buyer handling, my
 * shipping, commission). Blank normalises to `null` (not recorded); a negative or non-numeric
 * value is rejected — the allocation engine assigns the sign, so every stored amount is ≥ 0. */
export function parseAmount(
  raw: string,
  label: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: `${label} must be a number.` };
  if (n < 0) return { ok: false, message: `${label} cannot be negative.` };
  return { ok: true, value: n.toFixed(2) };
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
