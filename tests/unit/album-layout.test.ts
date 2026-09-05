import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumContinuationHeading,
  planAlbumPages,
  wrapAlbumText,
  type AlbumBlockSpec,
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
  ...printedPageIds: string[]
) => ({ entryId, heading, boxes, printedPageIds: printedPageIds.length ? printedPageIds : null });

const chapter = (
  key: string,
  heading: string,
  blocks: AlbumBlockSpec[]
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
        assert.equal(placed.part, 1);
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
    assert.equal(pages[0].blocks[0].part, 1);
    assert.equal(pages[1].blocks[0].part, 2);
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

  // A band is as tall as its **tallest** block, never the sum of them — so two 200 mm blocks make
  // one 206 mm band and still fit the ~260 mm page. The name this test carried until #768 said it
  // unpaired them, which is the opposite of what it asserts; the case where pairing really is
  // abandoned needs a band taller than a whole page, and it is in "on the rare shapes" below.
  it("pairs two tall blocks into one band as tall as the taller of them", () => {
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
      kind: "entry",
      part: 1,
      heading: "Nothing collected yet",
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
  it("files one printed sheet once, even when live content has been reordered between its blocks", () => {
    // A collector who reorders entries after printing can leave a printed sheet's blocks separated.
    // There is no arrangement that makes that sequence read correctly — but there is one that keeps
    // the card a single card. Filing it twice would list it twice, draw it twice and reprint it
    // twice, which is the one outcome that is definitely wrong.
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
      ["printed", "live"]
    );
    const sheet = plan.pages[0];
    assert.equal(sheet.kind, "printed");
    if (sheet.kind === "printed") assert.deepEqual(sheet.entryIds, ["a", "c"]);
  });

  it("files every sheet of a checklist printed across three of them, in part order", () => {
    // A checklist too tall for a page is on two or three cards, and the seam names them as one list
    // — index n carrying part n + 1. A block that could name only one sheet could not be marked
    // printed at all without lying about where half of it is.
    const plan = planAlbumPages(
      [
        chapter("y", "", [
          block("a", "", [], "printed-1", "printed-2", "printed-3"),
          block("b", "", [box(30, 36)]),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => (p.kind === "printed" ? p.printedPageId : "live")),
      ["printed-1", "printed-2", "printed-3", "live"]
    );
  });

  it("keeps a sheet shared by a split checklist and the block after it as one sheet", () => {
    // The last card of a split checklist can carry the next checklist too, and both blocks then name
    // it. That is one card, not two.
    const plan = planAlbumPages(
      [
        chapter("y", "", [
          block("a", "", [], "printed-1", "printed-2"),
          block("b", "", [], "printed-2"),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => (p.kind === "printed" ? p.printedPageId : "live")),
      ["printed-1", "printed-2"]
    );
    const second = plan.pages[1];
    if (second.kind === "printed") assert.deepEqual(second.entryIds, ["a", "b"]);
  });

  it("plans an album whose every checklist is on paper as no live pages at all", () => {
    const plan = planAlbumPages(
      [
        chapter("1938", "1938", [block("a", "One", [], "printed-1")]),
        chapter("1939", "1939", [block("b", "Two", [], "printed-2")]),
      ],
      preset(),
      "Album",
      metrics
    );
    // Nothing live at all. A chapter whose first block is on paper does not print its year again:
    // the card in the binder carries it, and a blank sheet headed 1938 filed in front of the printed
    // sheet headed 1938 is what an album with every chapter printed would otherwise be a run of.
    assert.deepEqual(
      plan.pages.map((p) => p.kind),
      ["printed", "printed"]
    );
  });
});

/**
 * The cases the collector's own material almost never produces — which is exactly why a suite built
 * from realistic pages stays green over them. #767 shipped two bugs that only these inputs reach,
 * and #768 found a third (see the chapter-heading case below), so they are constructed here
 * deliberately rather than waited for.
 */
describe("planAlbumPages on the rare shapes", () => {
  /** Five rows of 120 mm: two fit a page, so the block needs three of them. Three, not two, is the
   *  point — #767's splitter closed over its caller's page variable and was wrong only for a block
   *  spanning three pages or more, publishing the first page N times and losing the rest. */
  it("splits a block taller than two pages across three, each emitted once", () => {
    const boxes = Array.from({ length: 5 }, (_, n) => box(180, 120, `b${n}`));
    const pages = live(
      planAlbumPages([chapter("y", "", [block("a", "", boxes)])], preset(), "Album", metrics).pages
    );

    assert.equal(pages.length, 3);
    assert.deepEqual(
      pages.map((p) => p.blocks[0].part),
      [1, 2, 3]
    );
    // Every box placed exactly once, and the pages carry consecutive slices in order.
    assert.deepEqual(
      pages.flatMap((p) => p.boxes.map((b) => b.box.label)),
      ["b0", "b1", "b2", "b3", "b4"]
    );
    let expected = 0;
    for (const page of pages) {
      assert.equal(page.blocks.length, 1);
      assert.equal(page.blocks[0].firstBoxIndex, expected);
      expected += page.blocks[0].boxCount;
    }
    assert.equal(expected, 5);
  });

  /**
   * The continuation mark is the **plan's**, so the string the plan measured is the string that gets
   * printed (#768). A renderer appending it would put ink outside the width the layout reserved, and
   * precisely where headings are longest — a heading that fills its block is the one most likely to
   * be continued.
   */
  it("marks every sheet of a split block after the first, in the heading it measured", () => {
    const boxes = Array.from({ length: 5 }, () => box(180, 120));
    const pages = live(
      planAlbumPages(
        // No year heading, so the block starts on the first sheet and every sheet carries part of
        // it — the chapter-heading case has a page of its own above.
        [chapter("1938", "", [block("a", "Walka z gruźlicą", boxes)])],
        preset(),
        "Album",
        metrics
      ).pages
    );

    // The heading is re-placed on every sheet and charged against every sheet, so five 120 mm rows
    // take five of them — which is also what makes the mark worth a number rather than a flag.
    assert.equal(pages.length, 5);
    assert.deepEqual(
      pages.map((p) => p.headings[0].lines.join(" ")),
      [
        "Walka z gruźlicą",
        "Walka z gruźlicą [2]",
        "Walka z gruźlicą [3]",
        "Walka z gruźlicą [4]",
        "Walka z gruźlicą [5]",
      ]
    );
    assert.deepEqual(
      pages.map((p) => p.blocks[0].part),
      [1, 2, 3, 4, 5]
    );

    // And the marked heading was measured, not appended: its band is as wide as the block and as
    // tall as the lines it really wrapped to at that width.
    for (const page of pages) {
      const heading = page.headings[0];
      const wrapped = wrapAlbumText(
        heading.lines.join(" "),
        heading.widthMm,
        DEFAULT_ALBUM_PRESET.headingFace,
        DEFAULT_ALBUM_PRESET.headingSizePt,
        metrics
      );
      assert.deepEqual(heading.lines, wrapped, "the printed heading fits the band it was given");
    }
  });

  it("adds no mark to a block that moves whole, or to one with no heading", () => {
    assert.equal(albumContinuationHeading("Walka z gruźlicą", 1), "Walka z gruźlicą");
    assert.equal(albumContinuationHeading("", 3), "");
    assert.equal(albumContinuationHeading("Walka", 2), "Walka [2]");
  });

  /**
   * A block that fits an ordinary page but not the chapter's first one, which is short by the year
   * heading.
   *
   * It must move whole. Measuring "taller than an entire page" against the page *being filled*
   * rather than against an ordinary empty one broke this: a 252 mm checklist met a 235 mm chapter
   * page and was split across two cards and marked *Continued*, on a template whose ordinary page
   * holds 260 mm.
   */
  it("moves a block whole off a chapter's first page rather than splitting it there", () => {
    // 6 mm lead + 120 + 6 gap + 120 = 252 mm. The page holds 260; under a year heading, 235.
    const pages = live(
      planAlbumPages(
        [chapter("1938", "1938", [block("a", "", [box(180, 120), box(180, 120)])])],
        preset(),
        "Album",
        metrics
      ).pages
    );

    assert.equal(pages.length, 2);
    assert.ok(pages[0].chapter, "the year heading opens the chapter");
    assert.equal(pages[0].boxes.length, 0, "and is the only thing on its sheet");
    assert.equal(pages[1].boxes.length, 2);
    assert.equal(pages[1].blocks[0].part, 1, "it moved; it was not broken");
  });

  /** The same shape from the other side: a chapter heading is enough on its own to make a page, and
   *  a page carrying only one is emitted rather than swallowed. */
  it("emits a page holding nothing but a chapter heading", () => {
    const pages = live(
      planAlbumPages(
        [chapter("1938", "1938", [block("a", "", [box(180, 250)])])],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0].chapter?.lines, ["1938"]);
    assert.equal(pages[0].headings.length, 0);
    assert.equal(pages[0].boxes.length, 0);
  });

  /**
   * A single oversize mount (#765) — a piece no strip in stock can supply, drawn at its own size —
   * that is wider than the content and taller than the sheet.
   *
   * It is placed and allowed to overhang. Refusing it would be a plan that never terminates, and a
   * mount drawn off the paper is at least a visible, fixable mistake; a slot silently missing from
   * a page is one the collector never notices.
   */
  it("places a single oversize block that fits nothing, and stops", () => {
    const pages = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(250, 300, "Blok 5A")])])],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages.length, 1);
    assert.equal(pages[0].boxes.length, 1);
    const placed = pages[0].boxes[0];
    assert.equal(placed.widthMm, 250, "drawn at its own size, not squeezed to the content");
    assert.ok(
      placed.xMm + placed.widthMm > pages[0].content.xMm + pages[0].content.widthMm,
      "and overhangs visibly rather than being dropped"
    );
  });

  /**
   * A band that pairs by width but whose taller block will not fit an empty page.
   *
   * Pairing must never make a page worse, so the band is unpaired and the first block is placed on
   * its own — which it fits. The second then takes a fresh page and splits there, which is what a
   * block taller than any page does whether or not it was ever a candidate for pairing.
   */
  it("unpairs a band whose second block is taller than any page", () => {
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("short", "", [box(80, 80, "a")]),
            block("tall", "", [box(80, 300, "b")]),
          ]),
        ],
        preset(),
        "Album",
        metrics
      ).pages
    );

    // Both are 80 mm wide against a 90 mm share, so they are pairing candidates by width; the
    // 306 mm band they would make is what stops them.
    assert.equal(pages[0].blocks.length, 1, "the short block goes on alone");
    assert.deepEqual(
      pages[0].boxes.map((b) => b.box.label),
      ["a"]
    );
    assert.equal(pages.length, 2, "and the tall one takes a fresh sheet of its own");
    assert.deepEqual(
      pages[1].boxes.map((b) => b.box.label),
      ["b"]
    );
  });
});

/**
 * The collector overruling the packer (#769).
 *
 * These are corrections, not settings: they arrive on the block specs and are packed **with** the
 * automatic layout, which is what makes them survive a content change. So the geometry below is
 * asserted in absolute millimetres against `DEFAULT_ALBUM_PRESET` — an ordinary sheet has 260 mm of
 * content starting at y = 23 with the stand-in measurer above, and every figure here is worked out
 * on paper from that.
 *
 * Extra space is the one of the five with a corpus behind it: **480** `PAGE_VSPACE` across the
 * collector's own 198 AlbumEasy pages, every content one of them positive. The forced break and the
 * forced no-break have none — AlbumEasy paginates by hand — and are inventions #755 asked for.
 */
describe("planAlbumPages and the collector's corrections", () => {
  /** One block per band, so the tests below read as a column and a correction moves one thing. */
  const stacked = preset({ blocksPerBand: 1 });

  /** A block with corrections on it. Written out rather than added to `block()` above, so the
   *  hundred existing cases keep saying "no corrections" by their shape. */
  const corrected = (
    entryId: string,
    heading: string,
    boxes: AlbumBoxSpec[],
    over: Partial<AlbumBlockSpec>
  ): AlbumBlockSpec => ({ entryId, heading, boxes, printedPageIds: null, ...over });

  /** Rows 190 mm wide, so each box takes a row of its own and a block's height is arithmetic:
   *  8 (lead) + 11 (one heading line and the space under it) + 30n + 6(n − 1). */
  const tall = (n: number) => Array.from({ length: n }, () => box(190, 30));

  it("pushes a block down by the space asked for before it, and charges it to the block", () => {
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            corrected("b", "B", [box(30, 36)], { spaceBeforeMm: 20 }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    // A: lead 8 from y 23, heading at 31, one 36 mm row — the block ends at 78.
    assert.equal(pages[0].headings[0].yMm, 31);
    // B's lead is its own 8 plus the collector's 20, so its heading sits 20 mm lower than it would.
    assert.equal(pages[0].headings[1].yMm, 106);
  });

  it("lets a correction close the gap above a block, but never below zero", () => {
    // −50 against a lead of 8 is not a block printed 42 mm into the one above it. His own content
    // `PAGE_VSPACE` are every one of them positive; the 18 negatives in the corpus are all in the
    // running-head includes, building the head `printTitle` already models.
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            corrected("b", "B", [box(30, 36)], { spaceBeforeMm: -50 }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages[0].headings[1].yMm, 78);
  });

  it("moves a block whole onto the next sheet when its own correction is what stopped it fitting", () => {
    // Filler is 193 mm, B is 55: 248 fits the 260 mm sheet. The 20 mm correction makes it 268, and
    // then B moves — **with its correction**, which is the half that matters. A lead that collapsed
    // at the top of a page would make "does not fit, so move it" ill-defined, and a correction that
    // evaporated on the way would make it worse: the block would fit where it had just been refused.
    const chapterSpec = (over: Partial<AlbumBlockSpec>) =>
      chapter("y", "", [
        block("f", "F", tall(5)),
        corrected("b", "B", [box(30, 36)], over),
      ]);

    const together = live(planAlbumPages([chapterSpec({})], stacked, "Album", metrics).pages);
    assert.equal(together.length, 1);

    const apart = live(
      planAlbumPages([chapterSpec({ spaceBeforeMm: 20 })], stacked, "Album", metrics).pages
    );
    assert.equal(apart.length, 2);
    // y 23 + the block's own 8 + the collector's 20.
    assert.equal(apart[1].headings[0].yMm, 51);
  });

  it("charges the space after a split block once, at the foot of its last card", () => {
    // Ten 30 mm rows is 373 mm and splits over two sheets, six rows then four. The trailing space is
    // *after this checklist*, and the gaps inside a split one are page edges — so spending it three
    // times over would put 20 mm of nothing at the bottom of every card of the run.
    const plan = (over: Partial<AlbumBlockSpec>) =>
      live(
        planAlbumPages(
          [
            chapter("y", "", [
              corrected("a", "A", tall(10), over),
              block("b", "B", [box(30, 36)]),
            ]),
          ],
          stacked,
          "Album",
          metrics
        ).pages
      );

    const plain = plan({});
    assert.equal(plain.length, 2);
    assert.deepEqual(
      plain.map((p) => p.blocks.map((b) => b.entryId)),
      [["a"], ["a", "b"]]
    );
    // A's tail ends at 180 on the second sheet; B's own lead of 8 puts its heading at 188.
    assert.equal(plain[1].headings[1].yMm, 188);

    const spaced = plan({ spaceAfterMm: 20 });
    assert.equal(spaced[1].headings[1].yMm, 208);
    // And the first card of the run is unchanged: it did not pay for a gap that is not on it.
    assert.equal(spaced[0].blocks[0].boxCount, plain[0].blocks[0].boxCount);
  });

  it("starts a fresh sheet for a block the collector has broken before", () => {
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            corrected("b", "B", [box(30, 36)], { breakBefore: "always" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.deepEqual(
      pages.map((p) => p.blocks.map((b) => b.entryId)),
      [["a"], ["b"]]
    );
  });

  it("does not let a band pairing swallow a forced break", () => {
    // Two one-stamp checklists are exactly what the collector pairs, and a band is one slice of one
    // page — so pairing a block that has been told to start a sheet of its own would overrule him
    // rather than the packer, silently, on the shape where pairing is most likely to happen.
    const blocks = (over: Partial<AlbumBlockSpec>) => [
      block("a", "A", [box(30, 36)]),
      corrected("b", "B", [box(30, 36)], over),
    ];
    const paired = live(
      planAlbumPages([chapter("y", "", blocks({}))], preset(), "Album", metrics).pages
    );
    assert.equal(paired.length, 1);
    assert.equal(paired[0].headings[0].yMm, paired[0].headings[1].yMm);

    const broken = live(
      planAlbumPages(
        [chapter("y", "", blocks({ breakBefore: "always" }))],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.deepEqual(
      broken.map((p) => p.blocks.map((b) => b.entryId)),
      [["a"], ["b"]]
    );
  });

  it("leaves a year heading alone rather than breaking under it", () => {
    // A chapter already starts a page, so a break forced above its first block would only produce a
    // card carrying the year and nothing else. The packer does emit such a sheet when it has to
    // (#768) — it must not do it because a flag was left on a block that has since moved.
    const pages = live(
      planAlbumPages(
        [
          chapter("1938", "1938", [
            corrected("a", "A", [box(30, 36)], { breakBefore: "always" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages.length, 1);
    assert.ok(pages[0].chapter);
    assert.deepEqual(
      pages[0].blocks.map((b) => b.entryId),
      ["a"]
    );
  });

  it("moves a block and the one that must stay with it together", () => {
    // 193 mm of filler leaves 67, which A alone fits and A + B does not. Asked to keep them
    // together, the packer moves **both** — which it can only do by making the unit that moves whole
    // bigger before anything is placed, since it never goes back for what it has already put down.
    const blocks = (over: Partial<AlbumBlockSpec>) => [
      block("f", "F", tall(5)),
      block("a", "A", [box(30, 36)]),
      corrected("b", "B", [box(30, 36)], over),
    ];

    const loose = live(
      planAlbumPages([chapter("y", "", blocks({}))], stacked, "Album", metrics).pages
    );
    assert.deepEqual(
      loose.map((p) => p.blocks.map((b) => b.entryId)),
      [["f", "a"], ["b"]]
    );

    const kept = live(
      planAlbumPages(
        [chapter("y", "", blocks({ breakBefore: "avoid" }))],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.deepEqual(
      kept.map((p) => p.blocks.map((b) => b.entryId)),
      [["f"], ["a", "b"]]
    );
  });

  it("gives up on keeping two blocks together when no sheet could hold both", () => {
    // `avoid` is a preference, not a statement the packer can always honour: a run of them taller
    // than a sheet has no arrangement that satisfies it. Dropping the preference is the answer;
    // looking for one is a plan that never terminates.
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", tall(5)),
            corrected("b", "B", tall(5), { breakBefore: "avoid" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.deepEqual(
      pages.map((p) => p.blocks.map((b) => b.entryId)),
      [["a"], ["b"]]
    );
  });

  it("says so on the block when a keep-together could not be granted", () => {
    // A constraint dropped **silently** is much worse here than one refused out loud: the collector
    // finds out from a sheet in his hand. So the packer reports it, and reads it off the page rather
    // than off its own branches — a block that got what it asked for has the block it wanted to stay
    // with above it, so the sheet is not empty under it.
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", tall(5)),
            corrected("b", "B", tall(5), { breakBefore: "avoid" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages[0].blocks[0].separated, undefined);
    assert.equal(pages[1].blocks[0].separated, true);
  });

  it("says nothing when the keep-together was granted", () => {
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            corrected("b", "B", [box(30, 36)], { breakBefore: "avoid" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages.length, 1);
    for (const placed of pages[0].blocks) assert.equal(placed.separated, undefined);
  });

  it("does not call a continuation sheet of a split block a broken keep-together", () => {
    // Parts 2 and 3 open sheets of their own by construction. Nothing was separated that anybody
    // asked to keep together, and flagging them would make the warning mean nothing.
    const pages = live(
      planAlbumPages(
        [chapter("y", "", [corrected("a", "A", tall(10), { breakBefore: "avoid" })])],
        stacked,
        "Album",
        metrics
      ).pages
    );
    assert.equal(pages.length, 2);
    assert.equal(pages[1].blocks[0].part, 2);
    assert.equal(pages[1].blocks[0].separated, undefined);
  });

  it("sets a text block in the role it names and gives it no boxes", () => {
    // A block of the collector's own words, in one of the template's five voices. There is nothing
    // in his AlbumEasy sources to measure this against — `PAGE_TEXT_PARAGRAPH_START` appears 21
    // times in the program's own examples and **not once** in his six areas — so it is an invention,
    // and the role is what keeps it from being a sixth type setting nothing else uses.
    const pages = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            corrected("t1", "Kasowane", [], { kind: "text", role: "chapter" }),
          ]),
        ],
        stacked,
        "Album",
        metrics
      ).pages
    );
    const note = pages[0].headings[1];
    assert.equal(note.role, "chapter");
    assert.deepEqual(note.lines, ["Kasowane"]);
    // The chapter face is 24 pt against the heading's 12, so the note is set twice the size — which
    // is the whole of what choosing a role buys, and it is charged for: 12 mm of line, not 6.
    assert.equal(note.heightMm, 12);
    assert.deepEqual(pages[0].blocks[1], {
      entryId: "t1",
      kind: "text",
      part: 1,
      heading: "Kasowane",
      firstBoxIndex: 0,
      boxCount: 0,
    });
  });

  it("does not reprint a chapter's year because a note was filed in front of a printed card", () => {
    // The printed-sheet family (ADR-0047 §4) arriving through the editor. The card in the binder
    // carries 1938; a note typed today sits in front of it and was on no card, so reading the note
    // as the block that opens the chapter would file a blank sheet headed 1938 ahead of the real one
    // — which is exactly what an album with every chapter printed used to come out as.
    const plan = planAlbumPages(
      [
        chapter("1938", "1938", [
          corrected("t1", "Kasowane", [], { kind: "text" }),
          block("a", "A", [], "printed-1"),
        ]),
      ],
      stacked,
      "Album",
      metrics
    );
    const [sheet] = live(plan.pages);
    assert.equal(sheet.chapter, null);
    assert.deepEqual(
      sheet.blocks.map((b) => b.entryId),
      ["t1"]
    );

    // A note that is itself on the card *is* an opener: the card carries it and the year together.
    const printedNote = planAlbumPages(
      [
        chapter("1938", "1938", [
          corrected("t1", "Kasowane", [], { kind: "text", printedPageIds: ["printed-1"] }),
          block("a", "A", [], "printed-1"),
        ]),
      ],
      stacked,
      "Album",
      metrics
    );
    assert.deepEqual(
      printedNote.pages.map((p) => p.kind),
      ["printed"]
    );
  });

  it("still steps over a printed sheet whose block carries corrections", () => {
    // A correction is an instruction to the **packer**, and a card in a binder was never packed by
    // this run. A forced break above a block on paper that opened a live sheet in front of it would
    // be the printed-sheet family of bug (ADR-0047 §4) arriving through the editor: the plan
    // emitting something the card already accounts for.
    const plan = planAlbumPages(
      [
        chapter("1938", "1938", [
          corrected("a", "A", [], {
            printedPageIds: ["printed-1"],
            breakBefore: "always",
            spaceBeforeMm: 50,
          }),
          block("b", "B", [box(30, 36)]),
        ]),
      ],
      stacked,
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => (p.kind === "printed" ? p.printedPageId : "live")),
      ["printed-1", "live"]
    );
    // The chapter's year is on the card, so the live sheet after it does not print one again.
    const [after] = live(plan.pages);
    assert.equal(after.chapter, null);
  });

  it("files a reordered printed sheet once even with a correction between its blocks", () => {
    // The reordered-printed input (ADR-0047 §4), with the editor's own vocabulary in the gap. The
    // block in between asks for a break and for space, and the card is still one card.
    const plan = planAlbumPages(
      [
        chapter("y", "", [
          block("a", "", [box(30, 36)], "printed-1"),
          corrected("b", "B", [box(30, 36)], {
            breakBefore: "always",
            spaceBeforeMm: 15,
          }),
          block("c", "", [box(30, 36)], "printed-1"),
        ]),
      ],
      stacked,
      "Album",
      metrics
    );
    assert.deepEqual(
      plan.pages.map((p) => p.kind),
      ["printed", "live"]
    );
    const sheet = plan.pages[0];
    if (sheet.kind === "printed") assert.deepEqual(sheet.entryIds, ["a", "c"]);
  });

  it("keeps a correction working after the content it hangs on has changed", () => {
    // The claim the whole design rests on: a correction is a delta the automatic layout still runs
    // under, so a stamp joining the checklist re-flows the page and the correction is still 20 mm
    // before that block. An absolute position would have to be re-typed here.
    const withStamps = (n: number) =>
      live(
        planAlbumPages(
          [
            chapter("y", "", [
              block("a", "A", Array.from({ length: n }, () => box(30, 36))),
              corrected("b", "B", [box(30, 36)], { spaceBeforeMm: 20 }),
            ]),
          ],
          stacked,
          "Album",
          metrics
        ).pages
      );

    const before = withStamps(1);
    const after = withStamps(12);
    // A now wraps to two rows, so B is a row lower — and exactly a row lower, the 20 mm intact.
    assert.equal(after[0].headings[1].yMm - before[0].headings[1].yMm, 42);
  });
});
