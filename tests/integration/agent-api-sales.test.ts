import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { addOfferSet, createOffer, setOfferState, type OfferInput } from "../../src/lib/offers";
import { getSaleDetail } from "../../src/lib/sales";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentBuyer, AgentSale, AgentSaleRow } from "../../src/lib/agent-api/sale-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Sales through the agent API (#1949), driven through the real route with real tokens.**
//
// `tests/unit/agent-api-sale-reads.test.ts` holds the projections and the price rule, and
// `tests/unit/agent-api-operation-boundary.test.ts` holds *no deleting, no status moves, always
// marked* as a fact about what the operation module imports. This file holds the rest: that the
// collector's scenario — find the buyer, record what sold, read it back — is a real sequence of
// calls, that every write lands where the sale screen reads it (`getSaleDetail`) and carries the
// *to review* marker, and that the refusals are the app's.
//
// The Facebook group is in EUR and the platform in PLN, so a new sale following the offer's currency
// rather than the platform's is visible; EUR is never converted from here, since the base is PLN and
// no rate is fetched for a sale whose rate simply stays unknown.

const ts = Date.now();

type Method = "GET" | "POST";
const HANDLERS = { GET, POST };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

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
  return { status: answer.status, message: (answer.body as ApiErrorBody).error.message };
}

describe("the sale operations (#1949)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let facebookId: string;
  let delcampeId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    userId = `test-user-saleops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User saleops-${ts}`,
        email: `test-saleops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-saleops-${ts}`, name: "Sale ops", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    delcampeId = (
      await prisma.platform.create({ data: { collectionId, name: "Delcampe", platformCurrency: "EUR" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — sprzedaż",
        url: "https://www.facebook.com/groups/654321",
        currency: "EUR",
        custom: ["currency"],
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    // A contact holding private details the surface must not repeat, already a buyer.
    await prisma.contact.create({
      data: { collectionId, name: "Anna Zielińska", buyer: true, email: `anna-${ts}@example.com`, phone: "+48 500 600 700" },
    });
    // Somebody known on Facebook under a different profile than the one a namesake will arrive with.
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Piotr Wiśniewski",
        buyer: true,
        facebookProfiles: { create: { collectionId, url: "https://www.facebook.com/piotr.w.1" } },
      },
    });
    token = (await createAssistantToken(userId, collectionId, { label: "sale agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "sale agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    // Sales first: a sold copy is `Restrict`-ed by its sale line, and a buyer by the sale.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A Facebook auction that is up — the group's default listing — one set per copy. */
  async function facebookOffer(copies: number): Promise<{ id: string; offerNo: number; setIds: string[] }> {
    const items = await Promise.all(Array.from({ length: copies }, () => newItem()));
    const input: OfferInput = {
      platformId: facebookId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
    const id = await createOffer(userId, collectionId, input, { seedItemIds: [items[0]] });
    for (const item of items.slice(1)) await addOfferSet(userId, id, [item]);
    await setOfferState(userId, id, "ready");
    await setOfferState(userId, id, "active");
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id },
      select: { offerNo: true, sets: { select: { id: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return { id, offerNo: offer.offerNo, setIds: offer.sets.map((set) => set.id) };
  }

  it("carries the six operations, four of them writes", () => {
    const names = ["list_sales", "get_sale", "find_or_create_buyer", "sell_offer", "sell_offer_set", "move_sale_sets"];
    for (const name of names) assert.ok(OPERATIONS.some((operation) => operation.name === name), name);
    const writing = OPERATIONS.filter((operation) => names.includes(operation.name) && operation.writes).map((o) => o.name);
    assert.deepEqual(writing.sort(), ["find_or_create_buyer", "move_sale_sets", "sell_offer", "sell_offer_set"]);
  });

  it("deletes no sale and moves none — no such operation exists", () => {
    // The boundary as absence: nothing named for a delete, a status, payment or shipping of a sale.
    // One write is named for a sale and lets it be: adding the collector's own files to it (#2198),
    // which changes no line, amount or status. Named exactly, so anything else written under
    // `/sales` is still caught. A second moves sold sets to another open sale of the same buyer
    // (#2204) — every line stays sold, on one sale or the other, and no status or amount changes.
    const LEAVES_SALES_STANDING = ["add_sale_attachments", "move_sale_sets"];
    const offenders = OPERATIONS.filter((operation) => {
      if (LEAVES_SALES_STANDING.includes(operation.name)) return false;
      const words = operation.name.split("_");
      // An auction house's sale (#1627) is the auction register's, not a sale of the collector's.
      const aboutSales =
        !operation.path.startsWith("/auctions") &&
        (words.some((word) => ["sale", "sales"].includes(word)) || operation.path.startsWith("/sales"));
      return aboutSales && (operation.method !== "GET" || /(delete|remove|status|pay|paid|ship|send|sent|pack)/.test(operation.name));
    }).map((operation) => operation.name);
    assert.deepEqual(offenders, []);
  });

  describe("find_or_create_buyer", () => {
    it("creates a buyer with their profile link, then finds them by it and by name", async () => {
      const created = await ok<AgentBuyer>(token, "POST", "/buyers", {
        name: "Jan Nowak",
        facebook_profile: "https://m.facebook.com/jan.nowak.77/",
      });
      assert.equal(created.found, "created");
      assert.equal(created.facebookProfile, "https://www.facebook.com/jan.nowak.77");

      // The link alone finds them, whatever they are called today.
      const byProfile = await ok<AgentBuyer>(token, "POST", "/buyers", {
        name: "Janek N.",
        facebook_profile: "facebook.com/jan.nowak.77",
      });
      assert.deepEqual([byProfile.id, byProfile.found, byProfile.name], [created.id, "profile", "Jan Nowak"]);

      const byName = await ok<AgentBuyer>(token, "POST", "/buyers", { name: "  jan nowak " });
      assert.deepEqual([byName.id, byName.found], [created.id, "name"]);
    });

    it("finds a contact by name and gives it the link it lacked, telling nothing personal", async () => {
      const found = await ok<AgentBuyer>(token, "POST", "/buyers", {
        name: "Anna Zielińska",
        facebook_profile: "https://www.facebook.com/anna.z",
      });
      assert.equal(found.found, "name");
      assert.equal(found.facebookProfile, "https://www.facebook.com/anna.z");
      assert.deepEqual(found.facebookProfiles, ["https://www.facebook.com/anna.z"]);
      assert.deepEqual(Object.keys(found).sort(), ["facebookProfile", "facebookProfiles", "found", "id", "name"]);
      assert.doesNotMatch(JSON.stringify(found), /example\.com|\+48/);
    });

    it("finds a buyer by any of their profiles, answering with the one it was asked by (#2042)", async () => {
      const ola = await prisma.contact.create({
        data: {
          collectionId,
          name: "Ola Kot",
          facebookProfiles: {
            create: [
              { collectionId, url: "https://www.facebook.com/ola.kot", createdAt: new Date("2026-01-01") },
              { collectionId, url: "https://www.facebook.com/ola.kot.2", createdAt: new Date("2026-02-01") },
            ],
          },
        },
      });
      const second = await ok<AgentBuyer>(token, "POST", "/buyers", {
        name: "Aleksandra",
        facebook_profile: "https://m.facebook.com/ola.kot.2/",
      });
      assert.deepEqual([second.id, second.found, second.facebookProfile], [ola.id, "profile", "https://www.facebook.com/ola.kot.2"]);
      assert.deepEqual(second.facebookProfiles, ["https://www.facebook.com/ola.kot", "https://www.facebook.com/ola.kot.2"]);
      const byName = await ok<AgentBuyer>(token, "POST", "/buyers", { name: "Ola Kot" });
      assert.equal(byName.facebookProfile, "https://www.facebook.com/ola.kot", "the first, when none was asked");
    });

    it("refuses a name held by somebody with a different profile, a close name, and an empty call", async () => {
      const namesake = await refused(token, "POST", "/buyers", {
        name: "Piotr Wiśniewski",
        facebook_profile: "https://www.facebook.com/piotr.w.2",
      });
      assert.match(namesake.message, /different Facebook profile/);

      const close = await refused(token, "POST", "/buyers", { name: "Jan Nowakk" });
      assert.match(close.message, /close to a contact already in this collection: Jan Nowak/);
      const different = await ok<AgentBuyer>(token, "POST", "/buyers", { name: "Jan Nowakk", different_person: true });
      assert.equal(different.found, "created");

      const nobody = await refused(token, "POST", "/buyers", { facebook_profile: "https://www.facebook.com/never.seen" });
      assert.match(nobody.message, /name the buyer/);
      assert.match((await refused(token, "POST", "/buyers", {})).message, /"name", their "facebook_profile"/);
    });
  });

  describe("selling", () => {
    it("records one set into a new sale, then the rest into the same sale — marked, in the offer's currency", async () => {
      const offer = await facebookOffer(2);
      const first = await ok<AgentSale>(token, "POST", `/offers/${offer.id}/sets/${offer.setIds[0]}/sale`, {
        price: "15",
        buyer: "Jan Nowak",
        sold_at: "2026-10-15",
      });
      assert.equal(first.currency, "EUR", "a group's currency survives the platform's");
      assert.equal(first.soldAt, "2026-10-15");
      assert.equal(first.buyer?.name, "Jan Nowak");
      assert.deepEqual(
        first.lines.map((line) => [line.offerNo, line.setId, line.price]),
        [[offer.offerNo, offer.setIds[0], "15.00"]]
      );
      assert.equal(first.toReview?.created, true);
      assert.equal(first.toReview?.actions.length, 1);
      assert.match(first.toReview!.actions[0], new RegExp(`^added offer #${offer.offerNo} \\(.+\\) at 15\\.00 EUR$`));
      assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).state, "active");

      const second = await ok<AgentSale>(token, "POST", `/offers/${offer.id}/sale`, {
        price: "12.50",
        sale: first.id,
        buyer: "Jan Nowak",
      });
      assert.equal(second.id, first.id);
      assert.deepEqual(second.lines.map((line) => line.price).sort(), ["12.50", "15.00"]);
      assert.equal(second.toReview?.actions.length, 2, "a second write adds to the marker, never replaces it");
      assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).state, "sold");

      // What the sale screen reads is what the agent was told.
      const detail = await getSaleDetail(userId, first.id);
      assert.equal(detail?.grossProceeds, "27.50");
      assert.equal(detail?.apiReview?.created, true);

      const again = await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "1", sold_at: "2026-10-16" });
      assert.match(again.message, /is sold/);
    });

    it("refuses what the app refuses and what it cannot tell, writing nothing", async () => {
      const offer = await facebookOffer(1);
      const before = await prisma.sale.count({ where: { collectionId } });

      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5" })).message,
        /"sold_at" is required/
      );
      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5", sold_at: "2026-10-15", buyer: "Zbigniew" })).message,
        /find_or_create_buyer/
      );
      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5,00", sold_at: "2026-10-15" })).message,
        /is not a price/
      );
      assert.equal(
        (await refused(token, "POST", `/offers/${offer.id}/sets/nope/sale`, { price: "5", sold_at: "2026-10-15" })).status,
        404
      );

      // An existing sale: its own date, its own buyer, and never one already sent.
      const sale = await ok<AgentSale>(token, "POST", `/offers/${(await facebookOffer(1)).id}/sale`, {
        price: "4",
        buyer: "Anna Zielińska",
        sold_at: "2026-10-14",
      });
      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5", sale: sale.id, sold_at: "2026-10-15" })).message,
        /keeps its own date/
      );
      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5", sale: sale.id, buyer: "Jan Nowak" })).message,
        /different buyer/
      );
      await prisma.sale.update({ where: { id: sale.id }, data: { status: "sent" } });
      assert.match(
        (await refused(token, "POST", `/offers/${offer.id}/sale`, { price: "5", sale: sale.id })).message,
        /already been sent/
      );
      assert.equal(await prisma.sale.count({ where: { collectionId } }), before + 1, "only the sale made on purpose");
      assert.equal(await prisma.saleLine.count({ where: { offerId: offer.id } }), 0);
    });

    it("leaves no empty sale behind when a new sale's set is refused", async () => {
      // An offer left on an old currency after its platform's changed: the new sale is in the
      // platform's EUR, the offer in PLN, and the app refuses the line.
      const item = await newItem();
      const id = await createOffer(
        userId,
        collectionId,
        { platformId: delcampeId, url: null, price: "3.00", currency: "EUR", listingDate: null, state: "preparing" },
        { seedItemIds: [item] }
      );
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
      await prisma.offer.update({ where: { id }, data: { currency: "PLN" } });
      const before = await prisma.sale.count({ where: { collectionId } });
      assert.match(
        (await refused(token, "POST", `/offers/${id}/sale`, { price: "3", sold_at: "2026-10-15" })).message,
        /Re-list it/
      );
      assert.equal(await prisma.sale.count({ where: { collectionId } }), before);
    });

    it("refuses a draft, which has not been listed", async () => {
      const item = await newItem();
      const id = await createOffer(
        userId,
        collectionId,
        { platformId: delcampeId, url: null, price: "3.00", currency: "EUR", listingDate: null, state: "preparing" },
        { seedItemIds: [item] }
      );
      assert.match(
        (await refused(token, "POST", `/offers/${id}/sale`, { price: "3", sold_at: "2026-10-15" })).message,
        /is preparing/
      );
    });

    it("refuses a read token on every sale write, and takes it on the reads", async () => {
      const offer = await facebookOffer(1);
      for (const [path, body] of [
        ["/buyers", { name: "Ktoś Nowy" }],
        [`/offers/${offer.id}/sale`, { price: "1", sold_at: "2026-10-15" }],
        [`/offers/${offer.id}/sets/${offer.setIds[0]}/sale`, { price: "1", sold_at: "2026-10-15" }],
      ] as const) {
        assert.equal((await refused(readOnlyToken, "POST", path, body)).status, 403, path);
      }
      await ok(readOnlyToken, "GET", "/sales");
    });
  });

  describe("reading sales", () => {
    it("lists by buyer, status, days, review and number, stating the full total, and reads one in full", async () => {
      const mine = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?buyer=Jan%20Nowak");
      assert.equal(mine.total, 1);
      const row = mine.items[0];
      assert.equal(row.buyer, "Jan Nowak");
      assert.equal(row.sets, 2);
      assert.ok(row.toReview);

      const all = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?limit=1");
      assert.equal(all.items.length, 1);
      assert.ok(all.total >= 2, "the total is the match count, not the page");

      const sent = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?status=sent");
      assert.ok(sent.items.every((sale) => sale.status === "sent"));
      assert.equal(sent.total, 1);

      const day = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?sold_from=2026-10-15&sold_to=2026-10-15");
      assert.ok(day.items.every((sale) => sale.soldAt === "2026-10-15"));
      assert.ok(day.items.some((sale) => sale.id === row.id));

      const review = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?to_review=true");
      assert.equal(review.total, all.total, "every sale here was recorded through the API");

      const one = await ok<ListResponse<AgentSaleRow>>(token, "GET", `/sales?sale_no=${row.saleNo}`);
      assert.deepEqual(one.items.map((sale) => sale.id), [row.id]);

      const sale = await ok<AgentSale>(token, "GET", `/sales/${row.id}`);
      assert.equal(sale.lines.length, 2);
      assert.ok(sale.lines.every((line) => line.copies.length === 1 && typeof line.offerNo === "number"));
      assert.equal(sale.path, `/c/col-saleops-${ts}/sales/${row.id}`);

      assert.equal((await refused(token, "GET", "/sales/nope")).status, 404);
      assert.match((await refused(token, "GET", "/sales?buyer=Nobody%20Here")).message, /find_or_create_buyer/);
      assert.equal((await refused(token, "GET", "/sales?status=lost")).status, 400);
    });
  });

  // After the reads above, whose counts it would otherwise change.
  describe("move_sale_sets (#2204)", () => {
    it("splits a sale into a new one and back into an open one, both marked, under the screen's refusals", async () => {
      await prisma.contact.create({ data: { collectionId, name: "Ola Przenosząca", buyer: true } });
      const offer = await facebookOffer(3);
      const source = await ok<AgentSale>(token, "POST", `/offers/${offer.id}/sale`, {
        price: "4.50",
        buyer: "Ola Przenosząca",
        sold_at: "2026-10-20",
      });
      await prisma.sale.update({ where: { id: source.id }, data: { externalRef: "FB-7", commission: "1.00" } });
      assert.equal(source.lines.length, 3);
      const [first, second, third] = source.lines.map((line) => line.id);

      // Two of the three to a new sale.
      const split = await ok<{ from: AgentSale; to: AgentSale }>(token, "POST", `/sales/${source.id}/lines/move`, {
        lines: [first, second],
        to: "new",
      });
      assert.deepEqual(split.from.lines.map((line) => line.id), [third]);
      assert.deepEqual(split.to.lines.map((line) => line.id).sort(), [first, second].sort());
      assert.ok(split.to.lines.every((line) => line.price === "4.50"), "prices kept");
      assert.equal(split.to.buyer?.name, "Ola Przenosząca");
      assert.equal(split.to.externalRef, "FB-7");
      assert.equal(split.to.soldAt, "2026-10-20");
      assert.equal(split.to.currency, "EUR");
      assert.equal(split.to.status, "ordered");
      assert.equal(split.to.commission, null, "the new sale starts with no amounts");
      assert.equal(split.from.commission, "1.00", "the source keeps its own");
      assert.ok(split.to.toReview?.created, "the new sale is the API's");
      assert.ok(split.to.toReview?.actions.some((action) => action === `moved 2 sets (offer #${offer.offerNo}) from sale #${source.saleNo}`));
      assert.ok(split.from.toReview?.actions.some((action) => action === `moved 2 sets (offer #${offer.offerNo}) to sale #${split.to.saleNo}`));
      assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).state, "sold", "no offer changes");

      // One back into the open source, by its number.
      const back = await ok<{ from: AgentSale; to: AgentSale }>(token, "POST", `/sales/${split.to.id}/lines/move`, {
        lines: [first],
        to: `s${source.saleNo}`,
      });
      assert.equal(back.to.id, source.id);
      assert.equal(back.to.lines.length, 2);
      assert.equal(back.from.lines.length, 1);

      // Refused: every set, a sale of another buyer, a sent sale, a line not on the sale, nothing sent.
      assert.match(
        (await refused(token, "POST", `/sales/${split.to.id}/lines/move`, { lines: [second], to: "new" })).message,
        /every sold set/
      );
      const other = await ok<ListResponse<AgentSaleRow>>(token, "GET", "/sales?buyer=Jan%20Nowak");
      assert.match(
        (await refused(token, "POST", `/sales/${source.id}/lines/move`, { lines: [first], to: other.items[0].id })).message,
        /another buyer/
      );
      assert.match(
        (await refused(token, "POST", `/sales/${source.id}/lines/move`, { lines: [second], to: "new" })).message,
        /not on this sale/
      );
      assert.equal((await refused(token, "POST", `/sales/${source.id}/lines/move`, { lines: [first], to: "999999" })).status, 404);
      assert.equal((await refused(token, "POST", `/sales/${source.id}/lines/move`, { lines: [], to: "new" })).status, 400);
      await prisma.sale.update({ where: { id: source.id }, data: { status: "sent" } });
      assert.match(
        (await refused(token, "POST", `/sales/${source.id}/lines/move`, { lines: [first], to: "new" })).message,
        /already been sent/
      );
      assert.equal((await refused(readOnlyToken, "POST", `/sales/${source.id}/lines/move`, { lines: [first], to: "new" })).status, 403);
      // Every refusal left the lines where they were.
      assert.equal((await getSaleDetail(userId, source.id))!.lines.length, 2);
    });
  });
});
