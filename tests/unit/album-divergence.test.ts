import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_DIVERGENCE_KINDS,
  albumPresetFieldLabel,
  compareAlbumPages,
  countNewlyDivergingSheets,
  diffAlbumPlans,
  pairAlbumPages,
  albumComparableFreeElements,
  type AlbumComparableBox,
  type AlbumComparableFreeElement,
  type AlbumComparablePage,
} from "../../src/lib/album-divergence";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { albumPlanFingerprint } from "../../src/lib/album-print-rules";

// The divergence report (#778): what a card in a binder no longer says.
//
// The shapes here are **constructed deliberately** rather than taken from a realistic page, because
// every bug this module's neighbours have shipped was a measurement against the wrong reference
// where the wrong reference is the common case (`docs/agents/albums.md`). The ones that matter here
// are a page that merely moved, a page whose name changed because its contents did, and a photo
// arriving after the fact — the last being the one that will be far more common than everything else
// put together.

const box = (stampId: string, over: Partial<AlbumComparableBox> = {}): AlbumComparableBox => ({
  stampId,
  widthMm: 30,
  heightMm: 29,
  label: stampId,
  stripId: "strip-29",
  stripHeightMm: 29,
  photoId: null,
  ...over,
});

const page = (
  range: string,
  boxes: AlbumComparableBox[],
  over: Partial<AlbumComparablePage> = {}
): AlbumComparablePage => ({
  range,
  title: "Polska",
  chapter: "1938",
  footer: range,
  language: "Polish (pl)",
  preset: DEFAULT_ALBUM_PRESET,
  placement: "top",
  blocks: [{ entryId: "e1", part: 1, heading: "Wystawa", boxes }],
  ...over,
});

const kinds = (found: { kind: string }[]) => found.map((d) => d.kind);

const textEl = (
  id: string,
  over: Partial<AlbumComparableFreeElement> = {}
): AlbumComparableFreeElement => ({
  id,
  kind: "text",
  xMm: 10,
  yMm: 40,
  widthMm: 190,
  text: "Wolne Miasto Gdańsk",
  setting: "chapter 24 center",
  pictureId: null,
  ...over,
});

const pictureEl = (
  id: string,
  over: Partial<AlbumComparableFreeElement> = {}
): AlbumComparableFreeElement => ({
  id,
  kind: "picture",
  xMm: 75,
  yMm: 80,
  widthMm: 60,
  text: "",
  setting: "",
  pictureId: "coat-of-arms",
  ...over,
});

/** A card of a page without stamps (#1429): no range, no blocks of stamps — its elements. */
const freePage = (elements: AlbumComparableFreeElement[]): AlbumComparablePage =>
  page("", [], {
    chapter: "",
    footer: "",
    blocks: [{ entryId: "fp", part: 1, kind: "page", heading: "", boxes: [] }],
    free: elements,
  });

describe("albumPlanFingerprint", () => {
  const sheet = (stampIds: string[]) => ({
    printedPageId: null,
    blocks: [{ entryId: "e1", part: 1, stampIds }],
  });

  it("changes when a sheet's stamps change, and not when nothing does", () => {
    assert.equal(albumPlanFingerprint([sheet(["a", "b"])]), albumPlanFingerprint([sheet(["a", "b"])]));
    assert.notEqual(
      albumPlanFingerprint([sheet(["a", "b"])]),
      albumPlanFingerprint([sheet(["a", "b", "c"])])
    );
  });

  it("changes when a sheet is inserted before the ones a position names", () => {
    const one = [sheet(["a"])];
    const two = [{ printedPageId: null, blocks: [{ entryId: "e0", part: 1, stampIds: ["z"] }] }, ...one];
    assert.notEqual(albumPlanFingerprint(one), albumPlanFingerprint(two));
  });

  it("does not change for anything that leaves the composition alone", () => {
    // A retyped heading, a corrected catalog number, a template colour: none of them changes which
    // card a position names, and a refusal the collector cannot account for is one they learn to
    // click through.
    assert.equal(albumPlanFingerprint([sheet(["a", "b"])]), albumPlanFingerprint([sheet(["a", "b"])]));
  });

  it("changes when two printed cards swap places", () => {
    const a = { printedPageId: "card-a", blocks: [] };
    const b = { printedPageId: "card-b", blocks: [] };
    assert.notEqual(albumPlanFingerprint([a, b]), albumPlanFingerprint([b, a]));
  });
});

describe("pairAlbumPages", () => {
  it("pairs by contents even when the name has changed, because the name is derived from them", () => {
    const printed = [page("PL 303-309", [box("a"), box("b")])];
    // The same card, one stamp richer: its range is different precisely *because* its contents are.
    const reference = [page("PL 303-310", [box("a"), box("b"), box("c")])];
    assert.deepEqual(pairAlbumPages(printed, reference), [{ printedIndex: 0, referenceIndex: 0 }]);
  });

  it("reports a page that merely moved as nothing at all", () => {
    const one = page("PL 1-1", [box("a")]);
    const two = page("PL 2-2", [box("b")]);
    const pairs = diffAlbumPlans([one, two], [two, one]);
    assert.deepEqual(
      pairs.map((p) => [p.printedIndex, p.referenceIndex]),
      [
        [0, 1],
        [1, 0],
      ]
    );
    assert.deepEqual(pairs.flatMap((p) => p.divergences), []);
  });

  it("pairs sheets carrying no stamps positionally, since nothing tells them apart", () => {
    const blank = (range: string) => page(range, [], { blocks: [] });
    assert.deepEqual(pairAlbumPages([blank("x"), blank("y")], [blank("p"), blank("q")]), [
      { printedIndex: 0, referenceIndex: 0 },
      { printedIndex: 1, referenceIndex: 1 },
    ]);
  });
});

describe("compareAlbumPages", () => {
  it("says a checklist has gained a stamp the card does not carry", () => {
    const found = compareAlbumPages(
      page("PL 303-304", [box("a"), box("b")]),
      page("PL 303-305", [box("a"), box("b"), box("c")], { footer: "PL 303-304" })
    );
    assert.deepEqual(kinds(found), ["stamps"]);
    assert.match(found[0].detail, /"Wystawa" has 1 stamp the card does not carry\./);
  });

  it("says a stamp on the card is no longer in the album", () => {
    const found = compareAlbumPages(
      page("PL 303-305", [box("a"), box("b"), box("c")]),
      page("PL 303-304", [box("a"), box("b")], { footer: "PL 303-305" })
    );
    assert.deepEqual(kinds(found), ["stamps"]);
    assert.match(found[0].detail, /1 stamp on "Wystawa" is no longer in the album\./);
  });

  it("says the same stamps would now be printed in a different order", () => {
    const found = compareAlbumPages(
      page("PL 1-2", [box("a"), box("b")]),
      page("PL 1-2", [box("b"), box("a")])
    );
    assert.deepEqual(kinds(found), ["stamps"]);
  });

  it("says a box would be cut to a different size, and separately from a different strip", () => {
    const resized = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a", { heightMm: 33, stripId: "strip-33", stripHeightMm: 33 })])
    );
    assert.deepEqual(kinds(resized), ["size"]);
    assert.match(resized[0].detail, /1 box would now be cut to a different size\./);

    // Same cut, a different drawer: the strip was renamed or replaced under it.
    const restripped = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a", { stripId: "strip-29b" })])
    );
    assert.deepEqual(kinds(restripped), ["size"]);
    assert.match(restripped[0].detail, /from a different strip/);
  });

  it("does not repeat a changed range as a footer divergence when the stamps are what changed", () => {
    // The footer names the sheet's own range, so a checklist that gained a stamp changes it by
    // arithmetic. Saying so beside "1 stamp the card does not carry" would double the report on the
    // most common divergence there is.
    const found = compareAlbumPages(
      page("PL 303-304", [box("a"), box("b")]),
      page("PL 303-305", [box("a"), box("b"), box("c")])
    );
    assert.deepEqual(kinds(found), ["stamps"]);
  });

  it("says what a heading, a footer and a label now read, beside what the card reads", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a", { label: "303" })]),
      page("PL 1-1", [box("a", { label: "303 I" })], {
        footer: "PL 1",
        blocks: [{ entryId: "e1", part: 1, heading: "Wystawa Warszawska", boxes: [box("a", { label: "303 I" })] }],
      })
    );
    assert.deepEqual(kinds(found), ["text", "text", "text"]);
    assert.match(found.map((d) => d.detail).join(" "), /The footer would now read "PL 1"; the card reads "PL 1-1"\./);
    assert.match(found.map((d) => d.detail).join(" "), /An issue heading would now read "Wystawa Warszawska"/);
    assert.match(found.map((d) => d.detail).join(" "), /1 box label reads differently now\./);
  });

  it("says what an issue heading now reads over a checklist printed within its issue (#1509)", () => {
    const within = (groupHeading: string) =>
      page("PL 1-1", [box("a")], {
        blocks: [{ entryId: "e1", part: 1, heading: "Watermark X", groupHeading, boxes: [box("a")] }],
      });
    const found = compareAlbumPages(within("1940, Issue"), within("1940, Issue renamed"));
    assert.deepEqual(kinds(found), ["text"]);
    assert.match(found[0].detail, /An issue heading would now read "1940, Issue renamed"; the card reads "1940, Issue"\./);
  });

  it("reads a card stored before #1509, which carries no issue heading, as matching one that prints none", () => {
    const stored = page("PL 1-1", [box("a")]);
    const now = page("PL 1-1", [box("a")], {
      blocks: [{ entryId: "e1", part: 1, heading: "Wystawa", groupHeading: "", boxes: [box("a")] }],
    });
    assert.deepEqual(compareAlbumPages(stored, now), []);
  });

  it("says a checklist now printed within its issue carries a heading the card does not", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a")], {
        blocks: [
          { entryId: "e1", part: 1, heading: "Watermark X", groupHeading: "1940, Issue", boxes: [box("a")] },
        ],
      })
    );
    const said = found.map((d) => d.detail).join(" ");
    assert.match(said, /A checklist heading would now read "Watermark X"; the card reads "Wystawa"\./);
    assert.match(said, /An issue heading would now read "1940, Issue"; the card carries none\./);
  });

  it("says the album is now printed in another language", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a")], { language: "German (de)" })
    );
    assert.deepEqual(kinds(found), ["text"]);
  });

  it("names the template values that have moved since the card was set", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a")], {
        preset: { ...DEFAULT_ALBUM_PRESET, marginTopMm: 12, headingSizePt: 11 },
      })
    );
    assert.deepEqual(kinds(found), ["template"]);
    assert.match(found[0].detail, /Heading size \(pt\), Margin top \(mm\) have changed/);
  });

  it("reports a frame's new corner ornament as a template change, by name (#1427)", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")], { preset: { ...DEFAULT_ALBUM_PRESET, frameOrnament: "none" } }),
      page("PL 1-1", [box("a")], { preset: { ...DEFAULT_ALBUM_PRESET, frameOrnament: "vine" } })
    );
    assert.deepEqual(kinds(found), ["template"]);
    assert.match(found[0].detail, /Frame ornament has changed/);
  });

  it("reports a card whose content would now be placed differently (#1419)", () => {
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a")], { placement: "center" })
    );
    assert.deepEqual(kinds(found), ["template"]);
    assert.match(found[0].detail, /would now be placed centred; the card's is at the top/);
  });

  it("compares the placement a card acted on, not the album's word for it (#1419)", () => {
    // The album moved to justify, but this card's own override — or its single series — keeps it at
    // the top: nothing on it would move, so nothing is reported.
    const found = compareAlbumPages(
      page("PL 1-1", [box("a")]),
      page("PL 1-1", [box("a")], {
        preset: { ...DEFAULT_ALBUM_PRESET, verticalPlacement: "justify" },
      })
    );
    assert.deepEqual(found, []);
  });

  it("ranks a picture that arrived after the fact below everything else", () => {
    // The case the ranking exists for: one bulk scanning session touches hundreds of stamps, and a
    // report that put those first would bury the renamed series and the stamp that has no slot.
    const found = compareAlbumPages(
      page("PL 1-2", [box("a"), box("b")]),
      page(
        "PL 1-3",
        [box("a", { photoId: "photo-1" }), box("b", { label: "2 gr" }), box("c", { photoId: "photo-2" })],
        { footer: "PL 1-2" }
      )
    );
    assert.deepEqual(kinds(found), ["stamps", "text", "photo"]);
    assert.match(found[2].detail, /1 stamp now has a picture the card prints an empty mount for\./);
  });

  it("says when a picture the card printed no longer exists, and when it has been replaced", () => {
    const found = compareAlbumPages(
      page("PL 1-2", [box("a", { photoId: "p1" }), box("b", { photoId: "p2" })]),
      page("PL 1-2", [box("a", { photoId: "p9" }), box("b")])
    );
    assert.deepEqual(kinds(found), ["photo", "photo"]);
  });

  it("finds nothing at all in a card that still matches", () => {
    assert.deepEqual(compareAlbumPages(page("PL 1-1", [box("a")]), page("PL 1-1", [box("a")])), []);
  });

  it("reports every kind in the order the report is read in", () => {
    // `page` is a free page's own kind (#1429), so the two sides carry one element that has moved.
    const found = compareAlbumPages(
      page("PL 1-2", [box("a"), box("b")], { free: [pictureEl("p", { xMm: 10 })] }),
      page("PL 1-3", [box("a", { heightMm: 33, photoId: "p1" }), box("b"), box("c")], {
        chapter: "1939",
        footer: "PL 1-2",
        preset: { ...DEFAULT_ALBUM_PRESET, blockGapMm: 9 },
        free: [pictureEl("p", { xMm: 12 })],
      })
    );
    assert.deepEqual(kinds(found), ALBUM_DIVERGENCE_KINDS.slice());
  });
});

describe("diffAlbumPlans", () => {
  it("reports content that would need a card these do not have", () => {
    // What a continuation page answers: the checklist has outgrown the sheet it is on.
    const printed = [page("PL 303-309", [box("a")])];
    const reference = [page("PL 303-309", [box("a")]), page("PL 310-311", [box("b")])];
    const pairs = diffAlbumPlans(printed, reference);
    assert.equal(pairs.length, 2);
    assert.deepEqual(pairs[0].divergences, []);
    assert.equal(pairs[1].printedIndex, null);
    assert.deepEqual(kinds(pairs[1].divergences), ["stamps"]);
    assert.match(pairs[1].divergences[0].detail, /nowhere to go/);
  });

  it("reports a card nothing in the album corresponds to any more", () => {
    const pairs = diffAlbumPlans([page("PL 303-309", [box("a")])], []);
    assert.deepEqual(kinds(pairs[0].divergences), ["stamps"]);
    assert.match(pairs[0].divergences[0].detail, /Nothing in the album corresponds to this card/);
  });
});

describe("albumPresetFieldLabel", () => {
  it("reads a preset key as a collector reads it, with its unit", () => {
    assert.equal(albumPresetFieldLabel("headingSpaceAboveMm"), "Heading space above (mm)");
    assert.equal(albumPresetFieldLabel("chapterSizePt"), "Chapter size (pt)");
    assert.equal(albumPresetFieldLabel("printTitle"), "Print title");
  });
});

// ── Before an album's own values are saved (#1215) ───────────────────────────
//
// The collector is told how many printed sheets a change will make diverge, and it was decided with
// them that **only sheets matching today count**: a sheet already out of date is not marked out of
// date for the first time by this change. The shapes that separate that rule from the obvious
// alternatives are a sheet already diverging that gains a second divergence, a sheet that would stop
// diverging, and a sheet awaiting a reprint.

describe("countNewlyDivergingSheets", () => {
  const template = { kind: "template" as const, detail: "The album's Box gap x (mm) has changed." };
  const photo = { kind: "photo" as const, detail: "1 stamp now has a picture." };
  const sheet = (id: string, divergences: { kind: "template" | "photo"; detail: string }[] = [], reprinting = false) => ({
    id,
    reprinting,
    divergences,
  });

  it("counts a sheet that matches today and would not afterwards", () => {
    assert.equal(countNewlyDivergingSheets([sheet("a"), sheet("b")], [sheet("a", [template]), sheet("b")]), 1);
  });

  it("does not count a sheet already out of date, even when the change adds to what it reports", () => {
    assert.equal(countNewlyDivergingSheets([sheet("a", [photo])], [sheet("a", [photo, template])]), 0);
  });

  it("does not count a sheet the change would bring back into line", () => {
    assert.equal(countNewlyDivergingSheets([sheet("a", [template])], [sheet("a")]), 0);
  });

  it("does not count a sheet awaiting a reprint — it is not the card the album compares", () => {
    assert.equal(
      countNewlyDivergingSheets([sheet("a", [], true)], [sheet("a", [template], true)]),
      0
    );
  });

  it("is zero when nothing changes", () => {
    const now = [sheet("a"), sheet("b", [photo])];
    assert.equal(countNewlyDivergingSheets(now, now), 0);
  });
});

describe("compareAlbumPages on a page without stamps (#1429)", () => {
  const title = [pictureEl("arms"), textEl("t1"), textEl("t2", { text: "Freie Stadt Danzig", yMm: 60 })];

  it("finds nothing on a card that still matches its page", () => {
    assert.deepEqual(compareAlbumPages(freePage(title), freePage(title)), []);
  });

  it("reports a moved element, because on a page he laid out himself a position is a fact", () => {
    // The contrast with every other sheet, where coordinates are consequences and never compared.
    const moved = title.map((el) => (el.id === "arms" ? { ...el, yMm: 70 } : el));
    const found = compareAlbumPages(freePage(title), freePage(moved));
    assert.deepEqual(kinds(found), ["page"]);
    assert.match(found[0].detail, /1 element has moved or changed size/);
  });

  it("reports a widened element the same way", () => {
    const wider = title.map((el) => (el.id === "t1" ? { ...el, widthMm: 150 } : el));
    assert.deepEqual(kinds(compareAlbumPages(freePage(title), freePage(wider))), ["page"]);
  });

  it("reports changed words as text, with both readings", () => {
    const retyped = title.map((el) => (el.id === "t2" ? { ...el, text: "Freie Stadt\nDanzig" } : el));
    const found = compareAlbumPages(freePage(title), freePage(retyped));
    assert.deepEqual(kinds(found), ["text"]);
    // A text that only broke differently must not read identically on both sides of the message.
    assert.match(found[0].detail, /would now read "Freie Stadt \/ Danzig"; the card reads "Freie Stadt Danzig"/);
  });

  it("reports a text set in another face, size or alignment as the page", () => {
    const restyled = title.map((el) => (el.id === "t1" ? { ...el, setting: "chapter 28 center" } : el));
    const found = compareAlbumPages(freePage(title), freePage(restyled));
    assert.deepEqual(kinds(found), ["page"]);
    assert.match(found[0].detail, /set in a different face, size or alignment/);
  });

  it("reports a replaced picture as the page, not as a stamp photo ranked last", () => {
    const replaced = title.map((el) => (el.id === "arms" ? { ...el, pictureId: "other" } : el));
    const found = compareAlbumPages(freePage(title), freePage(replaced));
    assert.deepEqual(kinds(found), ["page"]);
    assert.match(found[0].detail, /1 picture has been replaced/);
  });

  it("reports what was added and what was taken off, quoting a text's words", () => {
    const found = compareAlbumPages(
      freePage(title),
      freePage([textEl("t1"), textEl("t3", { text: "1920 – 1939" }), pictureEl("map", { pictureId: "map" })])
    );
    const details = found.map((d) => `${d.kind}: ${d.detail}`);
    assert.ok(details.includes('text: The page now has a text the card does not carry: "1920 – 1939".'));
    assert.ok(details.includes('text: The card carries a text the page no longer has: "Freie Stadt Danzig".'));
    assert.ok(details.includes("page: The page now has 1 picture the card does not carry."));
    assert.ok(details.includes("page: 1 picture on the card is no longer on the page."));
  });

  it("reports a change of drawing order only when nothing else explains it", () => {
    const reordered = [title[1], title[0], title[2]];
    const found = compareAlbumPages(freePage(title), freePage(reordered));
    assert.deepEqual(kinds(found), ["page"]);
    assert.match(found[0].detail, /drawn in a different order/);
  });

  it("reads a placed page the same way from a plan and from a card", () => {
    const placed = albumComparableFreeElements({
      id: "fp",
      elements: [
        {
          kind: "text",
          id: "t1",
          role: "chapter",
          sizePt: 24,
          align: "left",
          lines: ["Wolne Miasto", "Gdańsk"],
          xMm: 10,
          yMm: 40,
          widthMm: 100,
          heightMm: 20,
        },
        { kind: "picture", id: "arms", pictureId: "coat-of-arms", xMm: 75, yMm: 80, widthMm: 60, heightMm: 70 },
      ],
    });
    assert.deepEqual(placed, [
      textEl("t1", { text: "Wolne Miasto\nGdańsk", setting: "chapter 24 left", widthMm: 100 }),
      pictureEl("arms"),
    ]);
  });
});
