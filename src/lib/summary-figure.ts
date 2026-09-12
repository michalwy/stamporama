// **A summary figure that has nothing behind it** (#1184).
//
// Every money figure on the holdings summary bar is an aggregate over a set of copies: catalogue
// value over the ones that are priced, market value over the ones with auction evidence, purchase
// cost over the ones whose cost basis has been frozen, the write-off over the ones that are gone.
// When no copy contributes, the sum is `0` — and `0.00 PLN` then gets printed for what is really
// *nothing has been worked out yet*, which is the most alarming of the readings available: the
// panel says the parcel is worth nothing and cost nothing. The grey sentence beside it counts what
// is missing and is right, but it is the small half, and the figure is what the eye takes.
//
// `−0.00 PLN` on the write-off row is the clearest symptom. No quantity anything could hold
// produces it, so it can only be an absence being formatted as a number.
//
// So the decision is made once, here, in the only terms all of those figures share: **how many
// copies are behind the figure, and how many it could say nothing about**. Pure and unit-testable
// on purpose — the three cases it has to keep apart are exactly the ones no rendering check could
// tell apart by eye:
//
//   unknown   nothing contributed and something was meant to. No amount is stated at all.
//   partial   some contributed and some did not. The amount **is** stated — a figure over part of
//             the copies is useful as long as it is not passed off as complete, and the note beside
//             it already says how much is missing.
//   complete  everything in scope contributed. Includes the **empty scope**: with nothing to work
//             out, zero is the honest answer rather than a placeholder, so a purchase with no
//             copies still reads `0.00` rather than claiming a pending calculation.
//
// **A real zero therefore survives**, and reads differently from an absence: only the counts
// separate a scope whose copies genuinely add to nothing from one whose figures were never
// computed, and nothing else on the row could.

/** How much of the scope is behind a figure. See the module header for what each state prints. */
export type FigureState = "unknown" | "partial" | "complete";

export interface StatedFigure {
  state: FigureState;
  /** The amount to print, 2 dp; `null` exactly when {@link state} is `"unknown"`. */
  amount: string | null;
}

/** What the screen says in place of an amount it has not got. The collector's terms, not the
 * engine's: the figure is not *unavailable* or *null*, it simply has not been worked out yet. */
export const NOT_WORKED_OUT = "not worked out yet";

/**
 * An amount as it may be shown — never as a negative zero.
 *
 * `-0.00` arrives from the ordinary rounding of a tiny negative, and from `(-0).toFixed(2)`; it is
 * not a quantity, and printing it is how an absence announces itself as a number.
 */
function plainAmount(amount: string): string {
  return Number(amount) === 0 ? "0.00" : amount;
}

/**
 * How to state one aggregate figure.
 *
 * @param amount   the computed sum, 2-dp string, as the read model already states it
 * @param behind   copies that contributed to it
 * @param missing  copies in the same scope that could not
 */
export function stateFigure(amount: string, behind: number, missing: number): StatedFigure {
  if (behind === 0 && missing > 0) return { state: "unknown", amount: null };
  return { state: missing > 0 ? "partial" : "complete", amount: plainAmount(amount) };
}

/**
 * How to state a figure that is the **difference** of others — a return against a spend.
 *
 * A difference against an absence is not a smaller figure, it is no figure: subtracting a cost
 * nobody has worked out yet states the whole of the proceeds as profit, and subtracting proceeds
 * nobody could attribute states the whole of the spend as a loss. So both sides have to be stated
 * before the difference is, and it inherits the weaker of their states.
 */
export function differenceFigure(amount: string, sides: StatedFigure[]): StatedFigure {
  if (sides.some((side) => side.state === "unknown")) return { state: "unknown", amount: null };
  return {
    state: sides.some((side) => side.state === "partial") ? "partial" : "complete",
    amount: plainAmount(amount),
  };
}

/**
 * A figure stated as a deduction: `−12.00`, and `0.00` — never `−0.00` — when there is none. The
 * minus is the typographic one (U+2212), as every signed figure on the bar uses.
 *
 * **The sign is computed, never concatenated**, and that is the whole of the fix: the write-off row
 * printed `−${amount}`, which turns a `0.00` it was handed into a quantity nothing could hold.
 * Negating first makes the case disappear rather than needing a guard — `toFixed` never signs a
 * zero, `-0` included — so there is no branch here that a test could fail on, by construction.
 */
export function negatedAmount(amount: string): string {
  const value = -Number(amount);
  return value < 0 ? `−${Math.abs(value).toFixed(2)}` : value.toFixed(2);
}

/** A figure whose direction is the point: `+120.00` / `−12.00`, the sign always printed. Zero takes
 * `+0.00` — a delta of nothing went neither way — and never `−0.00`, on {@link negatedAmount}'s
 * reasoning: `-0` is not `< 0`, so it takes the plus like any other zero. */
export function signedAmount(amount: string): string {
  const value = Number(amount);
  return value < 0 ? `−${Math.abs(value).toFixed(2)}` : `+${value.toFixed(2)}`;
}
