import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phoneStampPath } from "../../src/lib/phone";
import {
  phoneCopiesSummary,
  phoneCopyLine,
  phoneMarketEvidence,
  phoneValueLabel,
  sortByValueAxes,
  type PhoneCopySource,
} from "../../src/lib/phone-stamp-view";
import { wantAxisTexts } from "../../src/lib/want-axes";

// The phone stamp screen (#2003, ADR-0072): its words for the desk's figures, and the one rule it
// shares with the stamp page's Wants card.

describe("phoneStampPath", () => {
  it("puts a stamp's phone screen under the collection's phone path", () => {
    assert.equal(phoneStampPath("poland", "s1"), "/c/poland/phone/stamps/s1");
  });
});

describe("phoneCopiesSummary", () => {
  it("says plainly when no copy is held", () => {
    assert.deepEqual(phoneCopiesSummary({ total: 0 }, 0, 0), ["No copies held"]);
  });

  it("counts the copies held, one or several", () => {
    assert.deepEqual(phoneCopiesSummary({ total: 1 }, 0, 0), ["1 copy held"]);
    assert.deepEqual(phoneCopiesSummary({ total: 3 }, 0, 0), ["3 copies held"]);
  });

  it("states the variants' copies and the possible ones beside the total, never in it", () => {
    assert.deepEqual(phoneCopiesSummary({ total: 0 }, 2, 1), [
      "No copies held",
      "2 more under its variants",
      "1 more might be this stamp",
    ]);
  });
});

const COPY: PhoneCopySource = {
  conditionName: "Mint never hinged",
  conditionAbbreviation: "MNH",
  certificateStatusName: null,
  formatName: null,
  inCollection: true,
  forSale: false,
  forTrade: false,
  locationId: null,
  locationRef: null,
};

const LOCATIONS = [
  { id: "cab", name: "Cabinet", parentId: null },
  { id: "a", name: "Stockbook A", parentId: "cab" },
];

describe("phoneCopyLine", () => {
  it("says the condition and that there is no certificate, and leaves a single unsaid", () => {
    assert.equal(phoneCopyLine(COPY, LOCATIONS).grade, "MNH · No certificate");
  });

  it("names the certificate and a multiple's format", () => {
    const line = phoneCopyLine(
      { ...COPY, certificateStatusName: "Expertised", formatName: "Pair" },
      LOCATIONS
    );
    assert.equal(line.grade, "MNH · Expertised · Pair");
  });

  it("falls back to the condition's name when it has no abbreviation", () => {
    assert.equal(
      phoneCopyLine({ ...COPY, conditionAbbreviation: "" }, LOCATIONS).grade,
      "Mint never hinged · No certificate"
    );
  });

  it("gives the location's whole path and the place within it", () => {
    assert.equal(
      phoneCopyLine({ ...COPY, locationId: "a", locationRef: "p. 4" }, LOCATIONS).location,
      "Cabinet › Stockbook A · p. 4"
    );
    assert.equal(phoneCopyLine({ ...COPY, locationId: "a" }, LOCATIONS).location, "Cabinet › Stockbook A");
  });

  it("says so when a copy is filed nowhere", () => {
    assert.equal(phoneCopyLine(COPY, LOCATIONS).location, "No location");
  });

  it("lists every disposition the copy carries, in the Copies row's order", () => {
    assert.deepEqual(
      phoneCopyLine({ ...COPY, inCollection: false, forTrade: true, forSale: true }, LOCATIONS)
        .dispositions,
      ["For sale", "For trade"]
    );
  });

  it("says so when a copy carries no disposition", () => {
    assert.deepEqual(phoneCopyLine({ ...COPY, inCollection: false }, LOCATIONS).dispositions, [
      "No disposition",
    ]);
  });
});

describe("phoneValueLabel and sortByValueAxes", () => {
  const cell = (
    condition: string,
    conditionSortOrder: number,
    certificate: string | null,
    certificateSortOrder: number,
    formatName: string | null = null,
    formatSortOrder = -1
  ) => ({
    conditionAbbreviation: condition,
    conditionSortOrder,
    certificateStatusAbbreviation: certificate,
    certificateSortOrder,
    formatName,
    formatSortOrder,
  });

  it("reads like the Valuation grid's row and column", () => {
    assert.equal(phoneValueLabel(cell("MNH", 0, null, -1)), "MNH · No cert.");
    assert.equal(phoneValueLabel(cell("U", 2, "Cert.", 1, "Pair", 3)), "U · Cert. · Pair");
  });

  it("orders by format, then condition, then certificate", () => {
    const rows = [
      cell("U", 2, null, -1, "Pair", 3),
      cell("U", 2, "Cert.", 1),
      cell("MNH", 0, null, -1),
      cell("U", 2, null, -1),
    ];
    assert.deepEqual(sortByValueAxes(rows).map(phoneValueLabel), [
      "MNH · No cert.",
      "U · No cert.",
      "U · Cert.",
      "U · No cert. · Pair",
    ]);
  });
});

describe("phoneMarketEvidence", () => {
  it("says the sample and the confidence in words", () => {
    assert.equal(phoneMarketEvidence(1, "low"), "1 result · low confidence");
    assert.equal(phoneMarketEvidence(7, "high"), "7 results · high confidence");
  });
});

describe("wantAxisTexts", () => {
  const dictionaries = {
    conditions: [
      { id: "mnh", name: "Mint never hinged", abbreviation: "MNH" },
      { id: "u", name: "Used", abbreviation: "" },
    ],
    certificateStatuses: [{ id: "c", name: "Expertised" }],
    formats: [{ id: "p", name: "Pair" }],
  };

  it("says 'any' out loud for an empty axis", () => {
    assert.deepEqual(
      wantAxisTexts({ conditionIds: [], certificateStatusIds: [], formatIds: [] }, dictionaries),
      { condition: "Any condition", certificate: "Certificate: any", format: "Any format" }
    );
  });

  it("names the members, null being each axis's own 'none'", () => {
    assert.deepEqual(
      wantAxisTexts(
        { conditionIds: ["mnh", "u"], certificateStatusIds: [null, "c"], formatIds: [null, "p"] },
        dictionaries
      ),
      {
        condition: "MNH, Used",
        certificate: "No certificate, Expertised",
        format: "Single, Pair",
      }
    );
  });
});
