export const BASE_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "PLN",
  "CHF",
  "CZK",
  "DKK",
  "SEK",
  "NOK",
] as const;

export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

export const DEFAULT_BASE_CURRENCY: BaseCurrency = "EUR";

/** Broader list of currency codes offered in currency pickers (purchase price,
 * catalog price entry). Superset of BASE_CURRENCIES; alphabetically ordered. */
export const COMMON_CURRENCIES = [
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HRK", "HUF", "INR", "JPY", "KZT", "MXN", "NOK", "PLN", "RON", "RUB",
  "SEK", "TRY", "UAH", "USD", "ZAR",
] as const;

export type CommonCurrency = (typeof COMMON_CURRENCIES)[number];

/** A currency's symbol and which side of the amount it is written on. */
export interface CurrencySymbol {
  symbol: string;
  /** Before the amount, without a space (`$10`); otherwise after it, with one (`15 zł`). */
  before: boolean;
}

/**
 * The symbol of every currency the app offers (#2028) — one fixed table, no setting. Used **only** by
 * text generated from a template: the app's own screens keep writing the code. The nine base
 * currencies are the issue's table; the rest follow each currency's common written form, a dollar or
 * yen other than the US's and Japan's prefixed so two currencies never read alike.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<CommonCurrency, CurrencySymbol>> = {
  AUD: { symbol: "A$", before: true },
  BGN: { symbol: "лв", before: false },
  BRL: { symbol: "R$", before: true },
  CAD: { symbol: "C$", before: true },
  CHF: { symbol: "Fr.", before: true },
  CNY: { symbol: "CN¥", before: true },
  CZK: { symbol: "Kč", before: false },
  DKK: { symbol: "kr", before: false },
  EUR: { symbol: "€", before: false },
  GBP: { symbol: "£", before: true },
  HRK: { symbol: "kn", before: false },
  HUF: { symbol: "Ft", before: false },
  INR: { symbol: "₹", before: true },
  JPY: { symbol: "¥", before: true },
  KZT: { symbol: "₸", before: false },
  MXN: { symbol: "MX$", before: true },
  NOK: { symbol: "kr", before: false },
  PLN: { symbol: "zł", before: false },
  RON: { symbol: "lei", before: false },
  RUB: { symbol: "₽", before: false },
  SEK: { symbol: "kr", before: false },
  TRY: { symbol: "₺", before: true },
  UAH: { symbol: "₴", before: false },
  USD: { symbol: "$", before: true },
  ZAR: { symbol: "R", before: true },
};

/** The symbol of `code`, or null for a currency outside the table — a code stored before the pickers
 *  offered only these. */
export function currencySymbol(code: string): CurrencySymbol | null {
  return Object.hasOwn(CURRENCY_SYMBOLS, code) ? CURRENCY_SYMBOLS[code as CommonCurrency] : null;
}
