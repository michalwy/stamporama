import "server-only";
import { prisma } from "./db";
import { Prisma } from "@/generated/prisma/client";
import {
  albumNoteBlock,
  albumPlanContext,
  albumComparablePage,
  albumPlanPrint,
  planAlbum,
  type AlbumBoxData,
  type AlbumPlanContext,
  type AlbumPlanPage,
} from "./album-plan";
import { planAlbumPages, type AlbumBlockSpec, type AlbumPlacedBox } from "./album-layout";
import { albumTextMetrics } from "./album-metrics";
import { albumPlanFingerprint } from "./album-print-rules";
import { albumRenderPreset } from "./album-template-rules";
import { languageLabel } from "./languages";
import { getAlbumPageSnapshots, type AlbumPrintedPageRow } from "./album-printed-pages";
import { resolveAlbumPhotos } from "./album-photos";
import {
  ALBUM_SNAPSHOT_VERSION,
  snapshotBlocks,
  snapshotStampRows,
  type AlbumPageSnapshot,
  type AlbumSnapshotBox,
} from "./album-snapshot";
import {
  diffAlbumPlans,
  type AlbumComparablePage,
  type AlbumDivergence,
} from "./album-divergence";
import type { AlbumEntryData } from "./albums";

// What the collector does about paper (#778): marking sheets printed, un-printing them, answering a
// divergence with a continuation page or a reprint, and the report that says which cards need any of
// it.
//
// Separate from `album-printed-pages.ts`, which only reads, because this module imports
// `album-plan.ts` and the planner imports the reader. One module for both would be a cycle between
// two `src/lib` modules — the kind that passes every test and then throws at module initialisation
// in the real app.
//
// ## Marking a sheet printed is a deliberate act
//
// Generating a PDF marks nothing. A draft is generated to be looked at, and an album that froze
// itself on the first preview would be a trap. The collector says *these sheets went onto paper*,
// as its own gesture, and the snapshot is taken at that moment.
//
// ## Divergence is reported, never resolved
//
// Everything below produces lists and waits. A card can be out of date for a good reason and stay
// that way for years, and where the collector does want to act there are two answers and they pick
// each time — **a continuation page** carrying the new stamps with a range of its own, filed after
// the sheet it continues, or **a reprint** of the whole card.
//
// ## What the report is compared against
//
// A printed sheet has no live counterpart: the plan steps over it. So the reference is built **per
// printed card** — the maximal group of sheets joined by a block that spans them, which is one sheet
// in the ordinary case — by re-planning that card's own entries on fresh paper.
//
// That is not a shortcut around re-planning the whole album as if nothing were printed. It is what
// the planner actually does: a printed sheet is a page boundary and the plan resumes on **fresh
// paper** after it, so a card's own content never re-flows across its edge. The whole-album shadow
// plan would instead cascade — one stamp joining an early checklist re-flows every later sheet and
// reports a dozen cards as changed — which is the "drowned by ordinary collecting" failure this
// report exists to prevent, arriving by a different door, and which contradicts the dividend the
// range-as-identity decision was made for: an insertion disturbs the one card it lands on.
//
// The reference deliberately **excludes** two kinds of stamp. Stamps of the same entry that are on
// some *other* printed sheet — otherwise the moment a continuation page is printed the original card
// would report its own continuation as missing, for ever. And stamps waiting on a continuation the
// collector has already opened — that divergence has been answered, and saying it again every time
// the screen is opened is how a report stops being read.

/** Thrown for a printing gesture that cannot be carried out. The message reaches the collector. */
export class AlbumPrintError extends Error {}

// -- Marking printed ---------------------------------------------------------

/** What one card would be, before it exists: which sheets, and what they will be called. */
export interface AlbumMarkPrintedResult {
  ranges: string[];
}

/**
 * Mark sheets printed, storing a complete snapshot of each.
 *
 * `sheets` are one-based positions in the listing the collector is reading, exactly as `?sheets=` is
 * for the PDF — but this is a **write**, so it carries the fingerprint of the plan those positions
 * were read from and a plan that has moved since is refused rather than frozen at the wrong places.
 * That is what keeps a position a position. (Reprinting a card takes the card's own identity
 * instead, and never a position; see {@link reprintAlbumPage}.)
 */
export async function markAlbumPagesPrinted(
  ownerId: string,
  albumId: string,
  sheets: readonly number[],
  fingerprint: string
): Promise<AlbumMarkPrintedResult> {
  const plan = await planAlbum(ownerId, albumId);
  if (!plan) throw new AlbumPrintError("Album not found.");

  if (albumPlanFingerprint(albumPlanPrint(plan.pages)) !== fingerprint) {
    throw new AlbumPrintError(
      "This album's sheets have changed since this list was drawn. Reload the album and choose again — " +
        "a sheet number means something only against the plan it was read from."
    );
  }

  const chosen = [...new Set(sheets)].sort((a, b) => a - b);
  if (chosen.length === 0) throw new AlbumPrintError("No sheets were chosen.");
  for (const n of chosen) {
    if (n < 1 || n > plan.pages.length) {
      throw new AlbumPrintError(`This album has sheets 1 to ${plan.pages.length}; ${n} is outside that.`);
    }
    if (plan.pages[n - 1].layout.kind !== "live") {
      throw new AlbumPrintError(`Sheet ${n} is already printed.`);
    }
  }
  const chosenSet = new Set(chosen.map((n) => n - 1));

  // A checklist too tall for a page runs across two or three sheets, and **all of them go onto paper
  // together or none does**: the seam names a block's sheets as one list, and half a checklist on
  // paper with the other half still in the live plan is not a state anything could draw.
  const sheetsOfEntry = new Map<string, number[]>();
  plan.pages.forEach((page, i) => {
    if (page.layout.kind !== "live") return;
    for (const block of page.layout.blocks) {
      const held = sheetsOfEntry.get(block.entryId) ?? [];
      if (!held.includes(i)) held.push(i);
      sheetsOfEntry.set(block.entryId, held);
    }
  });
  const entryName = new Map(plan.entries.map((e) => [e.id, e.checklistName]));
  for (const [entryId, indices] of sheetsOfEntry) {
    if (indices.length < 2) continue;
    if (!indices.some((i) => chosenSet.has(i))) continue;
    const missing = indices.filter((i) => !chosenSet.has(i));
    if (missing.length === 0) continue;
    // Names the sheets that are **missing**, not just the run. The refusal is not a normalisation
    // waiting to happen — the album cannot hold half a checklist on paper — so it has to hand back
    // something the collector can act on in one move.
    throw new AlbumPrintError(
      `"${entryName.get(entryId) ?? "One checklist"}" runs across sheets ` +
        `${indices.map((i) => i + 1).join(", ")}, and ` +
        `${missing.length === 1 ? `sheet ${missing[0] + 1} is` : `sheets ${missing.map((i) => i + 1).join(", ")} are`} ` +
        `not in this selection. Mark them together or not at all — half a checklist on paper and ` +
        `half in the plan is not a state the album can hold.`
    );
  }

  const pages = chosen.map((n) => plan.pages[n - 1]);
  const stampIds = pages.flatMap((page) =>
    page.layout.kind === "live" ? page.layout.boxes.map((b) => b.box.stampId) : []
  );
  const photos = await resolveAlbumPhotos(plan.album.collectionId, stampIds);

  // How many sheets of each entry are already on paper. A continuation page is the next **part** of
  // its checklist, not a second part one: without this offset the index would hold two rows saying
  // "part 1" for one entry and one of the two cards would be lost from the run.
  const partBase = new Map<string, number>();
  for (const [entryId, held] of plan.printed.byEntry) {
    partBase.set(entryId, held.printedPageIds.length);
  }

  const preset = albumRenderPreset(plan.album);
  const writes = pages.map((page) => {
    const snapshot = buildAlbumPageSnapshot(page, {
      albumName: plan.album.name,
      language: plan.album.language,
      preset,
      photoIdFor: (stampId) => photos.get(stampId)?.id ?? null,
    });
    const rows = snapshotStampRows(snapshot).map((row) => ({
      ...row,
      part: (partBase.get(row.albumEntryId) ?? 0) + row.part,
    }));
    // The collector's own notes (#769) that went onto this sheet. They carry no stamps, so the index
    // over the snapshot cannot see them and they name their sheet on their own row instead — the
    // same seam `AlbumEntry.continuesPrintedPageId` is. Without it the plan would emit the note again
    // on live paper beside the card that already prints it, which is ADR-0047 §4's family exactly.
    const noteIds = snapshot.page.blocks
      .filter((b) => b.kind === "text")
      .map((b) => b.entryId);
    return { snapshot, rows, noteIds };
  });

  const continuationsAnswered = plan.entries
    .filter(
      (e) =>
        e.continuesPrintedPageId &&
        writes.some((w) => w.rows.some((r) => r.albumEntryId === e.id))
    )
    .map((e) => e.id);

  await prisma.$transaction(async (tx) => {
    for (const write of writes) {
      const created = await tx.albumPrintedPage.create({
        data: {
          albumId,
          range: write.snapshot.range,
          snapshot: write.snapshot as unknown as Prisma.InputJsonValue,
          stamps: { createMany: { data: write.rows } },
        },
        select: { id: true },
      });
      if (write.noteIds.length > 0) {
        await tx.albumTextBlock.updateMany({
          where: { albumId, id: { in: write.noteIds } },
          data: { printedPageId: created.id },
        });
      }
    }
    // The choice is per divergence, not a setting: a continuation that has itself gone onto paper is
    // answered, and the next stamp to arrive asks again.
    if (continuationsAnswered.length > 0) {
      await tx.albumEntry.updateMany({
        where: { id: { in: continuationsAnswered } },
        data: { continuesPrintedPageId: null },
      });
    }
    await discardCoveredReprints(tx, albumId);
  });

  return { ranges: writes.map((w) => w.snapshot.range) };
}

/**
 * Drop the sheets whose reprint has now happened.
 *
 * *The snapshot is replaced only when the new sheet is marked printed in its turn* (#778) — so a
 * sheet awaiting reprint is discarded exactly when every stamp it holds is on a card that is not
 * itself awaiting one. A reprint that came out as two cards, or that has only been half done, leaves
 * the row standing and the album goes on saying a superseded card is in the binder.
 */
async function discardCoveredReprints(tx: Prisma.TransactionClient, albumId: string): Promise<void> {
  const waiting = await tx.albumPrintedPage.findMany({
    where: { albumId, reprintingAt: { not: null } },
    select: { id: true, stamps: { select: { stampId: true } } },
  });
  if (waiting.length === 0) return;
  const live = await tx.albumPrintedPageStamp.findMany({
    where: { printedPage: { albumId, reprintingAt: null } },
    select: { stampId: true },
  });
  const covered = new Set(live.map((r) => r.stampId));
  const done = waiting
    .filter((page) => page.stamps.length > 0 && page.stamps.every((s) => covered.has(s.stampId)))
    .map((page) => page.id);
  if (done.length > 0) await tx.albumPrintedPage.deleteMany({ where: { id: { in: done } } });
}

/** Build the stored result for one live sheet. */
function buildAlbumPageSnapshot(
  page: AlbumPlanPage,
  ctx: {
    albumName: string;
    language: string;
    preset: AlbumPageSnapshot["preset"];
    photoIdFor: (stampId: string) => string | null;
  }
): AlbumPageSnapshot {
  if (page.layout.kind !== "live") {
    throw new AlbumPrintError("That sheet is already printed.");
  }
  const layout = page.layout;
  const boxes: AlbumPlacedBox<AlbumSnapshotBox>[] = layout.boxes.map((placed) =>
    snapshotPlacedBox(placed, ctx.photoIdFor(placed.box.stampId))
  );
  return {
    version: ALBUM_SNAPSHOT_VERSION,
    albumName: ctx.albumName,
    language: ctx.language,
    preset: ctx.preset,
    range: page.range,
    chapterKey: layout.chapterKey,
    page: { ...layout, boxes },
    footer: page.footer,
  };
}

function snapshotPlacedBox(
  placed: AlbumPlacedBox<AlbumBoxData>,
  photoId: string | null
): AlbumPlacedBox<AlbumSnapshotBox> {
  const box = placed.box;
  return {
    ...placed,
    box: {
      widthMm: box.widthMm,
      heightMm: box.heightMm,
      label: box.label,
      stampId: box.stampId,
      // The strip is **copied**, not referenced. The hawid stock is the one thing about an album
      // that is read live (#765) — a drawer changes — and the box on the card is the height it was
      // cut to whatever the drawer holds now.
      strip: box.strip
        ? {
            id: box.strip.id,
            heightMm: box.strip.heightMm,
            lengthMm: box.strip.stockLengthMm,
            label: box.strip.label,
          }
        : null,
      sizeSource: box.sizeSource,
      sizeFromStampId: box.sizeFromStampId,
      catalogNumber: box.catalogNumber,
      catalogSortKey: box.catalogSortKey,
      photoId,
    },
  };
}

// -- Un-printing, reprinting, continuing -------------------------------------

async function requirePrintedPage(
  ownerId: string,
  printedPageId: string
): Promise<{ albumId: string; row: AlbumPrintedPageRow }> {
  const row = await prisma.albumPrintedPage.findUnique({
    where: { id: printedPageId },
    select: {
      id: true,
      range: true,
      printedAt: true,
      reprintingAt: true,
      albumId: true,
      album: { select: { collection: { select: { ownerId: true } } } },
    },
  });
  if (!row || row.album.collection.ownerId !== ownerId) {
    throw new AlbumPrintError("Printed sheet not found.");
  }
  return {
    albumId: row.albumId,
    row: { id: row.id, range: row.range, printedAt: row.printedAt, reprintingAt: row.reprintingAt },
  };
}

/**
 * What un-printing a sheet will do, said **before** it is done.
 *
 * Un-printing is possible and loud: it throws the stored result away, and everything the card kept —
 * the texts as they read then, the sizes the mounts were cut to, the strip each came from — is gone
 * with it. What comes back is a live page planned from today's data, which is not the same sheet.
 */
export async function describeAlbumUnprint(
  ownerId: string,
  printedPageId: string
): Promise<string[]> {
  const { albumId, row } = await requirePrintedPage(ownerId, printedPageId);
  const snapshots = await getAlbumPageSnapshots(albumId, [printedPageId]);
  const snapshot = snapshots.get(printedPageId);
  const said: string[] = [];
  if (!snapshot) return ["This sheet's stored contents cannot be read; un-printing will discard it."];

  const boxes = snapshot.page.boxes.length;
  said.push(
    `The stored sheet — ${boxes === 1 ? "1 box" : `${boxes} boxes`}, their sizes, their strips and ` +
      `the texts as they read when it was printed — is discarded and cannot be recovered.`
  );
  said.push(
    `Its ${snapshot.page.blocks.length === 1 ? "checklist returns" : "checklists return"} to the live plan and will be re-planned from current data, so a reprint will not be this card.`
  );
  if (row.reprintingAt) {
    said.push("This sheet is already awaiting a reprint; un-printing it instead forgets the old card entirely.");
  }
  said.push(`The card itself stays in the binder. The album simply stops knowing about ${row.range || "it"}.`);
  return said;
}

/** Throw the snapshot away and return the sheet's content to the live plan. */
export async function unprintAlbumPage(ownerId: string, printedPageId: string): Promise<void> {
  await requirePrintedPage(ownerId, printedPageId);
  // The index rows cascade, and so does any open continuation that was answering this sheet: with
  // the card gone there is nothing for a continuation to continue.
  await prisma.albumPrintedPage.delete({ where: { id: printedPageId } });
}

/**
 * Answer a divergence with a **reprint**.
 *
 * Takes the sheet's **own identity**, never a position in a live plan. A position means something
 * only against the plan that produced it (ADR-0046 §7), and reprinting is exactly the operation
 * where selecting the wrong card is expensive: the collector is about to take one out of a binder.
 *
 * The sheet's content returns to the live plan and is re-planned in full. The row survives, so the
 * album keeps saying that a card matching it is still in the binder, and it is discarded when the
 * replacement is marked printed in its turn — **however many sheets that replacement turns out to
 * be**, since {@link discardCoveredReprints} asks whether every stamp is covered rather than whether
 * one page was.
 *
 * A reprint that is never finished stays in this state **indefinitely and without nagging**: nothing
 * sweeps it, nothing escalates, and "I will get to it" is a legitimate answer for years. That is the
 * same rule as the report itself, which states a divergence once and then leaves it alone.
 */
export async function reprintAlbumPage(ownerId: string, printedPageId: string): Promise<void> {
  const { row } = await requirePrintedPage(ownerId, printedPageId);
  if (row.reprintingAt) return;
  // An **open continuation on this card folds away with it**, and it does so by construction rather
  // than by a rule here: a reprint takes the card out of the printed index, so the entry plans live
  // and whole, and the continuation block is only ever emitted for an entry that has something on
  // paper. The flag itself is left standing on purpose — cancelling the reprint restores exactly the
  // state that was there before, and finishing it clears the flag with every other continuation the
  // new sheets answer. What must not happen is the continuation surviving beside a re-planned parent
  // as a second card claiming the same stamps, and it cannot.
  await prisma.albumPrintedPage.update({
    where: { id: printedPageId },
    data: { reprintingAt: new Date() },
  });
}

/** Change one's mind: the card in the binder stands after all, and its content leaves the live plan
 *  again. Nothing was thrown away, so nothing has to be rebuilt. */
export async function cancelAlbumReprint(ownerId: string, printedPageId: string): Promise<void> {
  await requirePrintedPage(ownerId, printedPageId);
  await prisma.albumPrintedPage.update({
    where: { id: printedPageId },
    data: { reprintingAt: null },
  });
}

/**
 * Answer a divergence with a **continuation page**.
 *
 * The stamps of this entry that are on no sheet yet get a page of their own, with its own catalog
 * range, filed straight after the sheets that already carry the checklist. Nothing renumbers,
 * because nothing was ever numbered.
 *
 * Per divergence rather than per album: the flag is cleared as soon as the continuation is itself
 * printed, so the next stamp to arrive asks the question again.
 */
export async function openAlbumContinuation(
  ownerId: string,
  entryId: string,
  printedPageId: string
): Promise<void> {
  const { albumId } = await requirePrintedPage(ownerId, printedPageId);
  const entry = await prisma.albumEntry.findUnique({
    where: { id: entryId },
    select: { albumId: true },
  });
  if (!entry || entry.albumId !== albumId) {
    throw new AlbumPrintError("That checklist is not in this album.");
  }
  await prisma.albumEntry.update({
    where: { id: entryId },
    data: { continuesPrintedPageId: printedPageId },
  });
}

/** Withdraw a continuation that has not been printed: the waiting stamps go back to appearing
 *  nowhere, which is the honest state until the collector answers again. */
export async function closeAlbumContinuation(ownerId: string, entryId: string): Promise<void> {
  const entry = await prisma.albumEntry.findUnique({
    where: { id: entryId },
    select: { album: { select: { collection: { select: { ownerId: true } } } } },
  });
  if (!entry || entry.album.collection.ownerId !== ownerId) {
    throw new AlbumPrintError("Album entry not found.");
  }
  await prisma.albumEntry.update({
    where: { id: entryId },
    data: { continuesPrintedPageId: null },
  });
}

// -- The divergence report ---------------------------------------------------

/** One checklist on a printed card, and what it is waiting on. */
export interface AlbumPrintedEntryReport {
  entryId: string;
  checklistName: string;
  /** Stamps of this checklist that are on no sheet at all. */
  waiting: number;
  /** Whether the collector has already answered with a continuation page. */
  continuationOpen: boolean;
}

/** One printed sheet, and what the collection has done to it since. */
export interface AlbumPrintedSheetReport {
  id: string;
  range: string;
  printedAt: string;
  /** The collector has chosen a reprint; the content is back in the live plan until a new sheet is
   *  marked printed in its turn. */
  reprinting: boolean;
  divergences: AlbumDivergence[];
  entries: AlbumPrintedEntryReport[];
}

export interface AlbumPrintedReport {
  sheets: AlbumPrintedSheetReport[];
}

/**
 * Every printed card of an album, with what differs between it and what the data would now produce.
 *
 * Ranked most serious first within a sheet — see `ALBUM_DIVERGENCE_KINDS`, and note that a picture
 * arriving after the fact ranks last deliberately: it is a real divergence and a low-value one, and
 * it will be far more common than a rename.
 */
export async function getAlbumPrintedReport(
  ownerId: string,
  albumId: string
): Promise<AlbumPrintedReport> {
  const context = await albumPlanContext(ownerId, albumId);
  if (!context) throw new AlbumPrintError("Album not found.");
  const { printed, entries } = context;
  if (printed.pages.size === 0) return { sheets: [] };

  const snapshots = await getAlbumPageSnapshots(albumId, [...printed.pages.keys()]);
  const photos = await resolveAlbumPhotos(
    context.album.collectionId,
    entries.flatMap((e) => e.stampIds)
  );
  const photoIdFor = (stampId: string) => photos.get(stampId)?.id ?? null;

  const sheets = new Map<string, AlbumPrintedSheetReport>();
  for (const [id, row] of printed.pages) {
    sheets.set(id, {
      id,
      range: row.range,
      printedAt: row.printedAt.toISOString(),
      reprinting: row.reprintingAt !== null,
      divergences: [],
      entries: [],
    });
  }

  for (const group of printedCardGroups(printed.byEntry, snapshots, printed.byTextBlock)) {
    const groupSheets = group.pageIds.filter((id) => {
      const row = printed.pages.get(id);
      return row && !row.reprintingAt;
    });
    if (groupSheets.length === 0) continue;
    const groupEntries = entries.filter((e) => group.entryIds.has(e.id));

    const printedPages: AlbumComparablePage[] = [];
    for (const pageId of groupSheets) {
      const snapshot = snapshots.get(pageId);
      if (!snapshot) continue;
      printedPages.push(snapshotComparablePage(snapshot));
    }
    if (printedPages.length === 0) continue;

    const reference = planPrintedCardReference(context, groupEntries, group, snapshots, photoIdFor);

    for (const pair of diffAlbumPlans(printedPages, reference)) {
      // A sheet the reference needs and no card holds is content with nowhere to go — the state a
      // continuation page answers. It belongs to the card, so it is said on its last sheet.
      const target =
        pair.printedIndex !== null ? groupSheets[pair.printedIndex] : groupSheets[groupSheets.length - 1];
      sheets.get(target)?.divergences.push(...pair.divergences);
    }

    for (const entry of groupEntries) {
      const onPaper = printed.byEntry.get(entry.id);
      const last = onPaper?.printedPageIds[onPaper.printedPageIds.length - 1];
      // A checklist that already runs onto a continuation is offered another one on its **latest**
      // card, not on every card it has ever been on: a continuation is filed after the sheet it
      // continues, and offering it twice would ask the collector to choose where it goes.
      if (!last || !group.pageIds.includes(last)) continue;
      const waiting = onPaper ? entry.stampIds.filter((id) => !onPaper.stampIds.has(id)).length : 0;
      sheets.get(sheets.has(last) ? last : groupSheets[groupSheets.length - 1])?.entries.push({
        entryId: entry.id,
        checklistName: entry.checklistName,
        waiting,
        continuationOpen: entry.continuesPrintedPageId !== null,
      });
    }
  }

  // A card whose stamps have all left the album is not a row to sweep. It is the loudest divergence
  // there is, and nothing in the plan can file it, so it is said here.
  for (const id of printed.orphanedPageIds) {
    const sheet = sheets.get(id);
    if (!sheet) continue;
    sheet.divergences.push({
      kind: "stamps",
      detail:
        "Nothing in the album corresponds to this card any more — every checklist it carries has left it.",
    });
  }

  return {
    sheets: [...sheets.values()].sort((a, b) => a.printedAt.localeCompare(b.printedAt) || a.id.localeCompare(b.id)),
  };
}

/** A printed **card**: the sheets one run of checklists is on, and the checklists on them. A card is
 *  one sheet in the ordinary case, and two or three when a checklist is too tall for a page. */
interface PrintedCardGroup {
  pageIds: string[];
  entryIds: Set<string>;
}

/**
 * Group printed sheets into cards.
 *
 * Sheets belong to one card when **a single block runs across them** — a checklist too tall for a
 * page, split at a row boundary onto two or three sheets that were printed as one act.
 *
 * That is *not* the same as "the same checklist appears on both", and the difference is exactly what
 * a continuation page is. A continuation carries the same checklist onto a card of its own, printed
 * later, deliberately kept separate: grouping the two would re-plan them together and produce the one
 * card the collector chose **not** to make when they answered with a continuation rather than a
 * reprint — and the report would then say, for ever, that each card is missing the other's stamps.
 *
 * The signal is the **snapshot's own block part**, which is the layout's, not the index's: a split
 * block's sheets carry parts 1, 2, 3, while a continuation starts again at 1 because it was planned
 * as a fresh block. The index's `part` column is offset so an entry's cards stay in filing order and
 * is deliberately not what this reads.
 */
function printedCardGroups(
  byEntry: ReadonlyMap<string, { printedPageIds: string[] }>,
  snapshots: ReadonlyMap<string, AlbumPageSnapshot>,
  /** Which sheet each of the collector's notes is on (#769), so a card carrying **only** a note is
   *  still a card. Without it such a sheet joins no group, is never compared, and is offered nothing
   *  in the report — a card in the binder the album has quietly stopped having an opinion about. */
  byTextBlock: ReadonlyMap<string, string>
): PrintedCardGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const partOf = (pageId: string, entryId: string): number | null => {
    const block = snapshots.get(pageId)?.page.blocks.find((b) => b.entryId === entryId);
    return block ? block.part : null;
  };

  for (const [entryId, held] of byEntry) {
    for (const id of held.printedPageIds) if (!parent.has(id)) parent.set(id, id);
    for (let i = 1; i < held.printedPageIds.length; i += 1) {
      const previous = partOf(held.printedPageIds[i - 1], entryId);
      const current = partOf(held.printedPageIds[i], entryId);
      if (previous !== null && current === previous + 1) {
        union(held.printedPageIds[i - 1], held.printedPageIds[i]);
      }
    }
  }

  const groups = new Map<string, PrintedCardGroup>();
  const groupFor = (id: string): PrintedCardGroup => {
    const root = find(id);
    let group = groups.get(root);
    if (!group) {
      group = { pageIds: [], entryIds: new Set() };
      groups.set(root, group);
    }
    if (!group.pageIds.includes(id)) group.pageIds.push(id);
    return group;
  };
  for (const [entryId, held] of byEntry) {
    for (const id of held.printedPageIds) groupFor(id).entryIds.add(entryId);
  }
  // A note never joins two sheets — it is one block on one card — so it only ever opens a group that
  // no checklist opened.
  for (const pageId of byTextBlock.values()) {
    if (!parent.has(pageId)) parent.set(pageId, pageId);
    groupFor(pageId);
  }
  return [...groups.values()];
}

/**
 * What the current data would produce for one printed card, planned on fresh paper.
 *
 * The chapter heading is taken from the card itself rather than from where it happens to sit now: a
 * sheet that carried a year heading is compared against one that would carry a year heading, and one
 * that did not against one that would not. Otherwise every chapter's first card would report its own
 * heading as newly arrived or newly gone, depending only on which end of the comparison was built.
 */
function planPrintedCardReference(
  context: AlbumPlanContext,
  groupEntries: readonly AlbumEntryData[],
  group: PrintedCardGroup,
  snapshots: ReadonlyMap<string, AlbumPageSnapshot>,
  photoIdFor: (stampId: string) => string | null
): AlbumComparablePage[] {
  const first = snapshots.get(group.pageIds[0]);
  const onOtherCards = new Set<string>();
  for (const [id, snapshot] of snapshots) {
    if (group.pageIds.includes(id)) continue;
    for (const box of snapshot.page.boxes) onOtherCards.add(box.box.stampId);
  }

  // The collector's own notes that are **on this card** (#769). They have to be in the reference for
  // the reason the chapter heading has to: the card carries them, so a reference planned without
  // them would report every one of them as gone, for ever, on a card nothing is wrong with. Read
  // from the printed index rather than from the snapshot's blocks, so one module answers *which sheet
  // is this note on* — the same rule the checklists beside them follow.
  const notesOnCard = context.textBlocks.filter((note) => {
    const pageId = context.printed.byTextBlock.get(note.id);
    return pageId !== undefined && group.pageIds.includes(pageId);
  });
  const notesAt = new Map<string, typeof notesOnCard>();
  for (const note of notesOnCard) {
    // A note anchored to a checklist that is not on this card is still on this card, and the anchor
    // says nothing useful about where it sits within it — so it leads, which is where the plan puts
    // an unanchored one.
    const anchored =
      note.anchorAlbumEntryId &&
      groupEntries.some((e) => e.id === note.anchorAlbumEntryId);
    const at = anchored ? `${note.anchorAlbumEntryId}#${note.side}` : "#before";
    notesAt.set(at, [...(notesAt.get(at) ?? []), note]);
  }

  const blocks: AlbumBlockSpec<AlbumBoxData>[] = [];
  for (const note of notesAt.get("#before") ?? []) blocks.push(albumNoteBlock(note, null));
  for (const entry of groupEntries) {
    for (const note of notesAt.get(`${entry.id}#before`) ?? [])
      blocks.push(albumNoteBlock(note, null));
    const onPaper = context.printed.byEntry.get(entry.id);
    const stampIds = entry.stampIds.filter((id) => {
      if (onOtherCards.has(id)) return false;
      // A stamp waiting on a continuation the collector has already opened is answered; repeating it
      // here would report the same divergence every time the screen is read.
      if (entry.continuesPrintedPageId && onPaper && !onPaper.stampIds.has(id)) return false;
      return true;
    });
    if (stampIds.length > 0) {
      blocks.push({
        entryId: entry.id,
        heading: context.checklistHeading(entry),
        kind: "entry",
        boxes: context.boxesFor(entry, stampIds),
        printedPageIds: null,
        spaceBeforeMm: entry.spaceBeforeMm,
        spaceAfterMm: entry.spaceAfterMm,
        breakBefore: entry.breakBefore,
      });
    }
    for (const note of notesAt.get(`${entry.id}#after`) ?? [])
      blocks.push(albumNoteBlock(note, null));
  }
  for (const note of notesAt.get("#after") ?? []) blocks.push(albumNoteBlock(note, null));
  if (blocks.length === 0) return [];

  const plan = planAlbumPages(
    [
      {
        key: first?.chapterKey ?? "",
        // The card either opened its chapter or it did not; the reference must do the same.
        heading: first?.page.chapter ? context.chapterHeading(groupEntries) : "",
        blocks,
      },
    ],
    context.album,
    context.album.name,
    albumTextMetrics
  );

  return context.finish(plan).map((page) => withPhotoIds(albumComparablePage(context.album, page), photoIdFor));
}

function withPhotoIds(
  page: AlbumComparablePage,
  photoIdFor: (stampId: string) => string | null
): AlbumComparablePage {
  return {
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      boxes: block.boxes.map((box) => ({ ...box, photoId: photoIdFor(box.stampId) })),
    })),
  };
}

/** One printed sheet as the comparison reads it — from the stored result and nothing else. */
export function snapshotComparablePage(snapshot: AlbumPageSnapshot): AlbumComparablePage {
  return {
    range: snapshot.range,
    title: snapshot.page.title?.lines.join(" ") ?? "",
    chapter: snapshot.page.chapter?.lines.join(" ") ?? "",
    footer: snapshot.footer?.lines.join(" ") ?? "",
    language: languageLabel(snapshot.language),
    preset: snapshot.preset,
    blocks: snapshotBlocks(snapshot.page).map((block) => ({
      entryId: block.entryId,
      part: block.part,
      kind:
        snapshot.page.blocks.find((b) => b.entryId === block.entryId && b.part === block.part)
          ?.kind ?? "entry",
      heading:
        snapshot.page.blocks.find((b) => b.entryId === block.entryId && b.part === block.part)
          ?.heading ?? "",
      boxes: block.boxes.map((box) => ({
        stampId: box.stampId,
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        label: box.label,
        stripId: box.strip?.id ?? null,
        stripHeightMm: box.strip?.heightMm ?? null,
        photoId: box.photoId,
      })),
    })),
  };
}
