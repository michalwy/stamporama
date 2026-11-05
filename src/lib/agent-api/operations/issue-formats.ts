import "server-only";
import { prisma } from "../../db";
import {
  createStampIssueFormat,
  reorderStampIssueFormats,
  updateStampIssueFormat,
} from "../../stamp-issue-formats";
import { isTagColor, type TagColor } from "../../tag-colors";
import { invalidRequest } from "../errors";
import { ISSUE_FORMAT_COLORS, assertIssueFormatWordsFree } from "../issue-formats";
import { optionalString, requiredString, stringList } from "../params";
import { resolveVocabularyValue, type IssueFormatVocabularyEntry } from "../vocabulary";
import type { Operation, OperationContext, ParsedParams } from "../types";

// The issue-format dictionary through the agent API (#2445): add an issue format, correct its name,
// abbreviation and chip colour, and set the collector's order — what *Settings → Issue formats* does,
// short of deleting one. Translated names and abbreviations are `set_translations`' (#1452), which
// has read the issue formats since #2439.
//
// **Every write is the panel's own** — `createStampIssueFormat`, `updateStampIssueFormat` and
// `reorderStampIssueFormats` — on the panel's rules: a name and an abbreviation are required, a
// colour is one of the palette's hues or none, a new issue format goes at the end of the order. What
// this module adds is what an agent needs and the panel leaves to the eye: **a name or an
// abbreviation another issue format already answers to is refused**, as `create_subtype` refuses a
// name, so every issue format stays one `update_stamp` and the filters can name unambiguously.
//
// **Nothing is deleted** (#1438's rule for every catalogue write): `deleteStampIssueFormat` stays in
// Settings, and `tests/unit/agent-api-operation-boundary.test.ts` keeps it out of every operation
// module.

interface IssueFormatRow {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly color: string | null;
}

/** The collection's issue formats in the collector's order — what the resolver names them by. */
export async function loadIssueFormatEntries(context: OperationContext): Promise<IssueFormatRow[]> {
  return prisma.stampIssueFormat.findMany({
    where: { collectionId: context.collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, abbreviation: true, color: true },
  });
}

/** An issue format as `issueFormats` in `get_collection_vocabulary` gives it, less the translated
 *  label, and with how many stamps carry it. */
function issueFormatAnswer(row: IssueFormatRow, stampCount: number): IssueFormatVocabularyEntry & { stampCount: number } {
  return {
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    ...(isTagColor(row.color) ? { color: row.color } : {}),
    stampCount,
  };
}

async function answerFor(context: OperationContext, issueFormatId: string) {
  const row = await prisma.stampIssueFormat.findFirstOrThrow({
    where: { id: issueFormatId, collectionId: context.collectionId },
    select: { id: true, name: true, abbreviation: true, color: true, _count: { select: { stamps: true } } },
  });
  return issueFormatAnswer(row, row._count.stamps);
}

function colorParam(params: ParsedParams): TagColor | null {
  const color = optionalString(params, "color");
  // The parameter's closed `values` refused anything else before the handler ran.
  return color !== null && isTagColor(color) ? color : null;
}

const COLOR_DESCRIPTION = `The chip's colour, one of the palette's hues: ${ISSUE_FORMAT_COLORS.join(", ")}. Left out, the chip is neutral.`;

// ── create_issue_format ──────────────────────────────────────────────────────

export async function addIssueFormat(context: OperationContext, params: ParsedParams) {
  const name = requiredString(params, "name");
  const abbreviation = requiredString(params, "abbreviation");
  assertIssueFormatWordsFree(await loadIssueFormatEntries(context), { name, abbreviation });
  const id = await createStampIssueFormat(context.ownerId, context.collectionId, {
    name,
    abbreviation,
    color: colorParam(params),
  });
  return answerFor(context, id);
}

export const createIssueFormatOperation: Operation = {
  name: "create_issue_format",
  method: "POST",
  path: "/issue-formats",
  description:
    "Add an issue format — a form stamps are issued in, such as a souvenir sheet, a booklet pane or a coil stamp — as *Settings → Issue formats* adds one: at the end of the collector's order. It can be set on stamps at once with `update_stamp` and `update_stamps`. A name or an abbreviation another issue format already answers to, whatever its case, is refused with that issue format, and so is `none`, which this API keeps for an ordinary stamp. Check `issueFormats` in `get_collection_vocabulary` first. Its names in other languages are `set_translations`'.",
  writes: true,
  parameters: [
    { name: "name", in: "body", type: "string", required: true, description: "The issue format's name in the collection's own language — `Souvenir sheet`, `Booklet pane`." },
    { name: "abbreviation", in: "body", type: "string", required: true, description: "Its abbreviation, as a chip and a listing text show it — `Bl`, `HBl`." },
    { name: "color", in: "body", type: "string", required: false, description: COLOR_DESCRIPTION, values: ISSUE_FORMAT_COLORS },
  ],
  result: {
    kind: "object",
    description:
      "The new issue format as `issueFormats` in `get_collection_vocabulary` gives it — `id`, `name`, `abbreviation`, `color` where it has one — and `stampCount`, 0.",
  },
  handler: async (context, params) => addIssueFormat(context, params),
};

// ── update_issue_format ──────────────────────────────────────────────────────

const ISSUE_FORMAT_ID_PARAMETER = {
  name: "issue_format_id",
  in: "path",
  type: "string",
  required: true,
  description: "The issue format, by its id from `issueFormats` in `get_collection_vocabulary`, or by its current name or abbreviation.",
} as const;

export async function editIssueFormat(context: OperationContext, params: ParsedParams) {
  const formats = await loadIssueFormatEntries(context);
  const issueFormatId = resolveVocabularyValue(requiredString(params, "issue_format_id"), formats, {
    vocabulary: "issue format",
    parameter: "issue_format_id",
  });
  const current = formats.find((row) => row.id === issueFormatId)!;
  const name = optionalString(params, "name");
  const abbreviation = optionalString(params, "abbreviation");
  const color = optionalString(params, "color");
  const clear = new Set(stringList(params, "clear"));
  if (color !== null && clear.has("color")) {
    throw invalidRequest('"color" is both sent and in "clear". Send one of them.');
  }
  if (name === null && abbreviation === null && color === null && clear.size === 0) {
    throw invalidRequest('Nothing to change: send "name", "abbreviation", "color", or "clear": ["color"].');
  }
  assertIssueFormatWordsFree(
    formats,
    { ...(name !== null ? { name } : {}), ...(abbreviation !== null ? { abbreviation } : {}) },
    issueFormatId
  );
  // The panel's write sets all three fields, so each one not sent is handed back as it is; the
  // translations are left alone — `updateStampIssueFormat` rewrites only the languages it is handed.
  await updateStampIssueFormat(context.ownerId, issueFormatId, {
    name: name ?? current.name,
    abbreviation: abbreviation ?? current.abbreviation,
    color: clear.has("color") ? null : color !== null ? colorParam(params) : isTagColor(current.color) ? current.color : null,
  });
  return answerFor(context, issueFormatId);
}

export const updateIssueFormatOperation: Operation = {
  name: "update_issue_format",
  method: "PATCH",
  path: "/issue-formats/{issue_format_id}",
  description:
    "Correct an issue format's name, abbreviation or chip colour, as *Settings → Issue formats* does — only what is sent changes. Every stamp of it keeps it and reads under the new words. A name or an abbreviation another issue format already answers to, whatever its case, is refused with that issue format. Its names in other languages are `set_translations`'; `set_issue_format_order` orders them; nothing here deletes one — that stays with the collector, in Settings.",
  writes: true,
  parameters: [
    ISSUE_FORMAT_ID_PARAMETER,
    { name: "name", in: "body", type: "string", required: false, description: "The corrected name in the collection's own language." },
    { name: "abbreviation", in: "body", type: "string", required: false, description: "The corrected abbreviation." },
    { name: "color", in: "body", type: "string", required: false, description: "The chip's colour, one of the palette's hues.", values: ISSUE_FORMAT_COLORS },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "`[\"color\"]` makes the chip neutral.",
      values: ["color"],
    },
  ],
  result: {
    kind: "object",
    description: "The issue format as it now stands, in the shape `issueFormats` in `get_collection_vocabulary` gives it, with `stampCount`, how many stamps carry it.",
  },
  handler: async (context, params) => editIssueFormat(context, params),
};

// ── set_issue_format_order ───────────────────────────────────────────────────

export async function setIssueFormatOrder(context: OperationContext, params: ParsedParams) {
  const formats = await loadIssueFormatEntries(context);
  const refs = stringList(params, "issue_formats");
  if (refs.length === 0) throw invalidRequest('"issue_formats" must name at least one issue format, by name, abbreviation or id.');
  const named: string[] = [];
  for (const ref of refs) {
    const id = resolveVocabularyValue(ref, formats, { vocabulary: "issue format", parameter: "issue_formats" });
    if (!named.includes(id)) named.push(id);
  }
  const placing = new Set(named);
  // As `set_area_order`: those sent lead, in the order sent, and the rest follow in their own order.
  const ordered = [...named, ...formats.filter((row) => !placing.has(row.id)).map((row) => row.id)];
  await reorderStampIssueFormats(context.ownerId, context.collectionId, ordered);
  const after = await loadIssueFormatEntries(context);
  return {
    issueFormats: after.map((row, i) => ({ id: row.id, name: row.name, position: i + 1 })),
    placed: named.length,
    keptAfter: after.length - named.length,
  };
}

export const setIssueFormatOrderOperation: Operation = {
  name: "set_issue_format_order",
  method: "POST",
  path: "/issue-formats/order",
  description:
    "Set the collector's order of the issue formats — the order Settings, the stamp form's select, the filters and `get_collection_vocabulary` read. The issue formats sent come first, in the order sent, and any not sent follow them, keeping their order. Send every one to set the whole order.",
  writes: true,
  parameters: [
    { name: "issue_formats", in: "body", type: "string[]", required: true, description: "The issue formats in the order they should read, by name, abbreviation or id." },
  ],
  result: {
    kind: "object",
    description: "`issueFormats` — every issue format in its new order, each with `id`, `name` and `position` (1 first) — `placed`, how many now lead it as sent, and `keptAfter`.",
  },
  handler: async (context, params) => setIssueFormatOrder(context, params),
};
