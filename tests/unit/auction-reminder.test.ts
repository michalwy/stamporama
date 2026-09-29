import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeReminderMessage,
  describeReminderStanding,
  isValidReminderHour,
  isValidTimeZone,
  localDayAndHour,
  nextLocalDay,
  reminderDueDay,
  reminderWindow,
  selectReminderLots,
  startOfLocalDay,
  type ReminderLot,
  type ReminderSettings,
} from "../../src/lib/auction-reminder-rules";

// The morning auction reminder (#1373): the day boundary in the collector's own zone, the
// once-a-day rule as far as it is pure, which lots are listed, and the message.

const WARSAW = "Europe/Warsaw";

function lot(overrides: Partial<ReminderLot> = {}): ReminderLot {
  return {
    id: "lot-1",
    auctionSaleId: "sale-1",
    auctionLotNo: 1,
    lotNo: "385",
    title: "Penny Black",
    endsAt: new Date("2026-09-30T16:00:00Z"),
    currentBid: null,
    myBid: null,
    maxBid: null,
    currency: "EUR",
    fees: {},
    saleName: "Köhler 385",
    platformName: "Philasearch",
    ...overrides,
  };
}

describe("the collector's day, in their zone (#1373)", () => {
  it("names the day and hour by the zone's clock, not UTC's", () => {
    // 22:30 UTC on the 29th is half past midnight on the 30th in Warsaw (CEST, +2).
    assert.deepEqual(localDayAndHour(new Date("2026-09-29T22:30:00Z"), WARSAW), {
      day: "2026-09-30",
      hour: 0,
    });
    // …and still the evening of the 29th in New York.
    assert.deepEqual(localDayAndHour(new Date("2026-09-29T22:30:00Z"), "America/New_York"), {
      day: "2026-09-29",
      hour: 18,
    });
    // A half-hour zone.
    assert.deepEqual(localDayAndHour(new Date("2026-09-29T19:00:00Z"), "Asia/Kolkata"), {
      day: "2026-09-30",
      hour: 0,
    });
  });

  it("starts a day at the zone's midnight, on both sides of a clock change", () => {
    assert.equal(startOfLocalDay("2026-09-30", WARSAW).toISOString(), "2026-09-29T22:00:00.000Z");
    assert.equal(startOfLocalDay("2026-01-15", WARSAW).toISOString(), "2026-01-14T23:00:00.000Z");
    // Spring forward on 29 March 2026: the day starts in CET and ends in CEST — 23 hours.
    const march29 = startOfLocalDay("2026-03-29", WARSAW);
    const march30 = startOfLocalDay("2026-03-30", WARSAW);
    assert.equal(march29.toISOString(), "2026-03-28T23:00:00.000Z");
    assert.equal(march30.toISOString(), "2026-03-29T22:00:00.000Z");
    assert.equal((march30.getTime() - march29.getTime()) / 3_600_000, 23);
    // Fall back on 25 October 2026 — 25 hours.
    const oct25 = startOfLocalDay("2026-10-25", WARSAW);
    const oct26 = startOfLocalDay("2026-10-26", WARSAW);
    assert.equal((oct26.getTime() - oct25.getTime()) / 3_600_000, 25);
    assert.equal(startOfLocalDay("2026-09-30", "Pacific/Auckland").toISOString(), "2026-09-29T11:00:00.000Z");
  });

  it("steps to the next calendar day across months and years", () => {
    assert.equal(nextLocalDay("2026-09-30"), "2026-10-01");
    assert.equal(nextLocalDay("2026-12-31"), "2027-01-01");
    assert.equal(nextLocalDay("2028-02-28"), "2028-02-29");
  });

  it("looks for lots from now to the end of the collector's day", () => {
    const now = new Date("2026-09-30T06:05:00Z");
    const w = reminderWindow("2026-09-30", WARSAW, now);
    assert.equal(w.from, now);
    assert.equal(w.until.toISOString(), "2026-09-30T22:00:00.000Z");
  });

  it("knows a zone from a typo", () => {
    assert.equal(isValidTimeZone(WARSAW), true);
    assert.equal(isValidTimeZone("UTC"), true);
    assert.equal(isValidTimeZone("Europe/Warsau"), false);
    assert.equal(isValidTimeZone(""), false);
  });

  it("takes a whole hour of the day and nothing else", () => {
    assert.equal(isValidReminderHour(0), true);
    assert.equal(isValidReminderHour(23), true);
    assert.equal(isValidReminderHour(24), false);
    assert.equal(isValidReminderHour(-1), false);
    assert.equal(isValidReminderHour(8.5), false);
  });
});

describe("when the reminder is due (#1373)", () => {
  const on: ReminderSettings = { enabled: true, hour: 8, timeZone: WARSAW, lastDay: null };

  it("is due once the chosen hour has come in the collector's zone", () => {
    // 05:59 UTC is 07:59 in Warsaw; 06:00 UTC is 08:00.
    assert.equal(reminderDueDay(on, new Date("2026-09-30T05:59:00Z")), null);
    assert.equal(reminderDueDay(on, new Date("2026-09-30T06:00:00Z")), "2026-09-30");
  });

  it("is still due after the hour when that day has not been done — a restart sends the missed one", () => {
    assert.equal(reminderDueDay(on, new Date("2026-09-30T19:00:00Z")), "2026-09-30");
    assert.equal(
      reminderDueDay({ ...on, lastDay: "2026-09-29" }, new Date("2026-09-30T19:00:00Z")),
      "2026-09-30"
    );
  });

  it("is never due twice for one day", () => {
    const done = { ...on, lastDay: "2026-09-30" };
    assert.equal(reminderDueDay(done, new Date("2026-09-30T06:00:00Z")), null);
    assert.equal(reminderDueDay(done, new Date("2026-09-30T21:59:00Z")), null);
    // The collector's next day, past the hour, is due again.
    assert.equal(reminderDueDay(done, new Date("2026-10-01T06:00:00Z")), "2026-10-01");
  });

  it("reads the day in the zone, so the same instant is a different day elsewhere", () => {
    // 23:30 UTC on the 30th: 01:30 on 1 October in Warsaw (before the hour), 19:30 on the 30th in
    // New York (after it).
    const now = new Date("2026-09-30T23:30:00Z");
    assert.equal(reminderDueDay({ ...on, lastDay: "2026-09-30" }, now), null);
    assert.equal(reminderDueDay({ ...on, timeZone: "America/New_York" }, now), "2026-09-30");
  });

  it("is not due while switched off, or without a zone", () => {
    const now = new Date("2026-09-30T10:00:00Z");
    assert.equal(reminderDueDay({ ...on, enabled: false }, now), null);
    assert.equal(reminderDueDay({ ...on, timeZone: null }, now), null);
    assert.equal(reminderDueDay({ ...on, timeZone: "Nowhere/Land" }, now), null);
  });
});

describe("which lots the reminder lists (#1373)", () => {
  it("lists them soonest first", () => {
    const late = lot({ id: "late", endsAt: new Date("2026-09-30T18:00:00Z") });
    const early = lot({ id: "early", endsAt: new Date("2026-09-30T09:00:00Z") });
    const { listed } = selectReminderLots([late, early]);
    assert.deepEqual(
      listed.map((l) => l.id),
      ["early", "late"]
    );
  });

  it("leaves out a lot already past the ceiling and the bid placed, and counts it", () => {
    const past = lot({ id: "past", currentBid: "100", myBid: "60", maxBid: "80" });
    const leadingAboveCeiling = lot({ id: "leading", currentBid: "90", myBid: "120", maxBid: "80" });
    const inReach = lot({ id: "reach", currentBid: "50", myBid: "40", maxBid: "80" });
    const { listed, outpricedCount } = selectReminderLots([past, leadingAboveCeiling, inReach]);
    assert.deepEqual(listed.map((l) => l.id).sort(), ["leading", "reach"]);
    assert.equal(outpricedCount, 1);
  });

  it("measures the ceiling all-in, as the exposure totals do", () => {
    // 75 hammer + 10% premium = 82.50 all-in, past an 80 ceiling.
    const premium = lot({ currentBid: "75", myBid: "70", maxBid: "80", fees: { premiumPercent: "10" } });
    assert.equal(selectReminderLots([premium]).outpricedCount, 1);
    assert.equal(selectReminderLots([{ ...premium, fees: {} }]).outpricedCount, 0);
  });
});

describe("where each lot stands, in the lots screen's words (#1373)", () => {
  const now = new Date("2026-09-30T06:00:00Z");

  it("says leading, with the bid placed and the ceiling", () => {
    assert.equal(
      describeReminderStanding(lot({ currentBid: "40", myBid: "55", maxBid: "55" }), now),
      "Leading at 40.00 EUR (your bid 55.00 EUR) · ceiling 55.00 EUR all-in"
    );
  });

  it("says outbid, and how far the ceiling still lets you go", () => {
    assert.equal(
      describeReminderStanding(lot({ currentBid: "50", myBid: "45", maxBid: "80" }), now),
      "Outbid at 50.00 EUR (your bid 45.00 EUR) · can still bid up to 80.00 EUR · ceiling 80.00 EUR all-in"
    );
  });

  it("takes the premium off what can still be bid", () => {
    assert.match(
      describeReminderStanding(
        lot({ currentBid: "50", myBid: "45", maxBid: "125", fees: { premiumPercent: "25" } }),
        now
      ),
      /can still bid up to 100\.00 EUR/
    );
  });

  it("says when no bid has been placed", () => {
    assert.equal(describeReminderStanding(lot(), now), "No bid placed");
    assert.equal(describeReminderStanding(lot({ currentBid: "12.5" }), now), "No bid placed; at 12.50 EUR");
  });
});

describe("the reminder message (#1373)", () => {
  const now = new Date("2026-09-30T06:00:00Z");
  const base = {
    day: "2026-09-30",
    timeZone: WARSAW,
    now,
    outpricedCount: 0,
    lotUrl: (l: ReminderLot) => `https://stamps.example.com/c/main/auctions/sales/${l.auctionSaleId}?lot=${l.id}`,
  };

  it("sends nothing when no lot is listed — even when some were left out as past reach", () => {
    assert.equal(composeReminderMessage({ ...base, listed: [] }), null);
    assert.equal(composeReminderMessage({ ...base, listed: [], outpricedCount: 3 }), null);
  });

  it("lists each lot at its end time in the collector's zone, with its sale, platform, standing and link", () => {
    const message = composeReminderMessage({
      ...base,
      listed: [
        lot({ id: "a", endsAt: new Date("2026-09-30T12:30:00Z"), currentBid: "40", myBid: "55" }),
        lot({ id: "b", title: null, lotNo: "1201", endsAt: new Date("2026-09-30T17:00:00Z") }),
      ],
      outpricedCount: 1,
    });
    assert.ok(message);
    assert.equal(message.subject, "2 watched auction lots end today, Wednesday 30 September");
    const text = message.text;
    // 12:30 UTC is 14:30 in Warsaw.
    assert.match(text, /^14:30 {2}Penny Black$/m);
    assert.match(text, /^19:00 {2}Lot 1201$/m);
    assert.match(text, /Köhler 385 · Philasearch/);
    assert.match(text, /Leading at 40\.00 EUR \(your bid 55\.00 EUR\)/);
    assert.match(text, /https:\/\/stamps\.example\.com\/c\/main\/auctions\/sales\/sale-1\?lot=a/);
    assert.match(text, /1 more lot ends today already past your ceiling; it is not listed\./);
    assert.ok(text.indexOf("14:30") < text.indexOf("19:00"));
  });

  it("leaves the link out when the instance has no configured address", () => {
    const message = composeReminderMessage({ ...base, listed: [lot()], lotUrl: () => null });
    assert.ok(message);
    assert.equal(message.subject, "1 watched auction lot ends today, Wednesday 30 September");
    assert.doesNotMatch(message.text, /https?:/);
  });
});
