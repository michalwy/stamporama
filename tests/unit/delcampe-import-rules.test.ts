import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  delcampeBidWriteFor,
  delcampeItemUrl,
  offerNoFromPersonalReference,
  parseCsvRows,
  parseDelcampeDecimal,
  parseDelcampeEndDate,
  readDelcampeActiveItems,
  reconcileDelcampeListings,
  type DelcampeActiveItemRow,
  type ReconcilableOffer,
} from "../../src/lib/delcampe-import-rules";

// Reading Delcampe's own active-items export (#611). The file is the only channel there is — the
// REST API is behind the paid API Pass (ADR-0034) — so what it says and what this concludes from it
// is the whole feature, and every one of those conclusions is asserted here rather than against a
// marketplace.

/** Delcampe's own sample, verbatim in shape: the header it publishes, one row of a real listing. */
const SAMPLE = [
  "id_auction,title,personal_reference,description,id_category,shipping_model,weight,visits_number,end_date,GMT,present_price,quantity,bids_number,best_bidder",
  `2508054797,"Saar, Mi:275, Yv:284, ** (MNH)",412,,24678,"Fee template",,4,"2026-08-28 14:53:00","GMT +1.0",17.44,1,0,`,
].join("\r\n");

function row(overrides: Partial<DelcampeActiveItemRow> = {}): DelcampeActiveItemRow {
  return {
    itemId: "1",
    title: "A listing",
    personalReference: "1",
    referenceOfferNo: 1,
    categoryId: "7945",
    presentPrice: 1,
    quantity: 1,
    bidsCount: 0,
    bestBidder: null,
    visits: 0,
    endsAt: null,
    line: 2,
    ...overrides,
  };
}

function offer(overrides: Partial<ReconcilableOffer> = {}): ReconcilableOffer {
  return { id: "o1", offerNo: 1, state: "ready", delcampeItemId: null, ...overrides };
}

describe("Delcampe export reader (#611)", () => {
  it("reads Delcampe's own sample row", () => {
    const read = readDelcampeActiveItems(SAMPLE);
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(read.rows.length, 1);
    const [entry] = read.rows;
    assert.equal(entry.itemId, "2508054797");
    assert.equal(entry.title, "Saar, Mi:275, Yv:284, ** (MNH)");
    assert.equal(entry.referenceOfferNo, 412);
    assert.equal(entry.categoryId, "24678");
    // The direction that matters: a **dot**, where #610's upload file writes a comma (ADR-0034 §5).
    assert.equal(entry.presentPrice, 17.44);
    assert.equal(entry.quantity, 1);
    assert.equal(entry.bidsCount, 0);
    assert.equal(entry.bestBidder, null);
    assert.equal(entry.visits, 4);
    // 14:53 at GMT+1 is 13:53 UTC. The zone lives in its own column, so reading the stamp alone
    // would be an hour out in a way nothing downstream could detect.
    assert.equal(entry.endsAt?.toISOString(), "2026-08-28T13:53:00.000Z");
  });

  it("reads by column name, so a reordered or extended export still reads", () => {
    const text = [
      "personal_reference,extra_column,id_auction,present_price",
      "7,something,999,3.50",
    ].join("\n");
    const read = readDelcampeActiveItems(text);
    assert.ok(read.ok);
    assert.equal(read.rows[0].itemId, "999");
    assert.equal(read.rows[0].referenceOfferNo, 7);
    assert.equal(read.rows[0].presentPrice, 3.5);
  });

  it("refuses a file that is not an active-items export, by name", () => {
    // The likeliest wrong pick is the *sold*-items export, which is #612's file and carries neither
    // column. A reader that counted commas would import it under the wrong ids and never fail.
    const read = readDelcampeActiveItems("buyer_name,buyer_email,item_title\nA,b@c.d,Something");
    assert.ok(!read.ok);
    assert.match(read.message, /id_auction/);
  });

  it("skips a spreadsheet's leftovers rather than refusing the file over them", () => {
    const text = `${SAMPLE}\r\n\r\n,,,,,,,,,,,,,\r\n`;
    const read = readDelcampeActiveItems(text);
    assert.ok(read.ok);
    assert.equal(read.rows.length, 1);
  });

  it("survives a byte-order mark, which would otherwise rename the first column", () => {
    const read = readDelcampeActiveItems(`﻿${SAMPLE}`);
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(read.rows[0].itemId, "2508054797");
  });
});

describe("CSV reading (#611)", () => {
  it("keeps separators, quotes and line breaks that sit inside a quoted field", () => {
    const rows = parseCsvRows('a,"b,c","d""e","f\ng"\r\nh,i,j,k');
    assert.deepEqual(rows, [
      ["a", "b,c", 'd"e', "f\ng"],
      ["h", "i", "j", "k"],
    ]);
  });

  it("does not invent a row from a trailing newline", () => {
    assert.equal(parseCsvRows("a,b\r\nc,d\r\n").length, 2);
  });
});

describe("the two figures the file spells its own way (#611)", () => {
  it("reads a dot, and a comma left behind by a spreadsheet", () => {
    assert.equal(parseDelcampeDecimal("17.44"), 17.44);
    assert.equal(parseDelcampeDecimal("17,44"), 17.44);
    assert.equal(parseDelcampeDecimal(" 0.10 "), 0.1);
  });

  it("refuses a grouped figure rather than guessing which separator is which", () => {
    // `1,234.56` cannot be told from `1,23` except by counting digits, and a price read wrong is
    // worse than a price not read.
    assert.equal(parseDelcampeDecimal("1,234.56"), null);
    assert.equal(parseDelcampeDecimal(""), null);
    assert.equal(parseDelcampeDecimal("free"), null);
  });

  it("reads the zone out of its own column, in both spellings", () => {
    assert.equal(
      parseDelcampeEndDate("2026-08-28 14:53:00", "GMT +1.0")?.toISOString(),
      "2026-08-28T13:53:00.000Z"
    );
    assert.equal(
      parseDelcampeEndDate("2026-08-28 14:53:00", "GMT -2.0")?.toISOString(),
      "2026-08-28T16:53:00.000Z"
    );
    // A half-hour zone, written as a fraction of an hour and as minutes — the same instant.
    assert.equal(
      parseDelcampeEndDate("2026-08-28 14:53:00", "GMT +5.5")?.toISOString(),
      "2026-08-28T09:23:00.000Z"
    );
    assert.equal(
      parseDelcampeEndDate("2026-08-28 14:53:00", "GMT +5:30")?.toISOString(),
      "2026-08-28T09:23:00.000Z"
    );
  });

  it("is null rather than approximate when it cannot read the pair", () => {
    assert.equal(parseDelcampeEndDate("28/08/2026 14:53", "GMT +1.0"), null);
    assert.equal(parseDelcampeEndDate("2026-08-28 14:53:00", "Central European Time"), null);
  });
});

describe("the reference back to an offer (#611, #635)", () => {
  it("reads the offer number the column now carries", () => {
    assert.equal(offerNoFromPersonalReference("412"), 412);
    assert.equal(offerNoFromPersonalReference(" 7 "), 7);
  });

  it("refuses the short URL #610 used to write, which no longer fits Delcampe's 20 characters", () => {
    assert.equal(offerNoFromPersonalReference("https://stamps.example.test/o/michal-stamps/412"), null);
  });

  it("refuses a reference the collector typed by hand", () => {
    // A storage ref or a note is not an offer number, and reading a number out of the middle of one
    // would claim a listing nobody pointed at this offer.
    assert.equal(offerNoFromPersonalReference("my own note"), null);
    assert.equal(offerNoFromPersonalReference("K-412"), null);
    assert.equal(offerNoFromPersonalReference("412a"), null);
    assert.equal(offerNoFromPersonalReference(null), null);
    assert.equal(offerNoFromPersonalReference("0"), null);
  });

  it("composes the item address from the id, rather than storing it twice", () => {
    assert.equal(
      delcampeItemUrl("2508054797"),
      "https://www.delcampe.net/en_US/collectibles/item/2508054797.html"
    );
  });
});

describe("reconciling a file against this collection's offers (#611, #635)", () => {
  it("activates a ready offer the platform now carries", () => {
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "500", referenceOfferNo: 1 })],
      offers: [offer({ state: "ready" })],
      known: [],
    });
    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].action, "activate");
    assert.equal(plan.matched[0].offerId, "o1");
    assert.equal(plan.unmatched.length, 0);
  });

  it("confirms an offer already active, and refuses to move one in any other state", () => {
    for (const [state, action] of [
      ["active", "confirm"],
      ["preparing", "record"],
      ["paused", "record"],
      ["sold", "record"],
      ["withdrawn", "record"],
    ] as const) {
      const plan = reconcileDelcampeListings({
        rows: [row({ itemId: "500" })],
        offers: [offer({ state })],
        known: [],
      });
      assert.equal(plan.matched[0].action, action, state);
    }
  });

  it("refuses **both** rows when two listings name one offer", () => {
    // Delcampe does not enforce uniqueness on `personal_reference`, and the collector's own live
    // listings already carry one reference twice. Picking the newer or the dearer would put a
    // listing id on an offer on the strength of a tie-break nobody agreed to.
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "500" }), row({ itemId: "501", line: 3 })],
      offers: [offer()],
      known: [],
    });
    assert.equal(plan.matched.length, 0);
    assert.equal(plan.unmatched.length, 2);
    assert.ok(plan.unmatched.every((entry) => entry.problem === "duplicate-reference"));
    // The offer number is still reported: it is what the collector searches for on Delcampe.
    assert.equal(plan.unmatched[0].offerNo, 1);
  });

  it("refuses a row claiming an offer that is up as another listing in the same file", () => {
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "501" }), row({ itemId: "500", personalReference: null, referenceOfferNo: null, line: 3 })],
      offers: [offer({ state: "active", delcampeItemId: "500" })],
      known: [],
    });
    // The listing the offer already names matches on its id and is confirmed; the row claiming the
    // same offer through the reference is the contradiction, and it is the one refused.
    assert.equal(plan.unmatched.length, 1);
    assert.equal(plan.unmatched[0].problem, "offer-already-listed");
    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].row.itemId, "500");
  });

  it("matches on the listing id first, and does not consult the reference at all (#635)", () => {
    // The id is Delcampe's own and globally unique; the reference is a label. A row whose id this
    // collection already carries is that offer's listing whatever the label says — which is what
    // narrows a bare offer number's exposure to a listing's very first contact.
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "500", personalReference: "77", referenceOfferNo: 77 })],
      offers: [
        offer({ id: "o1", offerNo: 1, state: "active", delcampeItemId: "500" }),
        offer({ id: "o77", offerNo: 77, state: "ready" }),
      ],
      known: [],
    });
    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].offerId, "o1");
    assert.equal(plan.matched[0].action, "confirm");
  });

  it("lets a row matched on its id out of the duplicate-reference count (#635)", () => {
    // Two rows carrying one reference is a fault only where the reference is what decides. The row
    // that matched on its own id never asked it.
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "500" }), row({ itemId: "501", line: 3 })],
      offers: [
        offer({ id: "o1", offerNo: 1, state: "ready" }),
        offer({ id: "o9", offerNo: 9, state: "active", delcampeItemId: "500" }),
      ],
      known: [],
    });
    assert.equal(plan.unmatched.length, 0);
    assert.equal(plan.matched.length, 2);
    assert.deepEqual(
      plan.matched.map((entry) => entry.offerId),
      ["o9", "o1"]
    );
  });

  it("takes over where the listing the offer named has itself come down — a relist", () => {
    // The old listing is not in this file, so it is gone; the new one is the replacement, and that
    // is the ordinary way a Delcampe listing is put back up by hand.
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "501" })],
      offers: [offer({ state: "active", delcampeItemId: "500" })],
      known: [{ itemId: "500", status: "ACTIVE", offerId: "o1" }],
    });
    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].action, "confirm");
    assert.deepEqual(plan.cameDown, [{ itemId: "500", offerId: "o1" }]);
  });

  it("names the two ways a row can reach no offer at all", () => {
    const plan = reconcileDelcampeListings({
      rows: [
        row({ itemId: "600", personalReference: "handwritten", referenceOfferNo: null }),
        row({ itemId: "601", referenceOfferNo: 99, line: 3 }),
      ],
      offers: [offer()],
      known: [],
    });
    assert.equal(plan.unmatched[0].problem, "no-reference");
    assert.equal(plan.unmatched[1].problem, "unknown-offer");
    assert.equal(plan.unmatched[1].offerNo, 99);
  });

  it("reports as come down only what it had actually seen up", () => {
    const plan = reconcileDelcampeListings({
      rows: [row({ itemId: "500" })],
      offers: [offer({ state: "active" })],
      known: [
        { itemId: "500", status: "ACTIVE", offerId: "o1" },
        { itemId: "400", status: "ACTIVE", offerId: "o2" },
        // Already known to have gone: it is not news a second time.
        { itemId: "300", status: "ENDED", offerId: "o3" },
      ],
    });
    assert.deepEqual(plan.cameDown, [{ itemId: "400", offerId: "o2" }]);
  });
});

describe("what a row says about the bidding (#611, #481's rule)", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const auction = {
    listingType: "auction",
    state: "active" as const,
    currency: "EUR",
    inActiveBidding: false,
    bidderCount: null,
    endsAt: null,
  };

  it("carries a bid onto an offer recorded as an auction", () => {
    const write = delcampeBidWriteFor(
      { presentPrice: 17.44, bidsCount: 3, endsAt: new Date("2026-08-28T13:53:00.000Z") },
      auction,
      "EUR",
      now
    );
    assert.deepEqual(write, {
      endsAt: new Date("2026-08-28T13:53:00.000Z"),
      bidderCount: 3,
      inActiveBidding: true,
      price: "17.44",
      priceCheckedAt: now,
    });
  });

  it("leaves a fixed-price offer alone — its price is the collector's own statement", () => {
    // A file that disagrees with it is listing drift (#542), which is shown rather than resolved by
    // letting the marketplace's copy win.
    assert.equal(
      delcampeBidWriteFor(
        { presentPrice: 99, bidsCount: 0, endsAt: null },
        { ...auction, listingType: "fixed" },
        "EUR",
        now
      ),
      null
    );
  });

  it("writes no figure where the currencies disagree", () => {
    const write = delcampeBidWriteFor(
      { presentPrice: 17.44, bidsCount: 2, endsAt: null },
      auction,
      "PLN",
      now
    );
    assert.equal(write?.price, undefined);
    assert.equal(write?.inActiveBidding, true);
    assert.equal(write?.bidderCount, 2);
  });

  it("never clears the flag, and never touches a closed offer", () => {
    const flagged = { ...auction, inActiveBidding: true, bidderCount: 2 };
    // Back to nobody bidding — the count is corrected, the flag is not withdrawn (#215/#481).
    const write = delcampeBidWriteFor({ presentPrice: 1, bidsCount: 0, endsAt: null }, flagged, "EUR", now);
    assert.deepEqual(write, { bidderCount: 0 });
    assert.equal(
      delcampeBidWriteFor({ presentPrice: 1, bidsCount: 5, endsAt: null }, { ...auction, state: "sold" }, "EUR", now),
      null
    );
  });

  it("says nothing when nothing has changed", () => {
    assert.equal(
      delcampeBidWriteFor(
        { presentPrice: null, bidsCount: 0, endsAt: null },
        { ...auction, bidderCount: 0 },
        "EUR",
        now
      ),
      null
    );
  });
});
