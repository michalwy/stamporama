import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMMON_LANGUAGES } from "../../src/lib/languages";
import {
  hasSpecificationLabels,
  SPECIFICATION_LABEL_LANGUAGES,
  specificationCopyCount,
  specificationLabelLanguage,
  specificationLabels,
} from "../../src/lib/offer-specification-labels";
import {
  specificationContentsKey,
  type OfferSpecificationRow,
} from "../../src/lib/offer-specification-rules";

// The specification's own words in the offer's language (#1760), and what counts as its contents
// having changed.

describe("the specification's words (#1760)", () => {
  it("has words in every language the platform picker offers", () => {
    assert.deepEqual(
      [...SPECIFICATION_LABEL_LANGUAGES],
      COMMON_LANGUAGES.map((l) => l.code).sort()
    );
  });

  it("fills every word in every language", () => {
    for (const code of SPECIFICATION_LABEL_LANGUAGES) {
      const labels = specificationLabels(code);
      for (const [key, value] of Object.entries(labels)) {
        if (key === "copies") assert.ok((value as { other: string }).other, `${code}.copies.other`);
        else assert.ok(typeof value === "string" && value.trim(), `${code}.${key}`);
      }
    }
  });

  it("is English where the language has none, and says so", () => {
    assert.equal(hasSpecificationLabels("pl"), true);
    assert.equal(hasSpecificationLabels("pl-PL"), true);
    assert.equal(hasSpecificationLabels("ja"), false);
    assert.equal(hasSpecificationLabels(null), false);
    assert.equal(specificationLabels("ja").condition, "Condition");
    assert.equal(specificationLabelLanguage("ja"), "en");
    assert.equal(specificationLabels("pl").condition, "Stan");
  });

  it("counts copies in each language's plural form", () => {
    assert.equal(specificationCopyCount("en", 1), "1 copy");
    assert.equal(specificationCopyCount("en", 3), "3 copies");
    assert.equal(specificationCopyCount("pl", 1), "1 egzemplarz");
    assert.equal(specificationCopyCount("pl", 3), "3 egzemplarze");
    assert.equal(specificationCopyCount("pl", 5), "5 egzemplarzy");
    assert.equal(specificationCopyCount("pl", 22), "22 egzemplarze");
    assert.equal(specificationCopyCount("cs", 5), "5 kusů");
    assert.equal(specificationCopyCount("ru", 21), "21 экземпляр");
    assert.equal(specificationCopyCount("hu", 4), "4 példány");
    assert.equal(specificationCopyCount("ro", 20), "20 de exemplare");
  });
});

describe("the specification's contents (#1760)", () => {
  const row: OfferSpecificationRow = {
    itemId: "i1",
    photoId: "p1",
    area: "Poland",
    issue: "Copernicus",
    year: 1973,
    catalog: "Fi 2069",
    description: "Copernicus",
    condition: "MNH",
    faults: [],
    certificate: null,
  };
  const spec = { offerNo: 7, title: "Copernicus", language: "pl", rows: [row] };
  const key = specificationContentsKey(spec);

  it("is the same for the same specification", () => {
    assert.equal(specificationContentsKey({ ...spec, rows: [{ ...row }] }), key);
  });

  it("differs when anything a buyer reads differs", () => {
    const variants = [
      { ...spec, title: "Other" },
      { ...spec, offerNo: 8 },
      { ...spec, language: "en" },
      { ...spec, rows: [] },
      { ...spec, rows: [row, { ...row, itemId: "i2" }] },
      ...(Object.keys(row) as (keyof OfferSpecificationRow)[]).map((field) => ({
        ...spec,
        rows: [{ ...row, [field]: field === "faults" ? ["Thin"] : field === "year" ? 1974 : "changed" }],
      })),
    ];
    for (const variant of variants) {
      assert.notEqual(specificationContentsKey(variant), key, JSON.stringify(variant));
    }
  });
});
