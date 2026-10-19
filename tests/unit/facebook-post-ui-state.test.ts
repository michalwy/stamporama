import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FACEBOOK_POST_UI_STATE,
  facebookLotsInView,
  isFacebookLotForSale,
  parseFacebookPostUiState,
  serializeFacebookPostUiState,
} from "../../src/lib/facebook-post-ui-state";
import type { OfferState } from "../../src/lib/offer-rules";

describe("parseFacebookPostUiState", () => {
  it("reads a post never narrowed as every lot listed", () => {
    assert.deepEqual(parseFacebookPostUiState(null), EMPTY_FACEBOOK_POST_UI_STATE);
  });

  it("reads the chip back", () => {
    assert.deepEqual(parseFacebookPostUiState('{"stillForSale":true}'), { stillForSale: true });
  });

  it("degrades a malformed entry to the default rather than throwing", () => {
    assert.deepEqual(parseFacebookPostUiState("{not json"), EMPTY_FACEBOOK_POST_UI_STATE);
    assert.deepEqual(parseFacebookPostUiState("[true]"), EMPTY_FACEBOOK_POST_UI_STATE);
    assert.deepEqual(parseFacebookPostUiState('{"stillForSale":"yes"}'), EMPTY_FACEBOOK_POST_UI_STATE);
  });
});

describe("serializeFacebookPostUiState", () => {
  it("stores nothing for a post listing every lot, so it takes no slot", () => {
    assert.equal(serializeFacebookPostUiState({ stillForSale: false }), null);
  });

  it("round-trips through the parser", () => {
    assert.deepEqual(parseFacebookPostUiState(serializeFacebookPostUiState({ stillForSale: true })), {
      stillForSale: true,
    });
  });
});

describe("Still for sale (#2081)", () => {
  const lots: { id: string; state: OfferState }[] = [
    { id: "1", state: "active" },
    { id: "2", state: "sold" },
    { id: "3", state: "paused" },
    { id: "4", state: "withdrawn" },
    { id: "5", state: "pending" },
  ];

  it("is every lot neither sold nor withdrawn, as the list of posts counts for sale", () => {
    assert.deepEqual(
      lots.filter((l) => isFacebookLotForSale(l.state)).map((l) => l.id),
      ["1", "3", "5"]
    );
  });

  it("narrows the lots in their order while on, and lists them all while off", () => {
    assert.deepEqual(facebookLotsInView(lots, true).map((l) => l.id), ["1", "3", "5"]);
    assert.deepEqual(facebookLotsInView(lots, false).map((l) => l.id), ["1", "2", "3", "4", "5"]);
  });
});
