import "server-only";
import type { DbTransaction } from "./db";
import { isPiece, isPieceKind } from "./piece-valuation";

// **A piece has no condition** (#2383; ADR-0079). A piece — a copy carrying several stamps, or one
// stamp on a format of kind on cover or on piece (`isPiece`) — is told by its franking and its
// faults; "MNH" on a posted cover means nothing, and since #2375 no price is read from it. A loose
// stamp always has one.
//
// So `Item.conditionId` is null **exactly** when the copy is a piece, and this module keeps it so.
// That makes the condition the flat column the held-copy predicates read (`NOT_PIECE` in
// `multi-stamp.ts`), as `stampCount` alone was before a one-stamp cover stopped counting: the
// counts stay a plain `where` rather than a join on the format's kind.
//
// The pure test is `takesCondition` (`piece-condition.ts`), for a form deciding whether to show the
// control. The condition is settled after every write that can change either side — a copy created (every path passes
// `createLeadingEntriesTx`), its stamps re-derived (`syncItemFromEntriesTx`), the copy edited
// (`updateItem`), a format given or relieved of a kind (`updateStampFormat`). **Becoming a piece
// clears the condition**; **ceasing to be one asks for it**, and a write that would leave a loose
// stamp with none is refused rather than guessed at.

export class ConditionRequiredError extends Error {
  constructor(count: number) {
    super(
      count === 1
        ? "A loose stamp needs a condition — choose one before saving."
        : `${count} copies would be loose stamps without a condition — give each one a condition first.`
    );
    this.name = "ConditionRequiredError";
  }
}

/**
 * Clear the condition of every piece among `itemIds` and refuse when a loose stamp among them has
 * none. Inside the caller's transaction, so the refusal rolls back the write that caused it.
 */
export async function settleCopyConditionsTx(
  tx: DbTransaction,
  itemIds: readonly string[]
): Promise<void> {
  if (itemIds.length === 0) return;
  const rows = await tx.item.findMany({
    where: { id: { in: [...new Set(itemIds)] } },
    select: { id: true, stampCount: true, conditionId: true, format: { select: { pieceKind: true } } },
  });
  const piece = (row: (typeof rows)[number]) => {
    const kind = row.format?.pieceKind;
    return isPiece(row.stampCount, isPieceKind(kind) ? kind : null);
  };
  const missing = rows.filter((row) => row.conditionId === null && !piece(row)).length;
  if (missing > 0) throw new ConditionRequiredError(missing);
  const clear = rows.filter((row) => row.conditionId !== null && piece(row)).map((row) => row.id);
  if (clear.length > 0) {
    await tx.item.updateMany({ where: { id: { in: clear } }, data: { conditionId: null } });
  }
}
