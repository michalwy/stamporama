import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAlbumPages } from "../../src/lib/album-layout";
import { albumTextMetrics } from "../../src/lib/album-metrics";
import { albumFrame } from "../../src/lib/album-frame";
import {
  DEFAULT_ALBUM_PRESET,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";
import {
  ALBUM_PREVIEW_ALBUM_NAME,
  albumPreviewChapters,
} from "../../src/lib/album-preview-sample";
import {
  ALBUM_PRESET_SECTIONS,
  albumChangedSections,
  albumFieldMarks,
  asAlbumPresetField,
  asAlbumPresetSection,
  type AlbumFieldMark,
  type AlbumMarkSheet,
  type AlbumPresetField,
} from "../../src/lib/album-field-marks";
import type { HawidStripData } from "../../src/lib/hawid-stock";

// What each field of the Page template dialog marks on its preview (#1431).
//
// The marks are checked **against the plan itself**: the sample album is planned with the shipped
// packer and measurer, exactly as the preview plans it, and every distance is asserted to start or
// end on an edge the plan placed. A mark that is merely the right length somewhere near the thing
// would pass a length check and still point at the wrong gap — the failure this suite is for.

const stock: HawidStripData[] = [
  { id: "s21", heightMm: 21, totalHeightMm: 25, stockLengthMm: 210, label: null, sortOrder: 0 },
  { id: "s24", heightMm: 24, totalHeightMm: 28, stockLengthMm: 210, label: null, sortOrder: 1 },
  { id: "s26", heightMm: 26, totalHeightMm: 30, stockLengthMm: 210, label: null, sortOrder: 2 },
  { id: "s30", heightMm: 30, totalHeightMm: 34, stockLengthMm: 210, label: null, sortOrder: 3 },
  { id: "s33", heightMm: 33, totalHeightMm: 37, stockLengthMm: 210, label: null, sortOrder: 4 },
  { id: "s41", heightMm: 41, totalHeightMm: 45, stockLengthMm: 210, label: null, sortOrder: 5 },
  { id: "s49", heightMm: 49, totalHeightMm: 53, stockLengthMm: 210, label: null, sortOrder: 6 },
];

/** An ornament frame reaching out past the rule, as `Classic`'s rosette does. */
const ORNAMENT = { viewBox: { x: -2, y: -2, width: 20, height: 12 } };

function sheets(
  over: Partial<AlbumRenderPreset> = {},
  frameOrnament: AlbumMarkSheet["frameOrnament"] = null
): AlbumMarkSheet[] {
  const preset = { ...DEFAULT_ALBUM_PRESET, ...over };
  const plan = planAlbumPages(
    albumPreviewChapters(preset, stock),
    preset,
    ALBUM_PREVIEW_ALBUM_NAME,
    albumTextMetrics
  );
  return plan.pages.flatMap((page) =>
    page.kind === "live"
      ? [
          {
            preset,
            frameOrnament,
            content: page.content,
            title: page.title,
            chapter: page.chapter,
            headings: page.headings,
            footer: page.footer,
            boxes: page.boxes,
          },
        ]
      : []
  );
}

function only(marks: AlbumFieldMark[]): Extract<AlbumFieldMark, { kind: "distance" }> {
  assert.equal(marks.length, 1, `expected one mark, got ${marks.length}`);
  const [mark] = marks;
  assert.equal(mark.kind, "distance");
  return mark as Extract<AlbumFieldMark, { kind: "distance" }>;
}

const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 0.051, `${what}: ${actual} is not ${expected}`);

const bottom = (r: { yMm: number; heightMm: number }) => r.yMm + r.heightMm;
const right = (r: { xMm: number; widthMm: number }) => r.xMm + r.widthMm;

const ALL_FIELDS = Object.keys(DEFAULT_ALBUM_PRESET) as AlbumPresetField[];

describe("the Page template dialog's sections", () => {
  it("hold every preset value exactly once", () => {
    // A value a later issue adds and nobody places would be a field no section shows.
    const placed = ALBUM_PRESET_SECTIONS.flatMap((s) => [...s.fields] as string[]);
    assert.deepEqual([...placed].sort(), [...ALL_FIELDS].sort());
    assert.equal(new Set(placed).size, placed.length);
  });

  it("are the eight agreed with the collector, in order", () => {
    assert.deepEqual(
      ALBUM_PRESET_SECTIONS.map((s) => s.label),
      ["Page", "Frame", "Headings", "Boxes & spacing", "Hawid", "Type", "Photos", "Texts"]
    );
  });

  it("fall back to the first for a remembered key this build does not know", () => {
    assert.equal(asAlbumPresetSection("hawid"), "hawid");
    assert.equal(asAlbumPresetSection("spacing"), "page");
    assert.equal(asAlbumPresetSection(null), "page");
  });

  it("name only preset values as fields", () => {
    assert.equal(asAlbumPresetField("labelGapMm"), "labelGapMm");
    assert.equal(asAlbumPresetField("name"), null);
    assert.equal(asAlbumPresetField(""), null);
  });

  it("report a section changed only while a value in it differs from the one opened with", () => {
    const initial = { marginTopMm: "10", labelGapMm: "1", footerTemplate: "{pageRange}" };
    assert.deepEqual([...albumChangedSections(initial, initial)], []);
    assert.deepEqual(
      [...albumChangedSections(initial, { ...initial, labelGapMm: "1.5", footerTemplate: "" })].sort(),
      ["boxes", "texts"]
    );
    // Typed away and back is unchanged, which is what "not yet saved" means.
    assert.deepEqual([...albumChangedSections(initial, { ...initial, marginTopMm: "10" })], []);
    // The template's name is not in a section.
    assert.deepEqual([...albumChangedSections({ name: "A" }, { name: "B" })], []);
  });
});

describe("what a field marks on the preview", () => {
  it("draws every distance at the value's own length, on every sheet of the sample", () => {
    for (const over of [{}, { labelPosition: "above" as const }, { borderStyle: "double" as const }]) {
      for (const sheet of sheets(over, ORNAMENT)) {
        for (const field of ALL_FIELDS) {
          for (const mark of albumFieldMarks(field, sheet)) {
            if (mark.kind !== "distance") continue;
            near(mark.toMm - mark.fromMm, mark.valueMm, field);
            near(mark.valueMm, sheet.preset[field] as number, `${field} value`);
          }
        }
      }
    }
  });

  it("lays the margins from the sheet's edges", () => {
    const [sheet] = sheets({ marginTopMm: 12, marginRightMm: 9, marginBottomMm: 14, marginLeftMm: 8 });
    const top = only(albumFieldMarks("marginTopMm", sheet));
    assert.deepEqual([top.axis, top.fromMm, top.toMm], ["y", 0, 12]);
    const bottomMark = only(albumFieldMarks("marginBottomMm", sheet));
    assert.deepEqual([bottomMark.fromMm, bottomMark.toMm], [297 - 14, 297]);
    const left = only(albumFieldMarks("marginLeftMm", sheet));
    near(left.toMm, sheet.content.xMm, "left margin meets the content");
    const rightMark = only(albumFieldMarks("marginRightMm", sheet));
    near(rightMark.fromMm, right(sheet.content), "right margin meets the content");
  });

  it("spaces the title, the chapter and the first heading from the edges the plan placed", () => {
    const [sheet] = sheets({ blocksPerBand: 1 });
    assert.ok(sheet.title && sheet.chapter && sheet.headings.length);
    const above = only(albumFieldMarks("titleSpaceAboveMm", sheet));
    near(above.fromMm, sheet.preset.marginTopMm, "title's space starts on the margin");
    near(above.toMm, sheet.title.yMm, "and ends on the title");
    const below = only(albumFieldMarks("titleSpaceBelowMm", sheet));
    near(below.fromMm, bottom(sheet.title), "space below starts under the title");
    const chapterAbove = only(albumFieldMarks("chapterSpaceAboveMm", sheet));
    near(chapterAbove.fromMm, below.toMm, "the chapter's space starts where the title's ends");
    near(chapterAbove.toMm, sheet.chapter.yMm, "and ends on the chapter heading");
    const chapterBelow = only(albumFieldMarks("chapterSpaceBelowMm", sheet));
    near(chapterBelow.toMm, sheet.content.yMm, "the chapter's band ends where the content starts");
    const headingAbove = only(albumFieldMarks("headingSpaceAboveMm", sheet));
    near(headingAbove.fromMm, sheet.content.yMm, "a first heading's space starts on the content");
    near(headingAbove.toMm, sheet.headings[0].yMm, "and ends on the heading");
  });

  it("ends the space below a heading on its first row of mounts", () => {
    // One per band, so no band alignment (#779) sits between the heading and its row.
    const [sheet] = sheets({ blocksPerBand: 1 });
    const h = sheet.headings[0];
    const mark = only(albumFieldMarks("headingSpaceBelowMm", sheet));
    near(mark.fromMm, bottom(h), "starts under the heading");
    // The first row: the first block's mounts sharing the first mount's centre line.
    const [first] = sheet.boxes;
    const centre = first.yMm + first.heightMm / 2;
    const row = sheet.boxes.filter(
      (b) => b.entryId === first.entryId && Math.abs(b.yMm + b.heightMm / 2 - centre) < 0.051
    );
    near(mark.toMm, Math.min(...row.map((b) => b.yMm)), "ends on the first row's tallest mount");
  });

  it("lays the gap between boxes across from one mount's edge to the next", () => {
    const [sheet] = sheets({ boxGapXMm: 3 });
    const mark = only(albumFieldMarks("boxGapXMm", sheet));
    assert.equal(mark.axis, "x");
    const left = sheet.boxes.find((b) => Math.abs(right(b) - mark.fromMm) < 0.051);
    const next = sheet.boxes.find((b) => Math.abs(b.xMm - mark.toMm) < 0.051 && b.entryId === left?.entryId);
    assert.ok(left && next, "both ends touch a mount of the same checklist");
  });

  it("lays the gap between rows from the bottom of one row's labels to the next row's mounts", () => {
    for (const labelPosition of ["below", "above"] as const) {
      const found = sheets({ labelPosition })
        .map((sheet) => ({ sheet, marks: albumFieldMarks("boxGapYMm", sheet) }))
        .find((s) => s.marks.length);
      assert.ok(found, `a sheet of the sample has two rows of one checklist (${labelPosition})`);
      const mark = only(found.marks);
      // Something of the row above ends exactly where the gap starts, and nothing sits inside it.
      const ends = found.sheet.boxes.flatMap((b) => [bottom(b), ...(b.label ? [bottom(b.label)] : [])]);
      assert.ok(ends.some((e) => Math.abs(e - mark.fromMm) < 0.051), `row above ends at the gap (${labelPosition})`);
      const starts = found.sheet.boxes.flatMap((b) => [b.yMm, ...(b.label ? [b.label.yMm] : [])]);
      assert.ok(starts.some((s) => Math.abs(s - mark.toMm) < 0.051), `row below starts at the gap (${labelPosition})`);
    }
  });

  it("lays the gap between a box and its label from the mounts to the labels, either side", () => {
    const [below] = sheets({ labelGapMm: 2 });
    const down = only(albumFieldMarks("labelGapMm", below));
    assert.ok(below.boxes.some((b) => b.label && Math.abs(b.label.yMm - down.toMm) < 0.051), "ends on a label");
    assert.ok(below.boxes.some((b) => Math.abs(bottom(b) - down.fromMm) < 0.051), "starts under the tallest mount");

    const [above] = sheets({ labelGapMm: 2, labelPosition: "above" });
    const up = only(albumFieldMarks("labelGapMm", above));
    assert.ok(above.boxes.some((b) => b.label && Math.abs(bottom(b.label) - up.fromMm) < 0.051), "starts under a label");
    assert.ok(above.boxes.some((b) => Math.abs(b.yMm - up.toMm) < 0.051), "ends on the tallest mount");
  });

  it("marks the gap between two checklists only where two share a band", () => {
    const paired = sheets({ blockGapMm: 7 })
      .map((sheet) => ({ sheet, marks: albumFieldMarks("blockGapMm", sheet) }))
      .find((s) => s.marks.length);
    assert.ok(paired, "the sample pairs two short checklists");
    const mark = only(paired.marks);
    assert.ok(paired.sheet.headings.some((h) => Math.abs(right(h) - mark.fromMm) < 0.051), "from one column's edge");
    assert.ok(paired.sheet.headings.some((h) => Math.abs(h.xMm - mark.toMm) < 0.051), "to the next column");

    for (const sheet of sheets({ blocksPerBand: 1, blockGapMm: 7 })) {
      assert.deepEqual(albumFieldMarks("blockGapMm", sheet), []);
    }
  });

  it("marks the gap between double rules edge to edge, and nothing on a single rule", () => {
    const over = { borderStyle: "double" as const, borderWidthMm: 0.6, borderInsetMm: 5, borderGapMm: 1.2 };
    const [sheet] = sheets(over);
    const mark = only(albumFieldMarks("borderGapMm", sheet));
    const [outer, inner] = albumFrame(sheet.preset, null).rects;
    near(mark.fromMm, outer.xMm + over.borderWidthMm / 2, "starts on the outer rule's inside");
    near(mark.toMm, inner.xMm - over.borderWidthMm / 2, "ends on the inner rule's outside");

    const [single] = sheets({ ...over, borderStyle: "single" });
    assert.deepEqual(albumFieldMarks("borderGapMm", single), []);
  });

  it("outlines the ornaments where the frame places them, at all four corners", () => {
    const [sheet] = sheets({ frameOrnamentSizeMm: 15 }, ORNAMENT);
    const outlines = albumFieldMarks("frameOrnament", sheet).map((m) => (m.kind === "outline" ? m.rect : null));
    const frame = albumFrame(sheet.preset, { viewBox: ORNAMENT.viewBox, paths: [] });
    const vb = ORNAMENT.viewBox;
    const placed = frame.ornaments.map(({ matrix: [a, b, c, d, e, f] }) => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [x, y] of [
        [vb.x, vb.y],
        [vb.x + vb.width, vb.y + vb.height],
      ]) {
        xs.push(a * x + c * y + e);
        ys.push(b * x + d * y + f);
      }
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });
    assert.equal(outlines.length, 4);
    for (const p of placed) {
      assert.ok(
        outlines.some(
          (r) => r && Math.abs(r.xMm - p.x) < 1e-6 && Math.abs(r.yMm - p.y) < 1e-6 && Math.abs(r.widthMm - p.w) < 1e-6 && Math.abs(r.heightMm - p.h) < 1e-6
        ),
        `an outline covers the ornament at ${p.x}, ${p.y}`
      );
    }
    const size = albumFieldMarks("frameOrnamentSizeMm", sheet).find((m) => m.kind === "distance");
    assert.ok(size && size.kind === "distance" && size.axis === "x", "the longer side is across");
    assert.deepEqual(albumFieldMarks("frameOrnament", sheets({ frameOrnamentSizeMm: 15 })[0]), []);
  });

  it("spaces a title in the frame line from the rule, and has nothing above it", () => {
    const over = { borderStyle: "single" as const, titlePlacement: "in-frame" as const, titleFrameGapMm: 3 };
    const [sheet] = sheets(over);
    assert.ok(sheet.title);
    assert.deepEqual(albumFieldMarks("titleSpaceAboveMm", sheet), []);
    const gaps = albumFieldMarks("titleFrameGapMm", sheet);
    assert.equal(gaps.length, 2);
    const [left, rightGap] = gaps as Extract<AlbumFieldMark, { kind: "distance" }>[];
    near(left.toMm, sheet.title.xMm, "the left gap ends on the title");
    near(rightGap.fromMm, right(sheet.title), "the right gap starts after it");

    const [below] = sheets({ ...over, titlePlacement: "below-frame" });
    assert.deepEqual(albumFieldMarks("titleFrameGapMm", below), []);
  });

  it("outlines every text a face reaches, and nothing else", () => {
    const [sheet] = sheets();
    assert.equal(albumFieldMarks("headingFace", sheet).length, sheet.headings.length);
    assert.equal(albumFieldMarks("labelSizePt", sheet).length, sheet.boxes.filter((b) => b.label).length);
    assert.equal(albumFieldMarks("chapterTemplate", sheet).length, sheet.chapter ? 1 : 0);
    assert.equal(albumFieldMarks("footerFace", sheet).length, sheet.footer ? 1 : 0);
    assert.equal(albumFieldMarks("boxBorderStyle", sheet).length, sheet.boxes.length);
    const [untitled] = sheets({ printTitle: false });
    assert.deepEqual(albumFieldMarks("titleFace", untitled), []);
  });

  it("outlines each checklist's own part of the sheet for the band ceiling", () => {
    const [sheet] = sheets();
    const regions = albumFieldMarks("blocksPerBand", sheet);
    assert.equal(regions.length, sheet.headings.length);
    for (const box of sheet.boxes) {
      const x = box.xMm + box.widthMm / 2;
      const inside = regions.filter(
        (m) => m.kind === "outline" && x >= m.rect.xMm && x <= right(m.rect) && box.yMm >= m.rect.yMm && bottom(box) <= bottom(m.rect) + 1e-6
      );
      assert.equal(inside.length, 1, "every mount is in exactly one checklist's region");
    }
  });
});
