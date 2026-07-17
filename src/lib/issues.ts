import "server-only";
import { prisma } from "./db";

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveIssueArea(issueId: string): Promise<{ collectionId: string; collectionAreaId: string }> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { collectionId: true, collectionAreaId: true },
  });
  if (!issue) throw new Error("Issue not found.");
  return issue;
}

export interface StampNodeData {
  stampId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  requiredForCompleteness: boolean;
  catalogNumbers: { catalogVendorId: string; number: string }[];
}

export interface IssueCatalogNumberData {
  catalogVendorId: string;
  firstNumber: string;
  lastNumber: string | null;
}

export interface IssueData {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  members: StampNodeData[];
  catalogNumbers: IssueCatalogNumberData[];
  completeness: { required: number; owned: number };
}

const MEMBER_SELECT = {
  stampId: true,
  requiredForCompleteness: true,
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
} as const;

function toStampNode(m: {
  stampId: string;
  requiredForCompleteness: boolean;
  stamp: {
    parentId: string | null;
    name: string | null;
    issuedDay: number | null;
    issuedMonth: number | null;
    issuedYear: number | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
  };
}): StampNodeData {
  return {
    stampId: m.stampId,
    parentId: m.stamp.parentId,
    name: m.stamp.name,
    issuedDay: m.stamp.issuedDay,
    issuedMonth: m.stamp.issuedMonth,
    issuedYear: m.stamp.issuedYear,
    requiredForCompleteness: m.requiredForCompleteness,
    catalogNumbers: m.stamp.catalogNumbers,
  };
}

const ISSUE_SELECT = {
  id: true,
  collectionId: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  members: { select: MEMBER_SELECT },
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
} as const;

function toIssueData(issue: {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  members: {
    stampId: string;
    requiredForCompleteness: boolean;
    stamp: {
      parentId: string | null;
      name: string | null;
      issuedDay: number | null;
      issuedMonth: number | null;
      issuedYear: number | null;
      catalogNumbers: { catalogVendorId: string; number: string }[];
    };
  }[];
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
}): IssueData {
  const required = issue.members.filter((m) => m.requiredForCompleteness).length;
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt,
    members: issue.members.map(toStampNode),
    catalogNumbers: issue.catalogNumbers,
    completeness: { required, owned: 0 },
  };
}

export async function listIssuesForArea(
  ownerId: string,
  collectionId: string,
  areaId: string
): Promise<IssueData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const issues = await prisma.issue.findMany({
    where: { collectionId, collectionAreaId: areaId },
    orderBy: [{ year: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    select: ISSUE_SELECT,
  });
  return issues.map(toIssueData);
}

export async function listAllIssues(
  ownerId: string,
  collectionId: string,
  areaIds?: string[]
): Promise<IssueData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const issues = await prisma.issue.findMany({
    where: {
      collectionId,
      ...(areaIds && areaIds.length > 0 ? { collectionAreaId: { in: areaIds } } : {}),
    },
    orderBy: [{ collectionAreaId: "asc" }, { year: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    select: ISSUE_SELECT,
  });
  return issues.map(toIssueData);
}

// ── Paginated queries (used by API routes) ─────────────────────────────────

export interface IssueListItem {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: string;
  catalogNumbers: IssueCatalogNumberData[];
  memberCount: number;
  requiredCount: number;
}

export interface PaginatedIssuesResult {
  items: IssueListItem[];
  nextCursor: string | null;
}

const ISSUE_LIST_SELECT = {
  id: true,
  collectionId: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
  members: { select: { requiredForCompleteness: true } },
} as const;

function toIssueListItem(issue: {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
  members: { requiredForCompleteness: boolean }[];
}): IssueListItem {
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt.toISOString(),
    catalogNumbers: issue.catalogNumbers,
    memberCount: issue.members.length,
    requiredCount: issue.members.filter((m) => m.requiredForCompleteness).length,
  };
}

export async function listIssuesPaginated(
  ownerId: string,
  collectionId: string,
  opts: {
    areaIds?: string[];
    cursor?: string;
    pageSize?: number;
  }
): Promise<PaginatedIssuesResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = opts.pageSize ?? 50;
  const issues = await prisma.issue.findMany({
    where: {
      collectionId,
      ...(opts.areaIds && opts.areaIds.length > 0
        ? { collectionAreaId: { in: opts.areaIds } }
        : {}),
    },
    orderBy: [
      { collectionAreaId: "asc" },
      { year: "asc" },
      { name: "asc" },
      { createdAt: "asc" },
    ],
    select: ISSUE_LIST_SELECT,
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = issues.length > pageSize;
  const items = (hasMore ? issues.slice(0, pageSize) : issues).map(toIssueListItem);
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor };
}

export async function listIssueMembers(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<StampNodeData[]> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: MEMBER_SELECT,
  });
  return members.map(toStampNode);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface AutoCreateStampsInput {
  rangeFrom: number;
  rangeTo: number;
  vendorIds: string[];
}

export async function createIssue(
  ownerId: string,
  collectionId: string,
  areaId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
    autoCreateStamps?: AutoCreateStampsInput;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true },
  });
  if (!area || area.collectionId !== collectionId) {
    throw new Error("Collection area not found.");
  }

  if (data.autoCreateStamps) {
    const { rangeFrom, rangeTo, vendorIds } = data.autoCreateStamps;
    if (rangeFrom > rangeTo) throw new Error("Range start must be <= range end.");
    if (rangeTo - rangeFrom + 1 > 50) throw new Error("Range cannot exceed 50 stamps.");
    if (vendorIds.length === 0) throw new Error("At least one catalog vendor must be selected.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const issue = await tx.issue.create({
      data: {
        collectionId,
        collectionAreaId: areaId,
        name: data.name ?? null,
        year: data.year ?? null,
      },
      select: { id: true },
    });
    if (data.catalogNumbers && data.catalogNumbers.length > 0) {
      await tx.issueCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          issueId: issue.id,
          catalogVendorId: cn.catalogVendorId,
          firstNumber: cn.firstNumber,
          lastNumber: cn.lastNumber ?? null,
        })),
        skipDuplicates: true,
      });
    }

    if (data.autoCreateStamps) {
      const { rangeFrom, rangeTo, vendorIds } = data.autoCreateStamps;
      const stampIds: string[] = [];

      for (let n = rangeFrom; n <= rangeTo; n++) {
        const stamp = await tx.stamp.create({
          data: {
            collectionId,
            issuedYear: data.year ?? null,
          },
          select: { id: true },
        });
        stampIds.push(stamp.id);
      }

      await tx.stampCollectionArea.createMany({
        data: stampIds.map((stampId) => ({
          stampId,
          collectionAreaId: areaId,
          isPrimary: true,
        })),
      });

      await tx.issueMember.createMany({
        data: stampIds.map((stampId) => ({
          issueId: issue.id,
          stampId,
          requiredForCompleteness: true,
        })),
      });

      const catalogNumberRows: { stampId: string; catalogVendorId: string; number: string }[] = [];
      for (let i = 0; i < stampIds.length; i++) {
        const num = String(rangeFrom + i);
        for (const vendorId of vendorIds) {
          catalogNumberRows.push({
            stampId: stampIds[i],
            catalogVendorId: vendorId,
            number: num,
          });
        }
      }
      if (catalogNumberRows.length > 0) {
        await tx.stampCatalogNumber.createMany({ data: catalogNumberRows });
      }
    }

    return issue;
  });
  return { id: created.id };
}

export async function updateIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
  }
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issueId },
      data: { name: data.name ?? null, year: data.year ?? null },
    });
    if (data.catalogNumbers !== undefined) {
      await tx.issueCatalogNumber.deleteMany({ where: { issueId } });
      if (data.catalogNumbers.length > 0) {
        await tx.issueCatalogNumber.createMany({
          data: data.catalogNumbers.map((cn) => ({
            issueId,
            catalogVendorId: cn.catalogVendorId,
            firstNumber: cn.firstNumber,
            lastNumber: cn.lastNumber ?? null,
          })),
          skipDuplicates: true,
        });
      }
    }
  });
}

export async function deleteIssue(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  await prisma.$transaction(async (tx) => {
    const members = await tx.issueMember.findMany({
      where: { issueId },
      select: { stampId: true },
    });

    if (members.length > 0) {
      const stampIds = members.map((m) => m.stampId);
      const shared = await tx.issueMember.groupBy({
        by: ["stampId"],
        where: { stampId: { in: stampIds }, issueId: { not: issueId } },
      });
      const sharedIds = new Set(shared.map((s) => s.stampId));
      const exclusiveIds = stampIds.filter((id) => !sharedIds.has(id));

      if (exclusiveIds.length > 0) {
        await deleteStampsDepthFirst(tx, exclusiveIds);
      }
    }

    await tx.issue.delete({ where: { id: issueId } });
  });
}

async function deleteStampsDepthFirst(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  stampIds: string[]
): Promise<void> {
  const idSet = new Set(stampIds);
  const stamps = await tx.stamp.findMany({
    where: { id: { in: stampIds } },
    select: { id: true, parentId: true },
  });

  const childMap = new Map<string | null, string[]>();
  for (const s of stamps) {
    const parentKey = s.parentId && idSet.has(s.parentId) ? s.parentId : null;
    const list = childMap.get(parentKey) ?? [];
    list.push(s.id);
    childMap.set(parentKey, list);
  }

  const order: string[] = [];
  function visit(id: string) {
    for (const child of childMap.get(id) ?? []) visit(child);
    order.push(id);
  }
  for (const root of childMap.get(null) ?? []) visit(root);
  for (const id of stampIds) {
    if (!order.includes(id)) order.push(id);
  }

  for (const id of order) {
    await tx.stamp.delete({ where: { id } });
  }
}

export interface IssueDeletionPreview {
  totalMembers: number;
  exclusiveCount: number;
  sharedCount: number;
}

export async function previewIssueDeletion(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueDeletionPreview> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: { stampId: true },
  });

  if (members.length === 0) {
    return { totalMembers: 0, exclusiveCount: 0, sharedCount: 0 };
  }

  const stampIds = members.map((m) => m.stampId);
  const shared = await prisma.issueMember.groupBy({
    by: ["stampId"],
    where: { stampId: { in: stampIds }, issueId: { not: issueId } },
  });
  const sharedCount = shared.length;

  return {
    totalMembers: members.length,
    exclusiveCount: members.length - sharedCount,
    sharedCount,
  };
}

export interface AddStampData {
  name?: string | null;
  issuedDay?: number | null;
  issuedMonth?: number | null;
  issuedYear?: number | null;
  parentStampId?: string | null;
  requiredForCompleteness: boolean;
  catalogNumbers: { catalogVendorId: string; number: string }[];
}

export async function addStampToIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  data: AddStampData
): Promise<{ stampId: string }> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  if (data.parentStampId) {
    const parentMember = await prisma.issueMember.findUnique({
      where: { issueId_stampId: { issueId, stampId: data.parentStampId } },
    });
    if (!parentMember) {
      throw new Error("Parent stamp is not a member of this issue.");
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const stamp = await tx.stamp.create({
      data: {
        collectionId,
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
        parentId: data.parentStampId ?? null,
      },
      select: { id: true },
    });

    await tx.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId, isPrimary: true },
    });

    await tx.issueMember.create({
      data: {
        issueId,
        stampId: stamp.id,
        requiredForCompleteness: data.requiredForCompleteness,
      },
    });

    if (data.catalogNumbers.length > 0) {
      await tx.stampCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          stampId: stamp.id,
          catalogVendorId: cn.catalogVendorId,
          number: cn.number,
        })),
        skipDuplicates: true,
      });
    }

    return { stampId: stamp.id };
  });

  return result;
}

export async function toggleIssueMemberRequired(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string,
  required: boolean
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.issueMember.update({
    where: { issueId_stampId: { issueId, stampId } },
    data: { requiredForCompleteness: required },
  });
}

export async function removeStampFromIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.issueMember.delete({
    where: { issueId_stampId: { issueId, stampId } },
  });
}

export async function moveStampNode(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string,
  targetIssueId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  const { collectionId: targetCollection } = await resolveIssueArea(targetIssueId);
  if (targetCollection !== collectionId) throw new Error("Target issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  // Collect the stamp and all its descendants that are members of this issue
  const allMembers = await prisma.issueMember.findMany({
    where: { issueId },
    select: { stampId: true, requiredForCompleteness: true, stamp: { select: { parentId: true } } },
  });

  const memberSet = new Map(allMembers.map((m) => [m.stampId, m]));

  function collectSubtree(rootId: string): string[] {
    const ids: string[] = [rootId];
    for (const [sid, member] of memberSet) {
      if (member.stamp.parentId === rootId) {
        ids.push(...collectSubtree(sid));
      }
    }
    return ids;
  }

  const stampIds = collectSubtree(stampId);

  await prisma.$transaction(
    stampIds.map((sid) =>
      prisma.issueMember.update({
        where: { issueId_stampId: { issueId, stampId: sid } },
        data: { issueId: targetIssueId },
      })
    )
  );
}
