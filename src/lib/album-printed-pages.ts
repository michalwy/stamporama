import "server-only";
import { prisma } from "./db";
import { parseAlbumSnapshot, type AlbumPageSnapshot } from "./album-snapshot";

// Printed album sheets (#778) — the **read** half.
//
// Deliberately separate from `album-printing.ts`, which marks sheets printed, un-prints them, opens
// continuations and builds the divergence report. The planner (`album-plan.ts`) has to ask *is this
// block already on paper* on every read, and the writer has to ask the planner what a sheet would
// look like. Putting both in one module would put `album-plan.ts` and its writer in a cycle — which
// passes every test and then throws at module initialisation in the real app, because a cycle
// between two `src/lib` modules is only a problem once something imports them in the other order.
//
// So: this file knows nothing about plans. It reads rows.
//
// ## What is stored, and what is derived from it
//
// `album_printed_page.snapshot` is the sheet — everything that went onto the paper, immutable from
// the moment the collector said so (`album-snapshot.ts` says why it is a stored result rather than a
// `frozen` flag). It is a result: read whole by a renderer, never filtered on.
//
// `album_printed_page_stamp` is the index over it, written from the same snapshot in the same
// transaction. It exists so {@link getAlbumPrintedIndex} can answer the planner's question without
// loading a few hundred pages of geometry to look at a list of ids.

/** A printed sheet, without its snapshot — what a listing and the planner need. */
export interface AlbumPrintedPageRow {
  id: string;
  range: string;
  printedAt: Date;
  /** Set once the collector has answered a divergence with a **reprint**: the sheet's content is
   *  back in the live plan and this row survives only to say that a card matching it is still in the
   *  binder, until a new sheet is marked printed in its turn. */
  reprintingAt: Date | null;
}

/** What one album entry has on paper. */
export interface AlbumPrintedEntry {
  /** The sheets the entry's block runs across, in printing order — index `n` carries `part` `n + 1`.
   *  Ordinarily one. */
  printedPageIds: string[];
  /** Every stamp of the entry that is on one of those sheets. A stamp that has joined the checklist
   *  since is **not** in here, and that is the whole of what a continuation page answers. */
  stampIds: Set<string>;
}

/** The index the planner reads. */
export interface AlbumPrintedIndex {
  /** Every printed sheet of the album, newest last, by id. */
  pages: Map<string, AlbumPrintedPageRow>;
  /** Only entries with something on paper, and only sheets that are not being reprinted. */
  byEntry: Map<string, AlbumPrintedEntry>;
  /** Which sheet each of the collector's own text blocks (#769) is on, for sheets that are not being
   *  reprinted. Read here rather than off `AlbumTextBlock.printedPageId` for exactly the reason
   *  `byEntry` is: a reprint returns a card's content to the live plan, and one module deciding what
   *  *on paper* means is what keeps the note and the checklist beside it from being answered two
   *  different ways. */
  byTextBlock: Map<string, string>;
  /** Printed sheets no live entry names any more, so nothing in the plan can file them. A card in a
   *  binder whose stamps have all left the album is not a row to sweep — it is a divergence, and the
   *  report is where it is said. */
  orphanedPageIds: string[];
}

/**
 * Which stamps of an album are on which sheet.
 *
 * A sheet being **reprinted** is excluded from `byEntry` on purpose: choosing a reprint returns the
 * card's content to the live plan and re-plans it in full, and the row survives only so the album can
 * say a superseded card is still in the binder. It is not excluded from `pages`, which is what makes
 * that possible.
 */
export async function getAlbumPrintedIndex(albumId: string): Promise<AlbumPrintedIndex> {
  const rows = await prisma.albumPrintedPage.findMany({
    where: { albumId },
    orderBy: [{ printedAt: "asc" }, { id: "asc" }],
    select: { id: true, range: true, printedAt: true, reprintingAt: true },
  });
  const pages = new Map(rows.map((r) => [r.id, r]));

  const [stamps, notes] = await Promise.all([
    prisma.albumPrintedPageStamp.findMany({
      where: { printedPage: { albumId, reprintingAt: null } },
      orderBy: [{ part: "asc" }, { sortOrder: "asc" }],
      select: { albumPrintedPageId: true, stampId: true, albumEntryId: true, part: true },
    }),
    prisma.albumTextBlock.findMany({
      where: { albumId, printedPage: { reprintingAt: null } },
      select: { id: true, printedPageId: true },
    }),
  ]);

  const byEntry = new Map<string, AlbumPrintedEntry>();
  // `part` orders the sheets of one split block; a first-seen order would be the database's, and two
  // reads of one album must not put a checklist's cards in different orders.
  const parts = new Map<string, Map<number, string>>();
  const claimed = new Set<string>();
  for (const row of stamps) {
    let held = byEntry.get(row.albumEntryId);
    if (!held) {
      held = { printedPageIds: [], stampIds: new Set() };
      byEntry.set(row.albumEntryId, held);
      parts.set(row.albumEntryId, new Map());
    }
    held.stampIds.add(row.stampId);
    parts.get(row.albumEntryId)!.set(row.part, row.albumPrintedPageId);
    claimed.add(row.albumPrintedPageId);
  }
  for (const [entryId, held] of byEntry) {
    held.printedPageIds = [...parts.get(entryId)!.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => id);
  }

  const byTextBlock = new Map<string, string>();
  for (const note of notes) {
    if (!note.printedPageId) continue;
    byTextBlock.set(note.id, note.printedPageId);
    // A sheet carrying nothing but one of the collector's notes has no stamp rows at all, so it
    // would otherwise read as **orphaned** — a card whose stamps have all left the album — and be
    // reported as a divergence that no acquisition caused and nothing can answer.
    claimed.add(note.printedPageId);
  }

  return {
    pages,
    byEntry,
    byTextBlock,
    orphanedPageIds: rows
      .filter((r) => !r.reprintingAt && !claimed.has(r.id))
      .map((r) => r.id),
  };
}

/**
 * Read the sheets themselves.
 *
 * Scoped by album as well as by id, so an id from somewhere else cannot pull a sheet out of another
 * binder — the same shape every other read in this codebase takes with an id it did not resolve.
 */
export async function getAlbumPageSnapshots(
  albumId: string,
  ids: readonly string[]
): Promise<Map<string, AlbumPageSnapshot>> {
  const out = new Map<string, AlbumPageSnapshot>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return out;
  const rows = await prisma.albumPrintedPage.findMany({
    where: { albumId, id: { in: wanted } },
    select: { id: true, snapshot: true },
  });
  for (const row of rows) out.set(row.id, parseAlbumSnapshot(row.snapshot));
  return out;
}
