// A copy's value lowered by a percentage typed on it, for its faults (#1560) — the words and the
// input. Pure, so the copy dialog, bulk edit and every surface printing a reduced figure share them.
//
// The arithmetic is `reduceForFaults` / `applyFaultReduction` in `valuation.ts`, applied once inside
// `valuateItemRows` so that no reader can value a faulty piece at full. The percentage lives on the
// copy, never on a fault in the dictionary (#1557): a percentage per fault, multiplied or the largest
// taken, was considered and rejected with the collector.

/** The note a reduced figure carries: *−40 % for faults*. */
export function faultReductionNote(percent: number): string {
  return `−${percent} % for faults`;
}

/**
 * The hint on a reduced figure: the full one, then the note — *45.00 EUR, −40 % for faults*. The
 * reduced figure itself is what the surface prints; this says what it was lowered from.
 */
export function faultReductionHint(
  fullAmount: string,
  currency: string | null,
  percent: number
): string {
  return `${currency ? `${fullAmount} ${currency}` : fullAmount}, ${faultReductionNote(percent)}`;
}

/**
 * The hint on a **total** some of whose copies were reduced: how many, and the figure without the
 * reductions. Null when none was, so the caller adds nothing.
 */
export function faultReducedTotalHint(
  reducedCount: number,
  totalBaseAmount: string,
  reductionBaseAmount: string,
  /** Null where the surface prints its amounts with no currency beside them. */
  baseCurrency: string | null
): string | null {
  if (reducedCount === 0) return null;
  const full = (Number(totalBaseAmount) + Number(reductionBaseAmount)).toFixed(2);
  const copies = reducedCount === 1 ? "1 copy" : `${reducedCount} copies`;
  const figure = baseCurrency ? `${full} ${baseCurrency}` : full;
  return `${copies} lowered for faults — ${figure} without the reductions`;
}

/**
 * Read the percentage off a form field. **Blank, or 0, is no reduction** — one spelling for "none",
 * which is also what the column's CHECK expects. Otherwise a whole number from 1 to 100; a `%` typed
 * after it is accepted.
 */
export function parseFaultReductionInput(
  raw: string
): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(/\s*%$/, "");
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: "The value reduction must be a whole percentage." };
  }
  const n = Number(trimmed);
  if (n > 100) return { ok: false, message: "The value reduction cannot exceed 100 %." };
  return { ok: true, value: n === 0 ? null : n };
}
