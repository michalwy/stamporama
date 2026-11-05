// Pure Colnect stamp-attribute core (no Prisma, no server imports) so it can run in `test:unit` and
// be shared by the matcher endpoints (#739, part of #155 and of #71).
//
// Every one of #71's six attributes is printed on the Colnect catalogue page of a stamp we already
// hold a `colnectId` for, and nobody is going to type them for a thousand stamps by hand. This is
// the comparison behind filling them, and it rides the rails `colnect-date.ts` laid for the issue
// date (#655): **fill what we state nothing for, report a disagreement, never overwrite silently**
// (#250).
//
// ## Two kinds of attribute, two kinds of answer
//
// Denomination and perforation are stored as printed (#72), so Colnect's text is directly
// comparable with ours and travels straight through.
//
// Colour, watermark, paper and printing method are **dictionary rows here and free text there**, so
// the comparison needs a per-collection mapping — `ColnectConditionMapping` (#404) in a fourth form,
// stored as `colnectValue` on the dictionary row itself. A Colnect value the mapping does not cover
// is reported as `unmapped` and **nothing is created**: inventing dictionary rows off a scraped page
// is how a vocabulary fills with near-duplicates, and the collector settles it once in Settings
// rather than per page.
//
// ## The issue format, a seventh (#2443)
//
// Colnect prints each stamp's **Format** — Stamp, Souvenir Sheet, Miniature Sheet… — and the stamp's
// issue format (#2439) is a dictionary of exactly that kind, so it rides the same rails as a fifth
// mapped dictionary: `colnectValue` on its row, `unmapped` when nothing maps. One rule is its own:
// Colnect's **"Stamp" is an ordinary stamp**, which here is *no* issue format, so it proposes nothing
// at all — not a fill, since there is nothing to fill with, and not a disagreement with a format the
// collector set, since a stamp from a souvenir sheet is a "Stamp" on Colnect and an `exBl` here.
//
// ## What is never proposed
//
// A value Colnect states and we state identically adds nothing and is left out entirely — the same
// silence a catalog ref matching our number produces. A value Colnect does not state at all is not
// a proposal either: a page omitting a watermark says nothing about the stamp having none.

import {
  STAMP_ATTRIBUTE_FIELDS,
  STAMP_ATTRIBUTE_KINDS,
  type StampAttributeKind,
  type StampAttributeLabels,
} from "./stamp-attribute-kinds";

/** The issue format (#2443) — what Colnect calls a stamp's "Format". */
export const ISSUE_FORMAT_FIELD = "issueFormat";

/** Everything a Colnect page fills: the six attributes and the issue format. */
export type ColnectAttributeField = keyof StampAttributeLabels | typeof ISSUE_FORMAT_FIELD;

/** The dictionaries a Colnect word is mapped through: the four attribute kinds and the issue
 * format's. */
export type ColnectDictionaryKind = StampAttributeKind | typeof ISSUE_FORMAT_FIELD;

/** The fields in the order a proposal lists them: the six as a catalogue prints them
 * (`STAMP_ATTRIBUTE_FIELDS`), then the issue format. */
export const COLNECT_ATTRIBUTE_FIELDS: readonly { key: ColnectAttributeField; label: string }[] = [
  ...STAMP_ATTRIBUTE_FIELDS,
  { key: ISSUE_FORMAT_FIELD, label: "Issue format" },
];

/** What Colnect prints in "Format" for an ordinary stamp — no issue format here (#2443). */
export const COLNECT_ORDINARY_STAMP_FORMAT = "Stamp";

/** Whether a printed Colnect format is the ordinary stamp, compared as every word is. */
export function isColnectOrdinaryStamp(printed: string | null | undefined): boolean {
  return normalizeColnectAttribute(printed) === normalizeColnectAttribute(COLNECT_ORDINARY_STAMP_FORMAT);
}

/** The six and the issue format as a Colnect page prints them, each verbatim and each optional — a
 * page states what it states. Absent and blank are one thing: nothing to say. */
export type ColnectAttributes = Partial<Record<ColnectAttributeField, string | null>>;

/** One dictionary row as the comparison needs it: what it is called here, and what Colnect calls it
 * (null while nothing is mapped). */
export interface ColnectAttributeRow {
  id: string;
  name: string;
  colnectValue: string | null;
}

/** The five dictionaries of one collection: the four attribute kinds and the issue formats. */
export type ColnectAttributeDictionaries = Readonly<
  Record<ColnectDictionaryKind, readonly ColnectAttributeRow[]>
>;

/** What the stamp holds today — the two printed columns and the five references. */
export interface CurrentStampAttributes {
  denomination: string | null;
  perforation: string | null;
  colorId: string | null;
  watermarkId: string | null;
  paperId: string | null;
  printingId: string | null;
  /** The issue format (#2439); null is an ordinary stamp. */
  issueFormatId: string | null;
}

/**
 * What we decided about one attribute Colnect prints, for the stamp it was matched to:
 *   - `would-fill` / `filled` — we state nothing, so Colnect's value is the proposal (dry run) or
 *                               was written.
 *   - `conflict`              — both sides state a value and they differ. Never overwritten as part
 *                               of a match; the collector settles it deliberately.
 *   - `unmapped`              — Colnect states a dictionary value the collection's mapping does not
 *                               cover. Reported and nothing else: it blocks neither the other five
 *                               attributes nor anything else on the page.
 */
export type ColnectAttributeStatus = "would-fill" | "filled" | "conflict" | "unmapped";

export interface ColnectAttributeProposal {
  /** Which of the six, or the issue format. Also the key a write addresses — `color` writes
   * `colorId`, `issueFormat` writes `issueFormatId`. */
  field: ColnectAttributeField;
  /** How the attribute is named on screen, so the window need not carry the labels. */
  fieldLabel: string;
  status: ColnectAttributeStatus;
  /**
   * What would be stored: the printed text for denomination and perforation, the **dictionary row
   * id** for the other four and the issue format. Null on `unmapped`, which is the whole of what that status says.
   */
  value: string | null;
  /** {@link ColnectAttributeProposal.value} as it reads — the row's own name for a dictionary
   * attribute, so a proposal can be named without the dictionary in hand. */
  label: string;
  /** What the stamp carries today, or null when it states nothing. */
  currentLabel: string | null;
  /** What Colnect prints, verbatim — the value an overwrite would put in place of ours, and the
   * text a collector maps in Settings when it came back `unmapped`. */
  colnectLabel: string;
}

/** The field names a write addresses, per attribute. `color` is stored as `colorId`, the issue
 * format as `issueFormatId`. */
export function attributeWriteKey(field: ColnectAttributeField): string {
  return field === ISSUE_FORMAT_FIELD || (STAMP_ATTRIBUTE_KINDS as readonly string[]).includes(field)
    ? `${field}Id`
    : field;
}

/** Two printed values compared the way a vocabulary is: trimmed, whitespace collapsed and
 * case-insensitive, since `Thin paper` and `thin  paper` are one value written twice. Nothing else
 * is normalised — a value we cannot recognise as ours is a disagreement, not a near-miss to be
 * smoothed over. */
export function normalizeColnectAttribute(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The dictionary row a printed Colnect value maps to, or null when nothing does. */
export function mapColnectAttribute(
  rows: readonly ColnectAttributeRow[],
  printed: string
): ColnectAttributeRow | null {
  const key = normalizeColnectAttribute(printed);
  if (!key) return null;
  return rows.find((r) => normalizeColnectAttribute(r.colnectValue) === key) ?? null;
}

/**
 * The mapping a *Fill matching* press would propose for one dictionary row (#404's own button, in a
 * fourth form): **the row's own name**, and only where the collection does not already map that
 * text to another row.
 *
 * Deliberately an identity match rather than a fuzzy one: a dictionary built from catalogue terms
 * usually already reads exactly as Colnect prints them, and where it does not, a wrong colour
 * written onto a thousand stamps is far worse than a blank the collector fills in. The button only
 * ever proposes.
 */
export function guessColnectAttributeValue(
  rows: readonly ColnectAttributeRow[],
  row: ColnectAttributeRow
): string | null {
  if (row.colnectValue) return null;
  const key = normalizeColnectAttribute(row.name);
  if (!key) return null;
  const taken = rows.some(
    (r) => r.id !== row.id && normalizeColnectAttribute(r.colnectValue) === key
  );
  return taken ? null : row.name;
}

/**
 * Decide what a Colnect page's attributes mean for a stamp that already carries `current`.
 *
 * One proposal per attribute that has something to say, in the order a catalogue prints them
 * (`STAMP_ATTRIBUTE_FIELDS`, the order the stamp form and the detail card already use), the issue
 * format last. An attribute the page does not state, one the two sides agree on, and Colnect's
 * "Stamp" format (an ordinary stamp, #2443) produce nothing at all.
 */
export function proposeStampAttributes(
  colnect: ColnectAttributes | null | undefined,
  current: CurrentStampAttributes,
  dictionaries: ColnectAttributeDictionaries
): ColnectAttributeProposal[] {
  if (!colnect) return [];
  const proposals: ColnectAttributeProposal[] = [];

  for (const { key: field, label: fieldLabel } of COLNECT_ATTRIBUTE_FIELDS) {
    const printed = (colnect[field] ?? "").trim();
    if (!printed) continue;
    // An ordinary stamp is no issue format: nothing to fill, and no disagreement with one the
    // collector set — a stamp from a souvenir sheet is a "Stamp" on Colnect (#2443).
    if (field === ISSUE_FORMAT_FIELD && isColnectOrdinaryStamp(printed)) continue;

    // The two printed attributes: compared as text, because that is how both sides hold them.
    if (field === "denomination" || field === "perforation") {
      const mine = current[field];
      if (normalizeColnectAttribute(mine) === normalizeColnectAttribute(printed)) continue;
      proposals.push({
        field,
        fieldLabel,
        status: mine ? "conflict" : "would-fill",
        value: printed,
        label: printed,
        currentLabel: mine,
        colnectLabel: printed,
      });
      continue;
    }

    const kind = field as ColnectDictionaryKind;
    const rows = dictionaries[kind] ?? [];
    const mapped = mapColnectAttribute(rows, printed);
    const mineId = current[`${kind}Id` as const];
    const mine = mineId ? (rows.find((r) => r.id === mineId) ?? null) : null;
    if (!mapped) {
      // Reported and nothing more. It is not a conflict — we have no idea what Colnect's word means
      // here, so we cannot say it disagrees with ours — and it must block nothing else on the page.
      proposals.push({
        field,
        fieldLabel,
        status: "unmapped",
        value: null,
        label: printed,
        currentLabel: mine?.name ?? null,
        colnectLabel: printed,
      });
      continue;
    }
    if (mapped.id === mineId) continue;
    proposals.push({
      field,
      fieldLabel,
      status: mineId ? "conflict" : "would-fill",
      value: mapped.id,
      label: mapped.name,
      currentLabel: mine?.name ?? null,
      colnectLabel: printed,
    });
  }

  return proposals;
}

/** The `data` patch a set of proposals writes, for the statuses named in `statuses`. Shared by the
 * fill that rides with a match and the overwrite that settles a disagreement, so the two cannot
 * write one attribute differently. */
export function attributeWrites(
  proposals: readonly ColnectAttributeProposal[],
  statuses: readonly ColnectAttributeStatus[]
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const p of proposals) {
    if (!statuses.includes(p.status) || p.value === null) continue;
    data[attributeWriteKey(p.field)] = p.value;
  }
  return data;
}

/**
 * The attributes off a request body (#739) — the wire's own shape, validated once so the matcher,
 * the confirm and the overwrite cannot read one page's values three ways.
 *
 * **Not a hard shape**: anything that is not a non-blank string for one of the seven keys is simply
 * left out, and a body carrying none yields null. A value we cannot read is no attribute, and it
 * must never cost an item its match — the same rule the date's `issuedOn` follows.
 */
export function parseColnectAttributes(raw: unknown): ColnectAttributes | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const out: ColnectAttributes = {};
  let any = false;
  for (const { key } of COLNECT_ATTRIBUTE_FIELDS) {
    const value = source[key];
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.trim();
    any = true;
  }
  return any ? out : null;
}
