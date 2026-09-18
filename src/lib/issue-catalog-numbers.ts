import "server-only";
import { prisma } from "./db";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { recomputeIssueSortKeys, recomputeStampSortKeys } from "./catalog-sort-key-recompute";
import { enforceStampCatalogDuplicates } from "./duplicate-catalog";
import { flattenMemberTree } from "./issue-member-order";
import { recomputeDeclaredRange } from "./catalog-number";

// The catalogue-number grid (#1346): every stamp of an issue, variants included, against every
// catalogue the stamp form offers for the issue's area — the variant price grid's shape (#618) over
// numbers instead of prices. Before it, numbers could be generated for a whole issue only while the
// issue was being created (#70, #451); afterwards every correction, and every second catalogue added
// to an existing issue, meant opening each stamp in turn.
//
// It **adds nothing the stamp form could not enter**: the columns are that form's own catalogues
// (the area's effective vendors, resolved through the issue's prefix override, #377), a cell is one
// `StampCatalogNumber` row, and the collection's duplicate policy (#85) is enforced per cell exactly
// as the form enforces it per save. A repeat *inside* the issue is flagged on screen and accepted —
// in the default warn mode; a collection that blocks duplicates blocks them here too.
//
// One write per cell, as the price grid writes (#618/#404), and each write **recomputes the issue's
// declared range** for that catalogue from the checklist stamps (`recomputeDeclaredRange`). #333's
// recompute only ever proposes a widening; here the collector has just edited the numbers the range
// summarises, and chose on 2026-09-18 that it should follow them outright — widening, narrowing,
// appearing and going away.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** One catalogue column: a vendor the stamp form offers for the issue's area. */
export interface CatalogNumberGridColumn {
  catalogVendorId: string;
  vendorName: string;
  vendorAbbreviation: string;
  /** The prefix this issue's numbers carry for the vendor (#66/#377), shown in the header. */
  prefix: string | null;
  /** The vendor that leads numbering in the area (#675) — drawn first. */
  isPrimary: boolean;
}

/** One row: a member of the issue, at its depth in the issue's tree. */
export interface CatalogNumberGridRow {
  stampId: string;
  depth: number;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  /** On at least one of the issue's checklists — only these define the declared range (#333). */
  onChecklist: boolean;
}

export interface CatalogNumberGridData {
  issueId: string;
  collectionId: string;
  /** Names the issue in the dialog. */
  scopeLabel: string;
  columns: CatalogNumberGridColumn[];
  rows: CatalogNumberGridRow[];
  /** Every stored number of the rows' stamps in the grid's columns. */
  numbers: { stampId: string; catalogVendorId: string; number: string }[];
  /** The collection's duplicate policy (#85), so the dialog can say whether a repeat is refused. */
  duplicateMode: "warn" | "block";
}

/** One cell's write. A null or blank number removes the stamp's number in that catalogue. */
export interface CatalogNumberWrite {
  issueId: string;
  stampId: string;
  catalogVendorId: string;
  number: string | null;
}

/** Everything the grid draws, in one read. */
export async function getIssueCatalogNumberGrid(
  ownerId: string,
  issueId: string
): Promise<CatalogNumberGridData> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      collectionId: true,
      collectionAreaId: true,
      name: true,
      year: true,
      collection: { select: { duplicateCatalogMode: true } },
      checklists: { select: { stamps: { select: { stampId: true } } } },
    },
  });
  if (!issue) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, issue.collectionId);

  const [areas, issuePrefixes, members] = await Promise.all([
    readCollectionAreas(issue.collectionId),
    loadIssuePrefixMap(issue.collectionId),
    prisma.issueMember.findMany({
      where: { issueId },
      select: {
        stampId: true,
        sortOrder: true,
        stamp: {
          select: {
            parentId: true,
            name: true,
            issuedDay: true,
            issuedMonth: true,
            issuedYear: true,
            catalogNumbers: { select: { catalogVendorId: true, number: true } },
          },
        },
      },
    }),
  ]);

  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);
  const primaryVendorId = primaryVendorByArea.get(issue.collectionAreaId) ?? null;
  const columns: CatalogNumberGridColumn[] = [
    ...vendorMapFor(issue.collectionAreaId, issueId).values(),
  ]
    .map((v) => ({
      catalogVendorId: v.catalogVendorId,
      vendorName: v.vendorName,
      vendorAbbreviation: v.vendorAbbreviation,
      prefix: v.prefix,
      isPrimary: v.catalogVendorId === primaryVendorId,
    }))
    // The leading catalogue first, so the first cell focused is its first stamp; the rest keep the
    // stamp form's own order.
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  const onChecklist = new Set(issue.checklists.flatMap((c) => c.stamps.map((s) => s.stampId)));
  const byId = new Map(members.map((m) => [m.stampId, m]));
  const rows: CatalogNumberGridRow[] = flattenMemberTree(
    members.map((m) => ({ stampId: m.stampId, parentId: m.stamp.parentId, sortOrder: m.sortOrder }))
  ).map(({ stampId, depth }) => {
    const stamp = byId.get(stampId)!.stamp;
    return {
      stampId,
      depth,
      name: stamp.name?.trim() || null,
      issuedDay: stamp.issuedDay,
      issuedMonth: stamp.issuedMonth,
      issuedYear: stamp.issuedYear,
      onChecklist: onChecklist.has(stampId),
    };
  });

  const columnIds = new Set(columns.map((c) => c.catalogVendorId));
  return {
    issueId,
    collectionId: issue.collectionId,
    scopeLabel: issue.name ?? (issue.year != null ? String(issue.year) : "(unnamed issue)"),
    columns,
    rows,
    numbers: members.flatMap((m) =>
      m.stamp.catalogNumbers
        .filter((cn) => columnIds.has(cn.catalogVendorId))
        .map((cn) => ({ stampId: m.stampId, catalogVendorId: cn.catalogVendorId, number: cn.number }))
    ),
    duplicateMode: issue.collection.duplicateCatalogMode === "block" ? "block" : "warn",
  };
}

/**
 * One cell: set or clear a member stamp's number in one catalogue, then bring the stamp's sort key
 * and the issue's declared range for that catalogue in line with it.
 *
 * A blank number **removes** the row (#1346: emptying a cell removes the number), never stores an
 * empty string. Refused when the stamp is not a member of the issue — the grid is the issue's, and
 * a stale dialog must not write across into another — and, in a collection that blocks duplicate
 * catalogue identities (#85), when the number collides with another stamp's.
 */
export async function setIssueStampCatalogNumber(
  ownerId: string,
  write: CatalogNumberWrite
): Promise<void> {
  const issue = await prisma.issue.findUnique({
    where: { id: write.issueId },
    select: { collectionId: true },
  });
  if (!issue) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, issue.collectionId);
  const member = await prisma.issueMember.findUnique({
    where: { issueId_stampId: { issueId: write.issueId, stampId: write.stampId } },
    select: { stampId: true },
  });
  if (!member) throw new Error("This stamp is no longer part of the issue.");
  const vendor = await prisma.catalogVendor.findFirst({
    where: { id: write.catalogVendorId, collectionId: issue.collectionId },
    select: { id: true },
  });
  if (!vendor) throw new Error("Catalog not found.");

  const number = write.number?.trim() ?? "";
  if (number === "") {
    await prisma.stampCatalogNumber.deleteMany({
      where: { stampId: write.stampId, catalogVendorId: write.catalogVendorId },
    });
  } else {
    const blocked = await enforceStampCatalogDuplicates(ownerId, write.stampId, [
      { catalogVendorId: write.catalogVendorId, number },
    ]);
    if (blocked) throw new Error(blocked);
    await prisma.stampCatalogNumber.upsert({
      where: {
        stampId_catalogVendorId: { stampId: write.stampId, catalogVendorId: write.catalogVendorId },
      },
      create: { stampId: write.stampId, catalogVendorId: write.catalogVendorId, number },
      update: { number },
    });
  }

  await recomputeStampSortKeys(issue.collectionId, [write.stampId]);
  await refreshIssueDeclaredRange(issue.collectionId, write.issueId, write.catalogVendorId);
}

/**
 * The issue's declared range for one catalogue, recomputed from the numbers its checklist stamps
 * now carry (`recomputeDeclaredRange`). An issue with **no checklist stamps at all** is left alone:
 * nothing in it defines a range, and removing one on that account would erase a declaration the
 * numbers never contradicted.
 */
async function refreshIssueDeclaredRange(
  collectionId: string,
  issueId: string,
  catalogVendorId: string
): Promise<void> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      catalogNumbers: {
        where: { catalogVendorId },
        select: { firstNumber: true, lastNumber: true },
      },
      checklists: {
        select: {
          stamps: {
            select: {
              stampId: true,
              stamp: {
                select: {
                  catalogNumbers: { where: { catalogVendorId }, select: { number: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!issue) return;

  // Deduped by stamp: one stamp may sit on two of the issue's checklists.
  const numberByStamp = new Map<string, string | null>();
  for (const checklist of issue.checklists) {
    for (const entry of checklist.stamps) {
      numberByStamp.set(entry.stampId, entry.stamp.catalogNumbers[0]?.number ?? null);
    }
  }
  if (numberByStamp.size === 0) return;

  const current = issue.catalogNumbers[0] ?? null;
  const decision = recomputeDeclaredRange(
    current,
    [...numberByStamp.values()].filter((n): n is string => n !== null)
  );
  if (decision.kind === "keep") return;
  if (decision.kind === "remove") {
    await prisma.issueCatalogNumber.deleteMany({ where: { issueId, catalogVendorId } });
  } else {
    await prisma.issueCatalogNumber.upsert({
      where: { issueId_catalogVendorId: { issueId, catalogVendorId } },
      create: {
        issueId,
        catalogVendorId,
        firstNumber: decision.firstNumber,
        lastNumber: decision.lastNumber,
      },
      update: { firstNumber: decision.firstNumber, lastNumber: decision.lastNumber },
    });
  }
  // The catalogue's First may be what this issue sorts by (#181).
  await recomputeIssueSortKeys(collectionId, [issueId]);
}
