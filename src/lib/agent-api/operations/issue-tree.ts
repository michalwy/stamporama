import "server-only";
import { prisma } from "../../db";
import { effectiveVendorsForArea } from "../../area-vendor";
import { readCollectionAreas } from "../../areas";
import { findCatalogDuplicatesForCandidates } from "../../duplicate-catalog";
import { refreshIssueDeclaredRange } from "../../issue-catalog-numbers";
import { deleteIssue, moveStampNode } from "../../issues";
import { invalidRequest, notFound } from "../errors";
import {
  issueChecklistsInAlbumsMessage,
  issueHasStampsMessage,
  moveCollisions,
  spokenIssue,
  type MoveCollision,
} from "../issue-tree";
import { optionalBoolean, optionalInteger, optionalString, requiredString } from "../params";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import { loadStampLabels, resolveStampRefs, type StampLabel } from "./stamp-refs";
import type { Operation, OperationContext, ParsedParams } from "../types";

// A stamp between issues, and an empty issue deleted (#2169, #2172). They lift #1438's *nothing is
// moved or deleted* for exactly these two acts: a stamp, with its variants, moved to another issue
// of its area, and an issue with no stamps deleted. Nothing else moves between issues — two issues
// are never merged, a catalogue number never leaves a stamp, an issue with stamps is never deleted,
// and the order of an issue's stamps is set only where a moved stamp lands.
//
// **Each is the screen's own write.** A move is `moveStampNode`, the Issues row's *Move to another
// issue…* (#54), and the collector kept its area rule on 2026-10-25: the target is an issue of the
// same area. What the operation adds, asked for by #2169, is two things the screen's move does not
// do — the stamps' checklist places follow them (`moveChecklistPlaces`), and a position — and one it
// does not check: a number that reads differently under the target's own prefix (#377) and is
// already another stamp's is refused before anything is written. A delete is `deleteIssue`, the
// issue's *Delete*, told to refuse an issue that has gained a stamp since it was checked
// (`onlyIfEmpty`), so it can never take one.

/** An issue as these answers name it. */
export interface AgentTreeIssue {
  readonly issueId: string;
  readonly issueNo: number;
  readonly name: string | null;
  readonly year: number | null;
}

/** A stamp as these answers name it. */
export interface AgentMovedStamp extends StampLabel {
  readonly stampId: string;
}

function movedStamp(labels: ReadonlyMap<string, StampLabel>, stampId: string): AgentMovedStamp {
  const label = labels.get(stampId);
  if (!label) throw new Error(`Stamp ${stampId} was named but not loaded.`);
  return { stampId, ...label };
}

function spokenStamp(stamp: AgentMovedStamp): string {
  return stamp.catalogNumbers[0] ? `${stamp.catalogNumbers[0]} (st ${stamp.stampNo})` : `st ${stamp.stampNo}`;
}

const ISSUE_SELECT = {
  id: true,
  issueNo: true,
  name: true,
  year: true,
  collectionAreaId: true,
  catalogPrefixes: { select: { catalogVendorId: true, areaPrefix: true } },
} as const;

async function loadIssue(context: OperationContext, issueId: string, parameter: string) {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId: context.collectionId },
    select: ISSUE_SELECT,
  });
  if (!issue) {
    throw notFound(
      `No issue with id "${issueId}" is in this token's collection ("${parameter}"). Use \`list_issues\` or \`search_collection\` to find the right id.`
    );
  }
  return issue;
}

function treeIssue(issue: { id: string; issueNo: number; name: string | null; year: number | null }): AgentTreeIssue {
  return { issueId: issue.id, issueNo: issue.issueNo, name: issue.name, year: issue.year };
}

// ── Moving a stamp to another issue ────────────────────────────────────────

/**
 * The issue the stamp leaves. A stamp filed under one issue leaves that one; one filed under several
 * names it in `from_issue_id`. The target is never the source.
 */
function sourceIssueId(memberships: readonly string[], targetId: string, fromParam: string | null): string {
  if (fromParam !== null) {
    if (fromParam === targetId) {
      throw invalidRequest('"from_issue_id" and "issue_id" name the same issue. Name the issue the stamp leaves and the one it goes to.');
    }
    if (!memberships.includes(fromParam)) {
      throw invalidRequest(`The stamp is not filed under the issue "${fromParam}" ("from_issue_id"). Use one of its issues.`, memberships);
    }
    return fromParam;
  }
  const others = memberships.filter((id) => id !== targetId);
  if (others.length === 0) {
    throw invalidRequest(
      memberships.length === 0
        ? "The stamp is filed under no issue. Add it to an issue on the collector's screen first."
        : "The stamp is already filed under that issue, and under no other. Nothing was moved."
    );
  }
  if (others.length > 1) {
    throw invalidRequest('The stamp is filed under several issues. Name the one it leaves with "from_issue_id".', others);
  }
  return others[0];
}

/** The stamp and the variants filed under it in the source issue, the stamp first. */
function subtreeIds(members: readonly { stampId: string; parentId: string | null }[], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const member of members) if (member.parentId === ids[i]) ids.push(member.stampId);
  }
  return ids;
}

/** The prefix a catalogue's numbers carry under an issue of the area: its own, else the area's. */
function resolvedPrefix(entry: { catalogVendorId: string; prefix: string | null }, own: ReadonlyMap<string, string>) {
  return own.get(entry.catalogVendorId) || entry.prefix || null;
}

/**
 * Refuse a move whose stamps would read, under the target issue's own prefix, as a number another
 * stamp of the collection already has. Only the catalogues whose resolved prefix differs between the
 * two issues are checked — under the same prefix a stamp reads as it did, and a duplicate the
 * collection already carries must not block the move — and the moved stamps are never counted
 * against each other, since they all take the new prefix together.
 */
async function refuseMoveCollisions(
  context: OperationContext,
  areaId: string,
  source: { catalogPrefixes: { catalogVendorId: string; areaPrefix: string }[] },
  target: { id: string; issueNo: number; name: string | null; year: number | null; catalogPrefixes: { catalogVendorId: string; areaPrefix: string }[] },
  stampIds: readonly string[]
): Promise<void> {
  const areas = await readCollectionAreas(context.collectionId);
  const sourceOwn = new Map(source.catalogPrefixes.map((row) => [row.catalogVendorId, row.areaPrefix]));
  const targetOwn = new Map(target.catalogPrefixes.map((row) => [row.catalogVendorId, row.areaPrefix]));
  const changed = effectiveVendorsForArea(areas, areaId)
    .filter((entry) => resolvedPrefix(entry, sourceOwn) !== resolvedPrefix(entry, targetOwn))
    .map((entry) => entry.catalogVendorId);
  if (changed.length === 0) return;

  const stamps = await prisma.stamp.findMany({
    where: { id: { in: [...stampIds] }, collectionId: context.collectionId },
    select: {
      id: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      catalogNumbers: { where: { catalogVendorId: { in: changed } }, select: { catalogVendorId: true, number: true } },
    },
  });
  const moving = new Set(stampIds);
  const labels = await loadStampLabels(context, stampIds);
  const collisions: MoveCollision[] = [];
  for (const stamp of stamps) {
    if (stamp.catalogNumbers.length === 0) continue;
    // A stamp's identity resolves through its own primary area, as duplicate detection reads it.
    const ownArea = (stamp.stampAreaLinks.find((link) => link.isPrimary) ?? stamp.stampAreaLinks[0])?.collectionAreaId ?? areaId;
    const groups = await findCatalogDuplicatesForCandidates(
      context.ownerId,
      context.collectionId,
      { areaId: ownArea, issueId: target.id },
      stamp.catalogNumbers,
      stamp.id
    );
    for (const group of groups) {
      const holders = group.stamps.filter((holder) => !moving.has(holder.stampId));
      if (holders.length === 0) continue;
      collisions.push({ label: group.label, stamp: spokenStamp(movedStamp(labels, stamp.id)), holders });
    }
  }
  if (collisions.length > 0) throw moveCollisions(spokenIssue(target), collisions);
}

/** A declared range as an answer states it: `100-105`, or the one number. */
function rangeText(range: { firstNumber: string; lastNumber: string | null } | undefined): string | null {
  if (!range) return null;
  return range.lastNumber ? `${range.firstNumber}-${range.lastNumber}` : range.firstNumber;
}

async function declaredRanges(issueId: string) {
  const rows = await prisma.issueCatalogNumber.findMany({
    where: { issueId },
    select: { catalogVendorId: true, firstNumber: true, lastNumber: true, catalogVendor: { select: { abbreviation: true } } },
  });
  return new Map(rows.map((row) => [row.catalogVendorId, row]));
}

/**
 * Recompute an issue's declared ranges from its stamps — every catalogue of its area and any other
 * it declares one in — with the catalogue-number grid's own rule (#1346): the span of its standard
 * checklists' stamps, an issue with no checklist stamp left alone. Answers the catalogues that changed.
 */
async function updateRanges(context: OperationContext, issueId: string, areaId: string) {
  const before = await declaredRanges(issueId);
  const areas = await readCollectionAreas(context.collectionId);
  const vendorIds = new Set([...effectiveVendorsForArea(areas, areaId).map((entry) => entry.catalogVendorId), ...before.keys()]);
  for (const vendorId of vendorIds) await refreshIssueDeclaredRange(context.collectionId, issueId, vendorId);
  const after = await declaredRanges(issueId);
  const vendors = await prisma.catalogVendor.findMany({
    where: { id: { in: [...vendorIds] } },
    select: { id: true, abbreviation: true },
    orderBy: { abbreviation: "asc" },
  });
  return vendors
    .map((vendor) => ({ catalogue: vendor.abbreviation, before: rangeText(before.get(vendor.id)), after: rangeText(after.get(vendor.id)) }))
    .filter((row) => row.before !== row.after);
}

export async function moveStampToIssueFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  stamp: AgentMovedStamp;
  from: AgentTreeIssue;
  to: AgentTreeIssue;
  stampsMoved: AgentMovedStamp[];
  position: number;
  checklists: {
    left: { checklistId: string; name: string; stamps: number[] }[];
    joined: { checklistId: string; name: string; created: boolean; stamps: number[] };
  };
  ranges: { issueId: string; catalogue: string; before: string | null; after: string | null }[] | null;
  path: string;
}> {
  const [stampId] = await resolveStampRefs(context, [requiredString(params, "stamp_id")], "stamp_id");
  const stamp = await prisma.stamp.findFirstOrThrow({
    where: { id: stampId, collectionId: context.collectionId },
    select: { id: true, parentId: true, issueMemberships: { select: { issueId: true }, orderBy: { issueId: "asc" } } },
  });
  const target = await loadIssue(context, requiredString(params, "issue_id"), "issue_id");
  const memberships = stamp.issueMemberships.map((row) => row.issueId);
  const source = await loadIssue(context, sourceIssueId(memberships, target.id, optionalString(params, "from_issue_id")), "from_issue_id");

  if (source.collectionAreaId !== target.collectionAreaId) {
    throw invalidRequest(
      `${spokenIssue(target)} is in another area than ${spokenIssue(source)}, and a stamp moves only to an issue of its own area, as on the collector's screen. Use an issue of the same area, or move the whole issue with \`move_issue_to_area\`.`
    );
  }

  const members = await prisma.issueMember.findMany({
    where: { issueId: source.id },
    select: { stampId: true, stamp: { select: { parentId: true } } },
  });
  const tree = members.map((member) => ({ stampId: member.stampId, parentId: member.stamp.parentId }));
  if (stamp.parentId !== null && tree.some((member) => member.stampId === stamp.parentId)) {
    const labels = await loadStampLabels(context, [stamp.id, stamp.parentId]);
    throw invalidRequest(
      `${spokenStamp(movedStamp(labels, stamp.id))} is a variant of ${spokenStamp(movedStamp(labels, stamp.parentId))} in ${spokenIssue(source)}, and a stamp moves with its variants rather than out from under its base stamp. Move the base stamp, or bring this one up first with \`move_stamp_variant\` and \`top_level\`. Nothing was moved.`
    );
  }
  const stampIds = subtreeIds(tree, stamp.id);

  const alreadyThere = await prisma.issueMember.findMany({
    where: { issueId: target.id, stampId: { in: stampIds } },
    select: { stampId: true },
  });
  if (alreadyThere.length > 0) {
    const labels = await loadStampLabels(context, alreadyThere.map((row) => row.stampId));
    throw invalidRequest(
      `${alreadyThere.map((row) => spokenStamp(movedStamp(labels, row.stampId))).join(", ")} ${alreadyThere.length === 1 ? "is" : "are"} already filed under ${spokenIssue(target)}. Nothing was moved.`
    );
  }

  // Among the stamps standing at the top of the target's tree, where the moved stamp will stand.
  const position = optionalInteger(params, "position");
  if (position !== null) {
    const targetMembers = await prisma.issueMember.findMany({
      where: { issueId: target.id },
      select: { stampId: true, stamp: { select: { parentId: true } } },
    });
    const ids = new Set(targetMembers.map((member) => member.stampId));
    const topLevel = targetMembers.filter((member) => !member.stamp.parentId || !ids.has(member.stamp.parentId)).length;
    if (position < 1 || position > topLevel + 1) {
      throw invalidRequest(
        `"position" must be between 1 and ${topLevel + 1}: ${spokenIssue(target)} has ${topLevel} ${topLevel === 1 ? "stamp" : "stamps"} at the top level, and ${topLevel + 1} puts it after the last. Leave it out to put it at the end.`
      );
    }
  }

  await refuseMoveCollisions(context, source.collectionAreaId, source, target, stampIds);

  const moved = await moveStampNode(context.ownerId, context.collectionId, source.id, stamp.id, target.id, {
    ...(position !== null ? { position: position - 1 } : {}),
    moveChecklistPlaces: true,
  });

  const ranges =
    optionalBoolean(params, "update_ranges") === true
      ? [
          ...(await updateRanges(context, source.id, source.collectionAreaId)).map((row) => ({ issueId: source.id, ...row })),
          ...(await updateRanges(context, target.id, target.collectionAreaId)).map((row) => ({ issueId: target.id, ...row })),
        ]
      : null;

  const checklistIds = [...moved.checklistsLeft.map((row) => row.checklistId), moved.checklistJoined!.checklistId];
  const [labels, checklistRows, header, finalOrder] = await Promise.all([
    loadStampLabels(context, moved.stampIds),
    prisma.checklist.findMany({ where: { id: { in: checklistIds } }, select: { id: true, name: true } }),
    loadCollectionHeader(context),
    prisma.issueMember.findMany({
      where: { issueId: target.id },
      select: { stampId: true, stamp: { select: { parentId: true } } },
      orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
    }),
  ]);
  const checklistName = new Map(checklistRows.map((row) => [row.id, row.name]));
  const targetIds = new Set(finalOrder.map((member) => member.stampId));
  const roots = finalOrder.filter((member) => !member.stamp.parentId || !targetIds.has(member.stamp.parentId));
  const joined = moved.checklistJoined!;
  return {
    stamp: movedStamp(labels, stamp.id),
    from: treeIssue(source),
    to: treeIssue(target),
    stampsMoved: moved.stampIds.map((id) => movedStamp(labels, id)),
    position: roots.findIndex((member) => member.stampId === stamp.id) + 1,
    checklists: {
      left: moved.checklistsLeft.map((row) => ({
        checklistId: row.checklistId,
        name: checklistName.get(row.checklistId) ?? "",
        stamps: row.stampIds.map((id) => movedStamp(labels, id).stampNo),
      })),
      joined: {
        checklistId: joined.checklistId,
        name: checklistName.get(joined.checklistId) ?? "",
        created: joined.created,
        stamps: joined.stampIds.map((id) => movedStamp(labels, id).stampNo),
      },
    },
    ranges,
    path: collectionPath(header, `/stamps/${stamp.id}`),
  };
}

export const moveStampToIssueOperation: Operation = {
  name: "move_stamp_to_issue",
  method: "POST",
  path: "/stamps/{stamp_id}/issue",
  description:
    "Move a stamp, with its variants, to another issue of the same area — the collector's own *Move to another issue…*, for a stamp filed under the wrong issue or one the catalogue prints as a series of its own. It leaves the source issue's checklists and joins the target's standard checklist (created from the issue's name when it has none); a variant joins it too only if it was on a standard checklist of the source. Its catalogue numbers, prices, copies, Colnect ID, size and photos stay as they are. It lands at the end of the target's top-level stamps, or at `position`. A stamp whose number would read, under the target's own catalogue prefix, as one another stamp already has is refused with both named. A variant is moved with its base stamp, never on its own; an issue of another area is refused. Two issues are never merged here, and an issue with stamps is never deleted.",
  writes: true,
  parameters: [
    {
      name: "stamp_id",
      in: "path",
      type: "string",
      required: true,
      description: "The stamp to move — its id, its short number (`st 123`) or a catalogue number naming one stamp (`Mi 240`).",
    },
    {
      name: "issue_id",
      in: "body",
      type: "string",
      required: true,
      description: "The issue it moves to, by id — `list_issues` lists an area's issues. It must be in the same area as the issue it leaves.",
    },
    {
      name: "from_issue_id",
      in: "body",
      type: "string",
      required: false,
      description: "The issue it leaves. Needed only when the stamp is filed under more than one.",
    },
    {
      name: "position",
      in: "body",
      type: "integer",
      required: false,
      description: "Where it stands among the target issue's top-level stamps, counting from 1 in the order `get_issue` lists them. Left out, it goes at the end.",
    },
    {
      name: "update_ranges",
      in: "body",
      type: "boolean",
      required: false,
      description: "`true` recomputes both issues' declared catalogue ranges from their stamps afterwards — the span of each issue's standard-checklist stamps, as the catalogue-number grid keeps it. An issue left with no checklist stamp keeps the ranges it declares.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`stamp`, the stamp moved; `from` and `to`, the issues it left and joined; `stampsMoved`, the stamp and its variants; `position`, where it now stands among the target's top-level stamps; `checklists.left`, each source checklist the moved stamps left with their short numbers, and `checklists.joined`, the target checklist they joined, `created` when the move made it; `ranges`, null unless `update_ranges` was sent, else each catalogue whose declared range changed in either issue, `before` and `after`; and the stamp's `path` in the app.",
  },
  handler: async (context, params) => moveStampToIssueFromParams(context, params),
};

// ── Deleting an empty issue ────────────────────────────────────────────────

export async function deleteIssueFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  deleted: AgentTreeIssue & { area: string };
  removedWithIt: { checklists: string[]; catalogueRanges: number; ownPrefixes: number; translations: number; tags: number };
}> {
  const issueId = requiredString(params, "issue_id");
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId: context.collectionId },
    select: {
      id: true,
      issueNo: true,
      name: true,
      year: true,
      collectionArea: { select: { name: true } },
      members: { select: { stampId: true, stamp: { select: { parentId: true } } } },
      checklists: {
        select: { name: true, albumEntries: { select: { album: { select: { name: true } } } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { catalogNumbers: true, catalogPrefixes: true, translations: true, tags: true } },
    },
  });
  if (!issue) {
    throw notFound(
      `No issue with id "${issueId}" is in this token's collection. Use \`list_issues\` or \`search_collection\` to find the right id.`
    );
  }
  const spoken = spokenIssue(issue);
  if (issue.members.length > 0) {
    const ids = new Set(issue.members.map((member) => member.stampId));
    const topLevel = issue.members.filter((member) => !member.stamp.parentId || !ids.has(member.stamp.parentId)).length;
    throw invalidRequest(issueHasStampsMessage(spoken, issue.members.length, topLevel));
  }
  const printed = issue.checklists
    .filter((checklist) => checklist.albumEntries.length > 0)
    .map((checklist) => ({ checklist: checklist.name, albums: checklist.albumEntries.map((entry) => entry.album.name) }));
  if (printed.length > 0) throw invalidRequest(issueChecklistsInAlbumsMessage(spoken, printed));

  try {
    await deleteIssue(context.ownerId, context.collectionId, issue.id, { onlyIfEmpty: true });
  } catch (error) {
    // A stamp added between the check above and the write: refused there, inside the transaction.
    if (error instanceof Error && error.message === "The issue has stamps.") {
      throw invalidRequest(`${spoken} gained a stamp while it was being deleted, and is not deleted. Nothing was changed.`);
    }
    throw error;
  }
  return {
    deleted: { ...treeIssue(issue), area: issue.collectionArea.name },
    removedWithIt: {
      checklists: issue.checklists.map((checklist) => checklist.name),
      catalogueRanges: issue._count.catalogNumbers,
      ownPrefixes: issue._count.catalogPrefixes,
      translations: issue._count.translations,
      tags: issue._count.tags,
    },
  };
}

export const deleteIssueOperation: Operation = {
  name: "delete_issue",
  method: "DELETE",
  path: "/issues/{issue_id}",
  description:
    "Delete an issue that has no stamps — one created with `generate_stamps: false` and never filled, or emptied with `move_stamp_to_issue`. Its empty checklists, declared catalogue ranges, own prefixes, translated names and tags go with it. An issue with any stamp is refused, saying how many; so is one whose checklist an album prints, with the albums named. An issue with stamps is never deleted here, and two issues are never merged.",
  writes: true,
  parameters: [
    {
      name: "issue_id",
      in: "path",
      type: "string",
      required: true,
      description: "The issue's id, as `list_issues`, `search_collection` or `get_stamp` reports it.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`deleted`, the issue as it was — its id, short number, name, year and `area` — and `removedWithIt`: the names of the `checklists` that went with it, and how many declared `catalogueRanges`, `ownPrefixes`, `translations` and `tags`.",
  },
  handler: async (context, params) => deleteIssueFromParams(context, params),
};
