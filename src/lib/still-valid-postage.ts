// Michel's rule for the ⊠ prices of stamps still valid for postage (#2358).
//
// Michel prints no on-cover price for a stamp that can still frank a letter, and says how to value
// one instead: **at least 0.40, or about 20 % above the used price, but no more than the
// never-hinged price when that is above 0.40**. A still-valid stamp with no typed EF, MeF or MiF
// price (#2356) takes one from the rule — in place of a multiplier, since Michel prices these stamps
// by the rule and not by a ratio. Its on-piece price is left to its multiplier.
//
// Pure — no Prisma, no `server-only` — so the price grid, a client component, derives the same
// figure as the lists do on the server.

import type { CoverKind } from "./cover-kind";

/** The floor, in the catalogue edition's own currency — as Michel quotes it. A figure of the rule,
 *  not a setting. */
export const STILL_VALID_FLOOR = 0.4;

/** The used price plus 20 %. */
export const STILL_VALID_MARKUP = 1.2;

/** The prices the rule fills: the three frankings. On piece keeps its multiplier. */
export const STILL_VALID_COVER_KINDS: readonly CoverKind[] = ["cover_ef", "cover_mef", "cover_mif"];

export function isStillValidCoverKind(kind: CoverKind | null | undefined): boolean {
  return !!kind && STILL_VALID_COVER_KINDS.includes(kind);
}

/** The two roles a condition can play in the rule, chosen once for the collection under Settings →
 *  Conditions (`StampCondition.priceRole`). */
export const CONDITION_PRICE_ROLES = ["used", "never_hinged"] as const;

export type ConditionPriceRole = (typeof CONDITION_PRICE_ROLES)[number];

export function isConditionPriceRole(value: unknown): value is ConditionPriceRole {
  return typeof value === "string" && (CONDITION_PRICE_ROLES as readonly string[]).includes(value);
}

/**
 * What the rule needs for one still-valid stamp: which condition is *used* and which *never hinged*.
 * Only ever built when both are chosen — while either is not, the rule gives nothing and the price
 * stays missing. The rule writes its figure in the used condition's cell; the other conditions of
 * the cover tabs keep their multipliers.
 */
export interface StillValidRule {
  usedConditionId: string;
  neverHingedConditionId: string;
}

/** Both conditions, or null when either is unchosen. */
export function stillValidRuleOf(
  conditions: readonly { id: string; priceRole: string | null }[]
): StillValidRule | null {
  const used = conditions.find((c) => c.priceRole === "used");
  const neverHinged = conditions.find((c) => c.priceRole === "never_hinged");
  return used && neverHinged
    ? { usedConditionId: used.id, neverHingedConditionId: neverHinged.id }
    : null;
}

/**
 * The on-cover price of a still-valid stamp: the greater of {@link STILL_VALID_FLOOR} and the used
 * price plus 20 %, capped at the never-hinged price when that is above the floor. A never-hinged
 * price not on file caps nothing. Both prices are the same edition's, so the floor is in its
 * currency. Rounded to two decimals, as every derived price is.
 */
export function stillValidCoverPrice(used: number, neverHinged: number | null): number {
  const ruled = Math.max(STILL_VALID_FLOOR, used * STILL_VALID_MARKUP);
  const capped =
    neverHinged !== null && neverHinged > STILL_VALID_FLOOR ? Math.min(ruled, neverHinged) : ruled;
  return Math.round(capped * 100) / 100;
}

/**
 * Whether a stamp is still valid for postage: its issue's own mark when it has one, else the nearest
 * area — its primary area, then up the tree — that says either way. A tree that says nothing is not.
 */
export function resolveStillValid(
  issueMark: boolean | null,
  areaMarksNearestFirst: readonly (boolean | null)[]
): boolean {
  if (issueMark !== null) return issueMark;
  for (const mark of areaMarksNearestFirst) if (mark !== null) return mark;
  return false;
}

/**
 * What to store when the collector marks or unmarks an issue or an area from its ⋮ menu: nothing of
 * its own when what it inherits already says so — so a later change above still reaches it — and
 * the explicit value otherwise. Unmarking an issue under a marked area stores `false`.
 */
export function stillValidMarkToStore(inherited: boolean, wanted: boolean): boolean | null {
  return wanted === inherited ? null : wanted;
}
