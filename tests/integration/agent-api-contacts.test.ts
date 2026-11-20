import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentContact, AgentContactRow } from "../../src/lib/agent-api/contact-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Contacts through the agent API (#2610), driven through the real route with real tokens.**
//
// `tests/unit/agent-api-contact-reads.test.ts` holds the projections. This file holds the rest: that
// `find_contacts` narrows by words, role, market and profile with a true `total`, that `get_contact`
// reads every field the contact's edit dialog shows — email, phone and notes included — with the
// numbers of what was done with them, and that a *read only* token does all of it.

const ts = Date.now();

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: "GET" | "POST", path: string): Promise<{ status: number; body: unknown }> {
  const [pathname, search] = path.split("?");
  const request = new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  const handler = method === "GET" ? GET : POST;
  const response = await handler(request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, path: string): Promise<T> {
  const answer = await call(token, "GET", path);
  assert.equal(answer.status, 200, `GET ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, path: string): Promise<{ status: number; error: ApiErrorBody["error"] }> {
  const answer = await call(token, "GET", path);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("the contact operations (#2610)", () => {
  let userId: string;
  let collectionId: string;
  let readOnlyToken: string;
  let annaId: string;
  let brunoId: string;
  let carlId: string;
  let dieterId: string;
  let houseSaleId: string;

  before(async () => {
    userId = `test-user-contactops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User contactops-${ts}`,
        email: `test-contactops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactops-${ts}`, name: "Contact ops", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Philasearch", platformCurrency: "EUR" } })
    ).id;

    annaId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "anna_de",
          fullName: "Anna Schmidt",
          email: `anna-${ts}@example.com`,
          phone: "+49 30 1234567",
          notes: "Prefers registered post.",
          market: "DE",
          buyer: true,
          auctionHouse: true,
          defaultCurrency: "EUR",
          defaultShippingCost: "4.50",
          buyerPremiumPercent: "18.00",
          buyerPremiumFixed: "1.00",
          defaultAuctionPlatformId: platformId,
          freeExtrasMinimumOrder: "100.00",
          freeExtrasBudgetPercent: "5.00",
          freeExtrasMaximumBudget: "20.00",
          facebookProfiles: {
            create: [
              { collectionId, url: `https://www.facebook.com/anna.schmidt.${ts}` },
              { collectionId, url: `https://www.facebook.com/profile.php?id=${ts}` },
            ],
          },
        },
      })
    ).id;
    brunoId = (await prisma.contact.create({ data: { collectionId, name: "Bruno Nowak", market: "PL", buyer: true } })).id;
    carlId = (await prisma.contact.create({ data: { collectionId, name: "Carl Weber", market: "DE", seller: true } })).id;
    dieterId = (
      await prisma.contact.create({ data: { collectionId, name: "Dieter Braun", market: "DE", buyer: true, exchangePartner: true } })
    ).id;

    // What was done with Anna: two sales, a purchase she supplied, a trade, a proposal, an auction sale
    // and a conversation entry. A trade's incoming half names her as supplier and is not a purchase of hers.
    await prisma.sale.create({ data: { collectionId, saleNo: 3, platformId, soldAt: new Date("2026-01-10"), currency: "EUR", buyerId: annaId } });
    await prisma.sale.create({ data: { collectionId, saleNo: 7, platformId, soldAt: new Date("2026-03-02"), currency: "EUR", buyerId: annaId } });
    await prisma.sale.create({ data: { collectionId, saleNo: 8, platformId, soldAt: new Date("2026-03-05"), currency: "EUR", buyerId: brunoId } });
    await prisma.purchase.create({ data: { collectionId, purchaseNo: 4, purchasedAt: new Date("2026-02-01"), currency: "EUR", contactId: annaId } });
    const trade = await prisma.trade.create({ data: { collectionId, tradeNo: 2, partnerId: annaId, currency: "PLN" } });
    await prisma.purchase.create({
      data: { collectionId, purchaseNo: 5, purchasedAt: new Date("2026-02-15"), currency: "PLN", contactId: annaId, tradeId: trade.id },
    });
    await prisma.proposal.create({ data: { collectionId, proposalNo: 1, contactId: annaId } });
    houseSaleId = (
      await prisma.auctionSale.create({ data: { collectionId, sellerId: annaId, platformId, name: "Spring auction 2026", currency: "EUR" } })
    ).id;
    await prisma.conversationEntry.create({
      data: {
        collectionId,
        contactId: annaId,
        occurredAt: new Date("2026-03-01T10:00:00Z"),
        channel: "email",
        direction: "from_buyer",
        summary: "Asked for more Bavaria.",
        author: "collector",
      },
    });

    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "contact agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.conversationEntry.deleteMany({ where: { collectionId } });
    await prisma.proposal.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("carries the two operations, neither of them a write", () => {
    for (const name of ["find_contacts", "get_contact"]) {
      const operation = OPERATIONS.find((candidate) => candidate.name === name);
      assert.ok(operation, name);
      assert.equal(operation.writes, false, name);
    }
  });

  it("finds the buyers in market DE, with a true total, on a read only token", async () => {
    const page = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?role=buyer&market=de");
    // By name, in the database's order — the contacts list's own, whatever the collation puts first.
    assert.deepEqual(
      page.items.map((row) => row.id).sort(),
      [annaId, dieterId].sort()
    );
    assert.equal(page.total, 2);
    const anna = page.items.find((row) => row.id === annaId)!;
    assert.deepEqual(anna.roles, ["buyer", "auction_house"]);
    assert.equal(anna.market, "DE");
    assert.equal(anna.fullName, "Anna Schmidt");
    assert.match(anna.path, new RegExp(`/c/col-contactops-${ts}/contacts/${annaId}$`));
    // The row is who a contact is, not what it holds.
    assert.ok(!("email" in anna) && !("phone" in anna) && !("notes" in anna));
  });

  it("finds by words in the name or full name, by role alone, and pages with the total intact", async () => {
    const bySurname = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?search=schmidt");
    assert.deepEqual(bySurname.items.map((row) => row.id), [annaId]);
    const twoWords = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?search=bruno%20NOWAK");
    assert.deepEqual(twoWords.items.map((row) => row.id), [brunoId]);
    const partners = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?role=exchange_partner");
    assert.deepEqual(partners.items.map((row) => row.id), [dieterId]);
    const firstPage = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?limit=2");
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.total, 4);
    assert.ok(firstPage.nextCursor);
  });

  it("finds a contact by a Facebook profile link, however it is spelled", async () => {
    const page = await ok<ListResponse<AgentContactRow>>(
      readOnlyToken,
      `/contacts?facebook_profile=${encodeURIComponent(`facebook.com/Anna.Schmidt.${ts}/`)}`
    );
    assert.deepEqual(page.items.map((row) => row.id), [annaId]);
    const none = await ok<ListResponse<AgentContactRow>>(
      readOnlyToken,
      `/contacts?facebook_profile=${encodeURIComponent("https://www.facebook.com/nobody.here")}`
    );
    assert.equal(none.total, 0);
  });

  it("refuses a role, a market or a profile link it cannot read", async () => {
    const role = await refused(readOnlyToken, "/contacts?role=customer");
    assert.equal(role.status, 400);
    assert.ok(role.error.accepted?.includes("exchange_partner"));
    assert.equal((await refused(readOnlyToken, "/contacts?market=Germany")).status, 400);
    assert.equal((await refused(readOnlyToken, `/contacts?facebook_profile=${encodeURIComponent("https://example.com/anna")}`)).status, 400);
  });

  it("reads a contact in full — every field of the edit dialog, the profiles, and what was done with them", async () => {
    const anna = await ok<AgentContact>(readOnlyToken, `/contacts/${annaId}`);
    assert.equal(anna.name, "anna_de");
    assert.equal(anna.fullName, "Anna Schmidt");
    assert.equal(anna.email, `anna-${ts}@example.com`);
    assert.equal(anna.phone, "+49 30 1234567");
    assert.equal(anna.notes, "Prefers registered post.");
    assert.deepEqual(anna.roles, ["buyer", "auction_house"]);
    assert.equal(anna.market, "DE");
    assert.deepEqual(anna.facebookProfiles, [
      `https://www.facebook.com/anna.schmidt.${ts}`,
      `https://www.facebook.com/profile.php?id=${ts}`,
    ]);
    assert.equal(anna.defaultCurrency, "EUR");
    assert.equal(anna.defaultShippingCost, "4.50");
    assert.equal(anna.buyerPremiumPercent, "18.00");
    assert.equal(anna.buyerPremiumFixed, "1.00");
    assert.equal(anna.auctionPlatform, "Philasearch");
    assert.equal(anna.freeExtrasMinimumOrder, "100.00");
    assert.equal(anna.freeExtrasBudgetPercent, "5");
    assert.equal(anna.freeExtrasMaximumBudget, "20.00");
    assert.deepEqual(anna.sales, [7, 3]);
    assert.deepEqual(anna.purchases, [4], "a trade's incoming half is the trade's, not a purchase of hers");
    assert.deepEqual(anna.trades, [2]);
    assert.deepEqual(anna.proposals, [1]);
    assert.deepEqual(anna.auctionSales, [{ id: houseSaleId, name: "Spring auction 2026", status: "open" }]);
    assert.equal(anna.conversationEntries, 1);
    assert.match(anna.path, new RegExp(`/contacts/${annaId}$`));
  });

  it("names a contact by its full name, and a contact with nothing done reads empty lists and nulls", async () => {
    const byFullName = await ok<AgentContact>(readOnlyToken, `/contacts/${encodeURIComponent("anna schmidt")}`);
    assert.equal(byFullName.id, annaId);
    const carl = await ok<AgentContact>(readOnlyToken, `/contacts/${encodeURIComponent("Carl Weber")}`);
    assert.equal(carl.id, carlId);
    assert.equal(carl.email, null);
    assert.equal(carl.auctionPlatform, null);
    assert.deepEqual(carl.facebookProfiles, []);
    assert.deepEqual([carl.purchases, carl.sales, carl.trades, carl.proposals, carl.auctionSales], [[], [], [], [], []]);
    assert.equal(carl.conversationEntries, 0);
  });

  it("refuses an unknown name with the close ones, pointing at find_contacts", async () => {
    const answer = await refused(readOnlyToken, `/contacts/${encodeURIComponent("Carl Webber")}`);
    assert.equal(answer.status, 400);
    assert.match(answer.error.message, /Carl Weber/);
    assert.match(answer.error.message, /find_contacts/);
    assert.doesNotMatch(answer.error.message, /create_seller|find_or_create_buyer/);
  });

  it("reads no contact of another collection", async () => {
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-contactops-other-${ts}`, name: "Other", baseCurrency: "PLN", ownerId: userId },
    });
    const stranger = await prisma.contact.create({ data: { collectionId: otherCollection.id, name: "Stranger" } });
    assert.equal((await refused(readOnlyToken, `/contacts/${stranger.id}`)).status, 400);
    const page = await ok<ListResponse<AgentContactRow>>(readOnlyToken, "/contacts?search=stranger");
    assert.equal(page.total, 0);
  });
});
