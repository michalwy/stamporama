import "server-only";
import { albumRoleFace, type AlbumRect, type AlbumTextRole } from "./album-layout";
import type { AlbumRenderPreset } from "./album-template-rules";
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
} from "./album-plan";
import { getAlbumPageSnapshots } from "./album-printed-pages";
import type { AlbumPageSnapshot, AlbumSnapshotBox } from "./album-snapshot";
import { getAlbumPrintedReport } from "./album-printing";
import type { AlbumDivergence } from "./album-divergence";
import { resolveAlbumPhotos } from "./album-photos";
import type { AlbumBoxAdjustmentValue } from "./album-corrections";
import type { AlbumData, AlbumEntryData, AlbumTextBlockData } from "./albums";

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
  "album" | "entries" | "textBlocks" | "textGaps"
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
  /** The picture the mount prints, by `Photo.id`. On a printed sheet this is the picture the **card**
   *  printed, not the one the stamp has now — which is what makes a photo arriving afterwards a
   *  divergence to report rather than a silent substitution. */
  photoId: string | null;
}

/** One block on the sheet, with the corrections that are settable on it. */
export interface AlbumEditorBlock {
  /** The album entry, or the note's own id. */
  id: string;
  kind: "entry" | "text";
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
  } | null;
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
}

export interface AlbumEditorData {
  album: AlbumData;
  entries: AlbumEntryData[];
  textBlocks: AlbumTextBlockData[];
  /** Every sheet of the plan, so the editor can offer a rail without a second read. Geometry is
   *  carried for the **selected** sheet alone: a page of boxes is a lot of millimetres to ship for a
   *  list, and the album screen already lists sheets without any of them. */
  sheets: { position: number; range: string; chapterKey: string; printed: boolean }[];
  sheet: AlbumEditorSheet | null;
  /** True when the collection has described no hawid stock, which makes **every** box a pocket. */
  emptyStock: boolean;
}

/** The face a role is set in, with everything a renderer needs to place its ink. */
function editorFace(
  preset: AlbumRenderPreset,
  role: AlbumTextRole,
): AlbumEditorFace {
  const { face, sizePt } = albumRoleFace(preset, role);
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
  placed: { role: AlbumTextRole; lines: string[] } & AlbumRect,
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
    face: editorFace(preset, placed.role),
    gaps,
  };
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
              ),
        ),
      );
    }

    for (const placed of slice) {
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
        photoId: album.printPhotos ? photoIdFor(box.stampId) : null,
      });
    }

    blocks.push({
      id: block.entryId,
      kind: block.kind ?? "entry",
      part: block.part,
      heading: block.heading,
      name: note
        ? note.text.trim().slice(0, 60) || "A note with nothing in it yet"
        : (entry?.checklistName ?? "This checklist is no longer in the album"),
      firstBoxIndex: block.firstBoxIndex,
      boxCount: block.boxCount,
      correction: note
        ? {
            spaceBeforeMm: note.spaceBeforeMm,
            spaceAfterMm: note.spaceAfterMm,
            breakBefore: note.breakBefore,
          }
        : entry
          ? {
              spaceBeforeMm: entry.spaceBeforeMm,
              spaceAfterMm: entry.spaceAfterMm,
              breakBefore: entry.breakBefore,
            }
          : null,
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

  return {
    position,
    range: page.range,
    chapterKey: layout.chapterKey,
    printedPageId: null,
    printedAt: null,
    readOnly: false,
    preset: album,
    content: layout.content,
    title: layout.title ? editorText(layout.title, album, []) : null,
    chapter: layout.chapter ? editorText(layout.chapter, album, chapterGaps) : null,
    headings,
    footer: page.footer ? editorText(page.footer, album, footerGaps) : null,
    boxes,
    blocks,
    gaps: dedupeGaps([
      ...chapterGaps,
      ...headings.flatMap((h) => h.gaps),
      ...boxes.flatMap((b) => b.label?.gaps ?? []),
      ...footerGaps,
    ]),
    divergences: [],
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
      name: block.heading || "(no heading)",
      firstBoxIndex: first,
      boxCount: block.boxCount,
      correction: null,
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
    content: layout.content,
    title: layout.title ? editorText(layout.title, preset, []) : null,
    chapter: layout.chapter ? editorText(layout.chapter, preset, []) : null,
    headings: layout.headings.map((h) => editorText(h, preset, [])),
    footer: snapshot.footer ? editorText(snapshot.footer, preset, []) : null,
    boxes,
    blocks,
    gaps: [],
    divergences,
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
  position: number | null,
): Promise<AlbumEditorData | null> {
  // One read, and the plan taken off it. The screen needs both — the geometry to draw and the rows
  // to say what is settable on it — and reading the album twice would be two answers to a question
  // with one, which on this track is how a screen ends up disagreeing with a card.
  const context = await albumPlanContext(ownerId, albumId);
  if (!context) return null;
  const plan = planAlbumFrom(context);

  const sheets = plan.pages.map((page, i) => ({
    position: i + 1,
    range: page.range,
    chapterKey: page.layout.chapterKey,
    printed: page.layout.kind === "printed",
  }));

  const chosen =
    position !== null && position >= 1 && position <= plan.pages.length
      ? position
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

  return {
    album: context.album,
    entries: context.entries,
    textBlocks: context.textBlocks,
    sheets,
    sheet,
    emptyStock: plan.emptyStock,
  };
}

/** Re-export so the editor's page component does not have to know which module a box's own type
 *  lives in. `AlbumBoxData` is the plan's; the editor never sees one directly. */
export type { AlbumBoxData };
