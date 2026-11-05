import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORDINARY_STAMP_ISSUE_FORMAT } from "../../src/lib/issue-format-filter";
import { ApiError } from "../../src/lib/agent-api/errors";
import {
  NO_ISSUE_FORMAT,
  assertIssueFormatWordsFree,
  issueFormatFilterParameter,
  resolveIssueFormatFilter,
  resolveIssueFormatWrite,
} from "../../src/lib/agent-api/issue-formats";

// A stamp's issue format through the agent API (#2445): `none` is an ordinary stamp, a filter's
// values are the lists' own, and a name the resolver could not tell apart is refused before it is
// written. The operations themselves are driven in `tests/integration/agent-api-issue-formats.test.ts`.

const FORMATS = [
  { id: "f1", name: "Souvenir sheet", abbreviation: "Bl" },
  { id: "f2", name: "Stamp from a souvenir sheet", abbreviation: "exBl" },
  { id: "f3", name: "Booklet pane", abbreviation: "HBl" },
];

describe("naming an issue format to write", () => {
  it("takes an id, a name or an abbreviation, whatever its case — and `none` is an ordinary stamp", () => {
    assert.equal(resolveIssueFormatWrite("f3", FORMATS, "issue_format"), "f3");
    assert.equal(resolveIssueFormatWrite(" souvenir SHEET ", FORMATS, "issue_format"), "f1");
    assert.equal(resolveIssueFormatWrite("exbl", FORMATS, "issue_format"), "f2");
    assert.equal(resolveIssueFormatWrite("None", FORMATS, "issue_format"), null);
    assert.equal(NO_ISSUE_FORMAT, "none");
  });

  it("refuses a name it does not know, handing back the names it does", () => {
    assert.throws(
      () => resolveIssueFormatWrite("Coil stamp", FORMATS, "issue_format"),
      (err: unknown) =>
        err instanceof ApiError &&
        /issue format/.test(err.message) &&
        (err.accepted ?? []).includes("Souvenir sheet (Bl)")
    );
  });
});

describe("an issue-format filter", () => {
  it("is the lists' own filter: ids, with `none` as the ordinary-stamp value ticked beside them", () => {
    assert.deepEqual(resolveIssueFormatFilter(["Bl", "none", "f1"], FORMATS, "issue_format"), ["f1", ORDINARY_STAMP_ISSUE_FORMAT]);
    assert.deepEqual(resolveIssueFormatFilter(["NONE"], FORMATS, "issue_format"), [ORDINARY_STAMP_ISSUE_FORMAT]);
  });

  it("is declared once, as a list a query can repeat or comma-separate, naming `none`", () => {
    const spec = issueFormatFilterParameter("stamps");
    assert.equal(spec.name, "issue_format");
    assert.equal(spec.in, "query");
    assert.equal(spec.type, "string[]");
    assert.match(spec.description, /`none` for the ordinary stamps/);
    assert.match(spec.description, /Not a copy's `format`/);
  });
});

describe("a new name or abbreviation for an issue format", () => {
  it("is refused when another issue format already answers to it, by name or by abbreviation", () => {
    for (const words of [{ name: "souvenir sheet" }, { name: "BL" }, { abbreviation: "Booklet pane" }, { abbreviation: " hbl " }]) {
      assert.throws(
        () => assertIssueFormatWordsFree(FORMATS, words),
        (err: unknown) => err instanceof ApiError && /already has an issue format answering to/.test(err.message),
        JSON.stringify(words)
      );
    }
  });

  it("is never a clash with the issue format's own words, so a correction of case goes through", () => {
    assertIssueFormatWordsFree(FORMATS, { name: "Souvenir Sheet", abbreviation: "BL" }, "f1");
    assertIssueFormatWordsFree(FORMATS, { name: "Coil stamp", abbreviation: "Coil" });
  });

  it("is refused when it is `none`, which this API keeps for an ordinary stamp", () => {
    assert.throws(() => assertIssueFormatWordsFree(FORMATS, { name: "None" }), /"name" cannot be "none"/);
    assert.throws(() => assertIssueFormatWordsFree(FORMATS, { abbreviation: "none" }), /"abbreviation" cannot be "none"/);
  });
});
