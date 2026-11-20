import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCAN_PREVIEW_EDGE, scanPreviewSize, scanPreviewTurn } from "../../src/lib/scan-preview";
import { pairAlternating, swapPair } from "../../src/lib/alternating-scan-pairs";

describe("scanPreviewSize (#2599)", () => {
  it("draws a large scan with its longest edge at the preview edge, keeping its shape", () => {
    assert.deepEqual(scanPreviewSize(5100, 7000), {
      width: Math.round(5100 * (SCAN_PREVIEW_EDGE / 7000)),
      height: SCAN_PREVIEW_EDGE,
    });
    assert.deepEqual(scanPreviewSize(7000, 5100, 100), { width: 100, height: 73 });
  });

  it("never enlarges a small scan", () => {
    assert.deepEqual(scanPreviewSize(300, 200), { width: 300, height: 200 });
  });

  it("gives nothing for an image with no size", () => {
    assert.deepEqual(scanPreviewSize(0, 200), { width: 0, height: 0 });
    assert.deepEqual(scanPreviewSize(Number.NaN, 200), { width: 0, height: 0 });
  });
});

describe("scanPreviewTurn (#2599)", () => {
  it("never turns a front", () => {
    assert.equal(scanPreviewTurn("front", "in_place"), 0);
    assert.equal(scanPreviewTurn("front", "card_left_right"), 0);
    assert.equal(scanPreviewTurn("front", "card_top_bottom"), 0);
  });

  it("turns a back as its cut will be, so it follows how the backs are scanned", () => {
    assert.equal(scanPreviewTurn("back", "in_place"), 0);
    assert.equal(scanPreviewTurn("back", "card_left_right"), 0);
    assert.equal(scanPreviewTurn("back", "card_top_bottom"), 180);
  });
});

describe("the pairs list's pictures (#2599)", () => {
  /** Every picture the list draws: one per front, one per back — none for a card with no back. */
  const pictures = (pairs: { front: string; back: string | null }[], turnover: "in_place" | "card_top_bottom") =>
    pairs.flatMap((p) => [
      `${p.front}:front:${scanPreviewTurn("front", turnover)}`,
      ...(p.back ? [`${p.back}:back:${scanPreviewTurn("back", turnover)}`] : []),
    ]);

  it("three cards, two with a back, draw five pictures; the turnover turns only the backs", () => {
    const order = ["a", "b", "c", "d", "e"];
    const pairs = pairAlternating(order, new Set(["c"]));
    assert.deepEqual(pictures(pairs, "in_place"), [
      "a:front:0",
      "b:back:0",
      "c:front:0",
      "d:front:0",
      "e:back:0",
    ]);
    assert.deepEqual(pictures(pairs, "card_top_bottom"), [
      "a:front:0",
      "b:back:180",
      "c:front:0",
      "d:front:0",
      "e:back:180",
    ]);
  });

  it("a swap exchanges the two pictures of a card", () => {
    const order = ["a", "b"];
    const [pair] = pairAlternating(order);
    const next = swapPair(order, new Set<string>(), pair);
    assert.deepEqual(pictures(pairAlternating(next.order, next.noBack), "card_top_bottom"), [
      "b:front:0",
      "a:back:180",
    ]);
  });
});
