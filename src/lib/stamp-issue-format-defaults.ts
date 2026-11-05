// A stamp's issue format (#2439) — the form the stamp was issued in — as far as it is pure: the
// values a collection starts with and the words an empty one is shown as. No Prisma, no React, no
// `server-only`, so the stamp form, the stamp's page and the unit suite can all read it.

import type { TagColor } from "./tag-colors";

/**
 * The issue formats seeded into every new collection, in display order. Kept in sync with the
 * backfill in `20261105120000_stamp_issue_format`. The collector can add, rename, translate,
 * recolour, reorder and delete them afterwards.
 *
 * **There is no "Stamp" row**: no issue format means an ordinary stamp, as no format means a single.
 * The colours are the palette's ten hues, one each, so no two values share a chip colour; some share
 * a hue with a condition, as the collector chose.
 */
export const DEFAULT_ISSUE_FORMATS: ReadonlyArray<{
  name: string;
  abbreviation: string;
  color: TagColor;
}> = [
  { name: "Souvenir sheet", abbreviation: "Bl", color: "indigo" },
  // A stamp taken out of a souvenir sheet is catalogued apart, and a copy of it is a copy of a stamp
  // of its own, not of the sheet.
  { name: "Stamp from a souvenir sheet", abbreviation: "exBl", color: "violet" },
  { name: "Miniature sheet", abbreviation: "MS", color: "blue" },
  { name: "Tête-bêche", abbreviation: "TB", color: "red" },
  { name: "Se-tenant", abbreviation: "ST", color: "orange" },
  { name: "Booklet", abbreviation: "MH", color: "pink" },
  { name: "Booklet pane", abbreviation: "HBl", color: "amber" },
  { name: "Stamp from a booklet", abbreviation: "exMH", color: "teal" },
  { name: "Coil stamp", abbreviation: "Coil", color: "green" },
  { name: "Postal stationery", abbreviation: "PS", color: "slate" },
];

/** The issue format's translatable fields, in the order the settings form shows them — a format's
 * two, falling back independently. */
export const ISSUE_FORMAT_TRANSLATION_FIELDS = ["name", "abbreviation"] as const;

/** How a stamp with no issue format reads in a picker: an ordinary stamp, not a missing value. */
export const NO_ISSUE_FORMAT_LABEL = "— (stamp)";

/** A stamp's issue format as the screens draw it — the default language's words and the chip
 * colour. Null is an ordinary stamp. */
export interface StampIssueFormatLabel {
  name: string;
  abbreviation: string;
  color: string | null;
}
