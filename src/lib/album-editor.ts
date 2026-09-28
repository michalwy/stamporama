import "server-only";
import {
  albumPlacedTextFace,
  type AlbumPlacedFreePage,
  type AlbumRect,
  type AlbumTextRole,
} from "./album-layout";
import type { AlbumFreeTextAlign } from "./album-free-page";
import { albumPictureDpi, albumPictureTooCoarse } from "./album-free-page";
import {
  getAlbumPictures,
  type AlbumPictureData,
  type AlbumPictureRef,
} from "./album-pictures";
import type { AlbumRenderPreset, AlbumVerticalPlacement } from "./album-template-rules";
import { albumBaselineOffsetMm, albumTextMetrics, PT_TO_MM } from "./album-metrics";
import { findAlbumFace } from "./album-fonts";
import { hawidStripLabel } from "./hawid";
import { titleFallbackKey, type TitleFallback } from "./offer-title-template";
import {
  albumPlanContext,
  planAlbumFrom,
  type AlbumBoxData,
  type AlbumPlanContext,
  type AlbumPlanPage,
  type AlbumPlanResult,
} from "./album-plan";
import { albumBoxFlag } from "./album-box-flag";
import { NO_ATTENTION, type AlbumSheetAttention } from "./album-screen-view";
import { getAlbumPageSnapshots } from "./album-printed-pages";
import type { AlbumPageSnapshot, AlbumSnapshotBox } from "./album-snapshot";
import { getAlbumPrintedReport } from "./album-printing";
import type { AlbumDivergence } from "./album-divergence";
import type { AlbumOrnamentDrawing } from "./album-ornament-svg";
import { resolveAlbumPhotos } from "./album-photos";
import type { AlbumBoxAdjustmentValue } from "./album-corrections";
import type {
  AlbumData,
  AlbumEntryData,
  AlbumFreePageData,
  AlbumTextBlockData,
} from "./albums";

// What one sheet looks like to the page editor (#769) — the geometry the canvas draws, and
// everything it has to be able to say about what is on it.
//
// ## The canvas draws this. It computes nothing.
//
// Every millimetre below was decided in `album-layout.ts` and every line break was made by
// `album-metrics.ts` against the faces the PDF embeds. That is ADR-0045 §7 at its sharpest, and the
// obligation is stronger than "share the measurer": **the client is not allowed to measure, because
// the client is not a planner.** A canvas reaching for the browser's `measureText` to get responsive
// feedback would break a heading in one place and the printer in another — invisibly, at exactly the
// millimetre this whole track exists to protect, and it would look right until somebody put a ruler
// on a card.
//
// So the payload carries the *results* of measuring: the wrapped lines, the band each run of text
// occupies, and per run the line height and the {@link albumBaselineOffsetMm} the PDF places its ink
// on (ADR-0046 §consequences). The canvas positions glyphs the renderer positioned. What it does
// with the browser's own type is only *paint* — hence `cssStack`, which names the metric twin of the
// embedded face first so a machine that has it previews at the printed measure.
//
// Corrections are the other half of the same rule. Dragging shows a **geometric offset** applied to
// an already-computed plan — a rectangle following the pointer — and the re-plan happens on the
// server when the drag is released. Nothing about where the next block falls is ever decided here.
//
// ## What is flagged, and why it may be flagged here and nowhere else
//
// Three things a collector needs to know **before** a sheet goes into the printer and never after:
// a box drawn from an **inherited** size (#763), an **oversize** box carrying no hawid (#765), and a
// text that **fell back** to the album's default language (#298). All three are stale the moment
// they are computed, which is exactly why ADR-0047 §9 keeps them off the paper — and exactly why
// they belong on this screen. The rule about what may go on a card governs the *sheet*; the editor
// is a screen.
//
// ## A printed sheet is read-only here, and that is #778's decision, not this module's
//
// A card in a binder opens showing **what went onto the paper** — its own snapshot, drawn through
// the same shape a live sheet is drawn through — with whatever has since diverged beside it.
// Correcting one is not an edit but a decision, a continuation page or a reprint, and that decision
// lives on the album screen (#778). Nothing here writes to a printed sheet and nothing here
// re-resolves one: a renderer drawing a snapshot resolves nothing (ADR-0047 §1).

/**
 * What a live sheet is actually built from — a **subset** of {@link AlbumPlanContext}, not the whole
 * of it.
 *
 * Named because there are two callers with very different amounts to hand over. The editor (#769)
 * has a full context and passes it, unchanged; the album template's preview (#795) has a preset, a
 * fabricated set of entries and no database row anywhere, and stating the four things a sheet needs
 * saves it from implementing the resolvers it would never be asked for. A half-implemented
 * interface reads as *this cannot be asked* where the truth is *nothing asks*, and the next person
 * to add a caller would have to work out which of the two it was.
 */
export type AlbumSheetSource = Pick<
  AlbumPlanContext,
  | "album"
  | "entries"
  | "textBlocks"
  | "freePages"
  | "pictures"
  | "textGaps"
  | "titleGaps"
  | "frameOrnament"
>;

/** How a run of text is set, resolved once here so the canvas and the PDF put ink in the same place. */
export interface AlbumEditorFace {
  /** The stored face id, so a face this build no longer ships is still nameable. */
  id: string;
  label: string;
  /** The browser stack for previewing it — the metric twin first (`album-fonts.ts`). */
  cssStack: string;
  bold: boolean;
  italic: boolean;
  sizePt: number;
  /** The same size in **millimetres**, so the canvas performs no unit conversion of its own. Type is
   *  stated in points and paper is measured in millimetres (#766); the conversion happens once, on
   *  the server, in the module that owns it. */
  sizeMm: number;
  /** Baseline to baseline, as the plan charged for it. */
  lineHeightMm: number;
  /** How far below the top of a line box its baseline sits — the renderer's own figure, so the
   *  screen and the paper cannot place a heading's ink differently (ADR-0046). */
  baselineOffsetMm: number;
}

/** A run of already-wrapped text as the canvas draws it. */
export interface AlbumEditorText extends AlbumRect {
  role: AlbumTextRole;
  lines: string[];
  face: AlbumEditorFace;
  /** Where each line sits in the band — centred unless a free page's text says otherwise (#1429). */
  align: AlbumFreeTextAlign;
  /** The entity fields this text rendered untranslated (#298), each fillable in place (#299/#300).
   *  Empty on a printed sheet: what is on the card is what is on the card. */
  gaps: TitleFallback[];
}

/** One box, and everything the editor says about it that is not geometry. */
export interface AlbumEditorBox extends AlbumRect {
  /** The block that placed it — an album entry. */
  entryId: string;
  stampId: string;
  label: AlbumEditorText | null;
  catalogNumber: string | null;
  /** The strip it is cut from, in words, or null for a **pocket** — a piece no strip in stock is
   *  tall enough for (#765). */
  stripLabel: string | null;
  /** Where the size came from (#763). `inherited` is a checklist neighbour's figure and is flagged:
   *  a collector cutting to a borrowed number as if it had been measured is what that rule is
   *  arranged against. Null means nothing on the checklist states a size at all, and the box is
   *  drawn degenerate. */
  sizeSource: "stated" | "inherited" | null;
  /** Whose figure it borrowed, named the way a card names a stamp. */
  sizeFromCatalogNumber: string | null;
  /** The collector's own correction on this box, or null where the box rule's answer stands. */
  adjustment: AlbumBoxAdjustmentValue | null;
  /** True when the collector has started a new row of boxes at this one (#1214). */
  rowBreakBefore: boolean;
  /** Whether a break here could mean anything: false for the **first box of its block**, which
   *  already starts a row, and on a printed sheet, where nothing is set. The canvas offers the
   *  toggle and the panel the checkbox only where this is true, so neither promises a break that
   *  the layout would ignore. */
  rowBreakable: boolean;
  /** The picture the mount has, by `Photo.id` — drawn only when the sheet's preset prints photos, so
   *  the page editor can switch them without a re-plan (#1307). On a printed sheet this is the
   *  picture the **card** had, not the one the stamp has now — which is what makes a photo arriving afterwards a
   *  divergence to report rather than a silent substitution. */
  photoId: string | null;
}

/**
 * One element of a free page as the editor draws and edits it (#1429). The position and width are the
 * collector's own; the height is the plan's — a text's lines, a picture's proportions.
 */
export type AlbumEditorFreeElement =
  | (AlbumRect & {
      kind: "text";
      id: string;
      /** The placed text, lines wrapped by the measurer the PDF uses. */
      placed: AlbumEditorText;
      /** The words as typed, line breaks and all. */
      text: string;
      role: AlbumTextRole;
      sizePt: number;
      align: AlbumFreeTextAlign;
    })
  | (AlbumRect & {
      kind: "picture";
      id: string;
      pictureId: string;
      /** The library's name for it; blank on a printed card, which draws what it printed. */
      name: string;
      /** True for a picture that prints as lines. */
      vector: boolean;
      /** Dots per inch at its placed width, for a raster; null for a vector or on a card. */
      dpi: number | null;
      /** Below 300 dpi at this width — flagged before printing, never printed (#1429). */
      tooCoarse: boolean;
      /** Why an SVG prints as a picture rather than as lines, completing "the drawing …". */
      rasterReason: string | null;
    });

/** A page without stamps, on the sheet it is (#1429). */
export interface AlbumEditorFreePage {
  id: string;
  printTitle: boolean;
  printChapter: boolean;
  printFooter: boolean;
  /** Where it is filed. Null on a printed card, where nothing is set. */
  anchor: { albumEntryId: string | null; side: "before" | "after" } | null;
  /** In drawing order: a later element is drawn over an earlier one. */
  elements: AlbumEditorFreeElement[];
}

/** One block on the sheet, with the corrections that are settable on it. */
export interface AlbumEditorBlock {
  /** The album entry, the note's own id, or the free page's. */
  id: string;
  kind: "entry" | "text" | "page";
  /** Which sheet of a split block this is; 1 for a block that moved whole. */
  part: number;
  /** What this sheet printed for it — the marked `[2]`, `[3]` heading on a continuation sheet. */
  heading: string;
  /** How the editor names it in a list: the checklist's name, or the note's role. */
  name: string;
  firstBoxIndex: number;
  boxCount: number;
  /** The corrections in force. Null on a printed sheet, where there is nothing to set. */
  correction: {
    spaceBeforeMm: number;
    spaceAfterMm: number;
    breakBefore: "auto" | "always" | "avoid";
    /** The block starts a band of its own rather than sitting beside the one before it (#1421). */
    bandBreakBefore: boolean;
  } | null;
  /** Whether *start on its own line* could mean anything here (#1421): true when the block's first
   *  sheet sits **beside** the block before it, or when it has already been set so it can be set
   *  back. False on a continuation sheet, which opens a sheet of its own anyway, and on a printed
   *  sheet, where nothing is set. The canvas offers the tab and the panel the checkbox only where
   *  this is true, so neither promises a line the layout would ignore — #1214's `rowBreakable`, one
   *  level up. */
  bandBreakable: boolean;
  /** True when this album prints the block's stamps in an order of its own rather than the
   *  checklist's (#764) — the presence of override rows, which is what says so. */
  ordersItsOwn: boolean;
  /** A note's own text and voice; empty and `heading` for a checklist. */
  role: AlbumTextRole;
  text: string;
  /** Where a note is filed (#769). Null for a checklist, whose place in the album is its own order. */
  anchor: { albumEntryId: string | null; side: "before" | "after" } | null;
  /** True when this block asked **not** to be separated from what is above it and could not have it —
   *  it opens a sheet, so what it wanted to stay with is on the one before. Shown, always: a
   *  constraint dropped silently is one the collector finds out about with the card in his hand. */
  separated: boolean;
}

/** One sheet, drawn. */
export interface AlbumEditorSheet {
  /** One-based position **in this plan**, which is how a sheet is asked for and never how one is
   *  named: a page's identity is its catalog range (ADR-0045 §1) and never a number. */
  position: number;
  range: string;
  chapterKey: string;
  printedPageId: string | null;
  printedAt: string | null;
  /** True for a sheet in a binder. The editor works on **live** pages; a card is a stored result and
   *  correcting it is a decision (#778), not an edit. */
  readOnly: boolean;
  /** The preset this sheet is set in — the **card's own** for a printed one, which an album that has
   *  since changed template no longer names anywhere (ADR-0047 §1). */
  preset: AlbumRenderPreset;
  /** The ornament at the frame's corners (#1427) — the card's own copy for a printed sheet, the
   *  album's for a live one — or null. The canvas draws it through `album-frame.ts`, as the PDF does. */
  frameOrnament: AlbumOrnamentDrawing | null;
  content: AlbumRect;
  title: AlbumEditorText | null;
  chapter: AlbumEditorText | null;
  headings: AlbumEditorText[];
  footer: AlbumEditorText | null;
  boxes: AlbumEditorBox[];
  blocks: AlbumEditorBlock[];
  /** Every translation gap on the sheet, deduplicated by the entity row that would fix it. */
  gaps: TitleFallback[];
  /** What has changed under this card since it was printed (#778). Empty for a live sheet. */
  divergences: AlbumDivergence[];
  /** A page without stamps (#1429), or null on a sheet of stamps. */
  free: AlbumEditorFreePage | null;
  /** How the sheet's content sits vertically (#1419). `acted` is the placement as it acted on this
   *  sheet — `justify` on a sheet of one band acts as `top`. `opener` is the block that opens the
   *  sheet, which is where a page's own placement is kept; null on a printed sheet, where nothing is
   *  set, and on a sheet with no block on it. */
  placement: {
    acted: AlbumVerticalPlacement;
    opener: {
      id: string;
      kind: "entry" | "text" | "page";
      name: string;
      /** The page's own placement, or null where the sheet follows the album. */
      override: AlbumVerticalPlacement | null;
    } | null;
  };
}

export interface AlbumEditorData {
  album: AlbumData;
  entries: AlbumEntryData[];
  textBlocks: AlbumTextBlockData[];
  /** The album's pages without stamps (#1429). */
  freePages: AlbumFreePageData[];
  /** The collection's picture library, for placing one on a free page (#1429). */
  pictures: AlbumPictureData[];
  /** Every sheet of the plan, so the editor can offer a rail without a second read. Geometry is
   *  carried for the **selected** sheet alone: a page of boxes is a lot of millimetres to ship for a
   *  list, and the album screen already lists sheets without any of them. */
  sheets: {
    position: number;
    range: string;
    chapterKey: string;
    printed: boolean;
    /** A page without stamps, named by its first text rather than by a range it does not have. */
    free: { id: string; label: string } | null;
  }[];
  sheet: AlbumEditorSheet | null;
  /** True when the collection has described no hawid stock, which makes **every** box a pocket. */
  emptyStock: boolean;
  /** The texts across **every live sheet** that would print in the default language (#1308) — so a
   *  gap on a sheet not in view is found before printing, not after. A text printed on four sheets is
   *  four texts: each is a line on a card. */
  untranslated: { texts: number; sheets: number[] };
  /** The area's name in the album's language, offered in place of the default-language name (#1311). */
  nameSuggestion: string | null;
}

/** How a free page is named in a list: its first words, or what it is when it has none yet (#1429). */
export function freePageName(page: Pick<AlbumFreePageData, "elements">): string {
  const words = page.elements
    .filter((el) => el.kind === "text")
    .map((el) => el.text.replace(/\s+/g, " ").trim())
    .find((t) => t);
  if (words) return words.length > 60 ? `${words.slice(0, 59)}…` : words;
  return page.elements.length > 0 ? "A page of pictures" : "An empty page";
}

/** How many of a sheet's texts fell back, counting each placed text once. */
function untranslatedTexts(sheet: AlbumEditorSheet): number {
  const texts = [
    sheet.title,
    sheet.chapter,
    sheet.footer,
    ...sheet.headings,
    ...sheet.boxes.map((b) => b.label),
  ];
  return texts.filter((t) => t !== null && t.gaps.length > 0).length;
}

/** The face a role is set in — at its own size where a free page's text has one (#1429) — with
 *  everything a renderer needs to place its ink. */
function editorFace(
  preset: AlbumRenderPreset,
  role: AlbumTextRole,
  ownSizePt?: number,
): AlbumEditorFace {
  const { face, sizePt } = albumPlacedTextFace(preset, { role, sizePt: ownSizePt });
  const known = findAlbumFace(face);
  return {
    id: face,
    // A face this build no longer ships is named as itself rather than shown as a blank — the
    // measurer already falls back for it (ADR-0046 §5), and the screen should say which one it is.
    label: known?.label ?? face,
    cssStack: known?.cssStack ?? "serif",
    bold: known?.bold ?? false,
    italic: known?.italic ?? false,
    sizePt,
    sizeMm: sizePt * PT_TO_MM,
    lineHeightMm: albumTextMetrics.lineHeightMm(face, sizePt),
    baselineOffsetMm: albumBaselineOffsetMm(face, sizePt),
  };
}

function editorText(
  placed: {
    role: AlbumTextRole;
    lines: string[];
    sizePt?: number;
    align?: AlbumFreeTextAlign;
  } & AlbumRect,
  preset: AlbumRenderPreset,
  gaps: TitleFallback[],
): AlbumEditorText {
  return {
    role: placed.role,
    lines: placed.lines,
    xMm: placed.xMm,
    yMm: placed.yMm,
    widthMm: placed.widthMm,
    heightMm: placed.heightMm,
    face: editorFace(preset, placed.role, placed.sizePt),
    align: placed.align ?? "center",
    gaps,
  };
}

/**
 * A free page's elements as the editor draws them (#1429). `pictures` is the library as far as it is
 * known — on a printed card it may not be, and a card draws what it printed with no flag beside it.
 */
function editorFreeElements(
  free: AlbumPlacedFreePage,
  preset: AlbumRenderPreset,
  raw: AlbumFreePageData | null,
  pictures: ReadonlyMap<string, AlbumPictureRef> | null,
): AlbumEditorFreeElement[] {
  const typed = new Map(raw?.elements.map((el) => [el.id, el]) ?? []);
  return free.elements.map((el): AlbumEditorFreeElement => {
    const rect = { xMm: el.xMm, yMm: el.yMm, widthMm: el.widthMm, heightMm: el.heightMm };
    if (el.kind === "text") {
      const own = typed.get(el.id);
      return {
        ...rect,
        kind: "text",
        id: el.id,
        placed: editorText(el, preset, []),
        text: own?.text ?? el.lines.join("\n"),
        role: el.role,
        sizePt: el.sizePt ?? albumPlacedTextFace(preset, el).sizePt,
        align: el.align ?? "center",
      };
    }
    const picture = pictures?.get(el.pictureId) ?? null;
    const widthPx = picture && picture.kind === "raster" ? picture.widthPx : null;
    return {
      ...rect,
      kind: "picture",
      id: el.id,
      pictureId: el.pictureId,
      name: picture?.name ?? "",
      vector: picture?.kind === "vector",
      dpi: widthPx === null ? null : Math.round(albumPictureDpi(widthPx, el.widthMm)),
      tooCoarse: albumPictureTooCoarse(widthPx, el.widthMm),
      rasterReason: picture?.rasterReason ?? null,
    };
  });
}

function dedupeGaps(gaps: readonly TitleFallback[]): TitleFallback[] {
  const seen = new Set<string>();
  const out: TitleFallback[] = [];
  for (const gap of gaps) {
    const key = titleFallbackKey(gap);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(gap);
  }
  return out;
}

/**
 * One **live** sheet as the editor draws it.
 *
 * The blocks are walked with a cursor rather than by `firstBoxIndex`, which indexes the block's own
 * box list and not the page's — `placeBlock` pushes a block's boxes contiguously and `placeBand`
 * calls it once per block, so the page's boxes are grouped in block order by construction
 * (`snapshotBlocks` reads them the same way, and for the same reason).
 *
 * Exported for the album template's preview (#795), which plans a **synthetic** album from the
 * preset being edited and draws it through this same function. Reaching for a second sheet builder
 * there would be a second answer to *what does this template produce*, which is the one question the
 * preview exists to answer — and a preview that disagreed with the page editor and the PDF would be
 * worse than none.
 */
export function liveSheet(
  page: AlbumPlanPage,
  position: number,
  context: AlbumSheetSource,
  photoIdFor: (stampId: string) => string | null,
): AlbumEditorSheet | null {
  if (page.layout.kind !== "live") return null;
  const layout = page.layout;
  const album = context.album;
  const entryById = new Map(context.entries.map((e) => [e.id, e]));
  const noteById = new Map(context.textBlocks.map((n) => [n.id, n]));
  const freePageById = new Map(context.freePages.map((p) => [p.id, p]));

  const pageStampIds = layout.boxes.map((b) => b.box.stampId);
  const chapterEntries = context.entries.filter(
    (e) => (e.year === null ? "" : String(e.year)) === layout.chapterKey,
  );

  const blocks: AlbumEditorBlock[] = [];
  const boxes: AlbumEditorBox[] = [];
  const headings: AlbumEditorText[] = [];
  let cursor = 0;

  for (const block of layout.blocks) {
    const entry = entryById.get(block.entryId);
    const note = noteById.get(block.entryId);
    const freePage = block.kind === "page" ? freePageById.get(block.entryId) : undefined;
    /** The row the block's corrections live on — a note's own, or the entry's. */
    const corrected = note ?? entry;
    const slice = layout.boxes.slice(cursor, cursor + block.boxCount);
    cursor += block.boxCount;

    const placedHeading = layout.headings[headings.length];
    if (placedHeading && block.heading) {
      headings.push(
        editorText(
          placedHeading,
          album,
          // A note is the collector's own words and resolves no tokens, so it can fall back on
          // nothing; a checklist heading is a template over the stamps of its own block.
          note
            ? []
            : context.textGaps(
                album.checklistTemplate,
                slice.map((b) => b.box.stampId),
                entry,
              ),
        ),
      );
    }

    for (const [n, placed] of slice.entries()) {
      const box = placed.box;
      boxes.push({
        entryId: block.entryId,
        stampId: box.stampId,
        xMm: placed.xMm,
        yMm: placed.yMm,
        widthMm: placed.widthMm,
        heightMm: placed.heightMm,
        label: placed.label
          ? editorText(
              placed.label,
              album,
              context.textGaps(album.boxLabelTemplate, [box.stampId]),
            )
          : null,
        catalogNumber: box.catalogNumber,
        stripLabel: box.strip ? hawidStripLabel(box.strip) : null,
        sizeSource: box.sizeSource,
        sizeFromCatalogNumber:
          box.sizeSource === "inherited" && box.sizeFromStampId
            ? (layout.boxes.find((b) => b.box.stampId === box.sizeFromStampId)?.box
                .catalogNumber ?? null)
            : null,
        adjustment: entry?.boxAdjustments[box.stampId] ?? null,
        rowBreakBefore: box.rowBreakBefore === true,
        // Indexed into the **block's own** boxes, not the sheet's: the second sheet of a split
        // checklist opens on a box that is not the block's first, and a break there is real.
        rowBreakable: !!entry && block.firstBoxIndex + n > 0,
        // Shipped whether or not the album prints photos, and drawn by the canvas only when the
        // sheet's preset says so: the page editor switches photos on and off (#1307) and the canvas
        // follows at once, before the save's re-plan comes back.
        photoId: photoIdFor(box.stampId),
      });
    }

    blocks.push({
      id: block.entryId,
      kind: block.kind ?? "entry",
      part: block.part,
      heading: block.heading,
      name: freePage
        ? freePageName(freePage)
        : note
          ? note.text.trim().slice(0, 60) || "A note with nothing in it yet"
          : (entry?.checklistName ?? "This checklist is no longer in the album"),
      firstBoxIndex: block.firstBoxIndex,
      boxCount: block.boxCount,
      correction: note
        ? {
            spaceBeforeMm: note.spaceBeforeMm,
            spaceAfterMm: note.spaceAfterMm,
            breakBefore: note.breakBefore,
            bandBreakBefore: note.bandBreakBefore,
          }
        : entry
          ? {
              spaceBeforeMm: entry.spaceBeforeMm,
              spaceAfterMm: entry.spaceAfterMm,
              breakBefore: entry.breakBefore,
              bandBreakBefore: entry.bandBreakBefore,
            }
          : null,
      bandBreakable:
        !!corrected &&
        block.part === 1 &&
        (block.beside === true || corrected.bandBreakBefore),
      ordersItsOwn: entry?.ordersItsOwn ?? false,
      role: note?.role ?? "heading",
      text: note?.text ?? "",
      anchor: note
        ? { albumEntryId: note.anchorAlbumEntryId, side: note.side }
        : null,
      separated: block.separated === true,
    });
  }

  const chapterGaps = layout.chapter
    ? context.textGaps(
        album.chapterTemplate,
        chapterEntries.flatMap((e) => e.stampIds),
      )
    : [];
  const footerGaps = page.footer
    ? context.textGaps(album.footerTemplate, pageStampIds)
    : [];

  // The page's own placement is kept on the block that opens it (#1419) — whichever block the
  // layout placed first, which is the one it read the override from.
  // A free page has none: nothing on it is packed, so there is no leftover for a placement to spend.
  const openerBlock = layout.free ? undefined : blocks[0];
  const openerRow = openerBlock
    ? (noteById.get(openerBlock.id) ?? entryById.get(openerBlock.id))
    : undefined;

  return {
    position,
    range: page.range,
    chapterKey: layout.chapterKey,
    printedPageId: null,
    printedAt: null,
    readOnly: false,
    preset: album,
    frameOrnament: context.frameOrnament,
    content: layout.content,
    // The running head is the album's name, and falls back only as the name does (#1308).
    title: layout.title ? editorText(layout.title, album, context.titleGaps) : null,
    chapter: layout.chapter ? editorText(layout.chapter, album, chapterGaps) : null,
    headings,
    footer: page.footer ? editorText(page.footer, album, footerGaps) : null,
    boxes,
    blocks,
    gaps: dedupeGaps([
      ...(layout.title ? context.titleGaps : []),
      ...chapterGaps,
      ...headings.flatMap((h) => h.gaps),
      ...boxes.flatMap((b) => b.label?.gaps ?? []),
      ...footerGaps,
    ]),
    divergences: [],
    free: layout.free
      ? (() => {
          const own = freePageById.get(layout.free.id) ?? null;
          return {
            id: layout.free.id,
            printTitle: own?.printTitle ?? !!layout.title,
            printChapter: own?.printChapter ?? !!layout.chapter,
            printFooter: own?.printFooter ?? !!page.footer,
            anchor: own ? { albumEntryId: own.anchorAlbumEntryId, side: own.side } : null,
            elements: editorFreeElements(layout.free, album, own, context.pictures),
          };
        })()
      : null,
    placement: {
      acted: layout.placement ?? album.verticalPlacement,
      opener:
        openerBlock && openerRow
          ? {
              id: openerBlock.id,
              kind: openerBlock.kind,
              name: openerBlock.name,
              override: openerRow.pagePlacement,
            }
          : null,
    },
  };
}

/**
 * One **printed** sheet as the editor draws it: the stored result, and nothing resolved.
 *
 * Every value comes off the snapshot — the texts as they were wrapped, the boxes as they were
 * placed, the strip each was cut from as the drawer read that day, the picture each mount printed,
 * and the preset the sheet was set under. Reaching for the album's own columns here would draw a
 * sheet that is neither the card in the binder nor a new one (ADR-0047 §1).
 */
function printedSheet(
  snapshot: AlbumPageSnapshot,
  position: number,
  printedPageId: string,
  printedAt: string | null,
  divergences: AlbumDivergence[],
): AlbumEditorSheet {
  const preset = snapshot.preset;
  const layout = snapshot.page;
  const boxes: AlbumEditorBox[] = layout.boxes.map((placed) => {
    const box: AlbumSnapshotBox = placed.box;
    return {
      entryId: placed.entryId,
      stampId: box.stampId,
      xMm: placed.xMm,
      yMm: placed.yMm,
      widthMm: placed.widthMm,
      heightMm: placed.heightMm,
      label: placed.label ? editorText(placed.label, preset, []) : null,
      catalogNumber: box.catalogNumber,
      stripLabel: box.strip
        ? hawidStripLabel({ heightMm: box.strip.heightMm, label: box.strip.label })
        : null,
      sizeSource: box.sizeSource,
      sizeFromCatalogNumber: null,
      adjustment: null,
      rowBreakBefore: false,
      rowBreakable: false,
      photoId: box.photoId,
    };
  });

  let cursor = 0;
  const blocks: AlbumEditorBlock[] = layout.blocks.map((block) => {
    const first = cursor;
    cursor += block.boxCount;
    return {
      id: block.entryId,
      kind: block.kind ?? "entry",
      part: block.part,
      heading: block.heading,
      name: block.kind === "page" ? "A page without stamps" : block.heading || "(no heading)",
      firstBoxIndex: first,
      boxCount: block.boxCount,
      correction: null,
      bandBreakable: false,
      ordersItsOwn: false,
      role: "heading",
      text: "",
      anchor: null,
      // A card is a stored result: whatever the packer could not grant when it was planned is
      // already on the paper, and there is nothing left to warn about.
      separated: false,
    };
  });

  return {
    position,
    range: snapshot.range,
    chapterKey: snapshot.chapterKey,
    printedPageId,
    printedAt,
    readOnly: true,
    preset,
    frameOrnament: snapshot.frameOrnament,
    content: layout.content,
    title: layout.title ? editorText(layout.title, preset, []) : null,
    chapter: layout.chapter ? editorText(layout.chapter, preset, []) : null,
    headings: layout.headings.map((h) => editorText(h, preset, [])),
    footer: snapshot.footer ? editorText(snapshot.footer, preset, []) : null,
    boxes,
    blocks,
    gaps: [],
    divergences,
    free: layout.free
      ? {
          id: layout.free.id,
          printTitle: !!layout.title,
          printChapter: !!layout.chapter,
          printFooter: !!snapshot.footer,
          anchor: null,
          elements: editorFreeElements(layout.free, preset, null, null),
        }
      : null,
    placement: { acted: layout.placement ?? "top", opener: null },
  };
}

/**
 * The editor's whole payload for one album, with the geometry of the sheet being looked at.
 *
 * `position` is one-based into the plan the screen is about to list, which is how sheets are asked
 * for everywhere on this track and never how one is named (ADR-0046 §7). Out of range — or absent —
 * selects the first sheet, because arriving at an editor with nothing drawn says less than arriving
 * at the front of the album.
 */
export async function getAlbumEditorData(
  ownerId: string,
  albumId: string,
  /** A position, or a page without stamps by its own id (#1429). */
  position: number | { freePageId: string } | null,
): Promise<AlbumEditorData | null> {
  // One read, and the plan taken off it. The screen needs both — the geometry to draw and the rows
  // to say what is settable on it — and reading the album twice would be two answers to a question
  // with one, which on this track is how a screen ends up disagreeing with a card.
  const context = await albumPlanContext(ownerId, albumId);
  if (!context) return null;
  const plan = planAlbumFrom(context);

  const freeCards = new Map([...plan.printed.byFreePage].map(([pageId, cardId]) => [cardId, pageId]));
  const freePageById = new Map(context.freePages.map((p) => [p.id, p]));
  const sheets = plan.pages.map((page, i) => {
    const freeId =
      page.layout.kind === "live" ? page.layout.free?.id : freeCards.get(page.layout.printedPageId);
    const freePage = freeId ? freePageById.get(freeId) : undefined;
    return {
      position: i + 1,
      range: page.range,
      chapterKey: page.layout.chapterKey,
      printed: page.layout.kind === "printed",
      free: freeId
        ? { id: freeId, label: freePage ? freePageName(freePage) : "A page without stamps" }
        : null,
    };
  });

  const asked =
    position !== null && typeof position === "object"
      ? (sheets.find((row) => row.free?.id === position.freePageId)?.position ?? null)
      : position;
  const chosen =
    asked !== null && asked >= 1 && asked <= plan.pages.length
      ? asked
      : plan.pages.length > 0
        ? 1
        : null;

  let sheet: AlbumEditorSheet | null = null;
  if (chosen !== null) {
    const page = plan.pages[chosen - 1];
    if (page.layout.kind === "printed") {
      const printedPageId = page.layout.printedPageId;
      const [snapshots, report] = await Promise.all([
        getAlbumPageSnapshots(albumId, [printedPageId]),
        getAlbumPrintedReport(ownerId, albumId),
      ]);
      const snapshot = snapshots.get(printedPageId);
      if (snapshot) {
        const row = plan.printed.pages.get(printedPageId);
        sheet = printedSheet(
          snapshot,
          chosen,
          printedPageId,
          row?.printedAt.toISOString() ?? null,
          report.sheets.find((s) => s.id === printedPageId)?.divergences ?? [],
        );
      }
    } else {
      // Only the pictures on the sheet being drawn. An album's worth of them is a read the editor
      // has no use for, and the album screen already lists sheets without any.
      const photos = await resolveAlbumPhotos(
        context.album.collectionId,
        page.layout.boxes.map((b) => b.box.stampId),
      );
      sheet = liveSheet(
        page,
        chosen,
        context,
        (stampId) => photos.get(stampId)?.id ?? null,
      );
    }
  }

  // Every live sheet, drawn without its pictures, for the one figure the screen shows about the whole
  // album. A printed card is left out: what is on it is on it, and it reports a translation filled in
  // since as a divergence of its own (#778).
  const untranslated = { texts: 0, sheets: [] as number[] };
  plan.pages.forEach((page, i) => {
    const drawn = liveSheet(page, i + 1, context, () => null);
    const count = drawn ? untranslatedTexts(drawn) : 0;
    if (count === 0) return;
    untranslated.texts += count;
    untranslated.sheets.push(i + 1);
  });

  const pictures = await getAlbumPictures(ownerId, context.album.collectionId);

  return {
    album: context.album,
    entries: context.entries,
    textBlocks: context.textBlocks,
    freePages: context.freePages,
    pictures,
    sheets,
    sheet,
    emptyStock: plan.emptyStock,
    untranslated,
    nameSuggestion: plan.nameSuggestion,
  };
}

/**
 * Every text the album's live sheets would print in the default language (#1308), each once, in the
 * order the sheets reach them — the texts behind the editor's album-wide figure, for a caller that has
 * to name them rather than count them (the agent API, #1452). A printed card is left out, as it is
 * from the figure: what is on it is on it.
 */
export async function albumTranslationGaps(
  ownerId: string,
  albumId: string,
): Promise<{ language: string; gaps: TitleFallback[] } | null> {
  const context = await albumPlanContext(ownerId, albumId);
  if (!context) return null;
  const plan = planAlbumFrom(context);
  const gaps = plan.pages.flatMap(
    (page, i) => liveSheet(page, i + 1, context, () => null)?.gaps ?? [],
  );
  return { language: context.album.language, gaps: dedupeGaps(gaps) };
}

// -- The album screen's rows (#1430) -----------------------------------------------
//
// The album screen shows every sheet with a thumbnail and with what needs attention before it is
// printed. Both come from the sheet **as the editor draws it** — `liveSheet` for a live one, the
// snapshot for a card — so a figure on the album screen and a flag in the editor are one claim, and
// the thumbnail is a reduction of the drawing rather than a second drawing.

/** A sheet reduced to what a thumbnail draws: the paper, a bar where each line of text sits and each
 *  box. Millimetres, rounded to a tenth — far below what a thumbnail can show, and a sheet of forty
 *  boxes stays a few hundred bytes. */
export interface AlbumSheetSketch {
  widthMm: number;
  heightMm: number;
  /** One bar per printed line, as wide as the line's own ink — measured here, on the server, by the
   *  measurer the PDF uses, because the client does not measure (ADR-0045 §7). */
  lines: AlbumRect[];
  /** Each box, and whether the editor would flag it as a warning (never set on a printed card). */
  boxes: (AlbumRect & { flagged: boolean })[];
}

export interface AlbumSheetSummary {
  /** One-based position in the plan, as the album screen's listing numbers it. */
  position: number;
  sketch: AlbumSheetSketch | null;
  attention: AlbumSheetAttention;
}

const tenth = (mm: number) => Math.round(mm * 10) / 10;

function sheetSketch(sheet: AlbumEditorSheet): AlbumSheetSketch {
  const texts = [
    sheet.title,
    sheet.chapter,
    ...sheet.headings,
    ...sheet.boxes.map((b) => b.label),
    sheet.footer,
  ].filter((t): t is AlbumEditorText => t !== null);
  const lines: AlbumRect[] = [];
  for (const text of texts) {
    const { face } = text;
    // The ink of a line runs from its baseline up to roughly the cap height; the bar is that band.
    const inkMm = face.sizeMm * 0.7;
    text.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const widthMm = Math.min(text.widthMm, albumTextMetrics.measureMm(line, face.id, face.sizePt));
      lines.push({
        // Centred in its band, as both renderers set it.
        xMm: tenth(text.xMm + (text.widthMm - widthMm) / 2),
        yMm: tenth(text.yMm + i * face.lineHeightMm + face.baselineOffsetMm - inkMm),
        widthMm: tenth(widthMm),
        heightMm: tenth(inkMm),
      });
    });
  }
  return {
    widthMm: sheet.preset.pageWidthMm,
    heightMm: sheet.preset.pageHeightMm,
    lines,
    boxes: sheet.boxes.map((b) => {
      const flag = sheet.readOnly ? null : albumBoxFlag(b);
      return {
        xMm: tenth(b.xMm),
        yMm: tenth(b.yMm),
        widthMm: tenth(b.widthMm),
        heightMm: tenth(b.heightMm),
        flagged: flag !== null && flag !== "corrected",
      };
    }),
  };
}

/** What a live sheet needs looked at before it is printed — the editor's flags, counted. */
function sheetAttention(sheet: AlbumEditorSheet): AlbumSheetAttention {
  const out = { ...NO_ATTENTION, untranslated: untranslatedTexts(sheet) };
  for (const box of sheet.boxes) {
    const flag = albumBoxFlag(box);
    if (flag === "unmeasured") out.unmeasured += 1;
    else if (flag === "oversize") out.oversize += 1;
    else if (flag === "inherited") out.inherited += 1;
  }
  return out;
}

/**
 * Every sheet of a plan as the album screen lists it (#1430), from the context it was planned from.
 *
 * The live sheets are drawn exactly as `getAlbumEditorData` draws them for its album-wide figure —
 * without their pictures — so the summary's *untranslated texts* is the editor's number. The cards
 * are drawn from their snapshots, one read for all of them.
 */
export async function albumSheetSummaries(
  context: AlbumPlanContext,
  plan: AlbumPlanResult,
): Promise<AlbumSheetSummary[]> {
  const printedIds = plan.pages.flatMap((page) =>
    page.layout.kind === "printed" ? [page.layout.printedPageId] : [],
  );
  const snapshots = await getAlbumPageSnapshots(context.album.id, printedIds);

  return plan.pages.map((page, i) => {
    const position = i + 1;
    if (page.layout.kind === "printed") {
      const snapshot = snapshots.get(page.layout.printedPageId);
      return {
        position,
        sketch: snapshot
          ? sheetSketch(printedSheet(snapshot, position, page.layout.printedPageId, null, []))
          : null,
        attention: NO_ATTENTION,
      };
    }
    const drawn = liveSheet(page, position, context, () => null);
    return {
      position,
      sketch: drawn ? sheetSketch(drawn) : null,
      attention: drawn ? sheetAttention(drawn) : NO_ATTENTION,
    };
  });
}

/** Re-export so the editor's page component does not have to know which module a box's own type
 *  lives in. `AlbumBoxData` is the plan's; the editor never sees one directly. */
export type { AlbumBoxData };
