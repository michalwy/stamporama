// Pure Colnect issue-date core (no Prisma, no server imports) so it can run in `test:unit` and be
// shared by the matcher endpoints (#655, part of #155).
//
// Colnect's catalog pages date a stamp to the day ("Issued on: 1945-01-22") while ours are commonly
// dated by year alone — a root stamp starts from its issue's year (#70) and a variant from its
// parent's (#360). So a matched item usually knows the date more precisely than we do, and the
// backfill's own rule applies: fill what we are missing, never quietly correct what we hold.
//
// The comparison is **per field**, not on the date as a whole, because that is what separates the
// two cases. `1945` against Colnect's `1945-01-22` disagrees about nothing — it states a year, and
// the same year — so writing the month and day destroys nothing and goes with the ordinary match
// write. `1945-01-23` against `1945-01-22` states a day, a different one, and that is a
// disagreement only the collector can settle (#433's shape, applied to a date).

/** A date as we store it: a year, month and day that may each be absent. */
export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** What Colnect prints, once parsed. A year is required — a month or day without one dates nothing. */
export interface ColnectDate {
  year: number;
  month: number | null;
  day: number | null;
}

/**
 * Parse the value of a Colnect "Issued on" row. The format is ISO-ish and may stop early:
 * `"1945-01-22"`, `"1945-01"`, `"1945"`. Anything else — an empty row, a decade, prose — yields
 * null, and the item then simply carries no date. A month or day outside its range is dropped along
 * with everything after it rather than being clamped: a value we cannot read is not a date we may
 * write.
 */
export function parseColnectDate(printed: string | null | undefined): ColnectDate | null {
  const value = (printed ?? "").trim();
  const m = value.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?\b/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] === undefined ? null : Number(m[2]);
  if (month !== null && (month < 1 || month > 12)) return { year, month: null, day: null };
  const day = m[3] === undefined ? null : Number(m[3]);
  if (day !== null && (day < 1 || day > 31)) return { year, month, day: null };
  return { year, month, day };
}

/** Format a date the way the app's own `formatIssuedDate` does ("22 Jan 1945"), kept local so this
 *  module stays pure and importable from `test:unit`. */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPartialDate(date: PartialDate): string | null {
  const parts: string[] = [];
  if (date.day) parts.push(String(date.day));
  if (date.month && date.month >= 1 && date.month <= 12) parts.push(MONTH_ABBR[date.month - 1]);
  if (date.year) parts.push(String(date.year));
  return parts.length ? parts.join(" ") : null;
}

/**
 * What we decided about the date Colnect prints, for the stamp it was matched to:
 *   - `would-fill` / `filled` — every field Colnect states is one we either lack or already agree
 *                               on, so the missing ones are the proposal (dry-run) or were written.
 *   - `conflict`              — the two sides state a *different* value in some field. Never
 *                               overwritten as part of a match; the collector settles it deliberately.
 * A date that adds nothing — Colnect knowing no more than we do — yields no proposal at all, exactly
 * as a catalog ref matching our number does.
 */
export type ColnectDateStatus = "would-fill" | "filled" | "conflict";

export interface ColnectDateProposal {
  status: ColnectDateStatus;
  /** The date to store: the merged one for a fill, Colnect's own for an overwrite. */
  date: PartialDate;
  /** {@link ColnectDateProposal.date} formatted, for naming the action. */
  label: string;
  /** What the stamp carries today, formatted. Null when it is dated by nothing at all. */
  currentLabel: string | null;
  /** What Colnect prints, formatted — the same as `label` for a fill, and the value an overwrite
   *  would put in place of ours for a conflict. */
  colnectLabel: string;
  /** For `conflict`: which fields the two sides disagree about, for saying so out loud. */
  conflictingFields?: ("year" | "month" | "day")[];
}

/**
 * Decide what Colnect's date means for a stamp that already carries `current`.
 *
 * A conflict's proposed date is **Colnect's, whole** rather than a merge: "use Colnect's date" is
 * the collector saying our value is the wrong one, and keeping our day under their year would store
 * a date neither side ever stated. So an overwrite replaces all three fields — including clearing a
 * day Colnect does not state, since a day belonging to a year we just abandoned is not a fact.
 */
export function proposeIssuedDate(
  colnect: ColnectDate | null,
  current: PartialDate
): ColnectDateProposal | null {
  if (!colnect) return null;

  const fields = ["year", "month", "day"] as const;
  const conflicting = fields.filter((f) => {
    const theirs = colnect[f];
    const mine = current[f];
    return theirs !== null && mine !== null && theirs !== mine;
  });

  const colnectDate: PartialDate = { year: colnect.year, month: colnect.month, day: colnect.day };
  const currentLabel = formatPartialDate(current);
  const colnectLabel = formatPartialDate(colnectDate) ?? String(colnect.year);

  if (conflicting.length > 0) {
    return {
      status: "conflict",
      date: colnectDate,
      label: colnectLabel,
      currentLabel,
      colnectLabel,
      conflictingFields: [...conflicting],
    };
  }

  // No disagreement: the fill is whatever Colnect states and we don't hold.
  const merged: PartialDate = {
    year: current.year ?? colnect.year,
    month: current.month ?? colnect.month,
    day: current.day ?? colnect.day,
  };
  const adds = fields.some((f) => current[f] === null && merged[f] !== null);
  if (!adds) return null;

  return {
    status: "would-fill",
    date: merged,
    label: formatPartialDate(merged) ?? colnectLabel,
    currentLabel,
    colnectLabel,
  };
}
