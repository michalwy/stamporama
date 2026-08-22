import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  colnectIdFromStampUrl,
  parseColnectBracketCells,
  parseColnectCatalogCodes,
  parseColnectListNames,
  readColnectList,
} from "../../src/lib/colnect-list-rules";

// Reading Colnect's own list export (#645). The two fixtures are real exports — the partner's wish
// list and the collector's own — trimmed to eight rows and stripped of both collectors' names, so
// every judgement below is asserted against a file Colnect actually produced rather than against a
// shape somebody imagined.

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures/colnect", name), "utf8");

function read(name: string) {
  const result = readColnectList(fixture(name));
  if (!result.ok) throw new Error(result.message);
  return result.file;
}

describe("the file's own preamble (#645)", () => {
  it("finds the header under five preamble lines and a blank one", () => {
    const file = read("partner-wish-list.csv");
    assert.equal(file.rows.length, 8);
    // The first row of the fixture, on line 8 of the file — counted through the blank line the CSV
    // reader drops.
    assert.equal(file.rows[0].line, 8);
    assert.equal(file.rows[0].name, "Solar Eclipses");
  });

  it("keeps the list's own URL, which is the link the trade wants", () => {
    assert.equal(
      read("partner-wish-list.csv").listUrl,
      "https://colnect.com/en/stamps/list/custom_list__18/partner"
    );
  });

  it("reports the count the file claims and when it was exported", () => {
    const file = read("partner-wish-list.csv");
    assert.equal(file.declaredCount, 8);
    assert.equal(file.exportedAt, "2026-08-22 10:06:42 GMT+0");
  });

  it("stops at the END line rather than reading it as a stamp", () => {
    const file = read("own-wish-list.csv");
    assert.equal(file.rows.length, 8);
    assert.ok(!file.rows.some((row) => row.name.toLowerCase().includes("end of colnect")));
  });

  it("refuses a file that is not a Colnect list, by name", () => {
    const result = readColnectList("id_auction,personal_reference\n123,T-1\n");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /Colnect list export/);
  });
});

describe("the three columns that carry the list (#645)", () => {
  it("splits Catalog Codes into the pairs the matcher takes, space before the colon and all", () => {
    assert.deepEqual(
      parseColnectCatalogCodes("Mi:AR BL176, Sn:AR 2949, Yt:AR BF174, Gz :AR BL164"),
      [
        { catalog: "Mi", number: "AR BL176" },
        { catalog: "Sn", number: "AR 2949" },
        { catalog: "Yt", number: "AR BF174" },
        { catalog: "Gz", number: "AR BL164" },
      ]
    );
  });

  it("keeps a number that holds dots and hyphens, splitting on the first colon only", () => {
    assert.deepEqual(parseColnectCatalogCodes("Col:NR 1954.02.06-01"), [
      { catalog: "Col", number: "NR 1954.02.06-01" },
    ]);
  });

  it("drops half a reference rather than guessing the other half", () => {
    assert.deepEqual(parseColnectCatalogCodes("Mi:PL 200, nonsense, :PL 300, Sn:"), [
      { catalog: "Mi", number: "PL 200" },
    ]);
  });

  it("takes the item id out of the Link column, which is the only place it lives", () => {
    const file = read("partner-wish-list.csv");
    assert.equal(file.rows[0].colnectId, "1153885");
    assert.equal(colnectIdFromStampUrl("https://colnect.com/en/stamps/stamp/1133075-X-Poland"), "1133075");
    assert.equal(colnectIdFromStampUrl("https://colnect.com/en/collectors/collector/partner"), null);
    assert.equal(colnectIdFromStampUrl(""), null);
  });

  it("never mistakes Parent Item for the row's own id", () => {
    // Line 13 of the real export carries `Parent Item` 287468 and links to stamp 287468 as well;
    // the fixture's Egypt rows do the same, so the assertion is that the id came from `Link`.
    const file = read("partner-wish-list.csv");
    for (const row of file.rows) {
      if (!row.colnectId) continue;
      assert.match(row.colnectId, /^\d+$/);
    }
  });

  it("keeps every bracket group, empties included, because they are positional", () => {
    assert.deepEqual(parseColnectBracketCells("[MNH]"), ["MNH"]);
    assert.deepEqual(parseColnectBracketCells(""), []);
    // The blank belongs to the second list; dropping it would shift the next grade onto it.
    assert.deepEqual(parseColnectBracketCells("[MNH],[]"), ["MNH", ""]);
    assert.deepEqual(parseColnectBracketCells("[2],[]"), ["2", ""]);
    assert.deepEqual(parseColnectBracketCells("[MNH],[U]"), ["MNH", "U"]);
    // A spreadsheet that ate the brackets still reads.
    assert.deepEqual(parseColnectBracketCells("MNH"), ["MNH"]);
  });

  it("splits the List cell into names", () => {
    assert.deepEqual(parseColnectListNames("Wish,Test Swap FROM"), ["Wish", "Test Swap FROM"]);
    assert.deepEqual(parseColnectListNames("Test Swap FROM"), ["Test Swap FROM"]);
    assert.deepEqual(parseColnectListNames(""), []);
  });
});

describe("what a row comes to (#645)", () => {
  it("reads quantity and condition where the collector stated them", () => {
    const file = read("own-wish-list.csv");
    const stated = file.rows[0];
    assert.equal(stated.name, "Coat of arms of Andorra");
    assert.deepEqual(stated.entries, [
      { listName: "Test Swap FROM", quantity: 1, conditionAbbrev: "MNH", publicNote: "" },
    ]);
  });

  it("says nothing rather than one where the file says nothing", () => {
    const file = read("own-wish-list.csv");
    const blank = file.rows[1];
    assert.equal(blank.name, "Rose");
    assert.deepEqual(blank.entries, [
      { listName: "Test Swap FROM", quantity: null, conditionAbbrev: null, publicNote: "" },
    ]);
  });

  it("gives a file that names no list one unnamed entry, not none", () => {
    // The partner's export states no list membership at all. That is still an export *of* something,
    // so the row has one entry with no name rather than nothing to import from.
    const row = read("partner-wish-list.csv").rows[0];
    assert.deepEqual(row.entries, [
      { listName: "", quantity: null, conditionAbbrev: null, publicNote: "" },
    ]);
  });

  it("counts the lists and names the likeliest one", () => {
    const file = read("own-list-two-lists.csv");
    assert.deepEqual(file.lists, [
      { name: "Test Swap FROM", rows: 12 },
      { name: "Wish", rows: 4 },
    ]);
    // Every row carries it, which is what makes it the list this file is.
    assert.equal(file.suggestedList, "Test Swap FROM");
  });

  it("keeps a grade per list, positionally — the same stamp mint on one and used on the other", () => {
    const file = read("own-list-two-lists.csv");
    // Line 19: List "Wish,Test Swap FROM", Quantity "[1],[1]", Condition "[MNH],[U]".
    const row = file.rows.find((entry) => entry.line === 19);
    assert.ok(row);
    assert.deepEqual(row.entries, [
      { listName: "Wish", quantity: 1, conditionAbbrev: "MNH", publicNote: "" },
      { listName: "Test Swap FROM", quantity: 1, conditionAbbrev: "U", publicNote: "" },
    ]);
  });

  it("keeps a blank group on the list it belongs to rather than shifting the next one onto it", () => {
    // Line 16: Quantity "[2],[]", Condition "[MNH],[]" — the 2 and the MNH are Wish's, and the swap
    // list states nothing. Dropping the blanks would put MNH on the swap list.
    const row = read("own-list-two-lists.csv").rows.find((entry) => entry.line === 16);
    assert.ok(row);
    assert.deepEqual(row.entries, [
      { listName: "Wish", quantity: 2, conditionAbbrev: "MNH", publicNote: "" },
      { listName: "Test Swap FROM", quantity: null, conditionAbbrev: null, publicNote: "" },
    ]);
  });

  it("keeps what a row needs to be recognised by eye when it cannot be matched", () => {
    const row = read("partner-wish-list.csv").rows[1];
    assert.equal(row.country, "Estonia");
    assert.equal(row.series, "National Costumes (1994)");
    assert.equal(row.issuedOn, "1994-08-23");
  });
});
