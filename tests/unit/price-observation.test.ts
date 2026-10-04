import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPriceBasis,
  observationAllIn,
  observationDoubts,
  observationHammer,
} from "../../src/lib/price-observation";
import {
  extractObservationDatapoints,
  valuateMarket,
  type MarketLotInput,
  type MarketObservationInput,
} from "../../src/lib/market-value";

// Price observations from other people's auctions (#1633; ADR-0063). What counts and at what figure
// is arithmetic over fields the caller has read, which is why it is held here rather than against a
// database.

const NOW = new Date("2026-06-01T00:00:00Z");
const DAY = new Date("2026-01-15T00:00:00Z");

let seq = 0;

function observation(overrides: Partial<MarketObservationInput> = {}): MarketObservationInput {
  return {
    observationId: `obs-${++seq}`,
    stampId: "stamp-a",
    conditionId: "mnh",
    certificateStatusId: null,
    formatId: null,
    exact: true,
    soldOn: DAY,
    hammer: "100",
    fxRateToBase: null,
    inBaseCurrency: true,
    ...overrides,
  };
}

describe("observationHammer / observationAllIn — the price both ways", () => {
  it("leaves a hammer price as it is and adds both premium components to state it all-in", () => {
    const premium = { premiumPercent: "20", premiumFixed: "2" };
    assert.equal(observationHammer("100", "hammer", premium), "100.00");
    assert.equal(observationAllIn("100", "hammer", premium), "122.00");
  });

  it("reduces an all-in price by its premium, to the nearest cent", () => {
    const premium = { premiumPercent: "20", premiumFixed: "2" };
    assert.equal(observationHammer("122", "all_in", premium), "100.00");
    assert.equal(observationAllIn("122", "all_in", premium), "122.00");
  });

  it("treats a price with no premium as the same figure either way — the Allegro case", () => {
    const none = { premiumPercent: null, premiumFixed: null };
    assert.equal(observationHammer("57.30", "all_in", none), "57.30");
    assert.equal(observationAllIn("57.30", "hammer", none), "57.30");
  });

  it("has no hammer when the lot fee alone is more than the all-in price", () => {
    assert.equal(observationHammer("5", "all_in", { premiumPercent: "0", premiumFixed: "6" }), null);
  });

  it("knows its two bases and nothing else", () => {
    assert.ok(isPriceBasis("hammer"));
    assert.ok(isPriceBasis("all_in"));
    assert.ok(!isPriceBasis("total"));
  });
});

describe("observationDoubts — exact or a hint", () => {
  it("is exact when the variant, the condition and the certificate are all established", () => {
    assert.deepEqual(
      observationDoubts({ umbrella: false, conditionId: "mnh", certificateUncertain: false }),
      []
    );
  });

  it("names each axis not established, in a fixed order", () => {
    assert.deepEqual(
      observationDoubts({ umbrella: true, conditionId: null, certificateUncertain: true }),
      ["variant", "condition", "certificate"]
    );
    assert.deepEqual(
      observationDoubts({ umbrella: true, conditionId: "mnh", certificateUncertain: false }),
      ["variant"]
    );
  });
});

describe("extractObservationDatapoints", () => {
  it("yields one whole datapoint per exact observation, at its hammer and dated by its sale", () => {
    const [point] = extractObservationDatapoints([observation({ observationId: "o1" })]);
    assert.equal(point.amount, 100);
    assert.equal(point.split, false);
    assert.equal(point.at, DAY);
    assert.deepEqual(point.source, { kind: "observation", observationId: "o1" });
    assert.deepEqual(point.key, {
      stampId: "stamp-a",
      conditionId: "mnh",
      certificateStatusId: null,
      formatId: null,
    });
  });

  it("never counts an uncertain observation", () => {
    assert.deepEqual(extractObservationDatapoints([observation({ exact: false })]), []);
    // A missing condition is uncertain by definition, whatever the flag says.
    assert.deepEqual(extractObservationDatapoints([observation({ conditionId: null })]), []);
  });

  it("converts a foreign price at its own frozen rate, and drops one that has none", () => {
    const [converted] = extractObservationDatapoints([
      observation({ inBaseCurrency: false, fxRateToBase: "4.25" }),
    ]);
    assert.equal(converted.amount, 425);
    assert.deepEqual(
      extractObservationDatapoints([observation({ inBaseCurrency: false, fxRateToBase: null })]),
      []
    );
  });

  it("drops an observation with no readable hammer", () => {
    assert.deepEqual(extractObservationDatapoints([observation({ hammer: null })]), []);
    assert.deepEqual(extractObservationDatapoints([observation({ hammer: "0" })]), []);
  });
});

describe("valuateMarket — observations beside the collector's own lots", () => {
  it("takes the median over both, and counts them all in n", () => {
    const lot: MarketLotInput = {
      lotId: "lot-1",
      status: "closed",
      endsAt: DAY,
      finalPrice: "40",
      fxRateToBase: null,
      inBaseCurrency: true,
      lines: [
        {
          lineId: "line-1",
          stampId: "stamp-a",
          conditionId: "mnh",
          certificateStatusId: null,
          formatId: null,
          quantity: 1,
          unitCatalogueValue: null,
        },
      ],
    };
    const [value] = valuateMarket([lot], NOW, [
      observation({ hammer: "60" }),
      observation({ hammer: "80" }),
      // A hint: no effect on the figure, the sample or the span.
      observation({ hammer: "1000", exact: false }),
    ]);
    assert.equal(value.n, 3);
    assert.equal(value.median, 60);
    assert.equal(value.wholeCount, 3);
    assert.equal(value.splitCount, 0);
  });

  it("gives a key with only observations a value of its own", () => {
    const values = valuateMarket([], NOW, [observation({ hammer: "12.50" })]);
    assert.equal(values.length, 1);
    assert.equal(values[0].median, 12.5);
  });
});
