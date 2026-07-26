import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHexColor,
  parseCollageTemplateInput,
  MAX_COLLAGE_AXIS,
  MAX_COLLAGE_LABEL_PERCENT,
} from "../../src/lib/collage-template-rules";

const VALID = {
  name: "Small definitives",
  rows: "5",
  columns: "4",
  gapPercent: "5",
  background: "#ffffff",
  labelPercent: "1.5",
};

describe("normalizeHexColor", () => {
  it("accepts a full hex colour with or without the hash", () => {
    assert.equal(normalizeHexColor("#AABBCC"), "#aabbcc");
    assert.equal(normalizeHexColor("aabbcc"), "#aabbcc");
  });

  it("expands the 3-digit shorthand", () => {
    assert.equal(normalizeHexColor("#fff"), "#ffffff");
    assert.equal(normalizeHexColor("0a4"), "#00aa44");
  });

  it("rejects anything that is not a hex colour", () => {
    assert.equal(normalizeHexColor("white"), null);
    assert.equal(normalizeHexColor("#gggggg"), null);
    assert.equal(normalizeHexColor("#ffff"), null);
    assert.equal(normalizeHexColor(""), null);
  });
});

describe("parseCollageTemplateInput", () => {
  it("parses a valid form submission", () => {
    const result = parseCollageTemplateInput(VALID);
    assert.ok(result.ok);
    assert.deepEqual(result.value, {
      name: "Small definitives",
      rows: 5,
      columns: 4,
      gapPercent: 5,
      background: "#ffffff",
      labelPercent: 1.5,
    });
  });

  it("trims the name and rejects a blank one", () => {
    const trimmed = parseCollageTemplateInput({ ...VALID, name: "  Large  " });
    assert.ok(trimmed.ok);
    assert.equal(trimmed.value.name, "Large");

    const blank = parseCollageTemplateInput({ ...VALID, name: "   " });
    assert.ok(!blank.ok);
    assert.match(blank.message, /Name is required/);
  });

  // A 1×1 template is the single-stamp case — one rendering path for every image (#310).
  it("allows a 1×1 template", () => {
    const result = parseCollageTemplateInput({ ...VALID, rows: "1", columns: "1" });
    assert.ok(result.ok);
    assert.equal(result.value.rows, 1);
  });

  it("rejects capacity outside the allowed range", () => {
    for (const rows of ["0", "-3", String(MAX_COLLAGE_AXIS + 1)]) {
      const result = parseCollageTemplateInput({ ...VALID, rows });
      assert.ok(!result.ok, `expected ${rows} rows to be rejected`);
      assert.match(result.message, /Rows/);
    }
  });

  // 0 is a meaningful value for both size fields: no spacing, no label strip.
  it("allows zero gap and zero label strip", () => {
    const result = parseCollageTemplateInput({ ...VALID, gapPercent: "0", labelPercent: "0" });
    assert.ok(result.ok);
    assert.equal(result.value.gapPercent, 0);
    assert.equal(result.value.labelPercent, 0);
  });

  it("rejects negative or oversized percentages", () => {
    const negative = parseCollageTemplateInput({ ...VALID, gapPercent: "-1" });
    assert.ok(!negative.ok);
    assert.match(negative.message, /Gap/);

    const huge = parseCollageTemplateInput({
      ...VALID,
      labelPercent: String(MAX_COLLAGE_LABEL_PERCENT + 1),
    });
    assert.ok(!huge.ok);
    assert.match(huge.message, /Label strip/);
  });

  it("takes the label strip in tenths, with either decimal separator (#337)", () => {
    // Against the whole image the usable band is about two percent wide, so whole numbers cannot
    // land inside it: 1 reads well where 2 already shouts.
    for (const [raw, expected] of [
      ["1.2", 1.2],
      ["1,2", 1.2],
      ["2", 2],
    ] as const) {
      const result = parseCollageTemplateInput({ ...VALID, labelPercent: raw });
      assert.ok(result.ok, `${raw} was refused`);
      assert.equal(result.value.labelPercent, expected);
    }

    // A second decimal place is past the point of any visible difference.
    const tooFine = parseCollageTemplateInput({ ...VALID, labelPercent: "1.25" });
    assert.ok(!tooFine.ok);
    assert.match(tooFine.message, /Label strip/);

    // The gap stays whole: it is a share of the stamp, where a percent is already a fine step.
    const fractionalGap = parseCollageTemplateInput({ ...VALID, gapPercent: "5.5" });
    assert.ok(!fractionalGap.ok);
    assert.match(fractionalGap.message, /Gap/);
  });

  it("rejects non-integer numbers", () => {
    const result = parseCollageTemplateInput({ ...VALID, gapPercent: "12.5" });
    assert.ok(!result.ok);
    assert.match(result.message, /whole number/);
  });

  it("normalises the background and rejects a non-colour", () => {
    const shorthand = parseCollageTemplateInput({ ...VALID, background: "FFF" });
    assert.ok(shorthand.ok);
    assert.equal(shorthand.value.background, "#ffffff");

    const bad = parseCollageTemplateInput({ ...VALID, background: "eggshell" });
    assert.ok(!bad.ok);
    assert.match(bad.message, /hex colour/);
  });
});
