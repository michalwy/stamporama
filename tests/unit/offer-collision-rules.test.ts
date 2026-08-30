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

/** A copy listed on an offer. The set defaults to the offer's own id — the ordinary
 * one-composition offer — so only the tests that care about sets have to name them. */
const member = (
  offerId: string,
  itemId: string,
  stampId: string,
  conditionId: string,
  offerSetId = `${offerId}-set`
): OfferMemberCopy => ({ offerId, offerSetId, itemId, stampId, conditionId });

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

  it("stays silent on one stamp out of a listed series — a single is not that entry (#732)", () => {
    const series = [
      member("o1", "p1", "s1", "mnh"),
      member("o1", "p2", "s2", "mnh"),
      member("o1", "p3", "s3", "mnh"),
    ];
    assert.equal(collidingItemIdsByOffer([copy("x", "s2", "mnh")], series).size, 0);
  });

  it("collides when the selection is the whole listed series (#732)", () => {
    const series = [
      member("o1", "p1", "s1", "mnh"),
      member("o1", "p2", "s2", "mnh"),
      member("o1", "p3", "s3", "mnh"),
    ];
    const out = collidingItemIdsByOffer(
      [copy("x1", "s1", "mnh"), copy("x2", "s2", "mnh"), copy("x3", "s3", "mnh")],
      series
    );
    assert.deepEqual(out.get("o1"), ["x1", "x2", "x3"]);
  });

  it("stays silent when the selection reaches past the listed set", () => {
    const out = collidingItemIdsByOffer(
      [copy("x1", "s1", "mnh"), copy("x2", "s2", "mnh"), copy("x3", "s3", "mnh")],
      [member("o1", "p1", "s1", "mnh"), member("o1", "p2", "s2", "mnh")]
    );
    assert.equal(out.size, 0);
  });

  it("collides on several sets' worth of the same series — quantity is not the question", () => {
    // Two prospective sets of 1–2: the same marketplace entry, offered more of.
    const out = collidingItemIdsByOffer(
      [
        copy("x1", "s1", "mnh"),
        copy("x2", "s2", "mnh"),
        copy("y1", "s1", "mnh"),
        copy("y2", "s2", "mnh"),
      ],
      [member("o1", "p1", "s1", "mnh"), member("o1", "p2", "s2", "mnh")]
    );
    assert.deepEqual(out.get("o1"), ["x1", "x2", "y1", "y2"]);
  });

  it("compares set by set, so a mixed offer matches on whichever set fits", () => {
    const out = collidingItemIdsByOffer(
      [copy("x", "s3", "mnh")],
      [
        member("o1", "p1", "s1", "mnh", "o1-a"),
        member("o1", "p2", "s2", "mnh", "o1-a"),
        member("o1", "p3", "s3", "mnh", "o1-b"),
      ]
    );
    assert.deepEqual(out.get("o1"), ["x"]);
  });

  it("does not read an offer's sets as one pooled composition", () => {
    // Its two sets are {s1} and {s2}; a selection of {s1,s2} is a third entry, not either of them.
    const out = collidingItemIdsByOffer(
      [copy("x", "s1", "mnh"), copy("y", "s2", "mnh")],
      [member("o1", "p1", "s1", "mnh", "o1-a"), member("o1", "p2", "s2", "mnh", "o1-b")]
    );
    assert.equal(out.size, 0);
  });

  it("groups per offer and omits offers with nothing to report", () => {
    const out = collidingItemIdsByOffer(
      [copy("x", "s1", "mnh"), copy("y", "s2", "used")],
      [
        member("o1", "p", "s1", "mnh"),
        member("o1", "p2", "s2", "used"),
        member("o2", "q", "s3", "mnh"),
        member("o3", "r", "s1", "mnh"),
        member("o3", "s", "s2", "used"),
      ]
    );
    assert.deepEqual(out.get("o1"), ["x", "y"]);
    assert.equal(out.has("o2"), false);
    assert.deepEqual(out.get("o3"), ["x", "y"]);
    assert.equal(out.size, 2);
  });

  it("is empty with no candidates or no members", () => {
    assert.equal(collidingItemIdsByOffer([], [member("o1", "a", "s1", "mnh")]).size, 0);
    assert.equal(collidingItemIdsByOffer([copy("a", "s1", "mnh")], []).size, 0);
  });
});
