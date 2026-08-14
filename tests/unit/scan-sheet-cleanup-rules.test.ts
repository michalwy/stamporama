import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCAN_SHEET_TTL_MS,
  SCAN_SHEET_TTL_FOREVER,
  describeScanSheetTtl,
  parseScanSheetTtlSetting,
  scanSheetCutoff,
  scanSheetTtlMs,
} from "../../src/lib/scan-sheet-cleanup-rules";
import {
  instanceScanSheetTtlMs,
  resolveScanSheetTtlMs,
} from "../../src/lib/scan-sheet-retention";
import { closedOfferPhotoTtlMs } from "../../src/lib/offer-photo-cleanup-rules";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("scanSheetTtlMs (#578)", () => {
  it("keeps card scans for ever when nothing is configured — a scan is a source, not output", () => {
    assert.equal(DEFAULT_SCAN_SHEET_TTL_MS, null);
    assert.equal(scanSheetTtlMs(undefined), null);
    assert.equal(scanSheetTtlMs(""), null);
    assert.equal(scanSheetTtlMs("   "), null);
  });

  it("reads a configured number of days", () => {
    assert.equal(scanSheetTtlMs("30"), 30 * DAY_MS);
    assert.equal(scanSheetTtlMs(" 1 "), DAY_MS);
    assert.equal(scanSheetTtlMs("0.5"), DAY_MS / 2);
  });

  it("reads 0 as 'sweep at the next pass' rather than as keep for ever", () => {
    // The inverse reading is the one #577's own spec had, and #578 inherited before it was
    // corrected. Two retention settings on one screen where `0` means opposite things would be a
    // trap, so this is asserted rather than assumed.
    assert.equal(scanSheetTtlMs("0"), 0);
  });

  it("switches the sweep off on `off` / `never`, in any case", () => {
    assert.equal(scanSheetTtlMs("off"), null);
    assert.equal(scanSheetTtlMs("Never"), null);
  });

  it("falls back to keeping on anything unparseable — a typo never deletes a scan", () => {
    assert.equal(scanSheetTtlMs("soon"), null);
    assert.equal(scanSheetTtlMs("-3"), null);
    assert.equal(scanSheetTtlMs("NaN"), null);
  });

  it("speaks the closed-offer period's grammar exactly, for every value both accept", () => {
    // The two settings are separate answers in separate columns; the *language* is one, and this is
    // what says so. Only the default differs — hence the blank case being excluded here.
    for (const raw of ["off", "never", "OFF", "0", "1", "30", "0.5", "soon", "-3"]) {
      const scan = scanSheetTtlMs(raw);
      const offer = closedOfferPhotoTtlMs(raw);
      if (raw === "soon" || raw === "-3") continue; // both fall back, to their own defaults
      assert.equal(scan, offer, `"${raw}" must mean the same on both settings`);
    }
  });
});

describe("describeScanSheetTtl (#578)", () => {
  it("names the period the boot log reports", () => {
    assert.match(describeScanSheetTtl(30 * DAY_MS), /^a card scan is deleted 30 days /);
    assert.match(describeScanSheetTtl(DAY_MS), /^a card scan is deleted 1 day /);
  });

  it("says a zero TTL deletes at the next sweep, not 'after 0 days'", () => {
    assert.match(describeScanSheetTtl(0), /at the next sweep/);
  });

  it("says so plainly when the sweep is off — which is what an untouched instance does", () => {
    assert.match(describeScanSheetTtl(null), /^disabled/);
  });
});

describe("scanSheetCutoff (#578)", () => {
  const now = new Date("2026-08-14T10:00:00.000Z");

  it("is the TTL back from the given instant", () => {
    assert.deepEqual(scanSheetCutoff(now, 30 * DAY_MS), new Date("2026-07-15T10:00:00.000Z"));
  });

  it("is `now` itself at a zero TTL — every finished batch is already past it", () => {
    assert.deepEqual(scanSheetCutoff(now, 0), now);
  });

  it("is null when the sweep is off", () => {
    assert.equal(scanSheetCutoff(now, null), null);
  });
});

describe("parseScanSheetTtlSetting (#578)", () => {
  it("reads blank as 'no opinion' rather than as a mistake — that is what null is for", () => {
    assert.equal(parseScanSheetTtlSetting(null), null);
    assert.equal(parseScanSheetTtlSetting(""), null);
    assert.equal(parseScanSheetTtlSetting("  "), null);
  });

  it("settles the spelling of keep-for-ever on one canonical value", () => {
    assert.equal(parseScanSheetTtlSetting("off"), SCAN_SHEET_TTL_FOREVER);
    assert.equal(parseScanSheetTtlSetting(" NEVER "), SCAN_SHEET_TTL_FOREVER);
  });

  it("canonicalizes a day count, keeping 0 as its own answer", () => {
    assert.equal(parseScanSheetTtlSetting(" 30 "), "30");
    assert.equal(parseScanSheetTtlSetting("0"), "0");
  });

  it("refuses what the read path would silently swallow", () => {
    assert.equal(parseScanSheetTtlSetting("soon"), undefined);
    assert.equal(parseScanSheetTtlSetting("-3"), undefined);
  });

  it("round-trips through the read path — one grammar, not two", () => {
    for (const raw of ["off", "never", "0", "30", "0.5"]) {
      const stored = parseScanSheetTtlSetting(raw);
      assert.notEqual(stored, undefined);
      assert.equal(scanSheetTtlMs(stored ?? undefined), scanSheetTtlMs(raw));
    }
  });
});

describe("resolveScanSheetTtlMs (#578)", () => {
  /** Run `fn` with the environment variable set to `value`, or unset when it is undefined. */
  function withEnv(value: string | undefined, fn: () => void) {
    const before = process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS;
    if (value === undefined) delete process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS;
    else process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS = value;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS;
      else process.env.STAMPORAMA_SCAN_SHEET_TTL_DAYS = before;
    }
  }

  it("takes the collection's own answer first", () => {
    withEnv("30", () => {
      assert.equal(resolveScanSheetTtlMs("2"), 2 * DAY_MS);
      assert.equal(resolveScanSheetTtlMs("off"), null);
      assert.equal(resolveScanSheetTtlMs("0"), 0);
    });
  });

  it("falls to the instance's when the collection states nothing", () => {
    withEnv("14", () => {
      assert.equal(resolveScanSheetTtlMs(null), 14 * DAY_MS);
      assert.equal(resolveScanSheetTtlMs(undefined), 14 * DAY_MS);
      // A blank column is no opinion, not an empty answer that overrides the operator.
      assert.equal(resolveScanSheetTtlMs("   "), 14 * DAY_MS);
    });
  });

  it("keeps for ever when neither has an opinion — the sweep ships off", () => {
    withEnv(undefined, () => {
      assert.equal(instanceScanSheetTtlMs(), null);
      assert.equal(resolveScanSheetTtlMs(null), null);
    });
  });

  it("lets a collection keep for ever under an instance that sweeps, and the reverse", () => {
    withEnv("7", () => assert.equal(resolveScanSheetTtlMs("off"), null));
    withEnv("off", () => assert.equal(resolveScanSheetTtlMs("7"), 7 * DAY_MS));
  });
});
