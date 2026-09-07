import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  getAlbum,
  getAlbumEntries,
  getAlbumTextBlocks,
  type AlbumData,
  type AlbumEntryData,
  type AlbumTextBlockData,
} from "./albums";
import { albumCorrectedStampSize } from "./album-corrections";
import { getHawidStrips, type HawidStripData } from "./hawid-stock";
import {
  albumHawidMargins,
  albumRenderPreset,
  renderAlbumText,
  type AlbumRenderPreset,
} from "./album-template-rules";
import { planHawidBox, type HawidBox } from "./hawid";
import { resolveStampSize, type StampSizeEntry } from "./stamp-size";
import { stampSizeFields, STAMP_SIZE_SELECT } from "./stamp-attributes";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { buildAreaVendorMaps, type AreaVendorMaps } from "./area-vendor";
import { getCollectionAreas } from "./areas";
import { loadIssuePrefixMap } from "./issue-prefix";
import {
  makeTitleCopyMapper,
  TITLE_COPY_STAMP_SELECT,
  type TitleCopyStampRow,
} from "./title-copy";
import {
  templateFallbacks,
  type TitleFallback,
  type TitleTemplateCopy,
} from "./offer-title-template";
import { albumTextMetrics } from "./album-metrics";
import { languageLabel } from "./languages";
import { getAlbumPrintedIndex, type AlbumPrintedIndex } from "./album-printed-pages";
import { albumPlanFingerprint } from "./album-print-rules";
import type { AlbumComparablePage } from "./album-divergence";
import {
  planAlbumPages,
  type AlbumPlan,
  type AlbumBoxSpec,
  type AlbumBlockSpec,
  type AlbumPlacedText,
  type AlbumPlannedPage,
} from "./album-layout";

// The album plan's server half (#767): what the pure layout engine (`album-layout.ts`) is fed, and
// what its output is named.
//
// **The geometry is not here and must never arrive here.** Every millimetre is decided in
// `album-layout.ts` over boxes sized by `hawid.ts` (#765), so the PDF (#768) and the editor canvas
// (#769) cannot drift apart. This module reads rows, resolves text in the album's language, and
// gives the page its identity.
//
// ## A page's identity is its catalog range
//
// `PL 303-309`, from `formatCatalogRange` (#400) over the primary-catalog numbers of the stamps that
// actually landed on the page, prefixed by the area's own catalog prefix. Never a page number: a
// number is a position, and a position moves when anything before it moves, so inserting one stamp
// would invalidate the numbering of every card already in the binder. A range is derived from the
// page's own contents, so an insertion disturbs the one card it lands on.
//
// ## A live page is a derivation; a printed one is a record
//
// Nothing about a live page is stored. It is planned from current data every time it is asked for.
// A page the collector marks **printed** is the other thing entirely — a stored result, kept whole
// in `album_printed_page.snapshot` (#778, `album-snapshot.ts`) — and this module never resolves
// anything for one. `AlbumBlockSpec.printedPageIds` is the seam: a block already on paper names the
// sheets it is on, states **no boxes**, and the planner steps over it rather than routing content
// around it.
//
// Three consequences of that seam, all deliberate:
//
// - A stamp on a printed page is not in the live plan at all. It is on the card, not in the
//   derivation.
// - A stamp that *joins* a checklist whose card is in a binder appears **nowhere**. The whole block
//   is skipped, and inventing a home for the stamp on the next live page would hide exactly the
//   thing the collector needs to be told about. That silence is what a **continuation page**
//   answers: `AlbumEntry.continuesPrintedPageId` set, the stamps on no sheet yet are planned as a
//   block of their own with its own catalog range, filed after the sheets that already carry them.
// - A sheet the collector has answered with a **reprint** is not in the printed index at all, so its
//   content is back in the live plan and re-plans in full. Its row survives to say a superseded card
//   is still in the binder.
//
// There is deliberately **nothing here that compares two plans**. A live page reshuffling harms
// nothing — that is what makes it live — so the only comparison with a customer is against paper.
// That report is `album-printing.ts`, over the pure diff in `album-divergence.ts`; what this module
// owes it is {@link albumPlanContext}, so the reference it plans is planned by the same reader.

/** One box of the plan: the piece of hawid, and everything a surface has to be able to say about it
 *  that is not geometry. */
export interface AlbumBoxData extends AlbumBoxSpec {
  stampId: string;
  /** The strip it is cut from, or **null** for an oversize box — a piece no strip in stock is tall
   *  enough for, which goes in a pocket (#765). The cutting list (#770) reads this. */
  strip: HawidStripData | null;
  /** Where the size came from (#763). `inherited` means a checklist neighbour's figure, and anything
   *  drawn from one has to say so — a collector cutting to an inherited number as if it had been
   *  measured is the failure that whole rule is arranged against. Null when nothing on the checklist
   *  states a size at all. */
  sizeSource: "stated" | "inherited" | null;
  /** The stamp the size was taken from — this stamp when `stated`, null when nothing stated one. */
  sizeFromStampId: string | null;
  /** The stamp's primary-catalog number, for the page's range. Null for a stamp with no number,
   *  which contributes nothing to the identity of the page it sits on. */
  catalogNumber: string | null;
  catalogSortKey: string | null;
  /** True when the collector has corrected this box by hand (#769). A fact about **how the figure
   *  was arrived at**, kept for the same reason `sizeSource` is: the editor and the cutting list have
   *  to be able to say that a cut is one somebody typed rather than one the drawer decided. It is
   *  not printed and it is not compared. */
  sizeAdjusted: boolean;
}

/** A page as the plan hands it over: the geometry, its identity, and the footer rendered into the
 *  band the layout reserved for it. */
export interface AlbumPlanPage {
  /** The page's catalog range — `PL 303-309` — or blank for a page whose stamps carry no numbers. */
  range: string;
  layout: AlbumPlannedPage<AlbumBoxData>;
  /** The footer text placed in the reserved band. Null when the template prints none — and always
   *  for a printed sheet, whose footer is in its snapshot with everything else it printed. */
  footer: AlbumPlacedText | null;
}

export interface AlbumPlanResult {
  album: AlbumData;
  entries: AlbumEntryData[];
  pages: AlbumPlanPage[];
  /** What of this album is already on paper (#778) — read once here so nothing downstream reads it
   *  a second time and gets a different answer. */
  printed: AlbumPrintedIndex;
  /** True when the collection has described no hawid stock, which makes **every** box oversize
   *  (#765). Deliberate on the rule's part, and worth saying out loud on the screen rather than
   *  leaving a page of pocket-mounted definitives to be puzzled over. */
  emptyStock: boolean;
}

const PLAN_STAMP_SELECT = {
  ...TITLE_COPY_STAMP_SELECT,
  ...STAMP_SIZE_SELECT,
  primaryCatalogSortKey: true,
} satisfies Prisma.StampSelect;

type PlanStampRow = TitleCopyStampRow & {
  widthMm: Prisma.Decimal | null;
  heightMm: Prisma.Decimal | null;
  primaryCatalogSortKey: string | null;
};

/** The stamp's number in the album's own catalogue — the area's primary vendor — and the prefix the
 *  page range is written under. Both come from the shared area-vendor resolution, so a box label and
 *  a footer cannot disagree about which book the page is in. */
function primaryNumber(
  stamp: PlanStampRow,
  maps: AreaVendorMaps
): { number: string | null; prefix: string | null } {
  const link = stamp.stampAreaLinks.find((a) => a.isPrimary) ?? stamp.stampAreaLinks[0];
  const areaId = link?.collectionAreaId ?? null;
  const issueId = stamp.issueMemberships[0]?.issue.id ?? null;
  const primaryVendorId = areaId ? (maps.primaryVendorByArea.get(areaId) ?? null) : null;
  const vendorMap = maps.vendorMapFor(areaId, issueId);
  const cn =
    stamp.catalogNumbers.find((c) => c.catalogVendorId === primaryVendorId) ??
    stamp.catalogNumbers[0] ??
    null;
  if (!cn) return { number: null, prefix: null };
  return { number: cn.number, prefix: vendorMap.get(cn.catalogVendorId)?.prefix ?? null };
}

/**
 * Everything an album needs read and resolved before any geometry happens.
 *
 * Split out of {@link planAlbum} because the **divergence report** (#778) has to plan a second time,
 * over one printed card's own entries rather than the whole album, and it must reach the same
 * answers: the same sizes, the same boxes out of the same drawer, the same texts in the same
 * language, the same range under the same prefix. Two readers of that would be two answers to a
 * question with one, and the answer that is wrong is the one that says a card in a binder is fine.
 *
 * The order of operations matters and is stated because each step depends on the one before it:
 * sizes resolve through the checklist (#763), the box comes from the size plus the album's own
 * clearances and the live stock (#765), and the texts render in the album's language (#755). The
 * geometry happens after all of it, once, in `album-layout.ts`.
 *
 * `presetOverride` answers *what would this album look like under that preset* and has one caller,
 * the album template's preview (#795). Nothing is written and the album keeps the values copied onto
 * it; see the note where it is substituted for why it has to be substituted there and not later.
 */
export interface AlbumPlanContext {
  album: AlbumData;
  entries: AlbumEntryData[];
  /** The collector's own text blocks (#769), in the order they are filed. */
  textBlocks: AlbumTextBlockData[];
  printed: AlbumPrintedIndex;
  emptyStock: boolean;
  /** The boxes of `stampIds`, sized through the whole entry's checklist. */
  boxesFor(entry: AlbumEntryData, stampIds: readonly string[]): AlbumBoxData[];
  /** The entry's checklist heading, rendered in the album's language. */
  checklistHeading(entry: AlbumEntryData): string;
  /** The chapter heading a year group of these entries prints. */
  chapterHeading(entries: readonly AlbumEntryData[]): string;
  /**
   * Which entity fields one of the album's texts rendered **untranslated** for these stamps (#298).
   *
   * An album prints in one language of its own (#755) and every token falls back to the entity's
   * default-language value when a translation is missing. On a screen that is a small annoyance; on a
   * card glued into a binder it is permanent, so the editor (#769) flags it before the sheet goes
   * into the printer and offers to fill the gap in place (#299/#300).
   *
   * Asked **per template**, not per stamp, so a missing translation on a field none of the album's
   * four texts names is not reported — `templateFallbacks` walks the template's own placeholders,
   * which is what makes the flag on the page and the gap in the panel the same claim. And no
   * fallback template is passed: a blank album text is a real value (#766) and renders blank, so it
   * can fall back on nothing.
   */
  textGaps(template: string, stampIds: readonly string[]): TitleFallback[];
  /** Name each page of a laid-out plan and render its footer into the band reserved for it. */
  finish(plan: AlbumPlan<AlbumBoxData>): AlbumPlanPage[];
}

export async function albumPlanContext(
  ownerId: string,
  albumId: string,
  presetOverride: AlbumRenderPreset | null = null
): Promise<AlbumPlanContext | null> {
  const row = await getAlbum(ownerId, albumId);
  if (!row) return null;
  // The album's own values, unless a caller is asking *what would this album look like under that
  // preset* — which is the album template's preview (#795) and nothing else. It is read-only in the
  // strongest sense: the override never reaches a write, the album keeps the values copied onto it
  // (#308's rule, #766), and the next read of this album is unaffected. It is substituted **here**,
  // before anything is resolved, because the clearances are read once into `margins` below and the
  // texts are read through this object — a caller swapping the preset afterwards would get the new
  // faces with the old box heights, which is precisely the confident wrong answer a preview must
  // never produce.
  const album: AlbumData = presetOverride ? { ...row, ...presetOverride } : row;
  const [entries, textBlocks] = await Promise.all([
    getAlbumEntries(ownerId, albumId),
    getAlbumTextBlocks(ownerId, albumId),
  ]);

  const [stock, areas, issuePrefixes, toCopy, printed] = await Promise.all([
    getHawidStrips(ownerId, album.collectionId),
    getCollectionAreas(ownerId, album.collectionId),
    loadIssuePrefixMap(album.collectionId),
    makeTitleCopyMapper(ownerId, album.collectionId, album.language),
    getAlbumPrintedIndex(albumId),
  ]);
  const maps = buildAreaVendorMaps(areas, issuePrefixes);

  const stampIds = [...new Set(entries.flatMap((e) => e.stampIds))];
  const rows = stampIds.length
    ? await prisma.stamp.findMany({
        where: { id: { in: stampIds } },
        select: PLAN_STAMP_SELECT,
      })
    : [];
  const byId = new Map<string, PlanStampRow>(rows.map((r) => [r.id, r as PlanStampRow]));

  // One `TitleTemplateCopy` per stamp, resolved in the album's language through the very mapper an
  // offer title uses — a box label and a listing title must name a stamp the same way.
  const copyById = new Map<string, TitleTemplateCopy>();
  for (const [id, stamp] of byId) {
    copyById.set(
      id,
      toCopy({
        id,
        // An album box is a catalogue slot, not an owned copy: no copy number, no condition, no
        // certificate, no format, no location. That is the whole point of a page that doubles as a
        // want list (#755), and `ALBUM_BOX_LABEL_TOKENS` leaves those tokens out for the same reason.
        itemNo: null,
        stamp,
        condition: null,
        certificateStatus: null,
        format: null,
        location: null,
        locationRef: null,
      })
    );
  }

  const margins = albumHawidMargins(album);

  /** The boxes of `stampIds`, sized through the whole entry.
   *
   *  The list is passed rather than taken from the entry because a **continuation page** (#778)
   *  prints only the stamps of an entry that are on no sheet yet. The size resolution still runs over
   *  the entry's whole checklist: a neighbour's figure is evidence because the series came off one
   *  sheet, and which of them happens to be on paper already has nothing to do with that. */
  const boxesFor = (entry: AlbumEntryData, stampIds: readonly string[]): AlbumBoxData[] => {
    // Sizes resolve through the checklist **in catalog sort order** — that order is the press run,
    // and a neighbour's size is only evidence because `301` and `302` came off the same sheet
    // (#763). The album's own print order is a display choice and must not move the resolution.
    const sizeEntries: StampSizeEntry[] = entry.stampIds
      .map((id) => ({ id, row: byId.get(id) }))
      .filter((e): e is { id: string; row: PlanStampRow } => !!e.row)
      .sort(
        (a, b) =>
          compareCatalogSortKeys(a.row.primaryCatalogSortKey, b.row.primaryCatalogSortKey) ||
          a.id.localeCompare(b.id)
      )
      .map((e) => ({ stampId: e.id, ...stampSizeFields(e.row) }));

    return stampIds.flatMap((stampId) => {
      const stamp = byId.get(stampId);
      if (!stamp) return [];
      const resolved = resolveStampSize(sizeEntries, stampId);
      const copy = copyById.get(stampId);
      const label = copy
        ? renderAlbumText(album.boxLabelTemplate, [copy], { albumName: album.name })
        : "";
      // A stamp nobody on the checklist has measured still gets a box — a slot missing from a page
      // is a slot the collector never notices is missing, and the page is a want list. It gets a
      // **degenerate** one, the clearances and nothing else, rather than a plausible default: an
      // invented size that looks like a stamp is exactly what #763 exists to prevent, and this box
      // is visibly not one. `sizeSource` is null, the editor (#769) says so, and the cutting list
      // (#770) has nothing to cut.
      const stated = resolved ?? { widthMm: 0, heightMm: 0 };
      // The collector's own correction on **this box** (#769), applied to the stamp's size *before*
      // the box rule runs. Not to the box the rule produced: a hawid box's height is the height of
      // the shortest strip the piece fits into, so correcting the finished box would draw one at a
      // height no strip has — the page-disagrees-with-the-desk failure #765 exists to prevent. So the
      // height moves in strip steps and the width, which is the cut, moves continuously.
      const adjustment = entry.boxAdjustments[stampId] ?? null;
      const size = albumCorrectedStampSize(stated, adjustment);
      const hawid: HawidBox<HawidStripData> = planHawidBox(size, margins, stock);
      const { number } = primaryNumber(stamp, maps);
      return [
        {
          widthMm: hawid.widthMm,
          heightMm: hawid.heightMm,
          label,
          stampId,
          strip: hawid.strip,
          sizeSource: resolved?.source ?? null,
          sizeFromStampId: resolved?.fromStampId ?? null,
          catalogNumber: number,
          catalogSortKey: stamp.primaryCatalogSortKey,
          sizeAdjusted: adjustment !== null,
        },
      ];
    });
  };

  // The area's own prefix, for the page range. Taken from the album's area rather than per stamp: an
  // album is scoped to one area and the footer names the binder, so `PL 303-309` is the whole of it.
  const areaPrefix = albumAreaPrefix(album, maps, byId);

  const copiesOf = (entries: readonly AlbumEntryData[]): TitleTemplateCopy[] =>
    entries
      .flatMap((e) => e.stampIds)
      .map((id) => copyById.get(id))
      .filter((c): c is TitleTemplateCopy => !!c);

  return {
    album,
    entries,
    textBlocks,
    printed,
    emptyStock: stock.length === 0,
    boxesFor,
    checklistHeading: (entry) =>
      renderAlbumText(album.checklistTemplate, copiesOf([entry]), {
        albumName: album.name,
        checklistName: entry.checklistName,
      }),
    chapterHeading: (forEntries) =>
      renderAlbumText(album.chapterTemplate, copiesOf(forEntries), { albumName: album.name }),
    textGaps: (template, stampIds) => {
      if (!template.trim()) return [];
      const copies = stampIds
        .map((id) => copyById.get(id))
        .filter((c): c is TitleTemplateCopy => !!c);
      return templateFallbacks(template, [{ title: null, copies }]);
    },
    finish: (plan) =>
      plan.pages.map((page) => {
        if (page.kind === "printed") {
          // A printed sheet is named by what was printed on it, not by what its stamps would now
          // produce — the range is part of the stored result, like everything else on the card.
          return {
            range: printed.pages.get(page.printedPageId)?.range ?? "",
            layout: page,
            footer: null,
          };
        }
        const range = pageRange(
          page.boxes.map((b) => b.box),
          areaPrefix
        );
        let footer: AlbumPlacedText | null = null;
        if (page.footer) {
          const text = renderAlbumText(
            album.footerTemplate,
            page.boxes
              .map((b) => copyById.get(b.box.stampId))
              .filter((c): c is TitleTemplateCopy => !!c),
            { albumName: album.name, pageRange: range }
          );
          // One line by construction. The layout reserved exactly one, because a footer allowed to
          // wrap would make the height of the page's content depend on the page's own contents — the
          // plan would be solving for its own output. A footer too long for the sheet overhangs,
          // visibly.
          footer = text ? { role: "footer", lines: [text], ...page.footer } : null;
        }
        return { range, layout: page, footer };
      }),
  };
}

/**
 * Plan an album's pages from current data.
 *
 * Chapters are **runs** of consecutive entries sharing a year, not a re-sort into year buckets. The
 * album prints in the collector's own entry order (#767), so a reorder that interleaves years
 * produces two chapters headed 1938 rather than silently pulling the entries back together: a layout
 * that quietly re-sorts what the collector arranged is a layout they cannot predict, and this one is
 * printed.
 */
export async function planAlbum(ownerId: string, albumId: string): Promise<AlbumPlanResult | null> {
  const context = await albumPlanContext(ownerId, albumId);
  return context ? planAlbumFrom(context) : null;
}

/**
 * {@link planAlbum} over a context the caller already has.
 *
 * The editor (#769) needs both the plan and the context it was planned from — the geometry to draw
 * and the entries, notes and corrections to say what is settable on it — and reading the album twice
 * would be two answers to a question with one. That is the same reason `albumPlanContext` was split
 * out for the divergence report in the first place.
 */
export function planAlbumFrom(context: AlbumPlanContext): AlbumPlanResult {
  const { album, entries, printed } = context;

  // The collector's notes (#769), filed by the entry each is anchored to and by which side of it.
  // An **anchor rather than a position**: a note travels with the series it is about when the album
  // is reordered, and a position is exactly the thing this model refuses to store. The side is not
  // tidiness — *after 1949's last checklist* and *before 1950's first* name one gap today and two
  // different ones the moment the album is reordered, and a note that opens a chapter needs the
  // second.
  const notesAt = new Map<string, AlbumTextBlockData[]>();
  const slot = (anchorId: string | null, side: string) => `${anchorId ?? ""}#${side}`;
  for (const note of context.textBlocks) {
    const at = slot(note.anchorAlbumEntryId, note.side);
    notesAt.set(at, [...(notesAt.get(at) ?? []), note]);
  }
  // Anchored to nothing: the head of the album, and the end of it. Both are steadier than naming the
  // first or last checklist, neither of which stays the first or the last.
  const headNotes = notesAt.get(slot(null, "before")) ?? [];
  const tailNotes = notesAt.get(slot(null, "after")) ?? [];
  let headNotesFiled = headNotes.length === 0;
  // Which sheet a note is on is the **printed index's** answer, not the note's own column: a card
  // being reprinted has its content back in the live plan, and the note beside a checklist on that
  // card has to come back with it.
  const noteBlock = (note: AlbumTextBlockData) =>
    albumNoteBlock(note, printed.byTextBlock.get(note.id) ?? null);

  const chapters: { key: string; heading: string; blocks: AlbumBlockSpec<AlbumBoxData>[] }[] = [];
  for (const entry of entries) {
    const key = entry.year === null ? "" : String(entry.year);
    let chapter = chapters[chapters.length - 1];
    if (!chapter || chapter.key !== key) {
      chapter = { key, heading: context.chapterHeading([entry]), blocks: [] };
      chapters.push(chapter);
    }
    if (!headNotesFiled) {
      for (const note of headNotes) chapter.blocks.push(noteBlock(note));
      headNotesFiled = true;
    }
    for (const note of notesAt.get(slot(entry.id, "before")) ?? [])
      chapter.blocks.push(noteBlock(note));
    const heading = context.checklistHeading(entry);
    const onPaper = printed.byEntry.get(entry.id);

    if (!onPaper) {
      chapter.blocks.push({
        entryId: entry.id,
        heading,
        kind: "entry",
        boxes: context.boxesFor(entry, entry.stampIds),
        printedPageIds: null,
        spaceBeforeMm: entry.spaceBeforeMm,
        spaceAfterMm: entry.spaceAfterMm,
        breakBefore: entry.breakBefore,
      });
      for (const note of notesAt.get(slot(entry.id, "after")) ?? [])
        chapter.blocks.push(noteBlock(note));
      continue;
    }

    // A block already on paper **states no boxes**. What is on that card is in its snapshot, and
    // resolving a live figure here — even one nothing draws — is exactly what a printed page must
    // not do: the layout steps over the block whole, and a box computed for it could only ever be a
    // second, quieter answer to a question the snapshot has already answered.
    chapter.blocks.push({
      entryId: entry.id,
      heading,
      kind: "entry",
      boxes: [],
      printedPageIds: onPaper.printedPageIds,
      // A block on paper carries the collector's corrections all the same, and they change nothing:
      // the layout steps over it before it ever measures one. They are here because the block is the
      // entry, and an entry that comes back into the plan — a reprint (#778) — must come back with
      // the corrections it had, not with none.
      spaceBeforeMm: entry.spaceBeforeMm,
      spaceAfterMm: entry.spaceAfterMm,
      breakBefore: entry.breakBefore,
    });

    // The **continuation page** (#778): the stamps of this entry that are on no sheet yet, filed
    // straight after the sheets that already carry it, with a catalog range of its own. Only when
    // the collector has asked for one — without that the stamps appear nowhere, which is the
    // deliberate silence ADR-0045 describes and the thing they need to be told about.
    if (entry.continuesPrintedPageId) {
      const waiting = entry.stampIds.filter((id) => !onPaper.stampIds.has(id));
      if (waiting.length > 0) {
        chapter.blocks.push({
          entryId: entry.id,
          heading,
          kind: "entry",
          boxes: context.boxesFor(entry, waiting),
          printedPageIds: null,
          spaceBeforeMm: entry.spaceBeforeMm,
          spaceAfterMm: entry.spaceAfterMm,
          breakBefore: entry.breakBefore,
        });
      }
    }
    for (const note of notesAt.get(slot(entry.id, "after")) ?? [])
      chapter.blocks.push(noteBlock(note));
  }

  // An album that is nothing but notes — no checklists gathered yet, or every one removed — still
  // has something to lay out. A chapter with no year is what a checklist spanning issues already
  // produces, so this is the shape the planner has rather than a special case.
  if (!headNotesFiled) {
    chapters.push({ key: "", heading: "", blocks: headNotes.map(noteBlock) });
  }
  // The album's closing notes go at the end of its last chapter — or open one of their own when
  // there is nothing else in the album at all.
  if (tailNotes.length > 0) {
    const last = chapters[chapters.length - 1];
    const into = last ?? { key: "", heading: "", blocks: [] };
    if (!last) chapters.push(into);
    for (const note of tailNotes) into.blocks.push(noteBlock(note));
  }

  const pages = context.finish(planAlbumPages(chapters, album, album.name, albumTextMetrics));
  return { album, entries, pages, printed, emptyStock: context.emptyStock };
}

/**
 * One of the collector's own notes as a block the packer can place (#769).
 *
 * A block with a **role and no boxes**: the layout measures its text in whichever of the template's
 * five voices the note names, gives it the ordinary lead plus whatever correction it carries, and
 * moves it whole like anything else. There is nothing special about it in `album-layout.ts`, which is
 * the point — a note that needed its own branch in the packer would be a second geometry.
 *
 * A note that is **on a card** names that sheet, exactly as an entry on paper does, so the plan steps
 * over it rather than emitting it again on live paper (ADR-0047 §4).
 */
export function albumNoteBlock(
  note: AlbumTextBlockData,
  printedPageId: string | null
): AlbumBlockSpec<AlbumBoxData> {
  return {
    entryId: note.id,
    kind: "text",
    role: note.role,
    heading: note.text,
    boxes: [],
    printedPageIds: printedPageId ? [printedPageId] : null,
    spaceBeforeMm: note.spaceBeforeMm,
    spaceAfterMm: note.spaceAfterMm,
    breakBefore: note.breakBefore,
  };
}

/** The separator between a page range's endpoints.
 *
 *  A plain hyphen, and **not** the en dash the collector's own `PAGE_START(303–309)` uses. That was
 *  put to him with the same argument that won the full endpoints below — ~140 cards in the binder
 *  carry the dash — and he went the other way: one separator across the footer, generated offer
 *  titles and lot names is worth more than matching a mark at 8 pt. So `CATALOG_RANGE_SEPARATOR`
 *  stands, and only the *shortening* is the album's own. Asked and answered; not an oversight. */
export const PAGE_RANGE_SEPARATOR = "-";

/**
 * A page's identity: the area's catalog prefix and the span of the primary-catalog numbers on it.
 *
 * The endpoints are the **catalog-lowest and catalog-highest** numbers on the page, not the first and
 * last printed: a page is identified by what it covers, and an album whose entries have been
 * reordered still holds the same span.
 *
 * ## Both endpoints are written out in full
 *
 * `PL 303-309`, not `PL 303-09`. This is the one place the album deliberately does **not** use
 * `formatCatalogRange` (#400), which #767 named for it. That module shortens a same-width span by
 * dropping the digits its endpoints share — `1298-1302` → `1298-302`, `303-309` → `303-09` — and it
 * is right to, everywhere it is read on a screen.
 *
 * A page range is not read on a screen. It is printed onto a card that is filed **beside roughly a
 * hundred and forty cards the collector wrote by hand**, every one of which writes the span out:
 * `PAGE_START(303–309)`, `PAGE_START(310–329)`. A shortened range would make every new sheet
 * announce itself as coming from somewhere else — the same argument that picked Liberation over any
 * other metric-compatible face (`album-fonts.ts`), one layer up. Decided with the collector.
 *
 * Blank for a page whose stamps carry no numbers at all — a page nothing can name, which the screen
 * says rather than inventing a label for.
 */
export function pageRange(boxes: readonly AlbumBoxData[], areaPrefix: string | null): string {
  const numbered = boxes
    .filter((b) => b.catalogNumber)
    .sort(
      (a, b) =>
        compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey) ||
        a.stampId.localeCompare(b.stampId)
    );
  if (numbered.length === 0) return "";
  const from = numbered[0].catalogNumber!;
  const to = numbered[numbered.length - 1].catalogNumber!;
  const span = from === to ? from : `${from}${PAGE_RANGE_SEPARATOR}${to}`;
  return areaPrefix ? `${areaPrefix} ${span}` : span;
}

/** The catalog prefix a whole album's pages are written under: the album's own area, resolved for
 *  the vendor that leads its numbering. Falls back to the prefix of the first numbered stamp, which
 *  is what an album anchored on a grouping area with no prefix of its own has. */
function albumAreaPrefix(
  album: AlbumData,
  maps: AreaVendorMaps,
  byId: ReadonlyMap<string, PlanStampRow>
): string | null {
  const vendorId = maps.primaryVendorByArea.get(album.collectionAreaId) ?? null;
  const own = vendorId
    ? (maps.vendorMapFor(album.collectionAreaId, null).get(vendorId)?.prefix ?? null)
    : null;
  if (own) return own;
  for (const stamp of byId.values()) {
    const { prefix } = primaryNumber(stamp, maps);
    if (prefix) return prefix;
  }
  return null;
}

// ── The plan as a screen reads it ────────────────────────────────────────────
//
// The geometry stays on the server until something draws it. The album screen lists sheets — what
// each one is called, what is on it, and what about it needs attention before it is printed — and
// shipping every box's millimetre coordinates to render that would be a lot of bytes for a list.
// The PDF (#768) and the editor canvas (#769) take the full {@link AlbumPlanPage} instead.

/** One page of the plan as the album screen shows it. */
export interface AlbumPlanPageView {
  /** The page's identity — its catalog range. Blank for a page whose stamps carry no numbers. */
  range: string;
  chapterKey: string;
  /** Set for a sheet that has already been printed (#778); the plan steps over it. */
  printedPageId: string | null;
  /** When it went onto paper, for a printed sheet. */
  printedAt: string | null;
  /** The sheets that must go onto paper **with** this one, as one-based positions including its own.
   *
   *  A checklist too tall for a page runs across two or three sheets, and marking half of it printed
   *  is not a state the album can hold. Rather than refusing the gesture and leaving the collector to
   *  work out which other sheets to pick, the listing says so and the action sends the whole run.
   *  A single-sheet page holds just its own position. */
  runWith: number[];
  /** The checklist headings on the sheet, in reading order. */
  headings: string[];
  /** A heading continued from the previous page — a block too tall for one column. The PDF marks
   *  such a sheet `[2]`, `[3]` on the heading itself (#768); this flag is just the chip. */
  continued: boolean;
  boxCount: number;
  /** Boxes no strip in stock can supply, which go in a pocket (#765). */
  oversizeCount: number;
  /** Boxes whose size came from a checklist neighbour rather than from the stamp itself (#763).
   *  Shown, always: a collector cutting to an inherited figure as if it had been measured is what
   *  that rule is arranged against. */
  inheritedSizeCount: number;
  /** Boxes for stamps nothing on the checklist has measured — drawn degenerate, and uncuttable. */
  unmeasuredCount: number;
  footer: string | null;
}

export interface AlbumPlanOverview {
  pages: AlbumPlanPageView[];
  emptyStock: boolean;
  /** The fingerprint of the plan these sheets were listed from (#778).
   *
   *  Marking a sheet printed is chosen by **position** in this listing, exactly as printing one is
   *  — but it is a write, and a position read from a plan that has since moved would freeze the
   *  wrong card. The screen sends this back with the positions and a mark against a plan that no
   *  longer matches is refused. *Reprinting* a card takes the card's own identity instead; it is
   *  never a position. */
  fingerprint: string;
}

/** {@link planAlbum}'s result, reduced to what a list of sheets needs. */
export function albumPlanOverview(result: AlbumPlanResult): AlbumPlanOverview {
  // Live sheets joined by a checklist that runs across them. Transitive, because a split block's
  // last sheet can carry the next checklist too.
  const runOf = new Map<number, number[]>();
  {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      let root = parent.get(i) ?? i;
      while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
      parent.set(i, root);
      return root;
    };
    const firstSheetOf = new Map<string, number>();
    result.pages.forEach((page, i) => {
      if (page.layout.kind !== "live") return;
      parent.set(i, find(i));
      for (const block of page.layout.blocks) {
        const held = firstSheetOf.get(block.entryId);
        if (held === undefined) {
          firstSheetOf.set(block.entryId, i);
          continue;
        }
        const a = find(held);
        const b = find(i);
        if (a !== b) parent.set(b, a);
      }
    });
    const groups = new Map<number, number[]>();
    result.pages.forEach((page, i) => {
      if (page.layout.kind !== "live") return;
      const root = find(i);
      const held = groups.get(root) ?? [];
      held.push(i + 1);
      groups.set(root, held);
    });
    result.pages.forEach((page, i) => {
      if (page.layout.kind !== "live") return;
      runOf.set(i, groups.get(find(i)) ?? [i + 1]);
    });
  }

  return {
    emptyStock: result.emptyStock,
    fingerprint: albumPlanFingerprint(albumPlanPrint(result.pages)),
    pages: result.pages.map((page, index) => {
      if (page.layout.kind === "printed") {
        const row = result.printed.pages.get(page.layout.printedPageId);
        return {
          range: page.range,
          chapterKey: page.layout.chapterKey,
          printedPageId: page.layout.printedPageId,
          printedAt: row?.printedAt.toISOString() ?? null,
          runWith: [],
          headings: [],
          continued: false,
          boxCount: 0,
          oversizeCount: 0,
          inheritedSizeCount: 0,
          unmeasuredCount: 0,
          footer: null,
        };
      }
      const boxes = page.layout.boxes.map((b) => b.box);
      return {
        range: page.range,
        chapterKey: page.layout.chapterKey,
        printedPageId: null,
        printedAt: null,
        runWith: runOf.get(index) ?? [index + 1],
        headings: page.layout.headings.map((h) => h.lines.join(" ")),
        continued: page.layout.blocks.some((b) => b.part > 1),
        boxCount: boxes.length,
        oversizeCount: boxes.filter((b) => b.strip === null).length,
        inheritedSizeCount: boxes.filter((b) => b.sizeSource === "inherited").length,
        unmeasuredCount: boxes.filter((b) => b.sizeSource === null).length,
        footer: page.footer?.lines.join(" ") ?? null,
      };
    }),
  };
}

// -- What the plan is compared and fingerprinted by ---------------------------

/**
 * The plan reduced to the facts a **position** in it depends on: the sheets in order, and which
 * stamps of which block each one carries.
 *
 * Feeds {@link albumPlanFingerprint}. Deliberately no texts, no geometry and no range — none of
 * those changes *which card a position names*. A printed sheet contributes its own id and no blocks:
 * what is on it cannot change, and its identity is the one thing about it that could be reordered.
 */
export function albumPlanPrint(
  pages: readonly AlbumPlanPage[]
): { printedPageId: string | null; blocks: { entryId: string; part: number; stampIds: string[] }[] }[] {
  return pages.map((page) => {
    if (page.layout.kind === "printed") {
      return { printedPageId: page.layout.printedPageId, blocks: [] };
    }
    const layout = page.layout;
    let cursor = 0;
    const blocks = layout.blocks.map((block) => {
      const stampIds = layout.boxes
        .slice(cursor, cursor + block.boxCount)
        .map((b) => b.box.stampId);
      cursor += block.boxCount;
      return { entryId: block.entryId, part: block.part, stampIds };
    });
    return { printedPageId: null, blocks };
  });
}

/**
 * One live sheet as the divergence report compares it (#778): the facts a card can be wrong about,
 * and none of the coordinates that are consequences of them.
 *
 * A **live** sheet, deliberately. This is the *reference* half of the comparison — what the current
 * data would produce — and the printed half is built from a stored snapshot instead. The two shapes
 * meeting in `album-divergence.ts` is what keeps that module free of both Prisma and the plan.
 */
export function albumComparablePage(
  album: AlbumData,
  page: AlbumPlanPage
): AlbumComparablePage {
  if (page.layout.kind === "printed") {
    throw new Error("A printed sheet is compared from its snapshot, not from the plan.");
  }
  const layout = page.layout;
  let cursor = 0;
  const blocks = layout.blocks.map((block) => {
    const boxes = layout.boxes.slice(cursor, cursor + block.boxCount).map((placed) => ({
      stampId: placed.box.stampId,
      widthMm: placed.box.widthMm,
      heightMm: placed.box.heightMm,
      label: placed.box.label,
      stripId: placed.box.strip?.id ?? null,
      stripHeightMm: placed.box.strip?.heightMm ?? null,
      // Resolved by the caller, which is the only half of this that needs a second read. A page
      // compared with every `photoId` null would report every picture as newly arrived.
      photoId: null as string | null,
    }));
    cursor += block.boxCount;
    return {
      entryId: block.entryId,
      part: block.part,
      kind: block.kind ?? "entry",
      heading: block.heading,
      boxes,
    };
  });
  return {
    range: page.range,
    title: layout.title?.lines.join(" ") ?? "",
    chapter: layout.chapter?.lines.join(" ") ?? "",
    footer: page.footer?.lines.join(" ") ?? "",
    language: languageLabel(album.language),
    // The **preset**, not the album row. An album is `AlbumRenderPreset` plus an id, a name and a
    // language, and comparing the row would report a renamed album as a changed template value —
    // twice over, since its name is already in the texts it renders.
    preset: albumRenderPreset(album),
    blocks,
  };
}
