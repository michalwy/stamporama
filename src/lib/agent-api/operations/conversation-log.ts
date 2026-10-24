import "server-only";
import { prisma } from "../../db";
import { normalizeFacebookProfileUrl } from "../../facebook-profile-rules";
import {
  ConversationEntryError,
  createConversationEntries,
  deleteConversationEntry,
  getConversationEntry,
  listConversationEntries,
  updateConversationEntry,
  type ConversationEntryInput,
  type ConversationEntryPatch,
} from "../../conversation-log";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_DIRECTIONS,
  checkConversationText,
  type ConversationChannel,
  type ConversationDirection,
} from "../../conversation-log-rules";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalString, requiredString, stringList } from "../params";
import { parseIsoDate, resolveSeller, type SellerCandidate } from "../purchase-reads";
import {
  MAX_CONVERSATION_ENTRIES,
  NO_SALE,
  agentConversationEntry,
  parseConversationEntrySpec,
  parseConversationInstant,
  parseSaleRef,
  summarizeConversationBatch,
  type AgentConversationAnswer,
  type AgentConversationBatch,
  type AgentConversationEntry,
  type SaleRef,
} from "../conversation-log-reads";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// The conversation log (#2149, ADR-0073) — what was said with a buyer, written mostly by the Assistant
// reading Messenger, the mail or the marketplace's messages. **All of it is here from the first
// release**: reading and searching the log, recording a conversation in one call, correcting an
// entry, moving it to another sale of the same buyer or to none, and deleting one.
//
// **Every write is the card's own**, `conversation-log.ts`, so an entry the agent writes is checked as
// one the collector types is. **An entry is a record, not an act**: nothing here touches a sale, so
// nothing waits for the collector's review — the entry says the Assistant wrote it, and that is all.
//
// **A buyer is named as the sale operations name one** (#1949): a buyer's id or exact name over the
// contacts that are buyers, an unknown name refused with the close ones — and, as *Sell* finds a buyer
// on Facebook (#1777), the link to their Facebook profile. Nobody is created from here:
// `find_or_create_buyer` is that act. **A sale is named by its number** as the collector calls it, or
// its id, and a sale of another buyer is refused.

// ── Naming a buyer and a sale ────────────────────────────────────────────────

const BUYER_NEWCOMER = { who: "buyer", operation: "find_or_create_buyer" } as const;

/** Every contact that is a buyer, reduced to what a buyer is matched against. */
async function loadBuyerCandidates(context: OperationContext): Promise<SellerCandidate[]> {
  return prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId }, buyer: true },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
}

/** A buyer by id, name, or Facebook profile link. */
async function resolveBuyer(context: OperationContext, value: string, parameter: string): Promise<string> {
  if (/^https?:\/\//i.test(value.trim())) {
    const profile = normalizeFacebookProfileUrl(value);
    if (!profile.ok || profile.value === null) {
      throw invalidRequest(
        `${profile.ok ? "That is not a profile link." : profile.message} Send the buyer's name or id as "${parameter}" instead.`
      );
    }
    const held = await prisma.contactFacebookProfile.findFirst({
      where: { collectionId: context.collectionId, url: profile.value },
      select: { contact: { select: { id: true, buyer: true } } },
    });
    if (!held || !held.contact.buyer) {
      throw invalidRequest(
        `No buyer in this collection has the Facebook profile ${profile.value}. Find or add them with \`find_or_create_buyer\` and send the id it returns as "${parameter}".`
      );
    }
    return held.contact.id;
  }
  return resolveSeller(value, await loadBuyerCandidates(context), parameter, BUYER_NEWCOMER);
}

interface SaleOfCollection {
  id: string;
  saleNo: number;
  buyerId: string | null;
}

async function findSale(context: OperationContext, ref: SaleRef): Promise<SaleOfCollection | null> {
  if (ref.kind === "none") return null;
  return prisma.sale.findFirst({
    where: {
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
      ...(ref.kind === "number" ? { saleNo: ref.saleNo } : { id: ref.id }),
    },
    select: { id: true, saleNo: true, buyerId: true },
  });
}

/** The sale a ref names, or the sentence refusing it. `none` is null — about no sale. */
async function resolveSaleFor(
  context: OperationContext,
  ref: SaleRef,
  buyerId: string | null
): Promise<{ ok: true; sale: SaleOfCollection | null } | { ok: false; reason: string }> {
  if (ref.kind === "none") return { ok: true, sale: null };
  const sale = await findSale(context, ref);
  if (!sale) {
    return {
      ok: false,
      reason: `No sale ${ref.kind === "number" ? `numbered ${ref.saleNo}` : `with id "${ref.id}"`} is in this collection. \`list_sales\` with "buyer" lists the buyer's sales.`,
    };
  }
  if (buyerId !== null && sale.buyerId !== buyerId) {
    return {
      ok: false,
      reason: `Sale ${sale.saleNo} is ${sale.buyerId === null ? "to no named buyer" : "another buyer's"}; an entry names only a sale of its own buyer. \`list_sales\` with "buyer" lists theirs.`,
    };
  }
  return { ok: true, sale };
}

function requiredSale<T>(result: { ok: true; sale: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw invalidRequest(result.reason);
  return result.sale;
}

/** A domain refusal as one the agent can act on. */
async function refusingDomainGuards<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConversationEntryError) throw invalidRequest(error.message);
    throw error;
  }
}

async function loadEntry(context: OperationContext, entryId: string): Promise<AgentConversationEntry> {
  const entry = await getConversationEntry(context.ownerId, entryId, context.collectionId);
  if (!entry) {
    throw notFound(
      `No conversation entry with id "${entryId}" is in this token's collection. Use \`list_conversation_entries\` to find the right id.`
    );
  }
  return agentConversationEntry(entry);
}

// ── list_conversation_entries ────────────────────────────────────────────────

const LIST_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "buyer",
    in: "query",
    type: "string",
    required: false,
    description:
      "Only the conversation with this buyer: a buyer's name or id, or the link to their Facebook profile. A name that matches no buyer is refused with the close ones.",
  },
  {
    name: "sale",
    in: "query",
    type: "string",
    required: false,
    description: "Only the entries about this sale: its number as the collector calls it (`12` or `s12`), or its id from `list_sales`.",
  },
  {
    name: "channel",
    in: "query",
    type: "string[]",
    required: false,
    description: "Only entries that came through these channels. Left out, every channel.",
    values: CONVERSATION_CHANNELS,
  },
  {
    name: "text",
    in: "query",
    type: "string",
    required: false,
    description: "Words to look for in the summary and the quote, ignoring case; every word must appear.",
  },
  {
    name: "from",
    in: "query",
    type: "string",
    required: false,
    description: "Only entries said on or after this day, yyyy-mm-dd (UTC).",
  },
  {
    name: "to",
    in: "query",
    type: "string",
    required: false,
    description: "Only entries said on or before this day, yyyy-mm-dd (UTC).",
  },
];

export async function readConversationEntries(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentConversationEntry>> {
  const buyerValue = optionalString(params, "buyer");
  const saleValue = optionalString(params, "sale");
  const from = optionalString(params, "from");
  const to = optionalString(params, "to");
  const contactId = buyerValue !== null ? await resolveBuyer(context, buyerValue, "buyer") : undefined;
  let saleId: string | undefined;
  if (saleValue !== null) {
    const ref = parseSaleRef(saleValue);
    if (ref.kind === "none") throw invalidRequest(`"sale" names a sale; leave it out for entries about any sale.`);
    saleId = requiredSale(await resolveSaleFor(context, ref, null))!.id;
  }
  const filters = {
    ...(contactId ? { contactId } : {}),
    ...(saleId ? { saleId } : {}),
    channels: stringList(params, "channel") as ConversationChannel[],
    ...(optionalString(params, "text") !== null ? { text: optionalString(params, "text")! } : {}),
    ...(from !== null ? { from: new Date(`${parseIsoDate(from, "from")}T00:00:00.000Z`) } : {}),
    ...(to !== null
      ? { before: new Date(new Date(`${parseIsoDate(to, "to")}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) }
      : {}),
  };
  const window = parseListWindow(params);
  const page = await listConversationEntries(context.ownerId, context.collectionId, filters, {
    offset: window.offset,
    limit: window.limit,
  });
  // The match count and never `items.length` (#706).
  return listResponse(page.items.map(agentConversationEntry), page.total, window);
}

export const listConversationEntriesOperation: Operation = {
  name: "list_conversation_entries",
  method: "GET",
  path: "/conversation-entries",
  description:
    "Read and search the log of conversations with buyers, newest first — a buyer's whole conversation, the entries about one sale, or entries found by words, channel and a span of days. Read it before recording a conversation, so nothing already recorded is recorded again.",
  writes: false,
  parameters: LIST_PARAMETERS,
  result: {
    kind: "list",
    description:
      "The entries. `at` is when it was said; `channel` and `direction` (`from_buyer`, `to_buyer`, `note`) say how; `summary` is what matters and `quote` the words themselves where recorded; `link` is where the conversation can be found; `sale` is the sale it is about, or null; `writtenBy` is `assistant` or `collector`.",
  },
  handler: async (context, params) => readConversationEntries(context, params),
};

// ── add_conversation_entries ─────────────────────────────────────────────────

const ADD_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "buyer",
    in: "body",
    type: "string",
    required: false,
    description:
      "Who the conversation was with: a buyer's name or id, or the link to their Facebook profile. Nobody is created from here — `find_or_create_buyer` finds or adds them. Left out, the buyer of `sale`.",
  },
  {
    name: "sale",
    in: "body",
    type: "string",
    required: false,
    description:
      "The sale the conversation is about, for every entry that names none of its own: its number (`12` or `s12`) or its id. It must be a sale of the buyer. Left out, the entries are about no sale.",
  },
  {
    name: "entries",
    in: "body",
    type: "string[]",
    required: true,
    description: `The entries, at most ${MAX_CONVERSATION_ENTRIES}, one string each with a field per line written \`name=value\`: \`at\` (when it was said, ISO 8601 with the time zone), \`channel\` (${CONVERSATION_CHANNELS.join(", ")}), \`direction\` (${CONVERSATION_DIRECTIONS.join(", ")}) and \`summary\` are required; \`quote\` (the words themselves, where they matter — an address, an amount), \`link\` (where it can be found) and \`sale\` (a number, an id, or \`${NO_SALE}\`, in place of the call's) are optional. A line not starting with a field's name and \`=\` continues the field before it.`,
  },
];

export async function addConversationEntries(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentConversationBatch> {
  const raw = stringList(params, "entries");
  if (raw.length > MAX_CONVERSATION_ENTRIES) {
    throw invalidRequest(
      `"entries" carries ${raw.length} entries; one call records at most ${MAX_CONVERSATION_ENTRIES}. Send the rest in a second call.`
    );
  }
  const buyerValue = optionalString(params, "buyer");
  const saleValue = optionalString(params, "sale");
  let buyerId = buyerValue !== null ? await resolveBuyer(context, buyerValue, "buyer") : null;
  let callSale: SaleOfCollection | null = null;
  if (saleValue !== null) {
    callSale = requiredSale(await resolveSaleFor(context, parseSaleRef(saleValue), buyerId));
    if (buyerId === null) {
      if (!callSale || callSale.buyerId === null) {
        throw invalidRequest(
          `${callSale ? `Sale ${callSale.saleNo} names no buyer` : '"sale" names no sale'}, so the conversation has nobody to belong to. Send "buyer".`
        );
      }
      buyerId = callSale.buyerId;
    }
  }
  if (buyerId === null) {
    throw invalidRequest('Send "buyer" — who the conversation was with — or "sale", whose buyer it was.');
  }

  const answers: (AgentConversationAnswer | null)[] = [];
  const toWrite: { index: number; input: ConversationEntryInput }[] = [];
  for (const [index, entry] of raw.entries()) {
    const parsed = parseConversationEntrySpec(entry);
    if (!parsed.ok) {
      answers.push({ index, status: "refused", reason: parsed.reason });
      continue;
    }
    const { spec } = parsed;
    let saleId = callSale?.id ?? null;
    if (spec.sale !== null) {
      const resolved = await resolveSaleFor(context, spec.sale, buyerId);
      if (!resolved.ok) {
        answers.push({ index, status: "refused", reason: resolved.reason });
        continue;
      }
      saleId = resolved.sale?.id ?? null;
    }
    answers.push(null);
    toWrite.push({
      index,
      input: {
        occurredAt: spec.at,
        channel: spec.channel,
        direction: spec.direction,
        summary: spec.summary,
        quote: spec.quote,
        url: spec.link,
        saleId,
      },
    });
  }

  const ids = await refusingDomainGuards(() =>
    createConversationEntries(context.ownerId, buyerId!, toWrite.map((row) => row.input), "assistant")
  );
  for (const [i, row] of toWrite.entries()) {
    answers[row.index] = { index: row.index, status: "recorded", entry: await loadEntry(context, ids[i]) };
  }
  return summarizeConversationBatch(answers as AgentConversationAnswer[]);
}

export const addConversationEntriesOperation: Operation = {
  name: "add_conversation_entries",
  method: "POST",
  path: "/conversation-entries",
  description:
    "Record a conversation with a buyer — what was agreed about copies, price, shipping, payment or the address, or a complaint — as entries in their conversation log, several in one call, each optionally about one of their sales. The entries are marked as written by the Assistant; they change nothing else — no sale, status or amount. Check `list_conversation_entries` first so nothing is recorded twice.",
  writes: true,
  parameters: ADD_PARAMETERS,
  result: {
    kind: "object",
    description:
      "`recorded` and `refused` count the entries; `entries` answers each in the order sent, by `index`: `recorded` with the entry in `list_conversation_entries`' shape, or `refused` with the `reason` — fix that entry and send it again alone.",
  },
  handler: async (context, params) => addConversationEntries(context, params),
};

// ── update_conversation_entry / move_conversation_entry / delete_conversation_entry ──

const ENTRY_ID_PARAMETER: ParameterSpec = {
  name: "entryId",
  in: "path",
  type: "string",
  required: true,
  description: "The entry's id, from `list_conversation_entries` or `add_conversation_entries`.",
};

/** The optional fields `clear` may empty. */
const CLEARABLE = ["quote", "link"] as const;

export async function correctConversationEntry(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentConversationEntry> {
  const entryId = requiredString(params, "entryId");
  const current = await loadEntry(context, entryId);
  const clear = new Set(stringList(params, "clear"));
  const patch: ConversationEntryPatch = {};
  const at = optionalString(params, "at");
  if (at !== null) {
    const parsed = parseConversationInstant(at);
    if (typeof parsed === "string") throw invalidRequest(parsed);
    patch.occurredAt = parsed;
  }
  const channel = optionalString(params, "channel");
  if (channel !== null) patch.channel = channel as ConversationChannel;
  const direction = optionalString(params, "direction");
  if (direction !== null) patch.direction = direction as ConversationDirection;
  const summary = optionalString(params, "summary");
  if (summary !== null) patch.summary = summary;
  for (const [field, key] of [
    ["quote", "quote"],
    ["link", "url"],
  ] as const) {
    const value = optionalString(params, field);
    if (value !== null && clear.has(field)) {
      throw invalidRequest(`"${field}" is both sent and named in "clear". Send one or the other.`);
    }
    if (value !== null) patch[key] = value;
    else if (clear.has(field)) patch[key] = null;
  }
  if (Object.keys(patch).length === 0) {
    throw invalidRequest("Nothing to change was sent. Send a field to correct, or `clear`. To move the entry to another sale, use `move_conversation_entry`.");
  }
  // The text as it would stand, refused here with the sentence the domain would give.
  const text = checkConversationText({
    summary: patch.summary ?? current.summary,
    quote: patch.quote !== undefined ? patch.quote : current.quote,
    url: patch.url !== undefined ? patch.url : current.link,
  });
  if (!text.ok) throw invalidRequest(text.message);
  await refusingDomainGuards(() => updateConversationEntry(context.ownerId, entryId, patch));
  return loadEntry(context, entryId);
}

export const updateConversationEntryOperation: Operation = {
  name: "update_conversation_entry",
  method: "PATCH",
  path: "/conversation-entries/{entryId}",
  description:
    "Correct an entry of the conversation log — a misread time, the wrong channel or direction, a summary or quote to fix. Only what is sent changes; `clear` empties the quote or the link. Who wrote it does not change.",
  writes: true,
  parameters: [
    ENTRY_ID_PARAMETER,
    { name: "at", in: "body", type: "string", required: false, description: "When it was said, ISO 8601 with the time zone." },
    { name: "channel", in: "body", type: "string", required: false, description: "The channel it came through.", values: CONVERSATION_CHANNELS },
    { name: "direction", in: "body", type: "string", required: false, description: "Who said it, or `note`.", values: CONVERSATION_DIRECTIONS },
    { name: "summary", in: "body", type: "string", required: false, description: "What matters, in a sentence or two." },
    { name: "quote", in: "body", type: "string", required: false, description: "The words themselves." },
    { name: "link", in: "body", type: "string", required: false, description: "Where the conversation can be found, http:// or https://." },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Optional fields to empty.",
      values: CLEARABLE,
    },
  ],
  result: { kind: "object", description: "The entry as it now stands, in `list_conversation_entries`' shape." },
  handler: async (context, params) => correctConversationEntry(context, params),
};

export async function moveConversationEntry(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentConversationEntry> {
  const entryId = requiredString(params, "entryId");
  const current = await loadEntry(context, entryId);
  const sale = requiredSale(await resolveSaleFor(context, parseSaleRef(requiredString(params, "sale")), current.buyer.id));
  await refusingDomainGuards(() => updateConversationEntry(context.ownerId, entryId, { saleId: sale?.id ?? null }));
  return loadEntry(context, entryId);
}

export const moveConversationEntryOperation: Operation = {
  name: "move_conversation_entry",
  method: "POST",
  path: "/conversation-entries/{entryId}/sale",
  description:
    "Say which sale an entry of the conversation log is about — another sale of the same buyer, or none. The entry stays with its buyer; a sale of another buyer is refused.",
  writes: true,
  parameters: [
    ENTRY_ID_PARAMETER,
    {
      name: "sale",
      in: "body",
      type: "string",
      required: true,
      description: `The sale's number (\`12\` or \`s12\`) or id, or \`${NO_SALE}\` for about no sale.`,
    },
  ],
  result: { kind: "object", description: "The entry as it now stands, in `list_conversation_entries`' shape." },
  handler: async (context, params) => moveConversationEntry(context, params),
};

export async function removeConversationEntry(
  context: OperationContext,
  params: ParsedParams
): Promise<{ deleted: string }> {
  const entryId = requiredString(params, "entryId");
  await loadEntry(context, entryId);
  await refusingDomainGuards(() => deleteConversationEntry(context.ownerId, entryId));
  return { deleted: entryId };
}

export const deleteConversationEntryOperation: Operation = {
  name: "delete_conversation_entry",
  method: "DELETE",
  path: "/conversation-entries/{entryId}",
  description:
    "Delete an entry of the conversation log recorded by mistake — twice, or with the wrong buyer. To fix a misread field, correct it with `update_conversation_entry` instead.",
  writes: true,
  parameters: [ENTRY_ID_PARAMETER],
  result: { kind: "object", description: "`deleted`, the entry's id." },
  handler: async (context, params) => removeConversationEntry(context, params),
};
