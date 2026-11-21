import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { DELETE, GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentContact, AgentContactDetails, ContactMergeMoves } from "../../src/lib/agent-api/contact-reads";

// **Merging two contacts and deleting an empty one through the agent API (#2612), driven through the
// real route.**
//
// The merge is the app's own `mergeContacts`, whose rules `tests/unit/contact-merge-rules.test.ts`
// holds. This file holds what the API adds: the preview states what the merge then does, the merge
// leaves the Assistant's note on the remaining contact, a contact with a sale is refused a delete with
// the sale named while an empty one is deleted, and a read only token is refused all three writes.

const ts = Date.now();

type Method = "GET" | "POST" | "DELETE";
const HANDLERS = { GET, POST, DELETE };

async function call(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const url = new URL(`http://localhost/api/v1${path}`);
  const request = new NextRequest(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: url.pathname.replace(/^\/api\/v1/, "").split("/").filter(Boolean) }),
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

interface Preview {
  remaining: { id: string; name: string };
  other: { id: string; name: string };
  merged: AgentContactDetails;
  changes: { field: string; before: string | null; after: string | null }[];
  moves: ContactMergeMoves;
  summary: string;
}

describe("merging and deleting contacts (#2612)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let token: string;
  let readOnlyToken: string;
  let janId: string;
  let jan2Id: string;
  let buyerId: string;
  let emptyId: string;
  const jan2Profile = `https://www.facebook.com/jan.second.${ts}`;

  before(async () => {
    userId = `test-user-contactmerge-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User contactmerge-${ts}`,
        email: `test-contactmerge-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactmerge-${ts}`, name: "Contact merge", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })).id;
    janId = (
      await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", phone: "+48 600 100 200", buyer: true, notes: "Pays fast." } })
    ).id;
    jan2Id = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "jan_k_2",
          email: "jan2@example.pl",
          phone: "+48 999",
          language: "pl",
          exchangePartner: true,
          notes: "Second account.",
          facebookProfiles: { create: [{ collectionId, url: jan2Profile }] },
        },
      })
    ).id;
    await prisma.sale.create({ data: { collectionId, saleNo: 11, platformId, soldAt: new Date("2026-05-01"), currency: "PLN", buyerId: jan2Id } });
    await prisma.sale.create({ data: { collectionId, saleNo: 12, platformId, soldAt: new Date("2026-06-01"), currency: "PLN", buyerId: jan2Id } });
    await prisma.proposal.create({ data: { collectionId, proposalNo: 1, contactId: jan2Id } });
    await prisma.conversationEntry.create({
      data: { collectionId, contactId: jan2Id, occurredAt: new Date("2026-06-02"), channel: "messenger", direction: "from_buyer", author: "collector", summary: "Asked about Bavaria." },
    });

    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Bruno Nowak", buyer: true } })).id;
    await prisma.sale.create({ data: { collectionId, saleNo: 20, platformId, soldAt: new Date("2026-07-01"), currency: "PLN", buyerId } });
    emptyId = (
      await prisma.contact.create({
        data: { collectionId, name: "Mistake", facebookProfiles: { create: [{ collectionId, url: `https://www.facebook.com/mistake.${ts}` }] } },
      })
    ).id;

    token = (await createAssistantToken(userId, collectionId, { label: "contact merger", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "contact merger, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.conversationEntry.deleteMany({ where: { collectionId } });
    await prisma.proposal.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("refuses all three writes to a read only token", async () => {
    assert.equal((await refused(readOnlyToken, "POST", `/contacts/${janId}/merge`, { other: jan2Id })).status, 403);
    assert.equal((await refused(readOnlyToken, "DELETE", `/contacts/${emptyId}`)).status, 403);
    // The preview reads, so a read only token may ask for it.
    await ok<Preview>(readOnlyToken, "GET", `/contacts/${janId}/merge?other=${jan2Id}`);
  });

  it("refuses merging a contact with itself", async () => {
    const { message } = await refused(token, "POST", `/contacts/${janId}/merge`, { other: "Jan Kowalski" });
    assert.match(message, /cannot be merged with itself/);
  });

  it("previews what the merge dialog shows, writing nothing", async () => {
    const preview = await ok<Preview>(token, "GET", `/contacts/${encodeURIComponent("Jan Kowalski")}/merge?other=jan_k_2`);
    assert.deepEqual(preview.remaining, { id: janId, name: "Jan Kowalski" });
    assert.deepEqual(preview.other, { id: jan2Id, name: "jan_k_2" });
    assert.equal(preview.merged.name, "Jan Kowalski");
    assert.equal(preview.merged.phone, "+48 600 100 200");
    assert.equal(preview.merged.email, "jan2@example.pl");
    assert.equal(preview.merged.language, "pl");
    assert.equal(preview.merged.notes, "Pays fast.\n\nSecond account.");
    assert.deepEqual(preview.merged.roles, ["buyer", "exchange_partner"]);
    assert.deepEqual(preview.merged.facebookProfiles, [jan2Profile]);
    assert.deepEqual(preview.moves, {
      purchases: 0,
      sales: 2,
      trades: 0,
      proposals: 1,
      auctionSales: 0,
      priceObservations: 0,
      conversationEntries: 1,
      facebookProfiles: 1,
    });
    assert.ok(preview.changes.some((change) => change.field === "email" && change.before === null && change.after === "jan2@example.pl"));
    assert.ok(!preview.changes.some((change) => change.field === "phone"), "the remaining contact keeps its phone");
    assert.match(preview.summary, /jan_k_2 merges into Jan Kowalski: 2 sales, 1 proposal, 1 conversation entry, 1 Facebook profile move/);
    assert.equal(await prisma.contact.count({ where: { id: jan2Id } }), 1, "the preview merged nothing");
  });

  it("merges as Merge with… does, and notes it on the remaining contact as the Assistant's", async () => {
    const answer = await ok<{ contact: AgentContact; mergedAway: { id: string; name: string }; moved: ContactMergeMoves }>(
      token,
      "POST",
      `/contacts/${janId}/merge`,
      { other: jan2Id }
    );
    assert.deepEqual(answer.mergedAway, { id: jan2Id, name: "jan_k_2" });
    assert.equal(answer.moved.sales, 2);
    assert.equal(answer.contact.id, janId);
    assert.deepEqual(answer.contact.sales, [12, 11]);
    assert.deepEqual(answer.contact.proposals, [1]);
    assert.equal(answer.contact.email, "jan2@example.pl");
    assert.equal(answer.contact.phone, "+48 600 100 200");
    assert.deepEqual(answer.contact.facebookProfiles, [jan2Profile]);
    // The moved entry and the Assistant's note.
    assert.equal(answer.contact.conversationEntries, 2);
    assert.equal(await prisma.contact.count({ where: { id: jan2Id } }), 0, "the other contact is deleted");

    const note = await prisma.conversationEntry.findFirst({
      where: { contactId: janId, author: "assistant" },
      select: { direction: true, summary: true, quote: true },
    });
    assert.equal(note?.direction, "note");
    assert.match(note?.summary ?? "", /^Contact merged by the Assistant: jan_k_2 merged into this contact — 2 sales, 1 proposal, 1 conversation entry, 1 Facebook profile moved\.$/);
    assert.match(note?.quote ?? "", new RegExp(`Merged away: jan_k_2 \\(${jan2Id}\\), deleted\\.`));
    assert.match(note?.quote ?? "", /email: \(none\) → jan2@example\.pl/);
  });

  it("refuses to delete a contact with one sale, naming the sale", async () => {
    const { message } = await refused(token, "DELETE", `/contacts/${buyerId}`);
    assert.match(message, /Bruno Nowak is not deleted\. Filed under them: sale 20\./);
    assert.match(message, /merge_contacts/);
    assert.equal(await prisma.contact.count({ where: { id: buyerId } }), 1);
  });

  it("refuses to delete a contact whose only record is a conversation entry, which the app would take along", async () => {
    const { message } = await refused(token, "DELETE", `/contacts/${janId}`);
    assert.match(message, /sales 12, 11; proposal 1; 2 conversation entries/);
  });

  it("deletes a contact with nothing filed under it, its Facebook profile with it", async () => {
    const answer = await ok<{ deleted: { id: string; name: string; facebookProfiles: string[] } }>(token, "DELETE", `/contacts/${emptyId}`);
    assert.equal(answer.deleted.id, emptyId);
    assert.equal(answer.deleted.name, "Mistake");
    assert.deepEqual(answer.deleted.facebookProfiles, [`https://www.facebook.com/mistake.${ts}`]);
    assert.equal(await prisma.contact.count({ where: { id: emptyId } }), 0);
    assert.equal(await prisma.contactFacebookProfile.count({ where: { contactId: emptyId } }), 0);
    assert.ok((await refused(token, "DELETE", `/contacts/${emptyId}`)).status >= 400);
  });
});
