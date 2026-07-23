// Collectors enter decimal amounts (prices, catalog values, exchange rates, shipping, …) and
// expect both "," and "." to work as the decimal separator, regardless of their OS/browser
// locale (#233). These fields never carry thousands grouping, so a lone separator is all we
// support: a comma is simply treated as a period.

/**
 * Canonicalise a user-entered decimal string so `Number()` parses it: every comma becomes a
 * period. Nothing else is stripped — a genuinely malformed value (letters, two separators) is
 * left to fail `Number.isFinite` downstream. Safe to run server-side on `FormData` values.
 */
export function normalizeDecimalInput(raw: string): string {
  return raw.replace(/,/g, ".");
}

/**
 * Live-sanitise a value as it is typed in a numeric field: commas become periods and everything
 * that isn't a digit or the (first) decimal point is dropped. Keeps input hygiene equivalent to
 * the old native `type="number"` (no letters, one separator) while accepting either separator.
 * Negative signs are intentionally removed — every such field in the app is a non-negative amount.
 */
export function sanitizeDecimalInput(raw: string): string {
  let out = "";
  let seenDot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if ((ch === "." || ch === ",") && !seenDot) {
      out += ".";
      seenDot = true;
    }
  }
  return out;
}
