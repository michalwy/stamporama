import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAlbumPages,
  wrapAlbumFreeText,
  type AlbumBlockSpec,
  type AlbumBoxSpec,
  type AlbumChapterSpec,
  type AlbumFreeElementSpec,
  type AlbumFreePageSpec,
  type AlbumPlannedPage,
  type AlbumTextMetrics,
} from "../../src/lib/album-layout";
import {
  ALBUM_PICTURE_MIN_DPI,
  albumCentredXMm,
  albumCentredYMm,
  albumPictureAspect,
  albumPictureDpi,
  albumPictureTooCoarse,
  parseAlbumFreeMm,
  parseAlbumFreeSizePt,
} from "../../src/lib/album-free-page";
import { albumCutSheets, type AlbumCutBoxSpec } from "../../src/lib/album-cutting-list";
import {
  AlbumOrnamentSvgError,
  albumDrawingSvg,
  readOrnamentSvg,
} from "../../src/lib/album-ornament-svg";
import { DEFAULT_ALBUM_PRESET, type AlbumRenderPreset } from "../../src/lib/album-template-rules";

// Pages without stamps (#1429): a title page, a section divider — a sheet of its own inside the
// album's frame, with pictures and texts placed where the collector put them.
//
// The shapes are built to separate the rule from its look-alikes, as `album-layout.test.ts` does:
// a free page between two blocks that would otherwise share a sheet, one filed before a chapter's
// first checklist (where the year heading is waiting), one already on paper at the head of a chapter,
// and a keep-together that asks to cross one.

/** The layout suite's arithmetic stand-in: a character is a tenth of the size wide, a line half of
 *  it tall, so every expectation can be worked out on paper. */
const metrics: AlbumTextMetrics = {
  measureMm: (text, _face, sizePt) => text.length * sizePt * 0.1,
  lineHeightMm: (_face, sizePt) => sizePt * 0.5,
};

const preset = (over: Partial<AlbumRenderPreset> = {}): AlbumRenderPreset => ({
  ...DEFAULT_ALBUM_PRESET,
  ...over,
});

const box = (widthMm: number, heightMm: number): AlbumBoxSpec => ({ widthMm, heightMm, label: "" });

const block = (entryId: string, heading: string, boxes: AlbumBoxSpec[]): AlbumBlockSpec => ({
  entryId,
  heading,
  boxes,
  printedPageIds: null,
});

const free = (over: Partial<AlbumFreePageSpec> = {}): AlbumFreePageSpec => ({
  printTitle: false,
  printChapter: false,
  printFooter: false,
  chapterHeading: "1920",
  elements: [],
  ...over,
});

const freeBlock = (
  id: string,
  spec: AlbumFreePageSpec = free(),
  printedPageIds: string[] | null = null
): AlbumBlockSpec => ({ entryId: id, kind: "page", heading: "", boxes: [], printedPageIds, free: spec });

const chapter = (key: string, heading: string, blocks: AlbumBlockSpec[]): AlbumChapterSpec => ({
  key,
  heading,
  blocks,
});

type Live = Extract<AlbumPlannedPage, { kind: "live" }>;
const live = (pages: AlbumPlannedPage[]) => pages.filter((p): p is Live => p.kind === "live");
/** What each sheet is, in order: the free page's id, `printed:<id>`, or the entries on it. */
const shape = (pages: AlbumPlannedPage[]) =>
  pages.map((p) =>
    p.kind === "printed" ? `printed:${p.printedPageId}` : p.free ? `free:${p.free.id}` : p.blocks.map((b) => b.entryId).join("+")
  );

describe("a page without stamps in the plan", () => {
  it("is a sheet of its own, between two blocks that would otherwise share one", () => {
    const plan = planAlbumPages(
      [chapter("1920", "1920", [block("a", "One", [box(30, 30)]), freeBlock("P"), block("b", "Two", [box(30, 30)])])],
      preset(),
      "Danzig",
      metrics
    );
    assert.deepEqual(shape(plan.pages), ["a", "free:P", "b"]);
  });

  it("comes before the year's first sheet when filed before its first checklist, and leaves the year with it", () => {
    // The trap: closing the chapter's open page here would put the year heading alone on a card in
    // front of the free page. The year is still waiting for its first block, so it waits.
    const plan = planAlbumPages(
      [chapter("1920", "1920", [freeBlock("P"), block("a", "One", [box(30, 30)])])],
      preset(),
      "Danzig",
      metrics
    );
    assert.deepEqual(shape(plan.pages), ["free:P", "a"]);
    const [page, sheet] = live(plan.pages);
    assert.equal(page.chapter, null);
    assert.deepEqual(sheet.chapter?.lines, ["1920"]);
  });

  it("is stepped over on paper, and does not take the chapter's year away from its first stamp sheet", () => {
    // A printed free page at the head of a chapter is not the card that carries the year: it never
    // prints it instead of the chapter's first stamp sheet.
    const plan = planAlbumPages(
      [chapter("1920", "1920", [freeBlock("P", free(), ["card-P"]), block("a", "One", [box(30, 30)])])],
      preset(),
      "Danzig",
      metrics
    );
    assert.deepEqual(shape(plan.pages), ["printed:card-P", "a"]);
    assert.deepEqual(live(plan.pages)[0].chapter?.lines, ["1920"]);
  });

  it("files a printed free page once", () => {
    const plan = planAlbumPages(
      [chapter("", "", [freeBlock("P", free(), ["card-P"]), freeBlock("P", free(), ["card-P"])])],
      preset(),
      "Danzig",
      metrics
    );
    assert.deepEqual(shape(plan.pages), ["printed:card-P"]);
  });

  it("shares a band with nothing", () => {
    const plan = planAlbumPages(
      [chapter("", "", [block("a", "", [box(20, 20)]), freeBlock("P"), block("b", "", [box(20, 20)])])],
      preset({ blocksPerBand: 2 }),
      "Danzig",
      metrics
    );
    assert.deepEqual(shape(plan.pages), ["a", "free:P", "b"]);
  });

  it("cannot be kept together with, and says so on the block that asked", () => {
    const after: AlbumBlockSpec = { ...block("b", "Two", [box(30, 30)]), breakBefore: "avoid" };
    const plan = planAlbumPages([chapter("", "", [freeBlock("P"), after])], preset(), "Danzig", metrics);
    assert.deepEqual(shape(plan.pages), ["free:P", "b"]);
    assert.equal(live(plan.pages)[1].blocks[0].separated, true);
  });

  it("is one block of its own kind, with no boxes and no headings, placed at the top", () => {
    const [page] = live(planAlbumPages([chapter("", "", [freeBlock("P")])], preset(), "Danzig", metrics).pages);
    assert.deepEqual(page.blocks, [
      { entryId: "P", kind: "page", part: 1, heading: "", firstBoxIndex: 0, boxCount: 0 },
    ]);
    assert.deepEqual(page.boxes, []);
    assert.deepEqual(page.headings, []);
    assert.equal(page.placement, "top");
  });
});

describe("a page without stamps and its frame", () => {
  const p = preset({ printTitle: true, footerTemplate: "{pageRange}" });
  const sheet = (spec: AlbumFreePageSpec) =>
    live(planAlbumPages([chapter("1920", "1938", [freeBlock("P", spec)])], p, "Danzig", metrics).pages)[0];

  it("prints none of the three heads by default, and gives the content the whole space inside the margins", () => {
    const page = sheet(free());
    assert.equal(page.title, null);
    assert.equal(page.chapter, null);
    assert.equal(page.footer, null);
    assert.deepEqual(page.content, {
      xMm: p.marginLeftMm,
      yMm: p.marginTopMm,
      widthMm: p.pageWidthMm - p.marginLeftMm - p.marginRightMm,
      heightMm: p.pageHeightMm - p.marginTopMm - p.marginBottomMm,
    });
  });

  it("prints each head when switched on, where every other sheet prints it, and takes its room", () => {
    const page = sheet(free({ printTitle: true, printChapter: true, printFooter: true }));
    const stampSheet = live(
      planAlbumPages([chapter("1920", "1920", [block("a", "", [box(30, 30)])])], p, "Danzig", metrics).pages
    )[0];
    assert.deepEqual(page.title, stampSheet.title);
    assert.deepEqual(page.footer, stampSheet.footer);
    // The page's own statement of its chapter's heading, set where the chapter's first sheet sets it.
    assert.deepEqual(page.chapter?.lines, ["1920"]);
    assert.equal(page.chapter?.yMm, stampSheet.chapter?.yMm);
    assert.equal(page.content.yMm, stampSheet.content.yMm);
    assert.equal(page.content.yMm + page.content.heightMm, stampSheet.content.yMm + stampSheet.content.heightMm);
  });

  it("sets the album's name into the frame's line exactly as a stamp sheet does, when the album does (#1428)", () => {
    const inFrame = preset({ printTitle: true, titlePlacement: "in-frame", borderStyle: "double" });
    const [page] = live(
      planAlbumPages([chapter("1920", "1938", [freeBlock("P", free({ printTitle: true }))])], inFrame, "Danzig", metrics)
        .pages
    );
    const [stampSheet] = live(
      planAlbumPages([chapter("1920", "", [block("a", "", [box(30, 30)])])], inFrame, "Danzig", metrics).pages
    );
    assert.deepEqual(page.title, stampSheet.title);
    assert.equal(page.content.yMm, stampSheet.content.yMm);
  });

  it("prints no chapter heading for a chapter with a blank one, even when switched on", () => {
    assert.equal(sheet(free({ printChapter: true, chapterHeading: "" })).chapter, null);
  });
});

describe("a page without stamps and its elements", () => {
  const text = (over: Partial<Extract<AlbumFreeElementSpec, { kind: "text" }>> = {}): AlbumFreeElementSpec => ({
    kind: "text",
    id: "t",
    xMm: 10,
    yMm: 40,
    widthMm: 100,
    text: "Wolne Miasto Gdańsk",
    role: "chapter",
    sizePt: 20,
    align: "left",
    ...over,
  });
  const placed = (elements: AlbumFreeElementSpec[]) =>
    live(planAlbumPages([chapter("", "", [freeBlock("P", free({ elements }))])], preset(), "D", metrics).pages)[0]
      .free!.elements;

  it("places a text where it was put, wrapped to its width at its own size, as tall as its lines", () => {
    // 20 pt → 2 mm a character, 10 mm a line. "Wolne Miasto" is 24 mm; the whole is 38 mm.
    const [el] = placed([text({ widthMm: 30 })]);
    assert.equal(el.kind, "text");
    if (el.kind !== "text") return;
    assert.deepEqual(el.lines, ["Wolne Miasto", "Gdańsk"]);
    assert.deepEqual([el.xMm, el.yMm, el.widthMm, el.heightMm], [10, 40, 30, 20]);
    assert.equal(el.sizePt, 20);
    assert.equal(el.align, "left");
    assert.equal(el.role, "chapter");
  });

  it("keeps the collector's own line breaks, and a blank line between two", () => {
    const [el] = placed([text({ text: "Freie Stadt\n\nDanzig", widthMm: 200 })]);
    assert.ok(el.kind === "text");
    if (el.kind === "text") assert.deepEqual(el.lines, ["Freie Stadt", "", "Danzig"]);
  });

  it("gives a picture the height its proportions make at its width", () => {
    const [el] = placed([
      { kind: "picture", id: "arms", xMm: 75, yMm: 60, widthMm: 60, pictureId: "coat", aspect: 1.25 },
    ]);
    assert.deepEqual(el, { kind: "picture", id: "arms", pictureId: "coat", xMm: 75, yMm: 60, widthMm: 60, heightMm: 75 });
  });

  it("keeps the drawing order it was given", () => {
    const ids = placed([
      text({ id: "back" }),
      { kind: "picture", id: "middle", xMm: 0, yMm: 0, widthMm: 10, pictureId: "x", aspect: 1 },
      text({ id: "front" }),
    ]).map((el) => el.id);
    assert.deepEqual(ids, ["back", "middle", "front"]);
  });
});

describe("wrapAlbumFreeText", () => {
  it("reserves nothing for a text that is blank altogether", () => {
    assert.deepEqual(wrapAlbumFreeText(" \n ", 100, "f", 10, metrics), []);
  });
});

describe("the rules of a free page", () => {
  it("flags a raster that would print below 300 dpi at its placed width, and never a vector", () => {
    // 300 dpi across 100 mm is 1181.1 px.
    assert.equal(ALBUM_PICTURE_MIN_DPI, 300);
    assert.ok(Math.abs(albumPictureDpi(1181.1, 100) - 300) < 0.01);
    assert.equal(albumPictureTooCoarse(1182, 100), false);
    assert.equal(albumPictureTooCoarse(1180, 100), true);
    assert.equal(albumPictureTooCoarse(null, 100), false);
    // The same picture placed smaller prints sharper.
    assert.equal(albumPictureTooCoarse(1180, 90), false);
  });

  it("draws a picture whose proportions cannot be read square, rather than refusing the page", () => {
    assert.equal(albumPictureAspect({ width: 200, height: 300 }), 1.5);
    assert.equal(albumPictureAspect(null), 1);
    assert.equal(albumPictureAspect({ width: 0, height: 10 }), 1);
  });

  it("centres in the content area, to a tenth", () => {
    const area = { xMm: 10, yMm: 20, widthMm: 190, heightMm: 267 };
    assert.equal(albumCentredXMm(area, 60), 75);
    assert.equal(albumCentredYMm(area, 33.3), 136.9);
  });

  it("reads a position as typed, and refuses a blank one — a position is not a delta", () => {
    assert.deepEqual(parseAlbumFreeMm("12,5", "Across", -500, 1000), { ok: true, value: 12.5 });
    assert.deepEqual(parseAlbumFreeMm("-3", "Across", -500, 1000), { ok: true, value: -3 });
    assert.equal(parseAlbumFreeMm("", "Across", -500, 1000).ok, false);
    assert.equal(parseAlbumFreeMm("1.25", "Across", -500, 1000).ok, false);
    assert.equal(parseAlbumFreeMm("2000", "Across", -500, 1000).ok, false);
  });

  it("reads a size in points within the bounds", () => {
    assert.deepEqual(parseAlbumFreeSizePt("36"), { ok: true, value: 36 });
    assert.deepEqual(parseAlbumFreeSizePt("10,5"), { ok: true, value: 10.5 });
    assert.equal(parseAlbumFreeSizePt("2").ok, false);
    assert.equal(parseAlbumFreeSizePt("250").ok, false);
  });
});

describe("a picture's SVG", () => {
  it("says, in a phrase of its own, why the vector reader will not follow a file", () => {
    // A free page prints such a file as a picture instead (#1429), and says why in these words.
    const refused = (svg: string) => {
      try {
        readOrnamentSvg(svg);
      } catch (err) {
        assert.ok(err instanceof AlbumOrnamentSvgError);
        return err.reason;
      }
      assert.fail("expected a refusal");
    };
    assert.equal(
      refused('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="url(#g)"/></svg>'),
      "is painted with a gradient or a pattern"
    );
    assert.equal(
      refused('<svg viewBox="0 0 10 10"><text>Gdańsk</text></svg>'),
      "contains text"
    );
    assert.equal(
      refused('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#000" opacity="0.5"/></svg>'),
      "is partly transparent"
    );
    // A file that is not SVG at all has no such phrase: it is not a picture of any kind.
    assert.equal(refused("<html></html>"), undefined);
  });

  it("is written back from its outlines, carrying nothing of the file uploaded", () => {
    const drawing = readOrnamentSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" onload="alert(1)">' +
        '<script>alert(1)</script><rect id="evil" x="1" y="1" width="8" height="8" fill="#c00"/></svg>'
    );
    const svg = albumDrawingSvg(drawing);
    assert.doesNotMatch(svg, /script|onload|evil|alert/);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 20 10"/);
    assert.match(svg, /fill="#cc0000"|fill="#c00"/);
  });
});

describe("the cutting list and a page without stamps", () => {
  it("lists no sheet for a free page, live or printed — there is nothing to cut", () => {
    const cut: AlbumCutBoxSpec = { ...box(30, 30), strip: null, sizeSource: "stated" };
    const plan = planAlbumPages<AlbumCutBoxSpec>(
      [{ key: "", heading: "", blocks: [{ ...block("a", "One", []), boxes: [cut] }, { ...freeBlock("P"), boxes: [] }] }],
      preset(),
      "D",
      metrics
    );
    const freeSheet = plan.pages.find(
      (p): p is Extract<AlbumPlannedPage<AlbumCutBoxSpec>, { kind: "live" }> => p.kind === "live" && !!p.free
    )!;
    const { sheets } = albumCutSheets(
      [
        ...plan.pages.map((layout) => ({ range: "", layout })),
        { range: "", layout: { kind: "printed" as const, printedPageId: "card", chapterKey: "", entryIds: ["Q"] } },
      ],
      new Map([["card", { range: "", chapterKey: "", page: freeSheet }]])
    );
    assert.equal(sheets.length, 1);
  });
});
