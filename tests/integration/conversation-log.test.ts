import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createSale, mergeSales, updateSaleHeader, type SaleHeaderInput } from "../../src/lib/sales";
import { deleteContact, mergeContacts } from "../../src/lib/contacts";
import {
  ConversationEntryError,
  createConversationEntries,
  listConversationEntries,
  readConversationLog,
  updateConversationEntry,
} from "../../src/lib/conversation-log";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentConversationBatch, AgentConversationEntry } from "../../src/lib/agent-api/conversation-log-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **The conversation log (#2149), in the domain and through the agent API.**
//
// `tests/unit/agent-api-conversation-log.test.ts` holds the entry grammar and the projection, and
// `tests/unit/agent-api-operation-boundary.test.ts` that the agent's writes go through one module and
// are marked as the Assistant's. This file holds the rest: that an entry names only a sale of its own
// buyer, and stays with the person when a sale stops being theirs — a changed buyer, a merge, a
// delete — that a merged contact brings its log, and that the five operations read, search, record,
// correct, move and delete through the real route, a read only token reading and searching only.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

async function call(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const [pathname, search] = path.split("?");
  const request = new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; message: string }> {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, message: (answer.body as { error: { message: string } }).error.message };
}

describe("the conversation log (#2149)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let annaId: string;
  let piotrId: string;
  let token: string;
  let readOnlyToken: string;

  const entry = (summary: string, extra: { saleId?: string | null; at?: string } = {}) => ({
    occurredAt: new Date(extra.at ?? "2026-10-20T12:00:00Z"),
    channel: "messenger" as const,
    direction: "from_buyer" as const,
    summary,
    quote: null,
    url: null,
    saleId: extra.saleId ?? null,
  });

  const header = (buyerId: string | null): SaleHeaderInput => ({
    platformId,
    buyerId,
    externalRef: null,
    transactionUrl: null,
    soldAt: new Date("2026-10-18"),
    currency: "PLN",
    buyerHandling: null,
    buyerPaidTotal: null,
    commission: null,
  });

  const saleNoOf = async (saleId: string) =>
    (await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { saleNo: true } })).saleNo;

  before(async () => {
    userId = `test-user-conversation-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `test-conversation-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-conversation-${ts}`, name: "Conversation", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })).id;
    annaId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Anna Zielińska",
          buyer: true,
          facebookProfiles: { create: { collectionId, url: "https://www.facebook.com/anna.z" } },
        },
      })
    ).id;
    piotrId = (await prisma.contact.create({ data: { collectionId, name: "Piotr Wiśniewski", buyer: true } })).id;
    token = (await createAssistantToken(userId, collectionId, { label: "log agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "log agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.conversationEntry.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("in the domain", () => {
    it("records entries on a buyer and names only a sale of theirs", async () => {
      const annaSale = await createSale(userId, collectionId, header(annaId));
      const piotrSale = await createSale(userId, collectionId, header(piotrId));
      const [id] = await createConversationEntries(userId, annaId, [entry("Wants both sets", { saleId: annaSale })], "collector");
      const view = await readConversationLog(userId, collectionId, annaId, annaSale);
      assert.deepEqual(view?.entries.map((e) => e.id), [id]);
      assert.equal(view?.entries[0].author, "collector");
      assert.ok(view?.sales.some((sale) => sale.id === annaSale));

      await assert.rejects(
        createConversationEntries(userId, annaId, [entry("Wrong sale", { saleId: piotrSale })], "collector"),
        ConversationEntryError
      );
      await assert.rejects(updateConversationEntry(userId, id, { saleId: piotrSale }), ConversationEntryError);
      await assert.rejects(
        createConversationEntries(userId, annaId, [entry("   ")], "collector"),
        ConversationEntryError
      );
    });

    it("leaves an entry with its person when the sale's buyer changes, the sale merges into another buyer's, or is deleted", async () => {
      const sale = await createSale(userId, collectionId, header(annaId));
      const [changed] = await createConversationEntries(userId, annaId, [entry("Before the buyer changed", { saleId: sale })], "collector");
      await updateSaleHeader(userId, sale, header(piotrId));
      const afterChange = await prisma.conversationEntry.findUniqueOrThrow({ where: { id: changed } });
      assert.equal(afterChange.contactId, annaId);
      assert.equal(afterChange.saleId, null);

      // A merge moves an entry to the remaining sale only when it is with that sale's buyer.
      const remaining = await createSale(userId, collectionId, header(annaId));
      const sameBuyer = await createSale(userId, collectionId, header(annaId));
      const otherBuyer = await createSale(userId, collectionId, header(piotrId));
      const [moves] = await createConversationEntries(userId, annaId, [entry("Same buyer", { saleId: sameBuyer })], "collector");
      const [stays] = await createConversationEntries(userId, piotrId, [entry("Other buyer", { saleId: otherBuyer })], "collector");
      const choices = { buyer: "remaining", commission: "remaining", postage: "remaining" } as const;
      await mergeSales(userId, { remainingSaleId: remaining, otherSaleId: sameBuyer, choices });
      await mergeSales(userId, { remainingSaleId: remaining, otherSaleId: otherBuyer, choices });
      assert.equal((await prisma.conversationEntry.findUniqueOrThrow({ where: { id: moves } })).saleId, remaining);
      const kept = await prisma.conversationEntry.findUniqueOrThrow({ where: { id: stays } });
      assert.equal(kept.saleId, null);
      assert.equal(kept.contactId, piotrId);

      const deleted = await createSale(userId, collectionId, header(annaId));
      const [orphan] = await createConversationEntries(userId, annaId, [entry("On a deleted sale", { saleId: deleted })], "collector");
      await prisma.sale.delete({ where: { id: deleted } });
      assert.equal((await prisma.conversationEntry.findUniqueOrThrow({ where: { id: orphan } })).saleId, null);
    });

    it("moves a merged contact's log and deletes a deleted contact's", async () => {
      const twin = (await prisma.contact.create({ data: { collectionId, name: `Anna twin ${ts}`, buyer: true } })).id;
      const [moved] = await createConversationEntries(userId, twin, [entry("From the second account")], "collector");
      await mergeContacts(userId, { remainingContactId: annaId, otherContactId: twin });
      assert.equal((await prisma.conversationEntry.findUniqueOrThrow({ where: { id: moved } })).contactId, annaId);

      const gone = (await prisma.contact.create({ data: { collectionId, name: `Gone ${ts}`, buyer: true } })).id;
      const [lost] = await createConversationEntries(userId, gone, [entry("Never bought")], "collector");
      await deleteContact(userId, gone);
      assert.equal(await prisma.conversationEntry.count({ where: { id: lost } }), 0);
    });

    it("searches by words in the summary and the quote, every word ignoring case", async () => {
      await createConversationEntries(
        userId,
        piotrId,
        [{ ...entry("Address for the parcel"), quote: "ul. Długa 5, Kraków" }],
        "collector"
      );
      const found = await listConversationEntries(userId, collectionId, { text: "PARCEL kraków" }, { offset: 0, limit: 10 });
      assert.equal(found.total, 1);
      const none = await listConversationEntries(userId, collectionId, { text: "parcel warszawa" }, { offset: 0, limit: 10 });
      assert.equal(none.total, 0);
    });
  });

  describe("through the agent API", () => {
    it("registers five operations, the four writes refused to a read only token", async () => {
      const names = OPERATIONS.filter((op) => op.path.startsWith("/conversation-entries")).map((op) => [op.name, op.writes]);
      assert.deepEqual(names, [
        ["list_conversation_entries", false],
        ["add_conversation_entries", true],
        ["update_conversation_entry", true],
        ["move_conversation_entry", true],
        ["delete_conversation_entry", true],
      ]);
      await ok(readOnlyToken, "GET", "/conversation-entries?text=parcel");
      const denied = await refused(readOnlyToken, "POST", "/conversation-entries", { buyer: annaId, entries: [] });
      assert.equal(denied.status, 403);
    });

    it("records a conversation per entry, reads it back, corrects, moves and deletes", async () => {
      const first = await createSale(userId, collectionId, header(annaId));
      const second = await createSale(userId, collectionId, header(annaId));
      const piotrSale = await createSale(userId, collectionId, header(piotrId));
      const firstNo = await saleNoOf(first);
      const secondNo = await saleNoOf(second);

      const batch = await ok<AgentConversationBatch>(token, "POST", "/conversation-entries", {
        buyer: "https://www.facebook.com/anna.z",
        sale: `s${firstNo}`,
        entries: [
          "at=2026-10-21T18:00:00+02:00\nchannel=messenger\ndirection=from_buyer\nsummary=Takes both sets; 40 PLN with shipping\nquote=ok biorę oba",
          `at=2026-10-21T18:05:00+02:00\nchannel=messenger\ndirection=to_buyer\nsummary=Asked for the address\nsale=${secondNo}`,
          `at=2026-10-21T18:10:00+02:00\nchannel=messenger\ndirection=note\nsummary=Wrong buyer's sale\nsale=${await saleNoOf(piotrSale)}`,
          "channel=messenger\ndirection=note\nsummary=No time",
        ],
      });
      assert.equal(batch.recorded, 2);
      assert.equal(batch.refused, 2);
      const [a, b, c, d] = batch.entries;
      assert.ok(a.status === "recorded" && b.status === "recorded" && c.status === "refused" && d.status === "refused");
      assert.equal(a.entry.writtenBy, "assistant");
      assert.equal(a.entry.buyer.id, annaId);
      assert.equal(a.entry.sale?.id, first);
      assert.equal(a.entry.quote, "ok biorę oba");
      assert.equal(b.entry.sale?.id, second);
      assert.match(c.reason, /another buyer's/);

      const ofSale = await ok<ListResponse<AgentConversationEntry>>(token, "GET", `/conversation-entries?sale=${firstNo}`);
      assert.deepEqual(ofSale.items.map((e) => e.id), [a.entry.id]);
      const ofBuyer = await ok<ListResponse<AgentConversationEntry>>(
        token,
        "GET",
        `/conversation-entries?buyer=${encodeURIComponent("anna zielińska")}&channel=messenger&from=2026-10-21&to=2026-10-21`
      );
      assert.deepEqual(ofBuyer.items.map((e) => e.id), [b.entry.id, a.entry.id]);
      assert.equal(ofBuyer.total, 2);

      const corrected = await ok<AgentConversationEntry>(token, "PATCH", `/conversation-entries/${a.entry.id}`, {
        summary: "Takes both sets for 40 PLN",
        clear: ["quote"],
      });
      assert.equal(corrected.summary, "Takes both sets for 40 PLN");
      assert.equal(corrected.quote, null);
      assert.equal(corrected.writtenBy, "assistant");

      const moved = await ok<AgentConversationEntry>(token, "POST", `/conversation-entries/${a.entry.id}/sale`, { sale: String(secondNo) });
      assert.equal(moved.sale?.id, second);
      const unlinked = await ok<AgentConversationEntry>(token, "POST", `/conversation-entries/${a.entry.id}/sale`, { sale: "none" });
      assert.equal(unlinked.sale, null);
      const wrong = await refused(token, "POST", `/conversation-entries/${a.entry.id}/sale`, { sale: piotrSale });
      assert.match(wrong.message, /another buyer's/);

      await ok(token, "DELETE", `/conversation-entries/${a.entry.id}`);
      assert.equal(await prisma.conversationEntry.count({ where: { id: a.entry.id } }), 0);
      const gone = await refused(token, "DELETE", `/conversation-entries/${a.entry.id}`);
      assert.equal(gone.status, 404);
    });

    it("refuses a buyer it does not know, and a sale with no buyer to belong to", async () => {
      const unknown = await refused(token, "POST", "/conversation-entries", { buyer: "Nobody Here", entries: [] });
      assert.match(unknown.message, /find_or_create_buyer/);
      const anonymous = await createSale(userId, collectionId, header(null));
      const noBuyer = await refused(token, "POST", "/conversation-entries", { sale: anonymous, entries: [] });
      assert.match(noBuyer.message, /names no buyer/);
      const neither = await refused(token, "POST", "/conversation-entries", { entries: [] });
      assert.match(neither.message, /Send "buyer"/);
    });
  });
});
