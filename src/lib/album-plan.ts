import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getAlbum, getAlbumEntries, type AlbumData, type AlbumEntryData } from "./albums";
import { getHawidStrips, type HawidStripData } from "./hawid-stock";
import { albumHawidMargins } from "./album-template-rules";
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
  renderTitleTemplate,
  type ListingTemplateContext,
  type TitleTemplateCopy,
} from "./offer-title-template";
import { albumTextMetrics } from "./album-metrics";
import {
  planAlbumPages,
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
// ## A live page is a derivation
//
// Nothing here is stored. A page is planned from current data every time it is asked for, and only a
// page the collector marks **printed** becomes a stored result — which is #778's, along with the
// divergence report and the continuation/reprint choice.
//
// What belongs here is the **seam**: `AlbumBlockSpec.printedPageId` is how a block says it is already
// on paper, and the planner steps over such a block entirely rather than routing content around it.
// Until #778 exists it is always null.
//
// There is deliberately **nothing here that compares two plans**. A live page reshuffling harms
// nothing — that is what makes it live — so the only comparison with a customer is the live plan
// against the printed snapshots, and #778 owns both halves of it. ADR-0045 states the shape that
// comparison is expected to take, so it is not re-derived from scratch.
//
// Two consequences of that seam are worth stating, because they are what #778 picks up. A stamp on a
// printed page is not in the live plan at all — it is on the card, not in the derivation. And a stamp
// that *joins* a checklist whose page is already printed has nowhere to go: the whole block is
// skipped, so the new stamp appears nowhere rather than being quietly appended to the next live page.
// That silence is deliberate. It is exactly the state #778's continuation page answers, and inventing
// a home for the stamp here would hide the thing the collector needs to be told about.

/**
 * One album text, rendered.
 *
 * **A blank template renders blank**, and that is why this exists rather than a bare
 * `renderTitleTemplate` call: the shared renderer falls back to `DEFAULT_TITLE_TEMPLATE` for an empty
 * template, which is right for an offer title (an offer must be called something) and wrong for all
 * four album texts, where blank is a real value a collector chooses (#766) — a page with no footer is
 * an ordinary thing to want, and it must not silently print a generated listing title instead.
 */
function renderAlbumText(
  template: string,
  copies: readonly TitleTemplateCopy[],
  context: ListingTemplateContext
): string {
  if (!template.trim()) return "";
  return renderTitleTemplate(template, copies, context);
}

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
}

/** A page as the plan hands it over: the geometry, its identity, and the footer rendered into the
 *  band the layout reserved for it. */
export interface AlbumPlanPage {
  /** The page's catalog range — `PL 303-309` — or blank for a page whose stamps carry no numbers. */
  range: string;
  layout: AlbumPlannedPage<AlbumBoxData>;
  /** The footer text placed in the reserved band. Null when the template prints none. */
  footer: AlbumPlacedText | null;
}

export interface AlbumPlanResult {
  album: AlbumData;
  entries: AlbumEntryData[];
  pages: AlbumPlanPage[];
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
 * Plan an album's pages from current data.
 *
 * The order of operations matters and is stated because each step depends on the one before it:
 * sizes resolve through the checklist (#763), the box comes from the size plus the album's own
 * clearances and the live stock (#765), the texts render in the album's language (#755), and only
 * then does the geometry happen — once, in `album-layout.ts`.
 */
export async function planAlbum(ownerId: string, albumId: string): Promise<AlbumPlanResult | null> {
  const album = await getAlbum(ownerId, albumId);
  if (!album) return null;
  const entries = await getAlbumEntries(ownerId, albumId);

  const [stock, areas, issuePrefixes, toCopy] = await Promise.all([
    getHawidStrips(ownerId, album.collectionId),
    getCollectionAreas(ownerId, album.collectionId),
    loadIssuePrefixMap(album.collectionId),
    makeTitleCopyMapper(ownerId, album.collectionId, album.language),
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

  /** The boxes of one entry, in the order the album prints them. */
  const boxesFor = (entry: AlbumEntryData): AlbumBoxData[] => {
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

    return entry.stampIds.flatMap((stampId) => {
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
      const size = resolved ?? { widthMm: 0, heightMm: 0 };
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
        },
      ];
    });
  };

  /**
   * Chapters are **runs** of consecutive entries sharing a year, not a re-sort into year buckets.
   *
   * The album prints in the collector's own entry order (#767), so a reorder that interleaves years
   * produces two chapters headed 1938 rather than silently pulling the entries back together. A
   * layout that quietly re-sorts what the collector arranged is a layout they cannot predict, and
   * this one is printed.
   */
  const chapters: { key: string; heading: string; blocks: AlbumBlockSpec<AlbumBoxData>[] }[] = [];
  for (const entry of entries) {
    const key = entry.year === null ? "" : String(entry.year);
    const copies = entry.stampIds
      .map((id) => copyById.get(id))
      .filter((c): c is TitleTemplateCopy => !!c);
    let chapter = chapters[chapters.length - 1];
    if (!chapter || chapter.key !== key) {
      chapter = {
        key,
        heading: renderAlbumText(album.chapterTemplate, copies, { albumName: album.name }),
        blocks: [],
      };
      chapters.push(chapter);
    }
    chapter.blocks.push({
      entryId: entry.id,
      heading: renderAlbumText(album.checklistTemplate, copies, {
        albumName: album.name,
        checklistName: entry.checklistName,
      }),
      boxes: boxesFor(entry),
      // #778 fills this in. Until it exists nothing has been printed, so nothing is skipped.
      printedPageId: null,
    });
  }

  const plan = planAlbumPages(chapters, album, album.name, albumTextMetrics);

  // The area's own prefix, for the page range. Taken from the album's area rather than per stamp: an
  // album is scoped to one area and the footer names the binder, so `PL 303-309` is the whole of it.
  const areaPrefix = albumAreaPrefix(album, maps, byId);

  const pages: AlbumPlanPage[] = [];

  for (const page of plan.pages) {
    if (page.kind === "printed") {
      // #778 owns what a printed sheet says about itself; the plan only keeps its place.
      pages.push({ range: "", layout: page, footer: null });
      continue;
    }
    const range = pageRange(page.boxes.map((b) => b.box), areaPrefix);
    const copies = page.boxes
      .map((b) => copyById.get(b.box.stampId))
      .filter((c): c is TitleTemplateCopy => !!c);
    let footer: AlbumPlacedText | null = null;
    if (page.footer) {
      const text = renderAlbumText(album.footerTemplate, copies, {
        albumName: album.name,
        pageRange: range,
      });
      // One line by construction. The layout reserved exactly one, because a footer allowed to wrap
      // would make the height of the page's content depend on the page's own contents — the plan
      // would be solving for its own output. A footer too long for the sheet overhangs, visibly.
      footer = text ? { role: "footer", lines: [text], ...page.footer } : null;
    }
    pages.push({ range, layout: page, footer });
  }

  return { album, entries, pages, emptyStock: stock.length === 0 };
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
  /** The checklist headings on the sheet, in reading order. */
  headings: string[];
  /** A heading continued from the previous page — a block too tall for one column. */
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
}

/** {@link planAlbum}'s result, reduced to what a list of sheets needs. */
export function albumPlanOverview(result: AlbumPlanResult): AlbumPlanOverview {
  return {
    emptyStock: result.emptyStock,
    pages: result.pages.map((page) => {
      if (page.layout.kind === "printed") {
        return {
          range: page.range,
          chapterKey: page.layout.chapterKey,
          printedPageId: page.layout.printedPageId,
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
        headings: page.layout.headings.map((h) => h.lines.join(" ")),
        continued: page.layout.blocks.some((b) => b.continued),
        boxCount: boxes.length,
        oversizeCount: boxes.filter((b) => b.strip === null).length,
        inheritedSizeCount: boxes.filter((b) => b.sizeSource === "inherited").length,
        unmeasuredCount: boxes.filter((b) => b.sizeSource === null).length,
        footer: page.footer?.lines.join(" ") ?? null,
      };
    }),
  };
}
