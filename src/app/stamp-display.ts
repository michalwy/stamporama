import { formatCatalogRange } from "@/lib/catalog-range";

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

/** An issue's declared per-vendor range as its catalog identity — `Mi·PL 1298–302`. The span goes
 * through the shared range formatter (#400), so a declared range reads the way the same span reads in
 * a generated listing title or an offer set's name; only the separator differs, an on-screen chip
 * taking the en dash. The issue form's own First/Last inputs stay written out in full — those are the
 * values being stored. */
export function formatIssueCatalogNumber(
  firstNumber: string,
  lastNumber: string | null | undefined,
  vendorAbbr: string,
  areaPrefix: string | null | undefined
): string {
  const prefix = areaPrefix ? `${vendorAbbr}·${areaPrefix}` : vendorAbbr;
  return `${prefix} ${formatCatalogRange(firstNumber, lastNumber, "–")}`;
}
