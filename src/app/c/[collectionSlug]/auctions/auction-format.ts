"use client";

// Presentation helpers for the auction screens (#351/#352). Client-only on purpose: every one of
// them reads the browser's own locale or time zone, which the server does not have. The lot list
// fetches after mount, so nothing here runs during a server render.

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A closing time or an observation timestamp, in the collector's own zone. */
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Date only — for a sale's optional closing date, where the time of day says nothing. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * "in 3 hours" / "2 days ago", at the coarsest unit that still says something. What a watchlist is
 * scanned for is *how soon*, and an exact timestamp buries that under six other numbers — the exact
 * one is a hover away on every surface that uses this.
 */
export function formatRelative(iso: string, now: Date): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return RELATIVE.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return RELATIVE.format(Math.round(diff / HOUR), "hour");
  return RELATIVE.format(Math.round(diff / DAY), "day");
}

/**
 * An ISO instant as a `datetime-local` input value. The browser's zone is the only place the
 * collector's own time is known, so the conversion happens here in both directions and the server
 * only ever sees an instant.
 */
export function toLocalInputValue(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = d.getTimezoneOffset() * MINUTE;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

/** The inverse: a `datetime-local` value as an ISO instant, or "" when the field is empty. */
export function fromLocalInputValue(local: string): string {
  const trimmed = local.trim();
  if (!trimmed) return "";
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** An amount with its currency, or a muted dash when nothing is recorded. Money is always in the
 * sale's currency — a lot has none of its own. */
export function formatMoney(amount: string | null, currency: string): string | null {
  return amount === null ? null : `${amount} ${currency}`;
}

/**
 * An amount as it is *stored*: two decimals, always. `40` becomes `40.00`, `20,5` becomes `20.50`.
 *
 * Used the moment a figure is committed — a field left, an inline edit confirmed — so what the
 * collector sees is already what the database will hold, rather than their own keystrokes waiting
 * to be rewritten by the next fetch. Blank stays blank (an unrecorded amount is not zero), and
 * anything unparseable is left exactly as typed for the server to reject with a message.
 */
export function formatAmountInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const n = Number(trimmed.replace(/,/g, "."));
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : raw;
}
