import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { assertSectionOwner, assertTradeOwner, assertContentEditable } from "./trades";
// The per-line guard lives a level down (`trade-access.ts`) since #642: the realisation half asks the
// identical question and cannot ask this module for it without closing a loop through `trades.ts`.
import { assertLineOwner } from "./trade-access";
import {
  filterItemIds,
  listItemsPaginated,
  valuateItemRows,
  type ItemListItem,
  type ValuationRow,
} from "./items";
import {
  arrangeByGroups,
  type TradeGroupContext,
  type TradeGroupHeading,
  type TradeGroupLevel,
  type TradeGroupSubject,
} from "./trade-grouping";
import type { PhotoSummary } from "./photos";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";
import type { CopyValuation } from "./valuation";
import { IN_HAND_DELIVERY_STATES } from "./delivery-state";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import {
  isUnknownVariantStamp,
  subtypeLabel,
  VARIANT_FLAG_SELECT,
  type SubtypeLabel,
} from "./variant-classification";
import { TRADE_STATUS_LABEL, type TradeSide, type TradeStatus } from "./trade-rules";
// The pure half of #642: a line the collector has withdrawn promises nothing, so the copy behind it
// is offerable again — the same judgement `trade-reservations.ts` releases the marketplace gate on.
import {
  COMMITTING_FULFILLMENTS,
  isCommittingFulfillment,
  readTradeFulfillment,
} from "./trade-realisation-rules";


// **What is on a trade, line by line** (#637; ADR-0039 §1/§2). The database half of the trade
// screen, beside `trades.ts` exactly as `auction-lines.ts` sits beside `auctions.ts` — that module
// says in its own header that it does not own the lines, and this is where they live.
//
// The **two sides are not two shapes of the same thing**, and that is the whole reason this module
// has two of everything:
//
//   - A **give** line names a concrete `Item`: the stamps are in the collection and a copy is a
//     copy, with its own number, condition, location and cost basis. So a give line carries an
//     `itemId` and nothing else, and the screen renders it through `InventoryItemRow` — the row
//     every other screen draws a copy with.
//   - A **receive** line cannot name anything, because the partner's stamps are in nobody's
//     inventory. It names `Want`'s key — `stamp × condition × certificate × format` — plus a
//     quantity, and gets a row of its own, because printing a copy row for material that does not
//     exist would print an internal number and four empty slots and call that consistency.
//
// **There is no pairing between them** (ADR-0039 §2), so nothing here walks the two lists together:
// they are read, reordered and counted separately, and the counts routinely differ.
//
// Every write goes through `trades.ts`'s guards — `assertTradeOwner` / `assertSectionOwner` for the
// scoping and `assertContentEditable` for the `agreed` lock — rather than restating either. The
// lock in particular is one rule: the partner holds a copy of the list, and recording that reality
// diverged from it is a different act with its own shape (#642).
//
// **Values are deliberately absent.** What the two sides are worth, and whether they balance, is
// the engine in #638 with its frozen valuations; this module counts pieces. A blank where a figure
// belongs is better than a zero that is not one.

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────
//
// Each side of each section is its **own list**: its own search, its own filters, its own page.
// That is not symmetry for its own sake — the two sides are two independent bags (ADR-0039 §2), the
// questions asked of them differ ("which of mine still has no photo" is meaningless about material
// nobody owns), and a trade list can run long enough that loading both whole would be the screen's
// slowest act.
//
// The arrangement happens **here and not in the browser**. Grouping over one page is grouping that
// lies about the pages not fetched yet, so the domain filters and arranges the whole side, then
// hands out a slice of it — and only that slice is enriched. A side of two thousand lines therefore
// costs two light queries and one enrichment of fifty rows, not two thousand enriched copies.

/** What a side is narrowed by. Every one of these is a question a collector asks of an exchange
 *  list while composing it, which is why they sit on the list rather than in a dialog. */
export interface TradeLineFilters {
  /** Stamp name, issue name or catalogue number — and, on the give side, the copy's own number and
   *  where it is filed, since the give side is made of copies that are physically somewhere. */
  search?: string;
  /** Narrow to these conditions. A list, not a single id, for the reason the Copies list takes one:
   *  the question is routinely "the mint grades", not one grade. */
  conditionIds?: string[];
  /** **Give side only.** A copy with no photograph is something to go and photograph before the
   *  parcel leaves; a receive line describes material the collector has never held, so the same
   *  filter there would only ever say "all of them". */
  noPhotos?: boolean;
  /** No catalogue price at this stamp's exact condition × certificate × format. On the give side it
   *  is a pricing gap to fill; on the receive side it is the line whose worth cannot be argued. */
  missingCatalogValue?: boolean;
}

export interface TradeLinePageParams {
  sectionId: string;
  side: TradeSide;
  /** The levels the side is broken up by, already narrowed and ordered by `readTradeGroupLevels`. */
  levels?: readonly TradeGroupLevel[];
  filters?: TradeLineFilters;
  offset?: number;
  pageSize?: number;
}

/** One row of a page. The two sides carry different payloads because they *are* different things —
 *  a copy that exists, and a want key describing material in nobody's inventory — and `side` is what
 *  the client narrows on. `path` is the headings this row sits under, outermost first. */
export type TradeLinePageItem =
  | { side: "give"; lineId: string; path: string[]; copy: ItemListItem }
  | { side: "receive"; lineId: string; path: string[]; line: TradeReceiveLineData };

export interface TradeLinePage {
  items: TradeLinePageItem[];
  /** Every heading in play, by key — looked up by `path` rather than repeated on every row. Counted
   *  over the whole **matching** side, so a heading agrees with the filters and never with the page. */
  headings: Record<string, TradeGroupHeading>;
  nextCursor: string | null;
  /** Lines matching the filters across the whole side. */
  total: number;
  /** Pieces matching — on the receive side this is not `total`, since three lines can be thirty
   *  stamps. On the give side a line is one copy, so the two agree. */
  pieces: number;
  /** Lines on this side before any filter, so the toolbar can say *12 of 40* rather than leaving a
   *  filtered list looking like the whole thing. */
  unfiltered: number;
}

/** The stamp fields both sides' light passes read to place and match a line, without the weight of
 *  photos, valuations or variant trees. */
const AXIS_STAMP_SELECT = {
  name: true,
  issuedYear: true,
  catalogNumbers: { select: { number: true } },
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  issueMemberships: {
    select: { issueId: true, issue: { select: { name: true, year: true } } },
    orderBy: { issueId: "asc" },
    take: 1,
  },
  variants: { select: VARIANT_FLAG_SELECT },
  ...VARIANT_FLAG_SELECT,
} satisfies Prisma.StampSelect;

interface AxisRow {
  lineId: string;
  /** Give side only — what the enrichment pass fetches, and what the copy filters run against. */
  itemId: string | null;
  stampId: string;
  quantity: number;
  unknownVariant: boolean;
  /** Everything the search box matches, lowercased once. */
  haystack: string;
  subject: TradeGroupSubject;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}

function axisSubject(
  stamp: {
    issuedYear: number | null;
    stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
    issueMemberships: { issueId: string; issue: { name: string | null; year: number | null } }[];
  },
  condition: { id: string; name: string; abbreviation: string },
  certificate: { id: string; name: string; abbreviation: string | null } | null
): TradeGroupSubject {
  const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
  const membership = stamp.issueMemberships[0] ?? null;
  return {
    areaId: link?.collectionAreaId ?? null,
    issuedYear: stamp.issuedYear,
    issueId: membership?.issueId ?? null,
    issueName: membership?.issue.name ?? null,
    issueYear: membership?.issue.year ?? null,
    conditionId: condition.id,
    conditionAbbreviation: condition.abbreviation,
    conditionName: condition.name,
    certificateStatusId: certificate?.id ?? null,
    certificateStatusAbbreviation: certificate?.abbreviation ?? null,
    certificateStatusName: certificate?.name ?? null,
  };
}

function haystackFor(
  stamp: { name: string | null; catalogNumbers: { number: string }[] },
  issueName: string | null,
  extra: readonly (string | null)[] = []
): string {
  return [stamp.name, issueName, ...stamp.catalogNumbers.map((c) => c.number), ...extra]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** One line of the receive side as its row draws it: `Want`'s key, how many, and the stamp's own
 *  identity. Note that a null `certificateStatusId` **is a value** — "no certificate" (ADR-0006 §2)
 *  — and a null `formatId` **means single** (ADR-0020); neither is an unanswered question. */
export interface TradeReceiveLineData {
  id: string;
  sectionId: string;
  position: number;
  stampId: string;
  stampName: string | null;
  /** Raw numbers + vendor, primary vendor first, so the client prefix-formats them with the area's
   *  vendor map exactly as every other stamp surface does (#357). */
  catalogNumbers: { catalogVendorId: string; number: string }[];
  colnectId: string | null;
  areaId: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  subtype: SubtypeLabel | null;
  /** The **collection's own** pictures of this stamp, ordered as the stamp orders them — not the
   *  partner's, who has photographed nothing and whose material is not here to photograph. They are
   *  what makes the two sides read alike: a give line shows the copy that is leaving, and this shows
   *  what is being asked for, which is the whole point of looking at an exchange list. Absent for a
   *  stamp the collection has no picture of, which on incoming material is the common case. */
  photos: PhotoSummary[];
  /** The line points at a base stamp that has variants: "one of these, which one is not recorded". */
  unknownVariant: boolean;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  quantity: number;
  /**
   * The catalogue value at this line's exact key, **per piece** (#638).
   *
   * The same `CopyValuation` a give line carries and drawn with the same `CopyValue` component, so
   * the two columns line up on the one figure a collector reads across them — and so that the
   * *"+ catalog value"* affordance is the same affordance on both sides. That matters more here than
   * on the give side: a receive line describes material from an area the collection may never have
   * touched, which is precisely where a price is missing and where the collector is standing with
   * the partner's list in front of them.
   *
   * Per piece rather than per line: `quantity` is on the row beside it, and a figure silently
   * multiplied by it would not be the catalogue's.
   */
  value: CopyValuation;
  /**
   * The **open** wants recorded for this stamp (#664; #532's summary), or null for none.
   *
   * On the receive side this is the sharpest thing the app can say while a trade is being
   * negotiated — *this is one you have been looking for* — and the line can answer it exactly,
   * because it carries the whole want key by construction (`stamp × condition × certificate ×
   * format`, ADR-0032). The give side carries the same chip through `InventoryItemRow` and it means
   * something different there: holding a copy never closes a want, so on material about to leave it
   * reads as an upgrade hint.
   *
   * Loaded with the page, like the valuations beside it, rather than asked per row in the client:
   * fifty rows, one batched read.
   */
  wants: StampWantSummary | null;
}

const RECEIVE_SELECT = {
  id: true,
  sectionId: true,
  position: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  quantity: true,
  condition: { select: { name: true, abbreviation: true } },
  certificateStatus: { select: { name: true, abbreviation: true } },
  format: { select: { name: true, abbreviation: true } },
  stamp: {
    select: {
      name: true,
      colnectId: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      issueMemberships: {
        select: { issueId: true, issue: { select: { name: true, year: true } } },
        orderBy: { issueId: "asc" },
        take: 1,
      },
      photos: { select: { id: true, role: true, title: true, sortOrder: true } },
      variants: { select: VARIANT_FLAG_SELECT },
      ...VARIANT_FLAG_SELECT,
    },
  },
} satisfies Prisma.TradeLineSelect;

/** A line whose key could not be assembled at all — a `receive` row missing its stamp or condition,
 *  which the CHECK constraints make impossible but which a read must not crash on. Unpriced rather
 *  than absent: the row still draws, and the value slot says what it says everywhere else. */
const UNPRICED: CopyValuation = {
  amount: null,
  currency: null,
  baseAmount: null,
  baseAmountDisplay: null,
  catalogNameId: null,
  editionYear: null,
  uncertain: false,
  unpriced: true,
  sourceStampId: null,
  unpricedVariantIds: [],
};

/** Photo roles a stamp uses (#137): the single `main` slot, plus the two a copy scan carries.
 *  Anything else is carried as unroled rather than dropped — the picture exists either way. */
function toPhotoSummary(photo: {
  id: string;
  role: string | null;
  title: string | null;
  sortOrder: number;
}): PhotoSummary {
  return {
    id: photo.id,
    role: (photo.role === "main" || photo.role === "front" || photo.role === "back"
      ? photo.role
      : null) as PhotoSummary["role"],
    title: photo.title,
    sortOrder: photo.sortOrder,
  };
}

/** The receive rows with their stamp identity resolved — the same area → vendor resolution every
 *  other stamp surface uses, read once for the page rather than per line. */
async function enrichReceiveLines(
  collectionId: string,
  rows: Prisma.TradeLineGetPayload<{ select: typeof RECEIVE_SELECT }>[]
): Promise<TradeReceiveLineData[]> {
  if (rows.length === 0) return [];

  const [areas, issuePrefixes, valuations, wantsByStamp] = await Promise.all([
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
    // Valued for the **page** alone, exactly as the give side's copies are by `listItemsPaginated`:
    // fifty rows, one batched read, and the same `valuateItemRows` rule the whole app prices by.
    valuateItemRows(
      collectionId,
      rows.flatMap<ValuationRow>((row) =>
        row.stampId && row.conditionId
          ? [
              {
                id: row.id,
                stampId: row.stampId,
                conditionId: row.conditionId,
                certificateStatusId: row.certificateStatusId,
                formatId: row.formatId,
                unknownVariant: row.stamp ? isUnknownVariantStamp(row.stamp) : false,
              },
            ]
          : []
      )
    ),
    // Only open wants come back (`loadStampWantSummaries`), which is every want reader's rule: a
    // settled want would keep the marker lit for ever, and what this answers is what is still being
    // chased. Keyed by **stamp** rather than by line — two lines for one stamp in two conditions ask
    // the same summary, and each judges its own key against it.
    loadStampWantSummaries(
      collectionId,
      rows.flatMap((row) => (row.stampId ? [row.stampId] : []))
    ),
  ]);
  const { primaryVendorByArea } = buildAreaVendorMaps(areas, issuePrefixes);

  return rows.map((row) => {
    const stamp = row.stamp!;
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    // Primary vendor first, so the number a collector reads the stamp by leads the row.
    const catalogNumbers = primaryVendorId
      ? [
          ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
          ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
        ]
      : stamp.catalogNumbers;
    const membership = stamp.issueMemberships[0] ?? null;

    return {
      id: row.id,
      sectionId: row.sectionId,
      position: row.position,
      stampId: row.stampId!,
      stampName: stamp.name,
      catalogNumbers,
      colnectId: stamp.colnectId,
      areaId,
      issueId: membership?.issueId ?? null,
      issueName: membership?.issue.name ?? null,
      issueYear: membership?.issue.year ?? null,
      issuedDay: stamp.issuedDay,
      issuedMonth: stamp.issuedMonth,
      issuedYear: stamp.issuedYear,
      subtype: subtypeLabel(stamp),
      photos: stamp.photos.map(toPhotoSummary).sort((a, b) => a.sortOrder - b.sortOrder),
      unknownVariant: isUnknownVariantStamp(stamp),
      conditionId: row.conditionId!,
      conditionName: row.condition?.name ?? "",
      conditionAbbreviation: row.condition?.abbreviation ?? "",
      certificateStatusId: row.certificateStatusId,
      certificateStatusName: row.certificateStatus?.name ?? null,
      certificateStatusAbbreviation: row.certificateStatus?.abbreviation ?? null,
      formatId: row.formatId,
      formatName: row.format?.name ?? null,
      formatAbbreviation: row.format?.abbreviation ?? null,
      quantity: row.quantity,
      value: valuations.get(row.id) ?? UNPRICED,
      wants: wantsByStamp.get(row.stampId!) ?? null,
    };
  });
}

/**
 * One page of one side of one section (#637).
 *
 * The order of business is deliberate and is what keeps the figures honest: **filter the whole side,
 * arrange what is left, count the headings over that, and only then take a slice**. Counting after
 * slicing would produce headings that describe the scroll position; arranging after slicing would
 * produce groups that reshuffle as you scroll.
 */
export async function listTradeLinePage(
  ownerId: string,
  tradeId: string,
  params: TradeLinePageParams
): Promise<TradeLinePage> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);
  const pageSize = params.pageSize ?? 50;
  const offset = params.offset ?? 0;
  const levels = params.levels ?? [];
  const filters = params.filters ?? {};

  const [rows, unfiltered] = await (params.side === "give"
    ? giveAxisRows(ownerId, collectionId, tradeId, params.sectionId, filters)
    : receiveAxisRows(collectionId, tradeId, params.sectionId, filters));

  const ctx = await groupContext(collectionId);
  const arranged = arrangeByGroups(
    rows,
    (row) => row.subject,
    (row) => row.quantity,
    levels,
    ctx
  );

  const total = arranged.rows.length;
  const pieces = rows.reduce((sum, r) => sum + r.quantity, 0);
  const slice = arranged.rows.slice(offset, offset + pageSize + 1);
  const hasMore = slice.length > pageSize;
  const page = hasMore ? slice.slice(0, pageSize) : slice;

  const items =
    params.side === "give"
      ? await enrichGivePage(ownerId, collectionId, page)
      : await enrichReceivePage(collectionId, page);

  return {
    items,
    headings: arranged.headings,
    nextCursor: hasMore ? String(offset + pageSize) : null,
    total,
    pieces,
    unfiltered,
  };
}

/** The area tree and the condition dictionary, which is everything a heading needs words from. */
async function groupContext(collectionId: string): Promise<TradeGroupContext> {
  const [areas, conditions] = await Promise.all([
    readCollectionAreas(collectionId),
    prisma.stampCondition.findMany({
      where: { collectionId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    }),
  ]);
  return { areas, conditionOrder: conditions.map((c) => c.id) };
}

/**
 * The give side's matching lines, light.
 *
 * The copy filters — search, condition, no photos, no catalogue value — are the Copies list's own,
 * run through `filterItemIds` rather than restated here: "which copies match this" is one question
 * with one answer, and a second implementation of it would drift from the list the collector
 * already knows. Only the *set* comes back; nothing is enriched until the page is known.
 */
async function giveAxisRows(
  ownerId: string,
  collectionId: string,
  tradeId: string,
  sectionId: string,
  filters: TradeLineFilters
): Promise<[AxisRow[], number]> {
  const lines = await prisma.tradeLine.findMany({
    where: { tradeId, sectionId, side: "give", itemId: { not: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, itemId: true },
  });
  if (lines.length === 0) return [[], 0];

  const itemIds = lines.map((l) => l.itemId!);
  const matching = new Set(
    await filterItemIds(ownerId, collectionId, {
      ids: itemIds,
      // A copy sold or disposed of since it was promised still belongs on an agreed list — the trade
      // said so — and the row's own markers say what became of it.
      includeDisposed: true,
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.conditionIds?.length ? { conditionIds: filters.conditionIds } : {}),
      ...(filters.noPhotos ? { noPhotos: true } : {}),
      ...(filters.missingCatalogValue ? { missingCatalogValue: true } : {}),
    })
  );

  const kept = lines.filter((l) => matching.has(l.itemId!));
  if (kept.length === 0) return [[], lines.length];

  const items = await prisma.item.findMany({
    where: { id: { in: kept.map((l) => l.itemId!) } },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      condition: { select: { id: true, name: true, abbreviation: true } },
      certificateStatus: { select: { id: true, name: true, abbreviation: true } },
      stamp: { select: AXIS_STAMP_SELECT },
    },
  });
  const byItem = new Map(items.map((i) => [i.id, i]));

  const rows: AxisRow[] = [];
  for (const line of kept) {
    const item = byItem.get(line.itemId!);
    if (!item) continue;
    const membership = item.stamp.issueMemberships[0] ?? null;
    rows.push({
      lineId: line.id,
      itemId: item.id,
      stampId: item.stampId,
      // Always one on the give side: a multiple is one copy in one format (ADR-0020).
      quantity: 1,
      unknownVariant: isUnknownVariantStamp(item.stamp),
      haystack: haystackFor(item.stamp, membership?.issue.name ?? null),
      subject: axisSubject(item.stamp, item.condition, item.certificateStatus),
      conditionId: item.conditionId,
      certificateStatusId: item.certificateStatusId,
      formatId: item.formatId,
    });
  }
  return [rows, lines.length];
}

/**
 * The receive side's matching lines, light.
 *
 * Filtered in memory rather than through a second `where`, because two of the four questions cannot
 * be asked of the database: a catalogue value is *computed* per line from its condition × certificate
 * × format (ADR-0020), and *no photos* is not asked here at all. What remains — text and condition —
 * is cheap over a set this size, and doing all four in one place is what keeps the count on the
 * toolbar and the rows under it from disagreeing.
 */
async function receiveAxisRows(
  collectionId: string,
  tradeId: string,
  sectionId: string,
  filters: TradeLineFilters
): Promise<[AxisRow[], number]> {
  const lines = await prisma.tradeLine.findMany({
    where: { tradeId, sectionId, side: "receive", stampId: { not: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      quantity: true,
      condition: { select: { id: true, name: true, abbreviation: true } },
      certificateStatus: { select: { id: true, name: true, abbreviation: true } },
      stamp: { select: AXIS_STAMP_SELECT },
    },
  });
  if (lines.length === 0) return [[], 0];

  const conditionIds = filters.conditionIds?.length ? new Set(filters.conditionIds) : null;
  const needle = filters.search?.trim().toLowerCase() ?? "";

  let rows: AxisRow[] = [];
  for (const line of lines) {
    if (!line.stamp || !line.condition || !line.stampId) continue;
    if (conditionIds && !conditionIds.has(line.conditionId ?? "")) continue;
    const membership = line.stamp.issueMemberships[0] ?? null;
    const haystack = haystackFor(line.stamp, membership?.issue.name ?? null);
    if (needle && !haystack.includes(needle)) continue;
    rows.push({
      lineId: line.id,
      itemId: null,
      stampId: line.stampId,
      quantity: line.quantity,
      unknownVariant: isUnknownVariantStamp(line.stamp),
      haystack,
      subject: axisSubject(line.stamp, line.condition, line.certificateStatus),
      conditionId: line.condition.id,
      certificateStatusId: line.certificateStatusId,
      formatId: line.formatId,
    });
  }

  if (filters.missingCatalogValue && rows.length > 0) {
    // The same batched valuation the auction composition makes, at the line's exact key — matching
    // is strict, so a line with an Attest counts as unpriced until a price exists at that level.
    const valuations = await valuateItemRows(
      collectionId,
      rows.map<ValuationRow>((row) => ({
        id: row.lineId,
        stampId: row.stampId,
        conditionId: row.conditionId,
        certificateStatusId: row.certificateStatusId,
        formatId: row.formatId,
        unknownVariant: row.unknownVariant,
      }))
    );
    rows = rows.filter((row) => {
      const valuation = valuations.get(row.lineId);
      return !valuation || valuation.unpriced || valuation.baseAmount === null;
    });
  }

  return [rows, lines.length];
}

/** The page's copies, enriched exactly as the Copies list enriches them — a give line *is* a copy,
 *  and it should read like one wherever it is drawn. Put back into the arranged order, which the
 *  `ids` read does not promise. */
async function enrichGivePage(
  ownerId: string,
  collectionId: string,
  page: { row: AxisRow; path: string[] }[]
): Promise<TradeLinePageItem[]> {
  if (page.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    ids: page.map((p) => p.row.itemId!),
    includeDisposed: true,
    pageSize: page.length,
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return page.flatMap(({ row, path }) => {
    const copy = byId.get(row.itemId!);
    return copy ? [{ side: "give" as const, lineId: row.lineId, path, copy }] : [];
  });
}

/** The page's receive lines, with the identity the row draws — the heavy half (photos, variants,
 *  prefix-ordered numbers) fetched for the page alone. */
async function enrichReceivePage(
  collectionId: string,
  page: { row: AxisRow; path: string[] }[]
): Promise<TradeLinePageItem[]> {
  if (page.length === 0) return [];
  const rows = await prisma.tradeLine.findMany({
    where: { id: { in: page.map((p) => p.row.lineId) } },
    select: RECEIVE_SELECT,
  });
  const enriched = await enrichReceiveLines(collectionId, rows);
  const byId = new Map(enriched.map((l) => [l.id, l]));
  return page.flatMap(({ row, path }) => {
    const line = byId.get(row.lineId);
    return line ? [{ side: "receive" as const, lineId: row.lineId, path, line }] : [];
  });
}

// ── The give side's source ───────────────────────────────────────────────────────────────────────

/** The statuses in which a trade still holds a claim on the copies it names. A cancelled or closed
 *  trade releases them: the exchange is off, or it happened and the copy has left by other means. */
const LIVE_TRADE_STATUSES: readonly TradeStatus[] = ["preparing", "shared", "agreed"];

/** …and a **line** still holds one only while it is still going to happen (#642). A copy withdrawn
 *  from an agreed trade is back on the shelf and may be promised elsewhere, which is the same
 *  release `trade-reservations.ts` gives the marketplace gate — the two must not disagree, or a
 *  collector would be free to list a copy the picker still refuses to offer. Before `agreed` every
 *  line is `pending` by construction, so this narrows nothing on a trade being negotiated. */
const COMMITTING_LINE = { fulfillment: { in: [...COMMITTING_FULFILLMENTS] } };

export interface OfferableCopyFilters {
  /** The selected area and its descendants, already resolved by the caller — the picker's sidebar. */
  areaIds?: string[] | null;
  search?: string;
  year?: number | "none";
  /**
   * Narrow to copies marked **for trade** (`Item.forTrade`, ADR-0007 §4) — the picker's default.
   *
   * A default and not a rule: the disposition is where a collector files what they are willing to
   * part with, so it is the right list to open on, but a trade routinely takes in a copy that was
   * never marked because the partner asked for it by name. The toggle that turns this off is the
   * whole reason it is a parameter rather than a fixed clause.
   */
  forTradeOnly?: boolean;
}

/**
 * The copies this trade could still promise (#637).
 *
 * What is left out, and why:
 *
 *  - **Already on a live trade**, this one included — unless that trade's line has been **withdrawn**
 *    (#642), in which case the copy is back on the shelf and is offerable again. A copy cannot be
 *    promised to two partners, and `@@unique([tradeId, itemId])` only stops the same trade naming it
 *    twice. The reservation rules
 *    proper are #639's — collisions with marketplace listings, and what happens when one is found —
 *    and this filter is deliberately the plain reading that will not fight them.
 *  - **Sold.** It has left on a sale line; promising it is promising something gone.
 *  - **Disposed**, which `listItemsPaginated` already hides by default: a copy that stopped being
 *    held is not the collector's to send.
 *  - **Not in hand.** `IN_HAND_DELIVERY_STATES` — delivered or waiting to be sorted — because what
 *    is being asked is "can this go in the envelope", and a copy still in the post cannot.
 *
 * Unpaginated, mirroring the offer composition picker: the dialog scopes by area and year on the
 * server and filters the rest client-side, so the facets and the rows never disagree.
 */
export async function listOfferableCopies(
  ownerId: string,
  tradeId: string,
  filters: OfferableCopyFilters = {}
): Promise<ItemListItem[]> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);
  const committed = await committedItemIds(collectionId, tradeId);

  const { items } = await listItemsPaginated(ownerId, collectionId, {
    areaIds: filters.areaIds ?? undefined,
    search: filters.search,
    year: filters.year,
    ...(filters.forTradeOnly ? { forTrade: true } : {}),
    deliveryStates: [...IN_HAND_DELIVERY_STATES],
    excludeSold: true,
    excludeIds: committed,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

/**
 * Every copy the picker must not offer. Read as a list of ids rather than as a relation filter
 * because the picker's query already speaks `excludeIds`, and a trade holds tens of lines — not the
 * tens of thousands that would make this the wrong shape.
 *
 * **Two clauses, because a withdrawal makes them two different questions** (#642):
 *
 *  - promised to a **live** trade on a line that is still going to happen — a withdrawn line
 *    promises nothing, so its copy is free to go on another trade;
 *  - already named by **this** trade at all, whatever became of it. That line still exists, and
 *    `@@unique([tradeId, itemId])` says a copy is on a trade once — so offering it here would be
 *    offering a tick that could not do anything.
 */
async function committedItemIds(collectionId: string, tradeId: string): Promise<string[]> {
  const rows = await prisma.tradeLine.findMany({
    where: {
      side: "give",
      itemId: { not: null },
      OR: [
        {
          ...COMMITTING_LINE,
          trade: { collectionId, status: { in: [...LIVE_TRADE_STATUSES] } },
        },
        { tradeId },
      ],
    },
    select: { itemId: true },
  });
  return rows.map((r) => r.itemId!).filter(Boolean);
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The next free position on one side of one section.
 *
 * The two sides are independent bags, so they number independently: a give line and a receive line
 * both sitting at 0 is the normal case.
 *
 * Nothing **re**-orders a line — the screen groups instead of sorting by hand (#637), so `position`
 * is simply the order the lines were entered in, stable and never renumbered. `Want`'s key is what
 * the screen sorts and nests by; a hand order underneath it would be a second, invisible ordering
 * that the grouping hides most of the time and contradicts the rest.
 */
async function nextPosition(sectionId: string, side: TradeSide): Promise<number> {
  const last = await prisma.tradeLine.findFirst({
    where: { sectionId, side },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

/** A copy that could not be promised, with the reason a person can act on — collected rather than
 *  thrown, for `attachItemsToLot`'s reason: one stuck copy is no reason to drop the other nineteen. */
export interface GiveLineRefusal {
  itemId: string;
  reason: string;
}

/**
 * Promise copies to a section of the trade (#637).
 *
 * Bulk, because the picker is a checkbox list: a collector composing a bag of duplicates picks
 * twenty at once, and twenty round trips would be twenty chances to half-succeed.
 *
 * Every copy is re-checked here rather than trusted from the picker — the list it was drawn from is
 * a moment old, and in that moment a copy can have been sold, disposed of, or promised to another
 * trade in another tab.
 */
export async function addTradeGiveLines(
  ownerId: string,
  sectionId: string,
  itemIds: string[]
): Promise<{ added: number; refused: GiveLineRefusal[] }> {
  const { tradeId, status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);

  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("Nothing selected to add.");

  const { collectionId } = await assertTradeOwner(ownerId, tradeId);
  const items = await prisma.item.findMany({
    where: { id: { in: ids }, collectionId },
    select: {
      id: true,
      itemNo: true,
      deliveryState: true,
      disposedAt: true,
      saleLineItems: { select: { itemId: true }, take: 1 },
      tradeLines: {
        // **Not** narrowed by fulfillment here, unlike the picker's own read: a line withdrawn from
        // *this* trade still exists, and re-adding the copy has to stay the no-op it has always been
        // rather than a unique-constraint violation the collector reaches through a reopened list.
        // Which of these lines still *holds* the copy is judged below, where the two questions can
        // be told apart.
        where: { trade: { status: { in: [...LIVE_TRADE_STATUSES] } } },
        select: {
          tradeId: true,
          fulfillment: true,
          trade: { select: { tradeNo: true, status: true } },
        },
      },
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const refused: GiveLineRefusal[] = [];
  const acceptable: string[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      refused.push({ itemId: id, reason: "This copy is not in this collection." });
      continue;
    }
    const label = `Copy #${item.itemNo}`;
    // Already on *this* trade is a no-op rather than a refusal: re-confirming a selection should
    // not fail, exactly as re-attaching a copy to its own lot does not.
    if (item.tradeLines.some((l) => l.tradeId === tradeId)) continue;
    // A copy another trade has **withdrawn** is back on the shelf and may be promised here (#642),
    // so only a line that still holds it refuses.
    const elsewhere = item.tradeLines.find((l) =>
      isCommittingFulfillment(readTradeFulfillment(l.fulfillment))
    );
    if (elsewhere) {
      refused.push({
        itemId: id,
        reason: `${label} is already promised to trade #${elsewhere.trade.tradeNo} (${TRADE_STATUS_LABEL[
          (elsewhere.trade.status as TradeStatus) ?? "preparing"
        ].toLowerCase()}).`,
      });
      continue;
    }
    if (item.saleLineItems.length > 0) {
      refused.push({ itemId: id, reason: `${label} has already been sold.` });
      continue;
    }
    if (item.disposedAt !== null) {
      refused.push({ itemId: id, reason: `${label} is no longer held.` });
      continue;
    }
    if (!(IN_HAND_DELIVERY_STATES as readonly string[]).includes(item.deliveryState)) {
      refused.push({ itemId: id, reason: `${label} has not arrived yet.` });
      continue;
    }
    acceptable.push(id);
  }

  if (acceptable.length > 0) {
    const start = await nextPosition(sectionId, "give");
    await prisma.tradeLine.createMany({
      data: acceptable.map((itemId, index) => ({
        tradeId,
        sectionId,
        side: "give",
        position: start + index,
        itemId,
        // Always 1 on the give side: a multiple is one copy in one format, never N singles
        // (ADR-0020). A CHECK constraint says the same thing in the database.
        quantity: 1,
      })),
    });
  }

  return { added: acceptable.length, refused };
}

/** What a receive line states. The three nullable members are values, not blanks — see
 *  {@link TradeReceiveLineData}. */
export interface TradeReceiveLineInput {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  quantity: number;
}

/** Validate a receive line's members against the collection, so a tampered or cross-collection id
 *  is refused rather than stored. Returns the input as Prisma writes it. */
async function receiveLineData(collectionId: string, input: TradeReceiveLineInput) {
  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) throw new Error("Pick a stamp for this line.");

  const condition = await prisma.stampCondition.findFirst({
    where: { id: input.conditionId, collectionId },
    select: { id: true },
  });
  if (!condition) throw new Error("A condition is required.");

  // Null is a value on both of these axes, so an id that does not resolve falls back to it rather
  // than raising: "no certificate" and "single" are the readings a blank already has.
  const certificateStatusId = input.certificateStatusId
    ? ((
        await prisma.certificateStatus.findFirst({
          where: { id: input.certificateStatusId, collectionId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;
  const formatId = input.formatId
    ? ((
        await prisma.stampFormat.findFirst({
          where: { id: input.formatId, collectionId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  return {
    stampId: stamp.id,
    conditionId: condition.id,
    certificateStatusId,
    formatId,
    quantity: Math.max(1, Math.trunc(input.quantity || 1)),
  };
}

/**
 * Add to the receive side of a section: **one stamp, or a whole checklist** (#637).
 *
 * The checklist is an *entry shortcut only*, exactly as it is on an auction lot line: it expands
 * here into one line per stamp on it, all described the same way, because a partner offering "Michel
 * 1–12, complete" is offering twelve stamps and every downstream reader — the balance count, the
 * pieces figure, the partner's copy of the list, the identification at closing — works per stamp.
 * A `checklistId` is never stored, and there is no such thing as a line that "is" a set.
 *
 * Every stamp on the set takes the same condition, certificate, format and quantity: that is what
 * *the partner is sending me this set* means, and a set arriving in mixed states is entered stamp by
 * stamp. Returns how many lines were made, so the caller can say so.
 */
export async function addTradeReceiveLines(
  ownerId: string,
  sectionId: string,
  input: TradeReceiveLineInput & { checklistId?: string | null }
): Promise<number> {
  const { tradeId, status } = await assertSectionOwner(ownerId, sectionId);
  assertContentEditable(status);
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);

  const stampIds = await resolveReceiveLineStamps(collectionId, input);
  const start = await nextPosition(sectionId, "receive");

  // Validated once and reused: the condition, certificate and format are the same for every stamp
  // on the set, so twelve round trips to check the same three ids would be twelve for nothing.
  const shared = await receiveLineData(collectionId, { ...input, stampId: stampIds[0] });

  await prisma.tradeLine.createMany({
    data: stampIds.map((stampId, index) => ({
      tradeId,
      sectionId,
      side: "receive",
      position: start + index,
      ...shared,
      stampId,
    })),
  });
  return stampIds.length;
}

/** What a receive line — or a whole checklist — comes to, as stamp ids. Local rather than borrowed
 *  from the auction module: that one throws an auction-specific blocked-action error, and a trade
 *  has no business raising one. */
async function resolveReceiveLineStamps(
  collectionId: string,
  target: { stampId?: string; checklistId?: string | null }
): Promise<string[]> {
  const checklistId = target.checklistId?.trim();
  if (checklistId) {
    const checklist = await prisma.checklist.findFirst({
      where: { id: checklistId, collectionId },
      select: { name: true, stamps: { select: { stampId: true } } },
    });
    if (!checklist) throw new Error("That checklist no longer exists.");
    if (checklist.stamps.length === 0) {
      throw new Error(`"${checklist.name}" has no stamps on it yet, so there is nothing to add.`);
    }
    return [...new Set(checklist.stamps.map((s) => s.stampId))];
  }
  if (target.stampId?.trim()) return [target.stampId.trim()];
  throw new Error("Pick the stamp this line is about.");
}

/**
 * Restate a receive line.
 *
 * The whole key is rewritten, the stamp included: "actually it is the 5g, not the 10g" is an
 * ordinary correction while a list is still being negotiated, and making it mean *delete and
 * re-add* would lose the line's place in the section for no gain.
 */
export async function updateTradeReceiveLine(
  ownerId: string,
  lineId: string,
  input: TradeReceiveLineInput
): Promise<void> {
  const { collectionId, status, side } = await assertLineOwner(ownerId, lineId);
  assertContentEditable(status);
  if (side !== "receive") {
    throw new Error("A give line names a copy, so there is nothing on it to restate.");
  }

  await prisma.tradeLine.update({
    where: { id: lineId },
    data: await receiveLineData(collectionId, input),
  });
}

/** Take a line off the trade. The copy a give line named is untouched — a give line is a promise
 *  about a copy, never a claim on it (ADR-0039). */
export async function deleteTradeLine(ownerId: string, lineId: string): Promise<void> {
  const { status } = await assertLineOwner(ownerId, lineId);
  assertContentEditable(status);
  await prisma.tradeLine.delete({ where: { id: lineId } });
}
