import type { Franking, ValuationMethod } from "./piece-valuation";
import { isFranking, isValuationMethod } from "./piece-valuation";
import type { CopyValuation } from "./valuation";

// The value of a **piece** — a copy carrying several stamps (ADR-0044), or one on a format of kind
// *On cover* or *On piece* — the pure half of what a copy row hands the valuation (#2359; ADR-0076).
// The rules a piece is valued by are `piece-valuation.ts`; `item-valuation.ts` reads the prices they
// need. Before #2359 such a copy was valued at a figure the collector recorded on it (#747); those
// figures are amount modifiers now (`piece-value-conversion.ts`).
//
// The Valuation dialog also lists every stamp on the piece at its used price — the sum of used, which
// was #747's suggestion and is now one of the methods. Each component is valued:
//
//   - at the **copy's** condition — the piece has one condition (per-component condition is ADR-0044's
//     *Still open*);
//   - at the **entry's** format, so a block of four on the cover is priced as a block (ADR-0020 §5);
//   - with **no certificate** — a certificate is a statement about the piece, not about each franking;
//   - times the entry's `quantity`, which counts described components (ADR-0044 §4).
//
// A component that resolves to nothing leaves the sum **partial and says so**. It never contributes a
// silent zero, for the reason ADR-0020 §9 leaves a copy unpriced rather than borrowing a different
// thing's price: a total that looks complete and is not is worse than no total.

/** What `ValuationRow.copy` carries for a copy: what decides whether it is a piece, and how one is
 *  valued. Whether its format makes it a piece is read by `valuateItemRows`, which knows the kinds. */
export interface PieceCopyInput {
  itemId: string;
  stampCount: number;
  franking: Franking;
  /** The copy's own method (#2359), or null to follow its area. */
  method: ValuationMethod | null;
}

/** The columns {@link pieceCopyOf} reads beside the copy's `id`, which every caller selects anyway —
 *  spread into a copy's `select`. Scalars only, so a caller's own `format` or `stamps` select is never
 *  overridden. */
export const PIECE_COPY_SELECT = {
  stampCount: true,
  franking: true,
  valuationMethod: true,
} as const;

/** A copy's `ValuationRow.copy`. A value the database CHECKs keep valid is read back defensively. */
export function pieceCopyOf(row: {
  id: string;
  stampCount: number;
  franking: string;
  valuationMethod: string | null;
}): PieceCopyInput {
  return {
    itemId: row.id,
    stampCount: row.stampCount,
    franking: isFranking(row.franking) ? row.franking : "rate_correct",
    method: isValuationMethod(row.valuationMethod) ? row.valuationMethod : null,
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
 * `ValuationRow`'s, keyed by entry id; `copy` is null because a component is a stamp, not a piece.
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
    copy: null,
    // The full worth of the stamps: the piece's faults lower the piece's value (#1560), so lowering
    // the components too would take them off twice.
    faultReductionPercent: null,
    valueModifier: null,
    candidateStampIds: null,
  }));
}

/** One component of a piece, at its used price. */
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

/** Sum a piece's components at their used prices. Pure; see the module header for the rule. */
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
