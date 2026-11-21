import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentContact } from "../../src/lib/agent-api/contact-reads";

// **Making and editing contacts through the agent API (#2611), driven through the real route.**
//
// `tests/unit/agent-api-contact-reads.test.ts` holds the field rules and the note's wording. This file
// holds the rest: that `create_contact` takes every detail the dialog takes and keeps today's guard
// against duplicates, that `update_contact` changes only what is named, that a Facebook profile on
// another contact is refused with that contact's name, that each write leaves the Assistant's note in
// the contact's conversation log, and that a read only token is refused both.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

async function call(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
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

describe("the contact writes (#2611)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let janId: string;
  let annaId: string;
  const annaProfile = `https://www.facebook.com/anna.schmidt.${ts}`;

  before(async () => {
    userId = `test-user-contactwrites-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User contactwrites-${ts}`,
        email: `test-contactwrites-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactwrites-${ts}`, name: "Contact writes", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    janId = (
      await prisma.contact.create({
        data: { collectionId, name: "Jan Kowalski", phone: "+48 600 100 200", notes: "Collects Bavaria.", seller: true, market: "DE" },
      })
    ).id;
    annaId = (
      await prisma.contact.create({
        data: { collectionId, name: "anna_de", buyer: true, facebookProfiles: { create: [{ collectionId, url: annaProfile }] } },
      })
    ).id;
    token = (await createAssistantToken(userId, collectionId, { label: "contact writer", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "contact writer, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.conversationEntry.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function notes(contactId: string) {
    return prisma.conversationEntry.findMany({
      where: { contactId },
      orderBy: { createdAt: "asc" },
      select: { author: true, direction: true, summary: true, quote: true },
    });
  }

  it("sets Jan's email, language and default shipping, and notes them on his log as the Assistant's", async () => {
    const jan = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, {
      email: "jan@example.de",
      language: "DE",
      default_shipping_cost: "5,00",
      default_currency: "EUR",
    });
    assert.equal(jan.email, "jan@example.de");
    assert.equal(jan.language, "de");
    assert.equal(jan.defaultShippingCost, "5.00");
    assert.equal(jan.defaultCurrency, "EUR");
    // Nothing else moved.
    assert.equal(jan.phone, "+48 600 100 200");
    assert.equal(jan.notes, "Collects Bavaria.");
    assert.equal(jan.market, "DE");
    assert.deepEqual(jan.roles, ["seller"]);

    const [note] = await notes(janId);
    assert.equal(note.author, "assistant");
    assert.equal(note.direction, "note");
    assert.equal(note.summary, "Contact changed by the Assistant: email, language, default currency, default shipping cost.");
    assert.match(note.quote ?? "", /email: \(none\) → jan@example\.de/);
    assert.match(note.quote ?? "", /language: \(none\) → de/);
    assert.match(note.quote ?? "", /default shipping cost: \(none\) → 5\.00/);
  });

  it("changes only the phone when only the phone is sent", async () => {
    const before = await ok<AgentContact>(token, "GET", `/contacts/${janId}`);
    const after = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, { phone: "+48 600 999 999" });
    assert.deepEqual({ ...after, phone: before.phone, conversationEntries: before.conversationEntries }, before);
    assert.equal(after.phone, "+48 600 999 999");
    const last = (await notes(janId)).at(-1);
    assert.equal(last?.quote, "phone: +48 600 100 200 → +48 600 999 999");
  });

  it("clears a field named in clear, and refuses one both sent and cleared", async () => {
    const jan = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, { clear: ["notes"] });
    assert.equal(jan.notes, null);
    const answer = await refused(token, "PATCH", `/contacts/${janId}`, { email: "x@example.de", clear: ["email"] });
    assert.match(answer.message, /both sent and named in "clear"/);
  });

  it("adds and removes Facebook profiles, refusing one already on another contact with that contact's name", async () => {
    const own = `https://www.facebook.com/jan.kowalski.${ts}`;
    const added = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, { add_facebook_profiles: [own] });
    assert.deepEqual(added.facebookProfiles, [own]);

    const answer = await refused(token, "PATCH", `/contacts/${janId}`, { add_facebook_profiles: [annaProfile] });
    assert.match(answer.message, /already on the contact anna_de/);
    assert.deepEqual((await ok<AgentContact>(token, "GET", `/contacts/${janId}`)).facebookProfiles, [own]);

    const stray = await refused(token, "PATCH", `/contacts/${janId}`, { remove_facebook_profiles: [annaProfile] });
    assert.match(stray.message, /not among Jan Kowalski's Facebook profiles/);

    const removed = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, { remove_facebook_profiles: [own] });
    assert.deepEqual(removed.facebookProfiles, []);
    assert.match((await notes(janId)).at(-1)?.quote ?? "", /Facebook profiles: removed/);
  });

  it("refuses a seller's default on a buyer, and a rename onto another contact's name", async () => {
    const premium = await refused(token, "PATCH", `/contacts/${annaId}`, { buyer_premium_percent: "20" });
    assert.match(premium.message, /belongs to a seller or an auction house/);
    const rename = await refused(token, "PATCH", `/contacts/${annaId}`, { name: "Jan Kowalski" });
    assert.match(rename.message, /already exists/);
    const nothing = await refused(token, "PATCH", `/contacts/${annaId}`, {});
    assert.match(nothing.message, /Nothing to change was sent/);
  });

  it("drops a contact's market and auction defaults when its roles stop it selling, as the dialog does", async () => {
    const jan = await ok<AgentContact>(token, "PATCH", `/contacts/${janId}`, { roles: ["buyer"] });
    assert.deepEqual(jan.roles, ["buyer"]);
    assert.equal(jan.market, null);
    assert.equal(jan.defaultShippingCost, null);
    assert.equal(jan.email, "jan@example.de");
  });

  it("creates a contact with every detail, noted as created by the Assistant", async () => {
    const profile = `https://www.facebook.com/hans.meier.${ts}`;
    const hans = await ok<AgentContact>(token, "POST", "/contacts", {
      name: "hans_m",
      full_name: "Hans Meier",
      email: "hans@example.de",
      phone: "+49 89 1",
      notes: "Met at Sindelfingen.",
      roles: ["seller", "buyer"],
      market: "de",
      language: "de",
      default_currency: "EUR",
      default_shipping_cost: "3.50",
      free_extras_minimum_order: "200",
      facebook_profiles: [profile],
    });
    assert.equal(hans.name, "hans_m");
    assert.equal(hans.fullName, "Hans Meier");
    assert.equal(hans.market, "DE");
    assert.equal(hans.language, "de");
    assert.deepEqual(hans.roles, ["seller", "buyer"]);
    assert.equal(hans.freeExtrasMinimumOrder, "200.00");
    assert.deepEqual(hans.facebookProfiles, [profile]);
    const [note] = await notes(hans.id);
    assert.equal(note.author, "assistant");
    assert.match(note.summary, /^Contact created by the Assistant with name, full name, email/);
  });

  it("keeps today's guard: the same name refused with its id, a close one until stated a different person", async () => {
    const same = await refused(token, "POST", "/contacts", { name: "jan kowalski" });
    assert.match(same.message, new RegExp(`already filed under "Jan Kowalski" \\(${janId}\\)`));
    const close = await refused(token, "POST", "/contacts", { name: "Jan Kowalsky" });
    assert.match(close.message, /different_person/);
    const other = await ok<AgentContact>(token, "POST", "/contacts", { name: "Jan Kowalsky", different_person: true });
    assert.equal(other.name, "Jan Kowalsky");
  });

  it("refuses a new contact holding a profile already on another, and creates nobody", async () => {
    const answer = await refused(token, "POST", "/contacts", { name: "Zofia Nowak", facebook_profiles: [annaProfile] });
    assert.match(answer.message, /already on the contact anna_de/);
    assert.equal(await prisma.contact.count({ where: { collectionId, name: "Zofia Nowak" } }), 0);
  });

  it("refuses both writes on a read only token", async () => {
    assert.equal((await refused(readOnlyToken, "POST", "/contacts", { name: "Nobody" })).status, 403);
    assert.equal((await refused(readOnlyToken, "PATCH", `/contacts/${janId}`, { phone: "1" })).status, 403);
  });
});
