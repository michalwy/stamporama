import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createPurchaseExpense } from "../../src/lib/purchase-expenses";
import { getPurchaseDetail } from "../../src/lib/lots";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentPurchase,
  AgentPurchaseRow,
  AgentSeller,
  AgentSpend,
  AgentPurchaseLot,
  AgentPurchaseExpense,
} from "../../src/lib/agent-api/purchase-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Purchases through the agent API (#1390), driven through the real route with real tokens.**
//
// `tests/unit/agent-api-purchase-reads.test.ts` holds the projections and the seller rules, and
// `tests/unit/agent-api-operation-boundary.test.ts` holds *no copies, nothing irreversible, no
// existing contact* as a fact about what the operation module imports. This file holds the rest:
// that the *Done when* is a real sequence of calls, that every write lands where the purchase screen
// reads it (`getPurchaseDetail`, the screen's own read), and that the refusals are refusals.
//
// EUR throughout, so no exchange rate is fetched and the suite runs offline; the one foreign-currency
// purchase is written straight to the table with its rate stated.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(
  token: string,
  method: Method,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
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

/** Everything any call answered, so the privacy assertion reads every response the suite saw. */
const seen: string[] = [];

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  seen.push(JSON.stringify(answer.body));
  return answer.body as T;
}

async function refused(
  token: string,
  method: Method,
  path: string,
  body?: unknown
): Promise<{ status: number; error: ApiErrorBody["error"] }> {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  seen.push(JSON.stringify(answer.body));
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("the purchase operations (#1390)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let philkamId: string;
  let bronekId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    userId = `test-user-purchaseops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User purchaseops-${ts}`,
        email: `test-purchaseops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-purchaseops-${ts}`, name: "Purchase ops", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    // A seller carrying every private field the surface must never repeat.
    philkamId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Philkam",
          seller: true,
          email: `philkam-${ts}@example.com`,
          phone: "+48 600 700 800",
          notes: "Pays late, ships fast.",
        },
      })
    ).id;
    // Filed under a marketplace login, found by the name one remembers (#463).
    bronekId = (
      await prisma.contact.create({
        data: { collectionId, name: "bronek_1980", fullName: "Bronisław Kowalski", seller: true },
      })
    ).id;
    // Two contacts one name apart only in case — which the unique index allows and a seller name
    // cannot tell apart.
    await prisma.contact.create({ data: { collectionId, name: "Jan Nowak", seller: true } });
    await prisma.contact.create({ data: { collectionId, name: "jan nowak", buyer: true } });
    await prisma.contact.create({
      data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" },
    });

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Test stamp", issuedYear: 1938 } })).id;

    token = (
      await createAssistantToken(userId, collectionId, { label: "purchase agent", scope: "read_write", kind: "agent" })
    ).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "purchase agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("an order entered end to end", () => {
    let purchaseId: string;
    let sellerId: string;
    let albumLotId: string;
    let spareLotId: string;
    let expenseId: string;

    it("refuses a seller nobody knows, and points at creating one", async () => {
      const { status, error } = await refused(token, "POST", "/purchases", {
        seller: "Zbigniew Nieznany",
        purchased_at: "2026-09-20",
      });
      assert.equal(status, 400);
      assert.match(error.message, /create_seller/);
      assert.equal(await prisma.contact.count({ where: { collectionId } }), 5, "nothing was created");
    });

    it("creates the seller, filed under their login with the name beside it", async () => {
      const seller = await ok<AgentSeller>(token, "POST", "/sellers", {
        name: "Zbigniew Nieznany",
        marketplace_login: "zbych_77",
      });
      assert.deepEqual(Object.keys(seller).sort(), ["id", "name"]);
      assert.equal(seller.name, "zbych_77");
      sellerId = seller.id;

      const row = await prisma.contact.findUniqueOrThrow({ where: { id: sellerId } });
      assert.equal(row.fullName, "Zbigniew Nieznany");
      assert.equal(row.seller, true);
      assert.equal(row.email, null);
      assert.equal(row.phone, null);
      assert.equal(row.notes, null);
    });

    it("enters the purchase against that seller and a platform it already knows", async () => {
      const purchase = await ok<AgentPurchase>(token, "POST", "/purchases", {
        seller: "zbych_77",
        platform: "Allegro",
        purchased_at: "2026-09-20",
        shipping_cost: "5.00",
      });
      purchaseId = purchase.purchaseId;
      assert.deepEqual(purchase.seller, { id: sellerId, name: "zbych_77" });
      assert.equal(purchase.platform, "Allegro");
      assert.equal(purchase.currency, "EUR", "the base currency by default");
      assert.equal(purchase.status, "preparing");
      assert.equal(purchase.editable, true);
      assert.deepEqual(purchase.lots, []);
      assert.equal(purchase.spend.paid.total, "5.00");
      assert.equal(purchase.spend.base?.total, "5.00");
      assert.match(purchase.path, new RegExp(`/purchases/${purchaseId}$`));
    });

    it("adds lots, and each one moves how the shipping is spread", async () => {
      const album = await ok<{ lot: AgentPurchaseLot; purchaseSpend: AgentSpend }>(
        token,
        "POST",
        `/purchases/${purchaseId}/lots`,
        { title: "Album Polska 1950s", price: "45.00" }
      );
      albumLotId = album.lot.lotId;
      assert.equal(album.lot.status, "open");
      assert.equal(album.lot.copies, 0);
      assert.equal(album.lot.removable, true);
      assert.equal(album.purchaseSpend.paid.total, "50.00");
      assert.equal(album.lot.spend.paid.shipping, "5.00", "the only line takes all of the shipping");

      const spare = await ok<{ lot: AgentPurchaseLot; purchaseSpend: AgentSpend }>(
        token,
        "POST",
        `/purchases/${purchaseId}/lots`,
        { price: "5.00" }
      );
      spareLotId = spare.lot.lotId;
      assert.equal(spare.lot.title, undefined);
      assert.equal(spare.purchaseSpend.paid.total, "55.00");
      assert.equal(spare.lot.spend.paid.shipping, "0.50", "a tenth of the price takes a tenth of the shipping");
    });

    it("renames and reprices an open lot, and takes a title off", async () => {
      const renamed = await ok<{ lot: AgentPurchaseLot }>(token, "PATCH", `/purchase-lots/${albumLotId}`, {
        title: "Album Polska 1960s",
      });
      assert.equal(renamed.lot.title, "Album Polska 1960s");
      assert.equal(renamed.lot.price, "45.00", "a rename leaves the price alone");

      const repriced = await ok<{ lot: AgentPurchaseLot }>(token, "PATCH", `/purchase-lots/${albumLotId}`, {
        price: "40.00",
      });
      assert.equal(repriced.lot.title, "Album Polska 1960s", "a reprice leaves the title alone");
      assert.equal(repriced.lot.price, "40.00");

      const cleared = await ok<{ lot: AgentPurchaseLot }>(token, "PATCH", `/purchase-lots/${spareLotId}`, {
        clear: ["title"],
      });
      assert.equal(cleared.lot.title, undefined);
    });

    it("adds, restates and removes an expense, which takes its share of the shipping", async () => {
      const added = await ok<{ expense: AgentPurchaseExpense; purchaseSpend: AgentSpend }>(
        token,
        "POST",
        `/purchases/${purchaseId}/expenses`,
        { label: "Magnifier", price: "15.00" }
      );
      expenseId = added.expense.expenseId;
      assert.deepEqual(added.expense, { expenseId, label: "Magnifier", price: "15.00" });
      // 40 + 5 + 15 + 5 shipping.
      assert.equal(added.purchaseSpend.paid.total, "65.00");

      const restated = await ok<{ expense: AgentPurchaseExpense }>(
        token,
        "PATCH",
        `/purchase-expenses/${expenseId}`,
        { price: "20.00" }
      );
      assert.deepEqual(restated.expense, { expenseId, label: "Magnifier", price: "20.00" });

      const purchase = await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`);
      // The album is 40 of 65 priced, so it takes 40/65 of the 5.00 shipping.
      assert.equal(purchase.lots.find((l) => l.lotId === albumLotId)?.spend.paid.shipping, "3.08");

      // A second one to remove, so the one above is still there for the screen check below.
      const spare = await createPurchaseExpense(userId, purchaseId, { label: "Tongs", price: 3 });
      const removed = await ok<{ removed: number; purchaseSpend: AgentSpend }>(
        token,
        "DELETE",
        `/purchase-expenses/${spare}`
      );
      assert.equal(removed.removed, 1);
      assert.equal(removed.purchaseSpend.paid.total, "70.00");
    });

    it("removes an empty lot", async () => {
      const removed = await ok<{ removed: number; purchaseSpend: AgentSpend }>(
        token,
        "DELETE",
        `/purchase-lots/${spareLotId}`
      );
      assert.equal(removed.removed, 1);
      assert.equal(removed.purchaseSpend.paid.total, "65.00");
    });

    it("corrects the header, changing only what was sent and never the status", async () => {
      await prisma.purchase.update({ where: { id: purchaseId }, data: { status: "in_transit" } });
      const updated = await ok<AgentPurchase>(token, "PATCH", `/purchases/${purchaseId}`, {
        purchased_at: "2026-09-21",
        clear: ["platform"],
      });
      assert.equal(updated.purchasedAt, "2026-09-21");
      assert.equal(updated.platform, undefined);
      assert.deepEqual(updated.seller, { id: sellerId, name: "zbych_77" }, "the seller is left alone");
      assert.equal(updated.shippingCost, "5.00", "the shipping is left alone");
      assert.equal(updated.status, "in_transit", "the status is restated, never moved");

      const reseller = await ok<AgentPurchase>(token, "PATCH", `/purchases/${purchaseId}`, {
        seller: "Bronisław Kowalski",
      });
      assert.deepEqual(reseller.seller, { id: bronekId, name: "bronek_1980" });
    });

    it("leaves every change where the purchase screen reads it", async () => {
      const detail = await getPurchaseDetail(userId, purchaseId);
      assert.ok(detail);
      assert.equal(detail.contactId, bronekId);
      assert.equal(detail.platformId, null);
      assert.equal(detail.purchasedAt, "2026-09-21");
      assert.deepEqual(
        detail.lots.map((lot) => [lot.title, lot.price]),
        [["Album Polska 1960s", "40.00"]]
      );
      assert.deepEqual(
        detail.expenses.map((expense) => [expense.label, expense.price]),
        [["Magnifier", "20.00"]]
      );
      assert.equal(detail.spend.tx.total, "65.00");
    });

    it("finds it by seller, by date and by number — with a read-only token too", async () => {
      const bySeller = await ok<ListResponse<AgentPurchaseRow>>(
        readOnlyToken,
        "GET",
        "/purchases?seller=bronek_1980"
      );
      assert.equal(bySeller.total, 1);
      assert.equal(bySeller.items[0].purchaseId, purchaseId);
      assert.equal(bySeller.items[0].total, "65.00");

      const inRange = await ok<ListResponse<AgentPurchaseRow>>(
        readOnlyToken,
        "GET",
        "/purchases?purchased_from=2026-09-21&purchased_to=2026-09-21"
      );
      assert.deepEqual(inRange.items.map((row) => row.purchaseId), [purchaseId]);
      const outOfRange = await ok<ListResponse<AgentPurchaseRow>>(
        readOnlyToken,
        "GET",
        "/purchases?purchased_to=2026-09-20"
      );
      assert.ok(!outOfRange.items.some((row) => row.purchaseId === purchaseId));

      const byNumber = await ok<ListResponse<AgentPurchaseRow>>(
        readOnlyToken,
        "GET",
        `/purchases?purchase_no=${inRange.items[0].purchaseNo}`
      );
      assert.equal(byNumber.total, 1);

      const read = await ok<AgentPurchase>(readOnlyToken, "GET", `/purchases/${purchaseId}`);
      assert.equal(read.purchaseId, purchaseId);
    });
  });

  describe("the refusals", () => {
    let purchaseId: string;
    let lotId: string;
    let expenseId: string;

    before(async () => {
      purchaseId = (
        await ok<AgentPurchase>(token, "POST", "/purchases", { seller: philkamId, purchased_at: "2026-08-01" })
      ).purchaseId;
      lotId = (
        await ok<{ lot: AgentPurchaseLot }>(token, "POST", `/purchases/${purchaseId}/lots`, { price: "10.00" })
      ).lot.lotId;
      expenseId = (
        await ok<{ expense: AgentPurchaseExpense }>(token, "POST", `/purchases/${purchaseId}/expenses`, {
          label: "Catalogue",
          price: "30.00",
        })
      ).expense.expenseId;
    });

    it("refuses a read-only token on every writing operation, naming the scope needed", async () => {
      const writes: [Method, string, unknown][] = [
        ["POST", "/sellers", { name: "Somebody New" }],
        ["POST", "/purchases", { purchased_at: "2026-08-01" }],
        ["PATCH", `/purchases/${purchaseId}`, { shipping_cost: "1.00" }],
        ["POST", `/purchases/${purchaseId}/lots`, { price: "1.00" }],
        ["PATCH", `/purchase-lots/${lotId}`, { price: "1.00" }],
        ["DELETE", `/purchase-lots/${lotId}`, undefined],
        ["POST", `/purchases/${purchaseId}/expenses`, { label: "x", price: "1.00" }],
        ["PATCH", `/purchase-expenses/${expenseId}`, { price: "1.00" }],
        ["DELETE", `/purchase-expenses/${expenseId}`, undefined],
      ];
      // Every writing purchase operation is on that list — a new one cannot be added and forgotten.
      const writing = OPERATIONS.filter(
        (op) => op.writes && /^\/(purchases|purchase-|sellers)/.test(op.path)
      );
      assert.equal(writing.length, writes.length);
      for (const [method, path, body] of writes) {
        const { status, error } = await refused(readOnlyToken, method, path, body);
        assert.equal(status, 403, `${method} ${path}`);
        assert.equal(error.code, "forbidden");
        assert.ok(error.accepted?.includes("read_write"), `${method} ${path} names the scope`);
      }
      assert.equal(await prisma.purchaseLot.count({ where: { id: lotId } }), 1);
      assert.equal(await prisma.purchaseExpense.count({ where: { id: expenseId } }), 1);
    });

    it("refuses an ambiguous seller with the candidates", async () => {
      const { error } = await refused(token, "GET", "/purchases?seller=Jan%20Nowak");
      assert.equal(error.accepted?.length, 2);
      assert.match(error.message, /Jan Nowak/);
      assert.match(error.message, /jan nowak/);
    });

    it("refuses a new seller close to an existing contact, unless told it is somebody else", async () => {
      const close = await refused(token, "POST", "/sellers", { name: "Philkamm" });
      assert.deepEqual(close.error.accepted, [philkamId]);
      assert.match(close.error.message, /different_person/);

      const created = await ok<AgentSeller>(token, "POST", "/sellers", {
        name: "Philkamm",
        different_person: true,
      });
      assert.equal(created.name, "Philkamm");

      // A name already filed is refused whatever the agent says — it is that contact.
      const same = await refused(token, "POST", "/sellers", { name: "PHILKAM", different_person: true });
      assert.deepEqual(same.error.accepted, [philkamId]);
    });

    it("never removes a lot holding copies, and leaves the copy where it was", async () => {
      const copy = await createItem(userId, collectionId, { stampId, conditionId, lotId });
      const { error } = await refused(token, "DELETE", `/purchase-lots/${lotId}`);
      assert.match(error.message, /never touches copies/);
      assert.equal(await prisma.purchaseLot.count({ where: { id: lotId } }), 1);
      assert.equal(await prisma.item.count({ where: { id: copy.id, lotId } }), 1);

      const purchase = await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`);
      assert.equal(purchase.lots[0].copies, 1);
      assert.equal(purchase.lots[0].removable, false);
    });

    it("refuses to change a closed lot", async () => {
      await prisma.purchaseLot.update({ where: { id: lotId }, data: { status: "closed" } });
      const { error } = await refused(token, "PATCH", `/purchase-lots/${lotId}`, { title: "Renamed" });
      assert.match(error.message, /closed/);
      assert.equal((await prisma.purchaseLot.findUniqueOrThrow({ where: { id: lotId } })).title, null);
    });

    it("refuses a malformed amount or date rather than guessing", async () => {
      for (const body of [
        { purchased_at: "2026-02-30" },
        { purchased_at: "2026-08-01", shipping_cost: "12,50" },
        { purchased_at: "2026-08-01", shipping_cost: "-1" },
      ]) {
        const { status } = await refused(token, "POST", "/purchases", body);
        assert.equal(status, 400, JSON.stringify(body));
      }
    });

    it("does not reach an opening balance", async () => {
      const opening = await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 9001,
          kind: "opening_balance",
          title: "Klaser Polska 1",
          purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
          currency: "EUR",
          status: "arrived",
        },
      });
      const { status } = await refused(token, "GET", `/purchases/${opening.id}`);
      assert.equal(status, 404);
      const list = await ok<ListResponse<AgentPurchaseRow>>(token, "GET", "/purchases?limit=100");
      assert.ok(!list.items.some((row) => row.purchaseId === opening.id));
      await assert.rejects(
        createPurchaseExpense(userId, opening.id, { label: "x", price: 1 }),
        /opening balance/
      );
    });

    it("says a missing exchange rate in words, and states a frozen one", async () => {
      async function foreign(rate: string | null): Promise<AgentPurchase> {
        const row = await prisma.purchase.create({
          data: {
            collectionId,
            purchaseNo: rate === null ? 9002 : 9003,
            purchasedAt: new Date("2026-08-02T00:00:00.000Z"),
            currency: "CHF",
            fxRateToBase: rate,
            shippingCost: "10.00",
          },
        });
        return ok<AgentPurchase>(token, "GET", `/purchases/${row.id}`);
      }
      const unconvertible = await foreign(null);
      assert.equal(unconvertible.spend.paid.total, "10.00");
      assert.equal(unconvertible.spend.base, null);
      assert.match(unconvertible.spend.baseMissing ?? "", /No exchange rate to EUR/);

      const converted = await foreign("0.95");
      assert.equal(converted.spend.base?.currency, "EUR");
      assert.equal(converted.spend.base?.total, "9.50");
    });
  });

  describe("the boundary", () => {
    it("publishes exactly these purchase operations, and nothing that closes, arrives or deletes", () => {
      const purchaseOps = OPERATIONS.filter((op) => /^\/(purchases|purchase-|sellers)/.test(op.path))
        .map((op) => `${op.method} ${op.path} ${op.name}`)
        .sort();
      assert.deepEqual(purchaseOps, [
        "DELETE /purchase-expenses/{expenseId} remove_purchase_expense",
        "DELETE /purchase-lots/{lotId} remove_purchase_lot",
        "GET /purchases list_purchases",
        "GET /purchases/{purchaseId} get_purchase",
        "PATCH /purchase-expenses/{expenseId} update_purchase_expense",
        "PATCH /purchase-lots/{lotId} update_purchase_lot",
        "PATCH /purchases/{purchaseId} update_purchase",
        "POST /purchases create_purchase",
        "POST /purchases/{purchaseId}/expenses add_purchase_expense",
        "POST /purchases/{purchaseId}/lots add_purchase_lot",
        "POST /sellers create_seller",
      ]);
      const forbidden = new Set(["close", "reopen", "arrive", "arrived", "delete", "copy", "copies", "contact", "status"]);
      for (const op of OPERATIONS) {
        assert.ok(
          !op.name.split("_").some((word) => forbidden.has(word) && /purchase|lot|seller|contact/.test(op.name)),
          `${op.name} reads as a purchase act this surface does not take`
        );
      }
    });

    it("never said a seller's email, phone or notes in any answer above", () => {
      const everything = seen.join("\n");
      assert.ok(seen.length > 20, "the suite read its answers");
      for (const secret of [`philkam-${ts}@example.com`, "+48 600 700 800", "Pays late"]) {
        assert.ok(!everything.includes(secret), `${secret} reached an agent`);
      }
    });
  });
});
