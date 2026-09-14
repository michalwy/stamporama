import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { photoMeasureFrame } from "../../src/lib/photo-measure-frame";

// The frame a plain photo is measured in (#1290). The failure this guards is silent: a reading taken
// on a downscaled derivative against a dpi stated for the upload looks exactly as precise as a right
// one, and is off by the downscale factor.

const CAP = 2500;

describe("photo measure frame (#1290)", () => {
  it("measures in the upload's own pixels when they are recorded", () => {
    // A 5000 × 3000 upload stored as 2500 × 1500: the frame is the upload, not the derivative.
    assert.deepEqual(
      photoMeasureFrame({ width: 2500, height: 1500, originalWidth: 5000, originalHeight: 3000 }, CAP),
      { width: 5000, height: 3000 }
    );
    // …and a picture that never reached the cap is its own original.
    assert.deepEqual(
      photoMeasureFrame({ width: 1400, height: 1600, originalWidth: 1400, originalHeight: 1600 }, CAP),
      { width: 1400, height: 1600 }
    );
  });

  it("takes a row with no recorded original at its word only below the cap", () => {
    // The pipeline never enlarges, so under the cap on both edges the derivative is the upload.
    assert.deepEqual(
      photoMeasureFrame({ width: 1200, height: 900, originalWidth: null, originalHeight: null }, CAP),
      { width: 1200, height: 900 }
    );
    // At the cap it may have been shrunk by a factor nothing records — no frame, no tools.
    assert.equal(
      photoMeasureFrame({ width: 2500, height: 900, originalWidth: null, originalHeight: null }, CAP),
      null
    );
    assert.equal(
      photoMeasureFrame({ width: 900, height: 2500, originalWidth: null, originalHeight: null }, CAP),
      null
    );
  });

  it("refuses a row that disagrees with itself", () => {
    // An original smaller than its derivative cannot happen through the pipeline.
    assert.equal(
      photoMeasureFrame({ width: 2000, height: 1000, originalWidth: 1000, originalHeight: 500 }, CAP),
      null
    );
    // A different shape is a different picture — a turn recorded on one half and not the other.
    assert.equal(
      photoMeasureFrame({ width: 2500, height: 1500, originalWidth: 3000, originalHeight: 5000 }, CAP),
      null
    );
    // Half an original is no original.
    assert.equal(
      photoMeasureFrame({ width: 2500, height: 1500, originalWidth: 5000, originalHeight: null }, CAP),
      null
    );
    assert.equal(
      photoMeasureFrame({ width: 0, height: 1500, originalWidth: null, originalHeight: null }, CAP),
      null
    );
  });

  it("tolerates the pixel a downscale rounds away on a long strip", () => {
    // 10001 × 301 → 2500 × 75: the ratio moves by a rounding, not by a different picture.
    assert.deepEqual(
      photoMeasureFrame({ width: 2500, height: 75, originalWidth: 10001, originalHeight: 301 }, CAP),
      { width: 10001, height: 301 }
    );
  });
});
