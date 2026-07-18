const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatIssuedDate(
  issuedDay: number | null | undefined,
  issuedMonth: number | null | undefined,
  issuedYear: number | null | undefined
): string | null {
  if (!issuedYear && !issuedMonth && !issuedDay) return null;
  const parts: string[] = [];
  if (issuedDay) parts.push(String(issuedDay));
  if (issuedMonth && issuedMonth >= 1 && issuedMonth <= 12) parts.push(MONTH_ABBR[issuedMonth - 1]);
  if (issuedYear) parts.push(String(issuedYear));
  return parts.join(" ");
}

export interface MoneyLike {
  amount: string;
  currency: string;
  convertedAmount: string | null;
  baseCurrency: string;
}

/**
 * Primary (emphasised) amount — the collection base currency.
 * "≈ 3.20 EUR" when converted, or "12.50 EUR" when the catalog already uses the base currency.
 */
export function moneyPrimaryText(m: MoneyLike): string {
  if (m.convertedAmount != null) return `≈ ${m.convertedAmount} ${m.baseCurrency}`;
  return `${m.amount} ${m.currency}`;
}

/** Secondary (muted) amount — the catalog currency, only when it differs from the base. */
export function moneySecondaryText(m: MoneyLike): string | null {
  if (m.convertedAmount == null) return null;
  return `${m.amount} ${m.currency}`;
}

export function formatIssueCatalogNumber(
  firstNumber: string,
  lastNumber: string | null | undefined,
  vendorAbbr: string,
  areaPrefix: string | null | undefined
): string {
  const prefix = areaPrefix ? `${vendorAbbr}·${areaPrefix}` : vendorAbbr;
  const range = lastNumber ? `${firstNumber}–${lastNumber}` : firstNumber;
  return `${prefix} ${range}`;
}
