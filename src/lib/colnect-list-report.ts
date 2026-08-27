import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { COLNECT_CONDITIONS, isColnectConditionValue } from "./colnect-conditions";
import { AREA_PATH_SEPARATOR } from "./area-path";
import { sortPhotos, type PhotoSummary } from "./photos";
import {
  colnectListSourceShape,
  isColnectListDifferenceKind,
  type ColnectListBucket,
  type ColnectListDifferenceKind,
  type ColnectListSource,
  type ColnectListSourceOfTruth,
} from "./colnect-list-sync-rules";

// **The discrepancy report** (#686) — what this collection holds, what the Colnect list holds, and
// every place the two disagree.
//
// **The difference is computed on read.** Nothing about it is stored: the snapshot is one side, the
// live predicate is the other, and the report is the subtraction, done fresh each time it is asked
// for. Freezing both sides would produce a report ageing in two directions at once — clearing a
// `forTrade` flag has to drop the row immediately, and only a change on *Colnect's* side should
// need a fresh export.
//
// **It is one SQL query, not a diff in memory, because of the numbers.** The account read on
// 2026-08-22 held Wish 25,145 against a few thousand local rows. Loading both sides per scroll page
// would be megabytes a page for a screen the collector pages through; instead one query full-outer-
// joins the two aggregates, buckets each row, applies the filters and returns the page — and two
// more group the same shape for the bucket counts and the country facets. Only the page's local
// stamps are then hydrated through Prisma, the same way every other list on this app builds a row.
//
// **The buckets are exclusive, quantity before grade.** A stamp really can differ in both, and the
// row prints both sides' quantity *and* grade so neither is hidden — but a row has to be filed
// under exactly one, because `kind` is what an *ignore* and a *done* are keyed by (#684), and a row
// filed under two would let one acceptance silently swallow the other. Correcting the quantity and
// re-importing brings the row back under **Grade**, which is right: it still disagrees.
//
// **Grade is compared only where the local side agrees on one.** Colnect holds one grade per list
// entry; this side holds N copies. Three copies — two MNH, one used — have no honest single answer,
// and inventing a precedence rule would quietly under- or over-state what is on offer. The same
// rule reads a want: a want naming three acceptable conditions states no grade, and a stamp whose
// open wants disagree states none either. Where the local condition has no Colnect grade mapped
// (#404) nothing is compared, since there is nothing to compare *with*.
//
// **`not-comparable` is a bucket and not a difference.** A local stamp with no `colnectId` was never
// checked against anything. It carries no decision and no done mark either, and cannot: both are
// keyed by the Colnect id it does not have.
//
// **The local side's country is the area's whole path**, not the leaf's name. A collection files
// Poland's stamps under `Poland › People's Republic`, and a report saying only *People's Republic*
// leaves the collector reading a row about a country the row never names. The path is built in the
// query rather than on the client because this one string is the row's label, the country facet and
// the filter's value all at once — deriving it in the UI would leave the chips saying one thing and
// the rows another. The Colnect side still states the export's own `Country` verbatim: no mapping
// is invented between the two.
//
// **A row also carries its *candidate*, which is a different question from its local side** (#687).
// The local side is narrowed by the predicate, so an `only-colnect` row has none by construction —
// and that says nothing about whether the collection holds the stamp. It very often does, untagged,
// which is exactly the row a local fix acts on. `candidateStampId` answers "which stamp is this
// Colnect item here", predicate or no predicate, and `candidateCopies` how many copies such a fix
// would flag.

/** Colnect's stored grade values against the abbreviations the export prints, as a relation the
 *  query can join. Built from the same constant the rest of the app maps conditions with, so the
 *  comparison cannot drift from what Settings offers (#404). */
const GRADE_VALUES = Prisma.join(
  COLNECT_CONDITIONS.map((grade) => Prisma.sql`(${grade.value}::text, ${grade.abbrev}::text)`)
);

/** One `(grade, count)` row of a Colnect list entry, in Colnect's own condition ids (#704). */
export interface ColnectCondQtyRow {
  cond: number;
  qty: number;
}

/** What this collection holds for one Colnect item, as a run needs to state it (#704). */
export interface ColnectLocalCondQty {
  /** A row per grade this side can state. Summed where two of its conditions mean one Colnect grade. */
  rows: ColnectCondQtyRow[];
  /** Copies (or wants) whose condition this collection has never mapped (#404). Never written, and
   *  reported instead — the collector's rule. */
  unmapped: number;
  /** Wants that name no single grade between them. The count is written against whatever grade
   *  Colnect's entry already carries; the grade itself is left alone. */
  ungraded: number;
}

/** One grouped row out of the two queries above, before it is folded into a {@link ColnectLocalCondQty}. */
interface CondQtyRow {
  cid: string | null;
  colnect_value: string | null;
  /** False only on a want-backed list, where the stamp's open wants name no single condition. */
  agreed: boolean;
  qty: number;
}

/** How many rows one page of the report holds. */
export const COLNECT_REPORT_PAGE_SIZE = 50;

/** One configured list, as the screen's selector and header need it. */
export interface ColnectReportList {
  lt: number;
  label: string;
  source: ColnectListSource;
  sourceOfTruth: ColnectListSourceOfTruth;
  /** The export the Colnect side comes from, or null where none has been loaded yet — in which case
   *  there is no report to draw, only an import to offer. A report read against an empty snapshot
   *  would say the whole collection is missing from Colnect. */
  snapshot: {
    fileName: string;
    /** Colnect's own stamp of when the export was taken, ISO-8601, or null. */
    exportedAt: string | null;
    importedAt: string;
    declaredCount: number | null;
    rowCount: number;
  } | null;
}

/** What the report is narrowed by. */
export interface ColnectReportFilters {
  buckets?: ColnectListBucket[];
  /** Country as the row states it — the stamp's whole area path where the row has a local side,
   *  the export's own `Country` where it does not. */
  countries?: string[];
  /** Show rows the collector has put away: marked done on Colnect, or accepted as a standing
   *  divergence. Off by default, since the point of putting one away is not seeing it again. */
  includeHidden?: boolean;
}

/** One row of the report. */
export interface ColnectReportRow {
  /** Stable per row: the Colnect id, or the stamp id for a row that has none. */
  key: string;
  bucket: ColnectListBucket;
  colnectId: string | null;
  /** What the filter and the header group this row under. */
  country: string | null;

  /** The local side, null throughout for a row only Colnect has. */
  stampId: string | null;
  stampName: string | null;
  issuedYear: number | null;
  /** The issue the stamp is filed under, and the year that issue states. What identifies a stamp
   *  with no name of its own — which on a Colnect list is most of them. */
  issueName: string | null;
  issueYear: number | null;
  /** The stamp's primary area, for resolving catalog-vendor display on the client. */
  areaId: string | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  photos: PhotoSummary[];
  /** How many local rows qualify — copies in hand, or open wants. */
  localQuantity: number | null;
  /** The one condition the local side agrees on, or null where it states none. */
  localConditionId: string | null;

  /**
   * The stamp this collection holds under the row's Colnect id, **predicate or no predicate**
   * (#687). The same as `stampId` wherever the row has a local side; the point of it is the rows
   * where it is not — an `only-colnect` row carries no `stampId` by construction, since the local
   * side of the comparison holds only stamps the predicate holds *for*, and yet the collection may
   * well hold the stamp untagged. That is precisely the row a local fix can act on.
   */
  candidateStampId: string | null;
  /**
   * How many copies the *set the predicate here* fix would flag: copies of {@link candidateStampId}
   * in hand that do **not** carry the list's flag. Null for a want-backed list, where there is no
   * flag to set on anything and the answer is a want to create (#688) rather than a fix.
   */
  candidateCopies: number | null;

  /** The Colnect side, null throughout for a row only this collection has. */
  colnectName: string | null;
  colnectCatalogCodes: string | null;
  colnectQuantity: number | null;
  /** Colnect's own abbreviation, untranslated (`MNH`). */
  colnectGrade: string | null;

  /** Claimed already fixed on Colnect — hidden until the next import. */
  done: boolean;
  /** Accepted as a standing divergence — hidden across imports. */
  ignored: boolean;
  ignoredNote: string | null;
}

/** One page of the report. */
export interface ColnectReportPage {
  rows: ColnectReportRow[];
  /** The offset to ask for next, or null at the end. */
  nextCursor: string | null;
}

/** How many rows each bucket holds under the *other* filters — a facet, so ticking one bucket does
 *  not change what the others say they hold. */
export type ColnectReportCounts = Record<ColnectListBucket, number>;

/** One country and how many rows carry it, under the filters other than country itself. */
export interface ColnectReportCountry {
  country: string;
  rows: number;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The mapping and its snapshot, or null when the list is not configured or holds no export. Every
 *  read below starts here, so a stale list id in the URL is a "nothing to show" rather than a
 *  report about the wrong list. */
async function readMapping(collectionId: string, lt: number) {
  return prisma.colnectListMapping.findFirst({
    where: { collectionId, lt, enabled: true },
    select: {
      id: true,
      label: true,
      source: true,
      sourceOfTruth: true,
      snapshot: { select: { id: true } },
    },
  });
}

/**
 * Every list this collection syncs, with the export its Colnect side currently comes from.
 * Owner-authorized.
 *
 * The header needs both halves of "how stale is this": Colnect's `exportedAt` answers it, and
 * `importedAt` does not — a file exported in March and loaded this morning is three months old.
 */
export async function getColnectReportLists(
  ownerId: string,
  collectionId: string
): Promise<ColnectReportList[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.colnectListMapping.findMany({
    where: { collectionId, enabled: true },
    orderBy: { lt: "asc" },
    select: {
      lt: true,
      label: true,
      source: true,
      sourceOfTruth: true,
      snapshot: {
        select: {
          fileName: true,
          exportedAt: true,
          importedAt: true,
          declaredCount: true,
          _count: { select: { rows: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    lt: row.lt,
    label: row.label,
    source: row.source as ColnectListSource,
    sourceOfTruth: row.sourceOfTruth as ColnectListSourceOfTruth,
    snapshot: row.snapshot
      ? {
          fileName: row.snapshot.fileName,
          exportedAt: row.snapshot.exportedAt?.toISOString() ?? null,
          importedAt: row.snapshot.importedAt.toISOString(),
          declaredCount: row.snapshot.declaredCount,
          rowCount: row.snapshot._count.rows,
        }
      : null,
  }));
}

/**
 * What this collection holds for each of a set of Colnect items, **broken down by grade** (#704).
 *
 * The report's own local side (below) reduces a stamp to one count and, where the copies agree, one
 * condition — which is all a *comparison* needs. A **write** needs more: Colnect holds a row per
 * grade on a list entry, up to one for each, so two mint copies and one used are two rows over there
 * and not an unanswerable question. This is that breakdown, for the items a run is about to add.
 *
 * The predicate is the same one, spelled in the same place, for the reason the whole module is one
 * query: a second idea of *which copies count* would be a run acting on rows the screen never showed.
 *
 * A condition with **no `ColnectConditionMapping`** (#404) is counted apart and never guessed at —
 * the collector's own rule for it is *do not send it, say so*. Two of this collection's conditions
 * mapping to one Colnect grade is not a problem here, only in the reverse direction the report reads
 * (#687): both are that grade, so their copies are summed into its row.
 */
export async function readColnectLocalCondQty(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectIds: readonly string[]
): Promise<Map<string, ColnectLocalCondQty>> {
  await assertCollectionOwner(ownerId, collectionId);
  const answer = new Map<string, ColnectLocalCondQty>();
  if (colnectIds.length === 0) return answer;

  const mapping = await readMapping(collectionId, lt);
  if (!mapping) return answer;
  const shape = colnectListSourceShape(mapping.source as ColnectListSource);
  const ids = [...new Set(colnectIds)];

  const rows =
    shape.kind === "copies"
      ? await prisma.$queryRaw<CondQtyRow[]>`
          SELECT NULLIF(TRIM(s."colnectId"), '') AS cid,
                 m."colnectValue" AS colnect_value,
                 TRUE AS agreed,
                 COUNT(*)::int AS qty
          FROM "item" i
          JOIN "stamp" s ON s."id" = i."stampId"
          LEFT JOIN "colnect_condition_mapping" m
                 ON m."collectionId" = ${collectionId}
                AND m."stampConditionId" = i."conditionId"
          WHERE i."collectionId" = ${collectionId}
            AND i.${Prisma.raw(`"${shape.flag}"`)} = TRUE
            AND i."deliveryState" = 'delivered'
            AND i."disposedAt" IS NULL
            AND NULLIF(TRIM(s."colnectId"), '') = ANY(${ids})
          GROUP BY 1, 2`
      : // A want states a grade only where it names exactly one acceptable condition, and a stamp's
        // open wants only where they all do and all agree — `local_side`'s sentence, kept identical.
        // `agreed` false is *this side names no single grade*, which is a different answer from an
        // unmapped one and is acted on differently.
        await prisma.$queryRaw<CondQtyRow[]>`
          WITH per_stamp AS (
            SELECT w."stampId" AS stamp_id,
                   COUNT(DISTINCT w."id")::int AS qty,
                   CASE
                     WHEN COUNT(DISTINCT wc."conditionId") = 1
                      AND COUNT(wc."conditionId") = COUNT(DISTINCT w."id")
                     THEN MIN(wc."conditionId")
                   END AS condition_id
            FROM "want" w
            LEFT JOIN "want_condition" wc ON wc."wantId" = w."id"
            WHERE w."collectionId" = ${collectionId}
              AND w."closedAt" IS NULL
            GROUP BY w."stampId"
          )
          SELECT NULLIF(TRIM(s."colnectId"), '') AS cid,
                 m."colnectValue" AS colnect_value,
                 (p.condition_id IS NOT NULL) AS agreed,
                 p.qty AS qty
          FROM per_stamp p
          JOIN "stamp" s ON s."id" = p.stamp_id
          LEFT JOIN "colnect_condition_mapping" m
                 ON m."collectionId" = ${collectionId}
                AND m."stampConditionId" = p.condition_id
          WHERE NULLIF(TRIM(s."colnectId"), '') = ANY(${ids})`;

  for (const row of rows) {
    if (!row.cid || row.qty <= 0) continue;
    const held = answer.get(row.cid) ?? { rows: [], unmapped: 0, ungraded: 0 };
    const cond = row.colnect_value === null ? null : Number(row.colnect_value);
    if (row.agreed === false) {
      // The wants disagree. The count is still a fact and the grade is not, so the run states the
      // one and leaves the other to whatever Colnect's entry already says.
      held.ungraded += row.qty;
    } else if (cond === null || !Number.isInteger(cond) || !isColnectConditionValue(String(cond))) {
      held.unmapped += row.qty;
    } else {
      const existing = held.rows.find((r) => r.cond === cond);
      if (existing) existing.qty += row.qty;
      else held.rows.push({ cond, qty: row.qty });
    }
    answer.set(row.cid, held);
  }
  for (const held of answer.values()) held.rows.sort((a, b) => a.cond - b.cond);
  return answer;
}

/**
 * The local side of the comparison: one row per stamp the list's predicate holds for, with how many
 * qualify and the one condition they agree on.
 *
 * Two shapes, because three of the four predicates count **copies** and the fourth counts **wants**
 * — a different table with a different idea of a grade. The copy predicates all mean *in hand*:
 * delivered and not disposed of, since a copy already sold is not on offer and a list still naming
 * it is the discrepancy rather than an input to it.
 */
function localSide(collectionId: string, source: ColnectListSource): Prisma.Sql {
  const shape = colnectListSourceShape(source);
  if (shape.kind === "copies") {
    // The flag comes from a closed vocabulary resolved above, never from a request.
    const flag = Prisma.raw(`"${shape.flag}"`);
    return Prisma.sql`
      SELECT i."stampId" AS stamp_id,
             COUNT(*)::int AS qty,
             CASE WHEN COUNT(DISTINCT i."conditionId") = 1 THEN MIN(i."conditionId") END AS condition_id
      FROM "item" i
      WHERE i."collectionId" = ${collectionId}
        AND i.${flag} = TRUE
        AND i."deliveryState" = 'delivered'
        AND i."disposedAt" IS NULL
      GROUP BY i."stampId"`;
  }
  // A want states a grade only when it names exactly one acceptable condition, and a stamp's open
  // wants state one only when they all do and all agree. `COUNT(wc.…) = COUNT(DISTINCT w."id")`
  // is that sentence: one condition row per want, no more and none missing.
  return Prisma.sql`
    SELECT w."stampId" AS stamp_id,
           COUNT(DISTINCT w."id")::int AS qty,
           CASE
             WHEN COUNT(DISTINCT wc."conditionId") = 1
              AND COUNT(wc."conditionId") = COUNT(DISTINCT w."id")
             THEN MIN(wc."conditionId")
           END AS condition_id
    FROM "want" w
    LEFT JOIN "want_condition" wc ON wc."wantId" = w."id"
    WHERE w."collectionId" = ${collectionId}
      AND w."closedAt" IS NULL
    GROUP BY w."stampId"`;
}

/**
 * The whole comparison as one relation, before any filter: every row of either side, bucketed.
 *
 * `in-sync` rows come out of it too and are dropped by the callers' `WHERE` — keeping them here is
 * what lets one relation serve the page, the counts and the country facets without three spellings
 * of what a difference is.
 */
function differences(input: {
  collectionId: string;
  mappingId: string;
  snapshotId: string;
  source: ColnectListSource;
}): Prisma.Sql {
  const shape = colnectListSourceShape(input.source);
  // What a *set the predicate here* fix (#687) would have to flag, per stamp: copies in hand that do
  // not carry the list's flag. A want-backed list has no such thing — nothing carries a flag — so it
  // contributes no rows and the column comes back null everywhere, which is the honest answer.
  const candidateCopies =
    shape.kind === "copies"
      ? Prisma.sql`
          SELECT i."stampId" AS stamp_id, COUNT(*)::int AS spare
          FROM "item" i
          WHERE i."collectionId" = ${input.collectionId}
            AND i.${Prisma.raw(`"${shape.flag}"`)} = FALSE
            AND i."deliveryState" = 'delivered'
            AND i."disposedAt" IS NULL
          GROUP BY i."stampId"`
      : Prisma.sql`SELECT NULL::text AS stamp_id, NULL::int AS spare WHERE FALSE`;

  return Prisma.sql`
    WITH RECURSIVE
    -- Every area's whole breadcrumb, the same string buildAreaPath prints on every other screen.
    -- Recursive because an area knows only its parent, while the collector reads the path.
    area_path AS (
      SELECT a."id" AS id, a."name"::text AS path
      FROM "collection_area" a
      WHERE a."collectionId" = ${input.collectionId} AND a."parentId" IS NULL
      UNION ALL
      SELECT c."id", (p.path || ${AREA_PATH_SEPARATOR} || c."name")::text
      FROM "collection_area" c
      JOIN area_path p ON p.id = c."parentId"
      WHERE c."collectionId" = ${input.collectionId}
    ),
    local_rows AS (${localSide(input.collectionId, input.source)}),
    -- Every Colnect id this collection holds, whatever the predicate says about it. The report's
    -- local side is narrowed by the predicate and therefore cannot answer "is this item a stamp we
    -- hold?" for a row only Colnect has — which is the one question a fix on such a row needs.
    stamp_by_cid AS (
      SELECT NULLIF(TRIM(s."colnectId"), '') AS cid, MIN(s."id") AS stamp_id
      FROM "stamp" s
      WHERE s."collectionId" = ${input.collectionId}
        AND NULLIF(TRIM(s."colnectId"), '') IS NOT NULL
      GROUP BY NULLIF(TRIM(s."colnectId"), '')
    ),
    candidate_copies AS (${candidateCopies}),
    grade_map AS (
      SELECT m."stampConditionId" AS condition_id, g.abbrev AS abbrev
      FROM "colnect_condition_mapping" m
      JOIN (VALUES ${GRADE_VALUES}) AS g(value, abbrev) ON g.value = m."colnectValue"
      WHERE m."collectionId" = ${input.collectionId}
    ),
    local_side AS (
      SELECT l.stamp_id,
             NULLIF(TRIM(s."colnectId"), '') AS cid,
             l.qty,
             l.condition_id,
             gm.abbrev AS local_grade,
             s."name" AS stamp_name,
             s."primaryCatalogSortKey" AS sort_key,
             area.name AS area_name
      FROM local_rows l
      JOIN "stamp" s ON s."id" = l.stamp_id
      LEFT JOIN grade_map gm ON gm.condition_id = l.condition_id
      LEFT JOIN LATERAL (
        -- The path where the tree resolved one, the bare name where it did not: an area whose
        -- parent chain is broken still names itself, and a null here would drop the row out of
        -- every country facet.
        SELECT COALESCE(ap.path, a."name") AS name
        FROM "stamp_collection_area" sca
        JOIN "collection_area" a ON a."id" = sca."collectionAreaId"
        LEFT JOIN area_path ap ON ap.id = a."id"
        WHERE sca."stampId" = s."id"
        ORDER BY sca."isPrimary" DESC, a."name" ASC
        LIMIT 1
      ) area ON TRUE
    ),
    colnect_side AS (
      SELECT r."colnectId" AS cid,
             -- A blank Quantity cell is one, which is how the export writes "just the one".
             SUM(COALESCE(r."quantity", 1))::int AS qty,
             CASE WHEN COUNT(DISTINCT r."conditionAbbrev") = 1 THEN MIN(r."conditionAbbrev") END AS grade,
             MIN(r."name") AS name,
             MIN(r."country") AS country,
             MIN(r."catalogCodes") AS catalog_codes
      FROM "colnect_list_snapshot_row" r
      WHERE r."snapshotId" = ${input.snapshotId}
      GROUP BY r."colnectId"
    ),
    joined AS (
      SELECT
        COALESCE(l.cid, c.cid) AS cid,
        l.stamp_id,
        l.qty AS local_qty,
        l.condition_id,
        l.local_grade,
        l.stamp_name,
        l.sort_key,
        c.qty AS colnect_qty,
        c.grade AS colnect_grade,
        c.name AS colnect_name,
        c.catalog_codes,
        COALESCE(l.stamp_id, sc.stamp_id) AS candidate_stamp_id,
        cc.spare AS candidate_copies,
        COALESCE(NULLIF(l.area_name, ''), NULLIF(c.country, '')) AS country,
        COALESCE(NULLIF(l.stamp_name, ''), NULLIF(c.name, ''), '') AS sort_name,
        CASE
          -- Local, but never checked: no Colnect id to check it by.
          WHEN l.stamp_id IS NOT NULL AND l.cid IS NULL THEN 'not-comparable'
          WHEN l.stamp_id IS NULL THEN 'only-colnect'
          WHEN c.cid IS NULL THEN 'only-local'
          WHEN l.qty <> c.qty THEN 'quantity'
          WHEN l.local_grade IS NOT NULL
           AND NULLIF(c.grade, '') IS NOT NULL
           AND UPPER(l.local_grade) <> UPPER(c.grade) THEN 'grade'
          ELSE 'in-sync'
        END AS bucket
      FROM local_side l
      FULL OUTER JOIN colnect_side c ON c.cid = l.cid
      LEFT JOIN stamp_by_cid sc ON sc.cid = COALESCE(l.cid, c.cid)
      LEFT JOIN candidate_copies cc ON cc.stamp_id = COALESCE(l.stamp_id, sc.stamp_id)
    )
    SELECT j.*,
           COALESCE(j.cid, j.stamp_id) AS "key",
           (dm."id" IS NOT NULL) AS done,
           (acc."id" IS NOT NULL) AS ignored,
           acc."note" AS ignored_note
    FROM joined j
    LEFT JOIN "colnect_list_done_mark" dm
      ON dm."snapshotId" = ${input.snapshotId} AND dm."colnectId" = j.cid AND dm."kind" = j.bucket
    LEFT JOIN "colnect_list_decision" acc
      ON acc."mappingId" = ${input.mappingId} AND acc."colnectId" = j.cid AND acc."kind" = j.bucket
    WHERE j.bucket <> 'in-sync'`;
}

/** The filters, as a `WHERE` fragment over the relation above. `buckets` is left out where the
 *  caller is counting buckets: a facet counts under every filter except its own. */
function whereFrom(filters: ColnectReportFilters, withBuckets: boolean, withCountries: boolean) {
  const parts: Prisma.Sql[] = [];
  if (withBuckets && filters.buckets?.length) {
    parts.push(Prisma.sql`d.bucket IN (${Prisma.join(filters.buckets)})`);
  }
  if (withCountries && filters.countries?.length) {
    parts.push(Prisma.sql`d.country IN (${Prisma.join(filters.countries)})`);
  }
  if (!filters.includeHidden) {
    parts.push(Prisma.sql`d.done = FALSE AND d.ignored = FALSE`);
  }
  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

/** The raw shape one page comes back in, before the local stamps are hydrated. */
interface ReportKeyRow {
  key: string;
  bucket: string;
  cid: string | null;
  stamp_id: string | null;
  country: string | null;
  local_qty: number | null;
  condition_id: string | null;
  candidate_stamp_id: string | null;
  candidate_copies: number | null;
  colnect_qty: number | null;
  colnect_grade: string | null;
  colnect_name: string | null;
  catalog_codes: string | null;
  done: boolean;
  ignored: boolean;
  ignored_note: string | null;
}

/**
 * One page of the report, in the order the collector reads it: by country, then by catalog number
 * where the row has one, then by name. Owner-authorized.
 *
 * The order has to be total or paging repeats and skips rows, hence the key at the end of it. A row
 * only Colnect has carries no catalog sort key, so within a country those sort together after the
 * local ones and then by name — which is the only order the export gives.
 */
export async function listColnectReportRows(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {},
  offset = 0,
  limit = COLNECT_REPORT_PAGE_SIZE
): Promise<ColnectReportPage> {
  await assertCollectionOwner(ownerId, collectionId);
  const mapping = await readMapping(collectionId, lt);
  if (!mapping?.snapshot) return { rows: [], nextCursor: null };

  const keys = await prisma.$queryRaw<ReportKeyRow[]>`
    WITH differences AS (${differences({
      collectionId,
      mappingId: mapping.id,
      snapshotId: mapping.snapshot.id,
      source: mapping.source as ColnectListSource,
    })})
    SELECT d.key, d.bucket, d.cid, d.stamp_id, d.country, d.local_qty, d.condition_id,
           d.candidate_stamp_id, d.candidate_copies,
           d.colnect_qty, d.colnect_grade, d.colnect_name, d.catalog_codes,
           d.done, d.ignored, d.ignored_note
    FROM differences d
    ${whereFrom(filters, true, true)}
    ORDER BY d.country ASC NULLS LAST, d.sort_key ASC NULLS LAST, d.sort_name ASC, d.key ASC
    OFFSET ${offset}
    LIMIT ${limit + 1}`;

  const hasMore = keys.length > limit;
  const page = hasMore ? keys.slice(0, limit) : keys;

  const stampIds = page.flatMap((row) => (row.stamp_id ? [row.stamp_id] : []));
  const stamps = stampIds.length
    ? await prisma.stamp.findMany({
        where: { id: { in: stampIds } },
        select: {
          id: true,
          name: true,
          issuedYear: true,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          photos: { select: { id: true, role: true, title: true, sortOrder: true } },
          // The issue is what names a stamp that has no name of its own, which on a Colnect list
          // is most of them. One membership: a stamp is filed under one issue in practice, and the
          // row has space for one label.
          issueMemberships: {
            select: { issue: { select: { name: true, year: true } } },
            orderBy: { sortOrder: "asc" },
            take: 1,
          },
        },
      })
    : [];
  const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));

  return {
    rows: page.map((row) => {
      const stamp = row.stamp_id ? stampById.get(row.stamp_id) : undefined;
      const primary = stamp?.stampAreaLinks.find((link) => link.isPrimary);
      return {
        key: row.key,
        bucket: row.bucket as ColnectListBucket,
        colnectId: row.cid,
        country: row.country,
        stampId: row.stamp_id,
        stampName: stamp?.name ?? null,
        issuedYear: stamp?.issuedYear ?? null,
        issueName: stamp?.issueMemberships[0]?.issue.name ?? null,
        issueYear: stamp?.issueMemberships[0]?.issue.year ?? null,
        areaId:
          primary?.collectionAreaId ?? stamp?.stampAreaLinks[0]?.collectionAreaId ?? null,
        catalogNumbers: stamp?.catalogNumbers ?? [],
        photos: (stamp?.photos ?? [])
          .map((photo) => ({
            id: photo.id,
            // Stamps use the single `main` slot (#137); anything else is an extra.
            role: (photo.role === "main" || photo.role === "front" || photo.role === "back"
              ? photo.role
              : null) as "front" | "back" | "main" | null,
            title: photo.title,
            sortOrder: photo.sortOrder,
          }))
          .sort(sortPhotos),
        localQuantity: row.local_qty,
        localConditionId: row.condition_id,
        candidateStampId: row.candidate_stamp_id,
        candidateCopies: row.candidate_copies,
        colnectName: row.colnect_name,
        colnectCatalogCodes: row.catalog_codes,
        colnectQuantity: row.colnect_qty,
        colnectGrade: row.colnect_grade,
        done: row.done,
        ignored: row.ignored,
        ignoredNote: row.ignored_note,
      };
    }),
    nextCursor: hasMore ? String(offset + limit) : null,
  };
}

/**
 * Every differing row's Colnect id and bucket, under the filters, and nothing else.
 * Owner-authorized.
 *
 * The report's page hydrates stamps — photos, catalog numbers, areas — because it is drawing rows.
 * This is for the caller that needs the *set* rather than the rows: the worklist the extension
 * applies on Colnect (#689) is tens of thousands of ids and no pictures. Same relation, same
 * filters, same idea of what a difference is; only the projection differs.
 *
 * `not-comparable` rows carry no Colnect id and are dropped, which is the same thing they are
 * everywhere else: nothing was checked, so there is nothing to act on.
 */
export async function listColnectReportKeys(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {}
): Promise<{ colnectId: string; bucket: ColnectListBucket }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const mapping = await readMapping(collectionId, lt);
  if (!mapping?.snapshot) return [];

  const rows = await prisma.$queryRaw<{ cid: string | null; bucket: string }[]>`
    WITH differences AS (${differences({
      collectionId,
      mappingId: mapping.id,
      snapshotId: mapping.snapshot.id,
      source: mapping.source as ColnectListSource,
    })})
    SELECT d.cid, d.bucket
    FROM differences d
    ${whereFrom(filters, true, true)}
    ORDER BY d.country ASC NULLS LAST, d.sort_key ASC NULLS LAST, d.sort_name ASC, d.key ASC`;

  return rows.flatMap((row) =>
    row.cid ? [{ colnectId: row.cid, bucket: row.bucket as ColnectListBucket }] : []
  );
}

/** Every bucket with what it holds under the other filters, so the chips can carry counts.
 *  Owner-authorized. */
export async function getColnectReportCounts(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {}
): Promise<ColnectReportCounts> {
  await assertCollectionOwner(ownerId, collectionId);
  const empty: ColnectReportCounts = {
    "only-local": 0,
    "only-colnect": 0,
    quantity: 0,
    grade: 0,
    "not-comparable": 0,
  };
  const mapping = await readMapping(collectionId, lt);
  if (!mapping?.snapshot) return empty;

  const rows = await prisma.$queryRaw<{ bucket: string; rows: number }[]>`
    WITH differences AS (${differences({
      collectionId,
      mappingId: mapping.id,
      snapshotId: mapping.snapshot.id,
      source: mapping.source as ColnectListSource,
    })})
    SELECT d.bucket, COUNT(*)::int AS "rows"
    FROM differences d
    ${whereFrom(filters, false, true)}
    GROUP BY d.bucket`;

  const counts = { ...empty };
  for (const row of rows) {
    if (row.bucket in counts) counts[row.bucket as ColnectListBucket] = row.rows;
  }
  return counts;
}

/** Every country the report's rows carry, with how many, under the filters other than country.
 *  Owner-authorized. */
export async function getColnectReportCountries(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {}
): Promise<ColnectReportCountry[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const mapping = await readMapping(collectionId, lt);
  if (!mapping?.snapshot) return [];

  const rows = await prisma.$queryRaw<{ country: string | null; rows: number }[]>`
    WITH differences AS (${differences({
      collectionId,
      mappingId: mapping.id,
      snapshotId: mapping.snapshot.id,
      source: mapping.source as ColnectListSource,
    })})
    SELECT d.country, COUNT(*)::int AS "rows"
    FROM differences d
    ${whereFrom(filters, true, false)}
    GROUP BY d.country
    ORDER BY d.country ASC NULLS LAST`;

  return rows.flatMap((row) => (row.country ? [{ country: row.country, rows: row.rows }] : []));
}

/** Raised when a row is put away under a kind that is not one, or against a list that is not
 *  configured. A stale tab rather than anything the collector can type. */
export class ColnectReportValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectReportValueError";
  }
}

function assertKind(kind: string): asserts kind is ColnectListDifferenceKind {
  if (!isColnectListDifferenceKind(kind)) {
    throw new ColnectReportValueError(`"${kind}" is not a difference that can be put away.`);
  }
}

/**
 * Claim a difference already fixed on Colnect, or take the claim back. Owner-authorized.
 *
 * It hangs off the **snapshot**, so the next import clears it: the claim is about the state of
 * Colnect and the next export is what checks it. A row that comes back was not actually done.
 */
export async function setColnectReportDone(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectId: string,
  kind: string,
  done: boolean
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  assertKind(kind);
  const mapping = await readMapping(collectionId, lt);
  if (!mapping?.snapshot) {
    throw new ColnectReportValueError("That Colnect list holds no import to mark against.");
  }
  const snapshotId = mapping.snapshot.id;
  if (done) {
    await prisma.colnectListDoneMark.upsert({
      where: { snapshotId_colnectId_kind: { snapshotId, colnectId, kind } },
      create: { snapshotId, colnectId, kind },
      update: {},
    });
  } else {
    await prisma.colnectListDoneMark.deleteMany({ where: { snapshotId, colnectId, kind } });
  }
}

/**
 * Accept a difference as a standing divergence, or withdraw the acceptance. Owner-authorized.
 *
 * It hangs off the **mapping**, so it survives every import: it is a judgement about this
 * collection, and a judgement does not expire because a file was read again.
 */
export async function setColnectReportIgnored(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectId: string,
  kind: string,
  ignored: boolean,
  note?: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  assertKind(kind);
  const mapping = await readMapping(collectionId, lt);
  if (!mapping) throw new ColnectReportValueError("That Colnect list is not set up for sync.");
  const mappingId = mapping.id;
  if (ignored) {
    const trimmed = note?.trim() || null;
    await prisma.colnectListDecision.upsert({
      where: { mappingId_colnectId_kind: { mappingId, colnectId, kind } },
      create: { mappingId, colnectId, kind, note: trimmed },
      update: { note: trimmed },
    });
  } else {
    await prisma.colnectListDecision.deleteMany({ where: { mappingId, colnectId, kind } });
  }
}
