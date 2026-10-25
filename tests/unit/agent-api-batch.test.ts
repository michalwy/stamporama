import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkBatchSize,
  countStatuses,
  parseLineFields,
  parsePairFields,
  refusalOf,
} from "../../src/lib/agent-api/batch";
import { splitCatalogNumberList } from "../../src/lib/agent-api/catalog-edits";
import { ApiError, invalidRequest } from "../../src/lib/agent-api/errors";
import type { ParameterSpec } from "../../src/lib/agent-api/types";

// The pure half every batch form of a single write shares (#2173, #2174, #2175): the size cap, the
// two item grammars and the per-item answer. The three operations are driven end to end in
// `tests/integration/agent-api-batch-writes.test.ts`.

describe("checkBatchSize", () => {
  it("refuses an empty batch and one over the cap, saying to send the rest in a second call", () => {
    assert.throws(() => checkBatchSize([], "pairs", 100, "pair", "`x`"), /at least one pair/);
    assert.throws(
      () => checkBatchSize(Array(101).fill("x"), "pairs", 100, "pair", "`x`"),
      (err: unknown) => err instanceof ApiError && /101 pairs; one call takes at most 100/.test(err.message)
    );
    checkBatchSize(Array(100).fill("x"), "pairs", 100, "pair", "`x`");
  });
});

describe("parsePairFields", () => {
  const FIELDS = ["stamp", "colnect_id"] as const;

  it("reads `name=value` pairs, the value split off at its first `=` only", () => {
    const parsed = parsePairFields(
      " stamp=Mi 301 ;COLNECT_ID=https://colnect.com/en/stamps/stamp/1133075?x=1; ",
      FIELDS,
      "`e`"
    );
    assert.ok(parsed.ok);
    assert.deepEqual(Object.fromEntries(parsed.fields), {
      stamp: "Mi 301",
      colnect_id: "https://colnect.com/en/stamps/stamp/1133075?x=1",
    });
  });

  it("refuses a pair that is not `name=value`, an unknown field, a field twice and a missing one", () => {
    for (const [entry, reason] of [
      ["stamp Mi 301; colnect_id=1", /is not `name=value`/],
      ["stamp=Mi 301; colnect=1", /"colnect" is not a field here; an entry takes stamp and colnect_id/],
      ["stamp=Mi 301; stamp=Mi 302; colnect_id=1", /names "stamp" twice/],
      ["stamp=Mi 301", /has no colnect_id/],
      ["stamp=; colnect_id=1", /is not `name=value`/],
    ] as const) {
      const parsed = parsePairFields(entry, FIELDS, "`e`");
      assert.equal(parsed.ok, false, entry);
      if (!parsed.ok) assert.match(parsed.reason, reason);
    }
  });
});

describe("parseLineFields", () => {
  const SPECS: ParameterSpec[] = [
    { name: "area", in: "body", type: "string", required: true, description: "" },
    { name: "year", in: "body", type: "integer", required: false, description: "" },
    { name: "catalog_numbers", in: "body", type: "string[]", required: false, description: "" },
  ];

  it("builds the single call's body, a list field repeated a line each and every value left as text", () => {
    const parsed = parseLineFields(
      "area=Poland\r\n\nYEAR=1950\ncatalog_numbers=Mi: 500-505, 507\ncatalog_numbers=Fi: 600-606\n",
      SPECS,
      "`e`"
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.body, { area: "Poland", year: "1950", catalog_numbers: ["Mi: 500-505, 507", "Fi: 600-606"] });
  });

  it("refuses a line that names no field, a field with no value, and a single field twice", () => {
    for (const [entry, reason] of [
      ["area=Poland\nname=Definitives", /"name=Definitives" does not start with a field.*area, year, catalog_numbers/],
      ["Poland", /does not start with a field/],
      ["area=", /"area" is given no value/],
      ["area=Poland\narea=Germany", /names "area" twice; it takes one value\. Only catalog_numbers are repeated/],
    ] as const) {
      const parsed = parseLineFields(entry, SPECS, "`e`");
      assert.equal(parsed.ok, false, entry);
      if (!parsed.ok) assert.match(parsed.reason, reason);
    }
  });
});

describe("refusalOf", () => {
  it("answers an ApiError with its own sentence and the ids it names", () => {
    assert.deepEqual(refusalOf(3, invalidRequest("Held by s1.", ["s1"])), {
      index: 3,
      status: "refused",
      reason: "Held by s1.",
      accepted: ["s1"],
    });
    assert.deepEqual(refusalOf(0, invalidRequest("No.")), { index: 0, status: "refused", reason: "No." });
  });

  it("never relays a defect's own message", () => {
    const answer = refusalOf(1, new Error("P2002 Unique constraint failed on stamp_cuid_xyz"));
    assert.equal(answer.status, "refused");
    assert.doesNotMatch(answer.reason, /P2002|cuid/);
    assert.match(answer.reason, /Send it again alone/);
  });
});

describe("countStatuses", () => {
  it("states every status, a zero included", () => {
    assert.deepEqual(
      countStatuses([{ status: "written" }, { status: "refused" }, { status: "written" }], ["written", "unchanged", "refused"]),
      { written: 2, unchanged: 0, refused: 1 }
    );
  });
});

describe("splitCatalogNumberList", () => {
  it("splits an update's numbers into update_stamp's entries", () => {
    assert.deepEqual(splitCatalogNumberList(" Mi: 124a, Fi: 456 ,, "), ["Mi: 124a", "Fi: 456"]);
  });
});
