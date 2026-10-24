import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { variantHeldMessage, variantHolderPhrases, type VariantHolders } from "../../src/lib/agent-api/variant-tree";

// The pure half of `delete_stamp_variant` (#2140): what keeps a variant from being deleted and the
// sentence the refusal is. The operations are driven end to end in
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
