import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  specificationCopyOrder,
  specificationRow,
  type SpecificationSet,
} from "../../src/lib/offer-specification-rules";
import type { TitleTemplateCopy } from "../../src/lib/offer-title-template";

// An offer's specification for buyers (#1758): which copies it lists, in what order, and what a row
// says — and, as much as anything, what it does not.

const copy = (itemId: string, catalogSortKey: string | null, checklists?: [string, number][]) => ({
  itemId,
  sortOrder: null,
  catalogSortKey,
  ...(checklists ? { checklists: checklists.map(([checklistId, position]) => ({ checklistId, position })) } : {}),
});

const set = (
  id: string,
  sortOrder: number,
  items: SpecificationSet["items"],
  sold = false
): SpecificationSet => ({ id, sortOrder, sold, items });

describe("the copies an offer's specification lists (#1758)", () => {
  it("reads sets in their order and each set's copies in catalogue order", () => {
    const order = specificationCopyOrder(
      [set("b", 1, [copy("b2", "0002"), copy("b1", "0001")]), set("a", 0, [copy("a1", "0005")])],
      new Set(),
      false
    );
    assert.deepEqual(order, ["a1", "b1", "b2"]);
  });

  it("leaves out a set sold through the offer and a copy sold anywhere else", () => {
    const order = specificationCopyOrder(
      [
        set("a", 0, [copy("a1", "0001"), copy("a2", "0002")], true),
        set("b", 1, [copy("b1", "0003"), copy("b2", "0004")]),
      ],
      new Set(["b2"]),
      false
    );
    assert.deepEqual(order, ["b1"]);
  });

  it("lists nothing for an offer whose every set has sold", () => {
    const order = specificationCopyOrder([set("a", 0, [copy("a1", "0001")], true)], new Set(), false);
    assert.deepEqual(order, []);
  });

  it("groups a set's copies by checklist, in the checklist's order, when the photos are grouped", () => {
    // Catalogue order is x1, c2, c1, x2; checklist C holds c1 before c2. The group comes first, in
    // its own order, and the ungrouped rest follows in catalogue order — the photo plan's walk.
    const items = [
      copy("x1", "0001"),
      copy("c2", "0002", [["C", 1]]),
      copy("c1", "0003", [["C", 0]]),
      copy("x2", "0004"),
    ];
    assert.deepEqual(specificationCopyOrder([set("a", 0, items)], new Set(), true), [
      "c1",
      "c2",
      "x1",
      "x2",
    ]);
    // Without the offer's grouping, the same set reads in catalogue order.
    assert.deepEqual(specificationCopyOrder([set("a", 0, items)], new Set(), false), [
      "x1",
      "c2",
      "c1",
      "x2",
    ]);
  });

  it("does not group a checklist the sold copies have left with a single copy", () => {
    const items = [copy("c2", "0001", [["C", 1]]), copy("x1", "0002"), copy("c1", "0003", [["C", 0]])];
    assert.deepEqual(specificationCopyOrder([set("a", 0, items)], new Set(["c2"]), true), ["x1", "c1"]);
  });
});

const titleCopy = (over: Partial<TitleTemplateCopy> = {}): TitleTemplateCopy => ({
  name: "Kopernik",
  catalogNumbers: [
    { vendorId: "mi", vendorAbbr: "Mi", areaPrefix: "PL", number: "1234", isPrimary: true },
  ],
  year: 1973,
  condition: "Czysty",
  conditionAbbr: "**",
  conditionSymbol: null,
  certificate: null,
  certificateAbbr: null,
  area: "Polska",
  areaSymbol: null,
  location: "Klaser 3",
  ref: "A12",
  itemNo: 42,
  itemNoPad: 5,
  subtype: null,
  format: null,
  formatAbbr: null,
  denomination: null,
  perforation: null,
  color: null,
  watermark: null,
  paper: null,
  printing: null,
  issuedDate: null,
  issueName: "Rok Kopernikański",
  issueYear: 1972,
  unknownVariant: false,
  variants: null,
  listedAs: null,
  ...over,
});

describe("a row of an offer's specification (#1758)", () => {
  it("carries the copy's catalogue number, area, series, year, stamp, condition, faults and certificate", () => {
    const row = specificationRow(
      "item-1",
      titleCopy({ faults: ["Cienkie miejsce", "Zagięcie"], certificate: "Atest" }),
      "photo-1"
    );
    assert.deepEqual(row, {
      itemId: "item-1",
      photoId: "photo-1",
      area: "Polska",
      issue: "Rok Kopernikański",
      year: 1973,
      catalog: "Mi·PL 1234",
      description: "Kopernik",
      condition: "Czysty",
      faults: ["Cienkie miejsce", "Zagięcie"],
      certificate: "Atest",
    });
  });

  it("never carries the copy's shelf, ref or number", () => {
    const row = specificationRow("item-1", titleCopy(), null);
    const printed = JSON.stringify(row);
    for (const internal of ["Klaser 3", "A12", "00042"]) {
      assert.equal(printed.includes(internal), false, `${internal} is on the row`);
    }
  });

  it("names every stamp a cover carries", () => {
    const row = specificationRow(
      "item-1",
      titleCopy({
        carriedCatalogNumbers: [
          [{ vendorId: "mi", vendorAbbr: "Mi", areaPrefix: "PL", number: "200", isPrimary: true }],
          [{ vendorId: "mi", vendorAbbr: "Mi", areaPrefix: "PL", number: "205", isPrimary: true }],
        ],
      }),
      null
    );
    assert.equal(row.catalog, "Mi·PL 200,205");
  });

  it("falls back to the series' year when the stamp states none", () => {
    assert.equal(specificationRow("i", titleCopy({ year: null }), null).year, 1972);
  });
});
