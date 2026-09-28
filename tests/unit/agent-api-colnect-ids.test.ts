import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colnectIdHeld, parseAgentColnectId } from "../../src/lib/agent-api/colnect-ids";
import { ApiError } from "../../src/lib/agent-api/errors";

// The pure half of `set_stamp_colnect_id` (#1445): how the agent's value is read and the refusal an
// ID another stamp holds earns. The operation is driven end to end in
// `tests/integration/agent-api-colnect-ids.test.ts`.

describe("parseAgentColnectId", () => {
  it("reads the value the way the collector's item-ID field reads it (#741)", () => {
    assert.equal(parseAgentColnectId(" 1133075 ", "colnect_id"), "1133075");
    assert.equal(parseAgentColnectId("https://colnect.com/en/stamps/stamp/1133075-X-Poland", "colnect_id"), "1133075");
    assert.equal(parseAgentColnectId("https://colnect.com/pl/stamps/stamp/42", "colnect_id"), "42");
  });

  it("refuses a Colnect address that carries no item-ID", () => {
    assert.throws(
      () => parseAgentColnectId("https://colnect.com/en/stamps/list/country/173", "colnect_id"),
      (err: unknown) => err instanceof ApiError && err.code === "invalid_request" && /colnect_id/.test(err.message)
    );
  });
});

describe("colnectIdHeld", () => {
  it("names each holder with its numbers and id, and puts the ids in accepted", () => {
    const err = colnectIdHeld("1133075", [
      { stampId: "s1", name: "Germania 301", catalogNumbers: ["Mi·DE 301"] },
      { stampId: "s2", name: null, catalogNumbers: [] },
    ]);
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /1133075 already belongs to "Germania 301" \(Mi·DE 301, id s1\) and a stamp \(id s2\)/);
    assert.match(err.message, /Nothing was written/);
    assert.match(err.message, /"clear": true/);
    assert.deepEqual(err.accepted, ["s1", "s2"]);
  });
});
