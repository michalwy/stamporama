import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { setModulePlatform } from "../../src/lib/module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "../../src/lib/platform-modules";
import {
  confirmAuctionLotReviews,
  getAuctionLotDetail,
  recordAuctionLotTransition,
  setAuctionLotMyBid,
  settleAuctionSale,
} from "../../src/lib/auctions";
import { POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentAddedLot, AgentLotOutcome } from "../../src/lib/agent-api/operations/auction-writes";

// **Recording how an auction ended through the agent API (#1628)**, driven through the real route.
//
// The issue's *Done when* is that the derived outcome **matches what the app shows for the same
// figures**, so every case is run twice — one lot closed through `recordAuctionLotTransition`, the
// row's ⋮ menu, and its twin through `record_auction_lot_outcome` — and the two outcomes are read off
// the same `getAuctionLotDetail` the lots screen is built from. Then: the lot carries the *to review*
// marker afterwards, nothing is ever settled into a purchase, and a settled lot is refused.
//
// Everything is in EUR, the collection's base currency, so no exchange rate is ever fetched.

const ts = Date.now();

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, path: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ path: path.split("/").filter(Boolean) }) });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("record_auction_lot_outcome (#1628)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let lotSerial = 0;

  const ok = async <T>(path: string, body: unknown): Promise<T> => {
    const answer = await call(token, path, body);
    assert.equal(answer.status, 200, `POST ${path} → ${JSON.stringify(answer.body)}`);
    return answer.body as T;
  };
  const refused = async (path: string, body: unknown) => {
    const answer = await call(token, path, body);
    assert.equal(answer.status, 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
    return (answer.body as ApiErrorBody).error;
  };

  /** A lot added through the API, its review confirmed so the outcome's marker stands alone, with
   *  the collector's own bid set as the app sets it. */
  const newLot = async (myBid: string | null): Promise<string> => {
    lotSerial += 1;
    const added = await ok<AgentAddedLot>("/auctions/lots", {
      platform: "Allegro",
      seller: "Philkam",
      lot_number: String(18796280000 + lotSerial),
      ends_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const lotId = added.lot.lotId;
    await confirmAuctionLotReviews(userId, collectionId, [lotId]);
    if (myBid !== null) await setAuctionLotMyBid(userId, lotId, myBid);
    return lotId;
  };
  const detail = async (lotId: string) => {
    const lot = await getAuctionLotDetail(userId, collectionId, lotId);
    assert.ok(lot);
    return lot;
  };
  const review = (lotId: string) =>
    prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { apiReviewAt: true, apiReviewCreated: true, apiReviewFields: true, myBid: true },
    });

  before(async () => {
    userId = `test-user-auctionoutcome-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auctionoutcome-${ts}`,
        email: `test-auctionoutcome-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-auctionoutcome-${ts}`, name: `Collection auctionoutcome-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const allegroId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true, platformCurrency: "EUR" } })
    ).id;
    await setModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE, allegroId);
    await prisma.contact.create({
      data: { collectionId, name: "Philkam", seller: true, defaultCurrency: "EUR", buyerPremiumPercent: "10" },
    });
    token = (await createAssistantToken(userId, collectionId, { label: "auction agent", scope: "read_write", kind: "agent" }))
      .token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("derives the outcome the app derives from the same figures", () => {
    const CASES: {
      name: string;
      myBid: string | null;
      finalPrice: string | null;
      wonTie?: boolean;
      expected: string;
    }[] = [
      { name: "went for less than the collector's bid", myBid: "50.00", finalPrice: "45.00", expected: "won" },
      { name: "went for more than the collector's bid", myBid: "50.00", finalPrice: "60.00", expected: "lost" },
      { name: "a tie the collector's bid came first in", myBid: "50.00", finalPrice: "50.00", wonTie: true, expected: "won" },
      { name: "a tie the collector's bid came second in", myBid: "50.00", finalPrice: "50.00", wonTie: false, expected: "lost" },
      { name: "watched only, with what it fetched", myBid: null, finalPrice: "30.00", expected: "observed" },
      { name: "watched only, vanished before the result was seen", myBid: null, finalPrice: null, expected: "observed" },
    ];

    for (const c of CASES) {
      it(c.name, async () => {
        const inApp = await newLot(c.myBid);
        await recordAuctionLotTransition(userId, inApp, {
          status: "closed",
          finalPrice: c.finalPrice,
          wonTie: c.wonTie ?? null,
        });

        const viaApi = await newLot(c.myBid);
        const answer = await ok<AgentLotOutcome>(`/auctions/lots/${viaApi}/outcome`, {
          status: "closed",
          ...(c.finalPrice !== null ? { final_price: c.finalPrice } : {}),
          ...(c.wonTie !== undefined ? { won_tie: c.wonTie } : {}),
        });

        const app = await detail(inApp);
        const api = await detail(viaApi);
        assert.equal(app.outcome, c.expected);
        assert.equal(api.outcome, app.outcome);
        assert.equal(api.status, "closed");
        assert.equal(api.finalPrice, app.finalPrice);
        assert.equal(api.wonTie, app.wonTie);
        assert.equal(answer.outcome, app.outcome, "the answer states what the app shows");
        assert.equal(answer.status, "closed");
        assert.equal(answer.finalPrice, c.finalPrice ?? undefined);
        assert.deepEqual(answer.changed, ["outcome"]);
        assert.deepEqual(answer.lot.toReview?.changed, ["outcome"]);

        const row = await review(viaApi);
        assert.ok(row.apiReviewAt, "the lot waits for review");
        assert.deepEqual(row.apiReviewFields, ["outcome"]);
        assert.equal(row.apiReviewCreated, false);
        assert.equal(row.myBid?.toFixed(2) ?? null, c.myBid, "the collector's bid is untouched");
      });
    }
  });

  describe("refuses what the app refuses, and writes nothing", () => {
    it("asks for the final price of a lot the collector bid on", async () => {
      const lotId = await newLot("50.00");
      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "closed" });
      assert.equal(error.code, "invalid_request");
      assert.match(error.message, /"final_price" is required/);
      const lot = await detail(lotId);
      assert.equal(lot.status, "open");
      assert.equal((await review(lotId)).apiReviewAt, null);
    });

    it("asks who won a tie", async () => {
      const lotId = await newLot("50.00");
      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "50" });
      assert.match(error.message, /"won_tie" is required/);
      assert.equal((await detail(lotId)).status, "open");
      assert.equal((await review(lotId)).apiReviewAt, null);
    });

    it("never reopens a lot", async () => {
      const lotId = await newLot(null);
      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "open" });
      assert.deepEqual(error.accepted, ["closed", "cancelled"]);
    });

    it("takes no price with a cancellation", async () => {
      const lotId = await newLot(null);
      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "cancelled", final_price: "10" });
      assert.match(error.message, /cancelled lot has no result/);
    });

    it("refuses a price it would have to guess at", async () => {
      const lotId = await newLot("50.00");
      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "45,00" });
      assert.match(error.message, /not an amount for "final_price"/);
    });
  });

  describe("cancelling, correcting, and what it leaves alone", () => {
    it("cancels a lot, clearing a price recorded before", async () => {
      const lotId = await newLot("50.00");
      await ok(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "45" });
      await confirmAuctionLotReviews(userId, collectionId, [lotId]);
      const answer = await ok<AgentLotOutcome>(`/auctions/lots/${lotId}/outcome`, { status: "cancelled" });
      assert.equal(answer.outcome, "cancelled");
      assert.equal(answer.finalPrice, undefined);
      const lot = await detail(lotId);
      assert.equal(lot.status, "cancelled");
      assert.equal(lot.finalPrice, null);
      assert.deepEqual((await review(lotId)).apiReviewFields, ["outcome"]);
    });

    it("corrects the final price of a closed lot, and the outcome follows the money", async () => {
      const lotId = await newLot("50.00");
      await ok(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "45" });
      const corrected = await ok<AgentLotOutcome>(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "55" });
      assert.equal(corrected.outcome, "lost");
      assert.equal(corrected.finalPrice, "55.00");
      assert.deepEqual(corrected.changed, ["outcome"]);
    });

    it("writes and marks nothing when the same result is already recorded", async () => {
      const lotId = await newLot("50.00");
      await ok(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "45" });
      await confirmAuctionLotReviews(userId, collectionId, [lotId]);
      const again = await ok<AgentLotOutcome>(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "45.00" });
      assert.deepEqual(again.changed, []);
      assert.equal(again.outcome, "won");
      assert.equal((await review(lotId)).apiReviewAt, null);
    });

    it("settles nothing into a purchase, and leaves a settled lot alone", async () => {
      assert.equal(await prisma.purchase.count({ where: { collectionId } }), 0, "no close above settled anything");

      // One more lot won in the seller's basket, settled in the app as the collector does.
      const added = await ok<AgentAddedLot>("/auctions/lots", {
        platform: "Allegro",
        seller: "Philkam",
        lot_number: "18796289999",
        ends_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });
      const lotId = added.lot.lotId;
      await setAuctionLotMyBid(userId, lotId, "50.00");
      await ok(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "40" });
      assert.equal(await prisma.purchase.count({ where: { collectionId } }), 0);

      // Every lot above is in the same basket, and a parcel settles only once none is still open.
      const sale = await prisma.auctionSale.findUniqueOrThrow({
        where: { id: added.sale.saleId },
        select: { lots: { select: { id: true, status: true } } },
      });
      for (const other of sale.lots) {
        if (other.status === "open") await recordAuctionLotTransition(userId, other.id, { status: "cancelled" });
      }
      await settleAuctionSale(userId, added.sale.saleId, {
        purchasedAt: new Date().toISOString().slice(0, 10),
        shippingCost: null,
        lots: [{ lotId, price: 44 }],
      });

      const error = await refused(`/auctions/lots/${lotId}/outcome`, { status: "closed", final_price: "41" });
      assert.match(error.message, /settled into a purchase/);
      assert.equal((await detail(lotId)).finalPrice, "40.00");
    });
  });
});
