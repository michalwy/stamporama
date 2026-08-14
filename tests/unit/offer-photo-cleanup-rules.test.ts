import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED_OFFER_PHOTO_TTL_FOREVER,
  DEFAULT_CLOSED_OFFER_PHOTO_TTL_DAYS,
  closedOfferPhotoCutoff,
  closedOfferPhotoTtlMs,
  describeClosedOfferPhotoTtl,
  parseClosedOfferPhotoTtlSetting,
} from "../../src/lib/offer-photo-cleanup-rules";
import {
  instanceClosedOfferPhotoTtlMs,
  resolveClosedOfferPhotoTtlMs,
} from "../../src/lib/offer-photo-retention";

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

describe("parseClosedOfferPhotoTtlSetting (#577)", () => {
  it("reads blank as 'no opinion' rather than as a mistake — that is what null is for", () => {
    assert.equal(parseClosedOfferPhotoTtlSetting(null), null);
    assert.equal(parseClosedOfferPhotoTtlSetting(undefined), null);
    assert.equal(parseClosedOfferPhotoTtlSetting(""), null);
    assert.equal(parseClosedOfferPhotoTtlSetting("  "), null);
  });

  it("settles the spelling of keep-for-ever on one canonical value", () => {
    assert.equal(parseClosedOfferPhotoTtlSetting("off"), CLOSED_OFFER_PHOTO_TTL_FOREVER);
    assert.equal(parseClosedOfferPhotoTtlSetting("Never"), CLOSED_OFFER_PHOTO_TTL_FOREVER);
    assert.equal(parseClosedOfferPhotoTtlSetting(" OFF "), CLOSED_OFFER_PHOTO_TTL_FOREVER);
  });

  it("canonicalizes a day count, keeping 0 as its own answer", () => {
    assert.equal(parseClosedOfferPhotoTtlSetting(" 30 "), "30");
    assert.equal(parseClosedOfferPhotoTtlSetting("0"), "0");
    assert.equal(parseClosedOfferPhotoTtlSetting("0.5"), "0.5");
  });

  it("refuses what the read path would silently swallow as the default", () => {
    // The parser is forgiving on purpose, so a bad env var cannot break a sweep. A bad value typed
    // into the form is a different thing, and is rejected while the collector is still looking at it.
    assert.equal(parseClosedOfferPhotoTtlSetting("soon"), undefined);
    assert.equal(parseClosedOfferPhotoTtlSetting("-3"), undefined);
    assert.equal(parseClosedOfferPhotoTtlSetting("NaN"), undefined);
  });

  it("round-trips through the read path — one grammar, not two", () => {
    for (const raw of ["off", "never", "0", "30", "0.5"]) {
      const stored = parseClosedOfferPhotoTtlSetting(raw);
      assert.notEqual(stored, undefined);
      assert.equal(closedOfferPhotoTtlMs(stored ?? undefined), closedOfferPhotoTtlMs(raw));
    }
  });
});

describe("resolveClosedOfferPhotoTtlMs (#577)", () => {
  /** Run `fn` with the environment variable set to `value`, or unset when it is undefined. */
  function withEnv(value: string | undefined, fn: () => void) {
    const before = process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
    if (value === undefined) delete process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
    else process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = value;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS;
      else process.env.STAMPORAMA_CLOSED_OFFER_PHOTO_TTL_DAYS = before;
    }
  }

  it("takes the collection's own answer first", () => {
    withEnv("30", () => {
      assert.equal(resolveClosedOfferPhotoTtlMs("2"), 2 * DAY_MS);
      assert.equal(resolveClosedOfferPhotoTtlMs("off"), null);
      assert.equal(resolveClosedOfferPhotoTtlMs("0"), 0);
    });
  });

  it("falls back to the operator's variable — nothing is migrated away from them", () => {
    withEnv("30", () => {
      assert.equal(resolveClosedOfferPhotoTtlMs(null), 30 * DAY_MS);
      assert.equal(resolveClosedOfferPhotoTtlMs(undefined), 30 * DAY_MS);
      assert.equal(instanceClosedOfferPhotoTtlMs(), 30 * DAY_MS);
    });
    withEnv("off", () => {
      assert.equal(resolveClosedOfferPhotoTtlMs(null), null);
    });
  });

  it("falls back to the built-in default when neither says anything", () => {
    withEnv(undefined, () => {
      assert.equal(resolveClosedOfferPhotoTtlMs(null), DEFAULT_MS);
      assert.equal(instanceClosedOfferPhotoTtlMs(), DEFAULT_MS);
    });
  });

  it("reads a blank column as no opinion, not as an override", () => {
    // A row that somehow holds an empty string must still inherit, rather than quietly replacing
    // the operator's setting with the built-in default.
    withEnv("30", () => {
      assert.equal(resolveClosedOfferPhotoTtlMs(""), 30 * DAY_MS);
      assert.equal(resolveClosedOfferPhotoTtlMs("   "), 30 * DAY_MS);
    });
  });
});
