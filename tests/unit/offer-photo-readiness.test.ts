import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePhotoReadiness,
  type PhotoReadinessInput,
} from "../../src/lib/offer-photo-readiness";

// The photo half of the ready gate (#311): an offer is not "assembled" while the images a buyer
// sees do not exist, are still rendering, or were rendered from a composition it no longer has.

function input(over: Partial<PhotoReadinessInput> = {}): PhotoReadinessInput {
  return { status: "ready", outOfDate: false, storedCount: 4, plannedCount: 4, ...over };
}

const codes = (i: PhotoReadinessInput) => evaluatePhotoReadiness(i).map((b) => b.code);

describe("evaluatePhotoReadiness", () => {
  it("passes an offer whose photos are generated and current", () => {
    assert.deepEqual(evaluatePhotoReadiness(input()), []);
  });

  it("asks nothing of an offer with no photo plan at all", () => {
    // No collage numbers and no attachment: there is nothing to generate, so nothing to refuse.
    assert.deepEqual(
      evaluatePhotoReadiness(input({ status: "none", storedCount: 0, plannedCount: 0 })),
      []
    );
  });

  it("refuses an offer whose plan has never been generated", () => {
    assert.deepEqual(codes(input({ status: "none", storedCount: 0 })), ["photos-missing"]);
  });

  it("names how many images the plan holds", () => {
    const [b] = evaluatePhotoReadiness(input({ status: "none", storedCount: 0, plannedCount: 1 }));
    assert.match(b.message, /1 image\b/);
  });

  it("refuses stored images that are out of date", () => {
    assert.deepEqual(codes(input({ outOfDate: true })), ["photos-outdated"]);
  });

  it("refuses while a run is still in flight, and says only that", () => {
    for (const status of ["queued", "running"] as const) {
      assert.deepEqual(codes(input({ status, storedCount: 0, outOfDate: true })), [
        "photos-generating",
      ]);
    }
  });

  it("refuses a failed run", () => {
    assert.deepEqual(codes(input({ status: "failed" })), ["photos-failed"]);
  });

  it("reports stale images and a failed replacement together", () => {
    assert.deepEqual(codes(input({ status: "failed", outOfDate: true })), [
      "photos-outdated",
      "photos-failed",
    ]);
  });

  it("says only that nothing is stored, whatever else is true of the run", () => {
    assert.deepEqual(codes(input({ status: "failed", storedCount: 0, outOfDate: true })), [
      "photos-missing",
    ]);
  });
});
