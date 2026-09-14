import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auctionExposure,
  listingOfferNumber,
  trackedListings,
  watchlistLot,
  type ListingMatchRow,
  type WatchlistLotRow,
} from "../../src/lib/agent-api/auction-reads";
import { LOT_SIGNALS, lotHasSignal } from "../../src/lib/auction-lot";

// The auction-read projections (#1036).
//
// **The subject is that the figures are the app's own.** Nothing here computes an amount: the
// projections name what `listAuctionLots` and `auctionLotExposure` already computed, and the one
// predicate they evaluate is the lots toolbar's `lotHasSignal`. So these tests hold what the agent is
// *told* — which field carries which figure, which absences are answers, and that a batch of listings
// comes back whole — while `tests/integration/agent-api-auctions.test.ts` holds that the figures agree
// with the screen's reads over a real database.

const NOW = new Date("2026-09-14T12:00:00Z");
const PATH = "/c/mine/auctions/sales/s1?lot=l1";

function rowOf(overrides: Partial<WatchlistLotRow> = {}): WatchlistLotRow {
  return {
    id: "l1",
    saleName: "Philkam · Allegro",
    sellerName: "Philkam",
    platformName: "Allegro",
    currency: "PLN",
    auctionLotNo: 12,
    lotNo: "18795065609",
    url: "https://allegro.pl/oferta/18795065609",
    title: null,
    derivedTitle: null,
    status: "open",
    endsAt: new Date("2026-09-14T13:00:00Z"),
    startingPrice: null,
    currentBid: "40.00",
    checkedAt: new Date("2026-09-14T11:00:00Z"),
    allIn: "45.00",
    myBid: "50.00",
    myAllIn: "56.00",
    maxBid: "70.00",
    bidRoom: "62.72",
    standing: "leading",
    overCeiling: false,
    myBidOverCeiling: false,
    premiumPercent: "10.00",
    premiumFixed: "1.00",
    ...overrides,
  };
}

describe("watchlistLot", () => {
  it("names each of the three amounts apart, and the all-in figures beside them", () => {
    const lot = watchlistLot(rowOf(), NOW, PATH);
    assert.equal(lot.currentBid, "40.00");
    assert.equal(lot.currentBidAllIn, "45.00");
    assert.equal(lot.myBid, "50.00");
    assert.equal(lot.myBidAllIn, "56.00");
    assert.equal(lot.ceiling, "70.00");
    assert.equal(lot.ceilingBid, "62.72");
    assert.equal(lot.standing, "leading");
    assert.equal(lot.currency, "PLN");
    assert.equal(lot.endsAt, "2026-09-14T13:00:00.000Z");
    assert.equal(lot.checkedAt, "2026-09-14T11:00:00.000Z");
    assert.equal(lot.path, PATH);
  });

  it("carries exactly the signals the lots toolbar's own predicate gives the row", () => {
    const row = rowOf({ currentBid: "60.00", allIn: "67.00", standing: "outbid", maxBid: "55.00" });
    const expected = LOT_SIGNALS.filter((signal) =>
      lotHasSignal(
        signal,
        {
          status: "open",
          endsAt: row.endsAt,
          currentBid: row.currentBid,
          myBid: row.myBid,
          maxBid: row.maxBid,
          fees: { premiumPercent: row.premiumPercent, premiumFixed: row.premiumFixed },
        },
        NOW
      )
    );
    const lot = watchlistLot(row, NOW, PATH);
    assert.deepEqual(lot.signals, expected);
    // And the fixture is one where that predicate says something, so the comparison is not `[]`
    // against `[]`.
    assert.deepEqual(lot.signals, ["outbid", "over-ceiling"]);
  });

  it("reads a lot past its closing time as ended, and a leading one as waiting to be recorded", () => {
    const lot = watchlistLot(rowOf({ endsAt: new Date("2026-09-14T11:59:00Z") }), NOW, PATH);
    assert.equal(lot.ended, true);
    assert.deepEqual(lot.signals, ["won-pending"]);
    assert.equal(watchlistLot(rowOf(), NOW, PATH).ended, false);
  });

  it("keeps a false comparison and drops an unrecorded one", () => {
    // `false` is an answer — the price has not passed the ceiling. An absent field is a figure the
    // comparison needs that nobody recorded, which is a different state.
    const priced = watchlistLot(rowOf(), NOW, PATH);
    assert.equal(priced.overCeiling, false);
    assert.equal(priced.myBidOverCeiling, false);

    const unbid = watchlistLot(
      rowOf({
        currentBid: null,
        allIn: null,
        checkedAt: null,
        myBid: null,
        myAllIn: null,
        maxBid: null,
        bidRoom: null,
        standing: null,
        overCeiling: null,
        myBidOverCeiling: null,
        startingPrice: "20.00",
      }),
      NOW,
      PATH
    );
    for (const key of [
      "currentBid",
      "currentBidAllIn",
      "checkedAt",
      "myBid",
      "myBidAllIn",
      "ceiling",
      "ceilingBid",
      "standing",
      "overCeiling",
      "myBidOverCeiling",
    ]) {
      assert.ok(!(key in unbid), `${key} should be absent on a lot nobody has bid on`);
    }
    assert.equal(unbid.startingPrice, "20.00");
    assert.deepEqual(unbid.signals, []);
  });

  it("names a lot as every surface does: title, then derived name, then the platform's number", () => {
    assert.equal(watchlistLot(rowOf({ title: "Fi 348-357" }), NOW, PATH).name, "Fi 348-357");
    assert.equal(
      watchlistLot(rowOf({ derivedTitle: "Mi·PL 1-12 · Definitives (1950)" }), NOW, PATH).name,
      "Mi·PL 1-12 · Definitives (1950)"
    );
    assert.equal(watchlistLot(rowOf(), NOW, PATH).name, "Lot 18795065609");
    assert.equal(watchlistLot(rowOf({ lotNo: null }), NOW, PATH).name, "Untitled lot");
  });
});

describe("auctionExposure", () => {
  it("states the bar's two totals and keeps every count, a zero included", () => {
    // Every count distinct, so a projection that crossed two of them over would fail here rather
    // than pass on a coincidence — which is exactly how an earlier fixture of `1, 1` let one through.
    assert.deepEqual(
      auctionExposure({
        baseCurrency: "EUR",
        committedTotal: "61.00",
        ceilingTotal: "75.00",
        payableCount: 4,
        uncappedCount: 2,
        outpricedCount: 1,
        unconvertibleCount: 0,
      }),
      {
        currency: "EUR",
        committedTotal: "61.00",
        ceilingTotal: "75.00",
        countedLots: 4,
        uncappedLots: 2,
        outpricedLots: 1,
        unconvertibleLots: 0,
      }
    );
  });
});

describe("listingOfferNumber", () => {
  it("takes a bare number as the number, and a link at the stored-address boundaries", () => {
    assert.equal(listingOfferNumber(" 18795065609 "), "18795065609");
    assert.equal(
      listingOfferNumber("https://allegro.pl/oferta/znaczki-mi-1-18795065609?utm_source=mail"),
      "18795065609"
    );
    assert.equal(listingOfferNumber("allegro.pl/oferta/18795065609"), "18795065609");
  });

  it("guesses at nothing else", () => {
    // A house's catalogue position is not an offer number (#575), and text is not a link.
    assert.equal(listingOfferNumber("Lot 42"), null);
    assert.equal(listingOfferNumber("Fi 348-357"), null);
    assert.equal(listingOfferNumber("https://allegro.pl/kategoria/znaczki"), null);
  });
});

describe("trackedListings", () => {
  const match: ListingMatchRow = {
    platformOfferId: "18795065609",
    lotId: "l1",
    auctionLotNo: 12,
    title: "Fi 348-357",
    saleName: "Philkam · Allegro",
    outcome: "pending",
    path: PATH,
    matchedBy: "lot-no",
  };

  it("answers every listing in the order sent, and none is dropped", () => {
    const answers = trackedListings(
      ["https://allegro.pl/oferta/x-18795065609", "17000000001", "Lot 42", "18795065609"],
      [match]
    );
    assert.deepEqual(
      answers.map((a) => [a.listing, a.verdict]),
      [
        ["https://allegro.pl/oferta/x-18795065609", "tracked"],
        ["17000000001", "not_tracked"],
        ["Lot 42", "unrecognized"],
        ["18795065609", "tracked"],
      ]
    );
  });

  it("says which lot and how it stands on a tracked listing, and nothing on the others", () => {
    const [tracked, untracked, unrecognized] = trackedListings(
      ["18795065609", "17000000001", "Lot 42"],
      [match]
    );
    assert.deepEqual(tracked, {
      listing: "18795065609",
      verdict: "tracked",
      offerNumber: "18795065609",
      lotId: "l1",
      lotNumber: 12,
      name: "Fi 348-357",
      sale: "Philkam · Allegro",
      outcome: "pending",
      matchedBy: "lot-no",
      path: PATH,
    });
    assert.deepEqual(untracked, {
      listing: "17000000001",
      verdict: "not_tracked",
      offerNumber: "17000000001",
    });
    assert.deepEqual(unrecognized, { listing: "Lot 42", verdict: "unrecognized" });
  });
});
