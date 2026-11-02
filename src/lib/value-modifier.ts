import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import type { ValueModifier } from "./valuation";

// A copy's catalogue value adjusted on the copy (#2357) — the words and the input. Pure, so the copy
// dialog, bulk edit and every surface printing a modified figure share them.
//
// The arithmetic is `modifyValue` / `applyValueModifier` in `valuation.ts`, applied once inside
// `valuateItemRows`, **before** the fault reduction (#1560), which stays its own field:
// catalogue value × (1 + percent / 100) + amount, never below zero, then the faults. The amount has no
// currency of its own — it is in the currency of the figure it adjusts, the catalogue edition the copy
// is valued from.

/** The largest amount `DECIMAL(10, 2)` holds. */
const MAX_AMOUNT = 99_999_999.99;

/** A signed number with a real minus sign: *+200*, *−3.50*. */
function signed(n: number, digits: number): string {
  const abs = Math.abs(n).toFixed(digits);
  return n < 0 ? `−${abs}` : `+${abs}`;
}

/**
 * The modifier as a figure carries it: *+200 %*, *+5.00 EUR*, *+200 % +5.00 EUR*. The currency is the
 * figure's own; null where the surface prints amounts with none beside them.
 */
export function valueModifierLabel(
  modifier: Pick<ValueModifier, "percent" | "amount">,
  currency: string | null
): string {
  const parts: string[] = [];
  if (modifier.percent !== null) parts.push(`${signed(modifier.percent, 0)} %`);
  if (modifier.amount !== null) {
    const amount = signed(Number(modifier.amount), 2);
    parts.push(currency ? `${amount} ${currency}` : amount);
  }
  return parts.join(" ");
}

/**
 * The hint on a modified figure: the catalogue's, then the modifier with its note — *Catalogue
 * 10.00 EUR, +200 % (Stempel Danzig)*. The modified figure itself is what the surface prints.
 */
export function valueModifierHint(
  fullAmount: string,
  currency: string | null,
  modifier: ValueModifier
): string {
  const full = currency ? `${fullAmount} ${currency}` : fullAmount;
  const note = modifier.note ? ` (${modifier.note})` : "";
  return `Catalogue ${full}, ${valueModifierLabel(modifier, currency)}${note}`;
}

/**
 * Read the modifier off a form's three fields. **Blank, or 0, is none** for the percentage and the
 * amount alike — one spelling for "none", which the columns' CHECKs expect — and with neither the
 * modifier is null and the note goes with it. The percentage is a whole number from −100 up (a `%`
 * typed after it is accepted); the amount is the shared decimal input's (commas, arithmetic), and may
 * be negative.
 */
export function parseValueModifierInput(
  percentRaw: string,
  amountRaw: string,
  noteRaw: string
): { ok: true; value: ValueModifier | null } | { ok: false; message: string } {
  let percent: number | null = null;
  const p = percentRaw.trim().replace(/\s*%$/, "").replace(/^\+/, "").replace(/^−/, "-");
  if (p) {
    if (!/^-?\d+$/.test(p)) {
      return { ok: false, message: "The value modifier's percentage must be a whole number." };
    }
    const n = Number(p);
    if (n < -100) {
      return { ok: false, message: "The value modifier cannot take off more than 100 %." };
    }
    percent = n === 0 ? null : n;
  }

  let amount: string | null = null;
  const a = normalizeDecimalInput(amountRaw.trim().replace(/^\+/, "").replace(/^−/, "-"));
  if (a) {
    const n = Number(a);
    if (!Number.isFinite(n)) {
      return { ok: false, message: "The value modifier's amount must be a number." };
    }
    if (Math.abs(n) > MAX_AMOUNT) {
      return { ok: false, message: "The value modifier's amount is too large." };
    }
    const rounded = roundAmount(n);
    amount = Number(rounded) === 0 ? null : rounded;
  }

  if (percent === null && amount === null) return { ok: true, value: null };
  const note = noteRaw.trim();
  return { ok: true, value: { percent, amount, note: note || null } };
}

/** A value modifier (#2357) is refused here with a sentence rather than by the columns' CHECKs as a
 *  failed save: a percentage below −100, or a modifier that changes nothing. Absent is not checked. */
export function assertValueModifier(modifier: ValueModifier | null | undefined): void {
  if (!modifier) return;
  if (modifier.percent !== null && (!Number.isInteger(modifier.percent) || modifier.percent < -100)) {
    throw new Error("The value modifier's percentage must be a whole number from −100 up.");
  }
  if (modifier.percent === 0 || (modifier.amount !== null && Number(modifier.amount) === 0)) {
    throw new Error("A value modifier of zero is no modifier — leave it blank.");
  }
  if (modifier.percent === null && modifier.amount === null) {
    throw new Error("A value modifier needs a percentage or an amount.");
  }
}

/** The three columns a {@link ValueModifier} is stored in — null in all three for none. */
export function valueModifierColumns(modifier: ValueModifier | null) {
  return {
    valueModifierPercent: modifier?.percent ?? null,
    valueModifierAmount: modifier?.amount ?? null,
    valueModifierNote: modifier ? (modifier.note ?? null) : null,
  };
}

/**
 * The bulk edit's line under *Value modifier*: how many of the picked copies carry one **today**,
 * worded for one copy and for many — the fault reduction's wording (#1930).
 */
export function describeValueModifierState(modified: number, count: number): string {
  if (count === 1) return modified === 0 ? "It has no modifier yet." : "It already has a modifier.";
  if (modified === 0) return "None has a modifier yet.";
  if (modified === count) return `All ${count} have a modifier.`;
  return `${modified} of ${count} ${modified === 1 ? "has" : "have"} a modifier.`;
}
