import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstReferenceFor,
  referenceCandidates,
  referencePhotos,
} from "../../src/lib/reference-candidates";

type Row = { stampId: string; parentId: string | null; photos: string[] };

// Mi 200 with two watermark variants and a forgery of the first; Mi 201 beside it.
const ROWS: Row[] = [
  { stampId: "200", parentId: null, photos: [] },
  { stampId: "200a", parentId: "200", photos: ["p-200a"] },
  { stampId: "200a-forgery", parentId: "200a", photos: ["p-forgery-1", "p-forgery-2"] },
  { stampId: "200b", parentId: "200", photos: ["p-200b"] },
  { stampId: "201", parentId: null, photos: ["p-201"] },
];

describe("referenceCandidates", () => {
  it("lists the stamp and everything beneath it, depth first, in tree order", () => {
    const list = referenceCandidates(ROWS, ["200"]);
    assert.deepEqual(
      list.map((c) => [c.row.stampId, c.depth]),
      [
        ["200", 0],
        ["200a", 1],
        ["200a-forgery", 2],
        ["200b", 1],
      ]
    );
  });

  it("lists a stamp once when one stamp under consideration sits under another", () => {
    const list = referenceCandidates(ROWS, ["200", "200a", "201"]);
    assert.deepEqual(
      list.map((c) => c.row.stampId),
      ["200", "200a", "200a-forgery", "200b", "201"]
    );
    assert.equal(list.find((c) => c.row.stampId === "201")?.rootStampId, "201");
  });

  it("skips a stamp that is not in the rows", () => {
    assert.deepEqual(referenceCandidates(ROWS, ["999"]), []);
  });
});

describe("firstReferenceFor", () => {
  const list = referenceCandidates(ROWS, ["200", "201"]);

  it("opens on the stamp's own first photo", () => {
    assert.equal(firstReferenceFor(list, "200a-forgery"), "p-forgery-1");
  });

  it("falls back to the first photo beneath a stamp that has none", () => {
    assert.equal(firstReferenceFor(list, "200"), "p-200a");
  });

  it("does not wander past the stamp's own subtree", () => {
    const bare = referenceCandidates<Row>(
      [
        { stampId: "a", parentId: null, photos: [] },
        { stampId: "b", parentId: null, photos: ["p-b"] },
      ],
      ["a", "b"]
    );
    assert.equal(firstReferenceFor(bare, "a"), null);
  });
});

describe("referencePhotos", () => {
  it("walks every reference in list order", () => {
    assert.deepEqual(
      referencePhotos(referenceCandidates(ROWS, ["200"])).map((r) => r.photo),
      ["p-200a", "p-forgery-1", "p-forgery-2", "p-200b"]
    );
  });
});
