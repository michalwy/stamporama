import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collidingItemIdsByOffer,
  type CollisionCopy,
  type OfferMemberCopy,
} from "../../src/lib/offer-collision-rules";

const copy = (itemId: string, stampId: string, conditionId: string): CollisionCopy => ({
  itemId,
  stampId,
  conditionId,
});

const member = (
  offerId: string,
  itemId: string,
  stampId: string,
  conditionId: string
): OfferMemberCopy => ({ offerId, itemId, stampId, conditionId });

describe("collidingItemIdsByOffer", () => {
  it("reports a candidate whose stamp + condition another copy on the offer already holds", () => {
    const out = collidingItemIdsByOffer(
      [copy("new", "s1", "mnh")],
      [member("o1", "old", "s1", "mnh")]
    );
    assert.deepEqual([...out], [["o1", ["new"]]]);
  });

  it("does not collide across conditions — Colnect's rule is per condition", () => {
    const out = collidingItemIdsByOffer(
      [copy("new", "s1", "used")],
      [member("o1", "old", "s1", "mnh")]
    );
    assert.equal(out.size, 0);
  });

  it("does not collide across stamps", () => {
    const out = collidingItemIdsByOffer(
      [copy("new", "s2", "mnh")],
      [member("o1", "old", "s1", "mnh")]
    );
    assert.equal(out.size, 0);
  });

  it("ignores format and certificate — two copies of one stamp in one condition are one offer", () => {
    // The candidate is a block with a certificate, the listed one a plain single: still a conflict.
    const out = collidingItemIdsByOffer(
      [copy("new", "s1", "mnh")],
      [member("o1", "old", "s1", "mnh")]
    );
    assert.deepEqual(out.get("o1"), ["new"]);
  });

  it("leaves out a candidate the offer already lists — that is `containsItemIds`' fact", () => {
    const out = collidingItemIdsByOffer(
      [copy("a", "s1", "mnh")],
      [member("o1", "a", "s1", "mnh")]
    );
    assert.equal(out.size, 0);
  });

  it("still reports the *other* candidates when one of them is the copy already listed", () => {
    const out = collidingItemIdsByOffer(
      [copy("a", "s1", "mnh"), copy("b", "s1", "mnh")],
      [member("o1", "a", "s1", "mnh")]
    );
    // `a` is already here; `b` is a second copy of the same stamp+condition, which is the conflict.
    assert.deepEqual(out.get("o1"), ["b"]);
  });

  it("groups per offer and omits offers with nothing to report", () => {
    const out = collidingItemIdsByOffer(
      [copy("x", "s1", "mnh"), copy("y", "s2", "used")],
      [
        member("o1", "p", "s1", "mnh"),
        member("o2", "q", "s3", "mnh"),
        member("o3", "r", "s1", "mnh"),
        member("o3", "s", "s2", "used"),
      ]
    );
    assert.deepEqual(out.get("o1"), ["x"]);
    assert.equal(out.has("o2"), false);
    assert.deepEqual(out.get("o3"), ["x", "y"]);
    assert.equal(out.size, 2);
  });

  it("is empty with no candidates or no members", () => {
    assert.equal(collidingItemIdsByOffer([], [member("o1", "a", "s1", "mnh")]).size, 0);
    assert.equal(collidingItemIdsByOffer([copy("a", "s1", "mnh")], []).size, 0);
  });
});
