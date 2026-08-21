import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { NOT_TRADED_AWAY } from "./trade-exit";
import { validateAcceptance, type AcceptanceInput } from "./acceptance";
import { copyDeliveryBucket, UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import { subtypeLabel, VARIANT_FLAG_SELECT, type SubtypeLabel } from "./variant-classification";
import { sortPhotos, type PhotoSummary } from "./photos";
import { buildEffectivePrimaryCatalogMap, getCollectionBaseCurrency, safeRateMap } from "./pricing";
import { makeFormatFactorLookup } from "./format-pricing";
import { wantCatalogRange, type WantCatalogRange } from "./want-valuation";
import {
  compareIssueGroups,
  issueGroupLabel,
  NO_ISSUE,
  type SortableIssueGroup,
} from "./issue-groups";
import { isUnknownVariantStamp } from "./variant-classification";
import { loadChecklistVariantRollup } from "./checklist-variant-rollup";
import {
  wantMatchesCopy,
  acceptanceSetsEqual,
  wantPriorityFromRank,
  isWantPriority,
  WANT_PRIORITIES,
  WANT_PRIORITY_LABEL,
  WANT_PRIORITY_RANK,
  type ArrivingCopy,
  type WantAcceptance,
  type WantCandidateCopy,
  type WantPriority,
} from "./want-rules";

// The priority vocabulary lives in the pure module, since the form and the list toolbar render it
// and this one is `server-only`. Re-exported here so a server caller has one import.
export { isWantPriority, WANT_PRIORITIES, WANT_PRIORITY_LABEL, WANT_PRIORITY_RANK };
export type { ArrivingCopy, WantPriority };

// The want list (#532; ADR-0032) — what the collector is *looking for*. Storage and reads; what a
// copy satisfies is the pure predicate in `want-rules.ts`, shared with every consumer so none of
// them can disagree about it.
//
// The one thing to keep in mind throughout: an acceptance set with **zero rows means "any"**, and a
// null *member* of the certificate or format set is a value of its own ("no certificate", "single").
// So `[]` and `[null]` are different answers everywhere below and neither may be normalized into
// the other.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve a want to its collection, so every write authorizes from the want id alone. */
async function resolveWantCollection(ownerId: string, wantId: string): Promise<string> {
  const row = await prisma.want.findUnique({
    where: { id: wantId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!row || row.collection.ownerId !== ownerId) {
    throw new Error("Want not found or access denied.");
  }
  return row.collectionId;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** What the list row draws: the acceptance, plus enough of the stamp to say which one it is. */
export interface WantListItem {
  id: string;
  stampId: string;
  stampName: string | null;
  /** True when the want points at a base stamp that has variants — any of them would do. */
  unknownVariant: boolean;
  subtype: SubtypeLabel | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  colnectId: string | null;
  /** Area the stamp is primarily linked to, for resolving catalog-vendor display. */
  areaId: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Catalog-level photos of the wanted stamp (#137), front → back → extras. A want list is read
   *  to recognise a stamp on a dealer's table, so the picture is the point of the row. Metadata
   *  only; the bytes come from the collection-scoped serving route. */
  photos: PhotoSummary[];
  /**
   * What the catalogue says this want would cost — a **range**, because the acceptance sets stand
   * for a set of (condition, certificate, format) combinations and each has its own value. Null
   * when nothing the want accepts is priced. Only `listWantsPaginated` fills this: the intake
   * review and the edit form do not draw it, and it is the one figure on the row that costs a
   * pricing pass to work out.
   */
  catalogRange: WantCatalogRange | null;
  /** Empty = any condition. */
  conditionIds: string[];
  /** Empty = don't care; `null` is the "no certificate" member. */
  certificateStatusIds: (string | null)[];
  /** Empty = any format; `null` is the "single" member. */
  formatIds: (string | null)[];
  priority: WantPriority;
  notes: string | null;
  /** ISO-8601, or null while the want is open. */
  closedAt: string | null;
  createdAt: string;
  /** Copies of **the stamp**, whichever want they answer — the upgrade context: a mint-only want
   *  against a used copy in hand reads `1 held` here and `0 held` below, and both are true. */
  copies: WantCopyCounts;
  /** Copies that would satisfy **this** want. The only figure allowed to say *already on its way*:
   *  one is what stops the same stamp reading as an untouched gap at the next auction, and it must
   *  be about the want being looked at rather than about the stamp. */
  matchingCopies: WantCopyCounts;
}

/** The catalogue-price columns `RawCatalogPrice` is made of — the same select the stamps list uses,
 *  spelled once here so a want and a stamp are priced off identical rows. */
const CATALOG_PRICE_SELECT = {
  price: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

const WANT_SELECT = {
  id: true,
  stampId: true,
  closedAt: true,
  priority: true,
  notes: true,
  createdAt: true,
  conditions: { select: { conditionId: true } },
  certificateStatuses: { select: { certificateStatusId: true } },
  formats: { select: { formatId: true } },
  stamp: {
    select: {
      parentId: true,
      name: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      colnectId: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      photos: { select: { id: true, role: true, title: true, sortOrder: true } },
      variants: { select: VARIANT_FLAG_SELECT },
      subtype: { select: { name: true, isDefault: true } },
      issueMemberships: {
        orderBy: { issueId: "asc" },
        take: 1,
        select: { issue: { select: { id: true, name: true, year: true } } },
      },
    },
  },
} satisfies Prisma.WantSelect;

type WantRow = Prisma.WantGetPayload<{ select: typeof WANT_SELECT }>;

function toWantListItem(
  row: WantRow,
  copies: WantCopyCounts,
  matchingCopies: WantCopyCounts = NO_COPIES,
  catalogRange: WantCatalogRange | null = null
): WantListItem {
  const primaryLink = row.stamp.stampAreaLinks.find((l) => l.isPrimary);
  const firstIssue = row.stamp.issueMemberships[0]?.issue ?? null;
  return {
    id: row.id,
    stampId: row.stampId,
    stampName: row.stamp.name,
    unknownVariant: isUnknownVariantStamp(row.stamp),
    subtype: subtypeLabel(row.stamp),
    issuedYear: row.stamp.issuedYear,
    catalogNumbers: row.stamp.catalogNumbers,
    colnectId: row.stamp.colnectId,
    areaId: primaryLink?.collectionAreaId ?? row.stamp.stampAreaLinks[0]?.collectionAreaId ?? null,
    issueId: firstIssue?.id ?? null,
    issueName: firstIssue?.name ?? null,
    issueYear: firstIssue?.year ?? null,
    photos: row.stamp.photos
      .map((p) => ({
        id: p.id,
        // Stamps use the single `main` slot (#137); keep any known slot role, else it is an extra.
        role: (p.role === "main" || p.role === "front" || p.role === "back" ? p.role : null) as
          | "front"
          | "back"
          | "main"
          | null,
        title: p.title,
        sortOrder: p.sortOrder,
      }))
      .sort(sortPhotos),
    conditionIds: row.conditions.map((c) => c.conditionId),
    certificateStatusIds: row.certificateStatuses.map((c) => c.certificateStatusId),
    formatIds: row.formats.map((f) => f.formatId),
    priority: wantPriorityFromRank(row.priority),
    notes: row.notes,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    copies,
    matchingCopies,
    catalogRange,
  };
}

/**
 * Copies of a wanted stamp, split by **where they physically are** (#532).
 *
 * One number was not enough. A want stays open until the collector closes it, which is right — but
 * a copy that has been *ordered* and not yet arrived then looks exactly like no copy at all, and the
 * same stamp coming up at the next auction reads as something still to chase. Splitting the figure
 * says the thing that was missing without inventing a state on the want or closing it early: you are
 * still looking for this, **and one is already on its way**.
 */
export interface WantCopyCounts {
  /** Sorted and filed — `delivered`. */
  held: number;
  /** Arrived but not yet sorted. Its own bucket rather than folded into `held`: it is the state a
   *  parcel sits in while it is being worked through, and "on the desk in a pile" is a different
   *  answer from "in the collection" to someone deciding whether to chase another one. */
  toSort: number;
  ordered: number;
  inTransit: number;
}

const NO_COPIES: WantCopyCounts = { held: 0, toSort: 0, ordered: 0, inTransit: 0 };

/** The four facts a copy is matched on, plus its id and where it is — what a per-want count needs.
 *  The id is carried so a surface **rendered on one copy** can leave that copy out of its own
 *  figures. */
interface CountedCopy extends WantCandidateCopy {
  itemId: string;
  deliveryState: string;
}

/** Every counted copy of these stamps, with the axes `wantMatchesCopy` reads. Bounded by the page's
 *  stamps, and the input to **both** figures below, so the per-stamp and per-want counts cannot be
 *  taken over different sets of copies. */
async function loadCountedCopies(
  collectionId: string,
  stampIds: string[]
): Promise<CountedCopy[]> {
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return [];
  const rows = await prisma.item.findMany({
    where: countedCopiesWhere(collectionId, ids),
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      deliveryState: true,
    },
  });
  return rows.map(({ id, ...rest }) => ({ itemId: id, ...rest }));
}

/** Tally a set of copies into the three buckets. */
function tally(copies: CountedCopy[]): WantCopyCounts {
  const counts: WantCopyCounts = { ...NO_COPIES };
  for (const c of copies) counts[copyDeliveryBucket(c.deliveryState)] += 1;
  return counts;
}

/** The copies that count at all — `copy-counts.ts`'s exclusions exactly, so a want's badge and the
 *  inventory cannot disagree about what "having one" means. Sold, disposed of and
 *  never-usably-delivered copies are not counted anywhere here. */
function countedCopiesWhere(collectionId: string, stampIds: string[]): Prisma.ItemWhereInput {
  return {
    collectionId,
    stampId: { in: stampIds },
    saleLineItems: { none: {} },
    // Given to a partner is a third way of no longer having it (#644), read off the trade rather
    // than written on the copy — so the want list and the copies list cannot disagree about it.
    ...NOT_TRADED_AWAY,
    disposedAt: null,
    deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
  };
}

/**
 * The split **per stamp**: everything the collection has of it, whichever want it does or does not
 * answer. Stamps with no copies at all are absent from the map.
 *
 * This is the *upgrade* figure. A mint-only want against a used copy in hand counts nothing per
 * want — the copy does not satisfy it — but "you already have one, just not that one" is exactly
 * what a collector standing at a dealer's table needs to know, and only this figure says it.
 */
export async function loadWantCopyCounts(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, WantCopyCounts>> {
  const result = new Map<string, WantCopyCounts>();
  const copies = await loadCountedCopies(collectionId, stampIds);
  for (const copy of copies) {
    const current = result.get(copy.stampId) ?? { ...NO_COPIES };
    current[copyDeliveryBucket(copy.deliveryState)] += 1;
    result.set(copy.stampId, current);
  }
  return result;
}

/** How the list narrows. Every field is optional; an absent one does not narrow. */
export interface WantListFilters {
  /** `open` (the list's subject) | `closed` | `all`. Defaults to `all` when unset. */
  status?: "open" | "closed" | "all";
  priorities?: WantPriority[];
  /** Wants that would take a copy in **any** of these conditions — an acceptance set that is empty
   *  ("any") matches every condition named, exactly as it does when a copy actually arrives. */
  conditionIds?: string[];
  /** The wanted stamp's own primary area, already expanded to descendants by the caller (#385). */
  areaIds?: string[];
  /** `"none"` is the no-year bucket; otherwise a numeric year string. Matched against the stamp's
   *  `issuedYear`, exactly as the stamps list matches it. */
  year?: string;
  /** One stamp's wants — what the stamp detail screen's card reads (#518). */
  stampId?: string;
  /** One issue's wants — what an expanded issue group reads its members with. `NO_ISSUE` is the
   *  wants whose stamp belongs to no issue, which an *absent* filter cannot ask for: absent means
   *  "any issue", the opposite question. Matches **any** membership, while a group is *counted* on
   *  the first — the same pair inventory's issue groups have carried since #172, and deliberately
   *  not a third rule. */
  issueId?: string;
  /** Free text over the stamp's name and catalog numbers, its issue's name, and the want's note. */
  search?: string;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedWantsResult {
  items: WantListItem[];
  /** The next page's offset as a string, or null at the end — the shape every list here uses. */
  nextCursor: string | null;
}

/**
 * The `where` behind both the page and the year facets, so a facet can never count a row the list
 * would not show. `omitYear` is what makes a facet say "how many rows would *this* year leave"
 * rather than "how many survive the year already picked" — the rule the stamps list follows.
 */
function buildWantListWhere(
  collectionId: string,
  filters: WantListFilters,
  omitYear = false
): Prisma.WantWhereInput {
  const where: Prisma.WantWhereInput = { collectionId };

  if (filters.stampId) where.stampId = filters.stampId;

  if (filters.status === "open") where.closedAt = null;
  else if (filters.status === "closed") where.closedAt = { not: null };

  if (filters.priorities && filters.priorities.length > 0) {
    where.priority = { in: filters.priorities.map((p) => WANT_PRIORITY_RANK[p]) };
  }

  // "Would this want take a copy in one of these conditions?" — so a want with **no** conditions on
  // it qualifies, its empty set meaning "any" (ADR-0032 §1). Two branches ORed, not one `some`.
  if (filters.conditionIds && filters.conditionIds.length > 0) {
    where.OR = [
      { conditions: { none: {} } },
      { conditions: { some: { conditionId: { in: filters.conditionIds } } } },
    ];
  }

  const stamp: Prisma.StampWhereInput = {};
  if (filters.areaIds && filters.areaIds.length > 0) {
    // The stamp's own area link, the same one the row draws its catalog chips against. A stamp
    // linked to no area is outside every area's scope rather than inside all of them.
    stamp.stampAreaLinks = { some: { collectionAreaId: { in: filters.areaIds } } };
  }
  if (!omitYear && filters.year) {
    stamp.issuedYear = filters.year === "none" ? null : Number(filters.year);
  }
  if (filters.issueId) {
    stamp.issueMemberships =
      filters.issueId === NO_ISSUE ? { none: {} } : { some: { issueId: filters.issueId } };
  }
  if (Object.keys(stamp).length > 0) where.stamp = stamp;

  const text = filters.search?.trim();
  if (text) {
    const contains = { contains: text, mode: "insensitive" as const };
    // ANDed with the condition `OR` above rather than merged into it — two independent questions,
    // and one `OR` array holding both would make either alone enough to match.
    where.AND = [
      {
        OR: [
          { notes: contains },
          { stamp: { name: contains } },
          { stamp: { catalogNumbers: { some: { number: contains } } } },
          { stamp: { issueMemberships: { some: { issue: { name: contains } } } } },
        ],
      },
    ];
  }
  return where;
}

/**
 * The list's order, and the reason each step is there.
 *
 * Open before closed — the list's subject is what is still being looked for. Then urgency, which the
 * stored rank puts in the right direction on its own. Then newest first, and finally `id`, because
 * an offset page over rows that tie is only stable if the order is total: without the last tiebreak
 * the same want can appear on two pages, or on none.
 */
const WANT_ORDER = [
  { closedAt: { sort: "asc", nulls: "first" } },
  { priority: "asc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.WantOrderByWithRelationInput[];

/**
 * One page of the want list.
 *
 * Paged on the server, unlike the address book it was first modelled on: a collection's contacts
 * are a few hundred at most, while a want list is a shopping list for a whole collecting plan and
 * runs to thousands. Every filter is therefore a `where` rather than a pass over rows already in
 * the browser, and the page carries only what the row draws.
 */
export async function listWantsPaginated(
  ownerId: string,
  collectionId: string,
  filters: WantListFilters = {}
): Promise<PaginatedWantsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await prisma.want.findMany({
    where: buildWantListWhere(collectionId, filters),
    select: WANT_SELECT,
    orderBy: WANT_ORDER,
    skip: offset,
    // One more than asked for, so "is there another page" needs no second count query.
    take: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  // The copy badges, counted for this page's stamps only — the figures are per row, so a
  // collection-wide count would grow with the list while answering nothing extra.
  const stampIds = [...new Set(page.map((r) => r.stampId))];
  const [countedCopies, rangeByWant] = await Promise.all([
    loadCountedCopies(collectionId, stampIds),
    loadCatalogRanges(collectionId, page),
  ]);
  const copiesByStamp = new Map<string, CountedCopy[]>();
  for (const copy of countedCopies) {
    const list = copiesByStamp.get(copy.stampId);
    if (list) list.push(copy);
    else copiesByStamp.set(copy.stampId, [copy]);
  }

  return {
    items: page.map((r) => {
      const stampCopies = copiesByStamp.get(r.stampId) ?? [];
      const acceptance: WantAcceptance = {
        stampId: r.stampId,
        conditionIds: r.conditions.map((c) => c.conditionId),
        certificateStatusIds: r.certificateStatuses.map((c) => c.certificateStatusId),
        formatIds: r.formats.map((f) => f.formatId),
      };
      return toWantListItem(
        r,
        tally(stampCopies),
        tally(stampCopies.filter((c) => wantMatchesCopy(acceptance, c))),
        rangeByWant.get(r.id) ?? null
      );
    }),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/**
 * The catalogue range for one page of wants (#532), keyed by want id.
 *
 * Everything it loads is scoped to **the page**: the catalogue prices of the page's stamps and of
 * the descendant variants of the unknown-variant ones among them. The rest — the primary-catalog
 * map, the base currency, the format multipliers and the collection's dictionaries — is per
 * collection and loaded once, exactly as `listStampsPaginated` loads it for its own price column.
 * So a page of wants costs a page of stamps, not a query per row.
 */
async function loadCatalogRanges(
  collectionId: string,
  page: { id: string; stampId: string }[]
): Promise<Map<string, WantCatalogRange>> {
  const result = new Map<string, WantCatalogRange>();
  if (page.length === 0) return result;

  const stampIds = [...new Set(page.map((r) => r.stampId))];
  const [primaryCatalogByArea, baseCurrency, factorLookup, conditions, certificates, formats, stamps] =
    await Promise.all([
      buildEffectivePrimaryCatalogMap(collectionId),
      getCollectionBaseCurrency(collectionId),
      makeFormatFactorLookup(collectionId),
      prisma.stampCondition.findMany({ where: { collectionId }, select: { id: true } }),
      prisma.certificateStatus.findMany({ where: { collectionId }, select: { id: true } }),
      prisma.stampFormat.findMany({ where: { collectionId }, select: { id: true } }),
      prisma.stamp.findMany({
        where: { id: { in: stampIds } },
        select: {
          id: true,
          parentId: true,
          catalogPrices: { select: CATALOG_PRICE_SELECT },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          variants: {
            select: {
              id: true,
              ...VARIANT_FLAG_SELECT,
              catalogPrices: { select: CATALOG_PRICE_SELECT },
            },
          },
          issueMemberships: { orderBy: { issueId: "asc" }, take: 1, select: { issueId: true } },
        },
      }),
    ]);

  // `null` is a member of these two — "no certificate" and "single" — not the absence of one.
  const dictionaries = {
    conditionIds: conditions.map((c) => c.id),
    certificateStatusIds: [null, ...certificates.map((c) => c.id)] as (string | null)[],
    formatIds: [null, ...formats.map((f) => f.id)] as (string | null)[],
  };

  const byStamp = new Map(stamps.map((s) => [s.id, s]));
  // Every currency that could contribute, fetched in one go rather than per row.
  const currencies = [
    ...new Set(
      stamps.flatMap((s) => [
        ...s.catalogPrices.map((p) => p.currency),
        ...s.variants.flatMap((v) => v.catalogPrices.map((p) => p.currency)),
      ])
    ),
  ];
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);

  const wantsByStamp = new Map<string, string[]>();
  for (const row of page) {
    const list = wantsByStamp.get(row.stampId);
    if (list) list.push(row.id);
    else wantsByStamp.set(row.stampId, [row.id]);
  }

  // The acceptance is read back off the page's rows, which already carry it.
  const acceptanceByWant = new Map(
    (page as WantRow[]).map((r) => [
      r.id,
      {
        stampId: r.stampId,
        conditionIds: r.conditions.map((c) => c.conditionId),
        certificateStatusIds: r.certificateStatuses.map((c) => c.certificateStatusId),
        formatIds: r.formats.map((f) => f.formatId),
      },
    ])
  );

  for (const [stampId, wantIds] of wantsByStamp) {
    const stamp = byStamp.get(stampId);
    if (!stamp) continue;
    const areaId =
      stamp.stampAreaLinks.find((l) => l.isPrimary)?.collectionAreaId ??
      stamp.stampAreaLinks[0]?.collectionAreaId ??
      null;
    const issueId = stamp.issueMemberships[0]?.issueId ?? null;
    const valuationStamp = {
      unknownVariant: isUnknownVariantStamp(stamp),
      primaryCatalogNameId: areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null,
      ownPrices: stamp.catalogPrices,
      variantPrices: stamp.variants.map((v) => ({ stampId: v.id, prices: v.catalogPrices })),
    };
    // The multiplier depends on the stamp's area and issue, not on the want, so it is bound once
    // per stamp and the pure half only ever asks it about a format.
    const factorFor = (formatId: string | null) =>
      factorLookup(formatId, areaId, issueId, null);

    for (const wantId of wantIds) {
      const acceptance = acceptanceByWant.get(wantId);
      if (!acceptance) continue;
      const range = wantCatalogRange(
        acceptance,
        valuationStamp,
        dictionaries,
        baseCurrency,
        rates,
        factorFor
      );
      if (range) result.set(wantId, range);
    }
  }
  return result;
}

// ── The want marker on the catalogue lists (#532) ────────────────────────────

/** One open want, as a catalogue row's popover states it: the three axes already resolved to words,
 *  plus what the row's own chips would show. Resolved **here** rather than on the row because it
 *  needs the collection's dictionaries, which a catalogue row has no other reason to load — and
 *  because the two surfaces must not word one want two ways. */
export interface StampWantSummaryEntry {
  /** Each axis in the want list's own wording, "any …" included: a blank axis and an unanswered
   *  one look identical and mean opposite things (ADR-0032 §1). */
  conditions: string;
  certificate: string;
  format: string;
  priority: WantPriority;
  notes: string | null;
  /** The same want as **ids**, so a surface holding a concrete `(condition, certificate, format)` —
   *  an auction lot line, a copy — can ask `wantMatchesCopy` whether *this one* would satisfy it.
   *  The words above are for reading; this is for deciding, and both come off one row so the two
   *  answers cannot disagree. */
  acceptance: WantAcceptance;
  /** Copies that would satisfy **this** want, split by where they are — the figure that answers
   *  "am I already getting one of these?". Distinct from the stamp-wide count on the summary: a
   *  mint-only want reads `0 held` here while the stamp shows a used copy in hand, and both are
   *  true. Only this one may carry an *already on its way* claim. */
  copies: WantCopyCounts;
}

/** What a catalogue row says about being wanted: a count, a colour and the detail behind them. */
export interface StampWantSummary {
  openCount: number;
  /** The most urgent among the open wants — what the chip's colour states. A row carries one chip
   *  however many wants sit behind it, so it shows the loudest of them rather than an average. */
  topPriority: WantPriority;
  /** The wants themselves, most urgent first. Structured rather than pre-joined text: the chip
   *  opens a popover that draws them as the want list draws them, and a sentence cannot be laid
   *  out as chips. */
  entries: StampWantSummaryEntry[];
  /** Copies of **the stamp**, whichever want they do or do not answer — the upgrade context, and
   *  deliberately not the basis of any "on its way" claim, which belongs per want on the entries
   *  above. Carried here so the chip's popover can say both without conflating them. */
  copies: WantCopyCounts;
}

/**
 * The open wants of a page's stamps, keyed by stamp id. Stamps with none are absent from the map.
 *
 * Scoped to the ids handed in — the same call `loadStampCopyCounts` makes, and for the same reason:
 * this is a per-row badge, so a collection-wide read would grow with the catalogue while answering
 * nothing extra. Closed wants are left out: a marker on a catalogue row is there to say *this is
 * still being looked for*, and a settled one would keep saying it for ever.
 */
export async function loadStampWantSummaries(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampWantSummary>> {
  const context = await loadWantSummaryContext(collectionId, stampIds);
  const result = new Map<string, StampWantSummary>();
  for (const stampId of new Set(stampIds)) {
    const summary = buildStampWantSummary(context, stampId);
    if (summary) result.set(stampId, summary);
  }
  return result;
}

/**
 * The same marker for a page of **copies**, keyed by copy id — each one leaving *itself* out.
 *
 * A copy row shows this beside the very copy whose delivery state it would otherwise count, so
 * without the exclusion a purchase order reported *one in transit* about the row you were reading.
 * A figure that exists to say "something else is already coming" must not be satisfied by the thing
 * in front of you. Keyed per copy rather than per stamp because two copies of one stamp can sit on
 * one page, and each must leave out a different one.
 */
export async function loadItemWantSummaries(
  collectionId: string,
  items: { itemId: string; stampId: string }[]
): Promise<Map<string, StampWantSummary>> {
  const context = await loadWantSummaryContext(collectionId, items.map((i) => i.stampId));
  const result = new Map<string, StampWantSummary>();
  for (const item of items) {
    const summary = buildStampWantSummary(context, item.stampId, item.itemId);
    if (summary) result.set(item.itemId, summary);
  }
  return result;
}

/** Everything both readers above need, loaded once for the whole page. */
interface WantSummaryContext {
  wantsByStamp: Map<string, WantSummaryRow[]>;
  copiesByStamp: Map<string, CountedCopy[]>;
  conditionName: Map<string, string>;
  certificateName: Map<string, string>;
  formatName: Map<string, string>;
}

type WantSummaryRow = {
  stampId: string;
  priority: number;
  notes: string | null;
  conditions: { conditionId: string }[];
  certificateStatuses: { certificateStatusId: string | null }[];
  formats: { formatId: string | null }[];
};

async function loadWantSummaryContext(
  collectionId: string,
  stampIds: string[]
): Promise<WantSummaryContext> {
  const ids = [...new Set(stampIds)];
  const empty: WantSummaryContext = {
    wantsByStamp: new Map(),
    copiesByStamp: new Map(),
    conditionName: new Map(),
    certificateName: new Map(),
    formatName: new Map(),
  };
  if (ids.length === 0) return empty;

  const [wants, conditions, certificates, formats, countedCopies] = await Promise.all([
    prisma.want.findMany({
      where: { collectionId, closedAt: null, stampId: { in: ids } },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: {
        stampId: true,
        priority: true,
        notes: true,
        conditions: { select: { conditionId: true } },
        certificateStatuses: { select: { certificateStatusId: true } },
        formats: { select: { formatId: true } },
      },
    }),
    prisma.stampCondition.findMany({
      where: { collectionId },
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.certificateStatus.findMany({ where: { collectionId }, select: { id: true, name: true } }),
    prisma.stampFormat.findMany({ where: { collectionId }, select: { id: true, name: true } }),
    loadCountedCopies(collectionId, ids),
  ]);
  if (wants.length === 0) return empty;

  const wantsByStamp = new Map<string, WantSummaryRow[]>();
  for (const w of wants) {
    const list = wantsByStamp.get(w.stampId);
    if (list) list.push(w);
    else wantsByStamp.set(w.stampId, [w]);
  }
  const copiesByStamp = new Map<string, CountedCopy[]>();
  for (const copy of countedCopies) {
    const list = copiesByStamp.get(copy.stampId);
    if (list) list.push(copy);
    else copiesByStamp.set(copy.stampId, [copy]);
  }

  return {
    wantsByStamp,
    copiesByStamp,
    conditionName: new Map(conditions.map((c) => [c.id, c.abbreviation || c.name])),
    certificateName: new Map(certificates.map((c) => [c.id, c.name])),
    formatName: new Map(formats.map((f) => [f.id, f.name])),
  };
}

/** One stamp's marker, optionally leaving one copy out of every figure. Null when nothing is
 *  wanted — the chip is absent rather than drawn empty. */
function buildStampWantSummary(
  context: WantSummaryContext,
  stampId: string,
  excludeItemId?: string
): StampWantSummary | null {
  const wants = context.wantsByStamp.get(stampId);
  if (!wants || wants.length === 0) return null;

  const stampCopies = (context.copiesByStamp.get(stampId) ?? []).filter(
    (c) => c.itemId !== excludeItemId
  );
  // An empty axis says "any" out loud: a blank one and an unanswered one look identical and mean
  // opposite things (ADR-0032 §1). `null` is each axis's own "none" value, never "any" (§3).
  const axis = <T extends string | null>(
    ids: T[],
    nameFor: (id: T) => string,
    anyLabel: string
  ): string => (ids.length === 0 ? anyLabel : ids.map(nameFor).join(", "));

  const entries: StampWantSummaryEntry[] = wants.map((w) => {
    const acceptance: WantAcceptance = {
      stampId,
      conditionIds: w.conditions.map((c) => c.conditionId),
      certificateStatusIds: w.certificateStatuses.map((c) => c.certificateStatusId),
      formatIds: w.formats.map((f) => f.formatId),
    };
    return {
      conditions: axis(
        acceptance.conditionIds,
        (id) => context.conditionName.get(id) ?? "?",
        "Any condition"
      ),
      certificate: axis(
        acceptance.certificateStatusIds,
        (id) => (id === null ? "No certificate" : (context.certificateName.get(id) ?? "?")),
        "Certificate: any"
      ),
      format: axis(
        acceptance.formatIds,
        (id) => (id === null ? "Single" : (context.formatName.get(id) ?? "?")),
        "Any format"
      ),
      priority: wantPriorityFromRank(w.priority),
      notes: w.notes,
      acceptance,
      // The same predicate the intake review and the lot-line ring use, so "already on its way"
      // and "this one would satisfy it" cannot disagree about one copy.
      copies: tally(stampCopies.filter((c) => wantMatchesCopy(acceptance, c))),
    };
  });

  return {
    openCount: entries.length,
    // The query is ordered by rank, so the first want of a stamp is already its loudest.
    topPriority: entries[0].priority,
    entries,
    copies: tally(stampCopies),
  };
}

// ── Issue groups (#532) ──────────────────────────────────────────────────────

/**
 * One row of the want list collapsed to the issue its wanted stamps belong to.
 *
 * The list stays **flat by default** and this is a view of it, not its shape. A want's subject is a
 * *stamp* and its acceptance criteria are per stamp — a key value wanted MNH with a certificate, the
 * rest "anything" — so an issue heading over rows whose terms differ is a heading that overstates.
 * The reading it does serve is the other one: after a whole-series add (§5b) or a gap generator run
 * (§6), twelve rows say the same thing twelve times, and "what is left of this series" is the
 * question being asked.
 */
export interface WantIssueGroupRow {
  /** Stable per-group key — the React key, and the value the members are read back with: an issue
   *  id, or `NO_ISSUE` for the wants whose stamp is in no issue. */
  key: string;
  /** Null is the issue-less bucket. */
  issueId: string | null;
  /** Ready-made label (`Chopin (1949)`), written by the shared `issueGroupLabel`. */
  label: string;
  issueName: string | null;
  issueYear: number | null;
  /** Still being looked for, under this group. */
  openCount: number;
  /** Every want recorded under it, open or closed — the denominator of `openCount`. */
  totalCount: number;
}

export interface PaginatedWantIssueGroupsResult {
  groups: WantIssueGroupRow[];
  nextCursor: string | null;
}

/**
 * The want list as one row per series (#532), for "how much of this set am I still after".
 *
 * Grouped **server-side**, for the reason inventory's issue groups are (#424): the list is
 * offset-paginated, and grouping in the browser would split a group at a page boundary and report
 * two half-counts.
 *
 * The figures are `open / total`, and both are counted with the panel's filters **minus the
 * open/closed one**. That is the year facets' rule and it is here for the same reason: "8 of 12" has
 * to mean the same thing whichever side of the status toggle you are looking from, and a
 * denominator that moved when you flipped to *Closed* would be a fraction of nothing in particular.
 * Which groups appear still obeys the status filter — a series whose wants are all closed is not
 * part of a list showing open ones — and because status narrows on `closedAt` alone, that follows
 * from the two counts without a second query.
 *
 * A want is reported under **one** issue, its stamp's first membership, the same one
 * `WantListItem.issueId` states. One answer per want, so the groups partition the list and their
 * counts add up to it.
 */
export async function listWantIssueGroups(
  ownerId: string,
  collectionId: string,
  filters: WantListFilters = {}
): Promise<PaginatedWantIssueGroupsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await prisma.want.findMany({
    // Every filter but the status, which the two counts below express instead.
    where: buildWantListWhere(collectionId, { ...filters, status: "all" }),
    select: {
      closedAt: true,
      stamp: {
        select: {
          issueMemberships: {
            orderBy: { issueId: "asc" },
            take: 1,
            select: {
              issue: { select: { id: true, name: true, year: true, primaryCatalogSortKey: true } },
            },
          },
        },
      },
    },
  });

  const groups = new Map<string, WantIssueGroupRow & SortableIssueGroup>();
  for (const row of rows) {
    const issue = row.stamp.issueMemberships[0]?.issue ?? null;
    const key = issue?.id ?? NO_ISSUE;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        issueId: issue?.id ?? null,
        label: issueGroupLabel(issue?.id ?? null, issue?.name ?? null, issue?.year ?? null),
        issueName: issue?.name ?? null,
        issueYear: issue?.year ?? null,
        catalogSortKey: issue?.primaryCatalogSortKey ?? null,
        openCount: 0,
        totalCount: 0,
      };
      groups.set(key, group);
    }
    group.totalCount += 1;
    if (row.closedAt === null) group.openCount += 1;
  }

  const status = filters.status ?? "all";
  const shown = [...groups.values()].filter((g) =>
    status === "open"
      ? g.openCount > 0
      : status === "closed"
        ? g.totalCount > g.openCount
        : g.totalCount > 0
  );

  // Read whole and paged in memory, as inventory's are: the reading order is the Issues list's own
  // and the counts are the point, and the set is bounded by how many issues a collection has
  // entered rather than by how many wants it holds. The order is total, so paging over it can
  // neither repeat nor skip a group.
  const ordered = shown.sort(compareIssueGroups);
  const page = ordered.slice(offset, offset + pageSize);
  return {
    // `catalogSortKey` is an ordering input, not something a row states — it is a denormalized
    // column, and the screen has the catalog numbers themselves.
    groups: page.map(({ key, issueId, label, issueName, issueYear, openCount, totalCount }) => ({
      key,
      issueId,
      label,
      issueName,
      issueYear,
      openCount,
      totalCount,
    })),
    nextCursor: offset + pageSize < ordered.length ? String(offset + pageSize) : null,
  };
}

/** One year facet: how many wants that year would leave, given every *other* filter. */
export interface WantYearFacet {
  /** null is the "no year" bucket. */
  year: number | null;
  count: number;
}

/**
 * The year facets, over the wanted stamps' own `issuedYear` — the same year the stamps list facets.
 *
 * A projection rather than a `groupBy`: the year lives on the related `Stamp`, which Prisma cannot
 * group by, and one nullable int per matching want is small enough that reaching for raw SQL would
 * cost more than it saves. Newest first, "no year" last, as everywhere else.
 */
export async function listWantYearFacets(
  ownerId: string,
  collectionId: string,
  filters: WantListFilters = {}
): Promise<WantYearFacet[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.want.findMany({
    where: buildWantListWhere(collectionId, filters, true),
    select: { stamp: { select: { issuedYear: true } } },
  });
  const counts = new Map<number | null, number>();
  for (const r of rows) {
    const y = r.stamp.issuedYear;
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}

/** One want, for the edit form.
 *
 *  The copy counts come back **all zero, meaning "not asked"** — they are the list row's badges and
 *  cost a grouped count, which a single-want read has no reason to pay for. Nothing that calls this
 *  renders them; a surface that wants them should read the list. */
export async function getWant(ownerId: string, wantId: string): Promise<WantListItem> {
  await resolveWantCollection(ownerId, wantId);
  const row = await prisma.want.findUniqueOrThrow({ where: { id: wantId }, select: WANT_SELECT });
  return toWantListItem(row, NO_COPIES);
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** The acceptance a create or an edit submits — {@link AcceptanceInput} under the name this module
 *  and its callers already use. It is stated in `acceptance.ts` rather than here because a named
 *  profile (#533) is defined over the very same three axes and validated by the same rule. */
export type WantAcceptanceInput = AcceptanceInput;

export interface WantInput extends WantAcceptanceInput {
  stampId: string;
  priority: WantPriority;
  notes: string | null;
}

/**
 * What the add form submits: one stamp **or** a whole checklist (#532).
 *
 * A collector looking for a series is looking for every stamp on it on the same terms, and entering
 * that twelve times over is the same work the lot intake's *whole set* button already removes. The
 * fan-out is the same shape `intakeStamps` has — one named checklist, expanded here — rather than a
 * `Want` that points at a set: a want is per stamp, because each is found, priced and closed on its
 * own day, and a set-shaped want could never be half met.
 */
export type WantCreateInput = Omit<WantInput, "stampId"> & {
  stampId?: string | null;
  checklistId?: string | null;
};

/** What a create did. `skipped` is only ever non-zero for a checklist fan-out. */
export interface WantCreateResult {
  created: number;
  /** Stamps on the checklist that already carried an **open** want, so nothing was written. */
  skipped: number;
  /** The wants written, in the order their stamps came off the checklist. */
  ids: string[];
}

/** The three acceptance tables, written as one replacement — see {@link WantAcceptanceInput}. */
async function writeAcceptance(
  tx: Prisma.TransactionClient,
  wantId: string,
  acceptance: WantAcceptanceInput
): Promise<void> {
  await tx.wantCondition.deleteMany({ where: { wantId } });
  await tx.wantCertificateStatus.deleteMany({ where: { wantId } });
  await tx.wantFormat.deleteMany({ where: { wantId } });

  if (acceptance.conditionIds.length) {
    await tx.wantCondition.createMany({
      data: acceptance.conditionIds.map((conditionId) => ({ wantId, conditionId })),
    });
  }
  if (acceptance.certificateStatusIds.length) {
    await tx.wantCertificateStatus.createMany({
      data: acceptance.certificateStatusIds.map((certificateStatusId) => ({
        wantId,
        certificateStatusId,
      })),
    });
  }
  if (acceptance.formatIds.length) {
    await tx.wantFormat.createMany({
      data: acceptance.formatIds.map((formatId) => ({ wantId, formatId })),
    });
  }
}

/**
 * Add one want, or one per stamp of a checklist, all on the same terms.
 *
 * The fan-out skips a stamp that already carries an **open** want and reports how many — the
 * collector asked for the set, not for a second copy of what is already on the list, and saying so
 * is what stops *Add whole set* from reading as "nothing happened". It deliberately does **not**
 * skip stamps you already hold: unlike the completeness generator (§6), which turns *gaps* into
 * wants, this is the collector naming what they are after, and wanting a better copy of something
 * held is the ordinary case.
 */
export async function createWant(
  ownerId: string,
  collectionId: string,
  input: WantCreateInput
): Promise<WantCreateResult> {
  await assertCollectionOwner(ownerId, collectionId);

  let stampIds: string[];
  if (input.checklistId) {
    const checklist = await prisma.checklist.findFirst({
      where: { id: input.checklistId, collectionId },
      select: { name: true, stamps: { select: { stampId: true } } },
    });
    if (!checklist) throw new Error("Checklist not found in this collection.");
    stampIds = [...new Set(checklist.stamps.map((s) => s.stampId))];
    if (stampIds.length === 0) throw new Error(`"${checklist.name}" has no stamps on it yet.`);
  } else if (input.stampId) {
    const stamp = await prisma.stamp.findFirst({
      where: { id: input.stampId, collectionId },
      select: { id: true },
    });
    if (!stamp) throw new Error("Stamp not found in this collection.");
    stampIds = [input.stampId];
  } else {
    throw new Error("Select a stamp or a whole set to add.");
  }

  const acceptance = await validateAcceptance(collectionId, input);
  const notes = input.notes?.trim() || null;

  // Only the fan-out defers to what is already there. A single-stamp add is an explicit act on one
  // stamp, and refusing it because a want exists would be the app overruling the collector.
  let targets = stampIds;
  let skipped = 0;
  if (input.checklistId) {
    const open = await prisma.want.findMany({
      where: { collectionId, closedAt: null, stampId: { in: stampIds } },
      select: { stampId: true },
    });
    const already = new Set(open.map((w) => w.stampId));
    targets = stampIds.filter((id) => !already.has(id));
    skipped = stampIds.length - targets.length;
  }
  if (targets.length === 0) return { created: 0, skipped, ids: [] };

  const ids = await prisma.$transaction(async (tx) => {
    const wants = await tx.want.createManyAndReturn({
      data: targets.map((stampId) => ({
        collectionId,
        stampId,
        priority: WANT_PRIORITY_RANK[input.priority],
        notes,
      })),
      select: { id: true },
    });
    for (const want of wants) {
      await writeAcceptance(tx, want.id, acceptance);
    }
    return wants.map((w) => w.id);
  });
  return { created: ids.length, skipped, ids };
}

export async function updateWant(
  ownerId: string,
  wantId: string,
  input: WantInput
): Promise<void> {
  const collectionId = await resolveWantCollection(ownerId, wantId);
  const stamp = await prisma.stamp.findFirst({
    where: { id: input.stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");

  const acceptance = await validateAcceptance(collectionId, input);

  await prisma.$transaction(async (tx) => {
    await tx.want.update({
      where: { id: wantId },
      data: {
        stampId: input.stampId,
        priority: WANT_PRIORITY_RANK[input.priority],
        notes: input.notes?.trim() || null,
      },
    });
    await writeAcceptance(tx, wantId, acceptance);
  });
}

/**
 * Narrow a want's acceptance and nothing else (ADR-0032 §7) — the intake review's middle choice.
 *
 * Its own verb rather than a call to {@link updateWant}: narrowing is a *refinement of the record*
 * made while a copy is being taken in, and it must not be able to move the want to another stamp,
 * rewrite its price or reopen it as a side effect of a dialog whose subject is the arriving copy.
 */
export async function narrowWant(
  ownerId: string,
  wantId: string,
  acceptance: WantAcceptanceInput
): Promise<void> {
  const collectionId = await resolveWantCollection(ownerId, wantId);
  const validated = await validateAcceptance(collectionId, acceptance);
  await prisma.$transaction(async (tx) => {
    await writeAcceptance(tx, wantId, validated);
  });
}

/** Close a want — the collector saying it is met. Idempotent: the first close keeps its moment. */
export async function closeWant(ownerId: string, wantId: string): Promise<void> {
  await resolveWantCollection(ownerId, wantId);
  await prisma.want.updateMany({
    where: { id: wantId, closedAt: null },
    data: { closedAt: new Date() },
  });
}

export async function reopenWant(ownerId: string, wantId: string): Promise<void> {
  await resolveWantCollection(ownerId, wantId);
  await prisma.want.update({ where: { id: wantId }, data: { closedAt: null } });
}

export async function deleteWant(ownerId: string, wantId: string): Promise<void> {
  await resolveWantCollection(ownerId, wantId);
  await prisma.want.delete({ where: { id: wantId } });
}

// ── Intake review ──────────────────────────────────────────────────────────

/** An open want a copy could satisfy, with the copy that could. */
export interface WantMatchForCopy {
  itemId: string;
  want: WantListItem;
}

/**
 * The open wants each of these copies could satisfy (ADR-0032 §7).
 *
 * Read, never write. Closing, narrowing or leaving each one open is the collector's decision, and
 * that is the whole reason this exists as a separate call rather than as a hook inside intake.
 */
export async function findWantsSatisfiedBy(
  ownerId: string,
  collectionId: string,
  copies: ArrivingCopy[]
): Promise<WantMatchForCopy[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const stampIds = [...new Set(copies.map((c) => c.stampId))];
  if (stampIds.length === 0) return [];

  const rows = await prisma.want.findMany({
    where: { collectionId, closedAt: null, stampId: { in: stampIds } },
    select: WANT_SELECT,
  });
  if (rows.length === 0) return [];

  const matches: WantMatchForCopy[] = [];
  for (const row of rows) {
    const acceptance: WantAcceptance = {
      stampId: row.stampId,
      conditionIds: row.conditions.map((c) => c.conditionId),
      certificateStatusIds: row.certificateStatuses.map((c) => c.certificateStatusId),
      formatIds: row.formats.map((f) => f.formatId),
    };
    for (const copy of copies) {
      if (wantMatchesCopy(acceptance, copy)) {
        // Counts all zero = not asked, as in `getWant` — the review dialog names the arriving copy,
        // not the pile behind it.
        matches.push({ itemId: copy.itemId, want: toWantListItem(row, NO_COPIES) });
      }
    }
  }
  return matches;
}

// ── The completeness generator ─────────────────────────────────────────────

/**
 * Materialise wants for the stamps a checklist is missing (ADR-0032 §6).
 *
 * A **generator, not a source**: it writes explicit, editable rows once, and a checklist edited
 * afterwards touches nothing. Every created want has empty acceptance sets — "anything will do" —
 * because a gap says only that the stamp is absent, and inventing acceptance criteria from it is
 * exactly the derivation this design refuses.
 *
 * Skips a stamp with any held copy, and a stamp that already carries an **open** want. A closed
 * want is not a reason to skip: the collector closed it, and if the stamp is missing again the gap
 * is real. That pair of rules is what makes pressing the button twice a no-op rather than a pile of
 * duplicates.
 */
export async function createWantsForMissing(
  ownerId: string,
  collectionId: string,
  checklistId: string
): Promise<{ created: number; missing: number }> {
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: { stamps: { select: { stampId: true } } },
  });
  if (!checklist) throw new Error("Checklist not found in this collection.");

  const gap = await wantGapForStamps(
    collectionId,
    checklist.stamps.map((s) => s.stampId),
    ANY_ACCEPTANCE
  );
  return writeGeneratedWants(collectionId, gap, ANY_ACCEPTANCE);
}

/** "Anything will do" — the terms the completeness card's own button has always written, and the
 *  bulk dialog's default. Every axis empty, which is what an empty set means everywhere here. */
const ANY_ACCEPTANCE: WantAcceptanceInput = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
};

/**
 * Which of `stampIds` are missing **on these terms**, and which of those the generator would write.
 *
 * The two rules of ADR-0032 §6, stated once so the read that *previews* a bulk add and the write
 * that performs it cannot disagree — and both read *through the terms*, because a generator that
 * can be asked for MNH has to answer the two questions about MNH:
 *
 * - **Missing** is "no counted copy the terms would take", judged by `wantMatchesCopy` — the same
 *   predicate the intake review runs, so a want and the copy that answers it cannot drift. With
 *   the terms wide open every copy matches, which is the original rule unchanged.
 * - **Already wanted** is an open want *with the same terms* (`acceptanceSetsEqual`), not any open
 *   want at all. A second wide-open want beside a wide-open one says nothing the first does not,
 *   and that is what the skip is for; a used-for-sale want beside a mint-for-me one is two
 *   different intents about one stamp, which ADR-0032 §1 makes a want *per terms* to express.
 *
 * A closed want still skips nothing: the collector closed it, and a gap that is back is real.
 *
 * **Held is read the way the completeness card reads it** (#661): a copy filed under a variant of
 * one of these stamps is a copy of it, so the counting set reaches below `stampIds` and each copy
 * is attributed back to the stamp it answers for. The button sits on that card and says *add what
 * is missing*; a gap that disagreed with the fraction above it would want a stamp the card had
 * just called held.
 */
async function wantGapForStamps(
  collectionId: string,
  stampIds: string[],
  acceptance: WantAcceptanceInput
): Promise<{ missing: string[]; toCreate: string[] }> {
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return { missing: [], toCreate: [] };
  const members = new Set(ids);
  const rollup = await loadChecklistVariantRollup(collectionId, ids);

  const [copies, openWants] = await Promise.all([
    prisma.item.findMany({
      where: countedCopiesWhere(collectionId, rollup.countingStampIds),
      select: {
        stampId: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
      },
    }),
    prisma.want.findMany({
      where: { collectionId, closedAt: null, stampId: { in: ids } },
      select: {
        stampId: true,
        conditions: { select: { conditionId: true } },
        certificateStatuses: { select: { certificateStatusId: true } },
        formats: { select: { formatId: true } },
      },
    }),
  ]);

  const satisfied = new Set(
    copies
      .filter((c) => wantMatchesCopy({ ...acceptance, stampId: c.stampId }, c))
      .flatMap((c) => {
        const member = rollup.memberFor(c.stampId, members);
        return member === null ? [] : [member];
      })
  );
  const wantedOnTheseTerms = new Set(
    openWants
      .filter((w) =>
        acceptanceSetsEqual(acceptance, {
          conditionIds: w.conditions.map((c) => c.conditionId),
          certificateStatusIds: w.certificateStatuses.map((c) => c.certificateStatusId),
          formatIds: w.formats.map((f) => f.formatId),
        })
      )
      .map((w) => w.stampId)
  );

  const missing = ids.filter((id) => !satisfied.has(id));
  return { missing, toCreate: missing.filter((id) => !wantedOnTheseTerms.has(id)) };
}

/** Writes one want per stamp of a gap, all on the terms the gap was taken against, and reports what
 *  it did in the two numbers every caller says out loud: how many rows appeared, and how large the
 *  gap was. The acceptance rows go in the same transaction as the wants, `createWant`'s shape, so a
 *  failure halfway cannot leave a batch of wants meaning "anything" by accident. */
async function writeGeneratedWants(
  collectionId: string,
  gap: { missing: string[]; toCreate: string[] },
  acceptance: WantAcceptanceInput
): Promise<{ created: number; missing: number }> {
  const hasTerms =
    acceptance.conditionIds.length > 0 ||
    acceptance.certificateStatusIds.length > 0 ||
    acceptance.formatIds.length > 0;
  if (gap.toCreate.length > 0) {
    await prisma.$transaction(async (tx) => {
      const wants = await tx.want.createManyAndReturn({
        data: gap.toCreate.map((stampId) => ({ collectionId, stampId })),
        select: { id: true },
      });
      // Wide-open terms are the absence of rows, so a whole-issue run on the default writes the
      // wants alone rather than three deletes per want against tables it just did not fill.
      if (hasTerms) for (const w of wants) await writeAcceptance(tx, w.id, acceptance);
    });
  }
  return { created: gap.toCreate.length, missing: gap.missing.length };
}

/** One checklist of an issue as the bulk-add dialog needs it (#548): named, and carrying the stamp
 *  ids behind its two numbers so the client can union a *selection* of checklists — a stamp on two
 *  of them is one want, and counts alone cannot say that. */
export interface IssueWantGapChecklist {
  checklistId: string;
  name: string;
  /** Stamps of this checklist with no counted copy. */
  missingStampIds: string[];
  /** The subset of {@link missingStampIds} carrying no open want — what pressing Add would write. */
  toCreateStampIds: string[];
}

/**
 * The gap of every checklist of one issue (#548), for the confirmation that precedes a bulk add.
 *
 * Read per checklist rather than over the issue's whole membership, because the collector chooses
 * *which goals* to shop for when an issue holds several (#531) — and an issue's optional extras are
 * on no checklist at all, so "every stamp of the issue" was never the right set to want.
 */
export async function previewIssueMissingWants(
  ownerId: string,
  collectionId: string,
  issueId: string,
  acceptance: WantAcceptanceInput = ANY_ACCEPTANCE
): Promise<IssueWantGapChecklist[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const terms = await validateAcceptance(collectionId, acceptance);
  const checklists = await prisma.checklist.findMany({
    where: { collectionId, issueId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, stamps: { select: { stampId: true } } },
  });

  // One gap query per checklist: an issue carries a handful of them, and the alternative — one
  // query over the union, split afterwards — is the same rows read once and attributed twice.
  return Promise.all(
    checklists.map(async (c) => {
      const gap = await wantGapForStamps(collectionId, c.stamps.map((s) => s.stampId), terms);
      return {
        checklistId: c.id,
        name: c.name,
        missingStampIds: gap.missing,
        toCreateStampIds: gap.toCreate,
      };
    })
  );
}

/**
 * The bulk add itself (#548): wants for what the named checklists of one issue are missing.
 *
 * The gap is recomputed here rather than taken from the preview the collector confirmed — a copy
 * that arrived while the dialog was open is a copy held — against the same `acceptance` the preview
 * stated its count for, since on these terms both halves of the gap are different questions than on
 * any other.
 *
 * Taken **per checklist and unioned**, the preview's own shape, rather than over the merged
 * membership. Which stamp a variant copy answers for is a question about one checklist's membership
 * (#661): asked of the union, a `226yw` copy would answer for the specialized list that names it
 * and leave the basic list's `226` looking missing, wanting a stamp two screens report as held.
 * Unioning the *gaps* keeps the old property that a stamp on two of them is wanted once — a shared
 * stamp is one id in either set.
 */
export async function createWantsForIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  checklistIds: string[],
  acceptance: WantAcceptanceInput = ANY_ACCEPTANCE
): Promise<{ created: number; missing: number }> {
  await assertCollectionOwner(ownerId, collectionId);
  const terms = await validateAcceptance(collectionId, acceptance);
  const checklists = await prisma.checklist.findMany({
    // Scoped by issue as well as collection: a checklist id that belongs to another issue is not a
    // goal of the issue this was raised from, whoever sent it.
    where: { collectionId, issueId, id: { in: checklistIds } },
    select: { id: true, stamps: { select: { stampId: true } } },
  });
  if (checklists.length === 0) throw new Error("No checklist of this issue was selected.");

  const gaps = await Promise.all(
    checklists.map((c) => wantGapForStamps(collectionId, c.stamps.map((s) => s.stampId), terms))
  );
  const gap = {
    missing: [...new Set(gaps.flatMap((g) => g.missing))],
    toCreate: [...new Set(gaps.flatMap((g) => g.toCreate))],
  };
  return writeGeneratedWants(collectionId, gap, terms);
}
