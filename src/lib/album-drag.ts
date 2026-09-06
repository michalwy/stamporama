/**
 * What a drag on the page canvas is carrying, and what dropping it somewhere would mean (#816).
 *
 * Pure, and here rather than in the canvas, because it is a **rule** and not a rendering: the mark
 * drawn under the pointer is a promise about what the drop will do, and the only way a promise like
 * that stays true is for the drawing and the committing to read one function. A canvas deciding for
 * itself which targets are live would drift from `page-editor.tsx` the first time either changed,
 * and the drift would be invisible — a mark shown over a target that does nothing, or no mark over
 * one that does.
 *
 * ## The reorders here are insert-before, never swap
 *
 * Every ordering this canvas writes moves the carried thing **out** of the list and splices it in at
 * the target's index, pushing the target and everything after it one place later. So the honest mark
 * is an **insertion point** — *this goes here, in front of that one* — and it reads the same whether
 * the thing is being carried forwards or backwards. Two things highlighted as if they had exchanged
 * places would teach a rule the app does not follow, which is worse than drawing nothing at all: the
 * collector would predict the wrong result every time and be right about the picture.
 *
 * ## A note is filed, not positioned
 *
 * A checklist's place in the album *is* its position in an order. A note's place is its **anchor** —
 * which checklist it is filed against, and on which side (`albums.md`) — which is what makes a note
 * travel when that checklist is later dragged somewhere else. Dropping a note therefore re-files it,
 * and the mark says *filed here* over the block it lands on rather than drawing it a slot in a
 * sequence it is not part of. That is deliberately the **less specific** of the two marks: dropping
 * a note on one filed elsewhere joins it there without promising a position among its new siblings,
 * and a mark that under-states what will happen is honest where one that over-states it is not.
 */

/** The thing under the pointer between press and release. A reorder has no millimetres — only a
 *  source and a target — which is why it is not a `CanvasDrag`. */
export type AlbumCarry =
  | { kind: "box"; blockId: string; stampId: string }
  | { kind: "block"; blockId: string; blockKind: "entry" | "text" };

/** What to draw over a target. `insert-before` is a line in front of it; `file-here` is a plate on
 *  it. Null is the third answer and the important one: dropping here does nothing, so promise
 *  nothing. */
export type AlbumDropMark = "insert-before" | "file-here";

/**
 * Dropping the carried thing on this box.
 *
 * A box only reorders within its **own** block — the order written is the entry's own stamp list —
 * so a box carried over another block's boxes lands nowhere, and neither does one dropped back on
 * itself.
 */
export function boxDropMark(
  carry: AlbumCarry | null,
  target: { blockId: string; stampId: string },
): AlbumDropMark | null {
  if (carry?.kind !== "box") return null;
  if (carry.blockId !== target.blockId) return null;
  if (carry.stampId === target.stampId) return null;
  return "insert-before";
}

/**
 * Dropping the carried thing on this block's heading.
 *
 * A **checklist** is positioned among the album's other checklists, so it lands in front of the one
 * it is dropped on — and dropping it on a *note* does nothing whatever, because a note is not in
 * that order to be positioned against. A **note** is filed, against a checklist or against whatever
 * another note is filed against, so every block is a live target for one.
 */
export function blockDropMark(
  carry: AlbumCarry | null,
  target: { blockId: string; blockKind: "entry" | "text" },
): AlbumDropMark | null {
  if (carry?.kind !== "block") return null;
  if (carry.blockId === target.blockId) return null;
  if (carry.blockKind === "entry") {
    return target.blockKind === "entry" ? "insert-before" : null;
  }
  return "file-here";
}

/**
 * `moved` taken out of `order` and put back in front of `target` — the one splice every reorder on
 * this canvas is, stated once so the mark and the write cannot disagree about it.
 *
 * Null for a move that changes nothing or cannot be made: onto itself, or with either end missing
 * from the list. The missing-end guard is not decoration — `splice` reads the `-1` that a missing
 * target returns as *one from the end* and would quietly file the thing next to last.
 */
export function insertBefore<T>(order: readonly T[], moved: T, target: T): T[] | null {
  if (moved === target) return null;
  if (!order.includes(moved) || !order.includes(target)) return null;
  const next = order.filter((id) => id !== moved);
  next.splice(next.indexOf(target), 0, moved);
  return next;
}
