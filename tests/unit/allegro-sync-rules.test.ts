import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bidWriteFor,
  lineAwaitsSale,
  matchListingToOffer,
  paymentStatusFor,
  supersededOrders,
  syncFreshness,
  windowFloor,
  SYNC_WINDOW_DAYS,
  SYNC_STALE_AFTER_MS,
} from "../../src/lib/allegro-sync-rules";

describe("paymentStatusFor", () => {
  it("reads a finished payment as paid, whatever the order status says", () => {
    assert.equal(paymentStatusFor("BOUGHT", "2026-08-01T10:00:00Z"), "paid");
    assert.equal(paymentStatusFor("FILLED_IN", "2026-08-01T10:00:00Z"), "paid");
  });

  it("accepts READY_FOR_PROCESSING as paid without a payment timestamp", () => {
    // Allegro's own word for a form filled in *and* paid; an order can reach it before the payment
    // timestamp is mirrored onto the form.
    assert.equal(paymentStatusFor("READY_FOR_PROCESSING", null), "paid");
  });

  it("reads a bought-but-unsettled order as unpaid", () => {
    assert.equal(paymentStatusFor("BOUGHT", null), "unpaid");
    assert.equal(paymentStatusFor("FILLED_IN", null), "unpaid");
  });

  it("lets cancelled win over a payment that had completed", () => {
    // A refunded, cancelled order is not a sale waiting to be recorded.
    assert.equal(paymentStatusFor("CANCELLED", "2026-08-01T10:00:00Z"), "cancelled");
  });

  it("is case-insensitive about the status", () => {
    assert.equal(paymentStatusFor("cancelled", null), "cancelled");
  });
});

describe("lineAwaitsSale", () => {
  it("keeps unpaid orders on the worklist", () => {
    // The collector may well want the sale on the books at `ordered` (#191).
    assert.equal(lineAwaitsSale("unpaid"), true);
    assert.equal(lineAwaitsSale("paid"), true);
  });

  it("never offers a cancelled order", () => {
    assert.equal(lineAwaitsSale("cancelled"), false);
  });
});

describe("matchListingToOffer", () => {
  const offers = [
    { id: "off_1", offerNo: 42, url: "https://allegro.pl/oferta/polska-1918-8795065609" },
    { id: "off_2", offerNo: 43, url: "https://allegro.pl/oferta/18795065609" },
    { id: "off_3", offerNo: 44, url: null },
  ];

  it("prefers the listing's external id, which states identity outright", () => {
    assert.deepEqual(matchListingToOffer(offers, { platformOfferId: "999", externalId: "44" }), {
      offerId: "off_3",
      matchedBy: "external",
    });
  });

  it("accepts the offer's own id as an external id", () => {
    assert.deepEqual(matchListingToOffer(offers, { platformOfferId: "999", externalId: "off_1" }), {
      offerId: "off_1",
      matchedBy: "external",
    });
  });

  it("falls back to the stored URL, at the address's own boundaries", () => {
    assert.deepEqual(
      matchListingToOffer(offers, { platformOfferId: "8795065609", externalId: null }),
      { offerId: "off_1", matchedBy: "url" }
    );
    // The longer number is a different listing, and is matched as itself.
    assert.deepEqual(
      matchListingToOffer(offers, { platformOfferId: "18795065609", externalId: null }),
      { offerId: "off_2", matchedBy: "url" }
    );
  });

  it("refuses rather than guesses when two offers claim one listing", () => {
    const twins = [
      { id: "a", offerNo: 1, url: "https://allegro.pl/oferta/5" },
      { id: "b", offerNo: 2, url: "https://allegro.pl/oferta/x-5" },
    ];
    assert.equal(matchListingToOffer(twins, { platformOfferId: "5", externalId: null }), null);
  });

  it("returns null when nothing here names the listing", () => {
    assert.equal(matchListingToOffer(offers, { platformOfferId: "111", externalId: null }), null);
    assert.equal(matchListingToOffer([], { platformOfferId: "8795065609", externalId: "42" }), null);
  });

  it("ignores an external id that names nothing and still tries the URL", () => {
    assert.deepEqual(
      matchListingToOffer(offers, { platformOfferId: "8795065609", externalId: "  " }),
      { offerId: "off_1", matchedBy: "url" }
    );
  });
});

describe("windowFloor", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("reads the whole window on a first sync", () => {
    const floor = windowFloor(now, null);
    assert.equal(
      floor.toISOString(),
      new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    );
  });

  it("overlaps a day behind the last sync, so nothing falls between two passes", () => {
    const floor = windowFloor(now, new Date("2026-08-03T09:00:00Z"));
    assert.equal(floor.toISOString(), "2026-08-02T09:00:00.000Z");
  });

  it("never reaches further back than the window", () => {
    const floor = windowFloor(now, new Date("2020-01-01T00:00:00Z"));
    assert.equal(
      floor.toISOString(),
      new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    );
  });
});

describe("syncFreshness", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("says never for a collection whose sync has not run — which is not a failure", () => {
    assert.equal(syncFreshness({ lastSucceededAt: null, lastError: null }, now), "never");
  });

  it("reports a failure over anything else, including a recent success", () => {
    assert.equal(
      syncFreshness({ lastSucceededAt: now, lastError: "Allegro returned HTTP 500." }, now),
      "failing"
    );
  });

  it("goes stale once the last success is old enough to stop describing the present", () => {
    const old = new Date(now.getTime() - SYNC_STALE_AFTER_MS - 1000);
    assert.equal(syncFreshness({ lastSucceededAt: old, lastError: null }, now), "stale");
    const recent = new Date(now.getTime() - 60_000);
    assert.equal(syncFreshness({ lastSucceededAt: recent, lastError: null }, now), "fresh");
  });
});

describe("bidWriteFor", () => {
  const now = new Date("2026-08-03T12:00:00Z");
  const auction = {
    format: "AUCTION",
    biddersCount: 0,
    currentPrice: null as string | null,
    currentCurrency: null as string | null,
    endingAt: null as Date | null,
  };
  const offer = {
    listingType: "auction",
    state: "active",
    currency: "PLN",
    inActiveBidding: false,
    bidderCount: null as number | null,
    endsAt: null as Date | null,
  };

  it("flags an auction the moment somebody bids, and records the standing bid", () => {
    const write = bidWriteFor(
      { ...auction, biddersCount: 2, currentPrice: "42.00", currentCurrency: "PLN" },
      offer,
      now
    );
    assert.deepEqual(write, {
      bidderCount: 2,
      inActiveBidding: true,
      price: "42.00",
      priceCheckedAt: now,
    });
  });

  it("keeps a zero bid on an auction nobody has bid on, and never stamps a check", () => {
    // The opening figure is `startingPrice`'s to state — copying it into `price` would record a bid
    // that never happened (#449).
    const write = bidWriteFor(
      { ...auction, biddersCount: 0, currentPrice: "10.00", currentCurrency: "PLN" },
      offer,
      now
    );
    assert.deepEqual(write, { bidderCount: 0 });
  });

  it("writes nothing when the count has not moved and the auction is still unbid", () => {
    assert.equal(bidWriteFor(auction, { ...offer, bidderCount: 0 }, now), null);
  });

  it("never clears the flag — not on an auction that has ended unsold, not on a retracted bid", () => {
    const flagged = { ...offer, inActiveBidding: true, bidderCount: 1 };
    // An auction back to nobody bidding still records the count — the honest observation, and the
    // row the collector then looks at — and leaves the flag exactly where it is.
    assert.deepEqual(bidWriteFor({ ...auction, biddersCount: 0 }, flagged, now), {
      bidderCount: 0,
    });
    assert.equal(
      bidWriteFor({ ...auction, biddersCount: 0 }, { ...flagged, bidderCount: 0 }, now),
      null
    );
  });

  it("refreshes the bid of an already flagged auction without re-reporting the flag", () => {
    const write = bidWriteFor(
      { ...auction, biddersCount: 3, currentPrice: "51.00", currentCurrency: "PLN" },
      { ...offer, inActiveBidding: true, bidderCount: 3 },
      now
    );
    assert.deepEqual(write, { price: "51.00", priceCheckedAt: now });
  });

  it("leaves a fixed-price listing alone on either side's word", () => {
    // Both sides have to call it an auction: Allegro's format says what is running, the local type
    // says what was recorded, and a bid written over an asking price is unrecoverable.
    assert.equal(
      bidWriteFor({ ...auction, format: "BUY_NOW", biddersCount: 2 }, offer, now),
      null
    );
    assert.equal(
      bidWriteFor(
        { ...auction, biddersCount: 2, currentPrice: "42.00", currentCurrency: "PLN" },
        { ...offer, listingType: "fixed" },
        now
      ),
      null
    );
  });

  it("flags on a bid in another currency but refuses to write the figure", () => {
    const write = bidWriteFor(
      { ...auction, biddersCount: 1, currentPrice: "42.00", currentCurrency: "EUR" },
      offer,
      now
    );
    assert.deepEqual(write, { bidderCount: 1, inActiveBidding: true });
  });

  it("reads a count Allegro did not state as unknown rather than as no bids", () => {
    assert.equal(bidWriteFor({ ...auction, biddersCount: null }, offer, now), null);
  });

  it("carries the closing time whatever the bidding says (#490)", () => {
    const closes = new Date("2026-08-04T18:00:00Z");
    // Recorded even where Allegro stated no bidder count at all, which otherwise writes nothing:
    // when a listing closes is a fact about the listing, not about the bidding.
    assert.deepEqual(bidWriteFor({ ...auction, biddersCount: null, endingAt: closes }, offer, now), {
      endsAt: closes,
    });
    assert.deepEqual(
      bidWriteFor(
        { ...auction, biddersCount: 2, currentPrice: "42.00", currentCurrency: "PLN", endingAt: closes },
        offer,
        now
      ),
      { endsAt: closes, bidderCount: 2, inActiveBidding: true, price: "42.00", priceCheckedAt: now }
    );
  });

  it("moves the closing time forward when Allegro relists an unsold auction (#490)", () => {
    // The relist is what makes this an overwrite rather than a backfill: an offer left holding the
    // old date would be reported as an ended auction waiting to be resolved for as long as it ran.
    const was = new Date("2026-08-01T18:00:00Z");
    const now2 = new Date("2026-08-08T18:00:00Z");
    assert.deepEqual(
      bidWriteFor({ ...auction, endingAt: now2 }, { ...offer, bidderCount: 0, endsAt: was }, now),
      { endsAt: now2 }
    );
    // …and an unchanged date is not rewritten.
    assert.equal(
      bidWriteFor({ ...auction, endingAt: was }, { ...offer, bidderCount: 0, endsAt: was }, now),
      null
    );
  });

  it("leaves a closed offer alone — there is nothing left to commit or to price", () => {
    for (const state of ["sold", "withdrawn"]) {
      assert.equal(
        bidWriteFor(
          { ...auction, biddersCount: 2, currentPrice: "42.00", currentCurrency: "PLN" },
          { ...offer, state },
          now
        ),
        null
      );
    }
  });
});

describe("supersededOrders", () => {
  const seen = (iso: string) => new Date(iso);

  it("marks the pre-merge orders a combined one took over", () => {
    // The live shape of #495: two unpaid single-item forms, and the paid form Allegro issued when the
    // buyer paid for both at once — carrying their line item ids verbatim.
    const verdict = supersededOrders([
      { orderId: "merged", lineItemIds: ["a", "b"], observedAt: seen("2026-08-05T02:54:00Z") },
      { orderId: "first", lineItemIds: ["a"], observedAt: seen("2026-08-02T23:47:58Z") },
      { orderId: "second", lineItemIds: ["b"], observedAt: seen("2026-08-02T23:47:58Z") },
    ]);
    assert.equal(verdict.get("first"), "merged");
    assert.equal(verdict.get("second"), "merged");
    assert.equal(verdict.get("merged"), null);
  });

  it("leaves an order carrying a line item of its own alone", () => {
    // A partial merge: the buyer combined two of three purchases, and the third is still real work.
    const verdict = supersededOrders([
      { orderId: "merged", lineItemIds: ["a", "b"], observedAt: seen("2026-08-05T02:00:00Z") },
      { orderId: "outside", lineItemIds: ["b", "c"], observedAt: seen("2026-08-02T10:00:00Z") },
    ]);
    assert.equal(verdict.get("outside"), null);
  });

  it("takes an equally sized order over only where the other was seen later", () => {
    const later = supersededOrders([
      { orderId: "old", lineItemIds: ["a"], observedAt: seen("2026-08-02T10:00:00Z") },
      { orderId: "new", lineItemIds: ["a"], observedAt: seen("2026-08-05T10:00:00Z") },
    ]);
    assert.equal(later.get("old"), "new");
    assert.equal(later.get("new"), null);

    // Same lines, same instant: nothing says which came second, and guessing would hide a real order.
    const tied = supersededOrders([
      { orderId: "one", lineItemIds: ["a"], observedAt: seen("2026-08-02T10:00:00Z") },
      { orderId: "two", lineItemIds: ["a"], observedAt: seen("2026-08-02T10:00:00Z") },
    ]);
    assert.equal(tied.get("one"), null);
    assert.equal(tied.get("two"), null);
  });

  it("names the biggest taker, so the verdict does not move between passes", () => {
    const verdict = supersededOrders([
      { orderId: "small", lineItemIds: ["a"], observedAt: seen("2026-08-02T10:00:00Z") },
      { orderId: "pair", lineItemIds: ["a", "b"], observedAt: seen("2026-08-05T10:00:00Z") },
      { orderId: "triple", lineItemIds: ["a", "b", "c"], observedAt: seen("2026-08-03T10:00:00Z") },
    ]);
    assert.equal(verdict.get("small"), "triple");
  });

  it("supersedes nothing on an order whose lines the sync has yet to write", () => {
    const verdict = supersededOrders([
      { orderId: "empty", lineItemIds: [], observedAt: seen("2026-08-02T10:00:00Z") },
      { orderId: "other", lineItemIds: ["a"], observedAt: seen("2026-08-05T10:00:00Z") },
    ]);
    assert.equal(verdict.get("empty"), null);
  });
});
