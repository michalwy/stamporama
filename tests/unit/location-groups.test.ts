import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareLocationGroups,
  locationGroupKey,
  NO_LOCATION,
  NO_LOCATION_REF,
} from "../../src/lib/location-groups";

// Grouping the Copies list by where copies are filed (#421). What is worth pinning down is the
// *reading order* — the whole reason the grouping is paged in memory rather than in SQL — and that
// the key tells two groups apart without a free-text ref being able to collide with another.

describe("compareLocationGroups", () => {
  const g = (locationPath: string | null, locationRef: string | null = null) => ({
    locationPath,
    locationRef,
  });

  it("orders by location path", () => {
    const sorted = [g("Szafa 2 › Klaser B"), g("Szafa 1 › Klaser A"), g("Szafa 1 › Klaser B")].sort(
      compareLocationGroups
    );
    assert.deepEqual(
      sorted.map((s) => s.locationPath),
      ["Szafa 1 › Klaser A", "Szafa 1 › Klaser B", "Szafa 2 › Klaser B"]
    );
  });

  it("puts the unfiled copies last", () => {
    const sorted = [g(null), g("Szafa 1")].sort(compareLocationGroups);
    assert.deepEqual(
      sorted.map((s) => s.locationPath),
      ["Szafa 1", null]
    );
  });

  it("orders refs inside one location by prefix then number, blanks last", () => {
    const sorted = [
      g("Klaser A", "A100"),
      g("Klaser A", null),
      g("Klaser A", "B3"),
      g("Klaser A", "A-20"),
    ].sort(compareLocationGroups);
    assert.deepEqual(
      sorted.map((s) => s.locationRef),
      ["A-20", "A100", "B3", null]
    );
  });

  it("keeps the path ahead of the ref", () => {
    const sorted = [g("Klaser B", "A1"), g("Klaser A", "Z9")].sort(compareLocationGroups);
    assert.deepEqual(
      sorted.map((s) => s.locationPath),
      ["Klaser A", "Klaser B"]
    );
  });
});

describe("locationGroupKey", () => {
  it("ignores the ref outside ref mode", () => {
    assert.equal(
      locationGroupKey({ locationId: "loc1", locationRef: "A1" }, "location"),
      locationGroupKey({ locationId: "loc1", locationRef: "B2" }, "location")
    );
  });

  it("separates two refs in the same location", () => {
    assert.notEqual(
      locationGroupKey({ locationId: "loc1", locationRef: "A1" }, "ref"),
      locationGroupKey({ locationId: "loc1", locationRef: "A2" }, "ref")
    );
  });

  it("separates the same ref in two locations", () => {
    assert.notEqual(
      locationGroupKey({ locationId: "loc1", locationRef: "A1" }, "ref"),
      locationGroupKey({ locationId: "loc2", locationRef: "A1" }, "ref")
    );
  });

  it("gives the unfiled bucket its own key", () => {
    assert.notEqual(
      locationGroupKey({ locationId: null, locationRef: null }, "location"),
      locationGroupKey({ locationId: "loc1", locationRef: null }, "location")
    );
  });

  it("cannot be spoofed by a ref that looks like another key", () => {
    assert.notEqual(
      locationGroupKey({ locationId: "loc1", locationRef: '","loc2' }, "ref"),
      locationGroupKey({ locationId: "loc1", locationRef: "loc2" }, "ref")
    );
  });
});

describe("the filing sentinels", () => {
  it("are values a cuid can never be", () => {
    assert.equal(NO_LOCATION, "none");
    assert.equal(NO_LOCATION_REF, "none");
  });
});
