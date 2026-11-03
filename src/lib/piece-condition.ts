import { isPiece, type PieceKind } from "./piece-valuation";

// The pure half of `item-condition.ts` (#2383; ADR-0079): whether a copy in a given shape takes a
// condition at all. A piece does not — it carries several stamps, or one on a format with a kind.

/** Whether a copy of `stampCount` stamps in a format of `formatKind` takes a condition. */
export function takesCondition(stampCount: number, formatKind: PieceKind | null): boolean {
  return !isPiece(stampCount, formatKind);
}

/** The Copies list's condition filter value matching the copies with **no condition** — the pieces
 *  — so filtering by condition never hides them for good. Spelled like the certificate axis's
 *  `"none"`, and the key `countItemsByCondition` counts them under. */
export const NO_CONDITION = "none";

/** A copy read with its condition, known to have one — a loose stamp, never a piece. */
export type Conditioned<T> = T & {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
};

/**
 * The copy, typed as having a condition, or null for a piece (#2383). For the surfaces that are about
 * a stamp in a condition — pricing its catalogue cell, a quick price — which a piece never reaches:
 * its prices are its stamps' in the conditions its method maps.
 */
export function conditioned<
  T extends { conditionId: string | null; conditionName: string | null; conditionAbbreviation: string | null },
>(copy: T): Conditioned<T> | null {
  return copy.conditionId !== null && copy.conditionName !== null && copy.conditionAbbreviation !== null
    ? (copy as Conditioned<T>)
    : null;
}
