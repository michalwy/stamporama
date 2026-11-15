import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEPARTED_COPY_PHOTO_TTL_MS,
  copyDepartedAt,
  departedCopyPhotoCutoff,
  departedCopyPhotoTtlMs,
  describeDepartedCopyPhotoTtl,
  describePhotoReduction,
  isPhotoReductionDue,
  parseDepartedCopyPhotoTtlSetting,
} from "../../src/lib/departed-copy-photo-rules";
import {
  instanceDepartedCopyPhotoTtlMs,
  resolveDepartedCopyPhotoTtlMs,
} from "../../src/lib/departed-copy-photo-retention";
import { photoMeasureFrame } from "../../src/lib/photo-measure-frame";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENV = "STAMPORAMA_DEPARTED_COPY_PHOTO_TTL_DAYS";

describe("departedCopyPhotoTtlMs (#2547)", () => {
  it("is 90 days when nothing is configured", () => {
    assert.equal(DEFAULT_DEPARTED_COPY_PHOTO_TTL_MS, 90 * DAY_MS);
    assert.equal(departedCopyPhotoTtlMs(undefined), 90 * DAY_MS);
    assert.equal(departedCopyPhotoTtlMs(""), 90 * DAY_MS);
  });

  it("speaks the shared grammar: days, 0 for the next sweep, off for keep for ever", () => {
    assert.equal(departedCopyPhotoTtlMs("30"), 30 * DAY_MS);
    assert.equal(departedCopyPhotoTtlMs("0"), 0);
    assert.equal(departedCopyPhotoTtlMs("off"), null);
    assert.equal(departedCopyPhotoTtlMs("Never"), null);
    assert.equal(departedCopyPhotoTtlMs("soon"), 90 * DAY_MS, "a typo falls back to the default");
  });

  it("canonicalizes and validates what Settings stores", () => {
    assert.equal(parseDepartedCopyPhotoTtlSetting(" 30 "), "30");
    assert.equal(parseDepartedCopyPhotoTtlSetting("NEVER"), "off");
    assert.equal(parseDepartedCopyPhotoTtlSetting(""), null);
    assert.equal(parseDepartedCopyPhotoTtlSetting("-1"), undefined);
    assert.equal(parseDepartedCopyPhotoTtlSetting("soon"), undefined);
  });

  it("says the period in words", () => {
    assert.match(describeDepartedCopyPhotoTtl(null), /disabled/);
    assert.match(describeDepartedCopyPhotoTtl(0), /next sweep/);
    assert.match(describeDepartedCopyPhotoTtl(90 * DAY_MS), /90 days after it has left/);
  });
});

describe("resolving the period (#2547)", () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it("takes the collection's own, then the instance's, then 90 days", () => {
    delete process.env[ENV];
    assert.equal(resolveDepartedCopyPhotoTtlMs(null), 90 * DAY_MS);
    assert.equal(instanceDepartedCopyPhotoTtlMs(), 90 * DAY_MS);
    process.env[ENV] = "off";
    assert.equal(resolveDepartedCopyPhotoTtlMs(null), null);
    assert.equal(resolveDepartedCopyPhotoTtlMs("  "), null, "blank is no opinion");
    assert.equal(resolveDepartedCopyPhotoTtlMs("7"), 7 * DAY_MS);
  });
});

describe("when a copy left (#2547)", () => {
  const d = (iso: string) => new Date(iso);

  it("is null while the copy is held", () => {
    assert.equal(copyDepartedAt({ soldAt: [], tradeClosedAt: [], disposedAt: null }), null);
  });

  it("is the sale's sold date, the trade's closing, or the day it was marked", () => {
    assert.deepEqual(copyDepartedAt({ soldAt: [d("2026-01-02")], tradeClosedAt: [], disposedAt: null }), d("2026-01-02"));
    assert.deepEqual(copyDepartedAt({ soldAt: [], tradeClosedAt: [d("2026-03-04")], disposedAt: null }), d("2026-03-04"));
    assert.deepEqual(copyDepartedAt({ soldAt: [], tradeClosedAt: [], disposedAt: d("2026-05-06") }), d("2026-05-06"));
  });

  it("takes the earliest when there is more than one", () => {
    assert.deepEqual(
      copyDepartedAt({ soldAt: [d("2026-05-01")], tradeClosedAt: [], disposedAt: d("2026-02-01") }),
      d("2026-02-01")
    );
  });

  it("reckons from nothing it does not know: a closed trade with no closing moment reduces nothing", () => {
    assert.equal(copyDepartedAt({ soldAt: [d("2026-01-01")], tradeClosedAt: [null], disposedAt: null }), null);
  });
});

describe("whether the reduction is due (#2547)", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("is due once the copy left on or before the cutoff", () => {
    const cutoff = departedCopyPhotoCutoff(now, 90 * DAY_MS);
    assert.equal(isPhotoReductionDue(new Date(now.getTime() - 91 * DAY_MS), cutoff), true);
    assert.equal(isPhotoReductionDue(new Date(now.getTime() - 30 * DAY_MS), cutoff), false);
    assert.equal(isPhotoReductionDue(null, cutoff), false, "a held copy is never due");
  });

  it("is never due with the setting off, and at once with 0", () => {
    assert.equal(isPhotoReductionDue(new Date("2000-01-01"), departedCopyPhotoCutoff(now, null)), false);
    assert.equal(isPhotoReductionDue(now, departedCopyPhotoCutoff(now, 0)), true);
  });
});

describe("the copy's screen (#2547)", () => {
  it("says when the photos were reduced, and nothing when they were not", () => {
    assert.equal(describePhotoReduction(null), null);
    assert.match(describePhotoReduction("2026-11-15T10:00:00.000Z")!, /^Reduced on 2026-11-15/);
  });
});

describe("measuring a reduced photo (#2547)", () => {
  it("keeps the upload's frame when it was recorded", () => {
    assert.deepEqual(
      photoMeasureFrame(
        { width: 1000, height: 750, originalWidth: 4000, originalHeight: 3000, reducedAt: new Date() },
        2500
      ),
      { width: 4000, height: 3000 }
    );
  });

  it("has no frame without a recorded original — under the cap no longer means it is the upload", () => {
    const row = { width: 1000, height: 750, originalWidth: null, originalHeight: null };
    assert.deepEqual(photoMeasureFrame(row, 2500), { width: 1000, height: 750 });
    assert.equal(photoMeasureFrame({ ...row, reducedAt: new Date() }, 2500), null);
  });
});
