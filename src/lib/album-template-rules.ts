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
import {
  NO_FRAME_ORNAMENT,
  isAlbumBuiltinOrnament,
  isAlbumUploadedOrnamentId,
} from "./album-ornaments";
import {
  renderTitleTemplate,
  type ListingTemplateContext,
  type TitleTemplateCopy,
} from "./offer-title-template";

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
/** How many checklist blocks may share one horizontal band. A **ceiling, not a target**: the ordinary
 *  page is one block per band, and pairing is the exception. Capped at four because the collector's
 *  own pages only ever pair two, and a band of five narrow blocks is a table, not an album page. */
export const MIN_BLOCKS_PER_BAND = 1;
export const MAX_BLOCKS_PER_BAND = 4;
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
/** A corner ornament's longer side (#1427). Wide rails: a 5 mm dot and a 60 mm flourish are both
 *  frames somebody prints; past 100 mm it is no longer a corner. */
export const MIN_ORNAMENT_MM = 1;
export const MAX_ORNAMENT_MM = 100;

/** The page's optional decorative border: one or two rules inset from the page edge — what a
 *  printed album border is on the pages this replaces. An ornament at each corner is a separate
 *  choice (#1427), because a frame of ornaments alone is a frame too. */
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

/**
 * Where a sheet's content sits vertically in the space it has (#1419): the body between the headings
 * and the footer, never the running head, the chapter heading or the footer themselves.
 *
 * `top` is every page before #1419 and leaves whatever is over at the foot. The other three spend
 * that space: `center` moves the content as a whole into the middle, `justify` puts the first series
 * at the top and the last at the bottom and shares the rest equally between the series, and
 * `center-justify` shares it equally between the series **and** above the first and below the last.
 * Four and not a free figure, confirmed with the collector against a sketch of all four on
 * 2026-09-27.
 *
 * The packing does not move under any of them. What lands on a sheet is decided first, exactly as it
 * always was, and only the space left over is redistributed — so a placement can never push a block
 * onto the next sheet, and the four options are four drawings of one plan.
 */
export const ALBUM_VERTICAL_PLACEMENTS = [
  { key: "top", label: "At the top" },
  { key: "center", label: "Centred" },
  { key: "justify", label: "Justified" },
  { key: "center-justify", label: "Centred and justified" },
] as const;

export type AlbumVerticalPlacement = (typeof ALBUM_VERTICAL_PLACEMENTS)[number]["key"];

/** A placement as a collector reads it, for the page editor and the divergence report. */
export function albumVerticalPlacementLabel(key: AlbumVerticalPlacement): string {
  return ALBUM_VERTICAL_PLACEMENTS.find((p) => p.key === key)?.label ?? key;
}

/**
 * Where the album's title sits relative to the page frame (#1428).
 *
 * `below-frame` is every page before #1428: the title is the first line inside the top margin.
 * `in-frame` sets it **into** the frame's top line, which is broken around it — the head of every
 * card in the collector's AlbumEasy binders, where a white image laid over the rule makes the gap.
 * A sheet with no rule to break (no border, or a border of zero weight) places the title below, as
 * `album-layout.ts` states.
 */
export const ALBUM_TITLE_PLACEMENTS = [
  { key: "below-frame", label: "Below the frame" },
  { key: "in-frame", label: "In the frame line" },
] as const;

export type AlbumTitlePlacement = (typeof ALBUM_TITLE_PLACEMENTS)[number]["key"];

/**
 * Where the page footer sits relative to the frame (#1457). The footer is positioned on its own:
 * where it sits never enlarges the area the content is spread over (#1419), which is the page less
 * its margins.
 *
 * `inside-frame` is every page before #1457: at the foot of the framed area, the content kept clear
 * of it. `in-frame` sets it into the frame's bottom line by #1428's rules for the title, and
 * `below-frame` prints it between the frame and the paper's edge. A sheet with no rule sets the
 * footer on the bottom margin whichever is chosen, as `album-layout.ts` states.
 */
export const ALBUM_FOOTER_PLACEMENTS = [
  { key: "inside-frame", label: "Inside the frame" },
  { key: "in-frame", label: "In the frame line" },
  { key: "below-frame", label: "Below the frame" },
] as const;

export type AlbumFooterPlacement = (typeof ALBUM_FOOTER_PLACEMENTS)[number]["key"];

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
  /** The most blocks that may share one horizontal band. See {@link MIN_BLOCKS_PER_BAND}. */
  blocksPerBand: number;
  /** The space between two blocks sharing a band. */
  blockGapMm: number;
  borderStyle: AlbumBorderStyle;
  borderWidthMm: number;
  borderInsetMm: number;
  /** White between the two rules of a double border, edge to edge (#1427). */
  borderGapMm: number;
  /** The ornament drawn at each corner of the frame (#1427): `none`, a built-in's key
   *  (`album-ornaments.ts`), or the id of one of the collection's own uploads. The rules stop at
   *  it — `album-frame.ts` is where. */
  frameOrnament: string;
  /** The ornament's longer side. */
  frameOrnamentSizeMm: number;
  /** Where the album's title sits: below the frame, or set into its top line (#1428). */
  titlePlacement: AlbumTitlePlacement;
  /** The white left on each side of a title set into the frame line, between the text and where
   *  the rule stops (#1428). */
  titleFrameGapMm: number;
  /** Where the page footer sits: inside the frame, in its bottom line, or below it (#1457). */
  footerPlacement: AlbumFooterPlacement;
  /** How far the footer stands from the frame's line (#1457): up from the inner rule's inside to
   *  the footer's foot when it is inside, down from the outer rule's outside to its head when it is
   *  below. Unread in the frame line and on a sheet with no rule. */
  footerOffsetMm: number;
  /** The white left on each side of a footer set into the frame line (#1457), as
   *  {@link titleFrameGapMm} is the title's. */
  footerFrameGapMm: number;
  /** Where each sheet's content sits vertically (#1419). A single page may override it — see
   *  `AlbumBlockSpec.pagePlacement`. */
  verticalPlacement: AlbumVerticalPlacement;

  // Spacing
  boxGapXMm: number;
  boxGapYMm: number;
  headingSpaceAboveMm: number;
  headingSpaceBelowMm: number;
  /** The space between a row's boxes and its labels (#1420), on whichever side the labels sit. A
   *  row with no label reserves none of it. */
  labelGapMm: number;
  /** Above and below the album's name at the head of every sheet (#1426). A name that is not
   *  printed reserves neither. */
  titleSpaceAboveMm: number;
  titleSpaceBelowMm: number;
  /** Above and below the chapter heading on a chapter's first sheet (#1426) — its own values, no
   *  longer the checklist heading's. A blank chapter heading reserves neither. */
  chapterSpaceAboveMm: number;
  chapterSpaceBelowMm: number;

  // Hawid clearances, fed to `planHawidBox` (#765)
  verticalClearanceMm: number;
  horizontalMarginMm: number;

  // Type — a face id from `album-fonts.ts` and a size in points, per role
  titleFace: string;
  titleSizePt: number;
  /** Whether the album's name is printed as a **running head** on every page. Off is a real album:
   *  four of the collector's five areas carry a head and one does not, and the one that does not
   *  spends those millimetres on content instead. */
  printTitle: boolean;
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
  // `PAGE_COLUMN_START(50 10 0 0 10)` — a two-way split with 10 mm between the halves. Two, because
  // every one of the 35 column regions in his sources is a pair, and never more.
  blocksPerBand: 2,
  blockGapMm: 10,
  // His pages carry `ALBUM_PAGES_DECORATIVE_BORDER("Classic.txt")` — a double rule inset from the
  // edge is what that draws, and what these three reproduce.
  borderStyle: "double",
  borderWidthMm: 0.4,
  borderInsetMm: 5,
  // The white every double border was drawn with before it was a value.
  borderGapMm: 1.2,
  // His `Classic.txt` puts a 25.4 mm ornament at each corner (`IMAGE_SCALE(0.12)` of a 212 px
  // image). The rosette is the built-in drawn in its spirit, so a new template starts as a frame
  // like his; existing templates and albums were given `none` by their migration and keep theirs.
  frameOrnament: "rosette",
  frameOrnamentSizeMm: 25,
  // Below the frame is every page before #1428, so it stays the default. The gap is measured off his
  // printed `PL-1928.pdf`: the rule stops 67.0 mm apart around a 57.1 mm "Rzeczpospolita Polska" —
  // 5 mm of white each side. (His `_*.txt` includes lay a white image over the rule, sized by hand
  // per title; the gap is what that image leaves once printed.)
  titlePlacement: "below-frame",
  titleFrameGapMm: 5,
  // Inside the frame is every page before #1457, and 3.2 mm puts the footer's foot exactly where it
  // stood — on the 10 mm bottom margin, above a double rule whose inside is 5 + 0.4 + 1.2 + 0.2 mm
  // from the edge (`albumFooterOffsetFromMarginMm`). The gap is the title's (#1428).
  footerPlacement: "inside-frame",
  footerOffsetMm: 3.2,
  footerFrameGapMm: 5,
  // His pages are all set from the top — AlbumEasy has no other way to set one — so a new template
  // starts as the album he already prints, and an existing one keeps its pages exactly (#1419).
  verticalPlacement: "top",

  // `ALBUM_PAGES_SPACING (1.0 6.0)` — horizontal, then vertical.
  boxGapXMm: 1,
  boxGapYMm: 6,
  headingSpaceAboveMm: 8,
  headingSpaceBelowMm: 5,
  // No gap: a label has always started on the box's own edge, and the default is what every page
  // printed before #1420 was set with. The line's own leading is the only air above the letters.
  labelGapMm: 0,
  // The page headings' space is what they had before #1426 made it a value: the album's name sat on
  // the top margin with the content straight under it, and the chapter heading took the checklist
  // heading's figures.
  titleSpaceAboveMm: 0,
  titleSpaceBelowMm: 0,
  chapterSpaceAboveMm: 8,
  chapterSpaceBelowMm: 5,

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
  // His PL, DE-BM, DE-BY and DR pages all carry the running head; DA does not. On is the majority
  // and the one a new album is most likely to want.
  printTitle: true,
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

/** The same fields without the name: what an album's own values dialog submits (#1215). An album's
 *  name is not a template value — it is the album's identity, edited beside its language. */
export type AlbumRenderPresetRawInput = Record<keyof AlbumRenderPreset, string>;

export type AlbumRenderPresetParseResult =
  | { ok: true; value: AlbumRenderPreset }
  | { ok: false; message: string };

type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Every preset field the form submits, as typed. **Listed rather than looped** so a field added to
 * the preset without being added here is a type error instead of a value that silently stops being
 * saved.
 *
 * Here rather than in a server action because two forms submit these fields — the template's in
 * Settings (#766) and the album's own (#1215) — and a second list would be the drift the shared
 * preset type exists to prevent.
 */
export function readAlbumPresetFields(formData: FormData): AlbumRenderPresetRawInput {
  const str = (key: keyof AlbumRenderPreset) =>
    ((formData.get(key) as string | null) ?? "").trim();
  return {
    pageWidthMm: str("pageWidthMm"),
    pageHeightMm: str("pageHeightMm"),
    marginTopMm: str("marginTopMm"),
    marginRightMm: str("marginRightMm"),
    marginBottomMm: str("marginBottomMm"),
    marginLeftMm: str("marginLeftMm"),
    blocksPerBand: str("blocksPerBand"),
    blockGapMm: str("blockGapMm"),
    borderStyle: str("borderStyle"),
    borderWidthMm: str("borderWidthMm"),
    borderInsetMm: str("borderInsetMm"),
    borderGapMm: str("borderGapMm"),
    frameOrnament: str("frameOrnament"),
    frameOrnamentSizeMm: str("frameOrnamentSizeMm"),
    titlePlacement: str("titlePlacement"),
    titleFrameGapMm: str("titleFrameGapMm"),
    footerPlacement: str("footerPlacement"),
    footerOffsetMm: str("footerOffsetMm"),
    footerFrameGapMm: str("footerFrameGapMm"),
    verticalPlacement: str("verticalPlacement"),
    boxGapXMm: str("boxGapXMm"),
    boxGapYMm: str("boxGapYMm"),
    headingSpaceAboveMm: str("headingSpaceAboveMm"),
    headingSpaceBelowMm: str("headingSpaceBelowMm"),
    labelGapMm: str("labelGapMm"),
    titleSpaceAboveMm: str("titleSpaceAboveMm"),
    titleSpaceBelowMm: str("titleSpaceBelowMm"),
    chapterSpaceAboveMm: str("chapterSpaceAboveMm"),
    chapterSpaceBelowMm: str("chapterSpaceBelowMm"),
    verticalClearanceMm: str("verticalClearanceMm"),
    horizontalMarginMm: str("horizontalMarginMm"),
    titleFace: str("titleFace"),
    titleSizePt: str("titleSizePt"),
    chapterFace: str("chapterFace"),
    chapterSizePt: str("chapterSizePt"),
    headingFace: str("headingFace"),
    headingSizePt: str("headingSizePt"),
    labelFace: str("labelFace"),
    labelSizePt: str("labelSizePt"),
    footerFace: str("footerFace"),
    footerSizePt: str("footerSizePt"),
    boxBorderStyle: str("boxBorderStyle"),
    boxBorderWidthMm: str("boxBorderWidthMm"),
    labelPosition: str("labelPosition"),
    printTitle: str("printTitle"),
    printPhotos: str("printPhotos"),
    photoOpacityPercent: str("photoOpacityPercent"),
    chapterTemplate: str("chapterTemplate"),
    checklistTemplate: str("checklistTemplate"),
    boxLabelTemplate: str("boxLabelTemplate"),
    footerTemplate: str("footerTemplate"),
  };
}

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

/** The corner ornament a preset names. Only its **shape** is checked here — a built-in's key, or
 *  something that could be an uploaded ornament's id. That the upload exists and belongs to the
 *  collection is a database question, asked by the server before a save (`album-ornament-store.ts`). */
function parseFrameOrnament(raw: string): FieldResult<string> {
  const trimmed = raw.trim() || NO_FRAME_ORNAMENT;
  if (
    trimmed === NO_FRAME_ORNAMENT ||
    isAlbumBuiltinOrnament(trimmed) ||
    isAlbumUploadedOrnamentId(trimmed)
  ) {
    return { ok: true, value: trimmed };
  }
  return { ok: false, message: "Corner ornament is not a recognised setting." };
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
  const preset = parseAlbumRenderPreset(raw);
  if (!preset.ok) return preset;
  return { ok: true, value: { name, ...preset.value } };
}

/** The two gaps between boxes: across a row, and between rows. */
export type AlbumBoxGaps = Pick<AlbumRenderPreset, "boxGapXMm" | "boxGapYMm">;

/**
 * The two box gaps by the preset's own rule (#836). The page editor sets these two and nothing else,
 * and `parseAlbumRenderPreset` reads them through this very function — so a gap typed beside the
 * sheet is refused exactly where the template's form would refuse it, and the bounds cannot be
 * stated twice.
 */
export function parseAlbumBoxGaps(raw: {
  boxGapXMm: string;
  boxGapYMm: string;
}): FieldResult<AlbumBoxGaps> {
  const boxGapXMm = parseHawidMillimetres(
    raw.boxGapXMm,
    "Horizontal spacing",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!boxGapXMm.ok) return boxGapXMm;
  const boxGapYMm = parseHawidMillimetres(
    raw.boxGapYMm,
    "Vertical spacing",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!boxGapYMm.ok) return boxGapYMm;
  return { ok: true, value: { boxGapXMm: boxGapXMm.value, boxGapYMm: boxGapYMm.value } };
}

/**
 * The preset alone, by the same rules — the template's parser without the name. An album's own
 * values (#1215) go through exactly this, so an album can never be given a figure its template would
 * have refused, and its live preview draws only what a save would store.
 */
export function parseAlbumRenderPreset(
  raw: AlbumRenderPresetRawInput
): AlbumRenderPresetParseResult {
  const mm =(key: keyof AlbumRenderPreset, label: string, min: number, max: number) =>
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

  const blocksPerBand = parseWholeNumber(
    raw.blocksPerBand,
    "Blocks per band",
    MIN_BLOCKS_PER_BAND,
    MAX_BLOCKS_PER_BAND
  );
  if (!blocksPerBand.ok) return blocksPerBand;
  const blockGapMm = mm("blockGapMm", "Gap between blocks", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!blockGapMm.ok) return blockGapMm;

  const borderStyle = parseChoice(raw.borderStyle, "Page border", ALBUM_BORDER_STYLES);
  if (!borderStyle.ok) return borderStyle;
  const borderWidthMm = mm("borderWidthMm", "Border weight", MIN_LINE_MM, MAX_LINE_MM);
  if (!borderWidthMm.ok) return borderWidthMm;
  const borderInsetMm = mm("borderInsetMm", "Border inset", MIN_MARGIN_MM, MAX_MARGIN_MM);
  if (!borderInsetMm.ok) return borderInsetMm;
  const borderGapMm = mm("borderGapMm", "Gap between the rules", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!borderGapMm.ok) return borderGapMm;
  const frameOrnament = parseFrameOrnament(raw.frameOrnament);
  if (!frameOrnament.ok) return frameOrnament;
  const frameOrnamentSizeMm = mm(
    "frameOrnamentSizeMm",
    "Ornament size",
    MIN_ORNAMENT_MM,
    MAX_ORNAMENT_MM
  );
  if (!frameOrnamentSizeMm.ok) return frameOrnamentSizeMm;
  const titlePlacement = parseChoice(raw.titlePlacement, "Album title placement", ALBUM_TITLE_PLACEMENTS);
  if (!titlePlacement.ok) return titlePlacement;
  const titleFrameGapMm = mm(
    "titleFrameGapMm",
    "Gap around the title in the frame line",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!titleFrameGapMm.ok) return titleFrameGapMm;
  const footerPlacement = parseChoice(raw.footerPlacement, "Footer placement", ALBUM_FOOTER_PLACEMENTS);
  if (!footerPlacement.ok) return footerPlacement;
  const footerOffsetMm = mm("footerOffsetMm", "Footer offset from the frame", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!footerOffsetMm.ok) return footerOffsetMm;
  const footerFrameGapMm = mm(
    "footerFrameGapMm",
    "Gap around the footer in the frame line",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!footerFrameGapMm.ok) return footerFrameGapMm;
  const verticalPlacement = parseChoice(
    raw.verticalPlacement,
    "Vertical placement",
    ALBUM_VERTICAL_PLACEMENTS
  );
  if (!verticalPlacement.ok) return verticalPlacement;

  const boxGaps = parseAlbumBoxGaps(raw);
  if (!boxGaps.ok) return boxGaps;
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
  const labelGapMm = mm("labelGapMm", "Space between a box and its label", MIN_SPACING_MM, MAX_SPACING_MM);
  if (!labelGapMm.ok) return labelGapMm;
  const titleSpaceAboveMm = mm(
    "titleSpaceAboveMm",
    "Space above the album title",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!titleSpaceAboveMm.ok) return titleSpaceAboveMm;
  const titleSpaceBelowMm = mm(
    "titleSpaceBelowMm",
    "Space below the album title",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!titleSpaceBelowMm.ok) return titleSpaceBelowMm;
  const chapterSpaceAboveMm = mm(
    "chapterSpaceAboveMm",
    "Space above a chapter heading",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!chapterSpaceAboveMm.ok) return chapterSpaceAboveMm;
  const chapterSpaceBelowMm = mm(
    "chapterSpaceBelowMm",
    "Space below a chapter heading",
    MIN_SPACING_MM,
    MAX_SPACING_MM
  );
  if (!chapterSpaceBelowMm.ok) return chapterSpaceBelowMm;

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
      pageWidthMm: pageWidthMm.value,
      pageHeightMm: pageHeightMm.value,
      marginTopMm: marginTopMm.value,
      marginRightMm: marginRightMm.value,
      marginBottomMm: marginBottomMm.value,
      marginLeftMm: marginLeftMm.value,
      blocksPerBand: blocksPerBand.value,
      blockGapMm: blockGapMm.value,
      borderStyle: borderStyle.value,
      borderWidthMm: borderWidthMm.value,
      borderInsetMm: borderInsetMm.value,
      borderGapMm: borderGapMm.value,
      frameOrnament: frameOrnament.value,
      frameOrnamentSizeMm: frameOrnamentSizeMm.value,
      titlePlacement: titlePlacement.value,
      titleFrameGapMm: titleFrameGapMm.value,
      footerPlacement: footerPlacement.value,
      footerOffsetMm: footerOffsetMm.value,
      footerFrameGapMm: footerFrameGapMm.value,
      verticalPlacement: verticalPlacement.value,
      ...boxGaps.value,
      headingSpaceAboveMm: headingSpaceAboveMm.value,
      headingSpaceBelowMm: headingSpaceBelowMm.value,
      labelGapMm: labelGapMm.value,
      titleSpaceAboveMm: titleSpaceAboveMm.value,
      titleSpaceBelowMm: titleSpaceBelowMm.value,
      chapterSpaceAboveMm: chapterSpaceAboveMm.value,
      chapterSpaceBelowMm: chapterSpaceBelowMm.value,
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
      printTitle: raw.printTitle.trim() !== "",
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

/** A template in words, for the Settings row and #767's picker: `210 × 297 mm · up to 2 blocks per
 *  band · Liberation Serif 26 pt`. The page, the shape and the face that names it — enough to tell
 *  two templates apart without opening either. */
export function albumTemplateSummary(preset: AlbumRenderPreset): string {
  const page = `${preset.pageWidthMm} × ${preset.pageHeightMm} mm`;
  const bands =
    preset.blocksPerBand === 1
      ? "one block per band"
      : `up to ${preset.blocksPerBand} blocks per band`;
  return `${page} · ${bands} · ${albumFaceLabel(preset.titleFace)} ${preset.titleSizePt} pt`;
}

/** A template's main values as label and value, for the summary beside its preview on the Settings
 *  page (#1474). The preview answers *how it looks*; these are the figures a sheet does not show at a
 *  glance — the page's millimetres, the faces by name, whether photos print — and deliberately a
 *  handful rather than thirty: the editor is one click away for the rest. */
export function albumTemplateSummaryRows(
  preset: AlbumRenderPreset
): { label: string; value: string }[] {
  const { marginTopMm: t, marginRightMm: r, marginBottomMm: b, marginLeftMm: l } = preset;
  const margins =
    t === r && r === b && b === l
      ? `${t} mm`
      : `top ${t} · right ${r} · bottom ${b} · left ${l} mm`;
  const border = ALBUM_BORDER_STYLES.find((s) => s.key === preset.borderStyle)?.label ?? "None";
  const ornaments = preset.frameOrnament !== "none" && preset.frameOrnamentSizeMm > 0;
  const frame = !ornaments
    ? border
    : preset.borderStyle === "none"
      ? "Corner ornaments"
      : `${border}, corner ornaments`;
  return [
    { label: "Page", value: `${preset.pageWidthMm} × ${preset.pageHeightMm} mm` },
    { label: "Margins", value: margins },
    { label: "Frame", value: frame },
    {
      label: "Per band",
      value:
        preset.blocksPerBand === 1 ? "One checklist" : `Up to ${preset.blocksPerBand} checklists`,
    },
    { label: "Album title", value: `${albumFaceLabel(preset.titleFace)} ${preset.titleSizePt} pt` },
    { label: "Box labels", value: `${albumFaceLabel(preset.labelFace)} ${preset.labelSizePt} pt` },
    {
      label: "Photos",
      value: preset.printPhotos ? `Printed at ${preset.photoOpacityPercent}%` : "Not printed",
    },
  ];
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

/**
 * Just the render preset out of something that carries one — an `Album` or an `AlbumTemplate` row,
 * both of which are `AlbumRenderPreset` plus an id and a name.
 *
 * The key list comes from {@link DEFAULT_ALBUM_PRESET} rather than being written out again, so it
 * cannot drift from `AlbumRenderPreset`: that duplication is the one thing this module exists to
 * prevent. A printed sheet stores the result of this (#778), and storing the whole album row instead
 * would make its name and its id look like template values that had "changed" whenever they did.
 */
export function albumRenderPreset(source: AlbumRenderPreset): AlbumRenderPreset {
  const from = source as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_ALBUM_PRESET)) out[key] = from[key];
  return out as unknown as AlbumRenderPreset;
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

export function asAlbumTitlePlacement(raw: string): AlbumTitlePlacement {
  return coerce(raw, ALBUM_TITLE_PLACEMENTS, DEFAULT_ALBUM_PRESET.titlePlacement);
}

export function asAlbumFooterPlacement(raw: string): AlbumFooterPlacement {
  return coerce(raw, ALBUM_FOOTER_PLACEMENTS, DEFAULT_ALBUM_PRESET.footerPlacement);
}

export function asAlbumVerticalPlacement(raw: string): AlbumVerticalPlacement {
  return coerce(raw, ALBUM_VERTICAL_PLACEMENTS, DEFAULT_ALBUM_PRESET.verticalPlacement);
}

/** A page's own placement (#1419), where null means *follow the album*. A stored word this build no
 *  longer knows reads as null rather than as some other placement: following the album is what the
 *  page did before the override existed. */
export function asAlbumPagePlacement(raw: string | null): AlbumVerticalPlacement | null {
  if (raw === null) return null;
  return ALBUM_VERTICAL_PLACEMENTS.some((p) => p.key === raw)
    ? (raw as AlbumVerticalPlacement)
    : null;
}

/**
 * One album text, rendered.
 *
 * **A blank template renders blank**, and that is why this exists rather than a bare
 * `renderTitleTemplate` call: the shared renderer falls back to `DEFAULT_TITLE_TEMPLATE` for an empty
 * template, which is right for an offer title (an offer must be called something) and wrong for all
 * four album texts, where blank is a real value a collector chooses (#766) — a page with no footer is
 * an ordinary thing to want, and it must not silently print a generated listing title instead.
 *
 * It lives in the **pure** half of the album template rather than in the plan, because the plan is
 * not its only caller: the template's own preview (#795) renders the same four texts over a sample,
 * and it does so before any album exists. Two renderers would be two answers to *what does this
 * template print*, and the blank-template guard above is exactly the sort of half that gets left out
 * of the second one.
 */
export function renderAlbumText(
  template: string,
  copies: readonly TitleTemplateCopy[],
  context: ListingTemplateContext
): string {
  if (!template.trim()) return "";
  return renderTitleTemplate(template, copies, context);
}
