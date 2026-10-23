// What *Move copies to…* (#2123) says before anything moves: how many copies leave which lot of the
// source, and which of its lots stop the move because they are closed. Pure, so the confirmation
// and the refusal it shows can be checked without a screen; `moveCopiesToDocument` in `lots.ts` is
// the rule itself and re-checks all of it.

/** A lot of the source document, as the screen already holds it. */
export interface CopiesMoveSourceLot {
  id: string;
  label: string;
  status: string;
  itemCount: number;
}

export interface CopiesMoveSummary {
  /** Every copy that would move. */
  total: number;
  /** The lots holding copies, with how many each gives up, in screen order. */
  from: { label: string; count: number }[];
  /** The lots holding copies that are closed — each to be reopened before the move can run. */
  closed: string[];
}

/** The lots that hold copies decide everything: an empty lot, closed or not, gives nothing up and
 *  stands in nobody's way. */
export function summarizeCopiesMove(lots: readonly CopiesMoveSourceLot[]): CopiesMoveSummary {
  const holding = lots.filter((l) => l.itemCount > 0);
  return {
    total: holding.reduce((sum, l) => sum + l.itemCount, 0),
    from: holding.map((l) => ({ label: l.label, count: l.itemCount })),
    closed: holding.filter((l) => l.status !== "open").map((l) => l.label),
  };
}

/** Why the move cannot run while these lots are closed, and what to do — the dialog's notice and
 *  the server's refusal, in one wording. */
export function closedLotsMessage(closed: readonly string[]): string {
  return closed.length === 1
    ? `${closed[0]} is closed, so its cost is already split. Reopen it before moving its copies.`
    : `These lots are closed, so their cost is already split: ${closed.join(", ")}. Reopen them before moving their copies.`;
}

/** A document the dialog lists, by the fields its search reads. */
export interface CopiesMoveSearchable {
  ref: string;
  name: string | null;
  purchasedAt: string;
}

/** The documents whose number, name or date contain every word typed, case-insensitively — so
 *  `#12`, `allegro` and `2026-03` each find what the Intake documents list shows them as. */
export function filterCopiesMoveTargets<T extends CopiesMoveSearchable>(
  documents: readonly T[],
  query: string
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...documents];
  return documents.filter((d) => {
    const hay = `${d.ref} ${d.name ?? ""} ${d.purchasedAt}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
