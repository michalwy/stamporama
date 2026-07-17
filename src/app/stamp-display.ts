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
