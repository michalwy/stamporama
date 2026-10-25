import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baseStampHeldMessage,
  variantHeldMessage,
  variantHolderPhrases,
  type VariantHolders,
} from "../../src/lib/agent-api/variant-tree";

// The pure half of `delete_stamp_variant` (#2140) and `delete_stamp` (#2171): what keeps a stamp from
// being deleted and the sentence the refusal is. The operations are driven end to end in
// `tests/integration/agent-api-variant-tree.test.ts`.

const NOTHING: VariantHolders = {
  copyNos: [],
  offerNos: [],
  wants: 0,
  auctionLines: 0,
  priceObservations: 0,
  tradeLines: 0,
  variantNos: [],
};

describe("variantHeldMessage", () => {
  it("is null when nothing names the variant", () => {
    assert.deepEqual(variantHolderPhrases(NOTHING), []);
    assert.equal(variantHeldMessage("Mi 240a", NOTHING), null);
  });

  it("names every holder the collector listed, copies, offers and variants by number", () => {
    const message = variantHeldMessage("Mi 240a (st 12)", {
      copyNos: [7, 9],
      offerNos: [3],
      wants: 1,
      auctionLines: 2,
      priceObservations: 1,
      tradeLines: 1,
      variantNos: [14],
    });
    assert.ok(message);
    assert.match(message, /^Mi 240a \(st 12\) is not deleted/);
    for (const part of [
      "2 copies (#7, #9)",
      "1 offer (#3)",
      "1 want",
      "2 auction lot lines",
      "1 price observation",
      "1 trade line",
      "1 variant of its own (st 14)",
    ]) {
      assert.ok(message.includes(part), `${part} missing from: ${message}`);
    }
    assert.match(message, /Nothing was changed\.$/);
  });

  it("names a single holder alone", () => {
    assert.deepEqual(variantHolderPhrases({ ...NOTHING, wants: 3 }), ["3 wants"]);
  });
});

describe("baseStampHeldMessage (#2171)", () => {
  it("is null when nothing names the base stamp", () => {
    assert.equal(baseStampHeldMessage("Mi 240 (st 3)", NOTHING), null);
  });

  it("refuses a base stamp on the variant's list, its own variants on it", () => {
    const message = baseStampHeldMessage("Mi 240 (st 3)", { ...NOTHING, copyNos: [5], variantNos: [8, 9] });
    assert.ok(message);
    assert.match(message, /^Mi 240 \(st 3\) is not deleted/);
    assert.ok(message.includes("1 copy (#5)"), message);
    assert.ok(message.includes("2 variants of its own (st 8, st 9)"), message);
    assert.match(message, /A base stamp is deleted only when nothing names it/);
    assert.match(message, /Nothing was changed\.$/);
  });
});
