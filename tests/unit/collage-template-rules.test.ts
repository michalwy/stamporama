import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHexColor,
  parseCollageTemplateInput,
  MAX_COLLAGE_AXIS,
  MAX_COLLAGE_PIXELS,
} from "../../src/lib/collage-template-rules";

const VALID = {
  name: "Small definitives",
  rows: "5",
  columns: "4",
  gap: "24",
  background: "#ffffff",
  labelStripHeight: "40",
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
      gap: 24,
      background: "#ffffff",
      labelStripHeight: 40,
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

  // 0 is a meaningful value for both pixel fields: no spacing, no label strip.
  it("allows zero gap and zero label strip height", () => {
    const result = parseCollageTemplateInput({ ...VALID, gap: "0", labelStripHeight: "0" });
    assert.ok(result.ok);
    assert.equal(result.value.gap, 0);
    assert.equal(result.value.labelStripHeight, 0);
  });

  it("rejects negative or oversized pixel values", () => {
    const negative = parseCollageTemplateInput({ ...VALID, gap: "-1" });
    assert.ok(!negative.ok);
    assert.match(negative.message, /Gap/);

    const huge = parseCollageTemplateInput({
      ...VALID,
      labelStripHeight: String(MAX_COLLAGE_PIXELS + 1),
    });
    assert.ok(!huge.ok);
    assert.match(huge.message, /Label strip height/);
  });

  it("rejects non-integer numbers", () => {
    const result = parseCollageTemplateInput({ ...VALID, gap: "12.5" });
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
