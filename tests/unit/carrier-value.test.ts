import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import type { RawCatalogPrice } from "../../src/lib/catalog-price";
import {
  carrierComponentRows,
  pieceCopyOf,
  sumCarrierComponents,
  type CarrierEntry,
} from "../../src/lib/carrier-value";
import { valuateCopy } from "../../src/lib/valuation";

// A piece's stamps at their used prices (#747, #2359; ADR-0044 §6) — the list the Valuation window
// shows, and what *Sum of used* adds up.
//
// What is pinned is the rule end to end — each component keyed at the copy's condition, the entry's
// format and no certificate, valued by the very `valuateCopy` every copy is valued by, multiplied by
// the entry's quantity and summed — and the one thing it must never do: contribute a silent zero for
// a stamp with no price. The methods themselves are `piece-valuation.test.ts`.

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
    mark: null,
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
      copy: null,
      faultReductionPercent: null,
      valueModifier: null,
      candidateStampIds: null,
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

describe("pieceCopyOf — what a copy row hands the valuation", () => {
  it("reads the franking and the copy's own method", () => {
    assert.deepEqual(
      pieceCopyOf({ id: "i1", stampCount: 3, franking: "not_posted", valuationMethod: "fischer" }),
      { itemId: "i1", stampCount: 3, franking: "not_posted", method: "fischer" }
    );
  });

  it("reads an unknown value back as the default, and no method as following the area", () => {
    assert.deepEqual(
      pieceCopyOf({ id: "i2", stampCount: 1, franking: "bogus", valuationMethod: null }),
      { itemId: "i2", stampCount: 1, franking: "rate_correct", method: null }
    );
  });
});
