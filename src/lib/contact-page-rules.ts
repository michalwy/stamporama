// A contact's own page (#1708): what the collector has done with one person or company, in figures
// that depend on the contact's role. Pure — no Prisma, no `server-only` — so the period arithmetic
// and the money totals are pinned by `pnpm test:unit`, and the client reads the period vocabulary
// from here too. The server read is `contact-page.ts`.
//
// Two rules carry the money:
//
//  - **Base currency first**, because it is the only figure comparable across purchases and sales
//    made in different currencies. The transaction currency's total is stated **beside** it only
//    where every transaction shares one currency, and that currency is not the base — a sum across
//    currencies would mean nothing, and one in the base currency would only repeat the figure.
//  - **An unconvertible total is absent, never partial** — `purchase-spend.ts`' rule (#852), carried
//    from one order to many. A transaction in a foreign currency with no rate recorded leaves the
//    base total unstated, and the page says how many transactions are why; a total that quietly
//    left them out would understate what was spent.

import type { DateRange } from "./profit-and-loss-rules";
import { hasPurchaseArrived, PURCHASE_STATUSES, type PurchaseStatus } from "./purchase-status";
import type { SaleStatus } from "./sale-status";

/** The period switch: this calendar year, the last twelve months, or everything. */
export const CONTACT_PERIODS = ["year", "12m", "all"] as const;
export type ContactPeriod = (typeof CONTACT_PERIODS)[number];

/** What a contact page shows with nothing chosen (#1708). */
export const DEFAULT_CONTACT_PERIOD: ContactPeriod = "all";

export const CONTACT_PERIOD_LABELS: Record<ContactPeriod, string> = {
  year: "This year",
  "12m": "Last 12 months",
  all: "All time",
};

export function isContactPeriod(value: string | null | undefined): value is ContactPeriod {
  return !!value && (CONTACT_PERIODS as readonly string[]).includes(value);
}

/**
 * The inclusive calendar-day range a period covers, ending today. *This year* starts on 1 January;
 * *the last 12 months* is the twelve months up to and including today, so it starts the day after the
 * same date a year ago (29 February falls back to 1 March). *All time* is open at both ends — a
 * transaction dated in the future is still one with this contact.
 */
export function contactPeriodRange(period: ContactPeriod, today: string): DateRange {
  if (period === "all") return { from: null, to: null };
  const [y, m, d] = today.split("-").map(Number);
  if (period === "year") return { from: `${y}-01-01`, to: today };
  const start = new Date(Date.UTC(y - 1, m - 1, d));
  // Feb 29 a year back does not exist; Date rolls it to Mar 1, which is already the day after.
  if (start.getUTCMonth() === m - 1) start.setUTCDate(start.getUTCDate() + 1);
  return { from: start.toISOString().slice(0, 10), to: today };
}

/** One transaction's money, as a total sums it. */
export interface MoneyEntry {
  /** In the transaction's own currency. */
  amount: number;
  currency: string;
  /** In the base currency, or null when no rate is recorded for a foreign currency. */
  base: number | null;
}

/** Many transactions' money, summed under the two rules at the top of this file. */
export interface MoneyTotal {
  baseCurrency: string;
  /** Σ in the base currency, 2 dp — null when any entry has no base figure. */
  base: string | null;
  /** Entries with no base figure: why `base` is null. */
  unconvertedCount: number;
  /** Σ in the transaction currency, only where every entry shares one other than the base. */
  tx: { currency: string; total: string } | null;
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

function money(totalCents: number): string {
  return (totalCents === 0 ? 0 : totalCents / 100).toFixed(2);
}

export function sumMoney(entries: readonly MoneyEntry[], baseCurrency: string): MoneyTotal {
  let baseCents = 0;
  let txCents = 0;
  let unconvertedCount = 0;
  const currencies = new Set<string>();
  for (const e of entries) {
    currencies.add(e.currency);
    txCents += cents(e.amount);
    if (e.base == null) unconvertedCount += 1;
    else baseCents += cents(e.base);
  }
  const [only] = currencies;
  return {
    baseCurrency,
    base: unconvertedCount > 0 ? null : money(baseCents),
    unconvertedCount,
    tx: currencies.size === 1 && only !== baseCurrency ? { currency: only, total: money(txCents) } : null,
  };
}

/** An amount in the base currency at a recorded rate: identity in the base currency itself, null for
 * a foreign currency with no rate — the same call `canExpressInBase` makes for a purchase. */
export function toBaseAmount(
  amount: number,
  currency: string,
  baseCurrency: string,
  fxRateToBase: number | null
): number | null {
  if (currency === baseCurrency) return amount;
  if (fxRateToBase == null) return null;
  return cents(amount * fxRateToBase) / 100;
}

/** A purchase not yet delivered: still *Preparing* or *In transit*. One list, read by the count and
 * by the link that opens the purchases list on it, so the two cannot name different orders. */
export const NOT_DELIVERED_PURCHASE_STATUSES: readonly PurchaseStatus[] = PURCHASE_STATUSES.filter(
  (s) => !hasPurchaseArrived(s)
);

/** A sale not yet paid: still *Ordered*. */
export const UNPAID_SALE_STATUSES: readonly SaleStatus[] = ["ordered"];

/** A sale not yet sent: everything before *Sent*. */
export const UNSENT_SALE_STATUSES: readonly SaleStatus[] = ["ordered", "paid", "packed"];
