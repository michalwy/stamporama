import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAlbumPages,
  type AlbumBlockGroup,
  type AlbumBlockSpec,
  type AlbumBoxSpec,
  type AlbumChapterSpec,
  type AlbumPlannedPage,
  type AlbumTextMetrics,
} from "../../src/lib/album-layout";
import { DEFAULT_ALBUM_PRESET, type AlbumRenderPreset } from "../../src/lib/album-template-rules";

// Checklists printed within their issue (#1509): one issue heading over consecutive checklists of one
// issue, sub-headings under it, the heading repeated `[2]` where the run goes on to another sheet.
//
// The measurer is `album-layout.test.ts`'s: a character is a tenth of the type size wide, a line half
// of it tall. On the default A4 preset with the running head `Album` and no year heading the content
// runs from 23 mm to 283 mm — 260 mm. An issue heading at 12 pt costs 8 above + 6 + 5 below = 19 mm; a
// sub-heading at 10 pt costs 5 + 3 below = 8 mm, with 6 above it where it follows boxes.

const metrics: AlbumTextMetrics = {
  measureMm: (text, _face, sizePt) => text.length * sizePt * 0.1,
  lineHeightMm: (_face, sizePt) => sizePt * 0.5,
};

const preset = (over: Partial<AlbumRenderPreset> = {}): AlbumRenderPreset => ({
  ...DEFAULT_ALBUM_PRESET,
  ...over,
});

const box = (widthMm: number, heightMm: number): AlbumBoxSpec => ({ widthMm, heightMm, label: "" });

const ISSUE: AlbumBlockGroup = { key: "issue-1", heading: "1940, Issue" };

/** A checklist printed within `group`: blank heading is mode 2, a name is mode 3's sub-heading. */
const within = (
  entryId: string,
  heading: string,
  boxes: AlbumBoxSpec[],
  group: AlbumBlockGroup = ISSUE,
  ...printedPageIds: string[]
): AlbumBlockSpec => ({
  entryId,
  heading,
  role: heading ? "subheading" : undefined,
  boxes,
  group,
  printMode: heading ? "within-subheading" : "within",
  printedPageIds: printedPageIds.length ? printedPageIds : null,
});

const own = (entryId: string, heading: string, boxes: AlbumBoxSpec[]): AlbumBlockSpec => ({
  entryId,
  heading,
  boxes,
  printedPageIds: null,
});

const chapter = (blocks: AlbumBlockSpec[], heading = ""): AlbumChapterSpec => ({
  key: "1940",
  heading,
  blocks,
});

const live = (pages: AlbumPlannedPage[]) =>
  pages.filter((p): p is Extract<AlbumPlannedPage, { kind: "live" }> => p.kind === "live");

const plan = (blocks: AlbumBlockSpec[], over: Partial<AlbumRenderPreset> = {}, year = "") =>
  planAlbumPages([chapter(blocks, year)], preset(over), "Album", metrics).pages;

const headings = (page: Extract<AlbumPlannedPage, { kind: "live" }>) =>
  page.headings.map((h) => h.lines.join(" "));

/** Eight rows of one 100 mm box each: 8 × 50 + 7 × 6 = 442 mm, taller than any sheet. */
const tallRows = () => Array.from({ length: 8 }, () => box(100, 50));

describe("planAlbumPages and checklists printed within their issue (#1509)", () => {
  it("prints the issue's heading once over consecutive checklists of it, each sub-heading under it", () => {
    // 100 mm boxes, too wide to share a band, so the two stack.
    const [page] = live(
      plan([within("main", "", [box(100, 30)]), within("wmx", "Watermark X", [box(100, 30)])])
    );
    assert.deepEqual(headings(page), ["1940, Issue", "Watermark X"]);
    assert.equal(page.blocks[0].groupHeading, "1940, Issue");
    assert.equal(page.blocks[1].groupHeading, undefined);
    assert.deepEqual(
      page.blocks.map((b) => b.groupPart),
      [1, 1]
    );
    const [issue, sub] = page.headings;
    // The issue heading is set across the content width, as the chapter heading is.
    assert.equal(issue.xMm, page.content.xMm);
    assert.equal(issue.widthMm, page.content.widthMm);
    // The main checklist's boxes sit straight under the issue heading's space below — no lead of
    // their own, as `STAMP_H1 … 5` then a row does in his sources.
    assert.equal(issue.yMm, 23 + 8);
    assert.equal(page.boxes[0].yMm, issue.yMm + 6 + 5);
    // The sub-heading follows the main checklist's row at its own space above.
    assert.equal(sub.yMm, page.boxes[0].yMm + 30 + 6);
    assert.equal(sub.role, "subheading");
    assert.equal(page.boxes[1].yMm, sub.yMm + 5 + 3);
  });

  it("puts a sub-heading straight under the issue heading when the run opens with it", () => {
    const [page] = live(plan([within("wmx", "Watermark X", [box(30, 30)])]));
    const [issue, sub] = page.headings;
    assert.equal(sub.yMm, issue.yMm + 6 + 5);
  });

  it("carries the entry's print mode onto the placement, so a card records it", () => {
    const [page] = live(
      plan([within("main", "", [box(30, 30)]), own("other", "Other", [box(30, 30)])])
    );
    assert.deepEqual(
      page.blocks.map((b) => b.printMode),
      ["within", undefined]
    );
  });

  it("prints the heading again for a run another issue interrupts", () => {
    const [page] = live(
      plan([
        within("a", "", [box(30, 30)]),
        own("other", "1940, Other", [box(30, 30)]),
        within("b", "Watermark X", [box(30, 30)]),
      ])
    );
    assert.deepEqual(headings(page), ["1940, Issue", "1940, Other", "1940, Issue", "Watermark X"]);
    assert.deepEqual(
      page.blocks.map((b) => b.groupHeading),
      ["1940, Issue", undefined, "1940, Issue"]
    );
  });

  it("leaves the run alone across a note, which is not an issue", () => {
    const note: AlbumBlockSpec = {
      entryId: "note",
      kind: "text",
      heading: "A word",
      boxes: [],
      printedPageIds: null,
    };
    const [page] = live(
      plan([within("a", "", [box(30, 30)]), note, within("b", "Watermark X", [box(30, 30)])])
    );
    assert.deepEqual(headings(page), ["1940, Issue", "A word", "Watermark X"]);
  });

  it("repeats the heading, marked, on the next sheet a run continues on", () => {
    // The main checklist takes 19 + 200 of the first sheet, leaving 41; Watermark X needs
    // 6 + 8 + 30 = 44 and moves — and opens the second sheet under the issue heading again.
    const pages = live(
      plan([within("main", "", [box(100, 200)]), within("wmx", "Watermark X", [box(30, 30)])])
    );
    assert.equal(pages.length, 2);
    assert.deepEqual(headings(pages[0]), ["1940, Issue"]);
    assert.deepEqual(headings(pages[1]), ["1940, Issue [2]", "Watermark X"]);
    assert.equal(pages[1].blocks[0].groupHeading, "1940, Issue [2]");
    assert.equal(pages[1].blocks[0].groupPart, 2);
  });

  it("never leaves the issue heading alone at the foot of a sheet", () => {
    // 54 mm remain under a 206 mm checklist. The issue heading alone (19) would fit; with the first
    // row under it (19 + 40) it does not, so both go to the next sheet.
    const pages = live(
      plan([own("before", "", [box(100, 200)]), within("main", "", [box(40, 40)])])
    );
    assert.equal(pages.length, 2);
    assert.deepEqual(headings(pages[0]), []);
    assert.deepEqual(headings(pages[1]), ["1940, Issue"]);
  });

  it("marks the issue heading by the run's sheets and a split sub-heading by its own", () => {
    // Sheet 1 holds the main checklist; Watermark X starts on sheet 2 of the run and splits onto 3.
    const pages = live(
      plan([within("main", "", [box(100, 200)]), within("wmx", "Watermark X", tallRows())])
    );
    assert.equal(pages.length, 3);
    assert.deepEqual(headings(pages[1]), ["1940, Issue [2]", "Watermark X"]);
    assert.deepEqual(headings(pages[2]), ["1940, Issue [3]", "Watermark X [2]"]);
    assert.deepEqual(
      pages.map((p) => p.blocks.map((b) => b.groupPart)),
      [[1], [2], [3]]
    );
    // Directly under the repeated heading, the split checklist has no lead of its own.
    const [issue, sub] = pages[2].headings;
    assert.equal(sub.yMm, issue.yMm + 6 + 5);
  });

  it("repeats a mode-2 checklist's issue heading on every sheet of a split, with nothing under it", () => {
    const pages = live(plan([within("main", "", tallRows())]));
    assert.equal(pages.length, 2);
    assert.deepEqual(headings(pages[0]), ["1940, Issue"]);
    assert.deepEqual(headings(pages[1]), ["1940, Issue [2]"]);
  });

  it("pairs two short checklists of one run side by side under one heading", () => {
    const [page] = live(
      plan([
        within("wmx", "Watermark X", [box(40, 30)]),
        within("wmy", "Watermark Y", [box(40, 30)]),
      ])
    );
    const [issue, x, y] = page.headings;
    assert.deepEqual(headings(page), ["1940, Issue", "Watermark X", "Watermark Y"]);
    assert.equal(issue.widthMm, page.content.widthMm);
    assert.equal(x.yMm, y.yMm);
    assert.ok(x.xMm < y.xMm);
    assert.equal(page.blocks[1].beside, true);
  });

  it("never pairs a run's checklist with a block of another issue", () => {
    const [page] = live(
      plan([within("wmx", "Watermark X", [box(40, 30)]), own("other", "1940, Other", [box(40, 30)])])
    );
    const [, x, other] = page.headings;
    assert.ok(other.yMm > x.yMm);
    assert.equal(page.blocks[1].beside, undefined);
  });

  it("counts a card of the run in the binder as one of its sheets", () => {
    const pages = plan([
      within("main", "", [], ISSUE, "card-1"),
      within("wmx", "Watermark X", [box(30, 30)]),
    ]);
    assert.equal(pages[0].kind, "printed");
    const [sheet] = live(pages);
    assert.deepEqual(headings(sheet), ["1940, Issue [2]", "Watermark X"]);
  });

  it("starts the marks after the sheets a reference is told were printed before it", () => {
    const [page] = live(
      plan([within("wmx", "Watermark X", [box(30, 30)], { ...ISSUE, sheetsBefore: 2 })])
    );
    assert.deepEqual(headings(page), ["1940, Issue [3]", "Watermark X"]);
  });

  it("spaces the blocks as before when the issue heading renders blank", () => {
    const blank = { ...ISSUE, heading: "" };
    const [page] = live(plan([within("main", "", [box(30, 30)], blank)]));
    assert.deepEqual(headings(page), []);
    assert.equal(page.blocks[0].groupHeading, undefined);
    // No heading, so the ordinary row gap leads the block.
    assert.equal(page.boxes[0].yMm, 23 + 6);
  });

  it("starts a run under its chapter's year with the issue heading and a row, not the heading alone", () => {
    // The year takes 8 + 12 + 5 = 25 mm, leaving 235. Four 50 mm rows under the issue heading need
    // 19 + 218 = 237: the run would fit a full sheet, and under the year it starts anyway (#1497).
    const rows = Array.from({ length: 4 }, () => box(100, 50));
    const pages = live(plan([within("main", "", rows)], {}, "1940"));
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0].chapter?.lines, ["1940"]);
    assert.deepEqual(headings(pages[0]), ["1940, Issue"]);
    assert.equal(pages[0].boxes.length, 3);
    assert.deepEqual(headings(pages[1]), ["1940, Issue [2]"]);
    assert.equal(pages[1].boxes.length, 1);
  });

  it("moves the whole band, heading and all, under the page's placement", () => {
    const [page] = live(
      plan([within("main", "", [box(30, 30)])], { verticalPlacement: "center" })
    );
    const [issue] = page.headings;
    // Centred: the heading moved with the band, and the boxes stayed the same distance under it.
    assert.ok(issue.yMm > 23 + 8);
    assert.equal(page.boxes[0].yMm, issue.yMm + 6 + 5);
  });
});
