// Michel's rule for the ⊠ prices of stamps still valid for postage (#2358), part of the *Michel*
// valuation method since #2375.
//
// Michel prints no on-cover price for a stamp that can still frank a letter, and says how to value
// one instead: **at least 0.40, or about 20 % above the used price, but no more than the
// never-hinged price when that is above 0.40**. Where a still-valid stamp has no price in the
// condition the Michel method maps as cover EF, MeF or MiF, the method works one out from the
// conditions it maps as *used* and *never hinged*. The figure is the method's working, shown as
// derived in a cover's windows only — never written to the stamp's prices or shown on the grid.
//
// Pure — no Prisma, no `server-only`.

/** The floor, in the catalogue edition's own currency — as Michel quotes it. A figure of the rule,
 *  not a setting. */
export const STILL_VALID_FLOOR = 0.4;

/** The used price plus 20 %. */
export const STILL_VALID_MARKUP = 1.2;

/**
 * What the rule reads for one still-valid stamp: the conditions the Michel method maps as *used* and
 * *never hinged*. Only ever built when both are mapped — while either is not, the rule gives nothing
 * and the value says which role is not set up.
 */
export interface StillValidRule {
  usedConditionId: string;
  neverHingedConditionId: string;
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
 * What to store when the collector marks or unmarks an issue or an area: nothing of its own when what
 * it inherits already says so — so a later change above still reaches it — and the explicit value
 * otherwise. Unmarking an issue under a marked area stores `false`.
 */
export function stillValidMarkToStore(inherited: boolean, wanted: boolean): boolean | null {
  return wanted === inherited ? null : wanted;
}

/** The *Still valid for postage* field of an area's or an issue's Edit dialog (#2385): blank follows
 *  the parent, else yes or no. */
export type StillValidChoice = "" | "yes" | "no";

/** The field's choice for a stored mark — null is *same as parent*. */
export function stillValidChoiceOf(mark: boolean | null): StillValidChoice {
  return mark === null ? "" : mark ? "yes" : "no";
}

/** What the Edit dialog stores for a choice (#2385): yes or no only where it differs from what the
 *  parent says — {@link stillValidMarkToStore} — and nothing for *same as parent*. */
export function stillValidChoiceToStore(choice: StillValidChoice, inherited: boolean): boolean | null {
  return choice === "" ? null : stillValidMarkToStore(inherited, choice === "yes");
}

/** What *same as parent* resolves to, and the nearest area that says so — null when none does and
 *  the stamps are not still valid. */
export interface InheritedStillValid {
  valid: boolean;
  areaName: string | null;
}

/** The *same as parent* choice, naming what it resolves to and from where (#2385): *Same as parent
 *  (yes, from Germany)*. */
export function stillValidInheritedLabel(lead: string, inherited: InheritedStillValid): string {
  const answer = inherited.valid ? "yes" : "no";
  return `${lead} (${inherited.areaName ? `${answer}, from ${inherited.areaName}` : answer})`;
}
