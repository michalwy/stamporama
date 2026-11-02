import type { Franking, ValuationMethod } from "./piece-valuation";
import { isFranking, isValuationMethod } from "./piece-valuation";

// The value of a **piece** — a copy carrying several stamps (ADR-0044), or one on a format of kind
// *On cover* or *On piece* — the pure half of what a copy row hands the valuation (#2359; ADR-0076).
// The rules a piece is valued by are `piece-valuation.ts`; `item-valuation.ts` reads the prices they
// need. Before #2359 such a copy was valued at a figure the collector recorded on it (#747); those
// figures are amount modifiers now (`piece-value-conversion.ts`).
// The prices each stamp on a piece is read at, and the terms the figure is made of, are carried on
// the piece's own valuation (`PieceValuation.components` / `terms`, #2353) — read where the rule reads
// them, so the Valuation window cannot list a price the value did not use.

/** What `ValuationRow.copy` carries for a copy: what decides whether it is a piece, and how one is
 *  valued. Whether its format makes it a piece is read by `valuateItemRows`, which knows the kinds. */
export interface PieceCopyInput {
  itemId: string;
  stampCount: number;
  franking: Franking;
  /** The copy's own method (#2359), or null to follow its area. */
  method: ValuationMethod | null;
  /**
   * The stamps on a piece **not yet written** — the identification step's preview (#2353), valued
   * before the copy exists. Absent for a copy, whose entries are read from the database; `itemId` is
   * then only the key they are filed under.
   */
  draftEntries?: readonly DraftPieceEntry[];
}

/** One stamp on a piece not yet written, as the identification step holds it (#2353). */
export interface DraftPieceEntry {
  stampId: string;
  quantity: number;
  /** The entry's format; null is the single. */
  formatId: string | null;
}

/** The columns {@link pieceCopyOf} reads beside the copy's `id`, which every caller selects anyway —
 *  spread into a copy's `select`. Scalars only, so a caller's own `format` or `stamps` select is never
 *  overridden. */
export const PIECE_COPY_SELECT = {
  stampCount: true,
  franking: true,
  valuationMethod: true,
} as const;

/** A copy's `ValuationRow.copy`. A value the database CHECKs keep valid is read back defensively. */
export function pieceCopyOf(row: {
  id: string;
  stampCount: number;
  franking: string;
  valuationMethod: string | null;
}): PieceCopyInput {
  return {
    itemId: row.id,
    stampCount: row.stampCount,
    franking: isFranking(row.franking) ? row.franking : "rate_correct",
    method: isValuationMethod(row.valuationMethod) ? row.valuationMethod : null,
  };
}
