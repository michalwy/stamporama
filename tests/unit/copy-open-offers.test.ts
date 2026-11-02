import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type ItemOpenOffer,
  isOwnOffer,
  openOfferChip,
  openOfferHint,
} from "../../src/lib/copy-open-offers";

function offer(over: Partial<ItemOpenOffer> = {}): ItemOpenOffer {
  return {
    offerId: "o1",
    offerNo: 3012,
    platformName: "Facebook",
    state: "active",
    proposalId: null,
    facebookPostId: null,
    ...over,
  };
}

describe("openOfferChip (#2337)", () => {
  it("shows nothing for a copy in no open offer", () => {
    assert.equal(openOfferChip([]), null);
  });

  it("names the one offer by its platform and number", () => {
    const chip = openOfferChip([offer()]);
    assert.equal(chip?.label, "Facebook #3012");
    assert.equal(chip?.state, "active");
  });

  it("counts several offers and takes the colour of the furthest along", () => {
    const chip = openOfferChip([
      offer({ offerId: "a", offerNo: 1, state: "preparing" }),
      offer({ offerId: "b", offerNo: 2, state: "active", platformName: "Colnect" }),
      offer({ offerId: "c", offerNo: 3, state: "paused" }),
    ]);
    assert.equal(chip?.label, "On 3 offers");
    assert.equal(chip?.state, "active");
    assert.deepEqual(chip?.offers.map((o) => o.offerId), ["b", "c", "a"]);
  });

  it("ranks a live pending listing above a paused one", () => {
    const chip = openOfferChip([
      offer({ offerId: "a", state: "paused" }),
      offer({ offerId: "b", state: "pending" }),
    ]);
    assert.equal(chip?.state, "pending");
  });

  it("counts every open state, a Preparing offer included, and never a sold or withdrawn one", () => {
    for (const state of ["preparing", "ready", "pending", "active", "paused"] as const) {
      assert.ok(openOfferChip([offer({ state })]), state);
    }
    assert.equal(openOfferChip([offer({ state: "sold" }), offer({ offerId: "w", state: "withdrawn" })]), null);
  });

  it("counts an offer once when the copy sits in two of its sets", () => {
    assert.equal(openOfferChip([offer(), offer()])?.label, "Facebook #3012");
  });

  it("leaves out the screen's own offer, proposal lots or post lots", () => {
    const own = offer({ offerId: "own" });
    const lot = offer({ offerId: "lot", proposalId: "p1" });
    const postLot = offer({ offerId: "post", facebookPostId: "f1" });
    const other = offer({ offerId: "other", offerNo: 7, platformName: "Colnect" });
    assert.equal(openOfferChip([own, other], { offerId: "own" })?.label, "Colnect #7");
    assert.equal(openOfferChip([lot, other], { proposalId: "p1" })?.label, "Colnect #7");
    assert.equal(openOfferChip([postLot, other], { facebookPostId: "f1" })?.label, "Colnect #7");
    assert.equal(openOfferChip([own], { offerId: "own" }), null);
    // Another proposal's lot still counts.
    assert.equal(openOfferChip([lot], { proposalId: "p2" })?.label, "Facebook #3012");
  });

  it("never treats a null scope as matching an offer with no proposal or post", () => {
    assert.equal(isOwnOffer(offer(), { proposalId: null, facebookPostId: null }), false);
    assert.equal(isOwnOffer(offer(), undefined), false);
  });

  it("lists every offer with its state in the hint", () => {
    const chip = openOfferChip([
      offer({ offerId: "a", offerNo: 1, state: "ready" }),
      offer({ offerId: "b", offerNo: 2, state: "active", platformName: "Colnect" }),
    ])!;
    assert.equal(
      openOfferHint(chip),
      "In an open offer: Colnect #2 · Active, Facebook #1 · Ready. Click to view its offers."
    );
  });
});
