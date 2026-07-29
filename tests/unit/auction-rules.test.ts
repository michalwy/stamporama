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
  deriveAuctionLotLabel,
  parseLotQuantity,
  parsePremiumPercent,
  type AuctionLotLabelLine,
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

// parseLotQuantity ----------------------------------------------------------

describe("parseLotQuantity", () => {
  it("reads a blank field as one", () => {
    // A line added without touching the field is one stamp — the schema's own default.
    assert.deepEqual(parseLotQuantity(""), { ok: true, value: 1 });
    assert.deepEqual(parseLotQuantity("   "), { ok: true, value: 1 });
  });

  it("accepts a whole number", () => {
    assert.deepEqual(parseLotQuantity("4"), { ok: true, value: 4 });
  });

  it("refuses a fraction", () => {
    assert.equal(parseLotQuantity("1.5").ok, false);
    assert.equal(parseLotQuantity("abc").ok, false);
  });

  it("refuses none of something — that is a line to delete", () => {
    assert.equal(parseLotQuantity("0").ok, false);
    assert.equal(parseLotQuantity("-2").ok, false);
  });

  it("refuses an implausible count", () => {
    assert.equal(parseLotQuantity("10000").ok, false);
    assert.deepEqual(parseLotQuantity("9999"), { ok: true, value: 9999 });
  });
});

// deriveAuctionLotLabel ------------------------------------------------------

describe("deriveAuctionLotLabel", () => {
  const line = (over: Partial<AuctionLotLabelLine> = {}): AuctionLotLabelLine => ({
    catalogNumbers: ["Mi·PL 1"],
    stampName: null,
    issueId: "iss",
    issueName: "Definitives",
    issueYear: 1950,
    quantity: 1,
    ...over,
  });

  it("leads with the numbers, collapsed, and follows with the issue", () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      line({ catalogNumbers: [`Mi·PL ${i + 1}`] })
    );
    // The prefix rides inside the collapsing — it is simply the numbering family's constant part —
    // so it is written once, around the span.
    assert.equal(deriveAuctionLotLabel(lines), "Mi·PL 1-12 · Definitives (1950)");
  });

  it("collapses on both of #150's axes, through the listing-title engine", () => {
    const lines = [
      line({ catalogNumbers: ["Mi BL31"] }),
      line({ catalogNumbers: ["Mi BL32"] }),
      line({ catalogNumbers: ["Mi BL33"] }),
      line({ catalogNumbers: ["Mi 40"] }),
      line({ catalogNumbers: ["Mi 41"] }),
      line({ catalogNumbers: ["Mi 42A"] }),
    ];
    // Families are emitted in first-seen order, and `42A` is its own family (a different suffix),
    // so it stands beside the `40-41` run rather than inside it.
    assert.equal(deriveAuctionLotLabel(lines), "Mi BL31-33,Mi 40-41,Mi 42A · Definitives (1950)");
  });

  it("collapses bare Roman numerals under their prefix, and only within it (#384)", () => {
    assert.equal(
      deriveAuctionLotLabel([
        line({ catalogNumbers: ["Mi·PL I"] }),
        line({ catalogNumbers: ["Mi·PL II"] }),
        line({ catalogNumbers: ["Mi·PL III"] }),
        line({ catalogNumbers: ["Mi·DE I"] }),
      ]),
      "Mi·PL I-III,Mi·DE I · Definitives (1950)"
    );
  });

  it("names only the primary catalogue, never three numbering systems at once", () => {
    // Second and third numbers are other vendors' — printing them side by side names none of them.
    assert.equal(
      deriveAuctionLotLabel([line({ catalogNumbers: ["Mi·PL 7", "Sc 39", "Fi 1"] })]),
      "Mi·PL 7 · Definitives (1950)"
    );
  });

  it("keeps two areas' numbers apart, each under its own prefix", () => {
    assert.equal(
      deriveAuctionLotLabel([
        line({ catalogNumbers: ["Mi·PL 1"] }),
        line({ catalogNumbers: ["Mi·PL 2"] }),
        line({ catalogNumbers: ["Mi·DE 5"] }),
      ]),
      "Mi·PL 1-2,Mi·DE 5 · Definitives (1950)"
    );
  });

  it("gives a mixed lot its size rather than enumerating it", () => {
    const lines = [
      line({ issueId: "a", issueName: "A", quantity: 3 }),
      line({ issueId: "b", issueName: "B", quantity: 11 }),
    ];
    assert.equal(deriveAuctionLotLabel(lines), "14 stamps · 2 issues");
  });

  it("falls back to stamp names when nothing carries a catalog number", () => {
    assert.equal(
      deriveAuctionLotLabel([
        line({ catalogNumbers: [], stampName: "Chopin" }),
        line({ catalogNumbers: [], stampName: "Curie" }),
      ]),
      "Chopin, Curie · Definitives (1950)"
    );
  });

  it("falls back to the count when there are neither numbers nor few enough names", () => {
    const lines = ["a", "b", "c", "d"].map((n) => line({ catalogNumbers: [], stampName: n }));
    assert.equal(deriveAuctionLotLabel(lines), "4 stamps · Definitives (1950)");
  });

  it("drops the issue part when the stamps belong to none", () => {
    assert.equal(
      deriveAuctionLotLabel([line({ issueId: null, issueName: null, issueYear: null })]),
      "Mi·PL 1"
    );
  });

  it("counts quantity, not lines", () => {
    assert.equal(
      deriveAuctionLotLabel([
        line({ issueId: "a", quantity: 2 }),
        line({ issueId: "b", quantity: 5 }),
      ]),
      "7 stamps · 2 issues"
    );
  });

  it("has nothing to derive from an empty composition", () => {
    assert.equal(deriveAuctionLotLabel([]), null);
  });
});
