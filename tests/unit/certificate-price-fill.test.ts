import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  certificatePrice,
  fillCertificateCell,
  formatPricePercent,
  parsePricePercent,
} from "../../src/lib/certificate-price-fill";

describe("certificatePrice", () => {
  it("copies the plain price at the status's percentage", () => {
    assert.equal(certificatePrice("1600.00", 120), "1920.00");
    assert.equal(certificatePrice("10", 150), "15.00");
    assert.equal(certificatePrice("0.40", 110), "0.44");
  });

  it("rounds half up to two decimal places", () => {
    // 1.25 × 1.1 = 1.375 → 1.38, not the binary double's 1.37
    assert.equal(certificatePrice("1.25", 110), "1.38");
    // 0.05 × 1.1 = 0.055 → 0.06
    assert.equal(certificatePrice("0.05", 110), "0.06");
    // 3.33 × 1.15 = 3.8295 → 3.83
    assert.equal(certificatePrice("3.33", 115), "3.83");
    // below the half: 1.21 × 1.1 = 1.331 → 1.33
    assert.equal(certificatePrice("1.21", 110), "1.33");
  });

  it("reads the plain price as its field shows it", () => {
    assert.equal(certificatePrice("1,5", 200), "3.00");
    assert.equal(certificatePrice(" 12.50 ", 100), "12.50");
    assert.equal(certificatePrice("1+1", 150), "3.00");
  });

  it("answers nothing for a plain value that is not a price", () => {
    assert.equal(certificatePrice("", 120), null);
    assert.equal(certificatePrice("abc", 120), null);
    assert.equal(certificatePrice("1+", 120), null);
  });

  it("keeps a zero a zero", () => {
    assert.equal(certificatePrice("0", 150), "0.00");
  });
});

describe("fillCertificateCell", () => {
  it("fills an empty cell from the plain price", () => {
    assert.equal(fillCertificateCell({ plain: "1600.00", current: "", percent: 120 }), "1920.00");
  });

  it("treats a cell holding only spaces as empty", () => {
    assert.equal(fillCertificateCell({ plain: "10.00", current: "  ", percent: 110 }), "11.00");
  });

  it("never overwrites a value already in the cell", () => {
    assert.equal(fillCertificateCell({ plain: "1600.00", current: "2000.00", percent: 120 }), null);
    assert.equal(fillCertificateCell({ plain: "1600.00", current: "0.00", percent: 120 }), null);
  });

  it("leaves the cell empty when the status has no percentage", () => {
    assert.equal(fillCertificateCell({ plain: "1600.00", current: "", percent: null }), null);
  });

  it("leaves the cell alone when the row has no plain price", () => {
    assert.equal(fillCertificateCell({ plain: "", current: "", percent: 120 }), null);
    assert.equal(fillCertificateCell({ plain: "   ", current: "", percent: 120 }), null);
  });
});

describe("parsePricePercent", () => {
  it("reads a whole percentage", () => {
    assert.deepEqual(parsePricePercent("120"), { ok: true, value: 120 });
    assert.deepEqual(parsePricePercent(" 150 "), { ok: true, value: 150 });
    assert.deepEqual(parsePricePercent("110%"), { ok: true, value: 110 });
  });

  it("reads a blank as no percentage", () => {
    assert.deepEqual(parsePricePercent(""), { ok: true, value: null });
    assert.deepEqual(parsePricePercent("   "), { ok: true, value: null });
  });

  it("refuses a fraction, a zero, a negative, text and an absurd figure", () => {
    for (const raw of ["112.5", "0", "-10", "abc", "10001"]) {
      assert.equal(parsePricePercent(raw).ok, false, raw);
    }
  });

  it("accepts the range's ends", () => {
    assert.deepEqual(parsePricePercent("1"), { ok: true, value: 1 });
    assert.deepEqual(parsePricePercent("10000"), { ok: true, value: 10000 });
  });
});

describe("formatPricePercent", () => {
  it("prints the percentage with its sign", () => {
    assert.equal(formatPricePercent(120), "120%");
  });
});
