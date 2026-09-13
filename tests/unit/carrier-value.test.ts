import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import {
  carrierComponentRows,
  carrierValuationOf,
  parseExplicitValueInput,
  sumCarrierComponents,
  type CarrierEntry,
} from "../../src/lib/carrier-value";
import {
  aggregateHoldings,
  valuateCopy,
  valuateExplicitValue,
  type CopyValuation,
} from "../../src/lib/valuation";

// The value of a multi-stamp copy (#747; ADR-0044 §6).
//
// What is pinned is the **suggestion's rule** end to end — each component keyed at the copy's
// condition, the entry's format and no certificate, valued by the very `valuateCopy` every copy is
// valued by, multiplied by the entry's quantity and summed — and the two things the suggestion must
// never do: contribute a silent zero for a stamp with no price, or become the copy's value without
// the collector recording it. The recorded value's own rule (`valuateExplicitValue`) sits beside it.

const D = (n: number): Decimal => n as unknown as Decimal;

const MICHEL = "cat-michel";
const MNH = "cond-mnh";
const CERT = "cert-guarantee";
const BLK4 = "fmt-blk4";
const COVER = "fmt-cover";
const noRates = new Map<string, number | null>();

function price(
  amount: number,
  opts: { currency?: string; certificateStatusId?: string | null; formatId?: string | null } = {}
): RawCatalogPrice {
  return {
    price: D(amount),
    currency: opts.currency ?? "EUR",
    conditionId: MNH,
    certificateStatusId: opts.certificateStatusId ?? null,
    formatId: opts.formatId ?? null,
    catalogEdition: { year: 2024, catalogNameId: MICHEL },
  };
}

function entry(id: string, stampId: string, overrides: Partial<CarrierEntry> = {}): CarrierEntry {
  return { id, stampId, quantity: 1, formatId: null, unknownVariant: false, ...overrides };
}

/** The whole suggestion as the server builds it: rows from the rule, `valuateCopy` per row, the sum. */
function suggest(
  copy: { conditionId: string },
  entries: CarrierEntry[],
  pricesByStamp: Record<string, RawCatalogPrice[]>,
  rates: Map<string, number | null> = noRates
) {
  const rows = carrierComponentRows(copy, entries);
  return sumCarrierComponents(
    rows.map((row, index) => ({
      quantity: entries[index].quantity,
      valuation: valuateCopy({
        conditionId: row.conditionId,
        certificateStatusId: row.certificateStatusId,
        formatId: row.formatId,
        formatFactor: null,
        unknownVariant: row.unknownVariant,
        primaryCatalogNameId: MICHEL,
        ownPrices: pricesByStamp[row.stampId] ?? [],
        baseCurrency: "EUR",
        rates,
      }),
    })),
    "EUR"
  );
}

describe("carrierComponentRows — the key each component is priced on", () => {
  it("takes the copy's condition, the entry's format and no certificate", () => {
    const [row] = carrierComponentRows({ conditionId: MNH }, [entry("e1", "mi200", { formatId: BLK4 })]);
    assert.deepEqual(row, {
      id: "e1",
      stampId: "mi200",
      conditionId: MNH,
      certificateStatusId: null,
      formatId: BLK4,
      unknownVariant: false,
      carrier: null,
    });
  });
});

describe("sumCarrierComponents — the suggested value", () => {
  it("multiplies each component by its quantity", () => {
    const s = suggest({ conditionId: MNH }, [entry("e1", "mi200", { quantity: 2 }), entry("e2", "mi201")], {
      mi200: [price(10)],
      mi201: [price(3.5)],
    });
    assert.equal(s.totalBaseAmount, "23.50");
    assert.deepEqual(s.shares[0], { status: "priced", unitBaseAmount: 10, lineBaseAmount: 20 });
    assert.equal(s.partial, false);
    assert.equal(s.pricedCount, 2);
  });

  it("prices a component in its own format, not as a single and not in the carrier's format", () => {
    // Mi 200 has a single price, a block-of-four price and — as a trap — a price at the cover format.
    const prices = { mi200: [price(10), price(55, { formatId: BLK4 }), price(99, { formatId: COVER })] };
    const block = suggest({ conditionId: MNH }, [entry("e1", "mi200", { formatId: BLK4 })], prices);
    assert.equal(block.totalBaseAmount, "55.00");
    const single = suggest({ conditionId: MNH }, [entry("e1", "mi200")], prices);
    assert.equal(single.totalBaseAmount, "10.00");
  });

  it("values a component with no certificate, whatever the piece carries", () => {
    // Only a certified price exists: the component is unpriced rather than borrowing it.
    const s = suggest({ conditionId: MNH }, [entry("e1", "mi200")], {
      mi200: [price(40, { certificateStatusId: CERT })],
    });
    assert.equal(s.totalBaseAmount, null);
    assert.deepEqual(s.shares[0], { status: "unpriced" });
  });

  it("leaves a component with no price out and says the sum is partial — never a silent zero", () => {
    const s = suggest(
      { conditionId: MNH },
      [entry("e1", "mi200"), entry("e2", "mi201", { quantity: 3 }), entry("e3", "mi205")],
      { mi200: [price(10)], mi205: [price(2)] }
    );
    assert.equal(s.totalBaseAmount, "12.00");
    assert.equal(s.partial, true);
    assert.equal(s.unpricedCount, 1);
    assert.equal(s.pricedCount, 2);
    assert.deepEqual(s.shares[1], { status: "unpriced" });
  });

  it("suggests nothing at all when no component is priced", () => {
    const s = suggest({ conditionId: MNH }, [entry("e1", "mi200"), entry("e2", "mi201")], {});
    assert.equal(s.totalBaseAmount, null);
    assert.equal(s.partial, true);
    assert.equal(s.unpricedCount, 2);
  });

  it("counts a price with no rate to base as missing, not as zero", () => {
    const s = suggest({ conditionId: MNH }, [entry("e1", "mi200"), entry("e2", "mi201")], {
      mi200: [price(10)],
      mi201: [price(4, { currency: "USD" })],
    });
    assert.equal(s.totalBaseAmount, "10.00");
    assert.equal(s.partial, true);
    assert.equal(s.unconvertibleCount, 1);
    assert.deepEqual(s.shares[1], { status: "unconvertible" });
  });

  it("converts through the rates and sums the figures as displayed, to the cent", () => {
    const s = suggest(
      { conditionId: MNH },
      [entry("e1", "mi200", { quantity: 3 })],
      { mi200: [price(1, { currency: "PLN" })] },
      new Map([["PLN", 0.23456]])
    );
    // 0.23456 is shown as 0.23, and three of them are 0.69 — not 0.70368 rounded late.
    assert.deepEqual(s.shares[0], { status: "priced", unitBaseAmount: 0.23, lineBaseAmount: 0.69 });
    assert.equal(s.totalBaseAmount, "0.69");
  });
});

describe("valuateExplicitValue — a carrier's recorded value", () => {
  it("is unpriced, not zero, with nothing recorded", () => {
    const v = valuateExplicitValue(null, "EUR", noRates);
    assert.equal(v.unpriced, true);
    assert.equal(v.baseAmount, null);
    assert.equal(v.explicit, false);
  });

  it("is the recorded figure, marked explicit and never uncertain", () => {
    const v = valuateExplicitValue({ amount: "120.00", currency: "EUR" }, "EUR", noRates);
    assert.equal(v.unpriced, false);
    assert.equal(v.amount, "120.00");
    assert.equal(v.baseAmount, 120);
    assert.equal(v.explicit, true);
    assert.equal(v.uncertain, false);
    assert.equal(v.catalogNameId, null);
  });

  it("converts to base like a catalogue price, and reports no base figure without a rate", () => {
    const converted = valuateExplicitValue({ amount: "100.00", currency: "PLN" }, "EUR", new Map([["PLN", 0.25]]));
    assert.equal(converted.baseAmountDisplay, "25.00");
    const stuck = valuateExplicitValue({ amount: "100.00", currency: "PLN" }, "EUR", noRates);
    assert.equal(stuck.unpriced, false);
    assert.equal(stuck.baseAmount, null);
  });

  it("enters a holdings total as priced, and an unrecorded carrier as unpriced", () => {
    const valuations: CopyValuation[] = [
      valuateExplicitValue({ amount: "30.00", currency: "EUR" }, "EUR", noRates),
      valuateExplicitValue(null, "EUR", noRates),
    ];
    const total = aggregateHoldings(valuations, "EUR");
    assert.equal(total.totalBaseAmount, "30.00");
    assert.equal(total.pricedCount, 1);
    assert.equal(total.unpricedCount, 1);
  });
});

describe("carrierValuationOf — which copies are valued at a recorded figure", () => {
  it("is null for an ordinary copy, even with a figure left in its row", () => {
    assert.equal(
      carrierValuationOf({ stampCount: 1, explicitValue: "50.00", explicitValueCurrency: "EUR" }),
      null
    );
  });

  it("carries the recorded figure for a carrier, and none when nothing is recorded", () => {
    assert.deepEqual(
      carrierValuationOf({ stampCount: 3, explicitValue: "50.5", explicitValueCurrency: "EUR" }),
      { explicitValue: { amount: "50.50", currency: "EUR" } }
    );
    assert.deepEqual(
      carrierValuationOf({ stampCount: 2, explicitValue: null, explicitValueCurrency: null }),
      { explicitValue: null }
    );
  });
});

describe("parseExplicitValueInput", () => {
  it("reads a blank amount as clearing the value", () => {
    assert.deepEqual(parseExplicitValueInput("  ", "EUR"), { ok: true, value: null });
  });

  it("normalises the amount and the currency", () => {
    assert.deepEqual(parseExplicitValueInput("12,5", "pln"), {
      ok: true,
      value: { amount: "12.50", currency: "PLN" },
    });
  });

  it("refuses a negative amount, a non-number and a missing currency", () => {
    assert.equal(parseExplicitValueInput("-1", "EUR").ok, false);
    assert.equal(parseExplicitValueInput("abc", "EUR").ok, false);
    assert.equal(parseExplicitValueInput("10", "").ok, false);
  });
});
