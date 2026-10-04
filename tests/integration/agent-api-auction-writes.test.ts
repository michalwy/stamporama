import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { setModulePlatform } from "../../src/lib/module-platform";
import { ALLEGRO_PLATFORM_MODULE, PHILASEARCH_PLATFORM_MODULE } from "../../src/lib/platform-modules";
import {
  confirmAuctionLotReviews,
  setAuctionLotMaxBid,
  setAuctionLotMyBid,
} from "../../src/lib/auctions";
import { GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentAddedLot,
  AgentAuctionSale,
  AgentLotChange,
  AgentWrittenLot,
} from "../../src/lib/agent-api/operations/auction-writes";
import type { AgentTrackedListing } from "../../src/lib/agent-api/auction-reads";

// **The auction writes (#1627), driven through the real route with a real token.**
//
// The pure grammar is `tests/unit/agent-api-auction-writes.test.ts`; that the writers mark and never
// bid, and that only their own module reaches them, is `tests/unit/agent-api-operation-boundary.test.ts`.
// What only a database can answer is the issue's *Done when*: that a lot **joins or starts the right
// sale** by the capture's rule on Allegro and on Philasearch, that a listing already tracked is
// **refused with the lot that has it**, and that **every write leaves the *to review* marker** and
// none touches the collector's own bid. Each is read back off the rows as well as off the answer,
// because an answer built from the request would agree with itself.
//
// Everything is in EUR, the collection's base currency, so no exchange rate is ever fetched.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH";
const HANDLERS = { GET, POST, PATCH };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: Method, path: string, body?: unknown) {
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

describe("auction writes through the agent API (#1627)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let allegroId: string;
  let philasearchId: string;
  let mi1: string;
  let st2: string;
  let st2No: number;
  let unpriced: string;

  const marker = async (lotId: string) =>
    prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: {
        apiReviewAt: true,
        apiReviewCreated: true,
        apiReviewFields: true,
        myBid: true,
        maxBid: true,
        ceilingNote: true,
        checkedAt: true,
      },
    });
  const lotCount = () => prisma.auctionLot.count({ where: { auctionSale: { collectionId } } });

  before(async () => {
    userId = `test-user-auctionwrites-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auctionwrites-${ts}`,
        email: `test-auctionwrites-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-auctionwrites-${ts}`, name: `Collection auctionwrites-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    allegroId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true, platformCurrency: "EUR" } })
    ).id;
    await setModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE, allegroId);
    philasearchId = (
      await prisma.contact.create({ data: { collectionId, name: "Philasearch", platform: true } })
    ).id;
    await setModulePlatform(collectionId, PHILASEARCH_PLATFORM_MODULE, philasearchId);
    await prisma.contact.create({
      data: {
        collectionId,
        name: "Philkam",
        seller: true,
        defaultCurrency: "EUR",
        buyerPremiumPercent: "10",
        defaultShippingCost: "8",
      },
    });
    await prisma.contact.create({
      data: { collectionId, name: "Köhler", seller: true, defaultCurrency: "EUR", buyerPremiumPercent: "20" },
    });

    for (const [name, abbreviation, sortOrder] of [
      ["Mint Never Hinged", "MNH", 0],
      ["Mint Hinged", "MH", 1],
      ["Used", "U", 2],
    ] as const) {
      await prisma.stampCondition.create({ data: { collectionId, name, abbreviation, sortOrder } });
    }
    await prisma.certificateStatus.create({ data: { collectionId, name: "Attest", abbreviation: "A", sortOrder: 0 } });

    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polen", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id } })
    ).id;
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: 9627, collectionAreaId: areaId, name: "Definitives", year: 1950 },
    });
    const stamp = async (name: string, number: string | null) => {
      const row = await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1950 } });
      await prisma.stampCollectionArea.create({ data: { stampId: row.id, collectionAreaId: areaId, isPrimary: true } });
      await prisma.issueMember.create({ data: { issueId: issue.id, stampId: row.id } });
      if (number) {
        await prisma.stampCatalogNumber.create({ data: { stampId: row.id, catalogVendorId: vendor.id, number } });
      }
      return row;
    };
    mi1 = (await stamp("One", "1")).id;
    const two = await stamp("Two", "2");
    st2 = two.id;
    st2No = two.stampNo;
    unpriced = (await stamp("Three", "3")).id;

    token = (await createAssistantToken(userId, collectionId, { label: "auction agent", scope: "read_write", kind: "agent" }))
      .token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const closes = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  let allegroLot: AgentAddedLot;
  /** Stored with an address and no number, so only the address can recognise it. */
  let addressOnlyLotId: string;

  describe("add_auction_lot on Allegro — the seller's open sale", () => {
    it("starts the seller's sale, seeded with their premium and shipping, and marks both for review", async () => {
      allegroLot = await ok<AgentAddedLot>(token, "POST", "/auctions/lots", {
        platform: "Allegro",
        seller: "Philkam",
        url: "https://allegro.pl/oferta/fi-348-357-18795065609",
        lot_number: "18795065609",
        title: "Fi 1-3",
        starting_price: "20",
        ends_at: closes.toISOString(),
        ceiling: "120.00",
        ceiling_note: "recommend_bid fair at MNH, no certificate",
        lines: [
          "stamp=Mi 1; condition=MNH",
          `stamp=st ${st2No}; condition=MNH|MH; quantity=2`,
          `stamp=${unpriced}; condition=unknown; certificate=Attest`,
        ],
        tags: ["agent-found", "Agent-Found"],
      });
      assert.equal(allegroLot.saleCreated, true);
      assert.equal(allegroLot.sale.name, "Philkam · Allegro");
      assert.equal(allegroLot.sale.premiumPercent, "10.00");
      assert.equal(allegroLot.sale.shippingCost, "8.00");
      assert.deepEqual(allegroLot.sale.toReview && { created: allegroLot.sale.toReview.created, changed: allegroLot.sale.toReview.changed }, { created: true, changed: [] });

      const lot = allegroLot.lot;
      assert.equal(lot.saleId, allegroLot.sale.saleId);
      assert.equal(lot.startingPrice, "20.00");
      assert.equal(lot.ceiling, "120.00");
      assert.equal(lot.ceilingSetApart, true);
      assert.equal(lot.ceilingNote, "recommend_bid fair at MNH, no certificate");
      assert.equal(lot.myBid, undefined, "nothing bids");
      assert.deepEqual(lot.tags, ["agent-found"]);
      assert.deepEqual(
        lot.lines.map((line) => [line.stampId, line.condition, line.possibleConditions, line.conditionUnknown, line.certificate, line.quantity]),
        [
          [mi1, "MNH", undefined, undefined, undefined, 1],
          [st2, undefined, ["MNH", "MH"], undefined, undefined, 2],
          [unpriced, undefined, undefined, true, "A", 1],
        ]
      );
      assert.equal(lot.conditionToSettle, true);
      assert.equal(lot.toReview?.created, true);

      const row = await marker(lot.lotId);
      assert.ok(row.apiReviewAt, "the lot is marked");
      assert.equal(row.apiReviewCreated, true);
      assert.equal(row.myBid, null);
      const sale = await prisma.auctionSale.findUniqueOrThrow({ where: { id: lot.saleId }, select: { apiReviewAt: true } });
      assert.ok(sale.apiReviewAt, "the sale it started is marked");
    });

    it("joins that sale with the next lot, and leaves the sale's own marker alone", async () => {
      const before = await prisma.auctionSale.findUniqueOrThrow({
        where: { id: allegroLot.sale.saleId },
        select: { apiReviewAt: true, apiReviewFields: true },
      });
      const second = await ok<AgentAddedLot>(token, "POST", "/auctions/lots", {
        platform: allegroId,
        seller: "philkam",
        url: "https://allegro.pl/oferta/18795077777",
        ends_at: closes.toISOString(),
      });
      addressOnlyLotId = second.lot.lotId;
      assert.equal(second.saleCreated, false);
      assert.equal(second.sale.saleId, allegroLot.sale.saleId);
      assert.equal(second.sale.lots, 2);
      assert.equal(second.lot.lines.length, 0);
      const after = await prisma.auctionSale.findUniqueOrThrow({
        where: { id: allegroLot.sale.saleId },
        select: { apiReviewAt: true, apiReviewFields: true },
      });
      assert.deepEqual(after, before);
    });

    it("refuses a listing already tracked, by its number in another address, with the lot that has it", async () => {
      const count = await lotCount();
      for (const body of [
        { url: "https://allegro.pl/oferta/18795065609?bi_s=mail" },
        { url: "https://allegro.pl/produkt/x?offerId=18795065609" },
        { lot_number: "18795065609" },
      ]) {
        const { status, error } = await refused(token, "POST", "/auctions/lots", {
          platform: "Allegro",
          seller: "Philkam",
          ends_at: closes.toISOString(),
          ...body,
        });
        assert.equal(status, 400);
        assert.deepEqual(error.accepted, [allegroLot.lot.lotId], JSON.stringify(body));
        assert.match(error.message, /already tracked as lot \d+/);
      }
      // A lot stored with only its address is found by the number at the address's boundaries,
      // whatever shape the link sent is in.
      const { error } = await refused(token, "POST", "/auctions/lots", {
        platform: "Allegro",
        seller: "Philkam",
        ends_at: closes.toISOString(),
        url: "https://allegro.pl/oferta/a-slug-ending-18795077777#opis",
      });
      assert.deepEqual(error.accepted, [addressOnlyLotId]);
      assert.equal(await lotCount(), count, "nothing was written");
    });

    it("agrees with find_tracked_auction_lots about the listing", async () => {
      const answer = await ok<{ listings: AgentTrackedListing[] }>(
        token,
        "GET",
        "/auctions/tracked?listings=18795065609"
      );
      assert.equal(answer.listings[0].lotId, allegroLot.lot.lotId);
    });

    it("refuses the whole lot when one line names no stamp, and writes nothing", async () => {
      const count = await lotCount();
      const { error } = await refused(token, "POST", "/auctions/lots", {
        platform: "Allegro",
        seller: "Philkam",
        url: "https://allegro.pl/oferta/18795099999",
        ends_at: closes.toISOString(),
        lines: ["stamp=Mi 1; condition=MNH", "stamp=Mi 999; condition=MNH"],
      });
      assert.match(error.message, /Mi 999/);
      assert.equal(await lotCount(), count);
    });

    it("refuses a seller it does not know rather than creating one", async () => {
      const { error } = await refused(token, "POST", "/auctions/lots", {
        platform: "Allegro",
        seller: "Philkamm",
        ends_at: closes.toISOString(),
      });
      assert.match(error.message, /Philkam/);
      assert.equal(await prisma.contact.count({ where: { collectionId, name: "Philkamm" } }), 0);
    });
  });

  describe("add_auction_lot on Philasearch — the house's sale of that name", () => {
    let k385: AgentAddedLot;

    it("asks for the sale's name", async () => {
      const { error } = await refused(token, "POST", "/auctions/lots", {
        platform: "Philasearch",
        seller: "Köhler",
        lot_number: "12",
        ends_at: closes.toISOString(),
      });
      assert.match(error.message, /sale_name/);
    });

    it("starts the named sale, and the next lot of it joins without a seller and takes its closing time", async () => {
      k385 = await ok<AgentAddedLot>(token, "POST", "/auctions/lots", {
        platform: "Philasearch",
        seller: "Köhler",
        sale_name: "Köhler 385",
        lot_number: "12",
        url: "https://www.philasearch.com/de/i_9081-A66-9850",
        ends_at: closes.toISOString(),
        not_stamps: true,
        not_stamps_description: "Michel Europe 2019",
      });
      assert.equal(k385.saleCreated, true);
      assert.equal(k385.sale.name, "Köhler 385");
      assert.equal(k385.sale.seller, "Köhler");
      assert.equal(k385.sale.premiumPercent, "20.00");
      assert.equal(k385.lot.notStamps, true);
      assert.equal(k385.lot.notStampsDescription, "Michel Europe 2019");

      const next = await ok<AgentAddedLot>(token, "POST", "/auctions/lots", {
        platform: "Philasearch",
        sale_name: "köhler 385",
        lot_number: "13",
      });
      assert.equal(next.saleCreated, false);
      assert.equal(next.sale.saleId, k385.sale.saleId);
      assert.equal(next.lot.endsAt, k385.sale.endsAt);
    });

    it("refuses a house's lot number again within its sale, and takes it in the next sale", async () => {
      const { error } = await refused(token, "POST", "/auctions/lots", {
        platform: "Philasearch",
        sale_name: "Köhler 385",
        lot_number: "12",
      });
      assert.deepEqual(error.accepted, [k385.lot.lotId]);

      const next = await ok<AgentAddedLot>(token, "POST", "/auctions/lots", {
        platform: "Philasearch",
        seller: "Köhler",
        sale_name: "Köhler 386",
        lot_number: "12",
        ends_at: closes.toISOString(),
      });
      assert.equal(next.saleCreated, true);
      assert.notEqual(next.sale.saleId, k385.sale.saleId);
    });

    it("refuses lines on a lot that is not stamps", async () => {
      const { error } = await refused(token, "POST", `/auctions/lots/${k385.lot.lotId}/lines`, {
        lines: ["stamp=Mi 1; condition=MNH"],
      });
      assert.match(error.message, /not stamps/);
    });
  });

  describe("update_auction_lot", () => {
    it("records the current bid with when it was checked, and adds to the marker", async () => {
      const checkedAt = new Date(Date.now() - 60 * 60 * 1000);
      const change = await ok<AgentLotChange>(token, "PATCH", `/auctions/lots/${allegroLot.lot.lotId}`, {
        current_bid: "45",
        checked_at: checkedAt.toISOString(),
        title: "Fi 1-3, used",
        tags: ["agent-found", "danzig"],
      });
      assert.deepEqual(change.changed, ["title", "currentBid", "tags"]);
      assert.equal(change.lot.currentBid, "45.00");
      assert.equal(change.lot.checkedAt, checkedAt.toISOString());
      assert.deepEqual(change.lot.tags, ["agent-found", "danzig"]);
      const row = await marker(allegroLot.lot.lotId);
      assert.equal(row.apiReviewCreated, true, "created stays until confirmed");
      assert.deepEqual(row.apiReviewFields, ["title", "currentBid", "tags"]);
      assert.equal(row.myBid, null);
    });

    it("writes nothing and marks nothing when everything sent is already so", async () => {
      const before = await marker(allegroLot.lot.lotId);
      const change = await ok<AgentLotChange>(token, "PATCH", `/auctions/lots/${allegroLot.lot.lotId}`, {
        title: "Fi 1-3, used",
        tags: ["Danzig", "agent-found"],
      });
      assert.deepEqual(change.changed, []);
      assert.deepEqual(await marker(allegroLot.lot.lotId), before);
    });

    it("refuses an address another lot already tracks", async () => {
      const second = await ok<AgentTrackedListingsAnswer>(token, "GET", "/auctions/tracked?listings=18795077777");
      const { error } = await refused(token, "PATCH", `/auctions/lots/${second.listings[0].lotId}`, {
        url: "https://allegro.pl/oferta/18795065609",
      });
      assert.deepEqual(error.accepted, [allegroLot.lot.lotId]);
    });

    it("starts a fresh marker on a lot the collector has confirmed", async () => {
      await confirmAuctionLotReviews(userId, collectionId, [allegroLot.lot.lotId]);
      assert.equal((await marker(allegroLot.lot.lotId)).apiReviewAt, null);
      await ok<AgentLotChange>(token, "PATCH", `/auctions/lots/${allegroLot.lot.lotId}`, { current_bid: "45.00" });
      const row = await marker(allegroLot.lot.lotId);
      assert.ok(row.apiReviewAt);
      assert.equal(row.apiReviewCreated, false);
      assert.deepEqual(row.apiReviewFields, ["currentBid"]);
    });
  });

  describe("set_auction_lot_lines", () => {
    it("replaces the lines and marks the contents", async () => {
      const { lot } = await ok<{ lot: AgentWrittenLot }>(token, "POST", `/auctions/lots/${allegroLot.lot.lotId}/lines`, {
        lines: [`stamp=${st2}; condition=U; quantity=4`],
      });
      assert.deepEqual(
        lot.lines.map((line) => [line.stampId, line.condition, line.quantity]),
        [[st2, "U", 4]]
      );
      assert.equal(lot.conditionToSettle, false);
      assert.ok((await marker(allegroLot.lot.lotId)).apiReviewFields.includes("lines"));
    });

    it("leaves every line in place when one does not resolve", async () => {
      const { error } = await refused(token, "POST", `/auctions/lots/${allegroLot.lot.lotId}/lines`, {
        lines: ["stamp=Mi 1; condition=MNH", "stamp=Mi 1; condition=Mint"],
      });
      assert.match(error.message, /Mint/);
      const lines = await prisma.auctionLotLine.findMany({ where: { auctionLotId: allegroLot.lot.lotId } });
      assert.deepEqual(lines.map((line) => [line.stampId, line.quantity]), [[st2, 4]]);
    });
  });

  describe("set_auction_lot_ceiling", () => {
    it("sets and clears the ceiling with its note, never the bid", async () => {
      await setAuctionLotMyBid(userId, allegroLot.lot.lotId, "50.00");
      const set = await ok<{ lot: AgentWrittenLot }>(token, "POST", `/auctions/lots/${allegroLot.lot.lotId}/ceiling`, {
        ceiling: "150",
        note: "recommend_bid fair at U",
      });
      assert.equal(set.lot.ceiling, "150.00");
      assert.equal(set.lot.ceilingNote, "recommend_bid fair at U");
      assert.equal(set.lot.myBid, "50.00");
      assert.ok((await marker(allegroLot.lot.lotId)).apiReviewFields.includes("ceiling"));

      const cleared = await ok<{ lot: AgentWrittenLot }>(token, "POST", `/auctions/lots/${allegroLot.lot.lotId}/ceiling`, {
        clear: true,
      });
      assert.equal(cleared.lot.ceilingSetApart, false, "the ceiling follows the bid again");
      assert.equal(cleared.lot.ceilingNote, undefined);
      const row = await marker(allegroLot.lot.lotId);
      assert.equal(row.maxBid, null);
      assert.equal(row.ceilingNote, null);
      assert.equal(row.myBid?.toFixed(2), "50.00");
    });

    it("loses its note when the collector changes the ceiling in the app", async () => {
      await ok(token, "POST", `/auctions/lots/${allegroLot.lot.lotId}/ceiling`, { ceiling: "150", note: "why" });
      await setAuctionLotMaxBid(userId, allegroLot.lot.lotId, "150.00");
      assert.equal((await marker(allegroLot.lot.lotId)).ceilingNote, "why", "an unchanged figure keeps it");
      await setAuctionLotMaxBid(userId, allegroLot.lot.lotId, "160.00");
      assert.equal((await marker(allegroLot.lot.lotId)).ceilingNote, null);
    });
  });

  describe("update_auction_sale", () => {
    it("edits the terms and marks the sale with what changed", async () => {
      const answer = await ok<{ sale: AgentAuctionSale; changed: string[] }>(
        token,
        "PATCH",
        `/auctions/sales/${allegroLot.sale.saleId}`,
        { premium_percent: "15", premium_fixed: "1.5", shipping_cost: "8.00", name: "Philkam parcel" }
      );
      assert.deepEqual(answer.changed, ["name", "premium"]);
      assert.equal(answer.sale.premiumPercent, "15.00");
      assert.equal(answer.sale.premiumFixed, "1.50");
      const sale = await prisma.auctionSale.findUniqueOrThrow({
        where: { id: allegroLot.sale.saleId },
        select: { apiReviewCreated: true, apiReviewFields: true },
      });
      assert.deepEqual(sale, { apiReviewCreated: true, apiReviewFields: ["name", "premium"] });
    });

    it("refuses an amount it would have to guess at", async () => {
      const { error } = await refused(token, "PATCH", `/auctions/sales/${allegroLot.sale.saleId}`, {
        shipping_cost: "8,50",
      });
      assert.match(error.message, /shipping_cost/);
    });
  });
});

interface AgentTrackedListingsAnswer {
  listings: AgentTrackedListing[];
}
