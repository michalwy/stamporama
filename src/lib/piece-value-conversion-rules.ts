import { baseValueOf } from "./catalog-price";
import { modifyValue, type ValueModifier } from "./valuation";

// Moving a piece's recorded value (#747) onto an amount modifier (#2357) — the pure half of
// `piece-value-conversion.ts` (#2359).
//
// Before #2359 a piece was valued at the figure the collector recorded on it, adjusted by the copy's
// modifier (its amount in the recorded figure's currency). Now it is valued by its method, in the
// collection currency. So that no piece's value changes on the day, the modifier's amount takes up the
// difference: the new amount is whatever makes `computed × (1 + percent) + amount` equal what the
// piece was worth before, converted to the collection currency. The percentage and the note stay.

/** The modifier a piece carries after the move, or why it cannot be moved. */
export type ConversionResult =
  | { status: "moved"; modifier: ValueModifier | null }
  /** The recorded figure has no rate to the collection currency, so its worth there is unknown. */
  | { status: "unconvertible" }
  /** The method prices nothing on the piece, and a modifier adjusts a figure — it cannot stand in
   *  for one (#2357). */
  | { status: "unpriced" };

export function convertRecordedValue(input: {
  recorded: { amount: number; currency: string };
  modifier: ValueModifier | null;
  /** The piece's value by its method, before any modifier, in the collection currency. */
  computedBase: number | null;
  baseCurrency: string;
  rates: Map<string, number | null>;
}): ConversionResult {
  const { recorded, modifier, computedBase, baseCurrency, rates } = input;
  if (computedBase === null) return { status: "unpriced" };
  // What the piece was worth: the recorded figure adjusted by the modifier, in its own currency.
  const before = baseValueOf(
    modifyValue(recorded.amount, modifier),
    recorded.currency,
    baseCurrency,
    rates
  );
  if (before === null) return { status: "unconvertible" };
  const factor = 1 + (modifier?.percent ?? 0) / 100;
  const cents = Math.round((before - computedBase * factor) * 100);
  const amount = cents === 0 ? null : (cents / 100).toFixed(2);
  const percent = modifier?.percent ?? null;
  if (amount === null && percent === null) return { status: "moved", modifier: null };
  return { status: "moved", modifier: { percent, amount, note: modifier?.note ?? null } };
}
