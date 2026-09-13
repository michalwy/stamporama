// Filling certificate prices from the plain price (#1242).
//
// Catalogues often print one price per condition, which goes into the no-certificate column, and a
// certified copy is worth that price times a proportion the collector sets once per certificate
// status (signature 110%, guarantee 120%, photo attest 150%). Both catalogue value grids — the stamp
// editor's Prices tab and the variant price grid (#618) — offer one press that copies the plain price
// into the certificate cells at that percentage. The rule lives here, pure, so both grids apply it
// identically and the unit suite can hold it:
//
// - **Only an empty cell is filled.** A figure already there may be the catalogue's own printed
//   certificate price, and replacing it silently would lose it.
// - **A status with no percentage is left empty** — the fill never assumes 100%.
// - **A row with no plain price is left alone.**
// - **Half up, to the cent**, as a typed amount is (#1231).
//
// It is a one-time copy: what it produces is an ordinary price, and nothing links it to the plain
// price afterwards.

import { formatAmountInput } from "./decimal-input";

/** The lowest and highest percentage a certificate status may carry. */
export const PRICE_PERCENT_MIN = 1;
export const PRICE_PERCENT_MAX = 10000;

export type PricePercentParse =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * Read a status's percentage as typed. A blank is **no percentage** (null), which is a valid answer:
 * the status is then left out of the fill. Anything else must be a whole number in range.
 */
export function parsePricePercent(raw: string): PricePercentParse {
  const text = raw.trim().replace(/%$/, "").trim();
  if (text === "") return { ok: true, value: null };
  const value = Number(text.replace(/,/g, "."));
  if (!Number.isInteger(value) || value < PRICE_PERCENT_MIN || value > PRICE_PERCENT_MAX) {
    return {
      ok: false,
      message: `Enter the percentage as a whole number from ${PRICE_PERCENT_MIN} to ${PRICE_PERCENT_MAX}, or leave it empty.`,
    };
  }
  return { ok: true, value };
}

/**
 * The plain amount at `percent`, to the cent, rounded half up: `1600.00` at 120 → `1920.00`,
 * `1.25` at 110 → `1.38`. Null when the plain amount is not a price.
 *
 * Worked in whole cents rather than on a double, so `x.xx5` rounds up as written rather than as the
 * nearest binary fraction happens to fall. The plain amount is taken as its field shows it — two
 * decimal places (#1231) — which is what the collector reads off the grid before pressing.
 */
export function certificatePrice(plain: string, percent: number): string | null {
  const shown = formatAmountInput(plain.trim());
  const match = /^(\d+)\.(\d{2})$/.exec(shown);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(match[2]);
  const scaled = cents * percent;
  if (!Number.isSafeInteger(scaled)) return null;
  const result = Math.floor((scaled + 50) / 100);
  const text = String(result).padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/**
 * What the fill writes into one certificate cell, or null when it leaves the cell as it is: the cell
 * already holds something, the status has no percentage, or the row has no plain price.
 */
export function fillCertificateCell(cell: {
  plain: string;
  current: string;
  percent: number | null;
}): string | null {
  if (cell.current.trim() !== "") return null;
  if (cell.percent === null) return null;
  if (cell.plain.trim() === "") return null;
  return certificatePrice(cell.plain, cell.percent);
}

/** A status's percentage as the grids print it beside the column: `120%`. */
export function formatPricePercent(percent: number): string {
  return `${percent}%`;
}
