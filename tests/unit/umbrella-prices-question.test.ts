import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  joinWithAnd,
  ownPricesPhrase,
  parseUmbrellaPricesAnswer,
  summarizeOwnPrices,
  umbrellaPricesPolicyFrom,
} from "../../src/lib/umbrella-prices-question";

// #1573: what the question says about a stamp's own prices, and how a form's answer is read.

describe("summarizeOwnPrices — how many, and in which editions (#1573)", () => {
  it("counts every row and names each edition once, by catalogue then newest first", () => {
    const summary = summarizeOwnPrices([
      { catalogEditionId: "mi20", catalogName: "Michel", year: 2020 },
      { catalogEditionId: "fi23", catalogName: "Fischer", year: 2023 },
      { catalogEditionId: "mi20", catalogName: "Michel", year: 2020 },
      { catalogEditionId: "mi24", catalogName: "Michel", year: 2024 },
    ]);
    assert.equal(summary.priceCount, 4);
    assert.deepEqual(summary.editions, ["Fischer 2023", "Michel 2024", "Michel 2020"]);
  });

  it("answers nothing for a stamp without prices", () => {
    assert.deepEqual(summarizeOwnPrices([]), { priceCount: 0, editions: [] });
  });
});

describe("ownPricesPhrase — what is at stake for one stamp (#1573)", () => {
  it("names the count and the editions", () => {
    assert.equal(
      ownPricesPhrase({ priceCount: 6, editions: ["Fischer 2023", "Michel 2020"] }),
      "6 catalogue prices of its own, in Fischer 2023 and Michel 2020"
    );
  });

  it("speaks of one price in the singular", () => {
    assert.equal(
      ownPricesPhrase({ priceCount: 1, editions: ["Michel 2020"] }),
      "1 catalogue price of its own, in Michel 2020"
    );
  });

  it("joins three editions with commas and a final and", () => {
    assert.equal(joinWithAnd(["A", "B", "C"]), "A, B and C");
    assert.equal(joinWithAnd(["A"]), "A");
    assert.equal(joinWithAnd([]), "");
  });
});

describe("the form's answer (#1573)", () => {
  it("reads keep and clear, and nothing else", () => {
    assert.equal(parseUmbrellaPricesAnswer("keep"), "keep");
    assert.equal(parseUmbrellaPricesAnswer("clear"), "clear");
    assert.equal(parseUmbrellaPricesAnswer("ask"), null);
    assert.equal(parseUmbrellaPricesAnswer(null), null);
    assert.equal(parseUmbrellaPricesAnswer(""), null);
  });

  it("asks when the form carries no answer — a screen never writes past the question", () => {
    assert.equal(umbrellaPricesPolicyFrom(null), "ask");
    assert.equal(umbrellaPricesPolicyFrom("bogus"), "ask");
    assert.equal(umbrellaPricesPolicyFrom("clear"), "clear");
  });
});
