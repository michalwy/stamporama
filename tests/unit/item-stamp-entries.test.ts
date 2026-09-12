import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describesMoreThanTheStamp,
  parseItemStampEntries,
} from "../../src/lib/item-stamp-entries";

// The stamps on a piece as a form sends them (#746, #750). Two actions read the same field — the
// copy dialog's and the scan-tile identification's — and what is pinned here is that *no list* and
// *an empty list* stay different answers, since the first leaves a copy's stamps alone and the
// second is refused by the domain.

describe("parseItemStampEntries", () => {
  it("reads the rows in order, defaulting what a row leaves out", () => {
    assert.deepEqual(
      parseItemStampEntries(
        JSON.stringify([
          { stampId: "a", quantity: 2, formatId: "blk4" },
          { stampId: "b" },
          { stampId: "c", quantity: 1, formatId: "" },
        ])
      ),
      [
        { stampId: "a", quantity: 2, formatId: "blk4" },
        { stampId: "b", quantity: 1, formatId: null },
        { stampId: "c", quantity: 1, formatId: null },
      ]
    );
  });

  it("is no list at all when there is nothing to read", () => {
    assert.equal(parseItemStampEntries(null), undefined);
    assert.equal(parseItemStampEntries(""), undefined);
    assert.equal(parseItemStampEntries("{not json"), undefined);
    assert.equal(parseItemStampEntries(JSON.stringify({ stampId: "a" })), undefined);
  });

  it("keeps an empty list an empty list, and drops rows naming no stamp", () => {
    assert.deepEqual(parseItemStampEntries("[]"), []);
    assert.deepEqual(parseItemStampEntries(JSON.stringify([null, { quantity: 2 }, { stampId: "" }])), []);
  });
});

describe("describesMoreThanTheStamp", () => {
  it("is false for the one plain entry every ordinary copy carries", () => {
    assert.equal(describesMoreThanTheStamp([{ quantity: 1, formatId: null }]), false);
    assert.equal(describesMoreThanTheStamp([]), false);
  });

  it("is true for a second stamp, a quantity above one, or a component format", () => {
    assert.equal(describesMoreThanTheStamp([{ quantity: 1 }, { quantity: 1 }]), true);
    assert.equal(describesMoreThanTheStamp([{ quantity: 2, formatId: null }]), true);
    assert.equal(describesMoreThanTheStamp([{ quantity: 1, formatId: "blk4" }]), true);
  });
});
