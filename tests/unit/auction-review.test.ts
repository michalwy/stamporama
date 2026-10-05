import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_LOT_REVIEW_FIELD_LABEL,
  CONFIRMED_API_REVIEW,
  describeApiReview,
  describeSaleApiReview,
  lotReviewFields,
  nextApiReview,
  readApiReviewMark,
  type StoredApiReview,
} from "../../src/lib/auction-review";

// The *to review* marker on lots and sales written through the agent API (#1626): how a write
// accumulates into it, and what its hint says.

const UNMARKED: StoredApiReview = CONFIRMED_API_REVIEW;
const T1 = new Date("2026-10-04T10:00:00.000Z");
const T2 = new Date("2026-10-04T12:30:00.000Z");
const at = (iso: string) => iso.slice(11, 16);

describe("nextApiReview", () => {
  it("marks a record the API created", () => {
    assert.deepEqual(nextApiReview(UNMARKED, { kind: "created" }, T1), {
      apiReviewAt: T1,
      apiReviewCreated: true,
      apiReviewFields: [],
    });
  });

  it("marks a record the API changed, naming the fields", () => {
    assert.deepEqual(nextApiReview(UNMARKED, { kind: "changed", fields: ["ceiling"] }, T1), {
      apiReviewAt: T1,
      apiReviewCreated: false,
      apiReviewFields: ["ceiling"],
    });
  });

  it("adds a later write to an unconfirmed marker rather than replacing it", () => {
    // Created, then given lines and a ceiling, then the ceiling again: the review still has to see
    // that the lot is new, and each field once, in the order first changed.
    let mark = nextApiReview(UNMARKED, { kind: "created" }, T1);
    mark = nextApiReview(mark, { kind: "changed", fields: ["lines", "ceiling"] }, T1);
    mark = nextApiReview(mark, { kind: "changed", fields: ["ceiling", "tags"] }, T2);
    assert.deepEqual(mark, {
      apiReviewAt: T2,
      apiReviewCreated: true,
      apiReviewFields: ["lines", "ceiling", "tags"],
    });
  });

  it("starts afresh on a record confirmed since", () => {
    // The stored `created` and fields of a confirmed record are leftovers, never a marker; a confirm
    // writes them clear anyway, and a stale row must not resurrect them.
    const stale: StoredApiReview = {
      apiReviewAt: null,
      apiReviewCreated: true,
      apiReviewFields: ["title"],
    };
    assert.deepEqual(nextApiReview(stale, { kind: "changed", fields: ["currentBid"] }, T2), {
      apiReviewAt: T2,
      apiReviewCreated: false,
      apiReviewFields: ["currentBid"],
    });
  });
});

describe("lotReviewFields", () => {
  // #1652: a current bid is an observation, recorded without marking.
  it("marks nothing for a call that only refreshed the current bid", () => {
    assert.deepEqual(lotReviewFields(["currentBid"]), []);
  });

  it("marks the other changes of a call that also recorded a current bid, and only them", () => {
    assert.deepEqual(lotReviewFields(["title", "currentBid", "tags"]), ["title", "tags"]);
  });

  it("keeps every other field, in its order", () => {
    assert.deepEqual(lotReviewFields(["endsAt", "url", "notStamps"]), ["endsAt", "url", "notStamps"]);
  });
});

describe("readApiReviewMark", () => {
  it("reads no marker while apiReviewAt is null", () => {
    assert.equal(readApiReviewMark(UNMARKED), null);
  });

  it("reads the marker with its instant as ISO", () => {
    assert.deepEqual(
      readApiReviewMark({ apiReviewAt: T1, apiReviewCreated: true, apiReviewFields: ["lines"] }),
      { at: T1.toISOString(), created: true, fields: ["lines"] }
    );
  });
});

describe("describeApiReview", () => {
  const labels = AUCTION_LOT_REVIEW_FIELD_LABEL;
  it("says the API created it, and when", () => {
    assert.equal(
      describeApiReview({ at: T1.toISOString(), created: true, fields: [] }, labels, at),
      "Added through the agent API on 10:00."
    );
  });

  it("names what the API changed, in the collector's words", () => {
    assert.equal(
      describeApiReview(
        { at: T2.toISOString(), created: false, fields: ["ceiling", "lines"] },
        labels,
        at
      ),
      "Changed through the agent API: ceiling, contents — last on 12:30."
    );
  });

  it("says both when the API created it and then changed it", () => {
    assert.equal(
      describeApiReview({ at: T2.toISOString(), created: true, fields: ["currentBid"] }, labels, at),
      "Added through the agent API, then changed: current bid — last on 12:30."
    );
  });

  it("shows a field it has no word for as it is, rather than nothing", () => {
    assert.equal(
      describeApiReview({ at: T2.toISOString(), created: false, fields: ["someNewField"] }, labels, at),
      "Changed through the agent API: someNewField — last on 12:30."
    );
  });
});

describe("describeSaleApiReview", () => {
  it("counts the sale's lots that wait", () => {
    assert.equal(
      describeSaleApiReview(null, 3, at),
      "3 lots in this sale were written through the agent API and wait for you to confirm them."
    );
    assert.equal(
      describeSaleApiReview(null, 1, at),
      "1 lot in this sale was written through the agent API and waits for you to confirm it."
    );
  });

  it("says what was done to the sale itself, then the lots", () => {
    assert.equal(
      describeSaleApiReview({ at: T1.toISOString(), created: false, fields: ["premium"] }, 2, at),
      "Changed through the agent API: premium — last on 10:00. 2 lots in this sale were written through the agent API and wait for you to confirm them."
    );
  });
});
