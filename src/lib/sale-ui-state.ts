/**
 * A sale's remembered UI state (#2034): which of its sold sets are expanded on the sale's screen.
 *
 * The sets open collapsed — a sale with many of them was a long scroll every time it was opened —
 * and what the collector expands is remembered **per sale**, the way the purchase order remembers
 * its lots: coming back to a sale, after a reload or from another screen, shows the same sets open.
 * A sale never opened before has no entry and shows them all collapsed.
 *
 * Stored through the same one-entry-per-record, most-recently-used index as the purchase order's
 * state (`@/lib/purchase-ui-state` has the reasoning: no TTL, a count cap and a byte cap together).
 * An entry here is only a list of line ids — a sale of thirty sets is under 2 KB — so the budget is
 * far smaller than the order's, and the count is the cap that bites.
 *
 * Pure, so it tests without a DOM; the storage half is `sales/[saleId]/sale-line-expansion.ts`.
 */

/** Sales kept before the least-recently-used one is dropped. */
export const MAX_SALE_ENTRIES = 50;

/** Byte budget for all sale entries together — a small slice of the ~5 MB origin quota. */
export const MAX_SALE_BYTES = 300_000;

export interface SaleUiState {
  /** Expanded sold sets, by sale line id. */
  lines: string[];
}

export const EMPTY_SALE_UI_STATE: SaleUiState = Object.freeze({ lines: [] }) as SaleUiState;

/** Read a stored entry, tolerating anything: a malformed one reads as *no stored state*, which is
 * every set collapsed — the screen's own default. */
export function parseSaleUiState(raw: string | null): SaleUiState {
  if (!raw) return EMPTY_SALE_UI_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SALE_UI_STATE;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_SALE_UI_STATE;
  const lines = (parsed as Record<string, unknown>).lines;
  if (!Array.isArray(lines)) return EMPTY_SALE_UI_STATE;
  return { lines: lines.filter((x): x is string => typeof x === "string") };
}

/** The entry to store for `state`, or null when it is the default (nothing expanded) — such an
 * entry is removed rather than stored, so a sale merely opened never takes one of the slots. */
export function serializeSaleUiState(state: SaleUiState): string | null {
  return state.lines.length === 0 ? null : JSON.stringify({ lines: state.lines });
}
