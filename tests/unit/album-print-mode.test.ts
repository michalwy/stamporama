import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumEffectivePrintModes,
  albumIssueRuns,
  albumPrintModeOffered,
  asAlbumPrintMode,
  type AlbumPrintMode,
  type AlbumPrintModeEntry,
} from "../../src/lib/album-print-mode";
import {
  ALBUM_SUBHEADING_BEFORE_1509,
  DEFAULT_ALBUM_PRESET,
} from "../../src/lib/album-template-rules";

const entry = (
  id: string,
  issueId: string | null,
  checklistName: string,
  printMode: AlbumPrintMode | null = null,
  issueName: string | null = issueId ? "Issue XYZ" : null
): AlbumPrintModeEntry => ({ id, issueId, issueName, checklistName, printMode });

const modes = (entries: AlbumPrintModeEntry[]) =>
  Object.fromEntries(
    [...albumEffectivePrintModes(entries)].map(([id, m]) => [id, `${m.mode}${m.defaulted ? "" : "!"}`])
  );

describe("albumEffectivePrintModes (#1509)", () => {
  it("prints an issue's only checklist in the album as its own issue", () => {
    assert.deepEqual(modes([entry("a", "i1", "Issue XYZ")]), { a: "own" });
    assert.deepEqual(modes([entry("a", "i1", "Imperforate")]), { a: "own" });
  });

  it("groups an issue's several checklists: the main one without a heading, the rest under sub-headings", () => {
    assert.deepEqual(
      modes([
        entry("main", "i1", "Issue XYZ"),
        entry("x", "i1", "Watermark X"),
        entry("y", "i1", "Watermark Y"),
      ]),
      { main: "within", x: "within-subheading", y: "within-subheading" }
    );
  });

  it("counts the whole album, not only the neighbours", () => {
    assert.deepEqual(
      modes([entry("main", "i1", "Issue XYZ"), entry("o", "i2", "Other", null, "Other"), entry("x", "i1", "Watermark X")]),
      { main: "within", o: "own", x: "within-subheading" }
    );
  });

  it("gives every checklist a sub-heading when none is named after the issue", () => {
    assert.deepEqual(
      modes([entry("x", "i1", "Watermark X"), entry("y", "i1", "Watermark Y")]),
      { x: "within-subheading", y: "within-subheading" }
    );
  });

  it("recognises the main checklist by its name as typed, trimmed", () => {
    assert.deepEqual(
      modes([entry("main", "i1", " Issue XYZ "), entry("x", "i1", "Watermark X")]),
      { main: "within", x: "within-subheading" }
    );
  });

  it("keeps the collector's own choice over the default", () => {
    assert.deepEqual(
      modes([entry("main", "i1", "Issue XYZ", "own"), entry("x", "i1", "Watermark X", "within")]),
      { main: "own!", x: "within!" }
    );
  });

  it("prints a checklist spanning issues as its own, whatever is stored", () => {
    assert.deepEqual(modes([entry("span", null, "Set", "within")]), { span: "own!" });
    assert.deepEqual(modes([entry("span", null, "Set")]), { span: "own" });
    assert.equal(albumPrintModeOffered({ issueId: null }), false);
    assert.equal(albumPrintModeOffered({ issueId: "i1" }), true);
  });
});

describe("albumIssueRuns (#1509)", () => {
  it("runs consecutive checklists of one issue printed within it", () => {
    const entries = [
      entry("main", "i1", "Issue XYZ"),
      entry("x", "i1", "Watermark X"),
      entry("o", "i2", "Other", null, "Other"),
      entry("y", "i1", "Watermark Y"),
    ];
    assert.deepEqual(albumIssueRuns(entries, albumEffectivePrintModes(entries)), [
      ["main", "x"],
      ["y"],
    ]);
  });

  it("ends a run at a checklist of the same issue printed as its own", () => {
    const entries = [
      entry("x", "i1", "Watermark X"),
      entry("main", "i1", "Issue XYZ", "own"),
      entry("y", "i1", "Watermark Y"),
    ];
    assert.deepEqual(albumIssueRuns(entries, albumEffectivePrintModes(entries)), [["x"], ["y"]]);
  });
});

describe("asAlbumPrintMode", () => {
  it("reads the three modes and nothing else", () => {
    assert.equal(asAlbumPrintMode("own"), "own");
    assert.equal(asAlbumPrintMode("within"), "within");
    assert.equal(asAlbumPrintMode("within-subheading"), "within-subheading");
    assert.equal(asAlbumPrintMode("grouped"), null);
    assert.equal(asAlbumPrintMode(null), null);
  });
});

describe("the sub-heading's values (#1509)", () => {
  it("starts a new template where the migration put every existing album", () => {
    for (const [key, value] of Object.entries(ALBUM_SUBHEADING_BEFORE_1509)) {
      assert.equal(DEFAULT_ALBUM_PRESET[key as keyof typeof DEFAULT_ALBUM_PRESET], value, key);
    }
  });
});
