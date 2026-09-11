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

/** An issue's declared per-vendor range as its catalog identity — `Mi·PL 1298–302`.
 *
 * Re-exported from `@/lib/catalog-range`, where it moved with #710 so that `src/lib` can state an
 * issue's range without reaching into `src/app`. One spelling, both readers. */
export { formatIssueCatalogNumber } from "@/lib/catalog-range";
