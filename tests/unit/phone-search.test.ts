import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionSearchStamp } from "../../src/lib/collection-search";
import { phoneSearchHit, phoneSearchMiss } from "../../src/lib/phone-search-view";

// The phone search (#2004, ADR-0072): what one hit of the desk's search says on a phone row —
// which stamp, how many held, whether wanted.

function stamp(over: Partial<CollectionSearchStamp> = {}): CollectionSearchStamp {
  return {
    stampId: "s1",
    stampNo: 901,
    name: "Eagle",
    issuedYear: 1924,
    areaName: "Poland",
    issueName: "Coat of arms",
    issueYear: 1924,
    catalogNumbers: [
      { label: "Mi·PL 200", isPrimary: true },
      { label: "Fi·PL 180", isPrimary: false },
    ],
    photoId: null,
    subtype: null,
    hasVariants: false,
    isVariant: false,
    copies: 0,
    variantCopies: 0,
    wants: null,
    path: "/c/poland/stamps/s1",
    ...over,
  };
}

describe("phoneSearchHit", () => {
  it("names the stamp, its numbers and where it sits", () => {
    const hit = phoneSearchHit(stamp());
    assert.equal(hit.title, "Eagle");
    assert.equal(hit.numbers, "Mi·PL 200 · Fi·PL 180 · #901");
    assert.equal(hit.place, "Poland · 1924, Coat of arms");
  });

  it("falls back to the leading catalogue number, then the short number, for a title", () => {
    assert.equal(phoneSearchHit(stamp({ name: null })).title, "Mi·PL 200");
    assert.equal(phoneSearchHit(stamp({ name: null, catalogNumbers: [] })).title, "Stamp #901");
  });

  it("says plainly when nothing is held", () => {
    const hit = phoneSearchHit(stamp());
    assert.equal(hit.held, "Not held");
    assert.equal(hit.isHeld, false);
  });

  it("states the copies held, and the variants' figure beside them", () => {
    assert.equal(phoneSearchHit(stamp({ copies: 3 })).held, "3 held");
    const umbrella = phoneSearchHit(stamp({ hasVariants: true, variantCopies: 2 }));
    assert.equal(umbrella.held, "Not held · 2 under its variants");
    assert.equal(umbrella.isHeld, true);
  });

  it("marks a stamp with open wants, naming a priority that is not normal", () => {
    assert.equal(phoneSearchHit(stamp()).wanted, null);
    const wants = (topPriority: "high" | "normal" | "low") => ({
      openCount: 1,
      topPriority,
      wants: [],
    });
    assert.equal(phoneSearchHit(stamp({ wants: wants("normal") })).wanted, "Wanted");
    assert.equal(phoneSearchHit(stamp({ wants: wants("high") })).wanted, "Wanted · high priority");
  });

  it("leaves the place out when nothing is known of it", () => {
    const hit = phoneSearchHit(
      stamp({ areaName: null, issueName: null, issueYear: null, issuedYear: null })
    );
    assert.equal(hit.place, "");
  });
});

describe("phoneSearchMiss", () => {
  it("names what was searched for", () => {
    assert.equal(phoneSearchMiss("Mi PL 9999"), "No stamp matches “Mi PL 9999”.");
  });
});
