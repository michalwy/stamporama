import "server-only";
import { planAlbum } from "./album-plan";
import { getAlbumPageSnapshots } from "./album-printed-pages";
import { getHawidStrips } from "./hawid-stock";
import type { AlbumPageSnapshot } from "./album-snapshot";
import type { AlbumData } from "./albums";
import {
  albumCutSheets,
  buildAlbumCuttingList,
  type AlbumCutSnapshot,
  type AlbumCuttingList,
} from "./album-cutting-list";

// The cutting list's server half (#770). It reads rows and nothing else: every width, every strip
// height and every count is decided in `album-cutting-list.ts`, which is pure, over boxes decided in
// `hawid.ts`. A box on the card and a cut on this list have to be one number computed once.
//
// ## A printed card's boxes come from its snapshot
//
// The one thing that makes this more than a walk over the plan. A live sheet's boxes are in the plan
// — sized out of the drawer as it stands today (#765). A **printed** sheet's are not in the plan at
// all: the planner steps over the block and states no boxes for it, because what is on that card is
// a stored result and re-resolving it would be a second, quieter answer to a question the snapshot
// has already answered (ADR-0047 §1). So this reads the snapshot, exactly as `album-pdf.ts` does to
// redraw one.
//
// That the snapshot *can* answer is deliberate rather than incidental: `AlbumSnapshotBox` keeps
// `sizeSource` and a **copy** of the strip each box was cut from, and `album-snapshot.ts` says in so
// many words that they are kept "so the cutting list and the editor can say so about a sheet already
// printed". Copied and not referenced because the drawer changes and the paper does not — a card cut
// from a 29 mm strip that has since been sold out is still 29 mm.

/** The list plus what it is a list of. */
export interface AlbumCuttingListResult {
  album: AlbumData;
  list: AlbumCuttingList;
  /** True when the collection has described no hawid stock, which makes **every** box oversize
   *  (#765) and this whole list a page of pockets. Deliberate on the rule's part, and worth saying
   *  out loud rather than leaving a sheet with nothing to cut on it to be puzzled over. */
  emptyStock: boolean;
  /** Printed cards whose stored contents this build cannot read, by range. Their cuts are missing
   *  and the sheet says so, rather than being re-derived from live data. */
  unreadable: string[];
}

/**
 * A stored snapshot as the cutting list reads one.
 *
 * The only adaptation the whole file performs, and it is a field name: a snapshot calls the strip's
 * stock length `lengthMm`, having copied it on the day the card was printed. It is the same figure.
 */
function cutSnapshot(snapshot: AlbumPageSnapshot): AlbumCutSnapshot {
  return {
    range: snapshot.range,
    chapterKey: snapshot.chapterKey,
    page: {
      ...snapshot.page,
      boxes: snapshot.page.boxes.map((placed) => ({
        ...placed,
        box: {
          widthMm: placed.box.widthMm,
          heightMm: placed.box.heightMm,
          label: placed.box.label,
          strip: placed.box.strip
            ? {
                heightMm: placed.box.strip.heightMm,
                stockLengthMm: placed.box.strip.lengthMm,
                label: placed.box.strip.label,
              }
            : null,
          sizeSource: placed.box.sizeSource,
        },
      })),
    },
  };
}

/**
 * The album's cutting list.
 *
 * One plan read, as everything else about an album takes: planning twice would be two answers to a
 * question that has one, and on this surface the wrong one is the one somebody cuts to.
 */
export async function getAlbumCuttingList(
  ownerId: string,
  albumId: string
): Promise<AlbumCuttingListResult | null> {
  const plan = await planAlbum(ownerId, albumId);
  if (!plan) return null;

  // Read only for the cards the plan actually files, and only here — `planAlbum` lists a few hundred
  // sheets and would otherwise load a page of geometry for every one of them to show a list.
  const stored = await getAlbumPageSnapshots(
    albumId,
    plan.pages.flatMap((p) => (p.layout.kind === "printed" ? [p.layout.printedPageId] : []))
  );
  const snapshots = new Map<string, AlbumCutSnapshot>();
  for (const [id, snapshot] of stored) snapshots.set(id, cutSnapshot(snapshot));

  // When each card went onto paper. Shown per sheet because the collector marks a sheet printed as
  // it leaves the printer and cuts for it afterwards, so *which run a card came out of* is what
  // separates the cards still waiting for their hawid from the ones mounted months ago — a fact the
  // album has no other way to state, since it records printing and not mounting.
  const printedAt = new Map<string, string>();
  for (const [id, row] of plan.printed.pages) printedAt.set(id, row.printedAt.toISOString());

  // The drawer as it stands. A **second** read of the stock, and a legitimate one: `planAlbum` reads
  // it to answer *what box does this stamp get*, which is a question about the sheets. This asks
  // *does the drawer still hold this strip*, which is a question about a printed card's copied strip
  // (ADR-0047 §1) and has no answer inside the plan at all. The stock is the one part of an album
  // read live precisely because a drawer changes.
  const stock = await getHawidStrips(ownerId, plan.album.collectionId);

  const { sheets, unreadable } = albumCutSheets(plan.pages, snapshots, printedAt);
  return {
    album: plan.album,
    list: buildAlbumCuttingList(sheets, stock),
    emptyStock: plan.emptyStock,
    unreadable,
  };
}
