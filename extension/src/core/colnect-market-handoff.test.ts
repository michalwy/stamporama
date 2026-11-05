import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MARKET_MAX_ITEMS, parseMarketHandoff } from "./colnect-market-handoff";

// The Colnect market handoff (#2454): what the page writes, as the extension accepts it.

const task = (items: unknown) =>
  JSON.stringify({ v: 1, requestId: "r1", task: { offerId: "o1", collectionId: "c1", items } });

describe("parseMarketHandoff (#2454)", () => {
  it("reads the items, deduplicated", () => {
    const h = parseMarketHandoff(
      task([
        { colnectId: "60512", label: "Mi·PT 789" },
        { colnectId: "60512", label: "Mi·PT 789" },
        { colnectId: "1133075", label: "" },
      ])
    );
    assert.deepEqual(h?.task.items, [
      { colnectId: "60512", label: "Mi·PT 789" },
      { colnectId: "1133075", label: "1133075" },
    ]);
  });

  it("refuses an item id that is not a plain Colnect id — it goes into a path on Colnect", () => {
    assert.equal(parseMarketHandoff(task([{ colnectId: "60512/../sell", label: "x" }])), null);
  });

  it("refuses a task with nothing to read, or more than a read is for", () => {
    assert.equal(parseMarketHandoff(task([])), null);
    const many = Array.from({ length: MARKET_MAX_ITEMS + 1 }, (_, i) => ({ colnectId: String(i + 1) }));
    assert.equal(parseMarketHandoff(task(many)), null);
  });

  it("refuses what is not a handoff", () => {
    assert.equal(parseMarketHandoff(""), null);
    assert.equal(parseMarketHandoff("{"), null);
    assert.equal(parseMarketHandoff(JSON.stringify({ v: 2, requestId: "r", task: {} })), null);
  });
});
