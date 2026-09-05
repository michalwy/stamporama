import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAlbumPages,
  wrapAlbumText,
  type AlbumBoxSpec,
  type AlbumChapterSpec,
  type AlbumPlannedPage,
  type AlbumTextMetrics,
} from "../../src/lib/album-layout";
import {
  DEFAULT_ALBUM_PRESET,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";

/**
 * A deterministic stand-in for the shipped measurer: every character is a tenth of the type size
 * wide, every line half of it tall. The engine never looks at a glyph, so a fake that is exact in
 * arithmetic tests the packing rules better than a real face would — the expectations below can be
 * worked out on paper.
 */
const metrics: AlbumTextMetrics = {
  measureMm: (text, _face, sizePt) => text.length * sizePt * 0.1,
  lineHeightMm: (_face, sizePt) => sizePt * 0.5,
};

const preset = (over: Partial<AlbumRenderPreset> = {}): AlbumRenderPreset => ({
  ...DEFAULT_ALBUM_PRESET,
  ...over,
});

const box = (widthMm: number, heightMm: number, label = ""): AlbumBoxSpec => ({
  widthMm,
  heightMm,
  label,
});

const block = (
  entryId: string,
  heading: string,
  boxes: AlbumBoxSpec[],
  printedPageId: string | null = null
) => ({ entryId, heading, boxes, printedPageId });

const chapter = (
  key: string,
  heading: string,
  blocks: ReturnType<typeof block>[]
): AlbumChapterSpec => ({ key, heading, blocks });

const live = (pages: AlbumPlannedPage[]) =>
  pages.filter((p): p is Extract<AlbumPlannedPage, { kind: "live" }> => p.kind === "live");

describe("wrapAlbumText", () => {
  it("breaks on whitespace and keeps every line inside the width", () => {
    // 10 pt → 1 mm per character. "aaaa bbbb cccc" is 14 mm unbroken.
    const lines = wrapAlbumText("aaaa bbbb cccc", 9, "f", 10, metrics);
    assert.deepEqual(lines, ["aaaa bbbb", "cccc"]);
  });

  it("gives an overlong word a line of its own rather than hyphenating it", () => {
    const lines = wrapAlbumText("short abcdefghijklmnop", 6, "f", 10, metrics);
    assert.deepEqual(lines, ["short", "abcdefghijklmnop"]);
  });

  it("reserves nothing for blank text — a blank template is a real value", () => {
    assert.deepEqual(wrapAlbumText("   ", 100, "f", 10, metrics), []);
  });
});

describe("planAlbumPages", () => {
  it("plans no pages for an album with no chapters", () => {
    assert.deepEqual(planAlbumPages([], preset(), "Polska", metrics).pages, []);
  });

  it("starts a page per chapter and prints each chapter heading once", () => {
    const plan = planAlbumPages(
      [
        chapter("1938", "1938", [block("a", "One", [box(30, 36)])]),
        chapter("1939", "1939", [block("b", "Two", [box(30, 36)])]),
      ],
      preset(),
      "Polska",
      metrics
    );
    const pages = live(plan.pages);
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0].chapter?.lines, ["1938"]);
    assert.deepEqual(pages[1].chapter?.lines, ["1939"]);
    assert.equal(pages[0].chapterKey, "1938");
    assert.equal(pages[1].chapterKey, "1939");
  });

  it("puts the album's name on every page as a running head", () => {
    const plan = planAlbumPages(
      [
        chapter("1938", "1938", [block("a", "One", [box(30, 36)])]),
        chapter("1939", "1939", [block("b", "Two", [box(30, 36)])]),
      ],
      preset(),
      "Polska",
      metrics
    );
    for (const page of live(plan.pages)) assert.deepEqual(page.title?.lines, ["Polska"]);
  });

  it("wraps a row of boxes at the column width and centres it", () => {
    // A4 with 10 mm margins is 190 mm of content; 1 mm of horizontal gap. Four 60 mm boxes are
    // 60 + 1 + 60 + 1 + 60 = 182 for three, so the fourth wraps.
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(60, 20), box(60, 20), box(60, 20), box(60, 20)])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    const ys = page.boxes.map((b) => b.yMm);
    assert.equal(new Set(ys).size, 2, "three boxes on the first row, one on the second");
    // The first row is 182 wide in 190 of column, so it starts 4 mm in.
    assert.equal(page.boxes[0].xMm, 14);
    // The wrapped box is alone on its row and therefore centred in the column.
    assert.equal(page.boxes[3].xMm, 75);
  });

  it("centres a short mount in a row as tall as its tallest", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(30, 20), box(30, 40)])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    const [short, tall] = page.boxes;
    assert.equal(tall.yMm, short.yMm - 10, "the 20 mm mount sits 10 mm inside the 40 mm band");
  });

  it("moves a block whole to the next page rather than splitting it", () => {
    // 297 − 10 − 10 margins, less the 13 mm title band (26 pt) and the 4 mm footer band (8 pt):
    // about 260 mm of column. Three 100 mm blocks cannot share it.
    // 150 mm wide, so no two of them can share a band: this case is about the vertical rule.
    const tall = (id: string) => block(id, "", [box(150, 100)]);
    const plan = planAlbumPages(
      [chapter("y", "", [tall("a"), tall("b"), tall("c")])],
      preset(),
      "Album",
      metrics
    );
    const pages = live(plan.pages);
    assert.equal(pages.length, 2);
    // Every block landed whole: no page holds part of one.
    for (const page of pages) {
      for (const placed of page.blocks) {
        assert.equal(placed.continued, false);
        assert.equal(placed.boxCount, 1);
      }
    }
    assert.deepEqual(
      pages.map((p) => p.blocks.map((b) => b.entryId)),
      [["a", "b"], ["c"]]
    );
  });

  it("splits only a block taller than a whole page, and marks the tail a continuation", () => {
    // 100 mm wide, so only one fits per 190 mm row: eight rows of 60 mm is 522 mm with the gaps.
    const boxes = Array.from({ length: 8 }, () => box(100, 60));
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", boxes)])],
      preset(),
      "Album",
      metrics
    );
    const pages = live(plan.pages);
    assert.ok(pages.length > 1, "eight 60 mm rows do not fit on one A4 page");
    assert.equal(pages[0].blocks[0].continued, false);
    assert.equal(pages[1].blocks[0].continued, true);
    // Every box is placed exactly once, and the pages carry consecutive slices of the block.
    assert.equal(
      pages.reduce((total, p) => total + p.boxes.length, 0),
      8
    );
    assert.equal(pages[1].blocks[0].firstBoxIndex, pages[0].blocks[0].boxCount);
  });

  it("steps over a printed page rather than routing content around it", () => {
    const plan = planAlbumPages(
      [
        chapter("y", "1938", [
          block("a", "One", [box(30, 36)]),
          block("b", "Two", [box(30, 36)], "printed-1"),
          block("c", "Three", [box(30, 36)], "printed-1"),
          block("d", "Four", [box(30, 36)]),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => p.kind),
      ["live", "printed", "live"]
    );
    const printed = plan.pages[1];
    assert.equal(printed.kind, "printed");
    if (printed.kind === "printed") {
      assert.deepEqual(printed.entryIds, ["b", "c"], "one sheet, not two");
      assert.equal(printed.chapterKey, "y");
    }
    // The live pages hold only the live blocks, and the block after the sheet starts fresh paper.
    assert.deepEqual(
      live(plan.pages).map((p) => p.blocks.map((b) => b.entryId)),
      [["a"], ["d"]]
    );
  });

  it("reserves a footer band only when the template prints one", () => {
    const withFooter = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(30, 20)])])],
        preset(),
        "Album",
        metrics
      ).pages
    )[0];
    const without = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(30, 20)])])],
        preset({ footerTemplate: "" }),
        "Album",
        metrics
      ).pages
    )[0];
    assert.ok(withFooter.footer, "the default template footers every page");
    assert.equal(without.footer, null);
    assert.ok(
      without.content.heightMm > withFooter.content.heightMm,
      "a page with no footer has more room for content"
    );
  });

  it("starts a chapter's first page below the year heading", () => {
    const plan = planAlbumPages(
      [chapter("1938", "1938", [block("a", "", [box(30, 20)])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    assert.ok(page.chapter);
    assert.ok(page.content.yMm >= page.chapter!.yMm + page.chapter!.heightMm);
  });

  it("prints no running head when the template says not to", () => {
    // DA carries no album title — footer only — and gets those millimetres back for content.
    const withHead = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(30, 20)])])],
        preset(),
        "Album",
        metrics
      ).pages
    )[0];
    const without = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(30, 20)])])],
        preset({ printTitle: false }),
        "Album",
        metrics
      ).pages
    )[0];
    assert.ok(withHead.title);
    assert.equal(without.title, null);
    assert.ok(without.content.heightMm > withHead.content.heightMm);
    assert.ok(without.content.yMm < withHead.content.yMm);
  });

  it("pairs two narrow checklists into one band, side by side", () => {
    // 190 mm of content, 10 mm between them: two 80 mm blocks each fit their 90 mm share.
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "One", [box(80, 30)]), block("b", "Two", [box(80, 30)])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    assert.equal(page.boxes.length, 2);
    assert.equal(page.boxes[0].yMm, page.boxes[1].yMm, "one band, one top");
    assert.ok(page.boxes[1].xMm > page.boxes[0].xMm, "side by side");
    assert.equal(page.headings[0].yMm, page.headings[1].yMm, "and their headings line up");
  });

  it("does not pair a block too wide for its share — nothing overflows sideways", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(150, 30)]), block("b", "", [box(80, 30)])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    assert.ok(page.boxes[1].yMm > page.boxes[0].yMm, "the second took the next band");
  });

  it("never pairs when the template says one block per band", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(40, 30)]), block("b", "", [box(40, 30)])])],
      preset({ blocksPerBand: 1 }),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    assert.ok(page.boxes[1].yMm > page.boxes[0].yMm);
  });

  it("unpairs a band that will not fit a page rather than making the page worse", () => {
    // Narrow enough to pair, but 200 mm tall each: paired they exceed the ~260 mm page together
    // with the second block's lead, so they are tried singly instead.
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(80, 200)]), block("b", "", [box(80, 200)])])],
      preset(),
      "Album",
      metrics
    );
    const pages = live(plan.pages);
    assert.equal(pages.length, 1, "200 mm each, side by side, is one band of 200 mm");
    assert.equal(pages[0].boxes[0].yMm, pages[0].boxes[1].yMm);
  });

  it("labels a box under it, sharing one baseline across the row", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(30, 20, "303"), box(30, 40, "304")])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    const labels = page.boxes.map((b) => b.label);
    assert.ok(labels[0] && labels[1]);
    assert.equal(labels[0]!.yMm, labels[1]!.yMm, "one row, one label baseline");
    assert.deepEqual(labels[0]!.lines, ["303"]);
  });

  it("prints no label band at all when the template says so", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(30, 20, "303")])])],
      preset({ labelPosition: "none" }),
      "Album",
      metrics
    );
    assert.equal(live(plan.pages)[0].boxes[0].label, null);
  });

  it("keeps a checklist with no stamps yet, so the gap is visible on the page", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "Nothing collected yet", [])])],
      preset(),
      "Album",
      metrics
    );
    const [page] = live(plan.pages);
    assert.equal(page.boxes.length, 0);
    assert.deepEqual(page.headings[0].lines, ["Nothing collected yet"]);
    assert.deepEqual(page.blocks[0], {
      entryId: "a",
      continued: false,
      firstBoxIndex: 0,
      boxCount: 0,
    });
  });

  it("terminates on a block nothing can hold, placing it rather than looping", () => {
    const plan = planAlbumPages(
      [chapter("y", "", [block("a", "", [box(30, 5000)])])],
      preset(),
      "Album",
      metrics
    );
    const pages = live(plan.pages);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].boxes.length, 1);
  });
});

describe("planAlbumPages and printed sheets", () => {
  it("does not merge two runs of one printed sheet that live content sits between", () => {
    // A collector who reorders entries after printing can leave a printed sheet's blocks separated.
    // Merging across the gap would file the live block after a sheet it comes before.
    const plan = planAlbumPages(
      [
        chapter("y", "", [
          block("a", "", [box(30, 36)], "printed-1"),
          block("b", "", [box(30, 36)]),
          block("c", "", [box(30, 36)], "printed-1"),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => p.kind),
      ["printed", "live", "printed"]
    );
    for (const page of plan.pages) {
      if (page.kind === "printed") assert.equal(page.entryIds.length, 1);
    }
  });
});
