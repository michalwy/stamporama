// Reading a **Colnect list export** (#645) — pure, no Prisma and no `server-only`, so what a file
// says can be asserted against its own bytes in `test:unit`.
//
// A Colnect trade starts as two lists: the partner exports theirs (*what I want from you*) and the
// collector exports their own (*what I want from you*). Both come out of the same **Export list**
// button and are therefore the same file, which is why one reader serves both sides and the side is
// chosen when importing rather than detected here.
//
// **What the file actually is**, read off two real exports rather than guessed:
//
//   * five preamble lines and a blank one, the header on line 7, then the rows, then blank lines and
//     a `"END of Colnect list launched on …"` footer. The header is found by **name** and the footer
//     by its opening words, so a preamble that grows a line still reads;
//   * line 5 of the preamble carries the list's own URL — the link the trade wants beside the lines
//     the import writes ({@link ColnectListFile.listUrl});
//   * `"This list contains 85 Stamps"` states the count, kept as something the reader *reports* and
//     the caller may check. It is not enforced: a file the collector edited in a spreadsheet is
//     still a list, and refusing it over a stale header would be refusing the wrong thing.
//
// **Three columns carry everything the import needs**, out of thirty-nine:
//
//   * `Catalog Codes` — `"Mi:AR BL176, Sn:AR 2949, Gz :AR BL164"`, which is exactly the
//     `{ catalog, number }` shape `colnect-match.ts` already takes. Note `Gz :` — the space before
//     the colon is Colnect's, not a typo here;
//   * `Link` — `https://colnect.com/stamps/stamp/1153885`. **There is no id column**: the item id
//     lives in that URL and nowhere else in the file;
//   * `List`, `Quantity` and `Condition` — the **per-list** columns, and the reason this reader has
//     the shape it does. An item sits on as many of the collector's lists as they put it on, and the
//     three cells are **positional**: `List` is `"Wish,Test Swap FROM"`, `Quantity` is `"[1],[1]"`,
//     `Condition` is `"[MNH],[U]"`, and the second group of each belongs to the second name. So the
//     stamp is wanted mint on one list and used on the other, and taking either grade without
//     knowing which list is being imported would be promising a partner a grade at random.
//
// **Which list is therefore a question, not a fact.** An export is an export *of one list*, but the
// rows carry every list they are on, and in practice they carry several: what a collector offers for
// exchange is also on their swap lists, and what they want is also on their wish list. So the reader
// gathers the names ({@link ColnectListFile.lists}, counted) and names the likeliest — the one the
// most rows carry, which is the exported list itself — and the caller picks.
//
// What is deliberately **not** read: `Ord Mi` / `Ord Sn` / `Ord Yt` / `Ord Sg` are Colnect's internal
// sort keys and look enough like catalog numbers to be mistaken for them; `Parent Item` is another
// item's id, so matching on it would silently promise the wrong stamp. Everything else — themes,
// printers, perforation — describes a stamp the collection already knows or does not hold, and the
// import's job is to find it, not to learn it.

import { parseCsvRecords } from "./csv";

/** One catalog reference as the file prints it, in the matcher's own words. */
export interface ColnectListRef {
  /** Colnect's catalog abbreviation, e.g. `Mi`. Resolved to a local vendor by the caller (#248). */
  catalog: string;
  /** The number as printed, country prefix and all — `AR BL176`. */
  number: string;
}

/** What one row says **on one of the collector's lists**: how many, and in what grade.
 *
 *  A row carries one of these per list it is on, and the three per-list columns are read positionally
 *  to build them — see the module note. */
export interface ColnectListEntry {
  /** The list, as `List` names it. Empty where the file names none, which is one unnamed list rather
   *  than no list: the export is still an export of something. */
  listName: string;
  /** `Quantity` for this list, or null where the cell is blank — which the caller reads as one. */
  quantity: number | null;
  /** `Condition` for this list, in Colnect's own abbreviation (`MNH`), or null where blank. */
  conditionAbbrev: string | null;
  /** `Public Note` for this list. Carried so an imported line could keep it. */
  publicNote: string;
}

/** One row of the list, already read into the app's own words. */
export interface ColnectListRow {
  /** Which line of the file this was, 1-based and counting every line before it — so a gap names
   *  something the collector can find in a spreadsheet. */
  line: number;
  /** Colnect's own name for the stamp. Shown beside a gap; never matched on. */
  name: string;
  country: string;
  series: string;
  /** `Issued on`, verbatim (`1994-08-23`, or just `1982`). For telling two candidates apart by eye. */
  issuedOn: string;
  catalogRefs: ColnectListRef[];
  /** The item id out of `Link`, or null where the row carries no usable link. */
  colnectId: string | null;
  /** What this row says on each list it is on, in the file's own order. Never empty: a file naming
   *  no lists still produces one unnamed entry. */
  entries: ColnectListEntry[];
}

/** A whole file: what its preamble said, and its rows. */
export interface ColnectListFile {
  /** The list's page on Colnect, off the preamble — the link the trade keeps (#645). */
  listUrl: string | null;
  /** `List exported on 2026-08-22 10:06:42 GMT+0`, verbatim: a stamp of when, not a `Date`. Nothing
   *  in the app is scheduled off it, and parsing a zone spelling nobody has promised would be a
   *  guess in exchange for nothing. */
  exportedAt: string | null;
  /** What the preamble claims the list holds. Reported, never enforced — see the module note. */
  declaredCount: number | null;
  /** Every list the rows mention, with how many rows carry each — most first, so the head of it is
   *  the likeliest candidate for *the list this file is*. Colnect states the names per row and not in
   *  the preamble, so this is the only place they come from. */
  lists: ColnectListCount[];
  /** The list the file most likely **is**: the one the most rows carry. In an export of one list that
   *  is all of them, and the others are lists those stamps happen to also be on. Null only where the
   *  file names no list at all, in which case there is one unnamed list and nothing to choose. */
  suggestedList: string | null;
  rows: ColnectListRow[];
}

/** One list name and how many rows of the file carry it. */
export interface ColnectListCount {
  name: string;
  rows: number;
}

/** What reading a file produced: a list, or one sentence about why there is none. */
export type ColnectListRead =
  | { ok: true; file: ColnectListFile }
  | { ok: false; message: string };

/** The columns the reader looks for by name. Matching is case-insensitive and trims, because the
 *  file travels through a spreadsheet on the way here. */
const COLUMN = {
  name: "name",
  country: "country",
  series: "series",
  catalogCodes: "catalog codes",
  issuedOn: "issued on",
  link: "link",
  list: "list",
  quantity: "quantity",
  condition: "condition",
  publicNote: "public note",
} as const;

/** A row is a header when it names the stamp **and** offers at least one way to find it. Those two
 *  are also exactly what "this is not a Colnect list export" means. */
function isHeaderRow(row: readonly string[]): boolean {
  const cells = row.map((cell) => cell.trim().toLowerCase());
  if (!cells.includes(COLUMN.name)) return false;
  return cells.includes(COLUMN.catalogCodes) || cells.includes(COLUMN.link);
}

/** Colnect's parting line. Everything from it down is not a row. */
function isFooterRow(row: readonly string[]): boolean {
  return row[0]?.trim().toLowerCase().startsWith("end of colnect list") === true;
}

/**
 * Split `Catalog Codes` into the pairs the matcher takes.
 *
 * `"Mi:AR BL176, Sn:AR 2949, Gz :AR BL164"` → three refs. The separator is a comma and the split
 * inside each token is its **first** colon: a number may hold dots and hyphens
 * (`Col:NR 1954.02.06-01`) but never a colon, while an abbreviation may end in a space (`Gz :`).
 * A token with no colon is dropped rather than guessed at — half a reference matches nothing, and
 * inventing a vendor for it would match the wrong thing.
 */
export function parseColnectCatalogCodes(raw: string | null | undefined): ColnectListRef[] {
  const cell = raw?.trim();
  if (!cell) return [];
  const refs: ColnectListRef[] = [];
  for (const token of cell.split(",")) {
    const at = token.indexOf(":");
    if (at < 0) continue;
    const catalog = token.slice(0, at).trim();
    const number = token.slice(at + 1).trim();
    if (!catalog || !number) continue;
    refs.push({ catalog, number });
  }
  return refs;
}

/**
 * Read one of the bracketed per-list cells — `"[1]"`, `"[MNH],[U]"`, `"[2],[]"`.
 *
 * **Every group is kept, empties included**, because the groups are *positional*: the nth belongs to
 * the nth name in `List`, and dropping a blank one would shift every grade after it onto the wrong
 * list. A blank comes back as an empty string, which is the caller's *this list says nothing*.
 *
 * A cell with no brackets at all is read as one value, so a file opened and re-saved by a
 * spreadsheet that ate them still reads.
 */
export function parseColnectBracketCells(raw: string | null | undefined): string[] {
  const cell = raw?.trim();
  if (!cell) return [];
  const groups = [...cell.matchAll(/\[([^\]]*)\]/g)].map((match) => match[1].trim());
  if (groups.length === 0) return [cell];
  return groups;
}

/**
 * Split the `List` cell into names — `"Wish,Test Swap FROM"` → two.
 *
 * A comma, because that is what Colnect writes, and a list whose own name holds one is a name this
 * cannot recover: the file gives no other separator and no quoting inside the cell. Blank names are
 * dropped, since a name is what the caller picks by.
 */
export function parseColnectListNames(raw: string | null | undefined): string[] {
  const cell = raw?.trim();
  if (!cell) return [];
  return cell
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** `"This list contains 85 Stamps"` → 85. Null when the preamble says nothing of the kind. */
function readDeclaredCount(cells: readonly string[]): number | null {
  for (const cell of cells) {
    const found = /this list contains\s+([\d\s]+)\s+/i.exec(cell);
    if (!found) continue;
    const value = Number(found[1].replace(/\s/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** The list's page, off `"For the updated list on Colnect visit: ", https://…/list/…`. */
function readListUrl(cells: readonly string[]): string | null {
  for (const cell of cells) {
    const value = cell.trim();
    if (/^https?:\/\/[^\s]*colnect\.com\/.*\/list\//i.test(value)) return value;
  }
  return null;
}

/** `"List exported on 2026-08-22 10:06:42 GMT+0"` → the part after *on*, verbatim. */
function readExportedAt(cells: readonly string[]): string | null {
  for (const cell of cells) {
    const found = /list exported on\s+(.+)$/i.exec(cell.trim());
    if (found) return found[1].trim();
  }
  return null;
}

/** One quantity cell's group as a number, or null — blank, nonsense, and zero or less are all *the
 *  cell says nothing*, which the caller reads as one. */
function readQuantity(value: string | undefined): number | null {
  const parsed = Number((value ?? "").replace(/\s/g, ""));
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.trunc(parsed);
}

/**
 * The row's per-list cells, zipped by position.
 *
 * `List` gives the names; `Quantity`, `Condition` and `Public Note` give one bracket group each, in
 * the same order. A file naming **no** list still produces one entry, unnamed: the export is an
 * export of something, and a row with a grade and no list name is that grade on that something.
 */
function readEntries(input: {
  list: string;
  quantity: string;
  condition: string;
  publicNote: string;
}): ColnectListEntry[] {
  const names = parseColnectListNames(input.list);
  const quantities = parseColnectBracketCells(input.quantity);
  const grades = parseColnectBracketCells(input.condition);
  const notes = parseColnectBracketCells(input.publicNote);
  const count = Math.max(names.length, 1);

  const entries: ColnectListEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      listName: names[i] ?? "",
      quantity: readQuantity(quantities[i]),
      conditionAbbrev: (grades[i] ?? "").trim() || null,
      publicNote: (notes[i] ?? "").trim(),
    });
  }
  return entries;
}

/**
 * Read a whole export.
 *
 * Rows are read by column **name**, so an export that gains a column, loses one this never reads, or
 * reorders them still reads — the Delcampe reader's rule (#611), and for the same reason: Colnect's
 * export has changed before and will again.
 */
export function readColnectList(text: string): ColnectListRead {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { ok: false, message: "That file is empty." };

  const headerAt = records.findIndex((record) => isHeaderRow(record.fields));
  if (headerAt < 0) {
    return {
      ok: false,
      message:
        "That does not look like a Colnect list export — no header row naming Name and Catalog Codes.",
    };
  }

  const preamble = records.slice(0, headerAt).flatMap((record) => record.fields);
  const header = records[headerAt].fields.map((cell) => cell.trim().toLowerCase());
  const columnAt = (label: string) => header.indexOf(label);
  const at = {
    name: columnAt(COLUMN.name),
    country: columnAt(COLUMN.country),
    series: columnAt(COLUMN.series),
    catalogCodes: columnAt(COLUMN.catalogCodes),
    issuedOn: columnAt(COLUMN.issuedOn),
    link: columnAt(COLUMN.link),
    list: columnAt(COLUMN.list),
    quantity: columnAt(COLUMN.quantity),
    condition: columnAt(COLUMN.condition),
    publicNote: columnAt(COLUMN.publicNote),
  };

  const out: ColnectListRow[] = [];
  /** How many rows carry each list — what names the likeliest list below. */
  const rowsPerList = new Map<string, number>();
  for (let i = headerAt + 1; i < records.length; i += 1) {
    const row = records[i].fields;
    if (isFooterRow(row)) break;
    const cell = (index: number) => (index >= 0 ? (row[index]?.trim() ?? "") : "");

    const catalogRefs = parseColnectCatalogCodes(cell(at.catalogCodes));
    const colnectId = colnectIdFromRow(cell(at.link));
    // A row that names neither a catalog number nor an item is not a stamp — it is a spreadsheet's
    // leftover. Dropping it silently is right: it says nothing to report a gap about.
    if (catalogRefs.length === 0 && !colnectId) continue;

    const entries = readEntries({
      list: cell(at.list),
      quantity: cell(at.quantity),
      condition: cell(at.condition),
      publicNote: cell(at.publicNote),
    });
    for (const entry of entries) {
      rowsPerList.set(entry.listName, (rowsPerList.get(entry.listName) ?? 0) + 1);
    }

    out.push({
      line: records[i].line,
      name: cell(at.name),
      country: cell(at.country),
      series: cell(at.series),
      issuedOn: cell(at.issuedOn),
      catalogRefs,
      colnectId,
      entries,
    });
  }

  // Most rows first, and by name where two are level — the head of this is what the caller offers as
  // *the list this file is*, and an order that shuffled between two readings of one file would make
  // that offer arbitrary.
  const lists = [...rowsPerList.entries()]
    .map(([name, rows]) => ({ name, rows }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));

  return {
    ok: true,
    file: {
      listUrl: readListUrl(preamble),
      exportedAt: readExportedAt(preamble),
      declaredCount: readDeclaredCount(preamble),
      lists,
      suggestedList: lists[0]?.name || null,
      rows: out,
    },
  };
}

/** The item id out of a `Link` cell. Kept beside the reader rather than in `colnect-link.ts`'s
 *  formatters: that module writes URLs the app owns, this reads one somebody else wrote. */
function colnectIdFromRow(raw: string): string | null {
  return colnectIdFromStampUrl(raw);
}

/**
 * The Colnect item id out of a stamp URL, or null.
 *
 * `https://colnect.com/stamps/stamp/1153885` and the slugged form
 * `https://colnect.com/en/stamps/stamp/1153885-X-Poland` both give `1153885` — the same shape
 * `colnectStampUrl` writes, read backwards.
 */
export function colnectIdFromStampUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim();
  if (!url) return null;
  const found = /colnect\.com\/(?:[a-z-]+\/)?stamps?\/stamp\/(\d+)/i.exec(url);
  return found ? found[1] : null;
}
