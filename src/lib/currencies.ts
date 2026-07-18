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
