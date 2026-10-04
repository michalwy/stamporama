import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OBSERVATIONS,
  agentObservation,
  observationCountProblem,
  parseObservationSpec,
  summarizeObservations,
  type ObservationViewSource,
} from "../../src/lib/agent-api/price-observations";

// The pure half of price observations through the agent API (#1635): the `name=value` grammar of one
// observation, the batch cap, and what an observation reads back as. The writes, the resolver and
// the duplicate rule need a database and are in `tests/integration/agent-api-price-observations.test.ts`.

const FULL =
  "stamp=Mi 5; condition=MNH; certificate=FA; format=Pair; price=120,50; currency=EUR; basis=all_in; premium=23; fee=1.50; sold_on=2024-03-14; platform=Philasearch; house=Köhler; auction=412; lot=1234; url=https://example.com/r/1234";

describe("parseObservationSpec", () => {
  it("reads every field, as sent", () => {
    const parsed = parseObservationSpec(FULL);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.spec, {
      stamp: "Mi 5",
      condition: "MNH",
      certificate: "FA",
      certificateUncertain: false,
      format: "Pair",
      price: "120,50",
      currency: "EUR",
      basis: "all_in",
      premium: "23",
      fee: "1.50",
      soldOn: "2024-03-14",
      platform: "Philasearch",
      house: "Köhler",
      auction: "412",
      lot: "1234",
      url: "https://example.com/r/1234",
    });
  });

  it("leaves what is not sent null, which is a condition not established and no certificate", () => {
    const parsed = parseObservationSpec("stamp=st 12; price=5; sold_on=2024-01-02; platform=Allegro");
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.condition, null);
    assert.equal(parsed.spec.certificate, null);
    assert.equal(parsed.spec.certificateUncertain, false);
    assert.equal(parsed.spec.house, null);
    assert.equal(parsed.spec.url, null);
  });

  it("reads `?` as not established — on the condition, and on whether there is a certificate", () => {
    const parsed = parseObservationSpec("stamp=Mi 5; condition=?; certificate=?; price=5; sold_on=2024-01-02; platform=P");
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.condition, null);
    assert.equal(parsed.spec.certificate, null);
    assert.equal(parsed.spec.certificateUncertain, true);
  });

  it("keeps a `;` inside an address as part of it", () => {
    const parsed = parseObservationSpec("stamp=Mi 5; price=5; sold_on=2024-01-02; platform=P; url=https://x.test/a;jsessionid=1;b");
    assert.ok(parsed.ok);
    assert.equal(parsed.spec.url, "https://x.test/a;jsessionid=1;b");
  });

  it("refuses a missing required field, an unknown or repeated one, and a piece that is not a pair", () => {
    const refusal = (entry: string) => {
      const parsed = parseObservationSpec(entry);
      assert.ok(!parsed.ok, entry);
      return parsed.reason;
    };
    assert.match(refusal("stamp=Mi 5; price=5"), /no sold_on and no platform/);
    assert.match(refusal("stamp=Mi 5; price=5; sold_on=2024-01-02; platform=P; colour=red"), /"colour" is not an observation field/);
    assert.match(refusal("stamp=Mi 5; stamp=Mi 6; price=5; sold_on=2024-01-02; platform=P"), /"stamp" twice/);
    assert.match(refusal("stamp=Mi 5; price; sold_on=2024-01-02; platform=P"), /"price" is not `name=value`/);
    assert.match(refusal("stamp=; price=5; sold_on=2024-01-02; platform=P"), /not `name=value`/);
  });
});

describe("observationCountProblem", () => {
  it("refuses none and more than one call records, and allows the cap", () => {
    assert.match(observationCountProblem(0)!, /at least one/);
    assert.equal(observationCountProblem(MAX_OBSERVATIONS), null);
    assert.match(observationCountProblem(MAX_OBSERVATIONS + 1)!, /at most 100/);
  });
});

function view(overrides: Partial<ObservationViewSource> = {}): ObservationViewSource {
  return {
    id: "obs1",
    stampId: "stamp1",
    conditionName: "Mint Never Hinged",
    certificateStatusName: null,
    certificateUncertain: false,
    formatName: null,
    price: "120.00",
    currency: "EUR",
    priceBasis: "hammer",
    premiumPercent: null,
    premiumFixed: null,
    hammer: "120.00",
    allIn: "120.00",
    soldOn: "2024-03-14",
    fxRateToBase: "4.30",
    baseCurrency: "PLN",
    countedAmount: "516.00",
    doubts: [],
    notCounted: null,
    market: "DE",
    platformName: "Philasearch",
    auctionHouseName: "Köhler",
    auctionName: "412",
    lotNo: "1234",
    url: null,
    ...overrides,
  };
}

describe("agentObservation", () => {
  it("says a counted one counts, with what it counts as, and leaves out what is empty", () => {
    const read = agentObservation(view(), { stampNo: 7, catalogNumber: "Mi 5" });
    assert.equal(read.counted, true);
    assert.equal(read.countedAmount, "516.00");
    assert.equal(read.stampNo, 7);
    assert.equal(read.stamp, "Mi 5");
    assert.equal(read.notCounted, undefined);
    assert.equal(read.doubts, undefined);
    assert.equal("url" in read, false);
    assert.equal("certificate" in read, false);
  });

  it("says why a hint is not counted, as a code and as a sentence, with its doubts", () => {
    const read = agentObservation(
      view({ notCounted: "uncertain", countedAmount: null, doubts: ["variant", "certificate"], certificateUncertain: true })
    );
    assert.equal(read.counted, false);
    assert.equal(read.notCounted, "uncertain");
    assert.match(read.notCountedReason!, /hint/);
    assert.deepEqual(read.doubts, ["variant", "certificate"]);
    assert.equal(read.certificate, "?");
    assert.equal(read.countedAmount, undefined);
  });

  it("names the other-market reason", () => {
    const read = agentObservation(view({ notCounted: "other-market", countedAmount: null }));
    assert.match(read.notCountedReason!, /does not anchor/);
  });
});

describe("summarizeObservations", () => {
  it("counts each outcome, and how many of the recorded ones count", () => {
    const counted = agentObservation(view());
    const hint = agentObservation(view({ id: "obs2", notCounted: "uncertain", countedAmount: null }));
    const batch = summarizeObservations([
      { entry: "a", outcome: "recorded", observation: counted },
      { entry: "b", outcome: "recorded", observation: hint },
      { entry: "c", outcome: "duplicate", duplicateOf: "obs0", reason: "already" },
      { entry: "d", outcome: "refused", reason: "no" },
    ]);
    assert.deepEqual(
      [batch.recorded, batch.duplicate, batch.refused, batch.counted],
      [2, 1, 1, 1]
    );
    assert.deepEqual(batch.observations.map((o) => o.entry), ["a", "b", "c", "d"]);
  });
});
