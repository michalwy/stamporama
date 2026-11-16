import "server-only";
import { prisma } from "../../db";
import {
  LotCopyRefusedError,
  addLotCopiesByApi,
  correctLotCopyByApi,
  removeLotCopyByApi,
} from "../../lot-copies-api";
import { invalidRequest, notFound } from "../errors";
import { optionalInteger, optionalString, requiredString } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import { resolveAxisValue } from "../catalog-prices";
import { MAX_LOT_COPIES_LISTED, lotCopy, type AgentLotCopy } from "../purchase-reads";
import { COUNTING_CHECKLIST_MEMBER } from "../../issue-format-series";
import { readCollectionVocabulary } from "./vocabulary";
import { loadStampLabels, resolveStampRefMap } from "./stamp-refs";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// The copies of a purchase lot (#2551): an assistant reading an order email says what is in a lot —
// adding the copies, and correcting or removing ones still ordered so it can undo its own mistakes.
//
// It lifts #1390's *no copies* rule for purchase lots and for nothing else. The writes go through
// `lot-copies-api.ts`, which is the narrow door onto the purchase screen's own intake and copy edit:
// it refuses a closed lot, the incoming half of a trade, an order that has arrived (for adding) and a
// copy that is no longer ordered, and it sets the *to review* marker in the same write. The screen's
// own writers (`intakeStamps`, `removeLotItem`, `bulkUpdateLotItems`) stay on the boundary test's
// forbidden map, and so does whatever clears the marker.
//
// Nothing outside the lot moves: no arrival, no closing, no moving copies between lots or purchases,
// and none of a copy's other fields — location, photos, certificate, the *in collection / for sale /
// for trade* flags take the screen's defaults and are the collector's to set when the order arrives.
// The price stays on the lot; a copy carries none of its own until the lot is closed.

/** The purchase lot this call is about, proved to be on a purchase in the token's collection. */
async function assertPurchaseLot(context: OperationContext, lotId: string): Promise<void> {
  const lot = await prisma.purchaseLot.findFirst({
    where: {
      id: lotId,
      purchase: { kind: "purchase", collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    },
    select: { id: true },
  });
  if (!lot) {
    throw notFound(
      `No purchase lot with id "${lotId}" is in this token's collection. \`get_purchase\` lists a purchase's lots with their ids.`
    );
  }
}

/** The lot copy this call is about: a copy of the token's collection on a lot of a purchase. */
async function assertLotCopy(context: OperationContext, copyId: string): Promise<{ lotId: string }> {
  const copy = await prisma.item.findFirst({
    where: {
      id: copyId,
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
      lot: { purchase: { kind: "purchase" } },
    },
    select: { lotId: true },
  });
  if (!copy?.lotId) {
    throw notFound(
      `No copy with id "${copyId}" is on a purchase lot in this token's collection. \`get_purchase\` lists each lot's copies with their ids.`
    );
  }
  return { lotId: copy.lotId };
}

/** Run a domain write, relaying its refusals to the agent as they are worded. */
async function relayRefusals<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof LotCopyRefusedError) throw invalidRequest(`${err.message} Nothing was written.`);
    throw err;
  }
}

/**
 * Each lot's copies in `get_purchase`'s shape, in the order they were added, at most
 * {@link MAX_LOT_COPIES_LISTED} a lot. Shared by `get_purchase` and every write here.
 */
export async function loadLotCopies(
  context: OperationContext,
  lotIds: readonly string[],
  only?: readonly string[]
): Promise<Map<string, AgentLotCopy[]>> {
  if (lotIds.length === 0) return new Map();
  const rows = await prisma.item.findMany({
    where: {
      collectionId: context.collectionId,
      lotId: { in: [...lotIds] },
      ...(only ? { id: { in: [...only] } } : {}),
    },
    orderBy: [{ itemNo: "asc" }],
    select: {
      id: true,
      itemNo: true,
      lotId: true,
      stampId: true,
      deliveryState: true,
      condition: { select: { name: true } },
      format: { select: { name: true } },
      apiReviewAt: true,
      apiReviewCreated: true,
      apiReviewFields: true,
    },
  });
  const listed = new Map<string, typeof rows>();
  for (const row of rows) {
    const lotRows = listed.get(row.lotId!) ?? [];
    if (lotRows.length < MAX_LOT_COPIES_LISTED) lotRows.push(row);
    listed.set(row.lotId!, lotRows);
  }
  const labels = await loadStampLabels(context, [...new Set([...listed.values()].flat().map((row) => row.stampId))]);
  const out = new Map<string, AgentLotCopy[]>();
  for (const [lotId, lotRows] of listed) {
    out.set(
      lotId,
      lotRows.map((row) => {
        const label = labels.get(row.stampId);
        return lotCopy({
          id: row.id,
          itemNo: row.itemNo,
          stampId: row.stampId,
          stampNo: label?.stampNo ?? 0,
          stampName: label?.name ?? null,
          catalogNumbers: label?.catalogNumbers ?? [],
          conditionName: row.condition?.name ?? null,
          formatName: row.format?.name ?? null,
          deliveryState: row.deliveryState,
          apiReviewAt: row.apiReviewAt,
          apiReviewCreated: row.apiReviewCreated,
          apiReviewFields: row.apiReviewFields,
        });
      })
    );
  }
  return out;
}

async function loadCopy(context: OperationContext, lotId: string, copyId: string): Promise<AgentLotCopy> {
  const copy = (await loadLotCopies(context, [lotId], [copyId])).get(lotId)?.[0];
  if (!copy) throw new Error(`Copy ${copyId} is not on lot ${lotId}.`);
  return copy;
}

async function lotCopyCount(lotId: string): Promise<number> {
  return prisma.item.count({ where: { lotId } });
}

// ── Naming what a copy is ────────────────────────────────────────────────────

/** A condition from the vocabulary that a copy can take — not a price column only (#2374). */
async function resolveCopyCondition(context: OperationContext, value: string): Promise<string> {
  const vocabulary = await readCollectionVocabulary(context);
  const id = resolveVocabularyValue(value, vocabulary.conditions, { vocabulary: "condition", parameter: "condition" });
  const entry = vocabulary.conditions.find((condition) => condition.id === id);
  if (entry?.priceOnly) {
    throw invalidRequest(
      `"${value}" is a price column only — a cover's price, not a copy's condition — so a copy cannot take it. Nothing was written.`,
      vocabulary.conditions.filter((condition) => !condition.priceOnly).map((condition) => condition.name)
    );
  }
  return id;
}

async function resolveCopyFormat(context: OperationContext, value: string): Promise<string | null> {
  const vocabulary = await readCollectionVocabulary(context);
  return resolveAxisValue(value, vocabulary.formats, "single", { vocabulary: "format", parameter: "format" });
}

async function resolveOneStamp(context: OperationContext, value: string): Promise<string> {
  return (await resolveStampRefMap(context, [value], "stamp")).get(value.trim())!;
}

/** The checklist a whole issue is added by: the issue's only checklist, or the one named. */
async function resolveChecklist(
  context: OperationContext,
  issue: string | null,
  checklist: string | null
): Promise<{ id: string; stamps: number }> {
  if (checklist !== null) {
    const row = await prisma.checklist.findFirst({
      where: { id: checklist, collectionId: context.collectionId, ...(issue !== null ? { issueId: issue } : {}) },
      select: { id: true, _count: { select: { stamps: { where: COUNTING_CHECKLIST_MEMBER } } } },
    });
    if (!row) {
      throw notFound(
        `No checklist with id "${checklist}"${issue !== null ? ` belongs to issue "${issue}"` : " is in this token's collection"}. \`get_issue\` lists an issue's checklists.`
      );
    }
    return { id: row.id, stamps: row._count.stamps };
  }
  const row = await prisma.issue.findFirst({
    where: { id: issue!, collectionId: context.collectionId },
    select: {
      name: true,
      // The standard checklists: a specialised one is a collector's study of the issue, not what an
      // order means by the issue, and it is still reached by naming it in "checklist".
      checklists: {
        where: { kind: "standard" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, _count: { select: { stamps: { where: COUNTING_CHECKLIST_MEMBER } } } },
      },
    },
  });
  if (!row) {
    throw notFound(
      `No issue with id "${issue}" is in this token's collection. Use \`search_collection\` or \`list_issues\` to find the right id.`
    );
  }
  if (row.checklists.length === 0) {
    throw invalidRequest(`Issue "${row.name}" has no checklist, so it has no stamps to add as a whole. Name the stamps one by one with "stamp". Nothing was written.`);
  }
  if (row.checklists.length > 1) {
    throw invalidRequest(
      `Issue "${row.name}" has ${row.checklists.length} checklists — ${row.checklists.map((c) => `"${c.name}" (${c.id})`).join(", ")} — and a whole issue is added by one of them, as on the purchase screen. Send "checklist" with the id of the one the order means. Nothing was written.`,
      row.checklists.map((c) => c.id)
    );
  }
  return { id: row.checklists[0].id, stamps: row.checklists[0]._count.stamps };
}

// ── add_purchase_lot_copies ──────────────────────────────────────────────────

/** The most copies of one stamp one call adds. */
export const MAX_COPIES_PER_ADD = 100;

const LOT_ID_PARAMETER: ParameterSpec = {
  name: "lotId",
  in: "path",
  type: "string",
  required: true,
  description: "The lot's id, from `get_purchase` or `add_purchase_lot`.",
};

const CONDITION_DESCRIPTION =
  "The copies' condition, by id or name from `get_collection_vocabulary` (`MNH`, `used`) — one a copy can take, never a `priceOnly` price column.";
const FORMAT_DESCRIPTION =
  "The copy's format from `get_collection_vocabulary` — a pair, a block of four — or `single`, the default.";

export async function addLotCopies(
  context: OperationContext,
  params: ParsedParams
): Promise<{ added: AgentLotCopy[]; lotCopies: number }> {
  const lotId = requiredString(params, "lotId");
  await assertPurchaseLot(context, lotId);
  const stamp = optionalString(params, "stamp");
  const issue = optionalString(params, "issue");
  const checklist = optionalString(params, "checklist");
  const quantity = optionalInteger(params, "quantity");
  const format = optionalString(params, "format");

  const whole = issue !== null || checklist !== null;
  if ((stamp !== null) === whole) {
    throw invalidRequest(
      'Name what is added: "stamp" for one stamp, or "issue" (with "checklist" where the issue has several) for one copy of each of its stamps — one or the other, not both.'
    );
  }
  if (whole && (quantity !== null || format !== null)) {
    throw invalidRequest(
      'A whole issue adds one single copy of each of its stamps, as the purchase screen does, so "quantity" and "format" go only with "stamp". Nothing was written.'
    );
  }
  if (quantity !== null && (quantity < 1 || quantity > MAX_COPIES_PER_ADD)) {
    throw invalidRequest(`"quantity" is how many copies of the stamp, from 1 to ${MAX_COPIES_PER_ADD}. Nothing was written.`);
  }

  const conditionId = await resolveCopyCondition(context, requiredString(params, "condition"));
  const formatId = format !== null ? await resolveCopyFormat(context, format) : null;
  let target: { stampId: string } | { checklistId: string };
  if (stamp !== null) {
    target = { stampId: await resolveOneStamp(context, stamp) };
  } else {
    const resolved = await resolveChecklist(context, issue, checklist);
    if (resolved.stamps === 0) {
      throw invalidRequest("That checklist has no stamps on it yet, so there is nothing to add. Nothing was written.");
    }
    target = { checklistId: resolved.id };
  }

  const created = await relayRefusals(() =>
    addLotCopiesByApi(context.ownerId, lotId, {
      ...target,
      copies: quantity ?? 1,
      conditionId,
      formatId,
    })
  );
  const listed = await loadLotCopies(context, [lotId], created.map((copy) => copy.itemId));
  return { added: listed.get(lotId) ?? [], lotCopies: await lotCopyCount(lotId) };
}

export const addPurchaseLotCopiesOperation: Operation = {
  name: "add_purchase_lot_copies",
  method: "POST",
  path: "/purchase-lots/{lotId}/copies",
  description:
    "Say what is in a purchase lot: add copies of one stamp in a condition and quantity — \"Fi 500 used ×2\" — or one copy of each stamp of a whole issue, as the purchase screen does. Only an open lot on an order that has not arrived takes copies, and not on the incoming half of a trade. The copies are created ordered, with no price of their own (the lot carries it), and wait for the collector to confirm them on the purchase's screen. A run of a set, \"Mi 1234–1236\", is one call per stamp.",
  writes: true,
  parameters: [
    LOT_ID_PARAMETER,
    {
      name: "stamp",
      in: "body",
      type: "string",
      required: false,
      description:
        "The stamp, as its id, its short number (`st 123`) or a catalogue number naming only it (`Mi 1234`); an ambiguous number is refused with the candidates. Leave it out to add a whole issue.",
    },
    {
      name: "issue",
      in: "body",
      type: "string",
      required: false,
      description: "An issue's id, to add one copy of each of its stamps instead of naming one stamp.",
    },
    {
      name: "checklist",
      in: "body",
      type: "string",
      required: false,
      description:
        "Which of the issue's checklists to add by, by id, where the issue has several (an imperforate set beside a perforated one); the refusal names them.",
    },
    { name: "condition", in: "body", type: "string", required: true, description: CONDITION_DESCRIPTION },
    {
      name: "quantity",
      in: "body",
      type: "integer",
      required: false,
      description: `How many copies of the stamp, 1 to ${MAX_COPIES_PER_ADD}; 1 when left out.`,
    },
    { name: "format", in: "body", type: "string", required: false, description: FORMAT_DESCRIPTION },
  ],
  result: {
    kind: "object",
    description:
      "`added` is the copies just created, in `get_purchase`'s lot-copy shape — `copyId`, the stamp's `stampNo`, name and `catalogNumbers`, `condition`, `format`, `state` (`ordered`) and `toReview` — and `lotCopies` how many copies the lot now holds.",
  },
  handler: async (context, params) => addLotCopies(context, params),
};

// ── update_purchase_lot_copy ─────────────────────────────────────────────────

const COPY_ID_PARAMETER: ParameterSpec = {
  name: "copyId",
  in: "path",
  type: "string",
  required: true,
  description: "The copy's id, from a lot's `copyList` in `get_purchase` or from `add_purchase_lot_copies`.",
};

export async function editLotCopy(
  context: OperationContext,
  params: ParsedParams
): Promise<{ copy: AgentLotCopy; changed: string[] }> {
  const copyId = requiredString(params, "copyId");
  const { lotId } = await assertLotCopy(context, copyId);
  const stamp = optionalString(params, "stamp");
  const condition = optionalString(params, "condition");
  const format = optionalString(params, "format");
  if (stamp === null && condition === null && format === null) {
    throw invalidRequest('Nothing to change: send "stamp", "condition" or "format".');
  }
  const changes = {
    ...(stamp !== null ? { stampId: await resolveOneStamp(context, stamp) } : {}),
    ...(condition !== null ? { conditionId: await resolveCopyCondition(context, condition) } : {}),
    ...(format !== null ? { formatId: await resolveCopyFormat(context, format) } : {}),
  };
  const changed = await relayRefusals(() => correctLotCopyByApi(context.ownerId, copyId, changes));
  return { copy: await loadCopy(context, lotId, copyId), changed };
}

export const updatePurchaseLotCopyOperation: Operation = {
  name: "update_purchase_lot_copy",
  method: "PATCH",
  path: "/purchase-lot-copies/{copyId}",
  description:
    "Correct a copy on a purchase lot while it is still ordered — its stamp, its condition or its format; only what is sent changes. A copy that has arrived, or one on a closed lot, is refused. The correction waits for the collector to confirm it on the purchase's screen.",
  writes: true,
  parameters: [
    COPY_ID_PARAMETER,
    {
      name: "stamp",
      in: "body",
      type: "string",
      required: false,
      description: "The stamp it really is, as an id, a short number (`st 123`) or a catalogue number naming only it.",
    },
    { name: "condition", in: "body", type: "string", required: false, description: CONDITION_DESCRIPTION },
    { name: "format", in: "body", type: "string", required: false, description: FORMAT_DESCRIPTION },
  ],
  result: {
    kind: "object",
    description:
      "`copy` as it now stands, in `get_purchase`'s lot-copy shape, and `changed` — the fields that actually changed (`stamp`, `condition`, `format`); empty when everything sent was already so, and nothing was then written.",
  },
  handler: async (context, params) => editLotCopy(context, params),
};

// ── remove_purchase_lot_copy ─────────────────────────────────────────────────

export async function removeLotCopy(
  context: OperationContext,
  params: ParsedParams
): Promise<{ removed: number; lotCopies: number }> {
  const copyId = requiredString(params, "copyId");
  const { lotId } = await assertLotCopy(context, copyId);
  await relayRefusals(() => removeLotCopyByApi(context.ownerId, copyId));
  return { removed: 1, lotCopies: await lotCopyCount(lotId) };
}

export const removePurchaseLotCopyOperation: Operation = {
  name: "remove_purchase_lot_copy",
  method: "DELETE",
  path: "/purchase-lot-copies/{copyId}",
  description:
    "Take a copy off a purchase lot while it is still ordered — one added by mistake or twice. The copy is deleted, as the purchase screen's *Remove from lot* deletes it. A copy that has arrived, or one on a closed lot, is refused.",
  writes: true,
  parameters: [COPY_ID_PARAMETER],
  result: {
    kind: "object",
    description: "How many copies were removed — one — and `lotCopies`, how many the lot now holds.",
  },
  handler: async (context, params) => removeLotCopy(context, params),
};
