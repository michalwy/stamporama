import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NO_STAMP_SIZE, measuredSizeWrite } from "../../src/lib/stamp-size";

// Writing a measured size onto a stamp (#1290). A stated size may itself be a careful measurement, so
// the one outcome this must never produce is a silent replacement.

const MEASURED = { widthMm: 21.5, heightMm: 25 };

describe("measured size write (#1290)", () => {
  it("writes onto a stamp that states nothing", () => {
    assert.equal(measuredSizeWrite(NO_STAMP_SIZE, MEASURED, false), "write");
  });

  it("asks before replacing a stated size, whole or half", () => {
    assert.equal(measuredSizeWrite({ widthMm: 22, heightMm: 26 }, MEASURED, false), "confirm");
    assert.equal(measuredSizeWrite({ widthMm: 21.5, heightMm: null }, MEASURED, false), "confirm");
    assert.equal(measuredSizeWrite({ widthMm: null, heightMm: 25 }, MEASURED, false), "confirm");
  });

  it("replaces once the collector has said so", () => {
    assert.equal(measuredSizeWrite({ widthMm: 22, heightMm: 26 }, MEASURED, true), "write");
  });

  it("has nothing to do when the stamp already states exactly this", () => {
    assert.equal(measuredSizeWrite({ widthMm: 21.5, heightMm: 25 }, MEASURED, false), "same");
    assert.equal(measuredSizeWrite({ widthMm: 21.5, heightMm: 25 }, MEASURED, true), "same");
  });
});
