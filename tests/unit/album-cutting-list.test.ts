import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumCutDemand,
  albumCutSheets,
  albumSheetCuts,
  buildAlbumCuttingList,
  packStrips,
  type AlbumCutBoxSpec,
  type AlbumCutPlanPage,
  type AlbumCutSheetSpec,
  type AlbumCutSnapshot,
  type AlbumCutStrip,
} from "../../src/lib/album-cutting-list";
import {
  planAlbumPages,
  type AlbumChapterSpec,
  type AlbumPlannedPage,
  type AlbumTextMetrics,
} from "../../src/lib/album-layout";
import {
  DEFAULT_ALBUM_PRESET,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";
import { planHawidBox } from "../../src/lib/hawid";

// The cutting list (#770). Every case below is one the collector's own material almost never
// produces, which is exactly why they are constructed rather than waited for: this track has shipped
// five bugs across two families and every one of them needed an input that does not occur in
// ordinary collecting.

const strip = (heightMm: number, stockLengthMm = 210, label: string | null = null): AlbumCutStrip => ({
  heightMm,
  stockLengthMm,
  label,
});

const cutBox = (
  widthMm: number,
  from: AlbumCutStrip | null,
  over: Partial<AlbumCutBoxSpec> = {}
): AlbumCutBoxSpec => ({
  widthMm,
  heightMm: from ? from.heightMm : widthMm,
  strip: from,
  sizeSource: "stated",
  label: "",
  ...over,
});

const sheet = (
  boxes: AlbumCutBoxSpec[],
  over: Partial<AlbumCutSheetSpec> = {}
): AlbumCutSheetSpec => ({
  range: "PL 1-9",
  chapterKey: "1938",
  headings: [],
  printedPageId: null,
  printedAt: null,
  boxes,
  ...over,
});

describe("albumSheetCuts", () => {
  it("collapses identical cuts to a count, at the group's first appearance", () => {
    // Six 38 mm pieces off the 29 mm strip is one instruction and six cuts, which is how cutting is
    // actually done. Collapsing must not move a cut up or down the page, though: the pieces come off
    // the strip in the order they get stuck down.
    const s29 = strip(29);
    const s24 = strip(24);
    const list = albumSheetCuts(
      sheet([
        cutBox(38, s29),
        cutBox(30, s24),
        cutBox(38, s29),
        cutBox(30, s24),
        cutBox(38, s29),
      ])
    );
    assert.deepEqual(
      list.cuts.map((c) => [c.strip.heightMm, c.widthMm, c.count]),
      [
        [29, 38, 3],
        [24, 30, 2],
      ]
    );
    assert.equal(list.boxCount, 5);
  });

  it("counts slots, never stamps: one stamp on two checklists is two cuts", () => {
    // The fact this whole list turns on (ADR-0047 §2). A stamp can be on two checklists of one issue
    // — basic and specialized, perforated and imperforate — and an album gathers both from the same
    // area, so both land on one card as **two boxes**. #778's printed-page index was first keyed
    // `(page, stamp)` and refused to store such a sheet at all.
    //
    // Nothing in this module is keyed by a stamp, which is the structural answer; this pins the
    // consequence. A list that answered "one stamp, one hawid" would tell the collector to cut too
    // few and he would find out at the desk with the card already in front of him.
    const s29 = strip(29);
    const list = albumSheetCuts(sheet([cutBox(38, s29), cutBox(38, s29)]));
    assert.equal(list.cuts.length, 1);
    assert.equal(list.cuts[0].count, 2);
    assert.equal(list.boxCount, 2);
  });

  it("lists an oversize box apart, as taking no hawid at all", () => {
    const list = albumSheetCuts(
      sheet([
        cutBox(38, strip(29)),
        cutBox(86, null, { heightMm: 72, label: "PL 512" }),
      ])
    );
    assert.equal(list.cuts.length, 1);
    assert.deepEqual(list.uncut, [
      { reason: "oversize", widthMm: 86, heightMm: 72, label: "PL 512" },
    ]);
  });

  it("lists an unmeasured box apart even though the rule found it a strip", () => {
    // The sharp one. A stamp nothing on its checklist has measured gets a **degenerate** box — the
    // template's clearances and nothing else (`album-plan.ts`) — and a degenerate box is *small*, so
    // the rule finds it the shortest strip in the drawer. Read as an ordinary cut it would be a
    // perfectly plausible instruction to cut 2 mm off the 21 mm strip.
    //
    // Built through `planHawidBox` rather than by hand, so this is the box the app really produces.
    const stock = [
      { id: "a", heightMm: 21, totalHeightMm: 25, stockLengthMm: 210, label: null, sortOrder: 0 },
      { id: "b", heightMm: 29, totalHeightMm: 33, stockLengthMm: 210, label: null, sortOrder: 1 },
    ];
    const degenerate = planHawidBox(
      { widthMm: 0, heightMm: 0 },
      { verticalClearanceMm: 2, horizontalMarginMm: 2 },
      stock
    );
    assert.ok(degenerate.strip, "the rule really does find a degenerate box a strip");

    const list = albumSheetCuts(
      sheet([
        cutBox(degenerate.widthMm, degenerate.strip, {
          heightMm: degenerate.heightMm,
          sizeSource: null,
          label: "PL 77",
        }),
      ])
    );
    assert.deepEqual(list.cuts, []);
    assert.deepEqual(
      list.uncut.map((b) => [b.reason, b.label]),
      [["unmeasured", "PL 77"]]
    );
  });

  it("calls an unmeasured box unmeasured even when no strip fits it either", () => {
    // An empty stock makes **every** box oversize (#765), so an unmeasured stamp in a collection
    // that has not described its drawer is both at once. "Nothing states a size" is the fact worth
    // acting on; "no strip is tall enough" for a box that is two millimetres of clearance would be
    // actively misleading, so the order the two are tested in is a decision and not an accident.
    const list = albumSheetCuts(
      sheet([cutBox(2, null, { heightMm: 2, sizeSource: null, label: "PL 77" })])
    );
    assert.deepEqual(
      list.uncut.map((b) => b.reason),
      ["unmeasured"]
    );
  });

  it("keeps an inherited figure beside the cut rather than splitting the row", () => {
    // The cut is one cut however the figure was arrived at — but a collector cutting to a borrowed
    // number as if it had been measured is what #763 is arranged against, so it is said out loud.
    const s29 = strip(29);
    const list = albumSheetCuts(
      sheet([
        cutBox(38, s29),
        cutBox(38, s29, { sizeSource: "inherited" }),
      ])
    );
    assert.equal(list.cuts.length, 1);
    assert.equal(list.cuts[0].count, 2);
    assert.equal(list.cuts[0].inheritedCount, 1);
  });
});

describe("packStrips", () => {
  it("counts strips the pieces need, not the total width over the stock length", () => {
    // Four 120 mm pieces total 480 mm and `ceil(480 / 210)` is 3 — but a piece cannot span two
    // strips, so a 210 mm strip yields exactly one of them and four are needed. Under-counting is
    // the one direction a shopping list must never be wrong in.
    assert.equal(packStrips([120, 120, 120, 120], 210), 4);
    assert.equal(Math.ceil(480 / 210), 3);
  });

  it("fills a strip exactly rather than opening another for the last piece", () => {
    // Everything here is rounded to a tenth already, so a strict comparison on binary floats would
    // open a fresh strip for a piece that fits precisely.
    assert.equal(packStrips([70, 70, 70], 210), 1);
    assert.equal(packStrips([70.1, 70, 70], 210), 2);
  });

  it("packs widest first, so a big piece cannot be stranded by small ones", () => {
    // First-fit over the pieces as given would put 100 + 100 in the first strip and leave the 150 a
    // strip of its own: three strips. Decreasing order finds the two that exist.
    assert.equal(packStrips([100, 100, 150, 60], 210), 2);
  });

  it("gives a piece longer than the strip one of its own rather than looping", () => {
    // `hawid.ts` refuses a strip too short to cut the width from, so nothing live reaches this. A
    // snapshot carries a strip copied from a drawer that may since have been restocked shorter, and
    // an honest over-count beats a packer that never returns.
    assert.equal(packStrips([300], 210), 1);
    assert.equal(packStrips([300, 300], 210), 2);
  });

  it("counts nothing for nothing", () => {
    assert.equal(packStrips([], 210), 0);
  });
});

describe("albumCutDemand", () => {
  it("aggregates by strip, shortest first, over pieces rather than instructions", () => {
    const s29 = strip(29, 210, "Hawid 264");
    const s24 = strip(24);
    const demand = albumCutDemand([
      albumSheetCuts(sheet([cutBox(38, s29), cutBox(38, s29), cutBox(30, s24)])),
      albumSheetCuts(sheet([cutBox(50, s29)])),
    ]);
    assert.deepEqual(
      demand.byStrip.map((d) => [d.strip.heightMm, d.pieces, d.totalWidthMm, d.strips]),
      [
        [24, 1, 30, 1],
        // 38 + 38 + 50 = 126 mm, one 210 mm strip.
        [29, 3, 126, 1],
      ]
    );
    assert.equal(demand.byStrip[1].strip.label, "Hawid 264");
    assert.equal(demand.sheetCount, 2);
    assert.equal(demand.boxCount, 4);
  });

  it("keeps one height at two stock lengths as two things to buy", () => {
    // Live stock is unique on height per collection, so this only arises across a printed card whose
    // strip was **copied** into its snapshot (ADR-0047 §1) and a drawer since restocked at a
    // different length. They are two different things to buy however equal their heights.
    const demand = albumCutDemand([
      albumSheetCuts(sheet([cutBox(38, strip(29, 210))])),
      albumSheetCuts(sheet([cutBox(38, strip(29, 250))])),
    ]);
    assert.deepEqual(
      demand.byStrip.map((d) => [d.strip.heightMm, d.strip.stockLengthMm, d.pieces]),
      [
        [29, 210, 1],
        [29, 250, 1],
      ]
    );
  });

  it("flags a strip the drawer no longer holds instead of remapping it to a current one", () => {
    // A printed box's strip is **copied** into its snapshot (ADR-0047 §1), so a card can name a
    // 29 mm strip that has since been sold out or deleted. The row still says 29 mm — that is what
    // was cut, and nothing may reach backwards into a card already made — but a line the collector
    // cannot act on has to say so. Silently substituting today's nearest height would be the list
    // inventing a cut nobody made.
    const drawer = [strip(24), strip(40)];
    const demand = albumCutDemand(
      [albumSheetCuts(sheet([cutBox(38, strip(29, 210, "Hawid 264")), cutBox(30, strip(24))]))],
      drawer
    );
    assert.deepEqual(
      demand.byStrip.map((d) => [d.strip.heightMm, d.inStock]),
      [
        [24, true],
        [29, false],
      ]
    );
    // And it is still 29 mm, not remapped up to the 40 that would fit.
    assert.equal(demand.byStrip[1].strip.heightMm, 29);
    assert.equal(demand.byStrip[1].strip.label, "Hawid 264");
  });

  it("treats a height restocked at a different length as no longer the strip that was cut", () => {
    const demand = albumCutDemand(
      [albumSheetCuts(sheet([cutBox(38, strip(29, 210))]))],
      [strip(29, 250)]
    );
    assert.equal(demand.byStrip[0].inStock, false);
  });

  it("reads every row as in stock when the drawer was not supplied", () => {
    const demand = albumCutDemand([albumSheetCuts(sheet([cutBox(38, strip(29))]))]);
    assert.equal(demand.byStrip[0].inStock, true);
  });

  it("counts boxes that take no hawid, so a page of pockets does not read as nothing to do", () => {
    const demand = albumCutDemand([
      albumSheetCuts(sheet([cutBox(86, null, { heightMm: 72 }), cutBox(90, null, { heightMm: 70 })])),
    ]);
    assert.deepEqual(demand.byStrip, []);
    assert.equal(demand.boxCount, 2);
    assert.equal(demand.uncutCount, 2);
  });
});

describe("buildAlbumCuttingList and the cards already in the binder", () => {
  it("asks for nothing when every sheet of the album is on paper", () => {
    // One of the two inputs ADR-0047 §4 names, and the one this list can get wrong in the direction
    // that costs money: an album with every page printed has its hawid cut and stuck down, so a
    // shopping list totalling those cards would be the live surface re-emitting what a card in the
    // binder already accounts for — the second bug family this track has shipped, arriving through
    // this door.
    const s29 = strip(29);
    const list = buildAlbumCuttingList([
      sheet([cutBox(38, s29), cutBox(38, s29)], { printedPageId: "p1" }),
      sheet([cutBox(50, s29)], { printedPageId: "p2" }),
    ]);
    assert.deepEqual(list.toCut.byStrip, []);
    assert.equal(list.toCut.sheetCount, 0);
    assert.equal(list.toCut.boxCount, 0);

    // Reported, never added in — the cards are still described, because marking printed and mounting
    // are two moments.
    assert.equal(list.onPaper.sheetCount, 2);
    assert.equal(list.onPaper.boxCount, 3);
    assert.deepEqual(
      list.onPaper.byStrip.map((d) => [d.strip.heightMm, d.pieces, d.totalWidthMm]),
      [[29, 3, 126]]
    );

    // And every card still has its own cutting list: a reprint needs those cuts again.
    assert.deepEqual(
      list.sheets.map((s) => s.cuts.map((c) => c.count)),
      [[2], [1]]
    );
  });

  it("keeps the two demands apart rather than summing them", () => {
    const s29 = strip(29);
    const list = buildAlbumCuttingList([
      sheet([cutBox(38, s29)], { printedPageId: "p1" }),
      sheet([cutBox(38, s29)]),
    ]);
    assert.deepEqual(
      list.toCut.byStrip.map((d) => [d.pieces, d.strips]),
      [[1, 1]]
    );
    assert.deepEqual(
      list.onPaper.byStrip.map((d) => [d.pieces, d.strips]),
      [[1, 1]]
    );
  });
});

// ── Reading a real plan ──────────────────────────────────────────────────────

const metrics: AlbumTextMetrics = {
  measureMm: (text, _face, sizePt) => text.length * sizePt * 0.1,
  lineHeightMm: (_face, sizePt) => sizePt * 0.5,
};

const preset = (over: Partial<AlbumRenderPreset> = {}): AlbumRenderPreset => ({
  ...DEFAULT_ALBUM_PRESET,
  ...over,
});

const planBox = (widthMm: number, from: AlbumCutStrip | null, label = "") => ({
  widthMm,
  heightMm: from ? from.heightMm : 60,
  label,
  strip: from,
  sizeSource: "stated" as const,
});

const planBlock = (
  entryId: string,
  heading: string,
  boxes: ReturnType<typeof planBox>[],
  ...printedPageIds: string[]
) => ({
  entryId,
  heading,
  boxes,
  printedPageIds: printedPageIds.length ? printedPageIds : null,
});

const planChapter = (
  key: string,
  heading: string,
  blocks: ReturnType<typeof planBlock>[]
): AlbumChapterSpec<ReturnType<typeof planBox>> => ({ key, heading, blocks });

/** The plan's pages as the cutting list takes them — `AlbumPlanPage` without the footer, which this
 *  list does not read. Ranges are stand-ins; naming a page is `album-plan.ts`'s job. */
const asPages = (
  pages: AlbumPlannedPage<ReturnType<typeof planBox>>[]
): AlbumCutPlanPage[] => pages.map((layout, i) => ({ range: `PL ${i + 1}`, layout }));

/** A stored card, as `album-cutting.ts` adapts one. */
const storedCard = (
  range: string,
  boxes: ReturnType<typeof planBox>[]
): AlbumCutSnapshot => ({
  range,
  chapterKey: "1938",
  page: {
    kind: "live",
    chapterKey: "1938",
    title: null,
    chapter: null,
    headings: [],
    boxes: boxes.map((box) => ({
      box,
      entryId: "e",
      xMm: 0,
      yMm: 0,
      widthMm: box.widthMm,
      heightMm: box.heightMm,
      label: null,
    })),
    blocks: [],
    footer: null,
    content: { xMm: 10, yMm: 20, widthMm: 190, heightMm: 260 },
  },
});

describe("albumCutSheets over a planned album", () => {
  it("lists a printed card once when the entries were reordered after it was printed", () => {
    // The other input ADR-0047 §4 names. Reordering entries after printing separates a printed
    // sheet's blocks; #767 emitted that card twice, which listed, drew and reprinted one card twice.
    // The planner files it once now, and this list reads the plan's own sequence rather than
    // rebuilding one from the printed index — so the card is cut for once and counted once.
    const s29 = strip(29);
    const plan = planAlbumPages(
      [
        planChapter("1938", "1938", [
          planBlock("a", "", [], "printed-1"),
          planBlock("b", "", [planBox(40, s29)]),
          planBlock("c", "", [], "printed-1"),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    const snapshots = new Map([
      ["printed-1", storedCard("PL 303-309", [planBox(38, s29), planBox(38, s29)])],
    ]);

    const { sheets, unreadable } = albumCutSheets(asPages(plan.pages), snapshots);
    assert.deepEqual(unreadable, []);
    assert.deepEqual(
      sheets.map((s) => s.printedPageId),
      ["printed-1", null]
    );

    const list = buildAlbumCuttingList(sheets);
    // Two pieces off the card, once — not four.
    assert.deepEqual(
      list.onPaper.byStrip.map((d) => [d.pieces, d.totalWidthMm]),
      [[2, 76]]
    );
    assert.deepEqual(
      list.toCut.byStrip.map((d) => [d.pieces, d.totalWidthMm]),
      [[1, 40]]
    );
  });

  it("carries the moment a card went onto paper, including one it cannot read", () => {
    // The album records **printing, not mounting**, and the collector marks a sheet printed as it
    // comes off the printer and cuts for it afterwards. So the minute a card was printed is the only
    // thing separating the cards still waiting for their hawid from the ones glued in months ago,
    // and it has to reach the sheet even when the card's own contents cannot be read.
    const plan = planAlbumPages(
      [
        planChapter("1938", "1938", [
          planBlock("a", "", [], "printed-1"),
          planBlock("b", "", [], "printed-2"),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    const { sheets } = albumCutSheets(
      asPages(plan.pages),
      new Map([["printed-1", storedCard("PL 1-3", [planBox(38, strip(29))])]]),
      new Map([
        ["printed-1", "2026-09-05T09:12:00.000Z"],
        ["printed-2", "2026-08-14T17:40:00.000Z"],
      ])
    );
    assert.deepEqual(
      sheets.map((s) => s.printedAt),
      ["2026-09-05T09:12:00.000Z", "2026-08-14T17:40:00.000Z"]
    );
  });

  it("names a printed card whose contents cannot be read rather than inventing its cuts", () => {
    // Nothing may re-derive a printed card's boxes from live data (ADR-0047 §1). A card silently
    // listed as needing nothing is worse than one listed as unreadable, because only one of them
    // gets looked at.
    const plan = planAlbumPages(
      [planChapter("1938", "1938", [planBlock("a", "", [], "printed-1")])],
      preset(),
      "Album",
      metrics
    );
    const { sheets, unreadable } = albumCutSheets(asPages(plan.pages), new Map());
    assert.deepEqual(unreadable, ["PL 1"]);
    assert.deepEqual(sheets[0].boxes, []);
    assert.equal(buildAlbumCuttingList(sheets).onPaper.byStrip.length, 0);
  });

  it("names a printed card by what was stored on it, not by where it now sits", () => {
    const plan = planAlbumPages(
      [planChapter("1939", "1939", [planBlock("a", "", [], "printed-1")])],
      preset(),
      "Album",
      metrics
    );
    const { sheets } = albumCutSheets(
      asPages(plan.pages),
      new Map([["printed-1", storedCard("PL 303-309", [planBox(38, strip(29))])]])
    );
    assert.equal(sheets[0].range, "PL 303-309");
    assert.equal(sheets[0].chapterKey, "1938");
  });

  it("takes a live sheet's boxes in the order they are placed on the page", () => {
    const s29 = strip(29);
    const plan = planAlbumPages(
      [
        planChapter("1938", "1938", [
          planBlock("a", "One", [planBox(40, s29, "303"), planBox(50, s29, "304")]),
          planBlock("b", "Two", [planBox(60, s29, "305")]),
        ]),
      ],
      preset({ blocksPerBand: 1 }),
      "Album",
      metrics
    );
    const { sheets } = albumCutSheets(asPages(plan.pages), new Map());
    assert.equal(sheets.length, 1);
    assert.deepEqual(
      sheets[0].boxes.map((b) => b.label),
      ["303", "304", "305"]
    );
    assert.deepEqual(sheets[0].headings, ["One", "Two"]);
    assert.deepEqual(
      albumSheetCuts(sheets[0]).cuts.map((c) => [c.widthMm, c.count]),
      [
        [40, 1],
        [50, 1],
        [60, 1],
      ]
    );
  });

  it("carries every sheet of a checklist split across three cards", () => {
    const s29 = strip(29);
    const plan = planAlbumPages(
      [
        planChapter("1938", "1938", [
          planBlock("a", "", [], "printed-1", "printed-2", "printed-3"),
        ]),
      ],
      preset(),
      "Album",
      metrics
    );
    const { sheets } = albumCutSheets(
      asPages(plan.pages),
      new Map([
        ["printed-1", storedCard("PL 1-3", [planBox(38, s29)])],
        ["printed-2", storedCard("PL 4-6", [planBox(38, s29)])],
        ["printed-3", storedCard("PL 7-9", [planBox(38, s29)])],
      ])
    );
    assert.deepEqual(
      sheets.map((s) => s.range),
      ["PL 1-3", "PL 4-6", "PL 7-9"]
    );
    assert.equal(buildAlbumCuttingList(sheets).onPaper.byStrip[0].pieces, 3);
  });
});
