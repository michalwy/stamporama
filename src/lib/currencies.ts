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
