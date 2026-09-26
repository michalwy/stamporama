import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { setAllegroPlatform } from "../../src/lib/allegro";
import { auctionLotExposure, listAuctionLots } from "../../src/lib/auctions";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { GET } from "../../src/app/api/v1/[...path]/route";
import type {
  AgentAuctionExposure,
  AgentTrackedListing,
  AgentWatchlistLot,
} from "../../src/lib/agent-api/auction-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **The auction reads (#1036), driven through the real route with a real `read` token.**
//
// `tests/unit/agent-api-auction-reads.test.ts` holds every projection and
// `tests/unit/agent-api-operation-boundary.test.ts` holds the read-only boundary as a fact about
// imports. What neither can hold is what this issue's *Done when* is actually about: **that the
// figures an agent is given are the figures the auction screens show for the same lots.** That is a
// claim about two code paths agreeing, and it is checkable only against a real database — so each
// read below is compared with the domain read its screen is drawn from, **and** with the answer the
// fixture's own figures give by hand. Either half alone can be green over a shared mistake.
//
// The fixture is one parcel in the collection's own currency, so no exchange rate is ever fetched:
//
// | lot | state | bid | placed | ceiling | why it is here |
// | --- | --- | --- | --- | --- | --- |
// | A | open, closes in an hour | 40 | 50 | 70 | leading, with room left under the ceiling |
// | B | open, closes in two days | 60 | 50 | 55 | outbid, and past the ceiling — out of both totals |
// | C | open, closes in five days | — | — | — | nobody has bid; opened at 20 |
// | E | open, closes in a week | — | — | — | nobody has bid either |
// | D | closed, fetched 30 | — | 35 | — | won — filed, so off the watchlist |
//
// Premium 10% + 1.00 a lot, shipping 5.00 a parcel. **E exists so that no two exposure counts are
// equal**: with one uncapped lot and one outpriced one, a projection crossing the two over passed
// every assertion here, which was measured by crossing them.

const ts = Date.now();

function v1(token: string, path: string): { request: NextRequest; context: { params: Promise<{ path: string[] }> } } {
  const [pathname, search] = path.split("?");
  return {
    request: new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
    context: { params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }) },
  };
}

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function get<T>(token: string, path: string): Promise<T> {
  const { request, context } = v1(token, path);
  const response = await GET(request, context);
  const body = await response.json();
  assert.equal(response.status, 200, `GET ${path} → ${JSON.stringify(body)}`);
  return body as T;
}

async function refused(token: string, path: string): Promise<{ status: number; body: ApiErrorBody }> {
  const { request, context } = v1(token, path);
  const response = await GET(request, context);
  return { status: response.status, body: (await response.json()) as ApiErrorBody };
}

describe("auction reads (#1036)", () => {
  let userId: string;
  let collectionId: string;
  let readToken: string;
  const lot: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };

  const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);

  before(async () => {
    userId = `test-user-auctionreads-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auctionreads-${ts}`,
        email: `test-auctionreads-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-auctionreads-${ts}`,
          name: `Collection auctionreads-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    const platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    // The offer number stored on a lot is read as one only on the collection's Allegro platform (#575).
    await setAllegroPlatform(userId, collectionId, platformId);
    const sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;

    const saleId = (
      await prisma.auctionSale.create({
        data: {
          collectionId,
          sellerId,
          platformId,
          name: "Philkam · Allegro",
          currency: "EUR",
          premiumPercent: "10",
          premiumFixed: "1",
          shippingCost: "5",
        },
      })
    ).id;

    let seq = 0;
    const create = async (data: Record<string, unknown>) =>
      (
        await prisma.auctionLot.create({
          data: { auctionSaleId: saleId, auctionLotNo: 9800 + ++seq, status: "open", ...data } as never,
        })
      ).id;

    lot.A = await create({
      title: "Fi 348-357",
      lotNo: "18795065609",
      url: "https://allegro.pl/oferta/18795065609",
      endsAt: hours(1),
      currentBid: "40",
      checkedAt: new Date(),
      myBid: "50",
      maxBid: "70",
    });
    lot.B = await create({
      url: "https://allegro.pl/oferta/znaczki-mi-1-18795044444",
      endsAt: hours(48),
      currentBid: "60",
      checkedAt: new Date(),
      myBid: "50",
      maxBid: "55",
    });
    lot.C = await create({ lotNo: "18795077777", endsAt: hours(120), startingPrice: "20" });
    lot.E = await create({ title: "Unbid", endsAt: hours(168) });
    lot.D = await create({
      lotNo: "18700000001",
      endsAt: hours(-72),
      status: "closed",
      myBid: "35",
      finalPrice: "30",
    });

    readToken = (
      await createAssistantToken(userId, collectionId, { label: "reads", kind: "agent", scope: "read" })
    ).token;
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── The watchlist ──────────────────────────────────────────────────────────

  describe("list_auction_watchlist", () => {
    it("lists the open lots soonest first, with the won one filed away", async () => {
      const page = await get<ListResponse<AgentWatchlistLot>>(readToken, "/auctions/lots");
      assert.equal(page.total, 4);
      assert.deepEqual(
        page.items.map((row) => row.lotId),
        [lot.A, lot.B, lot.C, lot.E]
      );
      assert.equal(page.nextCursor, null);
    });

    it("states the figures the lots screen's own read states for the same lots", async () => {
      const page = await get<ListResponse<AgentWatchlistLot>>(readToken, "/auctions/lots");
      const screen = new Map(
        (await listAuctionLots(userId, collectionId)).items.map((row) => [row.id, row])
      );
      assert.equal(screen.size, page.items.length, "the screen and the agent list different lots");
      for (const row of page.items) {
        const shown = screen.get(row.lotId);
        assert.ok(shown, `${row.lotId} is not on the lots screen`);
        assert.equal(row.currentBid, shown.currentBid ?? undefined);
        assert.equal(row.currentBidAllIn, shown.allIn ?? undefined);
        assert.equal(row.myBid, shown.myBid ?? undefined);
        assert.equal(row.myBidAllIn, shown.myAllIn ?? undefined);
        assert.equal(row.ceiling, shown.maxBid ?? undefined);
        assert.equal(row.ceilingBid, shown.bidRoom ?? undefined);
        assert.equal(row.standing, shown.standing ?? undefined);
        assert.equal(row.overCeiling, shown.overCeiling ?? undefined);
        assert.equal(row.myBidOverCeiling, shown.myBidOverCeiling ?? undefined);
        assert.equal(row.endsAt, shown.endsAt.toISOString());
      }
    });

    it("gives the answers the fixture's figures give by hand", async () => {
      // The other half of the comparison above: two paths through one broken rule still agree.
      const page = await get<ListResponse<AgentWatchlistLot>>(readToken, "/auctions/lots");
      const [a, b, c] = page.items;

      assert.equal(a.name, "Fi 348-357");
      assert.equal(a.standing, "leading");
      assert.equal(a.myBidAllIn, "56.00"); // 50 + 10% + 1
      assert.equal(a.currentBidAllIn, "45.00"); // 40 + 10% + 1
      assert.equal(a.ceiling, "70.00");
      assert.equal(a.ceilingBid, "62.72"); // (70 − 1) / 1.1, rounded down
      assert.deepEqual(a.signals, ["bid-possible", "leading"]);
      assert.equal(a.ended, false);
      assert.equal(a.platformLotNo, "18795065609");
      assert.match(a.path, new RegExp(`/auctions/sales/[^/]+\\?lot=${lot.A}$`));

      assert.equal(b.name, "Untitled lot");
      assert.equal(b.standing, "outbid");
      assert.equal(b.overCeiling, true); // 60 all-in is 67, past 55
      assert.deepEqual(b.signals, ["outbid", "over-ceiling"]);

      assert.equal(c.name, "Lot 18795077777");
      assert.equal(c.startingPrice, "20.00");
      assert.equal(c.currentBid, undefined);
      assert.equal(c.standing, undefined);
      assert.deepEqual(c.signals, []);
    });

    it("pages with a cursor and states the whole total on every page", async () => {
      const first = await get<ListResponse<AgentWatchlistLot>>(readToken, "/auctions/lots?limit=3");
      assert.equal(first.total, 4);
      assert.deepEqual(first.items.map((row) => row.lotId), [lot.A, lot.B, lot.C]);
      assert.equal(first.nextCursor, "3");

      const second = await get<ListResponse<AgentWatchlistLot>>(
        readToken,
        `/auctions/lots?limit=3&cursor=${first.nextCursor}`
      );
      assert.equal(second.total, 4);
      assert.deepEqual(second.items.map((row) => row.lotId), [lot.E]);
      assert.equal(second.nextCursor, null);
    });
  });

  // ── Exposure ───────────────────────────────────────────────────────────────

  describe("summarize_auction_exposure", () => {
    it("states the exposure bar's own figures", async () => {
      const agent = await get<AgentAuctionExposure>(readToken, "/auctions/exposure");
      const bar = await auctionLotExposure(userId, collectionId, {});
      assert.deepEqual(agent, {
        currency: bar.baseCurrency,
        committedTotal: bar.committedTotal,
        ceilingTotal: bar.ceilingTotal,
        countedLots: bar.payableCount,
        uncappedLots: bar.uncappedCount,
        outpricedLots: bar.outpricedCount,
        unconvertibleLots: bar.unconvertibleCount,
      });
    });

    it("gives the answer the fixture's figures give by hand", async () => {
      const agent = await get<AgentAuctionExposure>(readToken, "/auctions/exposure");
      assert.deepEqual(agent, {
        currency: "EUR",
        // A at its placed bid all-in (56), B out (outpriced), C and E nothing (no bid), shipping once (5).
        committedTotal: "61.00",
        // A at max(56, 70), B out, C and E nothing, shipping once.
        ceilingTotal: "75.00",
        countedLots: 4,
        uncappedLots: 2,
        outpricedLots: 1,
        unconvertibleLots: 0,
      });
    });
  });

  // ── Already tracked ────────────────────────────────────────────────────────

  describe("find_tracked_auction_lots", () => {
    it("tells a tracked listing from a new one, by number or by link, and says how each stands", async () => {
      const listings = [
        "18795065609",
        "https://allegro.pl/oferta/znaczki-mi-1-18795044444",
        "https://allegro.pl/produkt/znaczki?offerId=18700000001",
        "8795065609",
        "17000000001",
        "Lot 42",
      ];
      const query = listings.map((l) => `listings=${encodeURIComponent(l)}`).join("&");
      const answer = await get<{ listings: AgentTrackedListing[] }>(
        readToken,
        `/auctions/tracked?${query}`
      );

      assert.deepEqual(
        answer.listings.map((row) => [row.listing, row.verdict, row.lotId, row.outcome, row.matchedBy]),
        [
          ["18795065609", "tracked", lot.A, "pending", "lot-no"],
          ["https://allegro.pl/oferta/znaczki-mi-1-18795044444", "tracked", lot.B, "pending", "url"],
          // A lot the collector has closed is still the lot this listing is — reported as won.
          ["https://allegro.pl/produkt/znaczki?offerId=18700000001", "tracked", lot.D, "won", "lot-no"],
          // Inside a tracked number, and never found there.
          ["8795065609", "not_tracked", undefined, undefined, undefined],
          ["17000000001", "not_tracked", undefined, undefined, undefined],
          ["Lot 42", "unrecognized", undefined, undefined, undefined],
        ]
      );
      assert.equal(answer.listings[0].name, "Fi 348-357");
      assert.equal(answer.listings[0].sale, "Philkam · Allegro");
    });

    it("refuses a batch larger than one lookup answers, rather than answering part of it", async () => {
      const query = Array.from({ length: 201 }, (_, i) => `listings=${17000000000 + i}`).join("&");
      const { status, body } = await refused(readToken, `/auctions/tracked?${query}`);
      assert.equal(status, 400);
      assert.equal(body.error.code, "invalid_request");
    });
  });

  // ── The boundary ───────────────────────────────────────────────────────────

  describe("the boundary the whole issue is about", () => {
    const WRITE_VERBS = new Set([
      "add",
      "create",
      "capture",
      "track",
      "watch",
      "bid",
      "place",
      "set",
      "update",
      "edit",
      "record",
      "close",
      "cancel",
      "reopen",
      "settle",
      "delete",
      "remove",
      "refresh",
    ]);
    const AUCTION_WORDS = new Set(["auction", "auctions", "lot", "lots", "sale", "sales", "bid", "watchlist"]);
    // **A purchase's lot is not an auction's** (#1390). `add_purchase_lot` adds a priced line to an
    // order the collector already bought, which the agent is allowed to write; the watchlist's lots
    // are what it only reads. `lot` alone cannot tell the two apart, so a name about a purchase is
    // judged by its other words — `add_purchase_auction_lot` would still be caught.
    const writeShaped = (name: string) => {
      const words = name.split("_");
      const auctionWords = words.includes("purchase")
        ? words.filter((word) => word !== "lot" && word !== "lots")
        : words;
      return WRITE_VERBS.has(words[0]) && auctionWords.some((word) => AUCTION_WORDS.has(word));
    };

    it("carries no write-shaped auction operation, checked against the registry rather than asserted", () => {
      // #1036's *Done when*: **no write-shaped auction operation exists in the registry**. Two
      // questions, because each misses what the other catches: an auction operation declaring a
      // write, and a write-shaped name bound anywhere.
      const auctionOperations = OPERATIONS.filter((operation) => operation.path.startsWith("/auctions"));
      assert.deepEqual(
        auctionOperations.map((operation) => operation.name).sort(),
        ["find_tracked_auction_lots", "list_auction_watchlist", "summarize_auction_exposure"]
      );
      for (const operation of auctionOperations) {
        assert.equal(operation.method, "GET", operation.name);
        assert.equal(operation.writes, false, operation.name);
      }
      assert.deepEqual(OPERATIONS.map((operation) => operation.name).filter(writeShaped), []);
    });

    it("would notice one, and does not take the real reads with it", () => {
      for (const name of ["create_auction_lot", "place_bid", "track_auction_lot", "close_lot", "settle_auction_sale"]) {
        assert.ok(writeShaped(name), `${name} would not have been caught`);
      }
      for (const name of ["recommend_bid", "list_auction_watchlist", "find_tracked_auction_lots", "summarize_auction_exposure"]) {
        assert.ok(!writeShaped(name), `${name} is a read and must not be caught`);
      }
      // A purchase's lot is not the watchlist's, and a purchase name about an auction still is.
      for (const name of ["add_purchase_lot", "update_purchase_lot", "remove_purchase_lot"]) {
        assert.ok(!writeShaped(name), `${name} writes a purchase, not the watchlist`);
      }
      assert.ok(writeShaped("add_purchase_auction_lot"), "a purchase name about an auction must be caught");
    });

    it("answers all three to a read-only token", async () => {
      // Every call above already used one; this states it, so a later `writes: true` on any of them
      // fails here by name rather than as three unexplained 403s.
      for (const path of ["/auctions/lots", "/auctions/exposure", "/auctions/tracked?listings=1"]) {
        const { status } = await refused(readToken, path);
        assert.equal(status, 200, path);
      }
    });
  });
});
