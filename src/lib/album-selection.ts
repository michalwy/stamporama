/**
 * What is selected on the page editor's canvas, and which stamps a size set from it reaches (#1309).
 *
 * Pure, and here rather than in the canvas, for `album-drag.ts`'s reason: the ring the canvas draws
 * round a selected box and the stamps the panel then writes a size to must be one answer, and two
 * components each working it out is how a ring comes to promise a stamp the write leaves out.
 *
 * ## A box is a slot, so a selection is a list of slots
 *
 * A box is named by its entry **and** its stamp (ADR-0047 §2): one stamp can sit on two checklists
 * of an issue and the album then draws two boxes for it. Selecting both is selecting two boxes, and
 * the size they are given is still **one stamp's** — so the write is over the stamps the boxes hold,
 * each once, which {@link sizeSubjectStampIds} is.
 *
 * ## One box and several are different selections
 *
 * A single box carries the handles, the row break and the measuring; several carry one act, a size
 * for all of them through the apply dialog. So the shape says which it is rather than every reader
 * counting a list: `box` is exactly one, `boxes` is two or more, and a toggle that leaves one or none
 * turns back into `box` or nothing.
 */

/** The pair that names one box on a sheet. */
export interface AlbumBoxRef {
  entryId: string;
  stampId: string;
}

export type AlbumEditorSelection =
  | ({ kind: "box" } & AlbumBoxRef)
  | { kind: "boxes"; boxes: AlbumBoxRef[] }
  | { kind: "block"; id: string }
  | null;

function sameBox(a: AlbumBoxRef, b: AlbumBoxRef): boolean {
  return a.entryId === b.entryId && a.stampId === b.stampId;
}

/** The boxes a selection holds, in the order they were picked. A block or nothing holds none. */
export function selectedBoxRefs(selection: AlbumEditorSelection): AlbumBoxRef[] {
  if (selection?.kind === "box") return [{ entryId: selection.entryId, stampId: selection.stampId }];
  if (selection?.kind === "boxes") return selection.boxes;
  return [];
}

export function isBoxSelected(selection: AlbumEditorSelection, box: AlbumBoxRef): boolean {
  return selectedBoxRefs(selection).some((ref) => sameBox(ref, box));
}

/** A selection of exactly these boxes, in the shape their count calls for. */
export function selectionOfBoxes(boxes: readonly AlbumBoxRef[]): AlbumEditorSelection {
  if (boxes.length === 0) return null;
  if (boxes.length === 1) return { kind: "box", ...boxes[0] };
  return { kind: "boxes", boxes: [...boxes] };
}

/**
 * A box added to the selection, or taken off it — the shift-click.
 *
 * Starting from a block, the block is let go: a block and a box are not selected together, because
 * the panel beside the sheet describes one thing and the two would each want it.
 */
export function toggleBoxSelection(
  selection: AlbumEditorSelection,
  box: AlbumBoxRef
): AlbumEditorSelection {
  const held = selectedBoxRefs(selection);
  const next = held.some((ref) => sameBox(ref, box))
    ? held.filter((ref) => !sameBox(ref, box))
    : [...held, { entryId: box.entryId, stampId: box.stampId }];
  return selectionOfBoxes(next);
}

/**
 * The stamps a size set from these boxes is written to: each stamp once, in the order its first box
 * was picked. Two boxes of one stamp (two checklists of one issue) are one stamp and one write.
 */
export function sizeSubjectStampIds(boxes: readonly AlbumBoxRef[]): string[] {
  return [...new Set(boxes.map((b) => b.stampId))];
}

/**
 * The boxes a block holds **on this sheet**, as a slice of the sheet's own box list.
 *
 * Walked with a cursor over the sheet's blocks rather than read off `firstBoxIndex`, which indexes
 * the block's *own* boxes: a checklist split across two sheets opens the second on a box that is not
 * its first. It is the walk the canvas and `album-editor.ts` already make, for that reason. A block
 * that is not on the sheet holds nothing here.
 */
export function blockBoxesOnSheet<B>(
  blocks: readonly { id: string; boxCount: number }[],
  boxes: readonly B[],
  blockId: string
): B[] {
  let cursor = 0;
  for (const block of blocks) {
    if (block.id === blockId) return boxes.slice(cursor, cursor + block.boxCount);
    cursor += block.boxCount;
  }
  return [];
}
