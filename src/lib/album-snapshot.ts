// What a printed album sheet keeps (#778): the stored result a card in a binder is made of.
//
// **Pure.** No Prisma, no PDF library, no React — the same rule `album-layout.ts` follows, and for
// the same reason: this shape is written by the album's Prisma side, read by the PDF (#768), read by
// the editor (#769) and compared by `album-divergence.ts`, and a shape that resolves anything at
// read time would resolve it differently in four places.
//
// ## A stored result, not a flag
//
// The obvious alternative was a `frozen` boolean on the recompute path, and it is the failure this
// module exists to prevent. A flag stops the **layout** being re-planned while every text and every
// dimension goes on resolving from live data — so renaming an issue would quietly change what a
// reprint produces, and the reprint would no longer match the card it is supposed to replace. The
// whole point of a printed page is that a reprint a year later is *the same sheet*.
//
// So the snapshot keeps everything a renderer could otherwise ask a live table for:
//
// - the **resolved texts**, already translated into the album's language and already wrapped, as the
//   layout wrapped them;
// - the **box geometry in millimetres**, placed;
// - the **stamps and their order**;
// - the **catalog range** that is the sheet's identity;
// - the **strip each box was cut from** — its height, its stock length and its label, copied rather
//   than referenced, because the hawid stock is read live everywhere else (#765) and a drawer
//   changes;
// - the **render preset** the sheet was set under, copied whole, which is #308's rule at its
//   strictest: an edit to a template may not reach into a card with stamps glued to it;
// - the **picture** each mount printed, by `Photo.id`.
//
// Nothing here needs a fallback and nothing here resolves. A printed page draws stored values.
//
// ## What a card may **not** carry
//
// Anything that is a function of what the collector *owns* — a completion count, a valuation, an
// owned/wanted marker. Such a figure is stale as the sheet leaves the printer, and under a
// divergence report it is worse than stale: every acquisition would register as a divergence on
// every page carrying it, and a report that exists to catch cards needing attention would be drowned
// by ordinary collecting.
//
// The distinction is **printed onto the card**, not *shown about the card*, and it is as easy to
// misapply in the opposite direction. The inherited-size and oversize flags on the album screen and
// in the page editor (#769) have exactly the same staleness property and are shown deliberately —
// they are shown on screen, before printing, and never go onto the paper. `sizeSource` below is in
// the snapshot for the same reason `catalogSortKey` is: it is a fact about how the box was arrived
// at, kept so the cutting list and the editor can say so about a sheet already printed. It is not
// printed and it is not compared.

import type {
  AlbumBoxSpec,
  AlbumPlacedText,
  AlbumPlannedPage,
} from "./album-layout";
import type { AlbumRenderPreset } from "./album-template-rules";

/** The shape of a stored snapshot. Bumped when the stored shape changes in a way an older row does
 *  not satisfy; a row that does not carry the current version is refused rather than guessed at,
 *  because guessing produces a card that is subtly not the one in the binder. */
export const ALBUM_SNAPSHOT_VERSION = 1;

/** Thrown for a stored snapshot this build cannot read. Its message reaches the collector, so it
 *  says what is wrong with the sheet rather than what the parser wanted. */
export class AlbumSnapshotError extends Error {}

/** The strip a box was cut from, as the drawer read at the moment it was cut.
 *
 *  Copied, never referenced. `HawidStrip` is the one thing about an album that is read live (#765) —
 *  it is a statement about a drawer and a drawer changes — and that is exactly why a printed card
 *  cannot point at one: the 29 mm strip the sheet was planned against may have been renamed, or sold
 *  out, or deleted, and the box on the paper is still 29 mm tall. */
export interface AlbumSnapshotStrip {
  id: string;
  heightMm: number;
  lengthMm: number;
  label: string | null;
}

/** One box, exactly as it was cut and printed. */
export interface AlbumSnapshotBox extends AlbumBoxSpec {
  stampId: string;
  /** The strip, or **null** for a pocket — a piece no strip in stock was tall enough for (#765). */
  strip: AlbumSnapshotStrip | null;
  /** Where the size came from (#763). Kept so the cutting list and the editor can still say a
   *  printed box was cut to a borrowed figure. Not printed, and not compared. */
  sizeSource: "stated" | "inherited" | null;
  sizeFromStampId: string | null;
  catalogNumber: string | null;
  catalogSortKey: string | null;
  /** The picture printed inside the mount, by `Photo.id`, or null for a slot that printed empty.
   *  Stored rather than re-resolved: a photo added afterwards is a **divergence** (#778), and a
   *  sheet that quietly picked up the new picture on a reprint could not report one. */
  photoId: string | null;
}

/** The placed sheet itself — the live variant of a planned page, over snapshot boxes. Stored whole
 *  and drawn as it stands: every position, size and line break was decided once, by the layout, on
 *  the day the card was printed. */
export type AlbumSnapshotPage = Extract<
  AlbumPlannedPage<AlbumSnapshotBox>,
  { kind: "live" }
>;

/** Everything that went onto one sheet of paper. */
export interface AlbumPageSnapshot {
  version: number;
  /** The album's name as the sheet's running head and texts carry it. */
  albumName: string;
  /** The language the sheet was printed in. An album's language stays editable — a change re-plans
   *  the live pages, leaves the printed ones in the language they were printed in, and shows up in
   *  the divergence report like everything else (#755). */
  language: string;
  /** The render preset the sheet was set under, copied whole. */
  preset: AlbumRenderPreset;
  /** The sheet's identity — its catalog range, `PL 303-309`. */
  range: string;
  /** The chapter it sits in, so the sequence still reads as chapters. */
  chapterKey: string;
  page: AlbumSnapshotPage;
  /** The footer, rendered into the band the layout reserved for it, or null. */
  footer: AlbumPlacedText | null;
}

/** One row of the index over a snapshot: which stamp of which entry, and where on the card. */
export interface AlbumSnapshotStampRow {
  stampId: string;
  albumEntryId: string;
  /** Which sheet of a split block this is — 1 for an ordinary checklist. */
  part: number;
  /** The stamp's position **within its block**, so the printed order survives across the sheets of
   *  a split one. */
  sortOrder: number;
}

/**
 * The boxes of a placed page, grouped by the block that put them there.
 *
 * `AlbumPlacedBlock.firstBoxIndex` indexes the *block's own* box list, not the page's, so the page's
 * boxes are walked with a cursor instead: `placeBlock` pushes a block's boxes contiguously and
 * `placeBand` calls it once per block, so the page's `boxes` are grouped in `blocks` order by
 * construction.
 */
export function snapshotBlocks<T extends AlbumBoxSpec>(
  page: Extract<AlbumPlannedPage<T>, { kind: "live" }>
): { entryId: string; part: number; firstBoxIndex: number; boxes: T[] }[] {
  const out: { entryId: string; part: number; firstBoxIndex: number; boxes: T[] }[] = [];
  let cursor = 0;
  for (const block of page.blocks) {
    out.push({
      entryId: block.entryId,
      part: block.part,
      firstBoxIndex: block.firstBoxIndex,
      boxes: page.boxes.slice(cursor, cursor + block.boxCount).map((b) => b.box),
    });
    cursor += block.boxCount;
  }
  return out;
}

/**
 * The queryable index over a snapshot.
 *
 * **Derived, never authored.** These rows are written from the snapshot in the transaction that
 * stores it and from nowhere else, so there is one statement of what is on the card and one
 * projection of it. They exist because the page plan asks *is this block already on paper* on every
 * read, and answering that from the snapshots would load a few hundred pages of geometry to look at
 * a list of ids.
 */
export function snapshotStampRows(snapshot: AlbumPageSnapshot): AlbumSnapshotStampRow[] {
  const rows: AlbumSnapshotStampRow[] = [];
  for (const block of snapshotBlocks(snapshot.page)) {
    block.boxes.forEach((box, i) => {
      rows.push({
        stampId: box.stampId,
        albumEntryId: block.entryId,
        part: block.part,
        sortOrder: block.firstBoxIndex + i,
      });
    });
  }
  return rows;
}

/** Every `Photo.id` a sheet printed, so a renderer reads exactly the pictures the card carries. */
export function snapshotPhotoIds(snapshot: AlbumPageSnapshot): string[] {
  const ids = new Set<string>();
  for (const box of snapshot.page.boxes) {
    if (box.box.photoId) ids.add(box.box.photoId);
  }
  return [...ids];
}

/**
 * Read a stored snapshot back.
 *
 * A **structural** check rather than a full schema validation: this value was written by this
 * application, so what is being guarded against is a row from a shape this build no longer
 * understands, not a hostile payload. It fails loudly for the same reason a face this build no
 * longer ships is refused by name when drawing (ADR-0046 §5) — a card is not a derivation, and a
 * sheet drawn from half a snapshot is wrong in a way only a ruler finds.
 */
export function parseAlbumSnapshot(value: unknown): AlbumPageSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AlbumSnapshotError("This printed sheet has no stored contents.");
  }
  const snapshot = value as Partial<AlbumPageSnapshot>;
  if (snapshot.version !== ALBUM_SNAPSHOT_VERSION) {
    throw new AlbumSnapshotError(
      `This sheet was stored by a different version of the album (${String(snapshot.version)}), ` +
        `and this one reads version ${ALBUM_SNAPSHOT_VERSION}.`
    );
  }
  const page = snapshot.page;
  if (
    !snapshot.preset ||
    typeof snapshot.albumName !== "string" ||
    typeof snapshot.language !== "string" ||
    typeof snapshot.range !== "string" ||
    !page ||
    page.kind !== "live" ||
    !Array.isArray(page.boxes) ||
    !Array.isArray(page.blocks)
  ) {
    throw new AlbumSnapshotError("This printed sheet's stored contents are incomplete.");
  }
  return snapshot as AlbumPageSnapshot;
}
