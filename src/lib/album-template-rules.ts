// Pure rules for album templates (#766) — no Prisma, so the Settings panel, the server action, and
// later the page plan (#767), the PDF (#768) and the editor canvas (#769) all read one definition
// of what an album looks like.
//
// ## `AlbumRenderPreset` is a shared *type*, never a shared row
//
// Choosing a template on an album **copies** these values onto the album (#308's rule, #767). The
// album will hold no `albumTemplateId`, and this module is what stops the two field lists drifting:
// `AlbumTemplate` is `AlbumRenderPreset` plus an id and a name, and `Album` will embed the same
// preset. That duplication in the database is deliberate and is not a normalisation someone should
// tidy away later — an album is printed on paper and stamps are glued into it, so an edit to a
// template must not be able to reach into a page already sitting in a binder. If you are here to
// replace the duplicated columns with a foreign key: that is the bug, not the schema.
//
// ## Two units
//
// **Millimetres** for geometry, because millimetres are what gets cut — and to the tenth
// `hawid.ts` rounds to, which is why the clearances below are parsed with that module's own parser
// rather than a second one that could round differently.
//
// **Points** for type sizes. It is the unit the collector's existing AlbumEasy sources state type in
// (`PAGE_TEXT_CENTRE (STAMP_H1 12 …)`) and the unit a PDF is natively drawn in, so neither the
// collector nor the renderer has to convert. Mixing units in one form is a real cost; converting a
// type size twice is a larger one.
//
// ## The defaults are measured, not invented
//
// {@link DEFAULT_ALBUM_PRESET} is the geometry of the collector's own album sources — A4, 10 mm
// margins, `ALBUM_PAGES_SPACING (1.0 6.0)`, `STAMP_BOXES_SIZE_ADJUST(4)` as the two clearances that
// single global figure becomes, and the five faces and sizes his pages are actually set in. A new
// template therefore starts as the album he already prints, which is the only starting point that
// is not a number somebody made up.

import { parseHawidMillimetres, HAWID_MM_DECIMALS, HAWID_MM_STEP } from "./hawid";
import { isAlbumFaceId, albumFaceLabel } from "./album-fonts";

export const ALBUM_MM_DECIMALS = HAWID_MM_DECIMALS;
export const ALBUM_MM_STEP = HAWID_MM_STEP;

/** Type sizes are entered to a tenth of a point — 8.5 pt is an ordinary thing to want. */
export const ALBUM_PT_STEP = 0.1;

// Sanity rails rather than opinions: wide enough for anything a collector might genuinely print,
// narrow enough that a mistyped figure is caught before the paper is spent.
export const MIN_PAGE_MM = 50;
export const MAX_PAGE_MM = 1000;
export const MIN_MARGIN_MM = 0;
export const MAX_MARGIN_MM = 100;
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const MIN_SPACING_MM = 0;
export const MAX_SPACING_MM = 100;
/** The clearances a box adds to a stamp (#765). Capped low on purpose: these are millimetres of
 *  hawid around a stamp, and a figure in the tens is a typo, not a margin. */
export const MIN_CLEARANCE_MM = 0;
export const MAX_CLEARANCE_MM = 30;
export const MIN_LINE_MM = 0;
export const MAX_LINE_MM = 10;
export const MIN_TYPE_PT = 4;
export const MAX_TYPE_PT = 96;
export const MIN_OPACITY_PERCENT = 0;
export const MAX_OPACITY_PERCENT = 100;

/** The page's optional decorative border. Three values rather than a file of border art: what a
 *  printed album border actually is, on the pages this replaces, is one or two rules inset from the
 *  page edge. */
export const ALBUM_BORDER_STYLES = [
  { key: "none", label: "None" },
  { key: "single", label: "Single rule" },
  { key: "double", label: "Double rule" },
] as const;

export type AlbumBorderStyle = (typeof ALBUM_BORDER_STYLES)[number]["key"];

/** The outline drawn around a mount. `none` is a real choice — a page whose boxes are only implied
 *  by the mounts themselves is a legitimate album, and a hawid is visible enough on paper. */
export const ALBUM_BOX_BORDER_STYLES = [
  { key: "none", label: "None" },
  { key: "solid", label: "Solid" },
  { key: "dashed", label: "Dashed" },
  { key: "dotted", label: "Dotted" },
] as const;

export type AlbumBoxBorderStyle = (typeof ALBUM_BOX_BORDER_STYLES)[number]["key"];

/** Where a box's label sits. Below is the album convention; above suits a page whose boxes sit
 *  tight to the row beneath. `none` prints unlabelled boxes, for an album that names its stamps in
 *  the checklist heading alone. */
export const ALBUM_LABEL_POSITIONS = [
  { key: "below", label: "Below the box" },
  { key: "above", label: "Above the box" },
  { key: "none", label: "No label" },
] as const;

export type AlbumLabelPosition = (typeof ALBUM_LABEL_POSITIONS)[number]["key"];

/** The five roles type is set for. Ordered as they appear down a page, which is the order the
 *  form shows them in. */
export const ALBUM_TYPE_ROLES = [
  { key: "title", label: "Album title" },
  { key: "chapter", label: "Chapter heading" },
  { key: "heading", label: "Checklist heading" },
  { key: "label", label: "Box label" },
  { key: "footer", label: "Footer" },
] as const;

export type AlbumTypeRole = (typeof ALBUM_TYPE_ROLES)[number]["key"];

/**
 * Everything about how an album looks, as one value. This is what a template holds and what
 * choosing a template copies onto an album (#767) — see the module header on why that is a copy.
 */
export interface AlbumRenderPreset {
  // Page
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  columns: number;
  columnGapMm: number;
  borderStyle: AlbumBorderStyle;
  borderWidthMm: number;
  borderInsetMm: number;

  // Spacing
  boxGapXMm: number;
  boxGapYMm: number;
  headingSpaceAboveMm: number;
  headingSpaceBelowMm: number;

  // Hawid clearances, fed to `planHawidBox` (#765)
  verticalClearanceMm: number;
  horizontalMarginMm: number;

  // Type — a face id from `album-fonts.ts` and a size in points, per role
  titleFace: string;
  titleSizePt: number;
  chapterFace: string;
  chapterSizePt: number;
  headingFace: string;
  headingSizePt: number;
  labelFace: string;
  labelSizePt: number;
  footerFace: string;
  footerSizePt: number;

  // Boxes
  boxBorderStyle: AlbumBoxBorderStyle;
  boxBorderWidthMm: number;
  labelPosition: AlbumLabelPosition;

  // Photos
  printPhotos: boolean;
  photoOpacityPercent: number;

  // Texts, as `{token}` templates over the shared vocabulary
  chapterTemplate: string;
  checklistTemplate: string;
  boxLabelTemplate: string;
  footerTemplate: string;
}

/**
 * What a new template starts as: the collector's own album sources, converted.
 *
 * A **constant, not a seeded row** — `DEFAULT_REF_CARD_GEOMETRY`'s rule (#569). Nothing is written
 * to the database until a template is saved, and a collection with no template has none.
 */
export const DEFAULT_ALBUM_PRESET: AlbumRenderPreset = {
  // `ALBUM_PAGES_SIZE (210.0 297.0)` and `ALBUM_PAGES_MARGINS (10.0 10.0 10.0 10.0)`.
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  columns: 1,
  columnGapMm: 6,
  // His pages carry `ALBUM_PAGES_DECORATIVE_BORDER("Classic.txt")` — a double rule inset from the
  // edge is what that draws, and what these three reproduce.
  borderStyle: "double",
  borderWidthMm: 0.4,
  borderInsetMm: 5,

  // `ALBUM_PAGES_SPACING (1.0 6.0)` — horizontal, then vertical.
  boxGapXMm: 1,
  boxGapYMm: 6,
  headingSpaceAboveMm: 8,
  headingSpaceBelowMm: 5,

  // The two numbers `STAMP_BOXES_SIZE_ADJUST(4)` becomes. Its single global figure is exactly what
  // #765 exists to replace, so the starting point is that figure on both axes and the collector
  // moves whichever one his stock actually calls for.
  verticalClearanceMm: 4,
  horizontalMarginMm: 4,

  // The five faces and sizes his pages are set in: `HEADER "Times New Roman"` at 26,
  // `YEAR_H "Times New Roman Bold"` at 24, `STAMP_H1 "Arial Bold Italic"` at 12,
  // `STAMP "Arial"`, and `PAGE_TEXT_CENTER(FOOTER 8 …)`.
  titleFace: "liberation-serif",
  titleSizePt: 26,
  chapterFace: "liberation-serif-bold",
  chapterSizePt: 24,
  headingFace: "liberation-sans-bold-italic",
  headingSizePt: 12,
  labelFace: "liberation-sans",
  labelSizePt: 8,
  footerFace: "liberation-sans",
  footerSizePt: 8,

  boxBorderStyle: "solid",
  boxBorderWidthMm: 0.2,
  labelPosition: "below",

  // His pages carry `ALBUM_STAMP_IMG_SHOW`, so a box printing the photo it has is the default.
  // The opacity is ours rather than his: a faint image reads as *what belongs here*, and full
  // strength reads as a photograph of a stamp that is already mounted. Starting at full strength
  // leaves that a decision the collector makes on purpose.
  printPhotos: true,
  photoOpacityPercent: 100,

  // The texts his pages actually print. `{catalog::}` is a **bare** number — empty vendor list means
  // the area's primary catalogue, empty flags means no prefixes — because an album page is already
  // scoped to one area and one catalogue, so `Mi·PL 303` on every box would repeat what the binder
  // spine says. The footer's `{pageRange}` is his `PAGE_TEXT_CENTER(FOOTER 8 "PL $$1")`.
  chapterTemplate: "{year}",
  checklistTemplate: "{year}, {issueDate}. {checklistName}",
  boxLabelTemplate: "{catalog::}",
  footerTemplate: "{pageRange}",
};

/** A template as the dictionary holds one: the preset, plus the name it is picked by. */
export interface AlbumTemplateInput extends AlbumRenderPreset {
  name: string;
}

export type AlbumTemplateParseResult =
  | { ok: true; value: AlbumTemplateInput }
  | { ok: false; message: string };

/** The raw strings the Settings form submits — every field as typed, before any of it is trusted. */
export type AlbumTemplateRawInput = Record<keyof AlbumTemplateInput, string>;

type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Parses a whole-number field (columns, opacity). Its own parser rather than the millimetre one:
 *  `1.5 columns` is not a rounding question, it is a mistake. */
function parseWholeNumber(
  raw: string,
  label: string,
  min: number,
  max: number
): FieldResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a whole number.` };
  }
  const value = Number(trimmed);
  if (value < min || value > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

/** Parses a type size in points — the same shape as a millimetre field, in the other unit, so the
 *  error message names points and a collector is never told a font size is out of range in mm. */
function parseTypeSize(raw: string, label: string): FieldResult<number> {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return { ok: false, message: `${label} is required.` };
  if (!/^\d+(\.\d)?$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a size in points with at most one decimal.` };
  }
  const value = Number(trimmed);
  if (value < MIN_TYPE_PT || value > MAX_TYPE_PT) {
    return { ok: false, message: `${label} must be between ${MIN_TYPE_PT} and ${MAX_TYPE_PT} pt.` };
  }
  return { ok: true, value };
}

/** Validates a face id against the set this build ships. A template naming a face we cannot embed
 *  would render in something else on the paper, which is the failure the fixed set exists to
 *  prevent — so it is refused at the form rather than substituted at print time. */
function parseFace(raw: string, label: string): FieldResult<string> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: `${label} font is required.` };
  if (!isAlbumFaceId(trimmed)) {
    return { ok: false, message: `${label} font is not one this version ships.` };
  }
  return { ok: true, value: trimmed };
}

function parseChoice<T extends string>(
  raw: string,
  label: string,
  allowed: readonly { key: T }[]
): FieldResult<T> {
  const trimmed = raw.trim();
  const match = allowed.find((a) => a.key === trimmed);
  if (!match) return { ok: false, message: `${label} is not a recognised setting.` };
  return { ok: true, value: match.key };
}

/**
 * Validates every raw field the Settings form submits, reporting the **first** problem found — the
 * collage and ref-card panels' idiom (#307/#569), surfaced inline in the dialog.
 *
 * The order below is the order the form reads down the page, so the message a collector gets always
 * names the field nearest the top that is wrong.
 */
export function parseAlbumTemplateInput(raw: AlbumTemplateRawInput): AlbumTemplateParseResult {
  const name = raw.name.trim();
  if (!name) return { ok: false, message: "Name is required." };

  const mm = (key: keyof AlbumRenderPreset, label: string, min: number, max: number) =>
    parseHawidMillimetres(raw[key], label, min, max);

  const pageWidthMm = mm("pageWidthMm", "Page width", MIN_PAGE_MM, MAX_PAGE_MM);
  if (!pageWidthMm.ok) return pageWidthMm;
  const pageHeightMm = mm("pageHeightMm", "Page height", MIN_PAGE_MM, MAX_PAGE_MM);
  if (!pageHeightMm.ok) return pageHeightMm;

  const marginTopMm = mm("marginTopMm", "Top margin", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!marginTopMm.ok) return marginTopMm;
  const marginRightMm = mm("marginRightMm", "Right margin", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!marginRightMm.ok) return marginRightMm;
  const marginBottomMm = mm("marginBottomMm", "Bottom margin", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!marginBottomMm.ok) return marginBottomMm;
  const marginLeftMm = mm("marginLeftMm", "Left margin", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!marginLeftMm.ok) return marginLeftMm;

  const columns = parseWholeNumber(raw.columns, "Columns", MIN_COLUMNS, MAX_COLUMNS);
  if (!columns.ok) return columns;
  const columnGapMm = mm("columnGapMm", "Column gap", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!columnGapMm.ok) return columnGapMm;

  const borderStyle = parseChoice(raw.borderStyle, "Page border", ALBUM_BORDER_STYLES);
  if (!borderStyle.ok) return borderStyle;
  const borderWidthMm = mm("borderWidthMm", "Border weight", MIN_LINE_MM, MAX_LINE_MM);
  if (!borderWidthMm.ok) return borderWidthMm;
  const borderInsetMm = mm("borderInsetMm", "Border inset", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!borderInsetMm.ok) return borderInsetMm;

  const boxGapXMm = mm("boxGapXMm", "Horizontal spacing", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!boxGapXMm.ok) return boxGapXMm;
  const boxGapYMm = mm("boxGapYMm", "Vertical spacing", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!boxGapYMm.ok) return boxGapYMm;
  const headingSpaceAboveMm = mm(
    "headingSpaceAboveMm",
    "Space above a heading",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!headingSpaceAboveMm.ok) return headingSpaceAboveMm;
  const headingSpaceBelowMm = mm(
    "headingSpaceBelowMm",
    "Space below a heading",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!headingSpaceBelowMm.ok) return headingSpaceBelowMm;

  const verticalClearanceMm = mm(
    "verticalClearanceMm",
    "Vertical hawid clearance",
    MIN_CLEARANCE_MM,
    MAX_CLEARANCE_MM
  );
  if (!verticalClearanceMm.ok) return verticalClearanceMm;
  const horizontalMarginMm = mm(
    "horizontalMarginMm",
    "Horizontal hawid margin",
    MIN_CLEARANCE_MM,
    MAX_CLEARANCE_MM
  );
  if (!horizontalMarginMm.ok) return horizontalMarginMm;

  const titleFace = parseFace(raw.titleFace, "Album title");
  if (!titleFace.ok) return titleFace;
  const titleSizePt = parseTypeSize(raw.titleSizePt, "Album title size");
  if (!titleSizePt.ok) return titleSizePt;
  const chapterFace = parseFace(raw.chapterFace, "Chapter heading");
  if (!chapterFace.ok) return chapterFace;
  const chapterSizePt = parseTypeSize(raw.chapterSizePt, "Chapter heading size");
  if (!chapterSizePt.ok) return chapterSizePt;
  const headingFace = parseFace(raw.headingFace, "Checklist heading");
  if (!headingFace.ok) return headingFace;
  const headingSizePt = parseTypeSize(raw.headingSizePt, "Checklist heading size");
  if (!headingSizePt.ok) return headingSizePt;
  const labelFace = parseFace(raw.labelFace, "Box label");
  if (!labelFace.ok) return labelFace;
  const labelSizePt = parseTypeSize(raw.labelSizePt, "Box label size");
  if (!labelSizePt.ok) return labelSizePt;
  const footerFace = parseFace(raw.footerFace, "Footer");
  if (!footerFace.ok) return footerFace;
  const footerSizePt = parseTypeSize(raw.footerSizePt, "Footer size");
  if (!footerSizePt.ok) return footerSizePt;

  const boxBorderStyle = parseChoice(raw.boxBorderStyle, "Box outline", ALBUM_BOX_BORDER_STYLES);
  if (!boxBorderStyle.ok) return boxBorderStyle;
  const boxBorderWidthMm = mm("boxBorderWidthMm", "Box outline weight", MIN_LINE_MM, MAX_LINE_MM);
  if (!boxBorderWidthMm.ok) return boxBorderWidthMm;
  const labelPosition = parseChoice(raw.labelPosition, "Label position", ALBUM_LABEL_POSITIONS);
  if (!labelPosition.ok) return labelPosition;

  const photoOpacityPercent = parseWholeNumber(
    raw.photoOpacityPercent,
    "Photo opacity",
    MIN_OPACITY_PERCENT,
    MAX_OPACITY_PERCENT
  );
  if (!photoOpacityPercent.ok) return photoOpacityPercent;

  // The content area has to exist. Margins wider than the sheet produce a page whose every box is
  // off the paper, and that is worth catching in the dialog rather than in the printer.
  const contentWidth = pageWidthMm.value - marginLeftMm.value - marginRightMm.value;
  const contentHeight = pageHeightMm.value - marginTopMm.value - marginBottomMm.value;
  if (contentWidth <= 0 || contentHeight <= 0) {
    return { ok: false, message: "The margins leave no printable area on the page." };
  }

  return {
    ok: true,
    value: {
      name,
      pageWidthMm: pageWidthMm.value,
      pageHeightMm: pageHeightMm.value,
      marginTopMm: marginTopMm.value,
      marginRightMm: marginRightMm.value,
      marginBottomMm: marginBottomMm.value,
      marginLeftMm: marginLeftMm.value,
      columns: columns.value,
      columnGapMm: columnGapMm.value,
      borderStyle: borderStyle.value,
      borderWidthMm: borderWidthMm.value,
      borderInsetMm: borderInsetMm.value,
      boxGapXMm: boxGapXMm.value,
      boxGapYMm: boxGapYMm.value,
      headingSpaceAboveMm: headingSpaceAboveMm.value,
      headingSpaceBelowMm: headingSpaceBelowMm.value,
      verticalClearanceMm: verticalClearanceMm.value,
      horizontalMarginMm: horizontalMarginMm.value,
      titleFace: titleFace.value,
      titleSizePt: titleSizePt.value,
      chapterFace: chapterFace.value,
      chapterSizePt: chapterSizePt.value,
      headingFace: headingFace.value,
      headingSizePt: headingSizePt.value,
      labelFace: labelFace.value,
      labelSizePt: labelSizePt.value,
      footerFace: footerFace.value,
      footerSizePt: footerSizePt.value,
      boxBorderStyle: boxBorderStyle.value,
      boxBorderWidthMm: boxBorderWidthMm.value,
      labelPosition: labelPosition.value,
      // A checkbox is present or absent, never invalid — the form submits "on" or nothing.
      printPhotos: raw.printPhotos.trim() !== "",
      photoOpacityPercent: photoOpacityPercent.value,
      // Templates are free text by design: a token this build does not know renders empty rather
      // than failing a save, which is what lets one template outlive a vocabulary change.
      chapterTemplate: raw.chapterTemplate.trim(),
      checklistTemplate: raw.checklistTemplate.trim(),
      boxLabelTemplate: raw.boxLabelTemplate.trim(),
      footerTemplate: raw.footerTemplate.trim(),
    },
  };
}

/** The clearances a template hands the box rule (#765), as that rule's own input type. Named rather
 *  than spread at each call site so the two numbers can never be passed in the wrong order. */
export function albumHawidMargins(preset: AlbumRenderPreset): {
  verticalClearanceMm: number;
  horizontalMarginMm: number;
} {
  return {
    verticalClearanceMm: preset.verticalClearanceMm,
    horizontalMarginMm: preset.horizontalMarginMm,
  };
}

/** A template in words, for the Settings row and #767's picker: `210 × 297 mm · 1 column ·
 *  Liberation Serif 26 pt`. The page, the shape and the face that names it — enough to tell two
 *  templates apart without opening either. */
export function albumTemplateSummary(preset: AlbumRenderPreset): string {
  const page = `${preset.pageWidthMm} × ${preset.pageHeightMm} mm`;
  const columns = preset.columns === 1 ? "1 column" : `${preset.columns} columns`;
  return `${page} · ${columns} · ${albumFaceLabel(preset.titleFace)} ${preset.titleSizePt} pt`;
}

/** Coerce a stored choice column back to its union, falling back to the default preset's value.
 *
 * The parser above is what keeps these columns honest on the way *in*, so this only ever fires for
 * a row written by an older build whose vocabulary has since changed. Falling back beats widening
 * the type to `string` and letting an unrecognised word reach the renderer, where it would silently
 * draw nothing. */
function coerce<T extends string>(raw: string, allowed: readonly { key: T }[], fallback: T): T {
  return allowed.some((a) => a.key === raw) ? (raw as T) : fallback;
}

export function asAlbumBorderStyle(raw: string): AlbumBorderStyle {
  return coerce(raw, ALBUM_BORDER_STYLES, DEFAULT_ALBUM_PRESET.borderStyle);
}

export function asAlbumBoxBorderStyle(raw: string): AlbumBoxBorderStyle {
  return coerce(raw, ALBUM_BOX_BORDER_STYLES, DEFAULT_ALBUM_PRESET.boxBorderStyle);
}

export function asAlbumLabelPosition(raw: string): AlbumLabelPosition {
  return coerce(raw, ALBUM_LABEL_POSITIONS, DEFAULT_ALBUM_PRESET.labelPosition);
}
