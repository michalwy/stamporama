import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumBandOffsetsMm,
  albumContinuationHeading,
  albumEffectivePlacement,
  albumPlacedFooter,
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

describe("planAlbumPages and a row broken by hand (#1214)", () => {
  /** One block per band, so a row is a row of one block and nothing else moves. */
  const stacked = preset({ blocksPerBand: 1 });

  /** A box the collector has started a new row at. A fresh object each call, so a test can find the
   *  placement by reference — the layout hands the caller's own row straight back. */
  const breaking = (widthMm: number, heightMm: number): AlbumBoxSpec => ({
    ...box(widthMm, heightMm),
    rowBreakBefore: true,
  });

  /** The rows one live page holds, as the caller's own box objects grouped by where they landed. */
  const rowsOf = (boxes: readonly AlbumBoxSpec[], preset_ = stacked): AlbumBoxSpec[][] => {
    const [page] = live(
      planAlbumPages([chapter("y", "", [block("a", "A", [...boxes])])], preset_, "Album", metrics)
        .pages
    );
    const rows = new Map<number, AlbumBoxSpec[]>();
    for (const placed of page.boxes) {
      // Mounts are centred in their row's band, so a row is found by the band's top: every box in
      // these tests is one height, which makes the box's own top that band.
      rows.set(placed.yMm, [...(rows.get(placed.yMm) ?? []), placed.box]);
    }
    return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  };

  it("starts a new row at the box the collector broke before", () => {
    const [a, b, d] = [box(30, 36), box(30, 36), box(30, 36)];
    const c = breaking(30, 36);
    // 4 × 30 + 3 = 123 mm: one row of a 190 mm page, until he says otherwise.
    assert.deepEqual(rowsOf([a, b, { ...c, rowBreakBefore: false }, d]).map((r) => r.length), [4]);
    assert.deepEqual(rowsOf([a, b, c, d]), [
      [a, b],
      [c, d],
    ]);
  });

  it("places the broken row below, centred like any other row", () => {
    const boxes = [box(30, 36), box(30, 36), breaking(30, 36), box(30, 36)];
    const [page] = live(
      planAlbumPages([chapter("y", "", [block("a", "A", boxes)])], stacked, "Album", metrics).pages
    );
    const [first, , third] = page.boxes;
    // Two 30 mm boxes and a 1 mm gap is a 61 mm row, centred in 190 mm from x 10: 74.5 — for both
    // rows, since both are the same width.
    assert.equal(first.xMm, 74.5);
    assert.equal(third.xMm, 74.5);
    // One 36 mm row and the 6 mm row gap under it.
    assert.equal(third.yMm, first.yMm + 42);
  });

  it("keeps the break in front of its stamp when another stamp is added or taken away", () => {
    // Anchored to the box, not to a position in the block: that is the whole reason a correction on
    // this track survives the next stamp bought (ADR-0045 §3).
    const [x, a, b, d] = [box(30, 36), box(30, 36), box(30, 36), box(30, 36)];
    const c = breaking(30, 36);
    assert.deepEqual(rowsOf([x, a, b, c, d]), [
      [x, a, b],
      [c, d],
    ]);
    assert.deepEqual(rowsOf([a, c, d]), [[a], [c, d]]);
  });

  it("wraps the row after a break as usual when it is still wider than the page", () => {
    // A break only adds a row; it never forces an overflow. After it, 3 × 60 + 2 = 182 mm fits the
    // 190 mm page and a fourth 60 mm box would make 243, so that one wraps as it always has.
    const a = box(30, 36);
    const c = breaking(60, 36);
    const [d, e, f] = [box(60, 36), box(60, 36), box(60, 36)];
    assert.deepEqual(rowsOf([a, c, d, e, f]), [[a], [c, d, e], [f]]);
  });

  it("changes nothing when the break is on a block's first box", () => {
    // There is no row to close in front of the first box, so the block is the block it would be.
    const plain = [box(30, 36), box(30, 36)];
    const flagged = [breaking(30, 36), box(30, 36)];
    const place = (boxes: AlbumBoxSpec[]) =>
      live(
        planAlbumPages([chapter("y", "", [block("a", "A", boxes)])], stacked, "Album", metrics)
          .pages
      )[0].boxes.map((b) => [b.xMm, b.yMm]);
    assert.deepEqual(place(flagged), place(plain));
  });

  it("carries the break across a split, onto the sheet the row lands on", () => {
    // Twelve 190 mm rows split over two sheets; the row the collector broke in front of is still
    // its own row on whichever sheet it falls, because rows are measured for the whole block before
    // any sheet is filled.
    const rows = Array.from({ length: 12 }, () => box(90, 30));
    rows[9] = breaking(90, 30);
    const pages = live(
      planAlbumPages([chapter("y", "", [block("a", "A", rows)])], stacked, "Album", metrics).pages
    );
    // Two 90 mm boxes share a row: 0-1, 2-3, 4-5, 6-7, then 8 alone because 9 breaks, 9-10, 11.
    const all = pages.flatMap((p) => p.boxes);
    const ys = all.map((b) => `${pages.findIndex((p) => p.boxes.includes(b))}:${b.yMm}`);
    assert.notEqual(ys[8], ys[9]);
    assert.equal(ys[9], ys[10]);
    assert.notEqual(ys[10], ys[11]);
  });

  it("lets a block the collector broke into short rows share a band", () => {
    // Paired at a ceiling of two, each block gets (190 − 10) / 2 = 90 mm. Six 28 mm boxes on one line
    // are 173 mm, so A cannot pair — it would have to wrap, and a pairing that makes a block wrap has
    // made it worse. Broken three and three by hand, its widest row is 86 mm and nothing wraps.
    const blocks = (boxes: AlbumBoxSpec[]) => [
      block("a", "A", boxes),
      block("b", "B", [box(30, 36)]),
    ];
    const six = () => Array.from({ length: 6 }, () => box(28, 36));

    const [loose] = live(
      planAlbumPages([chapter("y", "", blocks(six()))], preset(), "Album", metrics).pages
    );
    assert.notEqual(loose.headings[0].yMm, loose.headings[1].yMm);

    const broken = six();
    broken[3] = breaking(28, 36);
    const [paired] = live(
      planAlbumPages([chapter("y", "", blocks(broken))], preset(), "Album", metrics).pages
    );
    assert.equal(paired.headings[0].yMm, paired.headings[1].yMm);
    assert.ok(paired.headings[1].xMm > paired.headings[0].xMm);
  });
});

/**
 * Blocks sharing a band line their mounts up (#779).
 *
 * Read off the collector's own pages: every `PAGE_VSPACE` inside a `PAGE_COLUMN_START` pair moves a
 * mount down so that the two mounts' centres are level, and under a heading that wraps beside one
 * that does not, the boxes start under the taller. With the stand-in measurer a 12 pt heading line
 * is 6 mm and costs 11 with the 5 mm under it; content starts at y = 23 and the lead above a heading
 * is 8, so a one-line heading's boxes start at 42 and a two-line heading's at 48.
 */
describe("planAlbumPages and blocks sharing a band (#779)", () => {
  /** 100 characters in words of four: two lines in a 90 mm share at 1.2 mm a character. */
  const wrapping = Array.from({ length: 20 }, () => "wwww").join(" ");
  const centre = (b: { yMm: number; heightMm: number }) => b.yMm + b.heightMm / 2;

  it("starts the boxes under the taller heading when one wraps and the other does not", () => {
    const [page] = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "A", [box(30, 36)]), block("b", wrapping, [box(30, 36)])])],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.headings[0].yMm, page.headings[1].yMm, "the headings still share a top");
    assert.equal(page.headings[1].lines.length, 2);
    assert.equal(page.boxes[1].yMm, 48);
    assert.equal(page.boxes[0].yMm, 48, "not at 42, under its own one-line heading");
  });

  it("centres a shorter mount on the taller one beside it", () => {
    const [page] = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "A", [box(30, 36)]), block("b", "B", [box(30, 30)])])],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.boxes[0].yMm, 42, "the taller mount stays where it was");
    assert.equal(page.boxes[1].yMm, 45);
    assert.equal(centre(page.boxes[0]), centre(page.boxes[1]));
  });

  it("does both at once, and the band is as tall as the aligned block", () => {
    // A: short heading, 36 mm mount. B: wrapped heading, 30 mm mount. The boxes start under B's
    // heading at 48 and B's mount is centred on A's, 3 mm lower. A is then 8 + 11 + 6 + 36 = 61 mm,
    // so the full-width block after the band has its heading at 23 + 61 + 8 = 92 — at 86 the band
    // would have been measured without the space it prints.
    const [page] = live(
      planAlbumPages(
        [
          chapter("y", "", [
            block("a", "A", [box(30, 36)]),
            block("b", wrapping, [box(30, 30)]),
            block("c", "C", [box(190, 30)]),
          ]),
        ],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.boxes[0].yMm, 48);
    assert.equal(page.boxes[1].yMm, 51);
    assert.equal(centre(page.boxes[0]), centre(page.boxes[1]));
    assert.equal(page.headings[2].yMm, 92);
  });

  it("keeps the collector's space before a block a delta on top of the alignment", () => {
    const plan = (over: Partial<AlbumBlockSpec>) =>
      live(
        planAlbumPages(
          [
            chapter("y", "", [
              block("a", "A", [box(30, 36)]),
              { ...block("b", "B", [box(30, 30)]), ...over },
            ]),
          ],
          preset(),
          "Album",
          metrics
        ).pages
      )[0];
    const plain = plan({});
    const moved = plan({ spaceBeforeMm: 5 });
    assert.equal(moved.headings[1].yMm, plain.headings[1].yMm + 5);
    assert.equal(moved.boxes[1].yMm, plain.boxes[1].yMm + 5);
    assert.equal(moved.boxes[0].yMm, plain.boxes[0].yMm, "the neighbour is not dragged down with it");
  });

  it("does not push a checklist's boxes under a note beside it", () => {
    const note: AlbumBlockSpec = {
      entryId: "n",
      heading: wrapping,
      boxes: [],
      printedPageIds: null,
      kind: "text",
    };
    const [page] = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "A", [box(30, 36)]), note])],
        preset(),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.blocks.length, 2);
    assert.equal(page.headings[0].yMm, page.headings[1].yMm, "the note shares the band");
    assert.equal(page.boxes[0].yMm, 42);
  });

  it("adds nothing to a block alone in its band", () => {
    const [page] = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "A", [box(30, 36)]), block("b", wrapping, [box(30, 30)])])],
        preset({ blocksPerBand: 1 }),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.boxes[0].yMm, 42);
    // B: A's block ends at 42 + 36 = 78, B's lead is 8, and at the full 190 mm its heading is one
    // line again and costs 11.
    assert.equal(page.headings[1].lines.length, 1);
    assert.equal(page.boxes[1].yMm, 78 + 8 + 11);
  });
});

describe("planAlbumPages and the vertical placement of a sheet (#1419)", () => {
  // A4, 10 mm margins, a 13 mm running head (26 pt) and a 4 mm footer band (8 pt): the body runs from
  // 23 mm to 283 mm. A block headed "A" over one 190 × 30 mm box is 8 (lead) + 11 (heading and the
  // space under it) + 30 = 49 mm tall, with its box 19 mm below the block's top.
  const CONTENT_TOP = 23;
  const CONTENT_BOTTOM = 283;
  const series = (entryId: string, over: Partial<AlbumBlockSpec> = {}): AlbumBlockSpec => ({
    entryId,
    heading: "A",
    boxes: [box(190, 30)],
    printedPageIds: null,
    ...over,
  });
  const onePage = (
    blocks: AlbumBlockSpec[],
    over: Partial<AlbumRenderPreset> = {},
    chapterHeading = ""
  ) => {
    const pages = live(
      planAlbumPages([chapter("y", chapterHeading, blocks)], preset(over), "Polska", metrics).pages
    );
    assert.equal(pages.length, 1, "every case here fits one sheet");
    return pages[0];
  };
  const boxTops = (page: ReturnType<typeof onePage>) => page.boxes.map((b) => b.yMm);

  it("keeps today's result exactly under top", () => {
    const page = onePage([series("a"), series("b")], { verticalPlacement: "top" });
    assert.deepEqual(boxTops(page), [CONTENT_TOP + 19, CONTENT_TOP + 49 + 19]);
    assert.deepEqual(
      page.headings.map((h) => h.yMm),
      [CONTENT_TOP + 8, CONTENT_TOP + 49 + 8]
    );
    assert.equal(page.placement, "top");
    // The default template is top, so an album nobody has touched plans as it always has.
    assert.deepEqual(onePage([series("a"), series("b")]), page);
  });

  it("centres the content as a whole, at its ordinary spacing", () => {
    // Two series take 98 mm of 260: 162 mm are left, and half of it goes above.
    const page = onePage([series("a"), series("b")], { verticalPlacement: "center" });
    assert.deepEqual(boxTops(page), [CONTENT_TOP + 81 + 19, CONTENT_TOP + 81 + 49 + 19]);
    const lastBottom = page.boxes[1].yMm + page.boxes[1].heightMm;
    assert.equal(CONTENT_BOTTOM - lastBottom, 81, "as much space below as above");
  });

  it("justifies: the first series at the top, the last at the bottom, equal gaps between", () => {
    // Three series take 147 mm, so 113 mm are shared into the two gaps between them.
    const page = onePage([series("a"), series("b"), series("c")], {
      verticalPlacement: "justify",
    });
    assert.deepEqual(boxTops(page), [
      CONTENT_TOP + 19,
      CONTENT_TOP + 49 + 56.5 + 19,
      CONTENT_TOP + 98 + 113 + 19,
    ]);
    const last = page.boxes[2];
    assert.equal(last.yMm + last.heightMm, CONTENT_BOTTOM, "the last series ends at the bottom");
  });

  it("centres and justifies: above the first, each gap between and below the last all equal", () => {
    // Two series leave 162 mm, shared three ways.
    const page = onePage([series("a"), series("b")], { verticalPlacement: "center-justify" });
    assert.deepEqual(boxTops(page), [CONTENT_TOP + 54 + 19, CONTENT_TOP + 49 + 108 + 19]);
    const [first, second] = page.headings;
    const above = first.yMm - 8 - CONTENT_TOP;
    const between = second.yMm - 8 - (page.boxes[0].yMm + 30);
    const below = CONTENT_BOTTOM - (page.boxes[1].yMm + 30);
    assert.deepEqual([above, between, below], [54, 54, 54]);
  });

  it("treats a single series under justify as top, and under centre and justify as centre", () => {
    const top = onePage([series("a")], { verticalPlacement: "top" });
    const centred = onePage([series("a")], { verticalPlacement: "center" });
    const justified = onePage([series("a")], { verticalPlacement: "justify" });
    const both = onePage([series("a")], { verticalPlacement: "center-justify" });
    assert.deepEqual(boxTops(justified), boxTops(top));
    assert.equal(justified.placement, "top");
    assert.deepEqual(boxTops(both), boxTops(centred));
    assert.equal(both.placement, "center");
    // 260 − 49 = 211 left, half of it above.
    assert.deepEqual(boxTops(centred), [CONTENT_TOP + 105.5 + 19]);
  });

  it("never moves the running head, the chapter heading or the footer", () => {
    const blocks = [series("a"), series("b")];
    const top = onePage(blocks, { verticalPlacement: "top" }, "1938");
    for (const verticalPlacement of ["center", "justify", "center-justify"] as const) {
      const placed = onePage(blocks, { verticalPlacement }, "1938");
      assert.deepEqual(placed.title, top.title, verticalPlacement);
      assert.deepEqual(placed.chapter, top.chapter, verticalPlacement);
      assert.deepEqual(placed.footer, top.footer, verticalPlacement);
      assert.deepEqual(placed.content, top.content, verticalPlacement);
      assert.notDeepEqual(boxTops(placed), boxTops(top), verticalPlacement);
    }
  });

  it("places the body below a chapter heading, in the space under it", () => {
    // The year takes 8 + 12 + 5 = 25 mm, so the body is 235 mm and one series leaves 186.
    const page = onePage([series("a")], { verticalPlacement: "center" }, "1938");
    assert.equal(page.content.yMm, CONTENT_TOP + 25);
    assert.deepEqual(boxTops(page), [CONTENT_TOP + 25 + 93 + 19]);
  });

  it("moves blocks sharing a band together, so their mounts stay lined up", () => {
    const narrow = (entryId: string): AlbumBlockSpec => series(entryId, { boxes: [box(40, 30)] });
    const page = onePage([narrow("a"), narrow("b"), series("c")], {
      verticalPlacement: "justify",
      blocksPerBand: 2,
    });
    const [a, b, c] = page.boxes;
    assert.equal(a.yMm, b.yMm, "the paired blocks stay on one line");
    assert.equal(a.yMm, CONTENT_TOP + 19, "the first band stays at the top");
    assert.equal(c.yMm + c.heightMm, CONTENT_BOTTOM, "the last band ends at the bottom");
    assert.equal(page.placement, "justify", "two bands are two series to justify");
  });

  it("does not change which block lands on which sheet", () => {
    const blocks = Array.from({ length: 7 }, (_, i) => series(`s${i}`));
    const plans = (["top", "center", "justify", "center-justify"] as const).map((verticalPlacement) =>
      live(
        planAlbumPages([chapter("y", "", blocks)], preset({ verticalPlacement }), "Polska", metrics)
          .pages
      ).map((page) => page.blocks.map((b) => b.entryId))
    );
    for (const plan of plans) assert.deepEqual(plan, plans[0]);
    assert.equal(plans[0].length, 2, "seven 49 mm series need a second sheet");
  });

  it("places each sheet of a split series, the tail of it included", () => {
    // Eight 30 mm rows: six fit the first sheet (8 + 11 + 6 × 30 + 5 × 6 = 229 mm), and the
    // continuation carries two under its marked heading — 85 mm of 260, so 87.5 mm go above it.
    const rows = Array.from({ length: 8 }, () => box(190, 30));
    const pages = live(
      planAlbumPages(
        [chapter("y", "", [series("a", { boxes: rows })])],
        preset({ verticalPlacement: "center" }),
        "Polska",
        metrics
      ).pages
    );
    assert.equal(pages.length, 2);
    assert.equal(pages[1].blocks[0].part, 2);
    assert.equal(pages[1].placement, "center");
    assert.equal(pages[1].boxes[0].yMm, CONTENT_TOP + 87.5 + 19);
    assert.equal(pages[0].boxes[0].yMm, CONTENT_TOP + 15.5 + 19, "the full sheet moves by its 31 mm / 2");
  });

  it("lets the block that opens a sheet override the album's placement for that sheet", () => {
    const page = onePage([series("a", { pagePlacement: "center" }), series("b")], {
      verticalPlacement: "top",
    });
    assert.equal(page.placement, "center");
    assert.deepEqual(boxTops(page), [CONTENT_TOP + 81 + 19, CONTENT_TOP + 81 + 49 + 19]);
    // Null follows the album.
    const following = onePage([series("a", { pagePlacement: null }), series("b")], {
      verticalPlacement: "justify",
    });
    assert.equal(following.placement, "justify");
  });

  it("reads the override only from the block that opens the sheet", () => {
    const page = onePage([series("z"), series("a", { pagePlacement: "center" })], {
      verticalPlacement: "top",
    });
    assert.equal(page.placement, "top", "a block further down the sheet places nothing");
  });

  it("keeps the override with that block's content when the pages re-flow", () => {
    // Before: the override's block opens the album's only sheet. After: a tall series is added in
    // front of it, and the block now opens the second sheet — which is the one it places.
    const flagged = series("a", { pagePlacement: "center" });
    const before = live(
      planAlbumPages([chapter("y", "", [flagged, series("b")])], preset(), "Polska", metrics).pages
    );
    assert.equal(before[0].placement, "center");

    const tall = series("t", { boxes: [box(190, 200)] });
    const after = live(
      planAlbumPages([chapter("y", "", [tall, flagged, series("b")])], preset(), "Polska", metrics)
        .pages
    );
    assert.equal(after.length, 2);
    assert.equal(after[0].blocks[0].entryId, "t");
    assert.equal(after[0].placement, "top", "the sheet the tall series opens follows the album");
    assert.equal(after[1].blocks[0].entryId, "a");
    assert.equal(after[1].placement, "center", "the override went with its block");
  });
});

describe("albumBandOffsetsMm", () => {
  it("moves nothing under top, and nothing when nothing is left over", () => {
    assert.deepEqual(albumBandOffsetsMm("top", 3, 90), [0, 0, 0]);
    assert.deepEqual(albumBandOffsetsMm("center-justify", 3, 0), [0, 0, 0]);
  });

  it("never moves anything up when a sheet overhangs", () => {
    assert.deepEqual(albumBandOffsetsMm("center", 2, -12), [0, 0]);
  });

  it("shares the leftover the way each placement says", () => {
    assert.deepEqual(albumBandOffsetsMm("center", 3, 90), [45, 45, 45]);
    assert.deepEqual(albumBandOffsetsMm("justify", 3, 90), [0, 45, 90]);
    assert.deepEqual(albumBandOffsetsMm("center-justify", 3, 90), [22.5, 45, 67.5]);
  });

  it("rounds to the tenth the plan is rounded to", () => {
    assert.deepEqual(albumBandOffsetsMm("center-justify", 2, 10), [3.3, 6.7]);
  });
});

describe("albumEffectivePlacement", () => {
  it("reads justify as top and centre-and-justify as centre on a sheet of one band", () => {
    assert.equal(albumEffectivePlacement("justify", 1), "top");
    assert.equal(albumEffectivePlacement("center-justify", 1), "center");
    assert.equal(albumEffectivePlacement("center", 1), "center");
    assert.equal(albumEffectivePlacement("justify", 2), "justify");
    assert.equal(albumEffectivePlacement("center", 0), "top");
  });
});

describe("planAlbumPages and a series started on its own line (#1421)", () => {
  const corrected = (
    entryId: string,
    heading: string,
    boxes: AlbumBoxSpec[],
    over: Partial<AlbumBlockSpec> = {}
  ): AlbumBlockSpec => ({ entryId, heading, boxes, printedPageIds: null, ...over });
  /** Two one-stamp checklists: exactly what the collector pairs. 8 + 11 + 36 = 55 mm each. */
  const narrow = (entryId: string, over: Partial<AlbumBlockSpec> = {}) =>
    corrected(entryId, entryId.toUpperCase(), [box(30, 36)], over);
  /** 190 mm rows, so it never pairs: 8 + 11 + 5 × 30 + 4 × 6 = 193 mm. */
  const filler = corrected("f", "F", Array.from({ length: 5 }, () => box(190, 30)));
  const plan = (blocks: AlbumBlockSpec[]) =>
    live(planAlbumPages([chapter("y", "", blocks)], preset(), "Album", metrics).pages);
  const order = (pages: ReturnType<typeof plan>) =>
    pages.map((p) => p.blocks.map((b) => b.entryId));

  it("puts a series below the one before it instead of beside it", () => {
    const paired = plan([narrow("a"), narrow("b")]);
    assert.equal(paired[0].headings[0].yMm, paired[0].headings[1].yMm, "beside by default");
    assert.equal(paired[0].blocks[1].beside, true);
    assert.equal(paired[0].blocks[0].beside, undefined, "the first of a band is beside nothing");

    const broken = plan([narrow("a"), narrow("b", { bandBreakBefore: true })]);
    assert.equal(broken.length, 1, "a line of its own, not a page of its own");
    assert.equal(broken[0].headings[0].yMm, 31);
    // A ends at 23 + 55; B's own lead of 8 puts its heading at 86, across the full width.
    assert.equal(broken[0].headings[1].yMm, 86);
    assert.equal(broken[0].headings[1].widthMm, broken[0].content.widthMm);
    assert.equal(broken[0].blocks[1].beside, undefined);
  });

  it("only prevents the pairing with the series before — the next one may still sit beside it", () => {
    const pages = plan([narrow("a"), narrow("b", { bandBreakBefore: true }), narrow("c")]);
    assert.equal(pages.length, 1);
    const [a, b, c] = pages[0].headings;
    assert.ok(b.yMm > a.yMm, "B went below A");
    assert.equal(c.yMm, b.yMm, "and C pairs with B on B's line");
    assert.equal(pages[0].blocks[2].beside, true);
  });

  it("sends a series that no longer fits once it has moved down to the next sheet", () => {
    // F (193) and the A–B band (55) make 248 of the 260 mm sheet. Below A, B needs 55 more.
    assert.deepEqual(order(plan([filler, narrow("a"), narrow("b")])), [["f", "a", "b"]]);

    const pages = plan([filler, narrow("a"), narrow("b", { bandBreakBefore: true })]);
    assert.deepEqual(order(pages), [["f", "a"], ["b"]]);
    // At the top of an ordinary sheet, as any block that moved whole: y 23 + its own lead of 8.
    assert.equal(pages[1].headings[0].yMm, 31);
  });

  it("changes nothing on a series that opens its band anyway", () => {
    const plain = plan([filler, narrow("a")]);
    const flagged = plan([filler, narrow("a", { bandBreakBefore: true })]);
    assert.deepEqual(flagged, plain);
    assert.deepEqual(
      plan([narrow("a", { bandBreakBefore: true }), narrow("b")]),
      plan([narrow("a"), narrow("b")])
    );
  });
});

describe("planAlbumPages and the gap between a box and its label (#1420)", () => {
  // The stand-in measurer sets an 8 pt label in 4 mm lines.
  const labelled = (gap: number, over: Partial<AlbumRenderPreset> = {}) =>
    live(
      planAlbumPages(
        [chapter("y", "", [block("a", "", [box(60, 20, "303"), box(60, 30, "304")])])],
        preset({ labelGapMm: gap, ...over }),
        "Album",
        metrics
      ).pages
    )[0];

  it("sets a label on the box's own edge by default, as every page before it was", () => {
    assert.equal(DEFAULT_ALBUM_PRESET.labelGapMm, 0);
    const page = labelled(DEFAULT_ALBUM_PRESET.labelGapMm);
    const tallest = page.boxes[1];
    assert.equal(tallest.label!.yMm, tallest.yMm + tallest.heightMm);
  });

  it("moves every label below the row by the gap, on one baseline", () => {
    const before = labelled(0);
    const after = labelled(2.5);
    assert.deepEqual(
      after.boxes.map((b) => b.yMm),
      before.boxes.map((b) => b.yMm),
      "the mounts stay where they were"
    );
    for (const [i, b] of after.boxes.entries()) {
      assert.equal(b.label!.yMm, before.boxes[i].label!.yMm + 2.5);
      assert.equal(b.label!.heightMm, before.boxes[i].label!.heightMm, "the label itself is no taller");
    }
  });

  it("moves the mounts below labels set above them by the gap", () => {
    const before = labelled(0, { labelPosition: "above" });
    const after = labelled(3, { labelPosition: "above" });
    for (const [i, b] of after.boxes.entries()) {
      assert.equal(b.label!.yMm, before.boxes[i].label!.yMm, "the labels open the row");
      assert.equal(b.yMm, before.boxes[i].yMm + 3);
    }
    const tallest = after.boxes[1];
    assert.equal(tallest.yMm, tallest.label!.yMm + tallest.label!.heightMm + 3);
  });

  it("makes a labelled row taller, so the next row starts that much lower", () => {
    const rows = (gap: number) =>
      live(
        planAlbumPages(
          [chapter("y", "", [block("a", "", [box(120, 20, "303"), box(120, 20, "304")])])],
          preset({ labelGapMm: gap }),
          "Album",
          metrics
        ).pages
      )[0].boxes.map((b) => b.yMm);
    const [firstBefore, secondBefore] = rows(0);
    const [firstAfter, secondAfter] = rows(4);
    assert.equal(firstAfter, firstBefore);
    assert.equal(secondAfter, secondBefore + 4);
  });

  it("reserves nothing on a row that prints no label", () => {
    const rows = (gap: number, over: Partial<AlbumRenderPreset> = {}, label = "") =>
      live(
        planAlbumPages(
          [chapter("y", "", [block("a", "", [box(120, 20, label), box(120, 20, label)])])],
          preset({ labelGapMm: gap, ...over }),
          "Album",
          metrics
        ).pages
      )[0].boxes.map((b) => b.yMm);
    assert.deepEqual(rows(10), rows(0), "blank labels");
    assert.deepEqual(rows(10, { labelPosition: "none" }, "303"), rows(0, { labelPosition: "none" }, "303"));
  });

  it("keeps mounts sharing a band centred when only one of them carries a label above it", () => {
    const [page] = live(
      planAlbumPages(
        [chapter("y", "", [block("a", "A", [box(30, 30, "303")]), block("b", "B", [box(30, 30)])])],
        preset({ labelPosition: "above", labelGapMm: 5 }),
        "Album",
        metrics
      ).pages
    );
    assert.equal(page.boxes[0].yMm, page.boxes[1].yMm);
    assert.equal(page.boxes[0].yMm, page.boxes[0].label!.yMm + page.boxes[0].label!.heightMm + 5);
  });

  it("re-plans the sheets: a wider gap can carry a block onto the next one", () => {
    // Five blocks of two 16 mm rows with 4 mm labels, each 6 + 20 + 6 + 20 = 52 mm, fill one sheet.
    // At 5 mm each is 62 mm, and the fifth no longer fits under the other four.
    const blocks = Array.from({ length: 5 }, (_, i) =>
      block(`b${i}`, "", [box(190, 16, "1"), box(190, 16, "2")])
    );
    const sheets = (gap: number) =>
      live(planAlbumPages([chapter("y", "", blocks)], preset({ labelGapMm: gap }), "Album", metrics).pages);
    assert.equal(sheets(0).length, 1);
    const wider = sheets(5);
    assert.equal(wider.length, 2);
    assert.deepEqual(wider[1].blocks.map((b) => b.entryId), ["b4"]);
  });
});

describe("planAlbumPages and the space around the page headings (#1426)", () => {
  const blocks = [block("a", "A", [box(60, 20)])];
  const first = (over: Partial<AlbumRenderPreset> = {}, title = "Album") =>
    live(planAlbumPages([chapter("y", "1939", blocks)], preset(over), title, metrics).pages)[0];

  it("defaults to the spacing the headings had before it was a value", () => {
    assert.equal(DEFAULT_ALBUM_PRESET.titleSpaceAboveMm, 0);
    assert.equal(DEFAULT_ALBUM_PRESET.titleSpaceBelowMm, 0);
    assert.equal(DEFAULT_ALBUM_PRESET.chapterSpaceAboveMm, DEFAULT_ALBUM_PRESET.headingSpaceAboveMm);
    assert.equal(DEFAULT_ALBUM_PRESET.chapterSpaceBelowMm, DEFAULT_ALBUM_PRESET.headingSpaceBelowMm);

    const page = first();
    const title = page.title!;
    assert.equal(title.yMm, DEFAULT_ALBUM_PRESET.marginTopMm, "the name sits on the top margin");
    const chapter = page.chapter!;
    assert.equal(chapter.yMm, title.yMm + title.heightMm + DEFAULT_ALBUM_PRESET.headingSpaceAboveMm);
    assert.equal(page.content.yMm, chapter.yMm + chapter.heightMm + DEFAULT_ALBUM_PRESET.headingSpaceBelowMm);
  });

  it("moves the album title by the space above it, and everything under it by both", () => {
    const before = first();
    const after = first({ titleSpaceAboveMm: 3, titleSpaceBelowMm: 4 });
    assert.equal(after.title!.yMm, before.title!.yMm + 3);
    assert.equal(after.title!.heightMm, before.title!.heightMm);
    assert.equal(after.chapter!.yMm, before.chapter!.yMm + 7);
    assert.equal(after.content.yMm, before.content.yMm + 7);
    assert.deepEqual(
      after.boxes.map((b) => b.yMm),
      before.boxes.map((b) => b.yMm + 7)
    );
  });

  it("takes the title's space off every sheet, not only a chapter's first", () => {
    const tall = Array.from({ length: 6 }, (_, i) => block(`b${i}`, "", [box(190, 40)]));
    const sheets = (over: Partial<AlbumRenderPreset>) =>
      live(planAlbumPages([chapter("y", "", tall)], preset(over), "Album", metrics).pages);
    const [, before] = sheets({});
    const [, after] = sheets({ titleSpaceBelowMm: 5 });
    assert.equal(after.content.yMm, before.content.yMm + 5);
  });

  it("reserves nothing around a title that is not printed", () => {
    const off = first({ printTitle: false });
    const offSpaced = first({ printTitle: false, titleSpaceAboveMm: 9, titleSpaceBelowMm: 9 });
    assert.equal(offSpaced.title, null);
    assert.equal(offSpaced.chapter!.yMm, off.chapter!.yMm);
    assert.equal(offSpaced.content.yMm, off.content.yMm);
  });

  it("moves the chapter heading and the content under it by the chapter's own values", () => {
    const before = first({ chapterSpaceAboveMm: 8, chapterSpaceBelowMm: 5 });
    const after = first({ chapterSpaceAboveMm: 2, chapterSpaceBelowMm: 12 });
    assert.equal(after.title!.yMm, before.title!.yMm, "the name does not move");
    assert.equal(after.chapter!.yMm, before.chapter!.yMm - 6);
    assert.equal(after.content.yMm, before.content.yMm + 1);
  });

  it("no longer takes the chapter heading's space from the checklist headings", () => {
    const before = first();
    const after = first({ headingSpaceAboveMm: 20, headingSpaceBelowMm: 20 });
    assert.equal(after.chapter!.yMm, before.chapter!.yMm);
    assert.equal(after.content.yMm, before.content.yMm);
    assert.notEqual(after.headings[0].yMm, before.headings[0].yMm, "the checklist heading still moves");
  });

  it("reserves nothing around a blank chapter heading", () => {
    const blank = (over: Partial<AlbumRenderPreset>) =>
      live(planAlbumPages([chapter("y", "", blocks)], preset(over), "Album", metrics).pages)[0];
    assert.equal(
      blank({ chapterSpaceAboveMm: 30, chapterSpaceBelowMm: 30 }).content.yMm,
      blank({}).content.yMm
    );
  });

  it("leaves the headings fixed under a vertical placement, which starts under the space below them", () => {
    const top = first({ chapterSpaceBelowMm: 10 });
    const centred = first({ chapterSpaceBelowMm: 10, verticalPlacement: "center" });
    assert.equal(centred.title!.yMm, top.title!.yMm);
    assert.equal(centred.chapter!.yMm, top.chapter!.yMm);
    assert.equal(centred.content.yMm, top.content.yMm, "the placed content's area begins where it did");
    assert.ok(centred.boxes[0].yMm > top.boxes[0].yMm, "and the content is placed inside it");
  });

  it("re-plans the sheets: more room for the headings can carry a block onto the next one", () => {
    // Six 40 mm checklists, each 6 + 40 = 46 mm. Five (230 mm) fit the 235 mm a chapter's first
    // sheet leaves under its heading; 20 mm more above the album title leaves 215, and the fifth
    // moves on.
    const six = Array.from({ length: 6 }, (_, i) => block(`b${i}`, "", [box(190, 40)]));
    const sheets = (over: Partial<AlbumRenderPreset>) =>
      live(planAlbumPages([chapter("y", "1939", six)], preset(over), "Album", metrics).pages).map(
        (p) => p.blocks.map((b) => b.entryId)
      );
    assert.deepEqual(sheets({}), [["b0", "b1", "b2", "b3", "b4"], ["b5"]]);
    assert.deepEqual(sheets({ titleSpaceAboveMm: 20 }), [["b0", "b1", "b2", "b3"], ["b4", "b5"]]);
    assert.deepEqual(sheets({ chapterSpaceBelowMm: 25 }), [["b0", "b1", "b2", "b3"], ["b4", "b5"]]);
  });
});

describe("planAlbumPages and a title set into the frame line (#1428)", () => {
  const blocks = [block("a", "A", [box(60, 20)])];
  // 10 pt in the stand-in measurer: a 5 mm line, 1 mm a character.
  const first = (over: Partial<AlbumRenderPreset> = {}, title = "Polska") =>
    live(
      planAlbumPages(
        [chapter("y", "1939", blocks)],
        preset({ titleSizePt: 10, ...over }),
        title,
        metrics
      ).pages
    )[0];
  const inFrame = (over: Partial<AlbumRenderPreset> = {}, title = "Polska") =>
    first({ titlePlacement: "in-frame", ...over }, title);

  it("defaults to below the frame, with his 5 mm gap ready for when it is not", () => {
    assert.equal(DEFAULT_ALBUM_PRESET.titlePlacement, "below-frame");
    assert.equal(DEFAULT_ALBUM_PRESET.titleFrameGapMm, 5);
  });

  it("centres the title on the frame's centre line and on the sheet, as wide as its text", () => {
    const title = inFrame().title!;
    // A double rule 0.4 mm heavy, inset 5 with 1.2 mm between: the centre line is at 5.8.
    assert.equal(title.yMm + title.heightMm / 2, 5.8);
    assert.equal(title.widthMm, 6, "six characters at 1 mm");
    assert.equal(title.xMm, (210 - 6) / 2);
    assert.deepEqual(title.lines, ["Polska"]);
    // A single rule's centre line is the rule.
    const single = inFrame({ borderStyle: "single" }).title!;
    assert.equal(single.yMm + single.heightMm / 2, 5);
  });

  it("gives the title's line back: the content starts on the top margin", () => {
    const below = first();
    const page = inFrame();
    assert.equal(below.chapter!.yMm, 10 + 5 + 8, "under the title, as before");
    assert.equal(page.chapter!.yMm, 10 + 8, "on the margin, the chapter's own space above it");
    assert.equal(page.content.yMm, below.content.yMm - 5);
  });

  it("does not read the space above the title, which has nothing to separate it from", () => {
    assert.deepEqual(inFrame({ titleSpaceAboveMm: 12 }), inFrame());
  });

  it("starts the content under a title that reaches below the margin, the space below the title under it", () => {
    // 26 pt: a 13 mm line centred on 5.8 runs to 12.3, past the 10 mm margin.
    const tall = inFrame({ titleSizePt: 26 });
    assert.equal(tall.chapter!.yMm, 12.3 + 8);
    const spaced = inFrame({ titleSizePt: 26, titleSpaceBelowMm: 4 });
    assert.equal(spaced.chapter!.yMm, 12.3 + 4 + 8);
  });

  it("keeps the space below the title as a floor, never a jump, where the title stays above the margin", () => {
    // The 5 mm line runs to 8.3. With 1 mm below that is 9.3 — the margin wins; with 3 mm it is
    // 11.3, and the content moves 1.3 mm rather than a whole spacing value.
    assert.equal(inFrame({ titleSpaceBelowMm: 1 }).content.yMm, inFrame().content.yMm);
    assert.equal(inFrame({ titleSpaceBelowMm: 3 }).chapter!.yMm, 11.3 + 8);
  });

  it("places the title below as today on a sheet with no rule to break", () => {
    for (const over of [{ borderStyle: "none" as const }, { borderWidthMm: 0 }]) {
      assert.deepEqual(inFrame(over), first(over));
    }
  });

  it("changes nothing on a sheet that prints no title", () => {
    assert.deepEqual(inFrame({ printTitle: false }), first({ printTitle: false }));
  });

  it("re-plans the sheets: the line it gives back can bring a block onto an earlier sheet", () => {
    // Six 34 mm checklists at 40 mm each. Below the frame the 26 pt title's 13 mm line leaves a
    // chapter's first sheet 235 mm and five fit. In the frame line the title runs to 12.3 mm, so the
    // content starts there rather than on the 10 mm margin: 245.7 mm, and all six fit.
    const six = Array.from({ length: 6 }, (_, i) => block(`b${i}`, "", [box(190, 34)]));
    const sheets = (over: Partial<AlbumRenderPreset>) =>
      live(planAlbumPages([chapter("y", "1939", six)], preset(over), "Album", metrics).pages).map(
        (p) => p.blocks.map((b) => b.entryId)
      );
    assert.deepEqual(sheets({}), [["b0", "b1", "b2", "b3", "b4"], ["b5"]]);
    assert.deepEqual(sheets({ titlePlacement: "in-frame" }), [
      ["b0", "b1", "b2", "b3", "b4", "b5"],
    ]);
  });
});

describe("planAlbumPages and a footer placed on its own (#1457)", () => {
  // A4 with 10 mm margins and his double rule: inset 5, 0.4 mm heavy, 1.2 mm between — the frame's
  // inside is 6.8 mm from the edge, its outside 4.8, its centre line 5.8. The footer is 8 pt, a 4 mm
  // line in the stand-in measurer.
  const series = (entryId: string): AlbumBlockSpec => ({
    entryId,
    heading: "A",
    boxes: [box(190, 30)],
    printedPageIds: null,
  });
  const sheet = (over: Partial<AlbumRenderPreset> = {}, blocks = [series("a"), series("b")]) => {
    const pages = live(planAlbumPages([chapter("y", "", blocks)], preset(over), "Polska", metrics).pages);
    assert.equal(pages.length, 1);
    return pages[0];
  };
  const contentBottom = (page: ReturnType<typeof sheet>) => page.content.yMm + page.content.heightMm;

  it("defaults to inside the frame, its foot on the bottom margin exactly as before", () => {
    assert.equal(DEFAULT_ALBUM_PRESET.footerPlacement, "inside-frame");
    assert.equal(DEFAULT_ALBUM_PRESET.footerOffsetMm, 3.2);
    assert.equal(DEFAULT_ALBUM_PRESET.footerFrameGapMm, 5);
    const page = sheet();
    assert.deepEqual(page.footer, { xMm: 10, yMm: 283, widthMm: 190, heightMm: 4 });
    assert.equal(contentBottom(page), 283);
    // A sheet with no rule sets the footer on the margin, which is where the offset puts it here.
    assert.deepEqual(sheet({ borderStyle: "none" }), page);
  });

  it("inside the frame, stands the footer's foot the offset above the rule and keeps the content clear of it", () => {
    const page = sheet({ footerOffsetMm: 5 });
    assert.equal(page.footer!.yMm + page.footer!.heightMm, 297 - 6.8 - 5);
    assert.equal(contentBottom(page), page.footer!.yMm);
    // Lower, the footer still reaches above the 287 mm margin, and the content still stops on it.
    const low = sheet({ footerOffsetMm: 0 });
    assert.equal(low.footer!.yMm, 297 - 6.8 - 4);
    assert.equal(contentBottom(low), low.footer!.yMm);
  });

  it("takes nothing from the content when the footer sits in the margin", () => {
    // A 20 mm bottom margin ends the content at 277; the footer at 286.2 is below it.
    const page = sheet({ marginBottomMm: 20, footerOffsetMm: 0 });
    assert.equal(page.footer!.yMm, 286.2);
    assert.equal(contentBottom(page), 277);
  });

  it("below the frame, sets the footer's head the offset under the rule, and the margins alone bound the content", () => {
    const page = sheet({ footerPlacement: "below-frame", footerOffsetMm: 1 });
    assert.equal(page.footer!.yMm, 297 - 4.8 + 1);
    assert.equal(page.footer!.heightMm, 4);
    assert.equal(contentBottom(page), 287);
    // The offset moves the footer and nothing else.
    const further = sheet({ footerPlacement: "below-frame", footerOffsetMm: 2 });
    assert.equal(further.footer!.yMm, page.footer!.yMm + 1);
    assert.deepEqual(further.content, page.content);
    assert.deepEqual(further.boxes, page.boxes);
  });

  it("in the frame line, centres the footer on the bottom rule's centre line and reserves nothing", () => {
    const page = sheet({ footerPlacement: "in-frame" });
    assert.equal(page.footer!.yMm + page.footer!.heightMm / 2, 297 - 5.8);
    assert.equal(contentBottom(page), 287);
    // The offset is not read there.
    assert.deepEqual(sheet({ footerPlacement: "in-frame", footerOffsetMm: 30 }), page);
    // A single rule's centre line is the rule.
    const single = sheet({ footerPlacement: "in-frame", borderStyle: "single" });
    assert.equal(single.footer!.yMm + single.footer!.heightMm / 2, 297 - 5);
  });

  it("sets the footer on the bottom margin on a sheet with no rule, whichever placement is chosen", () => {
    for (const over of [{ borderStyle: "none" as const }, { borderWidthMm: 0 }]) {
      const today = sheet(over);
      for (const footerPlacement of ["in-frame", "below-frame"] as const) {
        assert.deepEqual(sheet({ ...over, footerPlacement, footerOffsetMm: 7 }), today);
      }
    }
  });

  it("spreads justified content over the content area alone, the same whichever placement", () => {
    // Below the frame and in its line the content ends on the 287 mm margin; inside, on the
    // footer's head. Either way the last series ends on the content's own bottom edge, and under
    // center + justify there is as much above the first series as below the last.
    for (const footerPlacement of ["inside-frame", "in-frame", "below-frame"] as const) {
      const page = sheet({ footerPlacement, verticalPlacement: "justify" }, [
        series("a"),
        series("b"),
        series("c"),
      ]);
      const last = page.boxes[page.boxes.length - 1];
      assert.equal(last.yMm + last.heightMm, contentBottom(page), footerPlacement);

      const even = sheet({ footerPlacement, verticalPlacement: "center-justify" });
      const above = even.headings[0].yMm - 8 - even.content.yMm;
      const lastBox = even.boxes[even.boxes.length - 1];
      const below = contentBottom(even) - (lastBox.yMm + lastBox.heightMm);
      assert.ok(Math.abs(above - below) < 0.11, `${footerPlacement}: ${above} above, ${below} below`);
    }
  });

  it("no longer makes a smaller margin the way to print below the frame", () => {
    // The old workaround: a 3 mm margin put the footer under the frame and spread the content down
    // to 290 mm. Below the frame, a 10 mm margin keeps the content where the margin says.
    assert.equal(contentBottom(sheet({ footerPlacement: "below-frame" })), 287);
    assert.equal(contentBottom(sheet({ footerPlacement: "below-frame", marginBottomMm: 3 })), 294);
  });

  it("re-plans the sheets: the room a footer below the frame gives back can bring a block onto an earlier sheet", () => {
    // The content runs from 23 mm (under the 13 mm title) to the footer's head at 283: 260 mm. Six
    // heading-less checklists of a 37.5 mm box take 43.5 mm each, 261 in all — one too many. With
    // the footer below the frame the content runs to the 287 mm margin, and they fit.
    const six = Array.from({ length: 6 }, (_, i) => block(`b${i}`, "", [box(190, 37.5)]));
    const sheets = (over: Partial<AlbumRenderPreset>) =>
      live(planAlbumPages([chapter("y", "", six)], preset(over), "Polska", metrics).pages).map((p) =>
        p.blocks.map((b) => b.entryId)
      );
    assert.equal(sheets({}).length, 2);
    assert.equal(sheets({ footerPlacement: "below-frame" }).length, 1);
  });
});

describe("albumPlacedFooter (#1457)", () => {
  const band = { xMm: 10, yMm: 289.2, widthMm: 190, heightMm: 4 };

  it("renders the text into the band inside and below the frame", () => {
    for (const footerPlacement of ["inside-frame", "below-frame"] as const) {
      assert.deepEqual(albumPlacedFooter(preset({ footerPlacement }), band, "PL 1-19", metrics), {
        role: "footer",
        lines: ["PL 1-19"],
        ...band,
      });
    }
  });

  it("in the frame line, narrows the rectangle to the text and centres it on the sheet", () => {
    // Seven characters at 8 pt: 5.6 mm.
    const placed = albumPlacedFooter(preset({ footerPlacement: "in-frame" }), band, "PL 1-19", metrics);
    assert.deepEqual(placed, {
      role: "footer",
      lines: ["PL 1-19"],
      xMm: (210 - 5.6) / 2,
      yMm: 289.2,
      widthMm: 5.6,
      heightMm: 4,
    });
  });

  it("keeps the band on a sheet with no rule to set it into", () => {
    const placed = albumPlacedFooter(
      preset({ footerPlacement: "in-frame", borderStyle: "none" }),
      band,
      "PL 1-19",
      metrics
    );
    assert.equal(placed.widthMm, 190);
  });
});
