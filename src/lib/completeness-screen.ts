import "server-only";
import { prisma } from "./db";
import { COUNTED_COPY_WHERE } from "./checklist-completeness";
import { loadChecklistVariantRollup, rollUpCounts } from "./checklist-variant-rollup";
import { asChecklistKind, shownChecklistWhere, type ChecklistKind } from "./checklist-kind";
import { CHECKLIST_STAMP_ORDER } from "./checklists";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, catalogLabel } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import {
  dispositionChipsWhere,
  incompleteClosestFirst,
  summarizeCompleteness,
  type CompletenessDispositionChip,
  type CompletenessSummary,
} from "./completeness-screen-rules";

// The Completeness screen (#2266) — the I/O half. How complete a chosen part of the catalogue is,
// counting only the copies of the chosen conditions and dispositions.
//
// The figures are the Issues list's, by construction: the same counted copies (`COUNTED_COPY_WHERE`,
// the issue page's grid's own), the same variant rollup (#661, `checklist-variant-rollup.ts`),
// attributed per checklist, and the same specialised switch (#1617). What this adds is a narrowing
// of the copies by condition and disposition, and a sum over every checklist under the chosen area
// and years — so with every condition and every chip on, a checklist here reads what its branch
// heading on the Issues list reads.
//
// Only an issue's own checklists are read: the screen is narrowed by area and year, which are the
// issue's, and a checklist spanning issues (#1416) has neither.

/** Which part of the catalogue, and which copies count. */
export interface CompletenessScope {
  /** The areas chosen on the rail, sub-areas already resolved; absent is every area. */
  areaIds?: string[];
  /** The rail's year, read through `readYearFilter` — one year, no year, or a span. */
  year?: number | "none";
  yearFrom?: number;
  yearTo?: number;
  /** The conditions a counted copy must be in; empty is every condition. */
  conditionIds: string[];
  /** The disposition chips switched on; a copy counts when it carries any of them. */
  dispositions: CompletenessDispositionChip[];
  /** Whether specialised checklists are counted too (#1617). */
  includeSpecialised: boolean;
}

/** One incomplete checklist, as the screen lists it. */
export interface IncompleteChecklist {
  checklistId: string;
  name: string;
  kind: ChecklistKind;
  issueId: string;
  issueNo: number;
  issueName: string | null;
  issueYear: number | null;
  owned: number;
  requiredCount: number;
}

export interface CompletenessReport {
  summary: CompletenessSummary;
  /** The checklists still missing something, closest to complete first. */
  incomplete: IncompleteChecklist[];
}

/** The summary and the incomplete checklists for one scope. */
export async function getCompletenessReport(
  ownerId: string,
  collectionId: string,
  scope: CompletenessScope
): Promise<CompletenessReport> {
  await assertCollectionOwner(ownerId, collectionId);

  const checklists = await prisma.checklist.findMany({
    where: {
      collectionId,
      ...shownChecklistWhere(scope.includeSpecialised),
      issueId: { not: null },
      issue: issueWhere(scope),
    },
    select: {
      id: true,
      name: true,
      kind: true,
      issue: { select: { id: true, issueNo: true, name: true, year: true } },
      stamps: { select: { stampId: true } },
    },
  });
  const held = await heldMembers(
    collectionId,
    checklists.map((c) => ({ id: c.id, stampIds: c.stamps.map((s) => s.stampId) })),
    scope
  );

  const rows = checklists.flatMap((c) => {
    if (!c.issue) return [];
    const members = new Set(c.stamps.map((s) => s.stampId));
    return [
      {
        checklistId: c.id,
        name: c.name,
        kind: asChecklistKind(c.kind),
        issueId: c.issue.id,
        issueNo: c.issue.issueNo,
        issueName: c.issue.name,
        issueYear: c.issue.year,
        owned: held.get(c.id)?.size ?? 0,
        requiredCount: members.size,
      },
    ];
  });

  return { summary: summarizeCompleteness(rows), incomplete: incompleteClosestFirst(rows) };
}

/**
 * The stamps one checklist still lacks under the chosen conditions and dispositions, in the
 * checklist's own order (#764), each named by its catalogue number as the issue's chips number it.
 */
export async function getChecklistMissingStamps(
  ownerId: string,
  collectionId: string,
  checklistId: string,
  scope: Pick<CompletenessScope, "conditionIds" | "dispositions">
): Promise<string[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: {
      issueId: true,
      issue: { select: { collectionAreaId: true } },
      stamps: {
        select: {
          stampId: true,
          stamp: {
            select: {
              name: true,
              catalogNumbers: { select: { catalogVendorId: true, number: true } },
            },
          },
        },
        orderBy: [...CHECKLIST_STAMP_ORDER],
      },
    },
  });
  if (!checklist) return [];

  const held =
    (
      await heldMembers(
        collectionId,
        [{ id: checklistId, stampIds: checklist.stamps.map((s) => s.stampId) }],
        scope
      )
    ).get(checklistId) ?? new Set<string>();
  const missing = checklist.stamps.filter((s) => !held.has(s.stampId));
  if (missing.length === 0) return [];

  const [areas, prefixByIssue] = await Promise.all([
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const maps = buildAreaVendorMaps(areas, prefixByIssue);
  const areaId = checklist.issue?.collectionAreaId ?? null;
  return missing.map((s) =>
    catalogLabel(
      {
        areaId,
        issueId: checklist.issueId,
        catalogNumbers: s.stamp.catalogNumbers,
        name: s.stamp.name,
      },
      maps
    )
  );
}

/** The issues under the chosen area and years — the Issues list's own reading of the rail. */
function issueWhere(scope: CompletenessScope) {
  return {
    ...(scope.areaIds && scope.areaIds.length > 0
      ? { collectionAreaId: { in: scope.areaIds } }
      : {}),
    ...(scope.year !== undefined
      ? { year: scope.year === "none" ? null : scope.year }
      : scope.yearFrom !== undefined || scope.yearTo !== undefined
        ? {
            year: {
              ...(scope.yearFrom !== undefined ? { gte: scope.yearFrom } : {}),
              ...(scope.yearTo !== undefined ? { lte: scope.yearTo } : {}),
            },
          }
        : {}),
  };
}

/**
 * For each checklist, the stamps on it with at least one counted copy of a chosen condition and
 * disposition — one `groupBy` for all of them, reaching below the membership to the variants that
 * roll up to a member (#661) and attributed per checklist, nearest member first.
 */
async function heldMembers(
  collectionId: string,
  checklists: { id: string; stampIds: string[] }[],
  scope: Pick<CompletenessScope, "conditionIds" | "dispositions">
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const stampIds = [...new Set(checklists.flatMap((c) => c.stampIds))];
  const rollup = await loadChecklistVariantRollup(collectionId, stampIds);
  if (rollup.countingStampIds.length === 0) return out;

  const dispositions = dispositionChipsWhere(scope.dispositions);
  const rows = await prisma.item.groupBy({
    by: ["stampId"],
    where: {
      collectionId,
      stampId: { in: rollup.countingStampIds },
      ...COUNTED_COPY_WHERE,
      ...(scope.conditionIds.length > 0 ? { conditionId: { in: scope.conditionIds } } : {}),
      ...(dispositions ?? {}),
    },
    _count: { _all: true },
  });
  const counts = rows.map((r) => ({ stampId: r.stampId, count: r._count._all }));

  for (const checklist of checklists) {
    const members = new Set(checklist.stampIds);
    out.set(
      checklist.id,
      new Set(
        rollUpCounts(counts, rollup, members)
          .filter((c) => c.count > 0)
          .map((c) => c.stampId)
      )
    );
  }
  return out;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}
