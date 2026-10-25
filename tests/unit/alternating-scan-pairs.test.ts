import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pairAlternating,
  sortByFileName,
  swapPair,
  toggleNoBack,
} from "../../src/lib/alternating-scan-pairs";

const names = (pairs: { front: string; back: string | null }[]) =>
  pairs.map((p) => `${p.front}/${p.back ?? "-"}`);

describe("sortByFileName (#2163)", () => {
  it("sorts the way a person reads the names, so scan 10 comes after scan 2", () => {
    const files = ["scan 10.jpg", "scan 2.jpg", "scan 1.jpg", "Scan 3.jpg"].map((name) => ({ name }));
    assert.deepEqual(
      sortByFileName(files).map((f) => f.name),
      ["scan 1.jpg", "scan 2.jpg", "Scan 3.jpg", "scan 10.jpg"]
    );
  });
});

describe("pairAlternating (#2163)", () => {
  it("pairs each front with the file after it", () => {
    assert.deepEqual(names(pairAlternating(["f1", "b1", "f2", "b2"])), ["f1/b1", "f2/b2"]);
  });

  it("leaves the last front without a back on an odd count", () => {
    assert.deepEqual(names(pairAlternating(["f1", "b1", "f2"])), ["f1/b1", "f2/-"]);
  });

  it("shifts every pair after a front said to have no back", () => {
    // The back of f2 was never scanned: f3 stood where it should have.
    const order = ["f1", "b1", "f2", "f3", "b3"];
    assert.deepEqual(names(pairAlternating(order)), ["f1/b1", "f2/f3", "b3/-"]);
    assert.deepEqual(names(pairAlternating(order, new Set(["f2"]))), ["f1/b1", "f2/-", "f3/b3"]);
  });

  it("ignores the mark on a file standing where a back goes", () => {
    assert.deepEqual(names(pairAlternating(["f1", "b1"], new Set(["b1"]))), ["f1/b1"]);
  });

  it("makes nothing of no files", () => {
    assert.deepEqual(pairAlternating([]), []);
  });
});

describe("swapPair (#2163)", () => {
  it("exchanges the pair's two files and leaves the rest in place", () => {
    const order = ["b1", "f1", "f2", "b2"];
    const pairs = pairAlternating(order);
    const swapped = swapPair(order, new Set<string>(), pairs[0]);
    assert.deepEqual(swapped.order, ["f1", "b1", "f2", "b2"]);
    assert.deepEqual(names(pairAlternating(swapped.order, swapped.noBack)), ["f1/b1", "f2/b2"]);
  });

  it("drops a no-back mark from both files", () => {
    const swapped = swapPair(["f1", "b1"], new Set(["b1"]), { front: "f1", back: "b1" });
    assert.equal(swapped.noBack.size, 0);
  });

  it("does nothing to a front with no back", () => {
    const swapped = swapPair(["f1"], new Set<string>(), { front: "f1", back: null });
    assert.deepEqual(swapped.order, ["f1"]);
  });
});

describe("toggleNoBack (#2163)", () => {
  it("marks a front and unmarks it again", () => {
    const marked = toggleNoBack(new Set<string>(), "f2");
    assert.ok(marked.has("f2"));
    assert.equal(toggleNoBack(marked, "f2").size, 0);
  });
});
