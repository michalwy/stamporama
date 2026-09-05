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
   *  against — **in the order the set reads** (#764), which an album page then prints as a row. */
  stampIds: string[];
}

const CHECKLIST_SELECT = {
  id: true,
  issueId: true,
  name: true,
  sortOrder: true,
  stamps: { select: { stampId: true, sortOrder: true } },
} as const;

/**
 * The order the set reads in (#764): `sortOrder`, the stamp id behind it so rows written in one
 * `createMany` before the column existed still come out the same way twice.
 *
 * Sorted in the mapper rather than by the query, exactly as the issue list's checklists are: the
 * select above is `as const`, and a readonly `orderBy` tuple is not assignable to Prisma's mutable
 * input type. A checklist is a set of stamps, not a page of them, so this costs nothing.
 */
export function compareChecklistStamps(
  a: { stampId: string; sortOrder: number },
  b: { stampId: string; sortOrder: number }
): number {
  return a.sortOrder - b.sortOrder || a.stampId.localeCompare(b.stampId);
}

/** {@link compareChecklistStamps} applied — a checklist's membership in the order it reads. */
export function orderedChecklistStampIds(
  stamps: readonly { stampId: string; sortOrder: number }[]
): string[] {
  return [...stamps].sort(compareChecklistStamps).map((s) => s.stampId);
}

function toChecklistData(row: {
  id: string;
  issueId: string | null;
  name: string;
  sortOrder: number;
  stamps: { stampId: string; sortOrder: number }[];
}): ChecklistData {
  return {
    id: row.id,
    issueId: row.issueId,
    name: row.name,
    sortOrder: row.sortOrder,
    stampIds: orderedChecklistStampIds(row.stamps),
  };
}

/**
 * The order a checklist's stamps read in (#764), for the queries that can state it themselves —
 * `CHECKLIST_SELECT` cannot, being `as const`, and sorts in its mapper instead. Spread it
 * (`orderBy: [...CHECKLIST_STAMP_ORDER]`): Prisma's input type is mutable.
 */
export const CHECKLIST_STAMP_ORDER = [{ sortOrder: "asc" }, { stampId: "asc" }] as const;

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
  // Membership is replaced; the **order** (#764) is not. A stamp that survives the edit keeps its
  // place, and the ones just ticked are appended in the order the tree offered them — ticking a
  // box is an answer about what the set contains, and it must not silently undo an order the
  // collector dragged into shape.
  const before = await prisma.checklistStamp.findMany({
    where: { checklistId },
    select: { stampId: true, sortOrder: true },
  });
  const kept = new Set(valid);
  const held = new Set(before.map((r) => r.stampId));
  const ordered = [
    ...orderedChecklistStampIds(before).filter((id) => kept.has(id)),
    ...valid.filter((id) => !held.has(id)),
  ];
  await prisma.$transaction([
    prisma.checklistStamp.deleteMany({ where: { checklistId } }),
    ...(ordered.length > 0
      ? [
          prisma.checklistStamp.createMany({
            data: ordered.map((stampId, i) => ({ checklistId, stampId, sortOrder: i })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/**
 * Reorder a checklist's stamps to exactly `stampIds` — the collection-wide answer to "in what order
 * does this set read" (#764), which an album page prints as a row of boxes and may then override
 * locally (#767).
 *
 * A checklist is **flat**, so unlike `IssueMember` (#549) there are no sibling groups to keep
 * apart: the whole list is densely renumbered. Ids that are not on this checklist are ignored
 * rather than rejected, and members the client left out keep their relative order at the end — a
 * stale list must be able to move what it names without dropping what it never saw.
 */
export async function reorderChecklistStamps(
  ownerId: string,
  checklistId: string,
  stampIds: string[]
): Promise<void> {
  const collectionId = await resolveChecklistCollection(checklistId);
  await assertCollectionOwner(ownerId, collectionId);
  const members = await prisma.checklistStamp.findMany({
    where: { checklistId },
    select: { stampId: true, sortOrder: true },
  });
  const own = new Set(members.map((m) => m.stampId));
  const named = stampIds.filter((id, i) => own.has(id) && stampIds.indexOf(id) === i);
  const namedSet = new Set(named);
  const ordered = [
    ...named,
    ...orderedChecklistStampIds(members).filter((id) => !namedSet.has(id)),
  ];
  await prisma.$transaction(
    ordered.map((stampId, i) =>
      prisma.checklistStamp.update({
        where: { checklistId_stampId: { checklistId, stampId } },
        data: { sortOrder: i },
      })
    )
  );
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
  // Where this stamp already sits on a checklist, it keeps its place (#764): editing a stamp is not
  // a statement about the set's order, and the rows go through a delete/insert only because the
  // membership is written as a set. A checklist it joins now appends it at the end — the same rule
  // `IssueMember` follows, and the only position that cannot be wrong.
  const [before, ends] = await Promise.all([
    tx.checklistStamp.findMany({
      where: { stampId, checklist: { collectionId, issueId } },
      select: { checklistId: true, sortOrder: true },
    }),
    wanted.size > 0
      ? tx.checklistStamp.groupBy({
          by: ["checklistId"],
          where: { checklistId: { in: [...wanted] } },
          _max: { sortOrder: true },
        })
      : Promise.resolve([]),
  ]);
  const heldAt = new Map(before.map((r) => [r.checklistId, r.sortOrder]));
  const lastAt = new Map(ends.map((r) => [r.checklistId, r._max.sortOrder ?? -1]));
  await tx.checklistStamp.deleteMany({
    where: { stampId, checklist: { collectionId, issueId } },
  });
  if (wanted.size > 0) {
    await tx.checklistStamp.createMany({
      data: [...wanted].map((checklistId) => ({
        checklistId,
        stampId,
        sortOrder: heldAt.get(checklistId) ?? (lastAt.get(checklistId) ?? -1) + 1,
      })),
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
