import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REF_CARD_GEOMETRY,
  MAX_CARD_MM,
  parseMillimetres,
  parseRefCardTemplateInput,
  refCardGeometrySummary,
} from "../../src/lib/ref-card-template-rules";

const VALID = {
  name: "Postcard pocket",
  cardWidthMm: "45",
  cardHeightMm: "24",
  fontSizeMm: "6",
  paddingTopMm: "3",
};

describe("parseMillimetres", () => {
  it("accepts a whole number and a tenth", () => {
    assert.deepEqual(parseMillimetres("45", "Card width", 5, 200), { ok: true, value: 45 });
    assert.deepEqual(parseMillimetres("62.5", "Card width", 5, 200), { ok: true, value: 62.5 });
  });

  it("accepts a comma as the decimal separator", () => {
    assert.deepEqual(parseMillimetres("62,5", "Card width", 5, 200), { ok: true, value: 62.5 });
  });

  it("rejects more than one decimal place", () => {
    const result = parseMillimetres("62.55", "Card width", 5, 200);
    assert.equal(result.ok, false);
  });

  it("rejects a missing value, a non-number and a negative", () => {
    for (const raw of ["", "  ", "wide", "-5"]) {
      assert.equal(parseMillimetres(raw, "Card width", 5, 200).ok, false);
    }
  });

  it("names the millimetre bounds it enforces", () => {
    const result = parseMillimetres("400", "Card width", 5, MAX_CARD_MM);
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.includes("200 mm"));
  });
});

describe("parseRefCardTemplateInput", () => {
  it("parses a valid form submission", () => {
    const result = parseRefCardTemplateInput(VALID);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, {
      name: "Postcard pocket",
      cardWidthMm: 45,
      cardHeightMm: 24,
      fontSizeMm: 6,
      paddingTopMm: 3,
    });
  });

  it("requires a name", () => {
    const result = parseRefCardTemplateInput({ ...VALID, name: "   " });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.includes("Name"));
  });

  it("reports the first field that is wrong, by the label the form uses", () => {
    const result = parseRefCardTemplateInput({ ...VALID, cardHeightMm: "0" });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.startsWith("Card height"));
  });

  it("refuses a ref that cannot fit on the card", () => {
    const result = parseRefCardTemplateInput({
      ...VALID,
      cardHeightMm: "10",
      fontSizeMm: "6",
      paddingTopMm: "6",
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.includes("card height"));
  });

  it("allows a ref that exactly fills the card, and no top padding at all", () => {
    const result = parseRefCardTemplateInput({
      ...VALID,
      cardHeightMm: "10",
      fontSizeMm: "10",
      paddingTopMm: "0",
    });
    assert.equal(result.ok, true);
  });

  it("accepts the built-in default as a template of its own", () => {
    const g = DEFAULT_REF_CARD_GEOMETRY;
    const result = parseRefCardTemplateInput({
      name: "Default",
      cardWidthMm: String(g.cardWidthMm),
      cardHeightMm: String(g.cardHeightMm),
      fontSizeMm: String(g.fontSizeMm),
      paddingTopMm: String(g.paddingTopMm),
    });
    assert.equal(result.ok, true);
  });
});

describe("refCardGeometrySummary", () => {
  it("states the card in millimetres", () => {
    assert.equal(
      refCardGeometrySummary(DEFAULT_REF_CARD_GEOMETRY),
      "45 × 24 mm · ref 6 mm from 3 mm"
    );
  });
});
