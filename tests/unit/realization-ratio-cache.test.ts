import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  REALIZATION_RATIO_TTL_MS,
  cachedRealizationRatios,
  forgetRealizationRatios,
} from "@/lib/realization-ratio-cache";

// #2426 — the learned ratios were learned again from every closed lot and every price observation
// of the collection on every offer read. Settled with the collector on 2026-11-04: kept for five
// minutes, learned again at once after a write they are learned from.

describe("the learned ratios, kept", () => {
  beforeEach(() => forgetRealizationRatios());

  function counter() {
    let loads = 0;
    return {
      load: async () => ++loads,
      get loads() {
        return loads;
      },
    };
  }

  it("learns once and answers every read within five minutes from that", async () => {
    const c = counter();
    const t = 1_000_000;
    assert.equal(await cachedRealizationRatios("a", c.load, t), 1);
    assert.equal(await cachedRealizationRatios("a", c.load, t + REALIZATION_RATIO_TTL_MS - 1), 1);
    assert.equal(c.loads, 1);
  });

  it("shares one load among the reads that ask while it runs", async () => {
    const c = counter();
    const [x, y] = await Promise.all([
      cachedRealizationRatios("a", c.load, 0),
      cachedRealizationRatios("a", c.load, 0),
    ]);
    assert.equal(x, y);
    assert.equal(c.loads, 1);
  });

  it("learns again after five minutes", async () => {
    const c = counter();
    await cachedRealizationRatios("a", c.load, 0);
    assert.equal(await cachedRealizationRatios("a", c.load, REALIZATION_RATIO_TTL_MS), 2);
  });

  it("learns again at once after a write it is learned from", async () => {
    const c = counter();
    await cachedRealizationRatios("a", c.load, 0);
    forgetRealizationRatios();
    assert.equal(await cachedRealizationRatios("a", c.load, 1), 2);
  });

  it("keeps each collection's own", async () => {
    const c = counter();
    await cachedRealizationRatios("a", c.load, 0);
    await cachedRealizationRatios("b", c.load, 0);
    assert.equal(c.loads, 2);
  });

  it("does not keep a load that failed", async () => {
    await assert.rejects(cachedRealizationRatios("a", () => Promise.reject(new Error("db")), 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await cachedRealizationRatios("a", async () => 7, 1), 7);
  });
});
