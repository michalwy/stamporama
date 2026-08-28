// Reading a **catalog CSV** and saying what importing it would do (#716) — pure, no Prisma and no
// `server-only`, so every judgement about a file can be asserted against its own bytes in
// `test:unit`.
//
// This is the shared answer of the CSV catalog import track: the preview draws it (#718) and the
// commit action executes it (#717). One classification, computed once, so the screen that promises
// and the writer that acts cannot disagree — the reason it is a module of its own rather than a
// query inside either of them.
//
// **What the file is.** A collector's own list of a country's issues, one row per issue: a year, a
// name, and the catalog numbers that issue covers. There is no header contract — the collector says
// which column is which in the dialog — so this reader detects the columns and takes a mapping,
// where the Colnect (#645) and Delcampe (#611) readers look their columns up by name. Those two read
// somebody else's export, whose column names are a published fact; this one reads a file the
// collector typed.
//
// **Three things the file deliberately does not carry**, each settled in the design discussion:
//
//   * **the area** — the whole import lands in one area chosen in the dialog, a file per country,
//     which keeps the format trivial and invents no area-matching scheme;
//   * **the vendor** — the numbers are the chosen area's primary numbering vendor's
//     (`CollectionArea.primaryCatalogVendorId`), so there is one numbering column and no vendor
//     question;
//   * **the prefix** — it resolves through the ordinary three-level walk (#675) for that area, which
//     is I/O and therefore the caller's to do; {@link CatalogImportContext.areaPrefix} is where the
//     answer arrives.
//
// **The numbers column is a spec, not a range**: exactly `parseCatalogNumberSpec`'s syntax (#452),
// the very field the create-issue dialog carries. One parser, not a second dialect — so
// `2895A-2897A, 2895B-2897B` means here what it means there, and the stamps this import creates are
// the stamps that dialog would have created.

import {
  catalogIdentityKey,
  parseCatalogNumberSpec,
  type CatalogNumberSpec,
} from "./catalog-number";
import { parseCsvRecords, type CsvRecord } from "./csv";

/**
 * Most stamps one **row** may create.
 *
 * `AUTO_CREATE_MAX_STAMPS` (50) does not apply here and that is deliberate: it exists because
 * positional matching across catalogs makes a long auto-generated run a poor idea *in a dialog*,
 * where every stamp is about to be typed over. A file is precisely the bulk path, and a definitives
 * series legitimately runs past fifty. What stays is a sanity ceiling — a row asking for hundreds of
 * stamps is a mis-mapped column, not a series.
 */
export const CATALOG_IMPORT_MAX_STAMPS_PER_ROW = 200;

/** The bounds `createIssueAction` validates a typed year against, applied to a file's years so the
 *  two doors into an issue agree about what a year is. */
const YEAR_MIN = 1840;
const YEAR_MAX = 2100;

// ── Reading the file ─────────────────────────────────────────────────────────

/** One column of the file, as the mapping step lists it. */
export interface CatalogImportColumn {
  /** Position in the row, 0-based — what a mapping names a column by. Two columns may carry the
   *  same header text, so the index is the identity and the name is only a label. */
  index: number;
  /** The header cell, trimmed. Empty where the file names the column nothing. */
  name: string;
  /** The first few values under it, so an unnamed column is still recognisable — and so a mapping
   *  can be checked by eye before anything is written. */
  samples: string[];
}

/** A file read into columns and data rows. */
export interface CatalogImportFile {
  /** The delimiter this file turned out to use — see {@link readCatalogImportFile}. Reported so a
   *  file that read as one column can be diagnosed without guessing. */
  separator: string;
  columns: CatalogImportColumn[];
  /** Everything under the header, each row keeping the line of the file it started on. */
  rows: CsvRecord[];
}

export type CatalogImportRead =
  | { ok: true; file: CatalogImportFile }
  | { ok: false; message: string };

/** How many values below a column the reader keeps to show beside its name. */
const SAMPLE_COUNT = 3;

/** The delimiters tried, in the order they win ties. A collector's spreadsheet writes whichever its
 *  locale prefers — a Polish Excel writes `;` — and the file is theirs, not a marketplace's, so
 *  there is no published answer to look up. */
const SEPARATORS = [",", ";", "\t"] as const;

/**
 * Read the file under whichever delimiter splits its **first record** into the most fields.
 *
 * A comma-separated file read with semicolons yields one field per row, and vice versa, so the
 * count separates them outright. Ties go to the comma, which is what a file called a CSV is until
 * something says otherwise.
 *
 * Judged on the first *record* rather than on the first *line* of the text, which is not always the
 * same line: `parseCsvRecords` drops blank ones, so a file that opens with an empty line — or with a
 * row of nothing but separators — would otherwise have its delimiter decided by a line that is not
 * the header. Parsing three times costs a pass over a file a collector typed.
 */
function readWithBestSeparator(text: string): { separator: string; records: CsvRecord[] } {
  let separator: string = SEPARATORS[0];
  let records: CsvRecord[] = [];
  let fields = 0;
  for (const candidate of SEPARATORS) {
    const parsed = parseCsvRecords(text, candidate);
    const width = parsed[0]?.fields.length ?? 0;
    if (width > fields) {
      separator = candidate;
      records = parsed;
      fields = width;
    }
  }
  return { separator, records };
}

/**
 * Read a CSV into the columns the mapping step offers and the rows the plan classifies.
 *
 * **The first record is the header.** Not a guess about its content — a file whose first row is
 * already data would lose that row — but the one rule that makes "the collector assigns the
 * columns" a question anybody can answer: a mapping is chosen by reading names, and detecting
 * whether a row *looks* like data would be a rule with no honest answer for a catalog whose first
 * issue is called `1918`.
 *
 * A file of nothing but a header reads fine, with no rows: that is what it says.
 */
export function readCatalogImportFile(text: string): CatalogImportRead {
  const { separator, records } = readWithBestSeparator(text);
  if (records.length === 0) return { ok: false, message: "That file is empty." };

  const header = records[0].fields;
  const rows = records.slice(1);
  const columns: CatalogImportColumn[] = header.map((cell, index) => {
    const samples: string[] = [];
    for (const row of rows) {
      if (samples.length >= SAMPLE_COUNT) break;
      const value = row.fields[index]?.trim();
      if (value) samples.push(value);
    }
    return { index, name: cell.trim(), samples };
  });

  return { ok: true, file: { separator, columns, rows } };
}

// ── The mapping and the collection it is classified against ──────────────────

/**
 * Which column carries what, by index.
 *
 * Only the spec is required. A file with no name column is an ordinary catalog listing — numbers and
 * years, the issues unnamed — and a file with no year column is one too; without numbers there is no
 * row at all. An unmapped column is `null` rather than an out-of-range index, so "the collector did
 * not answer" and "the collector pointed at column 4" are different states.
 */
export interface CatalogImportMapping {
  /** The catalog-number spec — `parseCatalogNumberSpec`'s syntax (#452). */
  spec: number;
  year: number | null;
  name: number | null;
}

/**
 * One catalog number already in the collection, under the import's vendor.
 *
 * The caller loads these — the coarse `(vendor, number in […])` filter
 * `findCatalogDuplicatesForCandidates` uses (#85), the numbers the file asks for — and resolves each
 * one's effective prefix the way that module does: the stamp's issue override first, then its own
 * area's walk (#377/#675). It is the *resolved* prefix that arrives here, because an identity is
 * what decides a match and this module may not do I/O to find one.
 */
export interface ExistingCatalogNumber {
  number: string;
  /** The prefix this number resolves under, which is half its catalog identity: `Mi·PL 200` and
   *  `Mi·SP 200` are different stamps and neither matches the other's row. */
  areaPrefix: string | null;
  /** The issue the number's stamp belongs to — its **first** membership, `duplicate-catalog.ts`'s
   *  own convention — or null for a stamp on no issue, which claims the number all the same. */
  issue: ExistingIssueRef | null;
}

/** As much of an existing issue as the classification needs: which it is, and which of its two
 *  fillable fields are empty. */
export interface ExistingIssueRef {
  id: string;
  name: string | null;
  year: number | null;
}

/** The collection side of the classification, all of it resolved by the caller. */
export interface CatalogImportContext {
  /** The chosen area's primary numbering vendor — every number in the file is filed under it. */
  catalogVendorId: string;
  /** That vendor's effective prefix for the chosen area (#675). The rows create issues that do not
   *  exist yet, so no issue override can apply to them; an existing number's own override is
   *  carried on its {@link ExistingCatalogNumber} instead. */
  areaPrefix: string | null;
  existingNumbers: readonly ExistingCatalogNumber[];
}

// ── What a row turns out to be ───────────────────────────────────────────────

/** What the mapped cells said, verbatim — the preview names a row by these, an error row included,
 *  since a row that failed to parse has nothing else to be named by. */
export interface CatalogImportSource {
  year: string;
  name: string;
  spec: string;
}

interface CatalogImportRowBase {
  /** The line of the file this row started on, 1-based — so a message names something the collector
   *  can find in the spreadsheet in front of them. */
  line: number;
  source: CatalogImportSource;
}

/** No number of this row's spec exists in the collection: the row creates its issue and every stamp
 *  the spec generates. */
export interface CatalogImportNewIssueRow extends CatalogImportRowBase {
  kind: "new-issue";
  name: string | null;
  year: number | null;
  numbers: string[];
  /** The series range the spec declares — derived, never typed, exactly as `createIssueAction`
   *  derives it (#452). */
  declared: CatalogNumberSpec["declared"];
}

/** The row's numbers overlap exactly one existing issue: the row fills that issue in rather than
 *  creating a second one. */
export interface CatalogImportFillRow extends CatalogImportRowBase {
  kind: "fill-existing";
  issue: ExistingIssueRef;
  /** Every number the spec generates. */
  numbers: string[];
  /** The ones the issue does not carry yet — what the write appends, and nothing else. */
  missingNumbers: string[];
  /** The name to write, or null: an issue that already has one keeps it. Empty fields are filled;
   *  filled ones are never overwritten. */
  fillName: string | null;
  /** The year to write, or null, on the same rule. */
  fillYear: number | null;
  /** Nothing to do — the issue already carries every number and neither field is empty. Kept as an
   *  answer rather than hidden: re-importing a file the collector has already imported should read
   *  as *this changed nothing*, not as a screen of blank rows. */
  noChange: boolean;
}

/** The row cannot be imported. Skipped at commit, never blocking the file. */
export interface CatalogImportErrorRow extends CatalogImportRowBase {
  kind: "error";
  /** One sentence, for the preview to print as it stands. */
  reason: string;
}

export type CatalogImportRow =
  | CatalogImportNewIssueRow
  | CatalogImportFillRow
  | CatalogImportErrorRow;

/** What the plan adds up to, for the preview's header and the commit's expectations. */
export interface CatalogImportSummary {
  newIssues: number;
  /** Rows filling an existing issue with something. */
  filled: number;
  /** Rows matching an existing issue that already holds everything they say. */
  noChange: number;
  errors: number;
  /** Stamps the whole plan would create, new issues and fills together. */
  stampsToCreate: number;
}

export interface CatalogImportPlan {
  rows: CatalogImportRow[];
  summary: CatalogImportSummary;
}

// ── Classification ───────────────────────────────────────────────────────────

/** How an issue is named in a refusal. A catalog issue often has no name, and the year is the next
 *  thing a collector would recognise it by. */
function issueLabel(issue: ExistingIssueRef): string {
  const name = issue.name?.trim();
  if (name) return name;
  return issue.year !== null ? `the ${issue.year} issue` : "an unnamed issue";
}

/** A mapped cell, trimmed. An unmapped column and a row too short to reach the mapped one both read
 *  as empty, which is the same thing: the file says nothing here. */
function cell(fields: readonly string[], index: number | null): string {
  if (index === null || index < 0) return "";
  return fields[index]?.trim() ?? "";
}

/** The year a row states: null where it states none, an error message where it states nonsense. */
function readYear(raw: string): { year: number | null } | { error: string } {
  if (!raw) return { year: null };
  const year = Number(raw);
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    return { error: `Year must be a valid year (${YEAR_MIN}–${YEAR_MAX}).` };
  }
  return { year };
}

/** Where a number is already spoken for: by an earlier row of this file, or by the collection. */
type Claim =
  | { by: "file"; line: number }
  | { by: "collection"; issue: ExistingIssueRef | null };

/**
 * Turn a file plus a mapping into a per-row import plan, classified against the collection.
 *
 * Rows are classified **in order and against each other**: a number an earlier row already claims is
 * taken, so two rows generating the same number do not both plan to create it, and the second is the
 * one refused. That is what makes the plan executable as written — the commit walks it top to bottom
 * and never has to re-decide anything.
 *
 * A row is judged in one pass and reports **one** reason, in the order the checks below run: the
 * spec first (without numbers there is no row to classify at all), then its size, then the year,
 * then who already holds its numbers.
 */
export function planCatalogImport(
  file: CatalogImportFile,
  mapping: CatalogImportMapping,
  context: CatalogImportContext
): CatalogImportPlan {
  const identity = (number: string) =>
    catalogIdentityKey(context.catalogVendorId, context.areaPrefix, number);

  /** Every identity the collection already holds, and what holds it. An existing number carries its
   *  own resolved prefix, so one under a different prefix is a different stamp and simply is not in
   *  here. */
  const claims = new Map<string, Claim>();
  for (const existing of context.existingNumbers) {
    const number = existing.number.trim();
    if (!number) continue;
    const key = catalogIdentityKey(context.catalogVendorId, existing.areaPrefix, number);
    // First writer wins: two stamps sharing an identity is #85's duplicate, and either of them
    // answers "this number is taken" the same way.
    if (!claims.has(key)) claims.set(key, { by: "collection", issue: existing.issue });
  }

  const rows: CatalogImportRow[] = [];
  for (const record of file.rows) {
    const source: CatalogImportSource = {
      year: cell(record.fields, mapping.year),
      name: cell(record.fields, mapping.name),
      spec: cell(record.fields, mapping.spec),
    };
    const base = { line: record.line, source };
    const fail = (reason: string): CatalogImportErrorRow => ({ ...base, kind: "error", reason });

    const spec = parseCatalogNumberSpec(source.spec);
    if ("error" in spec) {
      rows.push(fail(spec.error));
      continue;
    }
    if (spec.numbers.length > CATALOG_IMPORT_MAX_STAMPS_PER_ROW) {
      rows.push(
        fail(
          `A row may create at most ${CATALOG_IMPORT_MAX_STAMPS_PER_ROW} stamps; this one asks for ${spec.numbers.length}.`
        )
      );
      continue;
    }

    const year = readYear(source.year);
    if ("error" in year) {
      rows.push(fail(year.error));
      continue;
    }

    // Who already holds each of the row's numbers. A number claimed by an earlier row of the file
    // stops the row outright; the collection's claims are gathered and judged together, since one
    // issue holding some of them is the ordinary fill and two issues holding them is the refusal.
    let taken: string | null = null;
    const missingNumbers: string[] = [];
    const issues = new Map<string, ExistingIssueRef>();
    /** A number held by a stamp on no issue — nothing to fill, and creating it would duplicate. */
    let orphaned: string | null = null;
    for (const number of spec.numbers) {
      const claim = claims.get(identity(number));
      if (!claim) {
        missingNumbers.push(number);
        continue;
      }
      if (claim.by === "file") {
        taken = `${number} is already claimed by the row on line ${claim.line}.`;
        break;
      }
      if (!claim.issue) {
        orphaned ??= `${number} already belongs to a stamp that is on no issue.`;
        continue;
      }
      issues.set(claim.issue.id, claim.issue);
    }
    if (taken) {
      rows.push(fail(taken));
      continue;
    }
    if (orphaned) {
      rows.push(fail(orphaned));
      continue;
    }
    if (issues.size > 1) {
      const names = [...issues.values()].map(issueLabel).join(", ");
      rows.push(
        fail(
          `These numbers are spread across ${issues.size} existing issues (${names}); an import does not merge issues.`
        )
      );
      continue;
    }

    const name = source.name || null;
    const claimRow = () => {
      for (const number of spec.numbers) {
        const key = identity(number);
        if (!claims.has(key)) claims.set(key, { by: "file", line: record.line });
      }
    };

    const issue = [...issues.values()][0];
    if (!issue) {
      rows.push({
        ...base,
        kind: "new-issue",
        name,
        year: year.year,
        numbers: spec.numbers,
        declared: spec.declared,
      });
      claimRow();
      continue;
    }

    const fillName = !issue.name?.trim() && name ? name : null;
    const fillYear = issue.year === null ? year.year : null;
    rows.push({
      ...base,
      kind: "fill-existing",
      issue,
      numbers: spec.numbers,
      missingNumbers,
      fillName,
      fillYear,
      noChange: missingNumbers.length === 0 && fillName === null && fillYear === null,
    });
    claimRow();
  }

  return { rows, summary: summarize(rows) };
}

function summarize(rows: readonly CatalogImportRow[]): CatalogImportSummary {
  const summary: CatalogImportSummary = {
    newIssues: 0,
    filled: 0,
    noChange: 0,
    errors: 0,
    stampsToCreate: 0,
  };
  for (const row of rows) {
    if (row.kind === "new-issue") {
      summary.newIssues += 1;
      summary.stampsToCreate += row.numbers.length;
    } else if (row.kind === "fill-existing") {
      if (row.noChange) summary.noChange += 1;
      else summary.filled += 1;
      summary.stampsToCreate += row.missingNumbers.length;
    } else {
      summary.errors += 1;
    }
  }
  return summary;
}
