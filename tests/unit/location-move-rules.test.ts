import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCATION_MOVE_SOURCES,
  locationMoveDirection,
  locationMoveSourceLabel,
  locationSubtreeIds,
  moveDayRange,
  parseMoveDay,
} from "../../src/lib/location-move-rules";

// The rules a copy's location history (#2277) is read by. The database writes the entries; what is
// pinned here is how they are read back — which way an entry went for a location that groups others,
// and the day range the location's history is narrowed to.

const tree = [
  { id: "cabinet", parentId: null },
  { id: "shelf", parentId: "cabinet" },
  { id: "book-a", parentId: "shelf" },
  { id: "book-b", parentId: "cabinet" },
  { id: "safe", parentId: null },
];

describe("locationSubtreeIds", () => {
  it("holds the location and everything under it, at any depth", () => {
    assert.deepEqual(new Set(locationSubtreeIds(tree, "cabinet")), new Set(["cabinet", "shelf", "book-a", "book-b"]));
    assert.deepEqual(locationSubtreeIds(tree, "book-a"), ["book-a"]);
  });

  it("survives a cycle in the data rather than looping", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    assert.deepEqual(new Set(locationSubtreeIds(cyclic, "a")), new Set(["a", "b"]));
  });
});

describe("locationMoveDirection", () => {
  const cabinet = new Set(locationSubtreeIds(tree, "cabinet"));

  it("is in, out or within, seen from the location and everything under it", () => {
    assert.equal(locationMoveDirection({ fromLocationId: "safe", toLocationId: "book-a" }, cabinet), "in");
    assert.equal(locationMoveDirection({ fromLocationId: null, toLocationId: "book-b" }, cabinet), "in");
    assert.equal(locationMoveDirection({ fromLocationId: "book-a", toLocationId: null }, cabinet), "out");
    assert.equal(locationMoveDirection({ fromLocationId: "book-a", toLocationId: "safe" }, cabinet), "out");
  });

  it("is within for a move between two places under it, and for a change of ref in one", () => {
    assert.equal(locationMoveDirection({ fromLocationId: "book-a", toLocationId: "book-b" }, cabinet), "within");
    assert.equal(locationMoveDirection({ fromLocationId: "book-a", toLocationId: "book-a" }, cabinet), "within");
  });

  it("is null for an entry touching neither end", () => {
    assert.equal(locationMoveDirection({ fromLocationId: "safe", toLocationId: null }, cabinet), null);
  });
});

describe("parseMoveDay / moveDayRange", () => {
  it("takes a real YYYY-MM-DD day and nothing else", () => {
    assert.equal(parseMoveDay("2026-10-31"), "2026-10-31");
    assert.equal(parseMoveDay(" 2026-10-31 "), "2026-10-31");
    assert.equal(parseMoveDay("2026-02-30"), null);
    assert.equal(parseMoveDay("31.10.2026"), null);
    assert.equal(parseMoveDay(""), null);
    assert.equal(parseMoveDay(null), null);
  });

  it("covers whole days at both ends, either end open", () => {
    assert.deepEqual(moveDayRange("2026-10-01", "2026-10-31"), {
      gte: new Date("2026-10-01T00:00:00.000Z"),
      lt: new Date("2026-11-01T00:00:00.000Z"),
    });
    assert.deepEqual(moveDayRange(null, "2026-12-31"), { lt: new Date("2027-01-01T00:00:00.000Z") });
    assert.deepEqual(moveDayRange("2026-10-01", null), { gte: new Date("2026-10-01T00:00:00.000Z") });
    assert.deepEqual(moveDayRange("nonsense", ""), {});
  });
});

describe("locationMoveSourceLabel", () => {
  it("names every source", () => {
    for (const source of LOCATION_MOVE_SOURCES) assert.ok(locationMoveSourceLabel(source).length > 0);
    assert.equal(locationMoveSourceLabel("start"), "Starting point");
    assert.equal(locationMoveSourceLabel("bulk_edit"), "Bulk edit");
  });
});

describe("LOCATION_MOVE_SOURCES", () => {
  it("is the schema's ItemLocationMoveSource, in its order", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const block = /enum ItemLocationMoveSource \{([^}]*)\}/.exec(schema);
    assert.ok(block, "the enum is in the schema");
    const values = block[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));
    assert.deepEqual(values, [...LOCATION_MOVE_SOURCES]);
  });
});
