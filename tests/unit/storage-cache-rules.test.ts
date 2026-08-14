import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_LOW_WATER_FRACTION,
  DEFAULT_CACHE_MAX_BYTES,
  bytesToEvict,
  cacheLowWaterBytes,
  cacheMaxBytes,
  describeCacheMax,
} from "../../src/lib/storage/cache-rules";

const MB = 1024 * 1024;

// The numbers the local cache of remote storage objects is governed by (#591). The cap is the whole
// mechanism: the objects are immutable under their key, so there is no staleness and nothing to
// invalidate, and disk is the only thing left to protect.
describe("storage cache rules (#591)", () => {
  it("defaults to a cap that can hold several of the largest objects the app stores", () => {
    // A card scan retained at 1200 dpi is up to `MAX_UPLOAD_BYTES` (200 MB). A cap that cannot hold
    // several at once plus a collage run's sources would evict the very objects the cache exists
    // for, and be a cache in name only.
    assert.equal(cacheMaxBytes(undefined), DEFAULT_CACHE_MAX_BYTES);
    assert.ok(DEFAULT_CACHE_MAX_BYTES >= 8 * 200 * MB);
  });

  it("takes the operator's figure, in whole megabytes", () => {
    assert.equal(cacheMaxBytes("512"), 512 * MB);
    assert.equal(cacheMaxBytes(" 4096 "), 4096 * MB);
  });

  it("switches the cache off at zero, and at the words for it", () => {
    // The escape hatch for an operator whose disk is the scarce thing — they pay the remote
    // fetches instead.
    assert.equal(cacheMaxBytes("0"), 0);
    assert.equal(cacheMaxBytes("off"), 0);
    assert.equal(cacheMaxBytes("never"), 0);
    assert.equal(cacheMaxBytes("NONE"), 0);
  });

  it("falls back rather than throwing, so a typo cannot break a write", () => {
    assert.equal(cacheMaxBytes("nonsense"), DEFAULT_CACHE_MAX_BYTES);
    assert.equal(cacheMaxBytes("-1"), DEFAULT_CACHE_MAX_BYTES);
    assert.equal(cacheMaxBytes(""), DEFAULT_CACHE_MAX_BYTES);
  });

  it("evicts nothing while the cache is inside its cap", () => {
    assert.equal(bytesToEvict(0, 1000), 0);
    assert.equal(bytesToEvict(999, 1000), 0);
    assert.equal(bytesToEvict(1000, 1000), 0);
  });

  it("frees down to the low-water mark, not back to the cap", () => {
    // Which is what makes it a sweep rather than something that happens on every write: at the cap
    // exactly, each new 200 MB object would evict on arrival.
    assert.equal(cacheLowWaterBytes(1000), 1000 * CACHE_LOW_WATER_FRACTION);
    assert.equal(bytesToEvict(1001, 1000), 1001 - 800);
    assert.equal(bytesToEvict(2000, 1000), 1200);
  });

  it("holds nothing at all when the cap is zero", () => {
    assert.equal(bytesToEvict(500, 0), 500);
  });

  it("says the cap in words for the boot log", () => {
    assert.equal(describeCacheMax(0), "disabled");
    assert.equal(describeCacheMax(2048 * MB), "2048 MB");
  });
});
