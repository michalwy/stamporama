import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { DEFAULT_CHECKLIST } from "./checklist-vocabulary";

// Checklists (#531; ADR-0031) — a named list of stamps that counts as one complete unit. The
// storage and read paths; everything about *how complete* one is lives in `issue-completeness.ts`.
//
// An issue-anchored checklist is edited from the issue's own row, the scope rule ADR-0020 §7
// states: the screen it is opened from already answers "which issue", and asking again in a flat
// collection-wide editor is how a goal ends up filed under the wrong publication.
//
// Membership **is** required-ness. A stamp that is an optional extra is an `IssueMember` in no
// checklist, which is exactly what the old `requiredForCompleteness = false` said.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve a checklist to its collection, so every write can be authorized from the id alone. */
async function resolveChecklistCollection(checklistId: string): Promise<string> {
  const row = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("Checklist not found.");
  return row.collectionId;
}

/** What every surface that merely *names* a checklist needs. */
export interface ChecklistData {
  id: string;
  issueId: string | null;
  name: string;
  sortOrder: number;
  /** Stamps on the checklist — the set completeness, the price total and the range are all read
   *  against. */
  stampIds: string[];
}

const CHECKLIST_SELECT = {
  id: true,
  issueId: true,
  name: true,
  sortOrder: true,
  stamps: { select: { stampId: true } },
} as const;

function toChecklistData(row: {
  id: string;
  issueId: string | null;
  name: string;
  sortOrder: number;
  stamps: { stampId: string }[];
}): ChecklistData {
  return {
    id: row.id,
    issueId: row.issueId,
    name: row.name,
    sortOrder: row.sortOrder,
    stampIds: row.stamps.map((s) => s.stampId),
  };
}

/** Ordering is `sortOrder` then `createdAt`, everywhere — the first checklist of an issue is the
 *  one a badge falls back to and the one a new stamp joins by default, so it must be stable. */
const CHECKLIST_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] as const;

/** The checklists anchored to one issue, in display order. */
export async function getChecklistsForIssue(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<ChecklistData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.checklist.findMany({
    where: { collectionId, issueId },
    orderBy: [...CHECKLIST_ORDER],
    select: CHECKLIST_SELECT,
  });
  return rows.map(toChecklistData);
}

/**
 * Checklists for a whole page of issues, keyed by issue id — one query, never one per row. The
 * issues list needs every row's checklists to draw its badge and its per-checklist price total,
 * and a query per row is what makes a list of fifty issues fifty round trips.
 *
 * Not owner-checked: the callers are list builders that have already authorized the collection.
 */
export async function listChecklistsForIssues(
  collectionId: string,
  issueIds: string[]
): Promise<Map<string, ChecklistData[]>> {
  const byIssue = new Map<string, ChecklistData[]>();
  if (issueIds.length === 0) return byIssue;
  const rows = await prisma.checklist.findMany({
    where: { collectionId, issueId: { in: issueIds } },
    orderBy: [...CHECKLIST_ORDER],
    select: CHECKLIST_SELECT,
  });
  for (const row of rows) {
    if (!row.issueId) continue;
    const list = byIssue.get(row.issueId);
    if (list) list.push(toChecklistData(row));
    else byIssue.set(row.issueId, [toChecklistData(row)]);
  }
  return byIssue;
}

/** One checklist by id, collection-scoped. Null when it does not exist or belongs elsewhere. */
export async function getChecklist(
  ownerId: string,
  collectionId: string,
  checklistId: string
): Promise<ChecklistData | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: CHECKLIST_SELECT,
  });
  return row ? toChecklistData(row) : null;
}

/** The checklist ids each of these stamps is on, keyed by stamp id. Feeds the "in N checklists"
 *  chips on the stamp list and the stamp tree's bolding, in one query for the whole page. */
export async function listChecklistIdsByStamp(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, string[]>> {
  const byStamp = new Map<string, string[]>();
  if (stampIds.length === 0) return byStamp;
  const rows = await prisma.checklistStamp.findMany({
    where: { stampId: { in: stampIds }, checklist: { collectionId } },
    select: { stampId: true, checklistId: true },
  });
  for (const row of rows) {
    const list = byStamp.get(row.stampId);
    if (list) list.push(row.checklistId);
    else byStamp.set(row.stampId, [row.checklistId]);
  }
  return byStamp;
}

/** The name an issue's first checklist takes when one is created implicitly — by ticking the stamp
 *  form's box on an issue that has none yet. The issue's own name, because that is what the single
 *  target *was* before checklists existed; the migration names the backfilled ones the same way. */
export function defaultChecklistName(issueName: string | null): string {
  const trimmed = issueName?.trim();
  return trimmed ? trimmed : "Complete set";
}

/**
 * Create a checklist. `issueId` null anchors it to nothing — a checklist spanning issues — which
 * the schema allows from the first migration though no editor builds one yet (#531 decision 4).
 * `sortOrder` lands it after the issue's existing checklists.
 */
export async function createChecklist(
  ownerId: string,
  collectionId: string,
  input: { issueId: string | null; name: string }
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = input.name.trim();
  if (!name) throw new Error("A checklist needs a name.");
  if (input.issueId) {
    const issue = await prisma.issue.findFirst({
      where: { id: input.issueId, collectionId },
      select: { id: true },
    });
    if (!issue) throw new Error("Issue not found.");
  }
  const last = await prisma.checklist.findFirst({
    where: { collectionId, issueId: input.issueId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.checklist.create({
    data: {
      collectionId,
      issueId: input.issueId,
      name,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });
  return created.id;
}

export async function renameChecklist(
  ownerId: string,
  checklistId: string,
  name: string
): Promise<void> {
  const collectionId = await resolveChecklistCollection(checklistId);
  await assertCollectionOwner(ownerId, collectionId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A checklist needs a name.");
  await prisma.checklist.update({ where: { id: checklistId }, data: { name: trimmed } });
}

export async function deleteChecklist(ownerId: string, checklistId: string): Promise<void> {
  const collectionId = await resolveChecklistCollection(checklistId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.checklist.delete({ where: { id: checklistId } });
}

/**
 * Reorder an issue's checklists to exactly `checklistIds`. The order decides which one a
 * single-checklist badge shows and which one a new stamp joins by default, so it is the
 * collector's to set. Ids not belonging to the issue are ignored rather than rejected — a stale
 * client list must not be able to renumber somebody else's rows.
 */
export async function reorderChecklists(
  ownerId: string,
  collectionId: string,
  issueId: string,
  checklistIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.checklist.findMany({
    where: { collectionId, issueId },
    select: { id: true },
  });
  const own = new Set(rows.map((r) => r.id));
  const ordered = checklistIds.filter((id) => own.has(id));
  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.checklist.update({ where: { id }, data: { sortOrder: index } })
    )
  );
}

/**
 * Replace a checklist's stamps with exactly `stampIds`. A set operation rather than add/remove,
 * because the editor hands over the ticked boxes of a whole tree and a diff computed here cannot
 * drift from what was on screen. Stamps outside the collection are dropped.
 */
export async function setChecklistStamps(
  ownerId: string,
  checklistId: string,
  stampIds: string[]
): Promise<void> {
  const collectionId = await resolveChecklistCollection(checklistId);
  await assertCollectionOwner(ownerId, collectionId);
  const wanted = [...new Set(stampIds)];
  const valid =
    wanted.length === 0
      ? []
      : (
          await prisma.stamp.findMany({
            where: { id: { in: wanted }, collectionId },
            select: { id: true },
          })
        ).map((s) => s.id);
  await prisma.$transaction([
    prisma.checklistStamp.deleteMany({ where: { checklistId } }),
    ...(valid.length > 0
      ? [
          prisma.checklistStamp.createMany({
            data: valid.map((stampId) => ({ checklistId, stampId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/**
 * Put one stamp on exactly `checklistIds` of its issue's checklists, leaving every other issue's
 * alone. What the stamp form saves: the dialog shows one issue's checklists, so a stamp that also
 * sits on a checklist of a *different* issue must not lose it. Ids that are not this issue's are
 * dropped — a stale client list must not reach into another issue's goals.
 *
 * Runs on the caller's transaction client; not owner-checked, since every caller authorized the
 * collection before opening its transaction.
 */
export { DEFAULT_CHECKLIST };

export async function putStampOnChecklists(
  tx: Prisma.TransactionClient,
  collectionId: string,
  issueId: string,
  stampId: string,
  checklistIds: string[]
): Promise<void> {
  const own = await tx.checklist.findMany({
    where: { collectionId, issueId },
    select: { id: true },
  });
  const ownIds = own.map((c) => c.id);
  const wanted = new Set(checklistIds.filter((id) => ownIds.includes(id)));
  if (checklistIds.includes(DEFAULT_CHECKLIST)) {
    wanted.add(await ensureIssueChecklist(tx, collectionId, issueId));
  }
  await tx.checklistStamp.deleteMany({
    where: { stampId, checklist: { collectionId, issueId } },
  });
  if (wanted.size > 0) {
    await tx.checklistStamp.createMany({
      data: [...wanted].map((checklistId) => ({ checklistId, stampId })),
      skipDuplicates: true,
    });
  }
}

/** {@link putStampOnChecklists} for a caller with no transaction of its own. */
export async function setStampChecklistsForIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string,
  checklistIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction((tx) =>
    putStampOnChecklists(tx, collectionId, issueId, stampId, checklistIds)
  );
}

/**
 * The issue's first checklist, creating it from the issue's name when there is none. Runs on the
 * caller's transaction client, since the write paths that need it (auto-created ranges, the stamp
 * form) are already inside one — and **not** owner-checked: every caller has authorized the
 * collection before opening its transaction.
 */
export async function ensureIssueChecklist(
  tx: Prisma.TransactionClient,
  collectionId: string,
  issueId: string
): Promise<string> {
  const existing = await tx.checklist.findFirst({
    where: { collectionId, issueId },
    orderBy: [...CHECKLIST_ORDER],
    select: { id: true },
  });
  if (existing) return existing.id;
  const issue = await tx.issue.findFirst({
    where: { id: issueId, collectionId },
    select: { name: true },
  });
  if (!issue) throw new Error("Issue not found.");
  const created = await tx.checklist.create({
    data: {
      collectionId,
      issueId,
      name: defaultChecklistName(issue.name),
      sortOrder: 0,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * {@link ensureIssueChecklist} for a caller with no transaction of its own. The stamp form's
 * "required for completeness" box lands here: on an issue that already has checklists the
 * collector picks them explicitly, and on one that has none the box means what it always
 * meant — start this issue's set.
 */
export async function ensureDefaultChecklist(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  return ensureIssueChecklist(prisma, collectionId, issueId);
}
