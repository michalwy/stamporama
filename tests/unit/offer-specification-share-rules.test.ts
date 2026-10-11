import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferSpecificationShareTokenShape,
  OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX,
  offerSpecificationSharePath,
  offerSpecificationSharePhotoPath,
} from "../../src/lib/offer-specification-share-rules";

// A buyer's link to an offer's specification (#1760) — the pure half.

describe("the specification share link (#1760)", () => {
  it("accepts its own prefix with something after it", () => {
    assert.equal(isOfferSpecificationShareTokenShape(`${OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX}abc`), true);
  });

  it("rejects the prefix alone, an empty string and every other credential", () => {
    assert.equal(isOfferSpecificationShareTokenShape(OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX), false);
    assert.equal(isOfferSpecificationShareTokenShape(""), false);
    for (const other of ["stmpa_abc", "stmpx_abc", "stmps_abc", "stmpr_abc"]) {
      assert.equal(isOfferSpecificationShareTokenShape(other), false, other);
    }
  });

  it("addresses the page and its thumbnails outside any collection", () => {
    assert.equal(offerSpecificationSharePath("stmpo_x"), "/spec/stmpo_x");
    assert.equal(offerSpecificationSharePhotoPath("stmpo_x", "p1"), "/api/spec/stmpo_x/photos/p1");
  });
});
