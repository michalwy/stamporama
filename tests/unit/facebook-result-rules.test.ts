import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanFacebookWin,
  normalizeFacebookProfileUrl,
  splitAuctionPrice,
} from "../../src/lib/facebook-result-rules";

// A Facebook auction's result (#1545; ADR-0061 §4): the profile link a repeat buyer is recognised by,
// the final price spread over the offer's sets, and the dialog's fields checked. The database half is
// `tests/integration/facebook-results.test.ts`.

describe("normalizeFacebookProfileUrl", () => {
  const value = (raw: string) => {
    const r = normalizeFacebookProfileUrl(raw);
    assert.ok(r.ok, raw);
    return r.value;
  };

  it("stores every address of one profile as one link", () => {
    const canonical = "https://www.facebook.com/jan.kowalski";
    assert.equal(value("https://www.facebook.com/jan.kowalski"), canonical);
    assert.equal(value("https://m.facebook.com/Jan.Kowalski/"), canonical);
    assert.equal(value("facebook.com/jan.kowalski?ref=bookmarks#x"), canonical);
    assert.equal(value("  https://web.facebook.com/jan.kowalski  "), canonical);
    assert.equal(value("http://fb.com/jan.kowalski"), canonical);
  });

  it("keeps the id of a profile.php link, which is the profile", () => {
    assert.equal(
      value("https://m.facebook.com/profile.php?id=100012345678&mibextid=abc"),
      "https://www.facebook.com/profile.php?id=100012345678"
    );
    assert.equal(normalizeFacebookProfileUrl("https://www.facebook.com/profile.php").ok, false);
  });

  it("reads blank as no link, and refuses an address that is not a profile", () => {
    assert.deepEqual(normalizeFacebookProfileUrl("   "), { ok: true, value: null });
    assert.deepEqual(normalizeFacebookProfileUrl(null), { ok: true, value: null });
    assert.equal(normalizeFacebookProfileUrl("https://allegro.pl/uzytkownik/jan").ok, false);
    assert.equal(normalizeFacebookProfileUrl("https://www.facebook.com/").ok, false);
    assert.equal(normalizeFacebookProfileUrl("not a link at all").ok, false);
  });
});

describe("splitAuctionPrice", () => {
  it("gives one set the whole price", () => {
    assert.deepEqual(splitAuctionPrice("42.50", 1), ["42.50"]);
  });

  it("spreads it in cents, the odd ones first, adding back up exactly", () => {
    const lines = splitAuctionPrice("10.00", 3);
    assert.deepEqual(lines, ["3.34", "3.33", "3.33"]);
    assert.equal(lines.reduce((n, p) => n + Math.round(Number(p) * 100), 0), 1000);
  });

  it("has nothing to split over no sets", () => {
    assert.deepEqual(splitAuctionPrice("10.00", 0), []);
  });
});

describe("cleanFacebookWin", () => {
  const input = {
    winnerName: "  Jan Kowalski ",
    profileUrl: "https://m.facebook.com/jan.kowalski/",
    price: "12,5",
    soldOn: "2026-10-05",
    saleId: "",
  };

  it("reads the dialog's fields", () => {
    const r = cleanFacebookWin(input);
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      winnerName: "Jan Kowalski",
      profileUrl: "https://www.facebook.com/jan.kowalski",
      price: "12.50",
      soldAt: new Date("2026-10-05T00:00:00.000Z"),
      saleId: null,
    });
  });

  it("refuses a result with no winner, no winning bid or no day", () => {
    assert.equal(cleanFacebookWin({ ...input, winnerName: " " }).ok, false);
    assert.equal(cleanFacebookWin({ ...input, price: "0" }).ok, false);
    assert.equal(cleanFacebookWin({ ...input, price: "abc" }).ok, false);
    assert.equal(cleanFacebookWin({ ...input, soldOn: "2026-02-31" }).ok, false);
    assert.equal(cleanFacebookWin({ ...input, profileUrl: "https://example.com/jan" }).ok, false);
  });

  it("says a quick buy's refusals in its own words — a buyer and a price, not a winner and a bid (#1671)", () => {
    assert.deepEqual(cleanFacebookWin({ ...input, winnerName: "" }, "fixed"), {
      ok: false,
      message: "Name the buyer as their Facebook profile shows it.",
    });
    assert.deepEqual(cleanFacebookWin({ ...input, price: "0" }, "fixed"), {
      ok: false,
      message: "Enter the price it sold for — an amount above zero.",
    });
    assert.deepEqual(cleanFacebookWin({ ...input, price: "0" }), {
      ok: false,
      message: "Enter the winning bid — an amount above zero.",
    });
  });
});
