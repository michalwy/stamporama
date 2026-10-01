import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { albumPlacedTextFace, planAlbumPages } from "../../src/lib/album-layout";
import { albumTextMetrics } from "../../src/lib/album-metrics";
import { planHawidBox } from "../../src/lib/hawid";
import {
  DEFAULT_ALBUM_PRESET,
  albumHawidMargins,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";
import {
  ALBUM_PREVIEW_ALBUM_NAME,
  ALBUM_PREVIEW_CHAPTERS,
  albumPreviewBoxes,
  albumPreviewChapters,
  albumPreviewEntries,
  albumPreviewStampId,
  albumPreviewStamps,
} from "../../src/lib/album-preview-sample";
import type { HawidStripData } from "../../src/lib/hawid-stock";

// The sample page an album template previews against (#795).
//
// **What is being tested is the sample, not the packer.** `album-layout.test.ts` owns the packing
// rules; every assertion here is of the form *does this sample still exercise the setting it was
// built to exercise*, because a sample that quietly stops doing so is a preview that quietly stops
// answering the question the collector opened the dialog to ask — and it looks exactly the same.
//
// It measures with the **shipped** measurer rather than the arithmetic stand-in the layout suite
// uses. That is the point of these cases: the claim "eight definitives fill a row and start a
// second" is a claim about real Liberation advances on a real A4 sheet, and a fake that made every
// character a tenth of the type size would prove it about a font nobody prints in. The stamps
// themselves are the collector's own, at the sizes he measured (`album-preview-sample.ts`).

/**
 * A representative drawer.
 *
 * Modelled on what hawid actually sells: a packet is named for the stamp it takes and is about 4 mm
 * taller than that, which is `heightMm` and `totalHeightMm` (#765, corrected by #793). Nothing here
 * is 78 mm tall, which is what makes the souvenir sheet a pocket.
 */
const stock: HawidStripData[] = [
  { id: "s21", heightMm: 21, totalHeightMm: 25, stockLengthMm: 210, label: null, sortOrder: 0 },
  { id: "s24", heightMm: 24, totalHeightMm: 28, stockLengthMm: 210, label: null, sortOrder: 1 },
  { id: "s26", heightMm: 26, totalHeightMm: 30, stockLengthMm: 210, label: null, sortOrder: 2 },
  { id: "s30", heightMm: 30, totalHeightMm: 34, stockLengthMm: 210, label: null, sortOrder: 3 },
  { id: "s33", heightMm: 33, totalHeightMm: 37, stockLengthMm: 210, label: null, sortOrder: 4 },
  { id: "s41", heightMm: 41, totalHeightMm: 45, stockLengthMm: 210, label: null, sortOrder: 5 },
  { id: "s49", heightMm: 49, totalHeightMm: 53, stockLengthMm: 210, label: null, sortOrder: 6 },
];

const preset = (over: Partial<AlbumRenderPreset> = {}): AlbumRenderPreset => ({
  ...DEFAULT_ALBUM_PRESET,
  ...over,
});

function allStampIds(): string[] {
  return albumPreviewEntries().flatMap((e) => e.stampIds);
}

/** The sheet a chapter of the sample starts on. */
function sheetOf(pages: ReturnType<typeof plan>["pages"], key: string) {
  const page = pages.find((p) => p.kind === "live" && p.chapterKey === key);
  if (!page || page.kind !== "live") return assert.fail(`no live sheet for ${key}`);
  return page;
}

function plan(over: Partial<AlbumRenderPreset> = {}) {
  const p = preset(over);
  return planAlbumPages(
    albumPreviewChapters(p, stock),
    p,
    ALBUM_PREVIEW_ALBUM_NAME,
    albumTextMetrics,
  );
}

/** The content width a block is measured against on the default A4 sheet. */
const CONTENT_WIDTH_MM =
  DEFAULT_ALBUM_PRESET.pageWidthMm -
  DEFAULT_ALBUM_PRESET.marginLeftMm -
  DEFAULT_ALBUM_PRESET.marginRightMm;

describe("the album template's sample page", () => {
  it("has no two stamps sharing a catalog number", () => {
    // A stamp is keyed by its number here, so two checklists reaching for one number is one box
    // rather than two — which is how an eight-stamp run once came out as seven and the souvenir
    // sheet landed inside somebody else's block.
    const numbers = albumPreviewEntries().flatMap((e) => e.stampIds);
    assert.equal(new Set(numbers).size, numbers.length);
    assert.equal(numbers.length, 21);
  });

  it("draws its boxes from the box rule and from nothing else", () => {
    // The whole preview rests on this: a box drawn from a second piece of arithmetic would let the
    // collector tune the template against a page the printer never produces (#765, #795).
    const p = preset();
    const stamps = albumPreviewStamps();
    for (const box of albumPreviewBoxes(p, stock, allStampIds())) {
      const stamp = stamps.get(box.stampId)!;
      const expected = planHawidBox(
        { widthMm: stamp.widthMm, heightMm: stamp.heightMm },
        albumHawidMargins(p),
        stock,
      );
      assert.equal(box.widthMm, expected.widthMm);
      assert.equal(box.heightMm, expected.heightMm);
      assert.equal(box.strip?.id ?? null, expected.strip?.id ?? null);
    }
  });

  it("selects several different strips, so the vertical clearance has something to move", () => {
    // A page of one mount size selects one strip and says nothing about the clearance: raise it and
    // either every box jumps or none does. Four sizes spread across the range is what makes the
    // field behave on screen the way it behaves on paper.
    const boxes = albumPreviewBoxes(preset(), stock, allStampIds());
    const strips = new Set(boxes.map((b) => b.strip?.id).filter((id): id is string => !!id));
    assert.equal(strips.size, 5, `${strips.size} strips selected, not five`);
  });

  it("contains exactly one piece no strip is tall enough for", () => {
    const boxes = albumPreviewBoxes(preset(), stock, allStampIds());
    const pockets = boxes.filter((b) => b.strip === null);
    assert.equal(pockets.length, 1);
    assert.equal(pockets[0].stampId, albumPreviewStampId("Blok 12"));
  });

  it("makes every box a pocket when the drawer is empty", () => {
    // Deliberate, and the dialog says so: a collection that has not described its stock should look
    // unplanned rather than silently take AlbumEasy's global 4 mm (#765).
    const boxes = albumPreviewBoxes(preset(), [], allStampIds());
    assert.ok(boxes.every((b) => b.strip === null));
  });

  it("states every size, so no box is drawn from a neighbour's figure", () => {
    // The inherited and unmeasured flags (#763) are facts about a collection's data, and a template
    // preview showing one would report a problem the collector cannot fix from this dialog.
    const boxes = albumPreviewBoxes(preset(), stock, allStampIds());
    assert.ok(boxes.every((b) => b.sizeSource === "stated"));
  });

  it("fills a row and starts a second", () => {
    const page = sheetOf(plan().pages, "1950");
    const bierut = page.blocks.find((b) => b.entryId === "sample-1950-bierut");
    assert.ok(bierut, "the eight-definitive block is not on the 1950 sheet");
    const boxes = page.boxes.filter((b) => b.entryId === "sample-1950-bierut");
    assert.equal(boxes.length, 8);
    assert.ok(
      new Set(boxes.map((b) => b.yMm)).size >= 2,
      "eight definitives fit one row, so the gap between rows shows nothing",
    );
  });

  it("puts two short checklists side by side at the default ceiling of two", () => {
    const page = sheetOf(plan().pages, "1950");
    const plan6 = page.boxes.filter((b) => b.entryId === "sample-1950-plan");
    const pokoj = page.boxes.filter((b) => b.entryId === "sample-1950-pokoj");
    assert.ok(plan6.length > 0 && pokoj.length > 0);
    const share = Math.max(...plan6.map((b) => b.xMm + b.widthMm));
    assert.ok(
      Math.min(...pokoj.map((b) => b.xMm)) > share,
      "the two short checklists are not sharing a band",
    );
  });

  it("stacks those same two the moment the ceiling is lowered to one", () => {
    // The other half of the claim above: a band that always pairs, or never does, tells the
    // collector nothing about the setting he just changed.
    const pages = plan({ blocksPerBand: 1 }).pages;
    const rowOf = (entryId: string) => {
      for (const page of pages) {
        if (page.kind !== "live") continue;
        const boxes = page.boxes.filter((b) => b.entryId === entryId);
        if (boxes.length > 0) return { page, top: Math.min(...boxes.map((b) => b.yMm)) };
      }
      return null;
    };
    const plan6 = rowOf("sample-1950-plan");
    const pokoj = rowOf("sample-1950-pokoj");
    assert.ok(plan6 && pokoj);
    assert.ok(
      plan6.page !== pokoj.page || pokoj.top > plan6.top,
      "the two blocks still share a band with the ceiling at one",
    );
  });

  it("is three sheets at the defaults, one per chapter, and the preview draws all three", () => {
    // A chapter heading, the running head, the footer and the space above a heading only show
    // themselves across a page boundary, and chapters are how the sample gets there without any
    // pagination being built for it (#795). The issue run is a chapter of its own (#1518), so a
    // fourth page would push one of them behind a preview that draws three.
    const pages = plan().pages;
    assert.equal(pages.length, 3);
    assert.deepEqual(
      pages.map((p) => (p.kind === "live" ? p.chapterKey : "printed")),
      ALBUM_PREVIEW_CHAPTERS.map((c) => c.key),
    );
  });

  it("prints the chapter heading, the running head and the footer on the sheet it plans", () => {
    const [first] = plan().pages;
    if (first.kind !== "live") return assert.fail("first sheet is not live");
    assert.ok(first.chapter, "no chapter heading");
    assert.deepEqual(first.chapter?.lines, ["1945"]);
    assert.ok(first.title, "no running head");
    assert.deepEqual(first.title?.lines, [ALBUM_PREVIEW_ALBUM_NAME]);
    assert.ok(first.footer, "no footer band");
  });

  it("labels its boxes with the bare catalog number the default template asks for", () => {
    const boxes = albumPreviewBoxes(preset(), stock, [albumPreviewStampId("519")]);
    assert.equal(boxes[0].label, "519");
    assert.equal(boxes[0].catalogNumber, "519");
  });

  it("prints nothing where a text template is blank", () => {
    // A blank album text is a real value (#766); the shared renderer's fallback to a generated
    // listing title must not reach a page.
    const boxes = albumPreviewBoxes(preset({ boxLabelTemplate: "" }), stock, [
      albumPreviewStampId("519"),
    ]);
    assert.equal(boxes[0].label, "");
    const chapters = albumPreviewChapters(preset({ chapterTemplate: "", checklistTemplate: "" }), stock);
    assert.ok(chapters.every((c) => c.heading === ""));
    const blocks = chapters.flatMap((c) => c.blocks);
    assert.ok(blocks.every((b) => (b.group?.heading ?? "") === ""), "an issue heading is printed");
    // A checklist heading under its issue is the checklist's name alone, as on a real album (#1509):
    // no template reaches it, so a blank one leaves it standing.
    assert.ok(blocks.every((b) => b.role === "subheading" || b.heading === ""));
  });

  it("carries a heading that wraps at the default type size", () => {
    // Where a heading breaks moves with the face and the size, and a sample of short headings would
    // never show it. This one is the collector's own — *III Światowy Festiwal Młodych Bojowników o
    // Pokój w Berlinie*, `PL-1951.txt` — and it breaks inside a shared band at 12 pt Liberation.
    const second = sheetOf(plan().pages, "1951");
    const wrapped = second.headings.filter((h) => h.lines.length > 1);
    assert.equal(wrapped.length, 1, "no heading on the 1951 sheet wraps");
    assert.ok(wrapped[0].lines[0].startsWith("1951, 5 VIII."));
  });

  it("never sets a heading wider than the content it was measured against", () => {
    for (const sizePt of [12, 18, 22]) {
      for (const page of plan({ headingSizePt: sizePt }).pages) {
        if (page.kind !== "live") continue;
        for (const heading of page.headings) {
          assert.ok(
            heading.widthMm <= CONTENT_WIDTH_MM + 0.05,
            `a heading at ${sizePt} pt is ${heading.widthMm} mm wide`,
          );
        }
      }
    }
  });
});

describe("the sample's issue printed as two checklists (#1518)", () => {
  // `PL-1945.txt:178`: the issue heading over Westerplatte, its two stamps directly under it, then the
  // imperforate under a checklist heading of its own — #1509's default for an issue with several
  // checklists, which the sample reaches through the rule rather than by stating it.
  const run = () => sheetOf(plan().pages, "1945");

  it("prints the issue heading once, the main checklist under it, then a checklist heading", () => {
    const page = run();
    assert.deepEqual(
      page.headings.map((h) => h.role),
      ["heading", "subheading"],
    );
    const [issue, checklist] = page.headings;
    assert.deepEqual(issue.lines, ["1945, 1 IX. 6. rocznica walk o Westerplatte"]);
    assert.ok(checklist.lines[0].startsWith("Nieząbkowany znaczek"));
    const main = page.boxes.filter((b) => b.entryId === "sample-1945-westerplatte");
    const imperf = page.boxes.filter((b) => b.entryId === "sample-1945-termopile");
    assert.equal(main.length, 2);
    assert.equal(imperf.length, 1);
    assert.ok(Math.min(...main.map((b) => b.yMm)) > issue.yMm, "the main checklist is under the issue heading");
    assert.ok(checklist.yMm > Math.max(...main.map((b) => b.yMm + b.heightMm)), "the checklist heading follows its boxes");
    assert.ok(imperf[0].yMm > checklist.yMm, "and the imperforate is under its own heading");
  });

  it("moves with every setting of either heading", () => {
    const at = (over: Partial<AlbumRenderPreset>) => {
      const page = sheetOf(plan(over).pages, "1945");
      const checklist = page.headings.find((h) => h.role === "subheading")!;
      const issue = page.headings.find((h) => h.role === "heading")!;
      return { issue, checklist, imperf: page.boxes.find((b) => b.entryId === "sample-1945-termopile")! };
    };
    const base = at({});
    const differs = (over: Partial<AlbumRenderPreset>, read: (s: ReturnType<typeof at>) => unknown) =>
      assert.notDeepEqual(read(at(over)), read(base), `${Object.keys(over).join(", ")} changes nothing`);
    differs({ subheadingSpaceAboveMm: 12 }, (s) => s.checklist.yMm);
    differs({ subheadingSpaceBelowMm: 9 }, (s) => s.imperf.yMm);
    differs({ subheadingSizePt: 14 }, (s) => s.checklist.heightMm);
    differs({ headingSpaceAboveMm: 14 }, (s) => s.issue.yMm);
    differs({ headingSpaceBelowMm: 11 }, (s) => s.checklist.yMm);
    differs({ headingSizePt: 16 }, (s) => s.issue.heightMm);
    // A face is drawn rather than placed: each heading is set in its own role's, so a face chosen for
    // one reaches its example and leaves the other alone.
    const faces = { headingFace: "liberation-serif-bold", subheadingFace: "liberation-sans-narrow-italic" };
    const set = at(faces);
    const p = preset(faces);
    assert.equal(albumPlacedTextFace(p, set.issue).face, faces.headingFace);
    assert.equal(albumPlacedTextFace(p, set.checklist).face, faces.subheadingFace);
  });
});
