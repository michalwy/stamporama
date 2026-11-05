import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { issueFormatChipView } from "../../src/lib/stamp-issue-format-defaults";

// The chip every stamp row and copy row draws for its stamp's issue format (#2441).

const SHEET = { id: "if-bl", name: "Souvenir sheet", abbreviation: "Bl", color: "indigo" };
const PANE = { id: "if-hbl", name: "Booklet pane", abbreviation: "", color: null };

describe("issueFormatChipView (#2441)", () => {
  it("draws nothing for an ordinary stamp, whatever the dictionary holds", () => {
    assert.equal(issueFormatChipView(null, [SHEET]), null);
    assert.equal(issueFormatChipView(undefined, [SHEET], SHEET), null);
  });

  it("shows the abbreviation, the name for the hover and the colour from the dictionary", () => {
    assert.deepEqual(issueFormatChipView("if-bl", [SHEET, PANE]), {
      label: "Bl",
      name: "Souvenir sheet",
      color: "indigo",
    });
  });

  it("falls back to the name where the format has no abbreviation", () => {
    assert.equal(issueFormatChipView("if-hbl", [SHEET, PANE])?.label, "Booklet pane");
  });

  it("takes a recolour from the dictionary over the row's own label", () => {
    const recoloured = { ...SHEET, color: "teal" };
    assert.equal(issueFormatChipView("if-bl", [recoloured], SHEET)?.color, "teal");
  });

  it("uses the row's label only while the dictionary is still loading", () => {
    assert.equal(issueFormatChipView("if-bl", undefined, SHEET)?.label, "Bl");
    assert.equal(issueFormatChipView("if-bl", undefined), null);
  });

  it("draws nothing for an id the loaded dictionary does not hold — no stale label", () => {
    assert.equal(issueFormatChipView("gone", [PANE], SHEET), null);
  });
});
