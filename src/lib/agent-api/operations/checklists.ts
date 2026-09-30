import "server-only";
import { prisma } from "../../db";
import {
  addStampsToIssueChecklist,
  addStampsToSpanningChecklist,
  CHECKLIST_STAMP_ORDER,
  createChecklist,
  deleteChecklist,
  getChecklistUsage,
  renameChecklist,
  reorderChecklistStamps,
  setChecklistStamps,
} from "../../checklists";
import { translationsByLanguage } from "../../translations";
import {
  agentChecklist,
  checklistInUse,
  compareChecklistOrder,
  stampsNotOnIssue,
  unfoundStamp,
  type AgentChecklist,
  type AgentChecklistStamp,
  type AgentNamedStamp,
  type AgentUnfoundStamp,
} from "../checklist-reads";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { resolveCatalogStrings } from "./catalog";
import { CLEAR_NAMES_PARAMETER, NAMES_PARAMETER, translationWrites } from "./catalog-edits";
import { collectionPath, loadCollectionHeader, type CollectionHeader } from "./reads-shared";
import { loadStampLabels, resolveStampRefs } from "./stamp-refs";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Checklists through the agent API (#1512): list and read them, create one on an issue or spanning
// several (#1416), rename it and set its translations, add stamps, remove stamps, set their order
// (#764), and delete one nothing prints.
//
// **Every write is the app's own**, and the screens' rules hold unchanged: `createChecklist`,
// `renameChecklist`, `setChecklistStamps`, `reorderChecklistStamps` and `deleteChecklist` are the
// editors' writes; an add goes through `addStampsToSpanningChecklist` or, on an issue's own checklist,
// `addStampsToIssueChecklist`, which admits only that issue's stamps as its editor does. A checklist
// printed on an album card changes as it would from the screen: the card reports the difference
// (#778) at read time, and nothing is reprinted.
//
// **This lifts #1438's catalogue boundary for checklists only, and for exactly these operations.**
// `reorderChecklists` (the order of an issue's checklists) stays out, and so does every other
// catalogue delete, move and reorder — `tests/unit/agent-api-operation-boundary.test.ts`.
//
// **Removing and ordering are idempotent** and name the entries they could not place, rather than
// refusing a batch over one stamp. Adding is not: a stamp the call cannot name, or one an issue's
// checklist may not hold, refuses the whole call, because an add is a statement about what the set
// contains.

const CHECKLIST_ID_PARAMETER: ParameterSpec = {
  name: "checklist_id",
  in: "path",
  type: "string",
  required: true,
  description: "The checklist's id, from `list_checklists` or `get_issue`.",
};

// ── Reading ────────────────────────────────────────────────────────────────

interface LoadedChecklist {
  readonly id: string;
  readonly name: string;
  readonly issueId: string | null;
  readonly issue: { readonly id: string; readonly name: string | null; readonly year: number | null } | null;
}

async function loadChecklist(context: OperationContext, checklistId: string): Promise<LoadedChecklist> {
  const row = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId: context.collectionId },
    select: { id: true, name: true, issueId: true, issue: { select: { id: true, name: true, year: true } } },
  });
  if (!row) {
    throw notFound(
      `No checklist with id "${checklistId}" is in this token's collection. Use \`list_checklists\` to find the right id.`
    );
  }
  return row;
}

function checklistPath(header: CollectionHeader, issueId: string | null): string {
  return collectionPath(header, issueId ? `/issues/${issueId}` : "/checklists");
}

/** The checklists named, stated in full and in the order given. */
async function describeChecklists(context: OperationContext, ids: readonly string[]): Promise<AgentChecklist[]> {
  if (ids.length === 0) return [];
  const [header, rows, entries] = await Promise.all([
    loadCollectionHeader(context),
    prisma.checklist.findMany({
      where: { id: { in: [...ids] }, collectionId: context.collectionId },
      select: {
        id: true,
        name: true,
        issueId: true,
        issue: { select: { id: true, name: true, year: true } },
        translations: { select: { language: true, name: true } },
        _count: { select: { stamps: true } },
      },
    }),
    prisma.albumEntry.findMany({
      where: { checklistId: { in: [...ids] } },
      select: { checklistId: true, album: { select: { name: true } } },
      orderBy: { album: { name: "asc" } },
    }),
  ]);

  // The issues a checklist spanning issues reaches: every issue one of its stamps is filed under,
  // `listSpanningChecklists`' reading, ordered as the Issues list reads.
  const spanning = rows.filter((row) => row.issueId === null).map((row) => row.id);
  const covered = new Map<string, Map<string, { id: string; name: string | null; year: number | null; issueNo: number }>>();
  if (spanning.length > 0) {
    const onThem = await prisma.checklistStamp.findMany({
      where: { checklistId: { in: spanning } },
      select: {
        checklistId: true,
        stamp: {
          select: {
            issueMemberships: {
              where: { issue: { collectionId: context.collectionId } },
              select: { issue: { select: { id: true, name: true, year: true, issueNo: true } } },
            },
          },
        },
      },
    });
    for (const row of onThem) {
      const issues = covered.get(row.checklistId) ?? new Map();
      for (const { issue } of row.stamp.issueMemberships) issues.set(issue.id, issue);
      covered.set(row.checklistId, issues);
    }
  }

  const albums = new Map<string, string[]>();
  for (const entry of entries) albums.set(entry.checklistId, [...(albums.get(entry.checklistId) ?? []), entry.album.name]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const coversIssues = [...(covered.get(id)?.values() ?? [])].sort(
      (a, b) =>
        (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) || a.issueNo - b.issueNo
    );
    return [
      agentChecklist(
        {
          id: row.id,
          name: row.name,
          nameByLanguage: translationsByLanguage(row.translations, (t) => t.name),
          issue: row.issue,
          coversIssues,
          stampCount: row._count.stamps,
          albums: albums.get(id) ?? [],
        },
        checklistPath(header, row.issueId)
      ),
    ];
  });
}

async function describeChecklist(context: OperationContext, checklistId: string): Promise<AgentChecklist> {
  const [described] = await describeChecklists(context, [checklistId]);
  return described;
}

export async function listChecklistsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentChecklist>> {
  const window = parseListWindow(params);
  const issueId = optionalString(params, "issue_id");
  const spanning = optionalBoolean(params, "spanning");
  const name = optionalString(params, "name");
  if (issueId !== null && spanning === true) {
    throw invalidRequest('"issue_id" asks for one issue\'s own checklists and "spanning": true for those spanning issues. Send one or the other.');
  }
  if (issueId !== null) {
    const issue = await prisma.issue.findFirst({ where: { id: issueId, collectionId: context.collectionId }, select: { id: true } });
    if (!issue) {
      throw notFound(`No issue with id "${issueId}" is in this token's collection. Use \`search_collection\` to find the right id.`);
    }
  }
  const keys = await prisma.checklist.findMany({
    where: {
      collectionId: context.collectionId,
      ...(issueId !== null ? { issueId } : spanning === true ? { issueId: null } : spanning === false ? { issueId: { not: null } } : {}),
      ...(name !== null ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, sortOrder: true, createdAt: true, issue: { select: { id: true, year: true, issueNo: true } } },
  });
  keys.sort(compareChecklistOrder);
  const page = keys.slice(window.offset, window.offset + window.limit).map((key) => key.id);
  return listResponse(await describeChecklists(context, page), keys.length, window);
}

export const listChecklistsOperation: Operation = {
  name: "list_checklists",
  method: "GET",
  path: "/checklists",
  description:
    "The collection's checklists — each a named set of stamps that counts as one complete unit — with the issue each belongs to, or, for one spanning issues, every issue its stamps come from. The ones spanning issues come first, then each issue's own in the order the Issues list reads. A row is the whole checklist but its stamps; `list_checklist_stamps` reads those in order, and `find_checklist_gaps` what is missing.",
  writes: false,
  parameters: [
    {
      name: "issue_id",
      in: "query",
      type: "string",
      required: false,
      description: "Only this issue's own checklists, by the issue's id from `search_collection` or `get_stamp`.",
    },
    {
      name: "spanning",
      in: "query",
      type: "boolean",
      required: false,
      description: "true for only the checklists spanning issues, false for only those belonging to one issue.",
    },
    { name: "name", in: "query", type: "string", required: false, description: "Only checklists whose name contains this text, ignoring case." },
  ],
  result: {
    kind: "list",
    description:
      "Checklists: `checklistId`, `name`, `translatedNames` by language, `spansIssues`, its own `issue` or the `coversIssues` a spanning one reaches, `stampCount`, and the `albums` printing it — a checklist an album prints cannot be deleted here.",
  },
  handler: async (context, params) => listChecklistsFromParams(context, params),
};

export async function listChecklistStampsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentChecklistStamp> & { checklist: AgentChecklist }> {
  const window = parseListWindow(params);
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const [total, rows] = await Promise.all([
    prisma.checklistStamp.count({ where: { checklistId: checklist.id } }),
    prisma.checklistStamp.findMany({
      where: { checklistId: checklist.id },
      orderBy: [...CHECKLIST_STAMP_ORDER],
      skip: window.offset,
      take: window.limit,
      select: { stampId: true },
    }),
  ]);
  const labels = await loadStampLabels(context, rows.map((row) => row.stampId));
  const items = rows.map((row, i) => {
    const label = labels.get(row.stampId);
    const stamp: AgentChecklistStamp = {
      position: window.offset + i + 1,
      stampId: row.stampId,
      catalogNumbers: label?.catalogNumbers ?? [],
      ...(label?.name ? { name: label.name } : {}),
    };
    return stamp;
  });
  return { checklist: await describeChecklist(context, checklist.id), ...listResponse(items, total, window) };
}

export const listChecklistStampsOperation: Operation = {
  name: "list_checklist_stamps",
  method: "GET",
  path: "/checklists/{checklist_id}/stamps",
  description:
    "A checklist's stamps in the order the set reads — the collector's own order, which an album page prints as a row. Read this before changing a checklist's stamps or their order.",
  writes: false,
  parameters: [
    CHECKLIST_ID_PARAMETER,
  ],
  result: {
    kind: "list",
    description:
      "`checklist`, the checklist as `list_checklists` states it, and its stamps: `position` (1 is first), `stampId`, `catalogNumbers` and `name`.",
  },
  handler: async (context, params) => listChecklistStampsFromParams(context, params),
};

// ── Creating and renaming ──────────────────────────────────────────────────

/** Other checklists beside it with the same name. Advisory, as in the collector's form: two with
 *  one name are indistinguishable wherever they are listed, and the collector may have a reason. */
async function namesakes(context: OperationContext, checklist: { id: string; name: string; issueId: string | null }) {
  const siblings = await prisma.checklist.findMany({
    where: { collectionId: context.collectionId, issueId: checklist.issueId, id: { not: checklist.id } },
    select: { id: true, name: true },
  });
  const folded = checklist.name.trim().toLowerCase();
  return siblings.filter((sibling) => sibling.name.trim().toLowerCase() === folded).map((sibling) => sibling.id);
}

type WithNamesakes = AgentChecklist & { sameNameAs?: string[] };

async function withNamesakes(context: OperationContext, checklistId: string): Promise<WithNamesakes> {
  const checklist = await loadChecklist(context, checklistId);
  const [described, same] = await Promise.all([describeChecklist(context, checklistId), namesakes(context, checklist)]);
  return same.length > 0 ? { ...described, sameNameAs: same } : described;
}

export async function createChecklistFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<WithNamesakes> {
  const issueId = optionalString(params, "issue_id");
  if (issueId !== null) {
    const issue = await prisma.issue.findFirst({ where: { id: issueId, collectionId: context.collectionId }, select: { id: true } });
    if (!issue) {
      throw notFound(`No issue with id "${issueId}" is in this token's collection. Use \`search_collection\` to find the right id.`);
    }
  }
  const translations = await translationWrites(context, params);
  const checklistId = await createChecklist(context.ownerId, context.collectionId, {
    issueId,
    name: requiredString(params, "name"),
    translations,
  });
  return withNamesakes(context, checklistId);
}

const SAME_NAME_RESULT =
  "`sameNameAs` lists the ids of other checklists beside it — the issue's, or the other spanning ones — already called the same; the name is kept, as the collector's form keeps it, and says so only.";

export const createChecklistOperation: Operation = {
  name: "create_checklist",
  method: "POST",
  path: "/checklists",
  description:
    "Create an empty checklist — a named set of stamps counted as one complete unit — on one issue, or, without `issue_id`, one spanning issues (a thematic set, all Grosik 1928–1932). An issue's own checklist can hold only that issue's stamps; a spanning one any stamp. Then put stamps on it with `add_checklist_stamps`.",
  writes: true,
  parameters: [
    { name: "name", in: "body", type: "string", required: true, description: "The checklist's name in the collection's own language — `Basic set`, `Imperforate`." },
    NAMES_PARAMETER,
    {
      name: "issue_id",
      in: "body",
      type: "string",
      required: false,
      description: "The issue it belongs to, by id from `search_collection` or `get_stamp`. Leave it out for a checklist spanning issues.",
    },
  ],
  result: { kind: "object", description: `The checklist as \`list_checklists\` states it. ${SAME_NAME_RESULT}` },
  handler: async (context, params) => createChecklistFromParams(context, params),
};

export async function updateChecklistFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<WithNamesakes> {
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const name = optionalString(params, "name");
  const translations = await translationWrites(context, params);
  if (name === null && !translations) {
    throw invalidRequest('Nothing to change: send "name", "names" or "clear_names".');
  }
  // `renameChecklist` writes the name whatever it is handed, so an unchanged one is restated.
  await renameChecklist(context.ownerId, checklist.id, name ?? checklist.name, translations);
  return withNamesakes(context, checklist.id);
}

export const updateChecklistOperation: Operation = {
  name: "update_checklist",
  method: "PATCH",
  path: "/checklists/{checklist_id}",
  description:
    "Rename a checklist or set its names in other languages — only what is sent changes. A checklist still called what its issue is called prints the issue's translations until it has its own; renaming it ends that. Its stamps are changed with `add_checklist_stamps`, `remove_checklist_stamps` and `set_checklist_order`.",
  writes: true,
  parameters: [
    CHECKLIST_ID_PARAMETER,
    { name: "name", in: "body", type: "string", required: false, description: "The new name in the collection's own language." },
    NAMES_PARAMETER,
    CLEAR_NAMES_PARAMETER,
  ],
  result: { kind: "object", description: `The checklist as \`list_checklists\` now states it. ${SAME_NAME_RESULT}` },
  handler: async (context, params) => updateChecklistFromParams(context, params),
};

// ── Its stamps ─────────────────────────────────────────────────────────────

async function checklistStampIds(checklistId: string): Promise<string[]> {
  const rows = await prisma.checklistStamp.findMany({
    where: { checklistId },
    orderBy: [...CHECKLIST_STAMP_ORDER],
    select: { stampId: true },
  });
  return rows.map((row) => row.stampId);
}

async function namedStamps(context: OperationContext, stampIds: readonly string[]): Promise<AgentNamedStamp[]> {
  const labels = await loadStampLabels(context, stampIds);
  return stampIds.map((stampId) => ({ stampId, catalogNumbers: labels.get(stampId)?.catalogNumbers ?? [] }));
}

const STAMPS_PARAMETER_TAIL =
  "each a stamp id or a catalogue number naming only one stamp, such as `Mi 123a` — `resolve_catalog_numbers` shows what a number reaches.";

export async function addChecklistStampsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ checklist: AgentChecklist; added: AgentNamedStamp[]; alreadyOn: AgentNamedStamp[] }> {
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const stampIds = await resolveStampRefs(context, stringList(params, "stamps"), "stamps");
  if (checklist.issueId !== null) {
    const members = new Set(
      (
        await prisma.issueMember.findMany({
          where: { issueId: checklist.issueId, stampId: { in: stampIds } },
          select: { stampId: true },
        })
      ).map((member) => member.stampId)
    );
    const outside = stampIds.filter((id) => !members.has(id));
    if (outside.length > 0) {
      throw stampsNotOnIssue(checklist.name, checklist.issue?.name ?? null, await namedStamps(context, outside));
    }
  }
  const before = new Set(await checklistStampIds(checklist.id));
  if (checklist.issueId === null) {
    await addStampsToSpanningChecklist(context.ownerId, checklist.id, stampIds);
  } else {
    await addStampsToIssueChecklist(context.ownerId, checklist.id, stampIds);
  }
  const named = await namedStamps(context, stampIds);
  return {
    checklist: await describeChecklist(context, checklist.id),
    added: named.filter((stamp) => !before.has(stamp.stampId)),
    alreadyOn: named.filter((stamp) => before.has(stamp.stampId)),
  };
}

export const addChecklistStampsOperation: Operation = {
  name: "add_checklist_stamps",
  method: "POST",
  path: "/checklists/{checklist_id}/stamps",
  description:
    "Put stamps on a checklist. They join at the end of its order, in the order sent; one already on it stays where it is. An issue's own checklist holds only stamps filed under that issue, and any other is refused — use a checklist spanning issues for a set across several. A stamp that names nothing, or more than one stamp, refuses the whole call.",
  writes: true,
  parameters: [
    CHECKLIST_ID_PARAMETER,
    { name: "stamps", in: "body", type: "string[]", required: true, description: `The stamps to add, ${STAMPS_PARAMETER_TAIL}` },
  ],
  result: {
    kind: "object",
    description: "`checklist` as `list_checklists` now states it, `added` — the stamps put on it — and `alreadyOn`, those it already held.",
  },
  handler: async (context, params) => addChecklistStampsFromParams(context, params),
};

/**
 * The stamps `refs` name, leniently: an entry that names no single stamp is reported rather than
 * refusing the call, which is what makes a remove or an order idempotent over a stale list.
 */
async function resolveLeniently(
  context: OperationContext,
  refs: readonly string[],
  parameter: string
): Promise<{ stampIds: string[]; notFound: AgentUnfoundStamp[] }> {
  const wanted = [...new Set(refs.map((ref) => ref.trim()).filter((ref) => ref !== ""))];
  if (wanted.length === 0) {
    throw invalidRequest(`"${parameter}" must name at least one stamp — ${STAMPS_PARAMETER_TAIL}`);
  }
  const byId = new Set(
    (
      await prisma.stamp.findMany({
        where: { id: { in: wanted }, collectionId: context.collectionId },
        select: { id: true },
      })
    ).map((stamp) => stamp.id)
  );
  const numbers = wanted.filter((ref) => !byId.has(ref));
  const resolutions = new Map(
    (await resolveCatalogStrings(context, numbers)).map((resolution, i) => [numbers[i], resolution])
  );
  const stampIds: string[] = [];
  const unfound: AgentUnfoundStamp[] = [];
  for (const ref of wanted) {
    if (byId.has(ref)) {
      stampIds.push(ref);
      continue;
    }
    const resolution = resolutions.get(ref)!;
    if (resolution.verdict === "resolved") stampIds.push(resolution.stamps[0].stampId);
    else unfound.push(unfoundStamp(resolution));
  }
  return { stampIds: [...new Set(stampIds)], notFound: unfound };
}

export async function removeChecklistStampsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  checklist: AgentChecklist;
  removed: AgentNamedStamp[];
  notOnChecklist: AgentNamedStamp[];
  notFound: AgentUnfoundStamp[];
}> {
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const { stampIds, notFound: unfound } = await resolveLeniently(context, stringList(params, "stamps"), "stamps");
  const current = await checklistStampIds(checklist.id);
  const on = new Set(current);
  const removing = new Set(stampIds.filter((id) => on.has(id)));
  if (removing.size > 0) {
    // The editor's own write: the set as it should be, the survivors keeping their order.
    await setChecklistStamps(context.ownerId, checklist.id, current.filter((id) => !removing.has(id)));
  }
  const named = await namedStamps(context, stampIds);
  return {
    checklist: await describeChecklist(context, checklist.id),
    removed: named.filter((stamp) => removing.has(stamp.stampId)),
    notOnChecklist: named.filter((stamp) => !on.has(stamp.stampId)),
    notFound: unfound,
  };
}

export const removeChecklistStampsOperation: Operation = {
  name: "remove_checklist_stamps",
  method: "POST",
  path: "/checklists/{checklist_id}/stamps/remove",
  description:
    "Take stamps off a checklist. The stamps stay in the catalogue and in their issue; only the set stops counting them. The rest keep their order. Idempotent: a stamp not on the checklist, or an entry naming no single stamp, is reported and the others are still removed.",
  writes: true,
  parameters: [
    CHECKLIST_ID_PARAMETER,
    { name: "stamps", in: "body", type: "string[]", required: true, description: `The stamps to take off, ${STAMPS_PARAMETER_TAIL}` },
  ],
  result: {
    kind: "object",
    description:
      "`checklist` as `list_checklists` now states it, `removed`, `notOnChecklist` — stamps named that it did not hold — and `notFound`, each entry that named no single stamp with the reason.",
  },
  handler: async (context, params) => removeChecklistStampsFromParams(context, params),
};

export async function setChecklistOrderFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  checklist: AgentChecklist;
  placed: number;
  keptAfter: number;
  notOnChecklist: AgentNamedStamp[];
  notFound: AgentUnfoundStamp[];
}> {
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const { stampIds, notFound: unfound } = await resolveLeniently(context, stringList(params, "stamps"), "stamps");
  const current = await checklistStampIds(checklist.id);
  const on = new Set(current);
  const placing = stampIds.filter((id) => on.has(id));
  if (placing.length > 0) await reorderChecklistStamps(context.ownerId, checklist.id, placing);
  return {
    checklist: await describeChecklist(context, checklist.id),
    placed: placing.length,
    keptAfter: current.length - placing.length,
    notOnChecklist: await namedStamps(context, stampIds.filter((id) => !on.has(id))),
    notFound: unfound,
  };
}

export const setChecklistOrderOperation: Operation = {
  name: "set_checklist_order",
  method: "POST",
  path: "/checklists/{checklist_id}/order",
  description:
    "Set the order a checklist's stamps read in — the collector's manual order, which an album page prints as a row. The stamps sent come first, in the order sent; any stamp on it that was not sent follows them, keeping its relative order. Send every stamp to set the whole order. Idempotent: a stamp not on the checklist, or an entry naming no single stamp, is reported and the rest are still placed. Nothing is added or removed.",
  writes: true,
  parameters: [
    CHECKLIST_ID_PARAMETER,
    { name: "stamps", in: "body", type: "string[]", required: true, description: `The stamps in the order they should read, ${STAMPS_PARAMETER_TAIL}` },
  ],
  result: {
    kind: "object",
    description:
      "`checklist` as `list_checklists` now states it, `placed` — how many stamps now lead the order as sent — `keptAfter`, how many were not sent and follow them, `notOnChecklist` and `notFound`. `list_checklist_stamps` reads the order back.",
  },
  handler: async (context, params) => setChecklistOrderFromParams(context, params),
};

// ── Deleting ───────────────────────────────────────────────────────────────

export async function deleteChecklistFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ deleted: { checklistId: string; name: string }; stampsKept: number }> {
  const checklist = await loadChecklist(context, requiredString(params, "checklist_id"));
  const usage = await getChecklistUsage(context.ownerId, checklist.id);
  if (usage.albums.length > 0) throw checklistInUse(checklist.name, usage.albums);
  const stampsKept = await prisma.checklistStamp.count({ where: { checklistId: checklist.id } });
  await deleteChecklist(context.ownerId, checklist.id);
  return { deleted: { checklistId: checklist.id, name: checklist.name }, stampsKept };
}

export const deleteChecklistOperation: Operation = {
  name: "delete_checklist",
  method: "DELETE",
  path: "/checklists/{checklist_id}",
  description:
    "Delete a checklist. Its stamps stay in the catalogue and in their issues; only the set and its completeness figures go. A checklist an album prints is refused with the albums named — `list_checklists` states them — and stays for the collector to take out of the album first.",
  writes: true,
  parameters: [
    CHECKLIST_ID_PARAMETER,
  ],
  result: { kind: "object", description: "`deleted`, the checklist's id and name, and `stampsKept`, how many stamps it held — every one still in the catalogue." },
  handler: async (context, params) => deleteChecklistFromParams(context, params),
};
