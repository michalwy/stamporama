// Collectors enter decimal amounts (prices, catalog values, exchange rates, shipping, …) and
// expect both "," and "." to work as the decimal separator, regardless of their OS/browser
// locale (#233). These fields never carry thousands grouping, so a lone separator is all we
// support: a comma is simply treated as a period.
//
// The same fields also accept a **simple arithmetic expression** (#580) — `1+2`, `12.50*3`,
// `(4,20+1,80)/2` — so a collector summing a few item prices or applying a discount does not
// have to reach for a calculator. The expression is evaluated with a small hand-written parser
// (never `eval`), on blur in the field and again server-side on whatever arrives; anything that
// does not parse is passed through untouched and fails the caller's usual `Number.isFinite`
// check, exactly as any other unparseable amount does.

const OPERATOR_CHARS = "+-*/()";

/** Amounts here are money, percentages and exchange rates; `10/3` is rounded, not printed raw. */
const RESULT_DECIMALS = 6;

/**
 * Canonicalise a user-entered decimal string so `Number()` parses it: every comma becomes a
 * period, and an arithmetic expression is reduced to its result. Nothing else is stripped — a
 * genuinely malformed value (letters, two separators, an unbalanced parenthesis) is left to fail
 * `Number.isFinite` downstream. Safe to run server-side on `FormData` values.
 */
export function normalizeDecimalInput(raw: string): string {
  // Trimmed because an expression may be spaced (`12.50 + 7.50`) and the field therefore lets a
  // space through: `Number(" ")` is 0, which would turn a field holding nothing but spaces into a
  // real amount for any caller that doesn't trim first.
  const periods = raw.trim().replace(/,/g, ".");
  if (!hasOperator(periods)) return periods;
  const value = evaluateAmountExpression(periods);
  return value === null ? periods : formatAmountResult(value);
}

/**
 * Live-sanitise a value as it is typed in a numeric field: commas become periods and everything
 * that isn't a digit, a decimal point or an arithmetic character is dropped. Keeps input hygiene
 * close to the old native `type="number"` (no letters, one separator per number) while accepting
 * either separator and a whole expression. A leading `-` survives as an operator; a negative
 * result is rejected downstream like any other out-of-range amount.
 */
export function sanitizeDecimalInput(raw: string): string {
  let out = "";
  let seenDot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (ch === "." || ch === ",") {
      // One separator per number, not per field: `1.5+2.5` is two well-formed operands.
      if (!seenDot) {
        out += ".";
        seenDot = true;
      }
    } else if (OPERATOR_CHARS.includes(ch) || ch === " ") {
      out += ch;
      seenDot = false;
    }
  }
  return out;
}

/** True when the value looks like an expression rather than a plain number. */
export function hasOperator(value: string): boolean {
  return [...value].some((ch) => OPERATOR_CHARS.includes(ch));
}

/**
 * Evaluate `+ - * / ( )` over decimal literals. Returns `null` for anything malformed — an empty
 * value, a stray character, an unbalanced parenthesis, a division by zero — so callers can leave
 * the collector's text alone and let it fail validation as typed.
 */
export function evaluateAmountExpression(raw: string): number | null {
  const input = raw.replace(/,/g, ".");
  let pos = 0;

  const skipSpace = () => {
    while (input[pos] === " ") pos++;
  };

  const parseNumber = (): number | null => {
    const start = pos;
    while (pos < input.length && input[pos] >= "0" && input[pos] <= "9") pos++;
    if (input[pos] === ".") {
      pos++;
      while (pos < input.length && input[pos] >= "0" && input[pos] <= "9") pos++;
    }
    const text = input.slice(start, pos);
    if (text === "" || text === ".") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  };

  // factor := ('+' | '-')* ( '(' expr ')' | number )
  const parseFactor = (): number | null => {
    skipSpace();
    const ch = input[pos];
    if (ch === "+" || ch === "-") {
      pos++;
      const inner = parseFactor();
      if (inner === null) return null;
      return ch === "-" ? -inner : inner;
    }
    if (ch === "(") {
      pos++;
      const inner = parseExpr();
      if (inner === null) return null;
      skipSpace();
      if (input[pos] !== ")") return null;
      pos++;
      return inner;
    }
    return parseNumber();
  };

  // term := factor (('*' | '/') factor)*
  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      skipSpace();
      const op = input[pos];
      if (op !== "*" && op !== "/") return left;
      pos++;
      const right = parseFactor();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
  };

  // expr := term (('+' | '-') term)*
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      skipSpace();
      const op = input[pos];
      if (op !== "+" && op !== "-") return left;
      pos++;
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };

  const result = parseExpr();
  skipSpace();
  if (result === null || pos !== input.length) return null;
  return Number.isFinite(result) ? result : null;
}

/**
 * Print an evaluated result as a plain decimal string: rounded to a sane number of places, with
 * the trailing zeros `toFixed` adds dropped, so `0.1+0.2` reads `0.3` and `10/3` reads `3.333333`.
 */
export function formatAmountResult(value: number): string {
  return String(Number(value.toFixed(RESULT_DECIMALS)));
}
