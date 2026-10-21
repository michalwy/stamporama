// How a template placeholder writes an amount (#2028) or an internal number (#2097) — pure, no Prisma
// and no `server-only`, because the template editors are client components and flag a misspelt
// parameter while it is typed.
//
// Every placeholder that writes an amount takes a parameter after a colon choosing how the currency is
// written: `{price:symbol}` → `15 zł`, `{price:code}` → `15 PLN`, `{price:none}` → `15`. With none it
// writes the symbol — decided with the collector on 2026-10-18, a change from the code every amount was
// written with until then. The number itself is `generatedAmount`'s whatever the choice (#1787).
//
// Every placeholder that writes an **internal number** — an offer's, a sale's, a post's, a lot's —
// takes a padding parameter instead (#2097): `{offer:4}` → `0042`, a number wider than four digits
// written in full. With none it writes the plain number, as every internal number reads (#2096).
//
// A parameter on a placeholder that takes none, or one that is not a choice, makes the token not a
// placeholder: it is kept as typed and named under the field, a misspelt placeholder's rule.

import { currencySymbol } from "./currencies";
import { generatedAmount } from "./decimal-input";

/** How an amount placeholder writes the currency. */
export type CurrencyStyle = "symbol" | "code" | "none";

export const CURRENCY_STYLES: readonly CurrencyStyle[] = ["symbol", "code", "none"];

/** What an amount placeholder with no parameter writes (#2028). */
export const DEFAULT_CURRENCY_STYLE: CurrencyStyle = "symbol";

export function isCurrencyStyle(value: unknown): value is CurrencyStyle {
  return typeof value === "string" && (CURRENCY_STYLES as readonly string[]).includes(value);
}

/**
 * An amount as a generated text writes it: `15 zł`, `$10`, `15 PLN` or `15`. A currency with no symbol
 * in the table — a code stored before the pickers offered only the table's — is written with its code
 * under `symbol`, since an amount without its currency is not what was asked for.
 */
export function writtenAmount(amount: string, currency: string, style: CurrencyStyle): string {
  const number = generatedAmount(amount);
  if (style === "none") return number;
  const symbol = style === "symbol" ? currencySymbol(currency) : null;
  if (!symbol) return `${number} ${currency}`;
  return symbol.before ? `${symbol.symbol}${number}` : `${number} ${symbol.symbol}`;
}

/** The widest padding `:N` asks for: an internal number is a 32-bit integer, at most ten digits, so
 *  anything wider pads nothing that exists. */
export const MAX_NUMBER_PAD = 10;

/**
 * The digits `:N` pads to, or null when `parameter` is not a whole number from 1 to
 * {@link MAX_NUMBER_PAD}. Written as typed — `3`, never ` 3` or `03` — since it is part of a token.
 */
export function parseNumberPad(parameter: string): number | null {
  if (!/^[1-9]\d*$/.test(parameter)) return null;
  const pad = Number(parameter);
  return pad <= MAX_NUMBER_PAD ? pad : null;
}

/** An internal number as a template writes it: plain, or zero-padded to `pad` digits when a `:N`
 *  asks — never cut, so a number wider than `pad` is written in full. */
export function writtenNumber(no: number, pad: number | null = null): string {
  return pad === null ? String(no) : String(no).padStart(pad, "0");
}

/** The value of a placeholder that writes internal numbers (#2097): one, several — written with a
 *  comma between them, each padded alike — or none, which writes nothing. */
export interface TemplateNumbers {
  numbers: readonly number[];
}

/** {@link TemplateNumbers} for the numbers given, those that are missing left out. */
export function templateNumbers(...numbers: readonly (number | null | undefined)[]): TemplateNumbers {
  return { numbers: numbers.filter((n): n is number => n != null) };
}

function writtenNumbers(value: TemplateNumbers, pad: number | null): string {
  return value.numbers.map((no) => writtenNumber(no, pad)).join(", ");
}

/** A template token: `{name}`, or `{name:parameter}` — the parameter possibly misspelt or empty, so
 *  the editor can name it. */
export const TEMPLATE_TOKEN = /\{[A-Za-z]+(?::[A-Za-z0-9]*)?\}/g;

/** A token split into the placeholder it names (`{price}`) and its parameter, null where it has none. */
export function splitTemplateToken(token: string): { placeholder: string; parameter: string | null } {
  const colon = token.indexOf(":");
  if (colon < 0) return { placeholder: token, parameter: null };
  return { placeholder: `${token.slice(0, colon)}}`, parameter: token.slice(colon + 1, -1) };
}

/** A placeholder's value: text, or — for one that writes amounts — text in the style it is asked for,
 *  or — for one that writes internal numbers — the numbers, padded as asked (#2097). */
export type TemplateValue = string | ((style: CurrencyStyle) => string) | TemplateNumbers;

/**
 * What `token` becomes, or null when it is not a placeholder of `values` — an unknown name, a parameter
 * on a placeholder that takes none, or a parameter that is not one of its choices: a `CURRENCY_STYLES`
 * on an amount, a width on an internal number. A null token is kept as typed by every renderer.
 * `defaultStyle` is what an amount with no parameter writes: the symbol, bar a post frozen before
 * there were symbols (#1800).
 */
export function resolveTemplateToken(
  token: string,
  values: Readonly<Record<string, TemplateValue>>,
  defaultStyle: CurrencyStyle = DEFAULT_CURRENCY_STYLE
): string | null {
  const { placeholder, parameter } = splitTemplateToken(token);
  if (!Object.hasOwn(values, placeholder)) return null;
  const value = values[placeholder];
  if (typeof value === "string") return parameter === null ? value : null;
  if (typeof value === "object") {
    if (parameter === null) return writtenNumbers(value, null);
    const pad = parseNumberPad(parameter);
    return pad === null ? null : writtenNumbers(value, pad);
  }
  if (parameter === null) return value(defaultStyle);
  return isCurrencyStyle(parameter) ? value(parameter) : null;
}

/** A placeholder as an editor knows it: its token, and whether it writes amounts and so takes the
 *  currency parameter, or internal numbers and so takes the padding one (#2097). */
export interface TemplatePlaceholderSpec {
  token: string;
  amount?: boolean;
  number?: boolean;
}

/** Whether `token` is a placeholder of `placeholders`, its parameter included. */
export function isKnownTemplateToken(token: string, placeholders: readonly TemplatePlaceholderSpec[]): boolean {
  const { placeholder, parameter } = splitTemplateToken(token);
  const spec = placeholders.find((p) => p.token === placeholder);
  if (!spec) return false;
  if (parameter === null) return true;
  if (spec.amount === true) return isCurrencyStyle(parameter);
  if (spec.number === true) return parseNumberPad(parameter) !== null;
  return false;
}

/** The distinct tokens a template carries, in the order first written. */
export function templateTokens(template: string): string[] {
  return [...new Set(template.match(TEMPLATE_TOKEN) ?? [])];
}
