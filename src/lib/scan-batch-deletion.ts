/**
 * *May this card scan be deleted?* (#1218) — the pure half of deleting a batch, so the rule is
 * stated once and the screen that greys the button out and the server that refuses the write cannot
 * come to disagree about it.
 *
 * Two kinds of batch reach a delete, and they are held to different rules on purpose:
 *
 * - **A batch nothing has become a copy from** — a wrong file uploaded, a card cut badly and not worth
 *   re-cutting. It has always been deletable whatever its tiles are doing, and it stays so: nothing
 *   outside the batch points at it, so throwing it away half-worked loses only the batch itself.
 *   Settled with the collector on 2026-09-13, alongside #1218.
 * - **A batch with copies made from it** — the case #1218 opens. Deleting it is how a pile of cards
 *   nothing more will ever be done with is cleared, and **only a card worked all the way through
 *   qualifies**: a tile still waiting is work not done, and a parked one (#597) is work deliberately
 *   put off, whose card scan is exactly what the collector is coming back to it for.
 *
 * What is deleted is the same for both: the sheets and their bytes, and every tile row. A consumed
 * tile's pictures are not among them — consuming a tile re-owns its `Photo` rows to the copy
 * (`movePhotosToItem`) — so the copies keep every photograph and simply stop naming a scan (#1188).
 */

/** A tile as this rule reads one — `scan_tile.state`. */
export interface DeletableTile {
  state: string;
}

export interface BatchDeletion {
  /** Whether the batch may be deleted now. */
  allowed: boolean;
  /** Tiles still to be identified (`unidentified`), counted whether or not they block. */
  waiting: number;
  /** Tiles set aside to check (#597), counted whether or not they block. */
  parked: number;
  /** Tiles that became copies — the copies a deletion keeps. */
  copies: number;
  /** Tiles discarded — the notes a deletion takes with it. */
  discarded: number;
}

export function batchDeletion(tiles: readonly DeletableTile[]): BatchDeletion {
  let waiting = 0;
  let parked = 0;
  let copies = 0;
  let discarded = 0;
  for (const t of tiles) {
    if (t.state === "consumed") copies += 1;
    else if (t.state === "discarded") discarded += 1;
    else if (t.state === "parked") parked += 1;
    else waiting += 1;
  }
  return {
    allowed: copies === 0 || (waiting === 0 && parked === 0),
    waiting,
    parked,
    copies,
    discarded,
  };
}

/**
 * Why a batch cannot be deleted, in one sentence — or null when it can. The same words on the
 * greyed-out button's hint and in the server's refusal, since both are answering the same question.
 */
export function batchDeletionRefusal(batchNo: number, deletion: BatchDeletion): string | null {
  if (deletion.allowed) return null;
  const open = [
    deletion.waiting > 0 && `${deletion.waiting} ${deletion.waiting === 1 ? "tile" : "tiles"} waiting`,
    deletion.parked > 0 && `${deletion.parked} set aside to check`,
  ].filter(Boolean);
  return (
    `Batch ${batchNo} still has ${open.join(" and ")}. Copies have been made from this card, so its ` +
    "scan can only be deleted once every tile on it has been dealt with."
  );
}
