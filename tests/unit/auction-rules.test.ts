import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_LOT_STATUSES,
  AUCTION_SALE_STATUSES,
  bidFreshness,
  closingUrgency,
  deriveAuctionSaleName,
  isAuctionLotStatus,
  isAuctionSaleStatus,
  isTerminalLotStatus,
  normalizeAuctionText,
  normalizeAuctionUrl,
  parseAuctionAmount,
  parseAuctionInstant,
  parsePremiumPercent,
} from "../../src/lib/auction-rules";

// Vocabulary -----------------------------------------------------------------

describe("auction status vocabulary", () => {
  it("accepts exactly the four lot outcomes", () => {
    assert.deepEqual([...AUCTION_LOT_STATUSES], ["watching", "won", "lost", "cancelled"]);
    for (const s of AUCTION_LOT_STATUSES) assert.equal(isAuctionLotStatus(s), true);
    assert.equal(isAuctionLotStatus("bidding"), false);
    assert.equal(isAuctionLotStatus(""), false);
  });

  it("accepts exactly the three sale statuses", () => {
    assert.deepEqual([...AUCTION_SALE_STATUSES], ["open", "settled", "closed"]);
    for (const s of AUCTION_SALE_STATUSES) assert.equal(isAuctionSaleStatus(s), true);
    assert.equal(isAuctionSaleStatus("paid"), false);
  });

  it("treats only watching as still running", () => {
    assert.equal(isTerminalLotStatus("watching"), false);
    assert.equal(isTerminalLotStatus("won"), true);
    assert.equal(isTerminalLotStatus("lost"), true);
    assert.equal(isTerminalLotStatus("cancelled"), true);
  });
});

// Staleness ------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(now: Date, offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs);
}

describe("bidFreshness", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("reports a never-checked live lot as unchecked", () => {
    assert.equal(
      bidFreshness({ status: "watching", endsAt: at(now, 2 * HOUR), checkedAt: null }, now),
      "unchecked"
    );
  });

  it("reports a live lot whose closing time has passed as closed", () => {
    // Outcome, not bid, is what is missing — and unlike staleness it will never fix itself.
    assert.equal(
      bidFreshness({ status: "watching", endsAt: at(now, -HOUR), checkedAt: at(now, -2 * HOUR) }, now),
      "closed"
    );
    assert.equal(
      bidFreshness({ status: "watching", endsAt: at(now, -HOUR), checkedAt: null }, now),
      "closed"
    );
  });

  it("tightens the allowance as the close approaches", () => {
    // Closes in an hour, checked 10 min ago: the window when checked was 70 min, a quarter of it
    // is ~17 min, so a 10-minute-old reading still counts.
    assert.equal(
      bidFreshness(
        { status: "watching", endsAt: at(now, HOUR), checkedAt: at(now, -10 * 60 * 1000) },
        now
      ),
      "fresh"
    );
    // Same lot, checked 40 min ago: past the quarter, so it wants a refresh.
    assert.equal(
      bidFreshness(
        { status: "watching", endsAt: at(now, HOUR), checkedAt: at(now, -40 * 60 * 1000) },
        now
      ),
      "stale"
    );
  });

  it("keeps a day-old reading on a lot that closes in a week", () => {
    assert.equal(
      bidFreshness({ status: "watching", endsAt: at(now, 7 * DAY), checkedAt: at(now, -20 * HOUR) }, now),
      "fresh"
    );
  });

  it("caps the allowance at a day however long the lot runs", () => {
    // A basket running for a year would otherwise keep a three-month-old reading.
    assert.equal(
      bidFreshness({ status: "watching", endsAt: at(now, 365 * DAY), checkedAt: at(now, -2 * DAY) }, now),
      "stale"
    );
  });

  it("never flags a settled lot", () => {
    for (const status of ["won", "lost", "cancelled"] as const) {
      assert.equal(
        bidFreshness({ status, endsAt: at(now, -30 * DAY), checkedAt: null }, now),
        "fresh"
      );
    }
  });
});

// Closing urgency -------------------------------------------------------------

describe("closingUrgency", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("grades a live lot by how much time is left", () => {
    assert.equal(closingUrgency({ status: "watching", endsAt: at(now, -HOUR) }, now), "past");
    assert.equal(closingUrgency({ status: "watching", endsAt: at(now, HOUR) }, now), "imminent");
    assert.equal(closingUrgency({ status: "watching", endsAt: at(now, 6 * HOUR) }, now), "soon");
    assert.equal(closingUrgency({ status: "watching", endsAt: at(now, 3 * DAY) }, now), "later");
  });

  it("leaves a settled lot alone — its date is history, not a deadline", () => {
    assert.equal(closingUrgency({ status: "won", endsAt: at(now, -30 * DAY) }, now), "later");
    assert.equal(closingUrgency({ status: "lost", endsAt: at(now, HOUR) }, now), "later");
  });
});

// Parsing --------------------------------------------------------------------

describe("parseAuctionAmount", () => {
  it("normalises to 2 dp and accepts a comma separator (#233)", () => {
    assert.deepEqual(parseAuctionAmount("12", "Bid"), { ok: true, value: "12.00" });
    assert.deepEqual(parseAuctionAmount(" 3,5 ", "Bid"), { ok: true, value: "3.50" });
  });
  it("treats blank as not recorded rather than zero", () => {
    assert.deepEqual(parseAuctionAmount("", "Bid"), { ok: true, value: null });
    assert.deepEqual(parseAuctionAmount("   ", "Bid"), { ok: true, value: null });
  });
  it("rejects non-numeric and negative", () => {
    assert.equal(parseAuctionAmount("abc", "Bid").ok, false);
    assert.equal(parseAuctionAmount("-1", "Bid").ok, false);
  });
});

describe("parsePremiumPercent", () => {
  it("accepts a normal premium", () => {
    assert.deepEqual(parsePremiumPercent("22.5"), { ok: true, value: "22.50" });
    assert.deepEqual(parsePremiumPercent(""), { ok: true, value: null });
  });
  it("rejects more than 100%", () => {
    assert.equal(parsePremiumPercent("120").ok, false);
    assert.deepEqual(parsePremiumPercent("100"), { ok: true, value: "100.00" });
  });
});

describe("parseAuctionInstant", () => {
  it("parses an ISO instant", () => {
    const d = parseAuctionInstant("2026-08-01T18:30:00.000Z");
    assert.equal(d?.toISOString(), "2026-08-01T18:30:00.000Z");
  });
  it("rejects blank and malformed input", () => {
    assert.equal(parseAuctionInstant(""), null);
    assert.equal(parseAuctionInstant("not a date"), null);
  });
});

describe("normalizers", () => {
  it("blanks clear the URL and free-text fields", () => {
    assert.equal(normalizeAuctionUrl("  "), null);
    assert.equal(normalizeAuctionUrl(" https://x.test/l/1 "), "https://x.test/l/1");
    assert.equal(normalizeAuctionText(null), null);
    assert.equal(normalizeAuctionText("  123 a "), "123 a");
  });
});

describe("deriveAuctionSaleName", () => {
  it("joins seller and platform", () => {
    assert.equal(deriveAuctionSaleName("Philkam", "Allegro"), "Philkam · Allegro");
  });
  it("does not repeat a house selling directly", () => {
    assert.equal(deriveAuctionSaleName("Köhler", "Köhler"), "Köhler");
  });
});
