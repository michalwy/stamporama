import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlatformFigures } from "../../src/lib/platform-figures";
import type { MoneyTotal } from "../../src/lib/contact-page-rules";
import {
  FIGURE_LOADING,
  moneyWords,
  platformFigureHrefs,
  platformFigureTiles,
} from "../../src/app/c/[collectionSlug]/settings/platform-figures-summary";

/**
 * The figures row of a platform's summary strip (#1960): the contact page's nine figures (#1710) in
 * its order, each opening the list it counts narrowed to the platform alone, with the contact page's
 * money rules.
 */

const eur = (base: string | null, extra: Partial<MoneyTotal> = {}): MoneyTotal => ({
  baseCurrency: "EUR",
  base,
  unconvertedCount: 0,
  tx: null,
  ...extra,
});

const FIGURES: PlatformFigures = {
  activeCount: 2,
  readyCount: 1,
  soldCount: 3,
  withdrawnCount: 1,
  sellThrough: 0.75,
  avgDaysToSale: 20.5,
  timedCount: 2,
  salesCount: 3,
  revenue: eur("100.00"),
  purchaseCount: 2,
  purchaseSpent: eur("19.00"),
};

const href = platformFigureHrefs("my-col", "p1");

describe("platform figures row (#1960)", () => {
  it("states the nine figures in the contact page's order", () => {
    const tiles = platformFigureTiles(FIGURES, href);
    assert.deepEqual(
      tiles.map((t) => [t.title, t.figure, t.detail]),
      [
        ["Offers active", "2", "now"],
        ["Offers ready", "1", "now"],
        ["Offers sold", "3", null],
        ["Sales", "3", null],
        ["Revenue", "100.00 EUR", null],
        ["Sell-through", "75%", "3 of 4 ended"],
        ["Time to sale", "20.5 days", "over 2 of 3 sold"],
        ["Purchases", "2", null],
        ["Spent", "19.00 EUR", null],
      ]
    );
  });

  it("opens each figure's list, narrowed to the platform and nothing the list remembers", () => {
    const byKey = Object.fromEntries(platformFigureTiles(FIGURES, href).map((t) => [t.key, t.href]));
    assert.equal(byKey.active, "/c/my-col/offers?platform=p1&state=active&search=");
    assert.equal(byKey["sell-through"], "/c/my-col/offers?platform=p1&state=sold%2Cwithdrawn&search=");
    assert.equal(byKey["time-to-sale"], "/c/my-col/offers?platform=p1&state=sold&search=");
    assert.equal(byKey.sales, "/c/my-col/sales?platform=p1&status=&search=");
    assert.equal(byKey.revenue, byKey.sales);
    assert.equal(byKey.purchases, "/c/my-col/purchases?type=purchase&platform=p1&supplier=&status=");
    assert.equal(byKey.spent, byKey.purchases);
  });

  it("opens nothing for a ratio with no offers behind it", () => {
    const none = platformFigureTiles(
      { ...FIGURES, soldCount: 0, withdrawnCount: 0, sellThrough: null, avgDaysToSale: null, timedCount: 0 },
      href
    );
    const st = none.find((t) => t.key === "sell-through")!;
    const tts = none.find((t) => t.key === "time-to-sale")!;
    assert.deepEqual([st.figure, st.detail, st.href], ["—", null, null]);
    assert.deepEqual([tts.figure, tts.detail, tts.href], ["—", null, null]);
  });

  it("names every figure and opens nothing while they are being read", () => {
    const tiles = platformFigureTiles(null, href);
    assert.equal(tiles.length, 9);
    assert.ok(tiles.every((t) => t.figure === FIGURE_LOADING && t.href === null));
  });
});

describe("platform figures money (#1960)", () => {
  it("states the base total, and the one other currency's beside it", () => {
    assert.deepEqual(moneyWords(eur("40.00", { tx: { currency: "PLN", total: "170.00" } }), "sale"), {
      figure: "40.00 EUR",
      detail: "170.00 PLN",
      hint: null,
    });
  });

  it("states no partial base total, and says how many have no rate", () => {
    const words = moneyWords(
      eur(null, { unconvertedCount: 2, tx: { currency: "USD", total: "12.00" } }),
      "purchase"
    );
    assert.equal(words.figure, "12.00 USD");
    assert.equal(words.detail, "2 purchases without an exchange rate");
    assert.match(words.hint!, /2 purchases have no exchange rate into EUR/);
    assert.equal(moneyWords(eur(null, { unconvertedCount: 1 }), "sale").figure, "No EUR total");
  });
});
