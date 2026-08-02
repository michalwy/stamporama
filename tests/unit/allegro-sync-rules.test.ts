import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lineAwaitsSale,
  matchListingToOffer,
  paymentStatusFor,
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
