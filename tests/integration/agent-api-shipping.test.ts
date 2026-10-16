import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentCarrier,
  AgentPackingSupply,
  AgentShippingOption,
  AgentSupplyUse,
} from "../../src/lib/agent-api/shipping-reads";
import type { AgentPurchase } from "../../src/lib/agent-api/purchase-reads";
import type { AgentSupplyUseChange } from "../../src/lib/agent-api/operations/shipping";
import type { AgentSupplyLineChange } from "../../src/lib/agent-api/operations/purchases";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Shipping and packing data through the agent API (#1910), driven through the real route with real
// tokens.** `tests/unit/agent-api-shipping-reads.test.ts` holds the grammars and the projections;
// `tests/unit/agent-api-operation-boundary.test.ts` holds *these writes and no delete* as a fact
// about imports. This file holds the *Done when* as calls: carriers and their rate lists created and
// corrected, a platform's shipping options linked to a service, supplies created and renamed, a
// purchase's supply line added and read back, a use without a sale recorded and corrected — and the
// screens' refusals: a name already taken, a tracking address without `{code}`, a supply the
// collection does not have, a use larger than the stock, a trade's incoming half, an opening
// balance, and a read-only token on every write.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH";
const HANDLERS = { GET, POST, PATCH };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("shipping and packing data through the agent API (#1910)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let allegroId: string;
  let partnerId: string;
  let poczta: AgentCarrier;
  let envelope: AgentPackingSupply;
  let card: AgentPackingSupply;
  let option: AgentShippingOption;
  let purchaseId: string;
  let useId: string;

  before(async () => {
    userId = `test-user-shipping-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User shipping-${ts}`,
        email: `test-shipping-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-shipping-${ts}`, name: "Shipping", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    allegroId = (
      await prisma.platform.create({
        data: { collectionId, name: "Allegro", platformCurrency: "PLN" },
      })
    ).id;
    await prisma.platform.create({ data: { collectionId, name: "Delcampe", platformCurrency: "EUR" } });
    partnerId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nováková" } })).id;

    token = (await createAssistantToken(userId, collectionId, { label: "shipping agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (await createAssistantToken(userId, collectionId, { label: "shipping agent, read", scope: "read", kind: "agent" })).token;
  });

  describe("packing supplies", () => {
    it("creates supplies, refuses a name already taken, and renames one", async () => {
      envelope = await ok<AgentPackingSupply>(token, "POST", "/packing-supplies", { name: "C6 envelope" });
      assert.equal(envelope.name, "C6 envelope");
      assert.equal(envelope.onHand, 0);
      assert.deepEqual(envelope.batches, []);

      card = await ok<AgentPackingSupply>(token, "POST", "/packing-supplies", { name: "Transport card" });
      const taken = await refused(token, "POST", "/packing-supplies", { name: "C6 envelope" });
      assert.equal(taken.status, 400);
      assert.match(taken.error.message, new RegExp(envelope.supplyId));

      card = await ok<AgentPackingSupply>(token, "PATCH", `/packing-supplies/${card.supplyId}`, {
        name: "Transport card A6",
      });
      assert.equal(card.name, "Transport card A6");
      const clash = await refused(token, "PATCH", `/packing-supplies/${card.supplyId}`, { name: "C6 envelope" });
      assert.equal(clash.status, 400);
    });
  });

  describe("carriers and their rate lists", () => {
    it("creates a carrier with a tracking address, and refuses one without {code}", async () => {
      const bad = await refused(token, "POST", "/carriers", {
        name: "Poczta Polska",
        tracking_url: "https://emonitoring.poczta-polska.pl/",
      });
      assert.equal(bad.status, 400);
      assert.match(bad.error.message, /\{code\}/);

      poczta = await ok<AgentCarrier>(token, "POST", "/carriers", {
        name: "Poczta Polska",
        tracking_url: "https://emonitoring.poczta-polska.pl/?numer={code}",
      });
      assert.equal(poczta.trackingUrl, "https://emonitoring.poczta-polska.pl/?numer={code}");
      assert.deepEqual(poczta.services, []);

      const twice = await refused(token, "POST", "/carriers", { name: "Poczta Polska" });
      assert.match(twice.error.message, new RegExp(poczta.carrierId));
    });

    it("adds services with their cost and usual supplies, by supply name", async () => {
      poczta = await ok<AgentCarrier>(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "List polecony",
        cost: "9.50",
        supplies: ["c6 envelope: 1", "Transport card A6: 2"],
      });
      const service = poczta.services[0];
      assert.equal(service.label, "Poczta Polska / List polecony");
      assert.equal(service.cost, "9.50");
      assert.equal(service.currency, "PLN", "the base currency when none is sent");
      assert.deepEqual(
        service.supplies.map((s) => `${s.name}: ${s.quantity}`),
        ["C6 envelope: 1", "Transport card A6: 2"]
      );

      poczta = await ok<AgentCarrier>(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Paczka",
        cost: "14",
        currency: "PLN",
      });
      assert.deepEqual(poczta.services.map((s) => s.name), ["List polecony", "Paczka"]);
    });

    it("refuses a supply the collection does not have, one listed twice, and a name already on the carrier", async () => {
      const unknown = await refused(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Priority",
        cost: "12.00",
        supplies: ["C5 envelope: 1"],
      });
      assert.deepEqual(unknown.error.accepted, ["C6 envelope", "Transport card A6"]);

      const twice = await refused(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Priority",
        cost: "12.00",
        supplies: ["C6 envelope: 1", `${envelope.supplyId}: 2`],
      });
      assert.match(twice.error.message, /listed twice/);

      const noQuantity = await refused(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Priority",
        cost: "12.00",
        supplies: ["C6 envelope"],
      });
      assert.match(noQuantity.error.message, /name: quantity/);

      const taken = await refused(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Paczka",
        cost: "12.00",
      });
      assert.match(taken.error.message, /already has a service named "Paczka"/);

      const badCost = await refused(token, "POST", `/carriers/${poczta.carrierId}/services`, {
        name: "Priority",
        cost: "12,00",
      });
      assert.equal(badCost.status, 400);
      assert.equal(await prisma.carrierService.count({ where: { carrierId: poczta.carrierId } }), 2);
    });

    it("corrects a service — only what is sent — and replaces or empties its supplies", async () => {
      const serviceId = poczta.services.find((s) => s.name === "List polecony")!.serviceId;
      poczta = await ok<AgentCarrier>(token, "PATCH", `/carrier-services/${serviceId}`, { cost: "10.20" });
      let service = poczta.services.find((s) => s.serviceId === serviceId)!;
      assert.equal(service.cost, "10.20");
      assert.equal(service.supplies.length, 2, "supplies not sent are kept");

      poczta = await ok<AgentCarrier>(token, "PATCH", `/carrier-services/${serviceId}`, {
        supplies: ["C6 envelope: 1"],
      });
      service = poczta.services.find((s) => s.serviceId === serviceId)!;
      assert.deepEqual(service.supplies.map((s) => s.name), ["C6 envelope"]);

      const paczkaId = poczta.services.find((s) => s.name === "Paczka")!.serviceId;
      await ok(token, "PATCH", `/carrier-services/${paczkaId}`, { supplies: ["Transport card A6: 1"] });
      poczta = await ok<AgentCarrier>(token, "PATCH", `/carrier-services/${paczkaId}`, { clear: ["supplies"] });
      assert.deepEqual(poczta.services.find((s) => s.serviceId === paczkaId)!.supplies, []);

      const nothing = await refused(token, "PATCH", `/carrier-services/${serviceId}`, {});
      assert.match(nothing.error.message, /Nothing to change/);
      const missing = await refused(token, "PATCH", "/carrier-services/no-such-service", { cost: "1.00" });
      assert.equal(missing.status, 404);
    });

    it("renames a carrier and takes its tracking address off", async () => {
      const second = await ok<AgentCarrier>(token, "POST", "/carriers", { name: "InPost" });
      const clash = await refused(token, "PATCH", `/carriers/${second.carrierId}`, { name: "Poczta Polska" });
      assert.equal(clash.status, 400);

      const renamed = await ok<AgentCarrier>(token, "PATCH", `/carriers/${poczta.carrierId}`, {
        name: "Poczta Polska S.A.",
        clear: ["tracking_url"],
      });
      assert.equal(renamed.name, "Poczta Polska S.A.");
      assert.equal(renamed.trackingUrl, undefined);
      assert.equal(renamed.services[0].label, "Poczta Polska S.A. / List polecony");

      const list = await ok<ListResponse<AgentCarrier>>(token, "GET", "/carriers");
      assert.equal(list.total, 2);
      assert.deepEqual(list.items.map((c) => c.name), ["InPost", "Poczta Polska S.A."]);
    });
  });

  describe("platform shipping options", () => {
    it("creates an option on a platform, linked to a service by its label, in the platform's currency", async () => {
      option = await ok<AgentShippingOption>(token, "POST", "/shipping-options", {
        platform: "allegro",
        name: "Registered letter",
        price: "12.00",
        service: "Poczta Polska S.A. / List polecony",
      });
      assert.equal(option.platformId, allegroId);
      assert.equal(option.currency, "PLN");
      assert.equal(option.service?.label, "Poczta Polska S.A. / List polecony");
      assert.equal(option.service?.cost, "10.20");

      const euro = await ok<AgentShippingOption>(token, "POST", "/shipping-options", {
        platform: "Delcampe",
        name: "Registered letter",
        price: "4.00",
        service: "List polecony",
      });
      assert.equal(euro.currency, "EUR", "the platform's own currency");

      const carriers = await ok<ListResponse<AgentCarrier>>(token, "GET", "/carriers");
      const listPolecony = carriers.items.flatMap((c) => c.services).find((s) => s.name === "List polecony")!;
      assert.equal(listPolecony.optionCount, 2);
    });

    it("refuses a name already on the platform, an unknown platform and an ambiguous service", async () => {
      const twice = await refused(token, "POST", "/shipping-options", {
        platform: "Allegro",
        name: "Registered letter",
        price: "13.00",
      });
      assert.match(twice.error.message, /already has a shipping option/);

      const notPlatform = await refused(token, "POST", "/shipping-options", {
        platform: "Anna Nováková",
        name: "Courier",
        price: "13.00",
      });
      assert.equal(notPlatform.status, 400);

      const inpost = (await ok<ListResponse<AgentCarrier>>(token, "GET", "/carriers")).items.find(
        (c) => c.name === "InPost"
      )!;
      await ok(token, "POST", `/carriers/${inpost.carrierId}/services`, { name: "Paczka", cost: "11.00" });
      const ambiguous = await refused(token, "POST", "/shipping-options", {
        platform: "Allegro",
        name: "Parcel",
        price: "15.00",
        service: "Paczka",
      });
      assert.equal(ambiguous.error.accepted?.length, 2);
    });

    it("corrects an option and unlinks its service", async () => {
      const repriced = await ok<AgentShippingOption>(token, "PATCH", `/shipping-options/${option.optionId}`, {
        price: "12.50",
      });
      assert.equal(repriced.price, "12.50");
      assert.equal(repriced.service?.label, "Poczta Polska S.A. / List polecony", "kept when not sent");

      const unlinked = await ok<AgentShippingOption>(token, "PATCH", `/shipping-options/${option.optionId}`, {
        clear: ["service"],
      });
      assert.equal(unlinked.service, undefined);
      const both = await refused(token, "PATCH", `/shipping-options/${option.optionId}`, {
        service: "Paczka",
        clear: ["service"],
      });
      assert.match(both.error.message, /both sent and named in "clear"/);
    });

    it("lists the options by platform, and one platform's alone", async () => {
      const all = await ok<ListResponse<AgentShippingOption>>(token, "GET", "/shipping-options");
      assert.deepEqual(all.items.map((o) => `${o.platform}: ${o.name}`), [
        "Allegro: Registered letter",
        "Delcampe: Registered letter",
      ]);
      const allegro = await ok<ListResponse<AgentShippingOption>>(token, "GET", "/shipping-options?platform=Allegro");
      assert.equal(allegro.total, 1);
    });
  });

  describe("supply lines on a purchase", () => {
    it("adds a line to a purchase, reads it back there and in the stock", async () => {
      const purchase = await ok<AgentPurchase>(token, "POST", "/purchases", {
        purchased_at: "2026-10-01",
        shipping_cost: "10.00",
      });
      purchaseId = purchase.purchaseId;
      const added = await ok<AgentSupplyLineChange>(token, "POST", `/purchases/${purchaseId}/supply-lines`, {
        supply: "C6 envelope",
        quantity: 100,
        price: "30.00",
      });
      assert.equal(added.supplyLine.supply, "C6 envelope");
      assert.equal(added.supplyLine.quantity, 100);
      assert.equal(added.supplyLine.unitCost, "0.4000", "price plus all of the order's shipping, per unit");
      assert.equal(added.purchaseSpend.paid.total, "40.00");

      const read = await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`);
      assert.deepEqual(read.supplyLines.map((l) => l.lineId), [added.supplyLine.lineId]);

      const stock = await ok<ListResponse<AgentPackingSupply> & { baseCurrency: string; totalValueBase?: string }>(
        token,
        "GET",
        "/packing-supplies"
      );
      const c6 = stock.items.find((s) => s.supplyId === envelope.supplyId)!;
      assert.equal(c6.onHand, 100);
      assert.equal(c6.valueBase, "40.00");
      assert.equal(c6.batches[0].purchaseId, purchaseId);
      assert.equal(stock.baseCurrency, "PLN");
      assert.equal(stock.totalValueBase, "40.00");
    });

    it("refuses a trade's incoming half and does not reach an opening balance", async () => {
      const trade = await prisma.trade.create({
        data: { collectionId, tradeNo: 1, partnerId, currency: "PLN" },
      });
      const incoming = await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 8001,
          tradeId: trade.id,
          purchasedAt: new Date("2026-10-02T00:00:00.000Z"),
          currency: "PLN",
        },
      });
      const fromTrade = await refused(token, "POST", `/purchases/${incoming.id}/supply-lines`, {
        supply: "C6 envelope",
        quantity: 10,
        price: "1.00",
      });
      assert.match(fromTrade.error.message, /incoming half of a trade/);

      const opening = await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 8002,
          kind: "opening_balance",
          title: "Shelf",
          purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
          currency: "PLN",
          status: "arrived",
        },
      });
      const notReached = await refused(token, "POST", `/purchases/${opening.id}/supply-lines`, {
        supply: "C6 envelope",
        quantity: 10,
        price: "1.00",
      });
      assert.equal(notReached.status, 404);
      assert.equal(await prisma.purchaseSupplyLine.count({ where: { purchaseId: { in: [incoming.id, opening.id] } } }), 0);
    });
  });

  describe("uses without a sale", () => {
    it("records a use, costed from the oldest batch", async () => {
      const recorded = await ok<AgentSupplyUseChange>(token, "POST", "/supply-uses", {
        supply: "C6 envelope",
        quantity: 10,
        used_on: "2026-10-05",
        note: "storage",
      });
      assert.equal(recorded.use.kind, "own");
      assert.equal(recorded.use.costBase, "4.00");
      assert.equal(recorded.use.note, "storage");
      assert.equal(recorded.supply.onHand, 90);
      useId = recorded.use.useId!;
    });

    it("refuses a use larger than what is on hand, and one of a supply never bought", async () => {
      const tooMany = await refused(token, "POST", "/supply-uses", {
        supply: "C6 envelope",
        quantity: 91,
        used_on: "2026-10-06",
      });
      assert.match(tooMany.error.message, /Only 90/);
      const none = await refused(token, "POST", "/supply-uses", {
        supply: "Transport card A6",
        quantity: 1,
        used_on: "2026-10-06",
      });
      assert.match(none.error.message, /No “Transport card A6” on hand/);
      const badDate = await refused(token, "POST", "/supply-uses", {
        supply: "C6 envelope",
        quantity: 1,
        used_on: "2026-02-30",
      });
      assert.equal(badDate.status, 400);
      assert.equal(await prisma.supplyOwnUse.count({ where: { collectionId } }), 1);
    });

    it("corrects a use — only what is sent — and takes its note off", async () => {
      const raised = await ok<AgentSupplyUseChange>(token, "PATCH", `/supply-uses/${useId}`, { quantity: 15 });
      assert.equal(raised.use.quantity, 15);
      assert.equal(raised.use.note, "storage", "kept when not sent");
      assert.equal(raised.supply.onHand, 85);

      const tooMany = await refused(token, "PATCH", `/supply-uses/${useId}`, { quantity: 101 });
      assert.match(tooMany.error.message, /on hand/);

      const cleared = await ok<AgentSupplyUseChange>(token, "PATCH", `/supply-uses/${useId}`, { clear: ["note"] });
      assert.equal(cleared.use.note, undefined);
      assert.equal(cleared.use.quantity, 15);
    });

    it("lists the supply's history with the use's id", async () => {
      const history = await ok<ListResponse<AgentSupplyUse> & { onHand: number }>(
        token,
        "GET",
        `/packing-supplies/${envelope.supplyId}/history`
      );
      assert.equal(history.total, 1);
      assert.equal(history.onHand, 85);
      assert.equal(history.items[0].useId, useId);
      const missing = await refused(token, "GET", "/packing-supplies/no-such-supply/history");
      assert.equal(missing.status, 404);
    });
  });

  describe("the boundary", () => {
    it("refuses a read-only token on every writing operation", async () => {
      const serviceId = poczta.services[0].serviceId;
      for (const [method, path, body] of [
        ["POST", "/carriers", { name: "DHL" }],
        ["PATCH", `/carriers/${poczta.carrierId}`, { name: "x" }],
        ["POST", `/carriers/${poczta.carrierId}/services`, { name: "x", cost: "1.00" }],
        ["PATCH", `/carrier-services/${serviceId}`, { cost: "1.00" }],
        ["POST", "/shipping-options", { platform: "Allegro", name: "x", price: "1.00" }],
        ["PATCH", `/shipping-options/${option.optionId}`, { price: "1.00" }],
        ["POST", "/packing-supplies", { name: "x" }],
        ["PATCH", `/packing-supplies/${envelope.supplyId}`, { name: "x" }],
        ["POST", `/purchases/${purchaseId}/supply-lines`, { supply: "C6 envelope", quantity: 1, price: "1.00" }],
        ["POST", "/supply-uses", { supply: "C6 envelope", quantity: 1, used_on: "2026-10-07" }],
        ["PATCH", `/supply-uses/${useId}`, { quantity: 1 }],
      ] as const) {
        const { status, error } = await refused(readOnlyToken, method, path, body);
        assert.equal(status, 403, `${method} ${path}`);
        assert.equal(error.code, "forbidden");
      }
      for (const path of ["/carriers", "/shipping-options", "/packing-supplies", `/packing-supplies/${envelope.supplyId}/history`]) {
        await ok(readOnlyToken, "GET", path);
      }
    });

    it("publishes exactly these operations, and none deletes", () => {
      const ops = OPERATIONS.filter((op) =>
        /^\/(carriers|carrier-services|shipping-options|packing-supplies|supply-uses)/.test(op.path) ||
        op.path.endsWith("/supply-lines")
      )
        .map((op) => `${op.method} ${op.path} ${op.name} ${op.writes}`)
        .sort();
      assert.deepEqual(ops, [
        "GET /carriers list_carriers false",
        "GET /packing-supplies list_packing_supplies false",
        "GET /packing-supplies/{supplyId}/history get_packing_supply_history false",
        "GET /shipping-options list_shipping_options false",
        "PATCH /carrier-services/{serviceId} update_carrier_service true",
        "PATCH /carriers/{carrierId} update_carrier true",
        "PATCH /packing-supplies/{supplyId} update_packing_supply true",
        "PATCH /shipping-options/{optionId} update_shipping_option true",
        "PATCH /supply-uses/{useId} update_supply_use true",
        "POST /carriers create_carrier true",
        "POST /carriers/{carrierId}/services add_carrier_service true",
        "POST /packing-supplies create_packing_supply true",
        "POST /purchases/{purchaseId}/supply-lines add_purchase_supply_line true",
        "POST /shipping-options create_shipping_option true",
        "POST /supply-uses record_supply_use true",
      ]);
    });
  });
});
