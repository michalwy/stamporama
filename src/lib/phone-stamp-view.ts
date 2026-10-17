// The phone stamp screen's words (#2003, ADR-0072): what a copy, a value and the copies held read as
// on one narrow column. Pure, so the unit suite holds it — the reads behind it are the desk's own
// (`phone-stamp.ts`), and nothing here decides a figure, only how one is said.

import { buildLocationPath, type LocationPathNode } from "./location-path";
import type { StampCopyCounts } from "./copy-counts";
import type { MarketConfidenceBadge } from "./market-value";

/**
 * How many copies are held, as the screen's first line about them, and the two figures the desk
 * states **beside** that total rather than in it: the copies held under the stamp's variants (#528)
 * and the copies that might be this stamp (#1651). A stamp with none of the three says so.
 */
export function phoneCopiesSummary(
  copies: Pick<StampCopyCounts, "total">,
  variantTotal: number,
  possible: number
): string[] {
  const lines: string[] = [];
  if (copies.total > 0) lines.push(`${copies.total} ${copies.total === 1 ? "copy" : "copies"} held`);
  else lines.push("No copies held");
  if (variantTotal > 0) lines.push(`${variantTotal} more under its variants`);
  if (possible > 0) lines.push(`${possible} more might be this stamp`);
  return lines;
}

/** The fields of a copy the phone states — a slice of the Copies list's own row. */
export interface PhoneCopySource {
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusName: string | null;
  formatName: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  locationId: string | null;
  locationRef: string | null;
}

export interface PhoneCopyLine {
  /** Condition, certificate and — for a multiple — the format: `MNH · No certificate`. */
  grade: string;
  /** The location's path and the place within it, or a plain *No location*. */
  location: string;
  /** In collection / For sale / For trade, or *No disposition* when the copy carries none. */
  dispositions: string[];
}

/** The desk's three markers, in the Copies row's order and words. */
const DISPOSITIONS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

/**
 * One copy, as three short facts. Certificate is always said — *No certificate* is a fact a buyer at
 * a fair asks about — while the format is said only for a multiple, a single being what a stamp is
 * unless stated otherwise.
 */
export function phoneCopyLine(
  copy: PhoneCopySource,
  locations: readonly LocationPathNode[]
): PhoneCopyLine {
  const grade = [
    copy.conditionAbbreviation || copy.conditionName,
    copy.certificateStatusName ?? "No certificate",
    copy.formatName,
  ]
    .filter(Boolean)
    .join(" · ");
  const path = buildLocationPath(locations, copy.locationId);
  const location = path
    ? copy.locationRef
      ? `${path} · ${copy.locationRef}`
      : path
    : copy.locationRef
      ? copy.locationRef
      : "No location";
  const dispositions = DISPOSITIONS.filter((d) => copy[d.key]).map((d) => d.label);
  return {
    grade,
    location,
    dispositions: dispositions.length > 0 ? dispositions : ["No disposition"],
  };
}

/** The axes a value is read at — a catalogue cell or a market key. */
export interface PhoneValueAxes {
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
  formatName?: string | null;
  formatSortOrder?: number;
}

/** `MNH · No cert.`, and the format after them for a multiple — the Valuation grid's own words for
 *  a row, a column and a format table, on one line because the phone has no room for the grid. */
export function phoneValueLabel(axes: PhoneValueAxes): string {
  return [axes.conditionAbbreviation, axes.certificateStatusAbbreviation ?? "No cert.", axes.formatName]
    .filter(Boolean)
    .join(" · ");
}

/** The Valuation grid's order, flattened: format, then condition, then certificate — each by the
 *  collector's own sort order, so a list reads down the way the desk's tables read across. */
export function sortByValueAxes<T extends PhoneValueAxes>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.formatSortOrder ?? -1) - (b.formatSortOrder ?? -1) ||
      a.conditionSortOrder - b.conditionSortOrder ||
      a.certificateSortOrder - b.certificateSortOrder
  );
}

/** How many results a market figure stands on, and how far to trust it — said in words, because
 *  the desk's colour on the amount is a hover away from its explanation and a phone has no hover. */
export function phoneMarketEvidence(n: number, badge: MarketConfidenceBadge): string {
  return `${n} ${n === 1 ? "result" : "results"} · ${badge} confidence`;
}
