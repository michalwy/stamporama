import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import { isMultiStampCount } from "./multi-stamp";
import type { CopyValuation, ExplicitValue } from "./valuation";

// The value of a **multi-stamp copy** (#747; ADR-0044 §6) — the pure half. The database half is
// `carrier-values.ts`; the rule a carrier is valued by is `valuateExplicitValue` in `valuation.ts`.
//
// A carrier bearing more than one stamp is a copy of none of them (#745), so the catalogue grid has
// nothing to resolve for it. Its value is **explicit** — an amount and a currency the collector
// records — and the sum of its stamps is only ever a **suggestion**: offered as a prefill, stored
// only once accepted. The worth of a cover is a question of usage and franking, not of arithmetic.
//
// The suggestion values each component:
//
//   - at the **copy's** condition — the piece has one condition (per-component condition is ADR-0044's
//     *Still open*);
//   - at the **entry's** format, so a block of four on the cover is priced as a block (ADR-0020 §5);
//   - with **no certificate** — a certificate is a statement about the piece, not about each franking;
//   - times the entry's `quantity`, which counts described components (ADR-0044 §4).
//
// A component that resolves to nothing leaves the suggestion **partial and says so**. It never
// contributes a silent zero, for the reason ADR-0020 §9 leaves a copy unpriced rather than borrowing
// a different thing's price: a total that looks complete and is not is worse than no total.

/** What `ValuationRow.carrier` carries for a multi-stamp copy: the value recorded on it, or none. */
export interface CarrierValuationInput {
  explicitValue: ExplicitValue | null;
}

/** The columns {@link carrierValuationOf} reads — spread into a copy's `select`. */
export const CARRIER_VALUATION_SELECT = {
  stampCount: true,
  explicitValue: true,
  explicitValueCurrency: true,
} as const;

/**
 * A copy's `ValuationRow.carrier`: null for an ordinary copy, the recorded value (or none) for a
 * multi-stamp one. Read off `stampCount` through `isMultiStampCount`, the same test the counts and the
 * list chip use, so a piece cannot be a carrier to one of them and a copy of its stamp to another.
 *
 * A figure left in the row of a copy edited back down to one stamp is **ignored** here, not erased:
 * that copy is a copy of its stamp again and is valued from the catalogue.
 */
export function carrierValuationOf(row: {
  stampCount: number;
  /** A Prisma `Decimal` as read, or anything else that prints as a number. */
  explicitValue: { toString(): string } | null;
  explicitValueCurrency: string | null;
}): CarrierValuationInput | null {
  if (!isMultiStampCount(row.stampCount)) return null;
  return {
    explicitValue:
      row.explicitValue != null && row.explicitValueCurrency
        ? {
            amount: Number(row.explicitValue.toString()).toFixed(2),
            currency: row.explicitValueCurrency,
          }
        : null,
  };
}

/** One stamp on a carrier, as its entry describes it. */
export interface CarrierEntry {
  id: string;
  stampId: string;
  quantity: number;
  formatId: string | null;
  unknownVariant: boolean;
}

/**
 * The valuation key each component is priced on — the three choices of the module header, stated in
 * one place: the **copy's** condition, the **entry's** format, **no** certificate. The shape is
 * `ValuationRow`'s, keyed by entry id; `carrier` is null because a component is a stamp, not a piece.
 */
export function carrierComponentRows(
  copy: { conditionId: string },
  entries: readonly CarrierEntry[]
) {
  return entries.map((entry) => ({
    id: entry.id,
    stampId: entry.stampId,
    conditionId: copy.conditionId,
    certificateStatusId: null,
    formatId: entry.formatId,
    unknownVariant: entry.unknownVariant,
    carrier: null,
  }));
}

/** One component of a carrier, valued as the suggestion values it. */
export interface CarrierComponentValue {
  /** Described components, not sheets of paper (ADR-0044 §4). */
  quantity: number;
  /** The component at the copy's condition, the entry's format and no certificate. */
  valuation: CopyValuation;
}

/** What one component contributes to the sum. */
export type CarrierComponentShare =
  /** Priced and convertible: the unit figure in base currency (as displayed, to the cent) times the
   *  quantity. */
  | { status: "priced"; unitBaseAmount: number; lineBaseAmount: number }
  /** No catalogue price at this key. */
  | { status: "unpriced" }
  /** Priced, in a currency with no rate to base — a figure, but not one that can be added up. */
  | { status: "unconvertible" };

export interface CarrierSuggestion {
  baseCurrency: string;
  /** The sum of the priced components, 2-dp, in base currency — or null when **none** is priced, since
   *  a suggestion of nothing is not a suggestion. */
  totalBaseAmount: string | null;
  /** One share per component, in the order given. */
  shares: CarrierComponentShare[];
  pricedCount: number;
  unpricedCount: number;
  unconvertibleCount: number;
  /** True when any component contributed nothing: the total, if there is one, is a lower bound. */
  partial: boolean;
}

/** Sum a carrier's components into the suggested value. Pure; see the module header for the rule. */
export function sumCarrierComponents(
  components: readonly CarrierComponentValue[],
  baseCurrency: string
): CarrierSuggestion {
  // Accumulated in whole cents: each unit figure is taken as it is displayed, so the rows of the
  // breakdown add up to the total printed under them rather than to a float a cent away from it.
  let totalCents = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let unconvertibleCount = 0;
  const shares = components.map<CarrierComponentShare>(({ quantity, valuation }) => {
    if (valuation.unpriced) {
      unpricedCount++;
      return { status: "unpriced" };
    }
    if (valuation.baseAmount === null) {
      unconvertibleCount++;
      return { status: "unconvertible" };
    }
    pricedCount++;
    const unitCents = Math.round(valuation.baseAmount * 100);
    totalCents += unitCents * quantity;
    return {
      status: "priced",
      unitBaseAmount: unitCents / 100,
      lineBaseAmount: (unitCents * quantity) / 100,
    };
  });
  return {
    baseCurrency,
    totalBaseAmount: pricedCount === 0 ? null : (totalCents / 100).toFixed(2),
    shares,
    pricedCount,
    unpricedCount,
    unconvertibleCount,
    partial: unpricedCount + unconvertibleCount > 0,
  };
}

/** The largest amount `DECIMAL(10, 2)` holds. */
const MAX_EXPLICIT_VALUE = 99_999_999.99;

/**
 * Read a recorded value off the dialog's two fields. **A blank amount clears the value**, which
 * returns the carrier to unpriced — the one way to say "I no longer stand by that figure". Otherwise
 * the amount is a non-negative number (the shared decimal input's commas and arithmetic included,
 * #233/#580) and the currency a three-letter code.
 */
export function parseExplicitValueInput(
  amountRaw: string,
  currencyRaw: string
): { ok: true; value: ExplicitValue | null } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(amountRaw.trim());
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "The value must be a number." };
  if (n < 0) return { ok: false, message: "The value cannot be negative." };
  if (n > MAX_EXPLICIT_VALUE) return { ok: false, message: "The value is too large." };
  const currency = currencyRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Choose a currency." };
  return { ok: true, value: { amount: roundAmount(n), currency } };
}
