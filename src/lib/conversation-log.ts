import "server-only";
import { prisma, type DbTransaction } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import {
  checkConversationText,
  type ConversationAuthor,
  type ConversationChannel,
  type ConversationDirection,
} from "./conversation-log-rules";

// The conversation log (#2149, ADR-0073): what was said with a buyer, entry by entry. One module for
// every writer — the card on a sale and on a contact (through `app/actions/conversation-log.ts`) and
// the agent API (`agent-api/operations/conversation-log.ts`) — so the two cannot record differently.
//
// **An entry is with a contact, and optionally about one of their sales.** The sale it names is
// always a sale *of that contact*: every write here checks it, and the two places a sale can stop
// being the contact's — its buyer changed (`updateSaleHeader`) or the sale merged into another
// buyer's (`mergeSales`) — call {@link keepConversationWithBuyer}, which drops the link and leaves
// the entry with the person it was with. Deleting a sale drops it the same way (`SetNull`).
//
// **An entry is a record, not an act**: nothing here touches a sale, its status or its amounts, and
// nothing waits for the collector's review. `author` says who wrote it and never changes.

/** Raised when an entry cannot be written as asked; the message is for the collector or the agent. */
export class ConversationEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationEntryError";
  }
}

/** An entry as every reader is told it. */
export interface ConversationEntryData {
  id: string;
  contactId: string;
  contactName: string;
  saleId: string | null;
  saleNo: number | null;
  occurredAt: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  summary: string;
  quote: string | null;
  url: string | null;
  author: ConversationAuthor;
  createdAt: string;
  updatedAt: string;
}

const ENTRY_SELECT = {
  id: true,
  contactId: true,
  saleId: true,
  occurredAt: true,
  channel: true,
  direction: true,
  summary: true,
  quote: true,
  url: true,
  author: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { name: true } },
  sale: { select: { saleNo: true } },
} as const;

type EntryRow = Prisma.ConversationEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

function toEntryData(row: EntryRow): ConversationEntryData {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contact.name,
    saleId: row.saleId,
    saleNo: row.sale?.saleNo ?? null,
    occurredAt: row.occurredAt.toISOString(),
    channel: row.channel as ConversationChannel,
    direction: row.direction as ConversationDirection,
    summary: row.summary,
    quote: row.quote,
    url: row.url,
    author: row.author as ConversationAuthor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Newest first; among entries of one moment the later written first, so a conversation recorded at
 *  once reads in a stable order. */
const ENTRY_ORDER: Prisma.ConversationEntryOrderByWithRelationInput[] = [
  { occurredAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId }, select: { ownerId: true } });
  if (!collection || collection.ownerId !== ownerId) throw new Error("Collection not found or access denied.");
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

/** What a read is narrowed to. Every filter is optional; together they are *and*. */
export interface ConversationEntryFilters {
  contactId?: string;
  saleId?: string;
  channels?: readonly ConversationChannel[];
  /** Words looked for in the summary and the quote, ignoring case — every word must appear. */
  text?: string;
  /** On or after this instant. */
  from?: Date;
  /** Before this instant. */
  before?: Date;
}

function entryWhere(collectionId: string, filters: ConversationEntryFilters): Prisma.ConversationEntryWhereInput {
  const words = (filters.text ?? "").split(/\s+/).filter((word) => word.length > 0);
  return {
    collectionId,
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.saleId ? { saleId: filters.saleId } : {}),
    ...(filters.channels && filters.channels.length > 0 ? { channel: { in: [...filters.channels] } } : {}),
    ...(filters.from || filters.before
      ? { occurredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.before ? { lt: filters.before } : {}) } }
      : {}),
    ...(words.length > 0
      ? {
          AND: words.map((word) => ({
            OR: [
              { summary: { contains: word, mode: "insensitive" as const } },
              { quote: { contains: word, mode: "insensitive" as const } },
            ],
          })),
        }
      : {}),
  };
}

/** A page of entries and how many match, the window the caller's own (`offset`, `limit`). */
export async function listConversationEntries(
  ownerId: string,
  collectionId: string,
  filters: ConversationEntryFilters,
  window: { offset: number; limit: number }
): Promise<{ items: ConversationEntryData[]; total: number }> {
  await assertCollectionOwner(ownerId, collectionId);
  const where = entryWhere(collectionId, filters);
  const [rows, total] = await Promise.all([
    prisma.conversationEntry.findMany({
      where,
      orderBy: ENTRY_ORDER,
      skip: window.offset,
      take: window.limit,
      select: ENTRY_SELECT,
    }),
    prisma.conversationEntry.count({ where }),
  ]);
  return { items: rows.map(toEntryData), total };
}

/** One entry, or null when it is not in a collection the caller owns — or not in `collectionId`. */
export async function getConversationEntry(
  ownerId: string,
  entryId: string,
  collectionId?: string
): Promise<ConversationEntryData | null> {
  const row = await prisma.conversationEntry.findFirst({
    where: { id: entryId, collection: { ownerId }, ...(collectionId ? { collectionId } : {}) },
    select: ENTRY_SELECT,
  });
  return row ? toEntryData(row) : null;
}

/** How many entries a contact's log holds — what moves when it is merged away. */
export async function countContactConversationEntries(contactId: string): Promise<number> {
  return prisma.conversationEntry.count({ where: { contactId } });
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────

/** One entry as a writer states it. */
export interface ConversationEntryInput {
  occurredAt: Date;
  channel: ConversationChannel;
  direction: ConversationDirection;
  summary: string;
  quote: string | null;
  url: string | null;
  /** The contact's sale it is about, or null for none. */
  saleId: string | null;
}

/** The contact, checked to be in the caller's collection. */
async function assertContact(
  db: DbTransaction | typeof prisma,
  ownerId: string,
  contactId: string
): Promise<{ collectionId: string }> {
  const contact = await db.contact.findFirst({
    where: { id: contactId, collection: { ownerId } },
    select: { collectionId: true },
  });
  if (!contact) throw new ConversationEntryError("That contact is not in this collection.");
  return contact;
}

/** A sale is named on an entry only when it is a sale of the entry's contact. */
async function assertSaleOfContact(db: DbTransaction, contactId: string, saleId: string): Promise<void> {
  const sale = await db.sale.findUnique({ where: { id: saleId }, select: { buyerId: true, saleNo: true } });
  if (!sale) throw new ConversationEntryError("That sale is not in this collection any more.");
  if (sale.buyerId !== contactId) {
    throw new ConversationEntryError(
      `Sale ${sale.saleNo} is ${sale.buyerId === null ? "to no named buyer" : "another buyer's"}; an entry names only a sale of its own buyer.`
    );
  }
}

function checkedText(input: { summary: string; quote: string | null; url: string | null }): {
  summary: string;
  quote: string | null;
  url: string | null;
} {
  const check = checkConversationText(input);
  if (!check.ok) throw new ConversationEntryError(check.message);
  return { summary: check.summary, quote: check.quote, url: check.url };
}

/**
 * Record entries with one contact, in one transaction — a conversation read at once is written whole
 * or not at all. Answers the new entries' ids in the order given.
 */
export async function createConversationEntries(
  ownerId: string,
  contactId: string,
  inputs: readonly ConversationEntryInput[],
  author: ConversationAuthor
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const texts = inputs.map(checkedText);
  return prisma.$transaction(async (tx) => {
    const { collectionId } = await assertContact(tx, ownerId, contactId);
    for (const saleId of new Set(inputs.flatMap((input) => (input.saleId ? [input.saleId] : [])))) {
      await assertSaleOfContact(tx, contactId, saleId);
    }
    const ids: string[] = [];
    for (const [index, input] of inputs.entries()) {
      const { id } = await tx.conversationEntry.create({
        data: {
          collectionId,
          contactId,
          saleId: input.saleId,
          occurredAt: input.occurredAt,
          channel: input.channel,
          direction: input.direction,
          ...texts[index],
          author,
        },
        select: { id: true },
      });
      ids.push(id);
    }
    return ids;
  });
}

/** A correction: only the fields given change. `saleId` moves the entry to another sale of the same
 *  contact, or to none with null. */
export type ConversationEntryPatch = Partial<ConversationEntryInput>;

export async function updateConversationEntry(
  ownerId: string,
  entryId: string,
  patch: ConversationEntryPatch
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.conversationEntry.findFirst({
      where: { id: entryId, collection: { ownerId } },
      select: { contactId: true, summary: true, quote: true, url: true },
    });
    if (!entry) throw new ConversationEntryError("That conversation entry is not in this collection any more.");
    if (patch.saleId) await assertSaleOfContact(tx, entry.contactId, patch.saleId);
    const touchesText = patch.summary !== undefined || patch.quote !== undefined || patch.url !== undefined;
    const text = touchesText
      ? checkedText({
          summary: patch.summary ?? entry.summary,
          quote: patch.quote !== undefined ? patch.quote : entry.quote,
          url: patch.url !== undefined ? patch.url : entry.url,
        })
      : {};
    await tx.conversationEntry.update({
      where: { id: entryId },
      data: {
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
        ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
        ...(patch.saleId !== undefined ? { saleId: patch.saleId } : {}),
        ...text,
      },
    });
  });
}

export async function deleteConversationEntry(ownerId: string, entryId: string): Promise<void> {
  const { count } = await prisma.conversationEntry.deleteMany({ where: { id: entryId, collection: { ownerId } } });
  if (count === 0) throw new ConversationEntryError("That conversation entry is not in this collection any more.");
}

/**
 * Keep the log true to who a sale is with: entries naming `saleId` whose contact is not `buyerId`
 * drop the sale and stay with their contact. Called inside the transaction that changed a sale's
 * buyer or merged sales; `buyerId` null — the buyer cleared — detaches every entry of the sale.
 */
export async function keepConversationWithBuyer(
  tx: DbTransaction,
  saleId: string,
  buyerId: string | null
): Promise<void> {
  await tx.conversationEntry.updateMany({
    where: { saleId, ...(buyerId !== null ? { contactId: { not: buyerId } } : {}) },
    data: { saleId: null },
  });
}

// ── The card ─────────────────────────────────────────────────────────────────────────────────────

/** The card shows a buyer's log whole; past this many it says how many more there are. */
export const CONVERSATION_CARD_LIMIT = 200;

/** A sale an entry may name, as the card's dialog lists it. */
export interface ConversationSaleOption {
  id: string;
  saleNo: number;
  soldAt: string;
  platformName: string;
}

/** What the *Conversation* card reads: a contact's entries — or only those about one of their sales —
 *  and their sales, for the dialog. Null when the contact is not in the collection. */
export interface ConversationLogView {
  contactId: string;
  contactName: string;
  entries: ConversationEntryData[];
  total: number;
  sales: ConversationSaleOption[];
}

export async function readConversationLog(
  ownerId: string,
  collectionId: string,
  contactId: string,
  saleId: string | null
): Promise<ConversationLogView | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, collectionId, collection: { ownerId } },
    select: {
      name: true,
      salesBuyer: {
        orderBy: [{ soldAt: "desc" }, { saleNo: "desc" }],
        select: { id: true, saleNo: true, soldAt: true, platform: { select: { name: true } } },
      },
    },
  });
  if (!contact) return null;
  const { items, total } = await listConversationEntries(
    ownerId,
    collectionId,
    { contactId, ...(saleId ? { saleId } : {}) },
    { offset: 0, limit: CONVERSATION_CARD_LIMIT }
  );
  return {
    contactId,
    contactName: contact.name,
    entries: items,
    total,
    sales: contact.salesBuyer.map((sale) => ({
      id: sale.id,
      saleNo: sale.saleNo,
      soldAt: sale.soldAt.toISOString().slice(0, 10),
      platformName: sale.platform.name,
    })),
  };
}
