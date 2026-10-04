import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotLine,
  parseAuctionAmount,
  parseInstant,
  parseLineCondition,
  parseLotLines,
  parseLotLineSpec,
  parsePremiumPercent,
  parseTagNames,
  MAX_LOT_LINES,
  type LotLineRow,
} from "../../src/lib/agent-api/auction-writes";
import { isApiError } from "../../src/lib/agent-api/errors";

// The pure half of the auction writes (#1627): the line grammar, the amounts, the instant, the tags,
// and what a written line reads back as. The writes themselves, the sale rule and the marker are
// `tests/integration/agent-api-auction-writes.test.ts`.

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    assert.ok(isApiError(err), `expected an ApiError, got ${String(err)}`);
    assert.equal(err.code, "invalid_request");
    return err.message;
  }
  assert.fail("expected a refusal");
}

describe("a line's condition", () => {
  it("is one grade, the grades it may be in, or unknown", () => {
    assert.deepEqual(parseLineCondition("MNH"), { kind: "one", value: "MNH" });
    assert.deepEqual(parseLineCondition("MNH | MH"), { kind: "oneOf", values: ["MNH", "MH"] });
    assert.deepEqual(parseLineCondition("Unknown"), { kind: "unknown" });
  });

  it("reads a set of one as that grade, and a repeat as one grade", () => {
    assert.deepEqual(parseLineCondition("MNH|mnh"), { kind: "one", value: "MNH" });
  });

  it("refuses unknown beside grades, and an empty grade", () => {
    assert.ok("error" in parseLineCondition("MNH|unknown"));
    assert.ok("error" in parseLineCondition("MNH||MH"));
  });
});

describe("a line", () => {
  it("defaults certificate and format to none and the single, and the quantity to one", () => {
    const parsed = parseLotLineSpec("stamp=Mi 309; condition=MNH");
    assert.deepEqual(parsed, {
      ok: true,
      line: { stamp: "Mi 309", condition: { kind: "one", value: "MNH" }, certificate: null, format: null, quantity: 1 },
    });
  });

  it("takes every field, in any order and case", () => {
    const parsed = parseLotLineSpec("Quantity=4; format=pair; stamp=st 12; certificate=Attest; condition=U");
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.line, {
      stamp: "st 12",
      condition: { kind: "one", value: "U" },
      certificate: "Attest",
      format: "pair",
      quantity: 4,
    });
  });

  it("requires a condition, and says how to say it is not stated", () => {
    const parsed = parseLotLineSpec("stamp=Mi 1");
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /condition=unknown/);
  });

  it("refuses a field it does not know, a field twice, and a bad quantity", () => {
    for (const entry of [
      "stamp=Mi 1; condition=MNH; price=3",
      "stamp=Mi 1; stamp=Mi 2; condition=MNH",
      "stamp=Mi 1; condition=MNH; quantity=0",
      "stamp=Mi 1; condition=MNH; quantity=1.5",
      "stamp=Mi 1; condition",
    ]) {
      assert.equal(parseLotLineSpec(entry).ok, false, entry);
    }
  });

  it("refuses the whole list over one bad line, naming it", () => {
    const message = refusal(() => parseLotLines(["stamp=Mi 1; condition=MNH", "stamp=Mi 2"], "lines"));
    assert.match(message, /^Line 2 of "lines"/);
    assert.match(message, /Nothing was written/);
  });

  it("caps a call at the list cap", () => {
    const entries = Array.from({ length: MAX_LOT_LINES + 1 }, (_, i) => `stamp=Mi ${i}; condition=MNH`);
    assert.match(refusal(() => parseLotLines(entries, "lines")), /at most 100/);
    assert.equal(parseLotLines(entries.slice(1), "lines").length, MAX_LOT_LINES);
  });
});

describe("amounts, instants and tags", () => {
  it("reads an amount to the cent and refuses what it would have to guess at", () => {
    assert.equal(parseAuctionAmount("12.5", "ceiling"), "12.50");
    assert.equal(parseAuctionAmount("120", "ceiling"), "120.00");
    for (const value of ["12,50", "12.505", "-3", "1e3", "100000000"]) {
      refusal(() => parseAuctionAmount(value, "ceiling"));
    }
  });

  it("reads a premium in percent, below what the column holds", () => {
    assert.equal(parsePremiumPercent("17.5", "premium_percent"), "17.50");
    refusal(() => parsePremiumPercent("1000", "premium_percent"));
  });

  it("takes an instant only with its time zone", () => {
    assert.equal(parseInstant("2026-10-12T20:00:00+02:00", "ends_at").toISOString(), "2026-10-12T18:00:00.000Z");
    assert.equal(parseInstant("2026-10-12T18:00Z", "ends_at").toISOString(), "2026-10-12T18:00:00.000Z");
    for (const value of ["2026-10-12T20:00:00", "2026-10-12", "tomorrow", "2026-13-40T20:00:00Z"]) {
      assert.match(refusal(() => parseInstant(value, "ends_at")), /time zone/);
    }
  });

  it("takes a tag as one word, one per spelling", () => {
    assert.deepEqual(parseTagNames(["agent-found", "Agent-Found", "danzig"], "tags"), ["agent-found", "danzig"]);
    assert.match(refusal(() => parseTagNames(["agent found"], "tags")), /one word/);
  });
});

describe("a written line, read back", () => {
  const base: LotLineRow = {
    stampId: "s1",
    stampName: "One",
    catalogLabel: "Mi·PL 1",
    conditionId: "c1",
    conditionName: "Mint Never Hinged",
    conditionAbbreviation: "MNH",
    possibleConditionIds: [],
    conditions: [{ conditionId: "c1", conditionName: "Mint Never Hinged", conditionAbbreviation: "MNH" }],
    certificateStatusName: null,
    certificateStatusAbbreviation: null,
    formatName: null,
    formatAbbreviation: null,
    quantity: 1,
    lineValue: "12.00",
    lineValueHigh: null,
  };

  it("states a settled grade", () => {
    assert.deepEqual(lotLine(base), {
      stampId: "s1",
      stamp: "Mi·PL 1",
      condition: "MNH",
      quantity: 1,
      catalogueValue: "12.00",
    });
  });

  it("states the grades an unsettled line may be in, or that any may be", () => {
    const oneOf = lotLine({
      ...base,
      conditionId: null,
      possibleConditionIds: ["c1", "c2"],
      conditions: [
        { conditionId: "c1", conditionName: "Mint Never Hinged", conditionAbbreviation: "MNH" },
        { conditionId: "c2", conditionName: "Mint Hinged", conditionAbbreviation: "MH" },
      ],
      lineValueHigh: "20.00",
    });
    assert.deepEqual(oneOf.possibleConditions, ["MNH", "MH"]);
    assert.equal(oneOf.condition, undefined);
    assert.equal(oneOf.catalogueValueHigh, "20.00");

    const unknown = lotLine({ ...base, conditionId: null, possibleConditionIds: [] });
    assert.equal(unknown.conditionUnknown, true);
    assert.equal(unknown.possibleConditions, undefined);
  });
});
