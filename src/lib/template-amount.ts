// How a template placeholder writes an amount (#2028) — pure, no Prisma and no `server-only`, because
// the template editors are client components and flag a misspelt parameter while it is typed.
//
// Every placeholder that writes an amount takes a parameter after a colon choosing how the currency is
// written: `{price:symbol}` → `15 zł`, `{price:code}` → `15 PLN`, `{price:none}` → `15`. With none it
// writes the symbol — decided with the collector on 2026-10-18, a change from the code every amount was
// written with until then. The number itself is `generatedAmount`'s whatever the choice (#1787).
//
// A parameter on a placeholder that writes no amount, or one that is not a choice, makes the token
// not a placeholder: it is kept as typed and named under the field, a misspelt placeholder's rule.

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

/** A template token: `{name}`, or `{name:parameter}` — the parameter possibly misspelt or empty, so
 *  the editor can name it. */
export const TEMPLATE_TOKEN = /\{[A-Za-z]+(?::[A-Za-z]*)?\}/g;

/** A token split into the placeholder it names (`{price}`) and its parameter, null where it has none. */
export function splitTemplateToken(token: string): { placeholder: string; parameter: string | null } {
  const colon = token.indexOf(":");
  if (colon < 0) return { placeholder: token, parameter: null };
  return { placeholder: `${token.slice(0, colon)}}`, parameter: token.slice(colon + 1, -1) };
}

/** A placeholder's value: text, or — for one that writes amounts — text in the style it is asked for. */
export type TemplateValue = string | ((style: CurrencyStyle) => string);

/**
 * What `token` becomes, or null when it is not a placeholder of `values` — an unknown name, a parameter
 * on a placeholder that writes no amount, or a parameter that is not one of `CURRENCY_STYLES`. A null
 * token is kept as typed by every renderer. `defaultStyle` is what an amount with no parameter writes:
 * the symbol, bar a post frozen before there were symbols (#1800).
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
  if (parameter === null) return value(defaultStyle);
  return isCurrencyStyle(parameter) ? value(parameter) : null;
}

/** A placeholder as an editor knows it: its token, and whether it writes amounts and so takes the
 *  currency parameter. */
export interface TemplatePlaceholderSpec {
  token: string;
  amount?: boolean;
}

/** Whether `token` is a placeholder of `placeholders`, its parameter included. */
export function isKnownTemplateToken(token: string, placeholders: readonly TemplatePlaceholderSpec[]): boolean {
  const { placeholder, parameter } = splitTemplateToken(token);
  const spec = placeholders.find((p) => p.token === placeholder);
  if (!spec) return false;
  return parameter === null || (spec.amount === true && isCurrencyStyle(parameter));
}

/** The distinct tokens a template carries, in the order first written. */
export function templateTokens(template: string): string[] {
  return [...new Set(template.match(TEMPLATE_TOKEN) ?? [])];
}
