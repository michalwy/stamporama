import "server-only";
import { prisma } from "./db";
import {
  colnectExportedAtDate,
  readColnectList,
  type ColnectListCount,
  type ColnectListRow,
} from "./colnect-list-rules";

// **Loading a Colnect export into a snapshot** (#685) — the half of the loop that needs the
// database. The file itself is read by `colnect-list-rules.ts` (#645), which already answers
// everything this needs; what happens here is storing it against the right list.
//
// **The file names its own list, so this does not ask.** A Colnect export carries, per row, every
// list that row is on — a stamp offered for exchange is usually on a swap list *and* the collection
// — and the reader counts them and names the likeliest: the one the most rows carry, which in an
// export of one list is all of them. Matching that name against the configured lists resolves the
// target without a question, and a question is only asked where it matches none (a custom list, a
// renamed one, a file the collector edited down). That is why {@link previewColnectListFile} and
// {@link importColnectListSnapshot} are two calls: the screen shows what the file says and which
// list it will land in, and only sometimes has to ask.
//
// **The per-list columns are read for the chosen list, never for the row's first group.** `List` is
// `"Wish,Test Swap FROM"` and `Quantity` / `Condition` are `"[1],[2]"` / `"[MNH],[U]"`, positional:
// taking the first group of a row whose first list is not the one being imported would store the
// wrong count and the wrong grade, silently, for every row that happens to be on two lists.
//
// **A row with no `Link` is counted and dropped.** The id in that URL is the only join key both
// sides share (#247), so a row without one cannot be compared to anything — but it *was* in the
// file, and a snapshot that quietly held fewer rows than the export would make the report's counts
// a lie. It is reported instead.
//
// **The import replaces.** One snapshot per mapping (#684): a history of exports answers a question
// nothing asks, and an old snapshot beside a new one is a second answer to *what is on Colnect*.
// Replacing also clears every "done on Colnect" claim made against the old file, which is the
// point — a claim is worth exactly as long as the export it was made against, and a difference that
// comes back was not actually fixed. Standing *ignore* decisions hang off the mapping and survive.
//
// `declaredCount` is reported and never enforced, `colnect-list-rules.ts`'s rule holding here too: a
// file the collector opened in a spreadsheet is still a list, and refusing it over a header that no
// longer matches would refuse the wrong thing.

/** How many rows go in one `createMany`. A Wish export runs to 25,000 rows and a single statement
 *  carrying all of them is a multi-megabyte query; chunking keeps each one ordinary. */
const INSERT_CHUNK = 2_000;

/** Long enough for the whole of a 25,000-row list, since the delete and every chunk of the insert
 *  are one transaction — a half-replaced snapshot is a report about two different exports at once. */
const REPLACE_TIMEOUT_MS = 120_000;

/** Raised when the file cannot become a snapshot: it is not an export, or it names a list this
 *  collection does not sync. One sentence, because there are no rows to report row by row. */
export class ColnectListImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectListImportError";
  }
}

/** One list this collection could import into — a configured mapping, as the picker offers it. */
export interface ColnectListImportTarget {
  lt: number;
  label: string;
  /** Whether it already holds a snapshot, so the screen can say the import replaces one rather than
   *  loading the first. */
  hasSnapshot: boolean;
  /** When the snapshot it holds was exported from Colnect, ISO-8601, or null. */
  snapshotExportedAt: string | null;
}

/** What a file says, before anything is written. */
export interface ColnectListImportPreview {
  fileName: string;
  /** The list's own page on Colnect, off the preamble. */
  listUrl: string | null;
  /** Colnect's own stamp of when the file was made, verbatim as the preamble spells it. */
  exportedAt: string | null;
  /** What the preamble claims the list holds — reported, never enforced. */
  declaredCount: number | null;
  /** Rows the reader made sense of, whatever list they are on. */
  rowsRead: number;
  /** Every list the rows name, most rows first. */
  lists: ColnectListCount[];
  /** The list the file most likely is — the one the most rows carry. */
  suggestedList: string | null;
  /** The configured list `suggestedList` matches by name, or null where it matches none and the
   *  collector has to say. */
  resolvedLt: number | null;
  /** The lists this collection syncs, for the picker. */
  targets: ColnectListImportTarget[];
}

/** What one import did, in the terms the issue asks it to report: rows against the declared count,
 *  when the export was taken, and how many rows could not carry a join key. */
export interface ColnectListImportResult {
  lt: number;
  /** The list it landed in, as this collection names it. */
  label: string;
  /** The list *in the file* that was taken, as the file names it. */
  listName: string;
  fileName: string;
  exportedAt: string | null;
  declaredCount: number | null;
  /** Rows in the file, whatever list they are on. */
  rowsRead: number;
  /** Rows carrying the chosen list — the ones this import is about. A row in the file for another
   *  of the collector's lists is not one of them. */
  rowsOnList: number;
  /** Rows written: on the list and carrying a Colnect id. */
  rowsWritten: number;
  /** On the list, but carrying no usable `Link` — nothing to compare them by, so they are counted
   *  here rather than stored. */
  rowsWithoutId: number;
  /** Ids the file states more than once. Kept, both of them: the index is deliberately not unique
   *  (#684), the report sums them, and a hand-edited file repeating an item is worth saying. */
  duplicateIds: number;
  /** Whether this replaced a snapshot rather than being the first. */
  replaced: boolean;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The lists this collection actually syncs. A mapping row that exists but is switched off is not
 *  one: `enabled` is the collector saying *keep this list in step*, and importing into a list they
 *  have parked would put a snapshot behind a screen that does not list it. */
async function readTargets(collectionId: string): Promise<ColnectListImportTarget[]> {
  const rows = await prisma.colnectListMapping.findMany({
    where: { collectionId, enabled: true },
    orderBy: { lt: "asc" },
    select: {
      lt: true,
      label: true,
      snapshot: { select: { exportedAt: true } },
    },
  });
  return rows.map((row) => ({
    lt: row.lt,
    label: row.label,
    hasSnapshot: row.snapshot !== null,
    snapshotExportedAt: row.snapshot?.exportedAt?.toISOString() ?? null,
  }));
}

/** Whether two list names are the same list. Case and surrounding space only — Colnect writes the
 *  name into every row and the mapping's label is seeded from Colnect's own, so anything looser
 *  would be guessing between two lists the collector really does keep apart. */
function sameListName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Read a file and say what it is, without writing anything. Owner-authorized.
 *
 * The answer carries `resolvedLt` where the file's own list name matches a configured one, which is
 * the common case and the whole reason the screen usually has nothing to ask.
 */
export async function previewColnectListFile(
  ownerId: string,
  collectionId: string,
  fileName: string,
  text: string
): Promise<ColnectListImportPreview> {
  await assertCollectionOwner(ownerId, collectionId);

  const read = readColnectList(text);
  if (!read.ok) throw new ColnectListImportError(read.message);
  const file = read.file;

  const targets = await readTargets(collectionId);
  if (targets.length === 0) {
    throw new ColnectListImportError(
      "No Colnect list is set up for sync yet — switch one on under Settings → Colnect first."
    );
  }

  const suggested = file.suggestedList;
  const matches = suggested
    ? targets.filter((target) => sameListName(target.label, suggested))
    : [];

  return {
    fileName,
    listUrl: file.listUrl,
    exportedAt: file.exportedAt,
    declaredCount: file.declaredCount,
    rowsRead: file.rows.length,
    lists: file.lists,
    suggestedList: suggested,
    // Exactly one, or none. Two configured lists sharing a name is a collection that has been
    // edited into an ambiguity, and picking either would be picking at random.
    resolvedLt: matches.length === 1 ? matches[0].lt : null,
    targets,
  };
}

/** What one row says on the list being imported, or null where the row is in the file for another
 *  of the collector's lists. */
function entryFor(row: ColnectListRow, listName: string) {
  return row.entries.find((entry) => sameListName(entry.listName, listName)) ?? null;
}

/**
 * Load an export into the snapshot for one configured list, replacing whatever was there.
 * Owner-authorized.
 *
 * `lt` names the list to import into; `listName` names the list *in the file* to read the per-list
 * columns for, and defaults to the one the file suggests. They are two parameters because they are
 * two questions — a collector may well import the file's `"Test Swap FROM"` column into the list
 * they call Swap — and collapsing them would make the second unanswerable.
 */
export async function importColnectListSnapshot(
  ownerId: string,
  collectionId: string,
  input: { lt: number; fileName: string; text: string; listName?: string }
): Promise<ColnectListImportResult> {
  await assertCollectionOwner(ownerId, collectionId);

  const mapping = await prisma.colnectListMapping.findUnique({
    where: { collectionId_lt: { collectionId, lt: input.lt } },
    select: { id: true, label: true, enabled: true, snapshot: { select: { id: true } } },
  });
  if (!mapping || !mapping.enabled) {
    throw new ColnectListImportError("That Colnect list is not set up for sync.");
  }

  const read = readColnectList(input.text);
  if (!read.ok) throw new ColnectListImportError(read.message);
  const file = read.file;

  // The file's own suggestion, unless the collector said otherwise. `""` is a real answer — a file
  // naming no list at all is one unnamed list — so this falls back only on `undefined`.
  const listName = input.listName ?? file.suggestedList ?? "";

  const onList = file.rows.flatMap((row) => {
    const entry = entryFor(row, listName);
    return entry ? [{ row, entry }] : [];
  });

  const writable = onList.filter((pair) => pair.row.colnectId !== null);
  const seen = new Set<string>();
  let duplicateIds = 0;
  for (const pair of writable) {
    const id = pair.row.colnectId as string;
    if (seen.has(id)) duplicateIds += 1;
    else seen.add(id);
  }

  const rows = writable.map((pair) => ({
    colnectId: pair.row.colnectId as string,
    name: pair.row.name,
    country: pair.row.country,
    catalogCodes: pair.row.catalogRefs
      .map((ref) => `${ref.catalog}:${ref.number}`)
      .join(", "),
    quantity: pair.entry.quantity,
    conditionAbbrev: pair.entry.conditionAbbrev,
  }));

  const replaced = mapping.snapshot !== null;

  await prisma.$transaction(
    async (tx) => {
      // Cascades through the rows and through every "done on Colnect" claim made against them,
      // which is exactly what a re-import means: those claims were about the old file.
      await tx.colnectListSnapshot.deleteMany({ where: { mappingId: mapping.id } });
      const snapshot = await tx.colnectListSnapshot.create({
        data: {
          mappingId: mapping.id,
          fileName: input.fileName,
          exportedAt: colnectExportedAtDate(file.exportedAt),
          declaredCount: file.declaredCount,
        },
        select: { id: true },
      });
      for (let at = 0; at < rows.length; at += INSERT_CHUNK) {
        await tx.colnectListSnapshotRow.createMany({
          data: rows.slice(at, at + INSERT_CHUNK).map((row) => ({ ...row, snapshotId: snapshot.id })),
        });
      }
    },
    { timeout: REPLACE_TIMEOUT_MS }
  );

  return {
    lt: input.lt,
    label: mapping.label,
    listName,
    fileName: input.fileName,
    exportedAt: file.exportedAt,
    declaredCount: file.declaredCount,
    rowsRead: file.rows.length,
    rowsOnList: onList.length,
    rowsWritten: rows.length,
    rowsWithoutId: onList.length - writable.length,
    duplicateIds,
    replaced,
  };
}
