import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS,
  closedOfferPhotoCutoff,
  closedOfferPhotoTtlMs,
  describeClosedOfferPhotoTtl,
} from "../../src/lib/offer-photo-cleanup-rules";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MS = DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS * DAY_MS;

describe("closedOfferPhotoTtlMs (#512)", () => {
  it("defaults to a week when nothing is configured", () => {
    assert.equal(closedOfferPhotoTtlMs(undefined), DEFAULT_MS);
    assert.equal(closedOfferPhotoTtlMs(""), DEFAULT_MS);
    assert.equal(closedOfferPhotoTtlMs("   "), DEFAULT_MS);
  });

  it("reads a configured number of days", () => {
    assert.equal(closedOfferPhotoTtlMs("30"), 30 * DAY_MS);
    assert.equal(closedOfferPhotoTtlMs(" 1 "), DAY_MS);
    assert.equal(closedOfferPhotoTtlMs("0.5"), DAY_MS / 2);
  });

  it("reads 0 as 'purge at the next sweep' rather than as unset", () => {
    assert.equal(closedOfferPhotoTtlMs("0"), 0);
  });

  it("switches the purge off on `off` / `never`, in any case", () => {
    assert.equal(closedOfferPhotoTtlMs("off"), null);
    assert.equal(closedOfferPhotoTtlMs("OFF"), null);
    assert.equal(closedOfferPhotoTtlMs("Never"), null);
  });

  it("falls back to the default on anything unparseable — a typo never starts deleting", () => {
    assert.equal(closedOfferPhotoTtlMs("soon"), DEFAULT_MS);
    assert.equal(closedOfferPhotoTtlMs("-3"), DEFAULT_MS);
    assert.equal(closedOfferPhotoTtlMs("NaN"), DEFAULT_MS);
  });
});

describe("describeClosedOfferPhotoTtl (#512)", () => {
  it("names the period the boot log reports", () => {
    assert.match(describeClosedOfferPhotoTtl(7 * DAY_MS), /^generated images are deleted 7 days /);
    assert.match(describeClosedOfferPhotoTtl(DAY_MS), /^generated images are deleted 1 day /);
    assert.match(describeClosedOfferPhotoTtl(DAY_MS / 2), /^generated images are deleted 0\.5 days /);
  });

  it("says a zero TTL deletes at the next sweep, not 'after 0 days'", () => {
    assert.match(describeClosedOfferPhotoTtl(0), /at the next sweep/);
  });

  it("says so plainly when the purge is off — the setting an operator most wants confirmed", () => {
    assert.match(describeClosedOfferPhotoTtl(null), /^disabled/);
  });
});

describe("closedOfferPhotoCutoff (#512)", () => {
  const now = new Date("2026-08-12T10:00:00.000Z");

  it("is the TTL back from the given instant", () => {
    assert.deepEqual(
      closedOfferPhotoCutoff(now, 7 * DAY_MS),
      new Date("2026-08-05T10:00:00.000Z")
    );
  });

  it("is `now` itself at a zero TTL — everything already closed is past it", () => {
    assert.deepEqual(closedOfferPhotoCutoff(now, 0), now);
  });

  it("is null when the purge is off", () => {
    assert.equal(closedOfferPhotoCutoff(now, null), null);
  });
});
