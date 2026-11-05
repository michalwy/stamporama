import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { platformsOffered } from "../../src/lib/platform-choice-rules";

const platforms = [
  { id: "a", name: "Allegro", enabled: false },
  { id: "c", name: "Colnect", enabled: true },
  { id: "d", name: "Delcampe", enabled: true },
  { id: "e", name: "eBay", enabled: false },
];

describe("platformsOffered (#2432)", () => {
  it("offers the switched-on platforms only, in the order read", () => {
    assert.deepEqual(platformsOffered(platforms, "").map((p) => p.id), ["c", "d"]);
  });

  it("keeps a switched-off platform the record already names, in its place", () => {
    assert.deepEqual(platformsOffered(platforms, "a").map((p) => p.id), ["a", "c", "d"]);
    assert.deepEqual(platformsOffered(platforms, "e").map((p) => p.id), ["c", "d", "e"]);
  });

  it("adds nothing for a chosen platform that is not among them", () => {
    assert.deepEqual(platformsOffered(platforms, "gone").map((p) => p.id), ["c", "d"]);
  });
});
