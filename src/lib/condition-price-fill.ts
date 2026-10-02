// Filling one condition's prices from another's, by a factor (#1529).
//
// Catalogues often price a set's stamps one by one in one condition only (say MNH) and give just the
// whole set's price in another (MH). The collector then works each stamp's MH price out by hand as
// *stamp MNH × set MH ÷ set MNH*, cell by cell. The variant price grid (#618) does that sum for every
// empty cell of a chosen target condition at once. The rule lives here, pure, so the unit suite can
// hold it — it is #1242's certificate fill (`certificate-price-fill.ts`) with the percentage replaced
// by a factor the collector states on the spot:
//
// - **The factor is two set prices or typed directly.** Set prices give `target ÷ source`; a typed
//   factor is a number (`0.333`) or a percentage (`33.3%`). Both are held as an exact fraction, so a
//   set of MNH 30 and MH 10 is one third exactly and not the double nearest 0.333.
// - **A factor of zero or less, or a set price of zero, is refused** — nothing is filled from it.
// - **Only an empty cell is filled.** A figure already there may be the catalogue's own price.
// - **A cell with no source price is left alone.**
// - **Half up, to the cent**, as a typed amount is (#1231).
//
// It is a one-time copy: what it produces is an ordinary price, and the set prices are not stored.

import { formatAmountInput, normalizeDecimalInput } from "./decimal-input";

/** A factor as an exact positive fraction. */
export type PriceFactor = { numerator: bigint; denominator: bigint };

export type PriceFactorParse = { ok: true; factor: PriceFactor } | { ok: false; message: string };

const FACTOR_REFUSED = "The factor must be greater than zero.";

/** An amount as its field shows it (#1231), in whole cents, or null when it is not an amount. */
function amountCents(raw: string): bigint | null {
  const match = /^(\d+)\.(\d{2})$/.exec(formatAmountInput(raw.trim()));
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt(match[2]);
}

/**
 * The factor two set prices give: `target ÷ source` — a set of MNH 30 and MH 10 fills MH at one
 * third of MNH. A blank set price is not an answer yet; a zero one is refused, since a zero source
 * divides by nothing and a zero target would fill every cell with zero.
 */
export function factorFromSetPrices(source: string, target: string): PriceFactorParse {
  if (source.trim() === "" || target.trim() === "") {
    return { ok: false, message: "Enter the set's price in both conditions." };
  }
  const from = amountCents(source);
  const to = amountCents(target);
  if (from === null || to === null) {
    return { ok: false, message: "Enter each set price as an amount, such as 30.00." };
  }
  if (from === BigInt(0) || to === BigInt(0)) {
    return { ok: false, message: "A set price of zero gives no factor." };
  }
  return { ok: true, factor: { numerator: to, denominator: from } };
}

/**
 * A factor as typed: a number (`0.333`, `0,5`, `1/3`) or a percentage (`33.3%`). An expression is
 * evaluated as an amount field evaluates one (#580), so `10/30` is accepted too — at the six places
 * that evaluation keeps. Zero and below are refused.
 */
export function parsePriceFactor(raw: string): PriceFactorParse {
  // A leading `×` is how the grid prints a factor, so typing one back is accepted.
  let text = raw.trim().replace(/^[×x]\s*/i, "");
  if (text === "") return { ok: false, message: "Enter a factor, such as 0.333, or a percentage." };
  const percent = text.endsWith("%");
  if (percent) text = text.slice(0, -1).trim();
  const normalized = normalizeDecimalInput(text);
  const match = /^(\d*)(?:\.(\d*))?$/.exec(normalized);
  if (!match || normalized === "" || normalized === ".") {
    const value = Number(normalized);
    if (Number.isFinite(value) && value <= 0) return { ok: false, message: FACTOR_REFUSED };
    return {
      ok: false,
      message: "Enter the factor as a number, such as 0.333, or a percentage, such as 33.3%.",
    };
  }
  const [, whole, fraction = ""] = match;
  const numerator = BigInt(`${whole}${fraction}` || "0");
  let denominator = BigInt(10) ** BigInt(fraction.length);
  if (percent) denominator *= BigInt(100);
  if (numerator === BigInt(0)) return { ok: false, message: FACTOR_REFUSED };
  return { ok: true, factor: { numerator, denominator } };
}

/**
 * The source amount times the factor, to the cent, rounded half up: `30.00` at one third → `10.00`,
 * `1.00` at one third → `0.33`, `0.05` at ×1.1 → `0.06`. Null when the source is not a price.
 *
 * Worked in whole cents over the exact fraction, so neither the factor nor the product ever passes
 * through a double.
 */
export function scaledPrice(source: string, factor: PriceFactor): string | null {
  const cents = amountCents(source);
  if (cents === null) return null;
  const two = BigInt(2);
  const result = (two * cents * factor.numerator + factor.denominator) / (two * factor.denominator);
  const text = result.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/**
 * What the fill writes into one target cell, or null when it leaves the cell as it is: the cell
 * already holds something, or the same stamp has no price in the source condition.
 */
export function fillConditionCell(cell: {
  source: string;
  current: string;
  factor: PriceFactor;
}): string | null {
  if (cell.current.trim() !== "") return null;
  if (cell.source.trim() === "") return null;
  return scaledPrice(cell.source, cell.factor);
}

/**
 * Every cell one press fills, over the rows on screen in their order: a **locked** umbrella row is
 * skipped as Tab skips it (#627), and every other row is {@link fillConditionCell}'s answer for its
 * source and target cells — which the caller reads off the grid's chosen edition, certificate and
 * format tab.
 */
export function planConditionFill(input: {
  rows: { stampId: string; locked: boolean }[];
  source: (stampId: string) => string;
  current: (stampId: string) => string;
  factor: PriceFactor;
}): { stampId: string; value: string }[] {
  const fills: { stampId: string; value: string }[] = [];
  for (const row of input.rows) {
    if (row.locked) continue;
    const value = fillConditionCell({
      source: input.source(row.stampId),
      current: input.current(row.stampId),
      factor: input.factor,
    });
    if (value !== null) fills.push({ stampId: row.stampId, value });
  }
  return fills;
}

/**
 * A factor as the grid prints it before filling: `×0.333`, `×0.5`, `×1.2`. Three decimals at most
 * from one up, three significant digits below it — so a small factor does not print as `×0`. It is a
 * label only; the fill itself uses the exact fraction.
 */
export function formatPriceFactor(factor: PriceFactor): string {
  const value = Number(factor.numerator) / Number(factor.denominator);
  const text = new Intl.NumberFormat("en-US", {
    useGrouping: false,
    ...(value >= 1 ? { maximumFractionDigits: 3 } : { maximumSignificantDigits: 3 }),
  }).format(value);
  return `×${text}`;
}
