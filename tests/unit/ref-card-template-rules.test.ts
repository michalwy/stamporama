import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CSS_PX_PER_MM,
  DEFAULT_REF_CARD_GEOMETRY,
  MAX_CARD_MM,
  parseMillimetres,
  parseRefCardGeometry,
  parseRefCardTemplateInput,
  refCardGeometrySummary,
  refCardPreviewScale,
  refCardSummaryRows,
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

describe("parseRefCardGeometry", () => {
  const FIELDS = {
    cardWidthMm: VALID.cardWidthMm,
    cardHeightMm: VALID.cardHeightMm,
    fontSizeMm: VALID.fontSizeMm,
    paddingTopMm: VALID.paddingTopMm,
  };

  it("parses the measurements without asking for a name", () => {
    assert.deepEqual(parseRefCardGeometry(FIELDS), {
      ok: true,
      value: { cardWidthMm: 45, cardHeightMm: 24, fontSizeMm: 6, paddingTopMm: 3 },
    });
  });

  it("refuses what the save refuses, in the same words", () => {
    for (const change of [
      { cardWidthMm: "" },
      { fontSizeMm: "0" },
      { cardHeightMm: "10", fontSizeMm: "6", paddingTopMm: "6" },
    ]) {
      const geometry = parseRefCardGeometry({ ...FIELDS, ...change });
      const template = parseRefCardTemplateInput({ ...VALID, ...change });
      assert.equal(geometry.ok, false);
      assert.deepEqual(geometry, template);
    }
  });
});

describe("refCardSummaryRows", () => {
  it("states the card, the ref and the padding in millimetres", () => {
    assert.deepEqual(refCardSummaryRows(DEFAULT_REF_CARD_GEOMETRY), [
      { label: "Card", value: "45 × 24 mm" },
      { label: "Ref", value: "6 mm" },
      { label: "Top padding", value: "3 mm" },
    ]);
  });
});

describe("refCardPreviewScale", () => {
  const card = { cardWidthMm: 50, cardHeightMm: 25 };
  const px = (mm: number) => mm * CSS_PX_PER_MM;

  it("is unknown until the room is measured", () => {
    assert.equal(refCardPreviewScale(card, { width: 0, height: 0 }), null);
    assert.equal(refCardPreviewScale(card, { width: 400, height: 0 }), null);
  });

  it("fits the width when the room is wide enough for the height", () => {
    // Room for 100 mm across and 100 mm down: the width binds, at 90 % of the room.
    const scale = refCardPreviewScale(card, { width: px(100), height: px(100) });
    assert.ok(scale !== null && Math.abs(scale - 1.8) < 1e-9);
  });

  it("fits the height when the room is short", () => {
    const scale = refCardPreviewScale(card, { width: px(1000), height: px(50) });
    assert.ok(scale !== null && Math.abs(scale - 1.8) < 1e-9);
  });

  it("keeps the card's proportions and never overflows the room", () => {
    const room = { width: 700, height: 300 };
    for (const c of [card, { cardWidthMm: 5, cardHeightMm: 200 }, { cardWidthMm: 200, cardHeightMm: 5 }]) {
      const scale = refCardPreviewScale(c, room)!;
      assert.ok(px(c.cardWidthMm) * scale <= room.width);
      assert.ok(px(c.cardHeightMm) * scale <= room.height);
    }
  });

  it("shrinks a card larger than the room rather than cropping it", () => {
    const scale = refCardPreviewScale({ cardWidthMm: 200, cardHeightMm: 200 }, { width: 300, height: 300 });
    assert.ok(scale !== null && scale < 1);
  });
});
