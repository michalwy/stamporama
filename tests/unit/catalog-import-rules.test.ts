import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_IMPORT_MAX_STAMPS_PER_ROW,
  planCatalogImport,
  readCatalogImportFile,
  type CatalogImportContext,
  type CatalogImportFile,
  type CatalogImportMapping,
  type CatalogImportRow,
  type ExistingCatalogNumber,
} from "../../src/lib/catalog-import-rules";

// Reading a catalog CSV and saying what importing it would do (#716). The plan is what the preview
// draws (#718) and what the commit executes (#717), so what is asserted here is the promise both of
// them keep.

const VENDOR = "vendor-mi";

function read(text: string): CatalogImportFile {
  const result = readCatalogImportFile(text);
  if (!result.ok) throw new Error(result.message);
  return result.file;
}

/** The mapping the fixtures below are written for: year, name, numbers. */
const MAPPING: CatalogImportMapping = { year: 0, name: 1, spec: 2 };

function plan(
  text: string,
  existingNumbers: readonly ExistingCatalogNumber[] = [],
  mapping: CatalogImportMapping = MAPPING,
  context: Partial<CatalogImportContext> = {}
) {
  return planCatalogImport(read(text), mapping, {
    catalogVendorId: VENDOR,
    areaPrefix: "PL",
    existingNumbers,
    ...context,
  });
}

/** One existing number under the import's own prefix, on the named issue. */
function held(
  number: string,
  issue: { id: string; name?: string | null; year?: number | null } | null,
  areaPrefix: string | null = "PL"
): ExistingCatalogNumber {
  return {
    number,
    areaPrefix,
    issue: issue ? { id: issue.id, name: issue.name ?? null, year: issue.year ?? null } : null,
  };
}

function expectKind<K extends CatalogImportRow["kind"]>(
  row: CatalogImportRow,
  kind: K
): Extract<CatalogImportRow, { kind: K }> {
  assert.equal(row.kind, kind, `expected ${kind}, got ${row.kind}: ${JSON.stringify(row)}`);
  return row as Extract<CatalogImportRow, { kind: K }>;
}

describe("reading the file (#716)", () => {
  it("takes the first record as the header and everything under it as rows", () => {
    const file = read("Year,Name,Numbers\n1918,Chain breakers,1-5\n1919,Overprints,6-8\n");
    assert.deepEqual(
      file.columns.map((c) => c.name),
      ["Year", "Name", "Numbers"]
    );
    assert.equal(file.rows.length, 2);
    // Line 2 of the file, so a refusal names something findable in the spreadsheet.
    assert.equal(file.rows[0].line, 2);
  });

  it("shows the first few values under each column, so an unnamed one is still recognisable", () => {
    const file = read(
      "Year,,Numbers\n1918,Chain breakers,1-5\n1919,,6-8\n1920,Coats of arms,9\n1921,More,10\n"
    );
    assert.deepEqual(
      file.columns.map((c) => c.name),
      ["Year", "", "Numbers"]
    );
    assert.deepEqual(file.columns[0].samples, ["1918", "1919", "1920"]);
    // Blank cells are not samples — a sample is there to be read.
    assert.deepEqual(file.columns[1].samples, ["Chain breakers", "Coats of arms", "More"]);
  });

  it("finds the header under a blank opening line, which is not a record", () => {
    const file = read("\nYear,Name,Numbers\n1918,Chain breakers,1-5\n");
    assert.equal(file.separator, ",");
    assert.deepEqual(
      file.columns.map((c) => c.name),
      ["Year", "Name", "Numbers"]
    );
    assert.equal(file.rows.length, 1);
    assert.equal(file.rows[0].line, 3);
  });

  it("reads a semicolon file, which is what a European spreadsheet writes", () => {
    const file = read("Year;Name;Numbers\n1918;Chain breakers;1-5\n");
    assert.equal(file.separator, ";");
    assert.deepEqual(file.rows[0].fields, ["1918", "Chain breakers", "1-5"]);
  });

  it("keeps a comma file a comma file even when a cell holds a semicolon", () => {
    const file = read("Year,Name,Numbers\n1918,\"Chain breakers; second printing\",1-5\n");
    assert.equal(file.separator, ",");
    assert.equal(file.rows[0].fields[1], "Chain breakers; second printing");
  });

  it("reads a header with nothing under it as a file with no rows, not as a failure", () => {
    const file = read("Year,Name,Numbers\n");
    assert.equal(file.columns.length, 3);
    assert.deepEqual(file.rows, []);
  });

  it("refuses an empty file", () => {
    const result = readCatalogImportFile("   \n\n");
    assert.equal(result.ok, false);
  });
});

describe("the mapping decides which cell is which (#716)", () => {
  it("reads year, name and numbers off the columns the collector pointed at", () => {
    const { rows } = plan("Numbers,Year,Name\n1-3,1918,Chain breakers\n", [], {
      spec: 0,
      year: 1,
      name: 2,
    });
    const row = expectKind(rows[0], "new-issue");
    assert.equal(row.year, 1918);
    assert.equal(row.name, "Chain breakers");
    assert.deepEqual(row.numbers, ["1", "2", "3"]);
  });

  it("takes an unmapped name or year as *the file says nothing*, not as an error", () => {
    const { rows } = plan("Numbers\n1-3\n", [], { spec: 0, year: null, name: null });
    const row = expectKind(rows[0], "new-issue");
    assert.equal(row.year, null);
    assert.equal(row.name, null);
  });

  it("reads a row too short to reach a mapped column the same way", () => {
    const { rows } = plan("Year,Name,Numbers\n1918\n", [], { spec: 0, year: 1, name: 2 });
    // Column 0 is the spec here, so the short row still carries one.
    const row = expectKind(rows[0], "new-issue");
    assert.deepEqual(row.numbers, ["1918"]);
    assert.equal(row.name, null);
  });
});

describe("the numbers column is the create dialog's own spec (#452, #716)", () => {
  it("generates the same stamps that dialog would — two variant runs off one row", () => {
    const { rows } = plan("Year,Name,Numbers\n1994,Series,\"2895A-2897A, 2895B-2897B\"\n");
    const row = expectKind(rows[0], "new-issue");
    assert.deepEqual(row.numbers, ["2895A", "2896A", "2897A", "2895B", "2896B", "2897B"]);
    // Suffixes dropped, prefix kept, min to max of the bases.
    assert.deepEqual(row.declared, { firstNumber: "2895", lastNumber: "2897" });
  });

  it("reports the parser's own refusal as the row's reason", () => {
    const { rows } = plan("Year,Name,Numbers\n1918,Bad,1-2-3\n");
    assert.match(expectKind(rows[0], "error").reason, /one dash per range/);
  });

  it("treats a blank numbers cell as the parser does — a row with nothing to import", () => {
    const { rows } = plan("Year,Name,Numbers\n1918,Nothing,\n");
    assert.match(expectKind(rows[0], "error").reason, /at least one catalog number/);
  });

  it("refuses a year that is not one", () => {
    const { rows } = plan("Year,Name,Numbers\n19x8,Chain breakers,1-3\n1200,Too early,4-6\n");
    assert.match(expectKind(rows[0], "error").reason, /valid year/);
    assert.match(expectKind(rows[1], "error").reason, /valid year/);
  });

  it("takes a blank year as no year, which an issue is allowed to have", () => {
    const { rows } = plan("Year,Name,Numbers\n,Undated,1-3\n");
    assert.equal(expectKind(rows[0], "new-issue").year, null);
  });

  it("refuses a row asking for more stamps than a row may create", () => {
    const { rows } = plan(`Year,Name,Numbers\n1918,Huge,1-${CATALOG_IMPORT_MAX_STAMPS_PER_ROW + 1}\n`);
    assert.match(expectKind(rows[0], "error").reason, /at most 200 stamps/);
  });

  it("allows a row at the cap — far past the dialog's own 50", () => {
    const { rows } = plan(`Year,Name,Numbers\n1918,Big,1-${CATALOG_IMPORT_MAX_STAMPS_PER_ROW}\n`);
    assert.equal(expectKind(rows[0], "new-issue").numbers.length, 200);
  });
});

describe("classifying a row against the collection (#716)", () => {
  const file = "Year,Name,Numbers\n1918,Chain breakers,1-3\n";

  it("creates the issue where the collection holds none of its numbers", () => {
    const { rows, summary } = plan(file);
    expectKind(rows[0], "new-issue");
    assert.deepEqual(summary, {
      newIssues: 1,
      filled: 0,
      noChange: 0,
      errors: 0,
      stampsToCreate: 3,
    });
  });

  it("fills an existing issue in, appending only the numbers it lacks", () => {
    const { rows, summary } = plan(file, [held("1", { id: "issue-1", name: "Chain breakers", year: 1918 })]);
    const row = expectKind(rows[0], "fill-existing");
    assert.equal(row.issue.id, "issue-1");
    assert.deepEqual(row.missingNumbers, ["2", "3"]);
    assert.equal(row.noChange, false);
    assert.equal(summary.filled, 1);
    assert.equal(summary.stampsToCreate, 2);
  });

  it("fills an empty name and a missing year, and overwrites neither when they are filled", () => {
    const empty = plan(file, [held("1", { id: "issue-1", name: "  ", year: null })]);
    const emptyRow = expectKind(empty.rows[0], "fill-existing");
    assert.equal(emptyRow.fillName, "Chain breakers");
    assert.equal(emptyRow.fillYear, 1918);

    const filled = plan(file, [held("1", { id: "issue-1", name: "Its own name", year: 1919 })]);
    const filledRow = expectKind(filled.rows[0], "fill-existing");
    assert.equal(filledRow.fillName, null);
    assert.equal(filledRow.fillYear, null);
  });

  it("reports a matched issue that already holds everything as changing nothing", () => {
    const existing = ["1", "2", "3"].map((n) => held(n, { id: "issue-1", name: "Chain breakers", year: 1918 }));
    const { rows, summary } = plan(file, existing);
    const row = expectKind(rows[0], "fill-existing");
    assert.equal(row.noChange, true);
    assert.deepEqual(row.missingNumbers, []);
    assert.equal(summary.noChange, 1);
    assert.equal(summary.filled, 0);
    assert.equal(summary.stampsToCreate, 0);
  });

  it("refuses a row whose numbers are spread across two issues — an import does not merge", () => {
    const { rows, summary } = plan(file, [
      held("1", { id: "issue-1", name: "Chain breakers", year: 1918 }),
      held("3", { id: "issue-2", name: "Overprints", year: 1919 }),
    ]);
    const row = expectKind(rows[0], "error");
    assert.match(row.reason, /2 existing issues/);
    assert.match(row.reason, /Chain breakers/);
    assert.match(row.reason, /Overprints/);
    assert.equal(summary.errors, 1);
  });

  it("names an unnamed issue by its year in that refusal", () => {
    const { rows } = plan(file, [
      held("1", { id: "issue-1", name: null, year: 1918 }),
      held("3", { id: "issue-2", name: null, year: null }),
    ]);
    assert.match(expectKind(rows[0], "error").reason, /the 1918 issue, an unnamed issue/);
  });

  it("refuses a number already held by a stamp on no issue — there is nothing to fill", () => {
    const { rows } = plan(file, [held("2", null)]);
    assert.match(expectKind(rows[0], "error").reason, /on no issue/);
  });

  it("matches on catalog identity, so the same number under another prefix is another stamp", () => {
    const { rows } = plan(file, [held("1", { id: "issue-1", name: "Elsewhere" }, "SP")]);
    // `Mi·SP 1` is not `Mi·PL 1` (#85/#377), so nothing here is taken.
    expectKind(rows[0], "new-issue");
  });
});

describe("a row is classified against the earlier rows of its own file (#716)", () => {
  it("refuses the second row to claim a number, naming the line that took it", () => {
    const { rows, summary } = plan(
      "Year,Name,Numbers\n1918,Chain breakers,1-3\n1919,Overprints,3-5\n"
    );
    expectKind(rows[0], "new-issue");
    const clash = expectKind(rows[1], "error");
    assert.match(clash.reason, /3 is already claimed by the row on line 2\./);
    // The first row still stands: an error row is skipped, never blocking the file.
    assert.equal(summary.newIssues, 1);
    assert.equal(summary.errors, 1);
  });

  it("counts a fill row's numbers as claimed too, existing ones included", () => {
    const { rows } = plan("Year,Name,Numbers\n1918,Chain breakers,1-3\n1918,Again,2\n", [
      held("1", { id: "issue-1", name: "Chain breakers", year: 1918 }),
    ]);
    expectKind(rows[0], "fill-existing");
    assert.match(expectKind(rows[1], "error").reason, /2 is already claimed by the row on line 2\./);
  });

  it("lets two rows that share no number both stand", () => {
    const { summary } = plan("Year,Name,Numbers\n1918,First,1-3\n1919,Second,4-6\n");
    assert.equal(summary.newIssues, 2);
    assert.equal(summary.stampsToCreate, 6);
  });

  it("reports the spec's own repeat rather than a self-collision", () => {
    const { rows } = plan("Year,Name,Numbers\n1918,Twice,\"1-3, 2\"\n");
    assert.match(expectKind(rows[0], "error").reason, /2 appears more than once/);
  });
});

describe("a mixed file is classified whole (#716)", () => {
  it("keeps every row's own verdict and adds them up", () => {
    const { rows, summary } = plan(
      [
        "Year,Name,Numbers",
        "1918,Chain breakers,1-3", // fills issue-1 with 2 and 3
        "1919,Overprints,10-12", // new
        "19x9,Broken,20", // error: year
        "1920,Clash,3", // error: line 2 took it
        "1921,Split,30-31", // error: two issues
      ].join("\n") + "\n",
      [
        held("1", { id: "issue-1", name: "Chain breakers", year: 1918 }),
        held("30", { id: "issue-2", name: "A", year: 1921 }),
        held("31", { id: "issue-3", name: "B", year: 1921 }),
      ]
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["fill-existing", "new-issue", "error", "error", "error"]
    );
    assert.deepEqual(summary, {
      newIssues: 1,
      filled: 1,
      noChange: 0,
      errors: 3,
      stampsToCreate: 5,
    });
  });
});
