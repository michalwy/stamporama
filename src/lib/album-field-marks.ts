// The Page template dialog's sections, and what each of its fields marks on the preview (#1431).
//
// **Pure**, and a reading of geometry the plan already placed — never a second layout. The preview
// sheet is planned on the server by `album-layout.ts` and framed by `album-frame.ts`; every mark here
// starts on an edge one of those two put on the sheet, so what is marked is exactly what the value
// moves. A mark that worked out its own heading position would be the confident wrong answer #795
// warns about, drawn in a colour that says *this is the one*.
//
// ## Two kinds of mark
//
// A **distance** — a margin, a gap, a space above or below — is a dimension line of the value's own
// length, laid from the edge the value is measured from. It is drawn from the value rather than
// measured between two things, because on a sheet the vertical placement spreads (#1419) the gap
// between two headings is the value *plus* the spread, and a line claiming the value was the whole
// gap would be wrong on exactly the pages that are not full.
//
// An **element** — the frame, a kind of heading, the labels, the boxes — is outlined, every instance
// on the sheet, so a face chosen for the checklist headings is seen to reach all of them.
//
// A field whose value does nothing on this sheet marks nothing: the gap between double rules on a
// single rule, the space above a title set into the frame line, a pairing gap on a sheet where no two
// checklists share a band. Nothing is a truthful answer there; a line of the value's length laid
// somewhere plausible would not be.

import type { AlbumRect, AlbumTextRole } from "./album-layout";
import { albumFooterInFrame, albumFrameCentreMm, albumHasRule, albumTitleInFrame } from "./album-frame";
import type { AlbumRenderPreset } from "./album-template-rules";

export type AlbumPresetField = keyof AlbumRenderPreset;

/**
 * The dialog's sections, in the order the list on the left shows them — settled with the collector
 * on 2026-09-28. **Every preset value is in exactly one**, and the unit suite holds that: a value
 * added by a later issue that is not placed here fails the suite, rather than leaving the dialog to
 * grow back into one long page or to lose a field nobody can reach.
 */
export const ALBUM_PRESET_SECTIONS = [
  {
    key: "page",
    label: "Page",
    fields: [
      "pageWidthMm",
      "pageHeightMm",
      "marginTopMm",
      "marginRightMm",
      "marginBottomMm",
      "marginLeftMm",
      "verticalPlacement",
    ],
  },
  {
    key: "frame",
    label: "Frame",
    fields: [
      "borderStyle",
      "borderWidthMm",
      "borderInsetMm",
      "borderGapMm",
      "frameOrnament",
      "frameOrnamentSizeMm",
      "titlePlacement",
      "titleFrameGapMm",
      "footerPlacement",
      "footerOffsetMm",
      "footerFrameGapMm",
    ],
  },
  {
    key: "headings",
    label: "Headings",
    fields: [
      "printTitle",
      "titleSpaceAboveMm",
      "titleSpaceBelowMm",
      "chapterSpaceAboveMm",
      "chapterSpaceBelowMm",
      "headingSpaceAboveMm",
      "headingSpaceBelowMm",
      "subheadingSpaceAboveMm",
      "subheadingSpaceBelowMm",
    ],
  },
  {
    key: "boxes",
    label: "Boxes & spacing",
    fields: [
      "blocksPerBand",
      "blockGapMm",
      "boxGapXMm",
      "boxGapYMm",
      "labelPosition",
      "labelGapMm",
      "boxBorderStyle",
      "boxBorderWidthMm",
    ],
  },
  {
    key: "hawid",
    label: "Hawid",
    fields: ["verticalClearanceMm", "horizontalMarginMm"],
  },
  {
    key: "type",
    label: "Type",
    fields: [
      "titleFace",
      "titleSizePt",
      "chapterFace",
      "chapterSizePt",
      "headingFace",
      "headingSizePt",
      "subheadingFace",
      "subheadingSizePt",
      "labelFace",
      "labelSizePt",
      "footerFace",
      "footerSizePt",
    ],
  },
  {
    key: "photos",
    label: "Photos",
    fields: ["printPhotos", "photoOpacityPercent"],
  },
  {
    key: "texts",
    label: "Texts",
    fields: ["chapterTemplate", "checklistTemplate", "boxLabelTemplate", "footerTemplate"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  fields: readonly AlbumPresetField[];
}[];

export type AlbumPresetSection = (typeof ALBUM_PRESET_SECTIONS)[number]["key"];

export const DEFAULT_ALBUM_PRESET_SECTION: AlbumPresetSection = "page";

/** A stored section key, or the first section for anything this build does not know — a key kept
 *  in the browser outlives a rename. */
export function asAlbumPresetSection(raw: string | null): AlbumPresetSection {
  return ALBUM_PRESET_SECTIONS.find((s) => s.key === raw)?.key ?? DEFAULT_ALBUM_PRESET_SECTION;
}

/** A field name read off the form, or null for one that is not a preset value — the template's own
 *  name, a builder's search box. */
export function asAlbumPresetField(raw: string | null | undefined): AlbumPresetField | null {
  if (!raw) return null;
  for (const section of ALBUM_PRESET_SECTIONS) {
    const found = (section.fields as readonly AlbumPresetField[]).find((f) => f === raw);
    if (found) return found;
  }
  return null;
}

/** The section a field is in, or null for a name the sections do not hold. */
export function albumPresetSectionOf(field: string): AlbumPresetSection | null {
  for (const section of ALBUM_PRESET_SECTIONS) {
    if ((section.fields as readonly string[]).includes(field)) return section.key;
  }
  return null;
}

/**
 * The sections holding a value that differs from the one the dialog opened with.
 *
 * Both sides are the form's own raw strings (`readAlbumPresetFields`), so a field is changed exactly
 * when what a save would send is — no parse, no second copy of the preset. A value typed away and
 * typed back is unchanged again, which is what *not yet saved* means.
 */
export function albumChangedSections(
  initial: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>
): Set<AlbumPresetSection> {
  const changed = new Set<AlbumPresetSection>();
  for (const [field, value] of Object.entries(current)) {
    if (initial[field] === value) continue;
    const section = albumPresetSectionOf(field);
    if (section) changed.add(section);
  }
  return changed;
}

/** A dimension line of the value's own length along `axis`, from `fromMm` to `toMm`, drawn at
 *  `atMm` on the other axis — or an outline round a placed rectangle. Sheet millimetres, top-left
 *  origin, as `AlbumRect`. */
export type AlbumFieldMark =
  | { kind: "distance"; axis: "x" | "y"; fromMm: number; toMm: number; atMm: number; valueMm: number }
  | { kind: "outline"; rect: AlbumRect };

interface MarkText extends AlbumRect {
  role: AlbumTextRole;
}

/**
 * What a mark reads off a sheet: the preset it was set in and what the plan placed. `AlbumEditorSheet`
 * — the preview's own sheet — is one, and so is a planned page with its preset beside it, which is how
 * the unit suite checks the marks against the plan itself.
 */
export interface AlbumMarkSheet {
  preset: AlbumRenderPreset;
  frameOrnament: { viewBox: { x: number; y: number; width: number; height: number } } | null;
  content: AlbumRect;
  title: MarkText | null;
  chapter: MarkText | null;
  headings: readonly MarkText[];
  footer: AlbumRect | null;
  boxes: readonly (AlbumRect & { entryId: string; label: MarkText | null })[];
}

type MarkBox = AlbumMarkSheet["boxes"][number];

/** Below a tenth of a millimetre, the rounding every placement goes through (`hawid.ts`). */
const SAME_MM = 0.05;

function distance(
  axis: "x" | "y",
  fromMm: number,
  valueMm: number,
  atMm: number
): AlbumFieldMark {
  return { kind: "distance", axis, fromMm, toMm: fromMm + valueMm, atMm, valueMm };
}

function outline(rect: AlbumRect): AlbumFieldMark {
  return { kind: "outline", rect };
}

const bottom = (r: AlbumRect) => r.yMm + r.heightMm;
const right = (r: AlbumRect) => r.xMm + r.widthMm;
const middleX = (r: AlbumRect) => r.xMm + r.widthMm / 2;
const middleY = (r: AlbumRect) => r.yMm + r.heightMm / 2;

/** The boxes in rows, in the order they were placed: a row is a run of one block's boxes sharing a
 *  centre line, which is how the plan sets them (`ROW_ALIGN_MIDDLE`). */
function boxRows(sheet: AlbumMarkSheet): MarkBox[][] {
  const rows: MarkBox[][] = [];
  for (const box of sheet.boxes) {
    const row = rows[rows.length - 1];
    const last = row?.[row.length - 1];
    if (last && last.entryId === box.entryId && Math.abs(middleY(last) - middleY(box)) < SAME_MM) {
      row.push(box);
    } else {
      rows.push([box]);
    }
  }
  return rows;
}

/** Where a row starts: its first label when labels are set above, else its tallest mount — the one
 *  the others are centred against. */
function rowTopMm(row: MarkBox[], labelsAbove: boolean): number {
  return Math.min(...row.map((b) => (labelsAbove && b.label ? b.label.yMm : b.yMm)));
}

/** Every text of a role on the sheet. The footer is a band rather than a text, and is its role. */
function textsOf(sheet: AlbumMarkSheet, role: AlbumTextRole): AlbumRect[] {
  const texts: AlbumRect[] = [];
  if (sheet.title?.role === role) texts.push(sheet.title);
  if (sheet.chapter?.role === role) texts.push(sheet.chapter);
  texts.push(...sheet.headings.filter((h) => h.role === role));
  for (const box of sheet.boxes) if (box.label?.role === role) texts.push(box.label);
  if (role === "footer" && sheet.footer) texts.push(sheet.footer);
  return texts;
}

/** Each heading with the part of the sheet its block took: its own column, down to the last box
 *  under it before the next heading in that column. The unit a band holds one, two or more of. */
function blockRegions(sheet: AlbumMarkSheet): AlbumRect[] {
  return sheet.headings.map((h) => {
    const next = sheet.headings
      .filter((o) => o !== h && o.yMm > h.yMm + SAME_MM && o.xMm < right(h) && right(o) > h.xMm)
      .reduce((min, o) => Math.min(min, o.yMm), Infinity);
    let lowest = bottom(h);
    for (const box of sheet.boxes) {
      const x = middleX(box);
      if (x < h.xMm || x > right(h) || box.yMm < h.yMm || box.yMm >= next) continue;
      lowest = Math.max(lowest, bottom(box), box.label ? bottom(box.label) : 0);
    }
    return { xMm: h.xMm, yMm: h.yMm, widthMm: h.widthMm, heightMm: lowest - h.yMm };
  });
}

/** The ornament at each corner, as the rectangle its frame (`viewBox`) covers — `album-frame.ts`'s
 *  placement: laid on the frame's centre line, scaled so the longer side is the ornament size, and
 *  mirrored at the three corners after the first. */
function ornamentRects(sheet: AlbumMarkSheet): AlbumRect[] {
  const { preset, frameOrnament } = sheet;
  if (!frameOrnament || !(preset.frameOrnamentSizeMm > 0)) return [];
  const vb = frameOrnament.viewBox;
  const s = preset.frameOrnamentSizeMm / Math.max(vb.width, vb.height);
  const c = albumFrameCentreMm(preset);
  const w = s * vb.width;
  const h = s * vb.height;
  const near = { x: c + s * vb.x, y: c + s * vb.y };
  const farX = preset.pageWidthMm - c - s * (vb.x + vb.width);
  const farY = preset.pageHeightMm - c - s * (vb.y + vb.height);
  return [
    { xMm: near.x, yMm: near.y, widthMm: w, heightMm: h },
    { xMm: farX, yMm: near.y, widthMm: w, heightMm: h },
    { xMm: near.x, yMm: farY, widthMm: w, heightMm: h },
    { xMm: farX, yMm: farY, widthMm: w, heightMm: h },
  ];
}

/** Whether the sheet prints a rule, which is what an outline of "the frame" is round. */
function hasRule(preset: AlbumRenderPreset): boolean {
  return preset.borderStyle !== "none" && preset.borderWidthMm > 0;
}

/** The frame's outer edge: the outer rule's own outside, or the inset line where ornaments stand
 *  alone. */
function frameRect(preset: AlbumRenderPreset): AlbumRect {
  const edge = preset.borderInsetMm - (hasRule(preset) ? preset.borderWidthMm / 2 : 0);
  return {
    xMm: edge,
    yMm: edge,
    widthMm: preset.pageWidthMm - 2 * edge,
    heightMm: preset.pageHeightMm - 2 * edge,
  };
}

/**
 * What the field in hand marks on this sheet. Empty where the value does nothing here — see the
 * module header.
 */
export function albumFieldMarks(field: AlbumPresetField, sheet: AlbumMarkSheet): AlbumFieldMark[] {
  const p = sheet.preset;
  const W = p.pageWidthMm;
  const H = p.pageHeightMm;
  const labelsAbove = p.labelPosition === "above";
  const boxes = () => sheet.boxes.map(outline);
  const labels = () => textsOf(sheet, "label").map(outline);
  const titleOutline = () => (sheet.title ? [outline(sheet.title)] : []);
  const chapterOutline = () => (sheet.chapter ? [outline(sheet.chapter)] : []);
  const headingOutlines = () => textsOf(sheet, "heading").map(outline);
  const subheadings = textsOf(sheet, "subheading");
  const footerOutline = () => (sheet.footer ? [outline(sheet.footer)] : []);
  const titleInFrame = albumTitleInFrame(p);

  switch (field) {
    // ── Page ──
    case "pageWidthMm":
      return [distance("x", 0, W, H / 2)];
    case "pageHeightMm":
      return [distance("y", 0, H, W / 2)];
    case "marginTopMm":
      return [distance("y", 0, p.marginTopMm, W / 4)];
    case "marginBottomMm":
      return [distance("y", H - p.marginBottomMm, p.marginBottomMm, W / 4)];
    case "marginLeftMm":
      return [distance("x", 0, p.marginLeftMm, H / 2)];
    case "marginRightMm":
      return [distance("x", W - p.marginRightMm, p.marginRightMm, H / 2)];
    case "verticalPlacement":
      return [outline(sheet.content)];

    // ── Frame ──
    case "borderStyle":
    case "borderWidthMm":
      return hasRule(p) ? [outline(frameRect(p))] : [];
    case "borderInsetMm":
      return hasRule(p) || ornamentRects(sheet).length
        ? [distance("x", 0, p.borderInsetMm, H / 2)]
        : [];
    case "borderGapMm":
      return p.borderStyle === "double" && p.borderWidthMm > 0
        ? [distance("x", p.borderInsetMm + p.borderWidthMm / 2, p.borderGapMm, H / 2)]
        : [];
    case "frameOrnament":
      return ornamentRects(sheet).map(outline);
    case "frameOrnamentSizeMm": {
      const rects = ornamentRects(sheet);
      if (!rects.length) return [];
      const first = rects[0];
      const across =
        first.widthMm >= first.heightMm
          ? distance("x", first.xMm, p.frameOrnamentSizeMm, bottom(first) + 2)
          : distance("y", first.yMm, p.frameOrnamentSizeMm, right(first) + 2);
      return [...rects.map(outline), across];
    }
    case "titlePlacement":
      return titleOutline();
    case "titleFrameGapMm":
      if (!sheet.title || !titleInFrame) return [];
      return [
        distance("x", sheet.title.xMm - p.titleFrameGapMm, p.titleFrameGapMm, middleY(sheet.title)),
        distance("x", right(sheet.title), p.titleFrameGapMm, middleY(sheet.title)),
      ];
    case "footerPlacement":
      return footerOutline();
    case "footerOffsetMm": {
      // Up from the rule's inside to the footer's foot, or down from its outside to the footer's
      // head (#1457). In the frame line, and on a sheet with no rule, it places nothing.
      const footer = sheet.footer;
      if (!footer || !albumHasRule(p)) return [];
      if (p.footerPlacement === "inside-frame") {
        return [distance("y", bottom(footer), p.footerOffsetMm, middleX(footer))];
      }
      if (p.footerPlacement === "below-frame") {
        return [distance("y", footer.yMm - p.footerOffsetMm, p.footerOffsetMm, middleX(footer))];
      }
      return [];
    }
    case "footerFrameGapMm":
      if (!sheet.footer || !albumFooterInFrame(p)) return [];
      return [
        distance("x", sheet.footer.xMm - p.footerFrameGapMm, p.footerFrameGapMm, middleY(sheet.footer)),
        distance("x", right(sheet.footer), p.footerFrameGapMm, middleY(sheet.footer)),
      ];

    // ── Headings ──
    case "printTitle":
      return titleOutline();
    case "titleSpaceAboveMm":
      // Set into the frame line, the title has nothing above it to be spaced from.
      if (!sheet.title || titleInFrame) return [];
      return [
        distance("y", sheet.title.yMm - p.titleSpaceAboveMm, p.titleSpaceAboveMm, middleX(sheet.title)),
      ];
    case "titleSpaceBelowMm":
      if (!sheet.title) return [];
      return [distance("y", bottom(sheet.title), p.titleSpaceBelowMm, middleX(sheet.title))];
    case "chapterSpaceAboveMm":
      if (!sheet.chapter) return [];
      return [
        distance(
          "y",
          sheet.chapter.yMm - p.chapterSpaceAboveMm,
          p.chapterSpaceAboveMm,
          middleX(sheet.chapter)
        ),
      ];
    case "chapterSpaceBelowMm":
      if (!sheet.chapter) return [];
      return [distance("y", bottom(sheet.chapter), p.chapterSpaceBelowMm, middleX(sheet.chapter))];
    case "headingSpaceAboveMm": {
      const h = textsOf(sheet, "heading")[0];
      if (!h) return [];
      return [distance("y", h.yMm - p.headingSpaceAboveMm, p.headingSpaceAboveMm, middleX(h))];
    }
    case "headingSpaceBelowMm": {
      const h = textsOf(sheet, "heading")[0];
      if (!h) return [];
      return [distance("y", bottom(h), p.headingSpaceBelowMm, middleX(h))];
    }
    case "subheadingSpaceAboveMm": {
      // Read only where a sub-heading follows boxes (#1509); directly under its issue's heading the
      // heading's own space below is what separates them, and this value places nothing there.
      const h = subheadings.find((s) =>
        sheet.boxes.some(
          (b) => bottom(b) <= s.yMm + SAME_MM && b.xMm < right(s) && right(b) > s.xMm
        )
      );
      if (!h) return [];
      return [distance("y", h.yMm - p.subheadingSpaceAboveMm, p.subheadingSpaceAboveMm, middleX(h))];
    }
    case "subheadingSpaceBelowMm": {
      const h = subheadings[0];
      if (!h) return [];
      return [distance("y", bottom(h), p.subheadingSpaceBelowMm, middleX(h))];
    }

    // ── Boxes & spacing ──
    case "blocksPerBand":
      return blockRegions(sheet).map(outline);
    case "blockGapMm": {
      // Two headings side by side on one line are two checklists sharing a band.
      for (const a of sheet.headings) {
        const b = sheet.headings.find(
          (o) => Math.abs(o.yMm - a.yMm) < SAME_MM && Math.abs(o.xMm - right(a) - p.blockGapMm) < SAME_MM
        );
        if (b) return [distance("x", right(a), p.blockGapMm, middleY(a))];
      }
      return [];
    }
    case "boxGapXMm": {
      const row = boxRows(sheet).find((r) => r.length > 1);
      if (!row) return [];
      return [distance("x", right(row[0]), p.boxGapXMm, middleY(row[0]))];
    }
    case "boxGapYMm": {
      const rows = boxRows(sheet);
      for (let i = 1; i < rows.length; i += 1) {
        if (rows[i][0].entryId !== rows[i - 1][0].entryId) continue;
        const top = rowTopMm(rows[i], labelsAbove);
        return [distance("y", top - p.boxGapYMm, p.boxGapYMm, middleX(rows[i][0]))];
      }
      return [];
    }
    case "labelPosition":
      return labels();
    case "labelGapMm": {
      const row = boxRows(sheet).find((r) => r.some((b) => b.label));
      const labelled = row?.find((b) => b.label);
      if (!row || !labelled?.label) return [];
      // Below, the gap ends on the row's labels, which share one top. Above, it starts under the
      // row's lowest label — the band every label in the row is set in.
      const fromMm = labelsAbove
        ? Math.max(...row.map((b) => (b.label ? bottom(b.label) : -Infinity)))
        : labelled.label.yMm - p.labelGapMm;
      return [distance("y", fromMm, p.labelGapMm, middleX(labelled))];
    }
    case "boxBorderStyle":
    case "boxBorderWidthMm":
      return boxes();

    // ── Hawid ──
    // Both clearances are added to the stamp before a box is cut, and the stamp is not on the sheet
    // to measure from — so the boxes they size are what is marked.
    case "verticalClearanceMm":
    case "horizontalMarginMm":
      return boxes();

    // ── Type and texts ──
    case "titleFace":
    case "titleSizePt":
      return titleOutline();
    case "chapterFace":
    case "chapterSizePt":
    case "chapterTemplate":
      return chapterOutline();
    case "headingFace":
    case "headingSizePt":
    case "checklistTemplate":
      return headingOutlines();
    case "subheadingFace":
    case "subheadingSizePt":
      return subheadings.map(outline);
    case "labelFace":
    case "labelSizePt":
    case "boxLabelTemplate":
      return labels();
    case "footerFace":
    case "footerSizePt":
    case "footerTemplate":
      return footerOutline();

    // ── Photos ──
    case "printPhotos":
    case "photoOpacityPercent":
      return boxes();

    default: {
      // Every preset value is answered above; a new one is a type error here until it is.
      const unmarked: never = field;
      return unmarked;
    }
  }
}
