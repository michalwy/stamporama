import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canRecordTradeRealisation,
  countTradeRealisation,
  COMMITTING_FULFILLMENTS,
  describeStruckOff,
  hasTradeVerdict,
  isCommittingFulfillment,
  isRealisedFulfillment,
  isTradeFulfillment,
  isTradeRealisationVisible,
  parseTradeFulfillment,
  readTradeFulfillment,
  TRADE_FULFILLMENTS,
  TRADE_FULFILLMENT_NOTE_MAX,
  tradeClosingBlockerMessage,
  tradeFulfillmentLabel,
  tradeFulfillmentSentence,
  tradeShareFulfillmentLabel,
  UNANSWERED_FULFILLMENTS,
} from "../../src/lib/trade-realisation-rules";
import { TRADE_STATUSES } from "../../src/lib/trade-rules";

// The realisation vocabulary (#642; ADR-0039 §11). What matters here: `pending` counts toward the
// realised figures so a fresh agreement does not report itself as its own difference, only a
// withdrawal releases a copy, the verdict window is the mirror image of the editing lock, and the
// two struck-off words are worded per side without inventing a distinction that is not there.

describe("the vocabulary", () => {
  it("accepts only its own four spellings", () => {
    for (const f of TRADE_FULFILLMENTS) assert.equal(isTradeFulfillment(f), true);
    assert.equal(isTradeFulfillment("lost"), false);
    assert.equal(isTradeFulfillment(undefined), false);
  });

  it("reads an unreadable column as a line nobody has answered for", () => {
    assert.equal(readTradeFulfillment("who knows"), "pending");
    assert.equal(readTradeFulfillment("withdrawn"), "withdrawn");
  });

  it("words a withdrawal per side and a shortfall the same on both", () => {
    assert.equal(tradeFulfillmentLabel("withdrawn", "give"), "I withdrew it");
    assert.equal(tradeFulfillmentLabel("withdrawn", "receive"), "Partner withdrew it");
    // The same sentence whichever parcel it is about — a second phrasing would suggest a
    // distinction that is not there.
    assert.equal(
      tradeFulfillmentLabel("missing", "give"),
      tradeFulfillmentLabel("missing", "receive")
    );
  });

  it("explains a verdict differently on the two sides", () => {
    assert.notEqual(
      tradeFulfillmentSentence("fulfilled", "give"),
      tradeFulfillmentSentence("fulfilled", "receive")
    );
  });

  it("says nothing to the partner about a line that went as agreed", () => {
    // What a partner opens that page for after the handshake is what has **changed**.
    assert.equal(tradeShareFulfillmentLabel("pending"), null);
    assert.equal(tradeShareFulfillmentLabel("fulfilled"), null);
    assert.equal(tradeShareFulfillmentLabel("withdrawn"), "Withdrawn");
    assert.equal(tradeShareFulfillmentLabel("missing"), "Never arrived");
  });
});

describe("what counts as realised", () => {
  it("counts a pending line, so a fresh agreement is not its own difference", () => {
    assert.equal(isRealisedFulfillment("pending"), true);
    assert.equal(isRealisedFulfillment("fulfilled"), true);
  });

  it("drops what was struck off", () => {
    assert.equal(isRealisedFulfillment("withdrawn"), false);
    assert.equal(isRealisedFulfillment("missing"), false);
  });
});

describe("what still commits a copy (#639)", () => {
  it("releases only on a withdrawal", () => {
    assert.equal(isCommittingFulfillment("withdrawn"), false);
    // A fulfilled line's copy went in the envelope and a missing one's went too. Neither is back on
    // the shelf, so neither is free to be listed.
    assert.equal(isCommittingFulfillment("fulfilled"), true);
    assert.equal(isCommittingFulfillment("missing"), true);
    assert.equal(isCommittingFulfillment("pending"), true);
  });

  it("derives the query's list from that judgement rather than restating it", () => {
    assert.deepEqual([...COMMITTING_FULFILLMENTS].sort(), ["fulfilled", "missing", "pending"]);
  });
});

describe("the window a verdict may be written in", () => {
  it("is agreed and nothing else — the mirror image of the editing lock", () => {
    for (const status of TRADE_STATUSES) {
      assert.equal(canRecordTradeRealisation(status), status === "agreed");
    }
  });

  it("is narrower than the window the two balances are shown in", () => {
    assert.equal(isTradeRealisationVisible("agreed"), true);
    assert.equal(isTradeRealisationVisible("closed"), true);
    // A reopened trade is a plan again; before the agreement there is nothing to have diverged from.
    assert.equal(isTradeRealisationVisible("shared"), false);
    assert.equal(isTradeRealisationVisible("preparing"), false);
    assert.equal(isTradeRealisationVisible("cancelled"), false);
  });
});

describe("parseTradeFulfillment", () => {
  it("refuses a spelling it does not know", () => {
    const parsed = parseTradeFulfillment("lost", null);
    assert.equal(parsed.ok, false);
  });

  it("keeps the reason beside a verdict", () => {
    const parsed = parseTradeFulfillment("withdrawn", "  gum toned  ");
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, { fulfillment: "withdrawn", note: "gum toned" });
  });

  it("clears the reason when the verdict is taken back", () => {
    // A reason with nothing left to explain reads as a verdict and is none.
    const parsed = parseTradeFulfillment("pending", "gum toned");
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, { fulfillment: "pending", note: null });
  });

  it("treats an empty reason as none rather than as an empty string", () => {
    const parsed = parseTradeFulfillment("fulfilled", "   ");
    assert.equal(parsed.ok && parsed.value?.note, null);
  });

  it("caps the reason", () => {
    const parsed = parseTradeFulfillment("missing", "x".repeat(TRADE_FULFILLMENT_NOTE_MAX + 1));
    assert.equal(parsed.ok, false);
  });
});

describe("counting and naming", () => {
  it("counts each state", () => {
    const counts = countTradeRealisation([
      "pending",
      "pending",
      "fulfilled",
      "withdrawn",
      "missing",
    ]);
    assert.deepEqual(counts, { pending: 2, fulfilled: 1, withdrawn: 1, missing: 1 });
  });

  it("says nothing where nothing was struck off", () => {
    assert.equal(describeStruckOff(countTradeRealisation(["pending", "fulfilled"])), null);
  });

  it("names both kinds of strike-off apart", () => {
    assert.equal(
      describeStruckOff(countTradeRealisation(["withdrawn", "withdrawn", "missing"])),
      "2 withdrawn · 1 never arrived"
    );
  });
});

describe("the closing gate", () => {
  it("only pending lines are unanswered", () => {
    assert.deepEqual([...UNANSWERED_FULFILLMENTS], ["pending"]);
    assert.equal(hasTradeVerdict("pending"), false);
    assert.equal(hasTradeVerdict("fulfilled"), true);
  });

  it("says nothing when every line has been answered for", () => {
    assert.equal(tradeClosingBlockerMessage([]), null);
  });

  it("names the offenders rather than counting them and stopping", () => {
    const message = tradeClosingBlockerMessage(["Mi·PL 309 (U)", "Mi·PL 310 (U)"]);
    assert.match(message ?? "", /2 lines have no verdict yet/);
    assert.match(message ?? "", /Mi·PL 309 \(U\), Mi·PL 310 \(U\)/);
  });

  it("cuts the list at the same length every other trade refusal does", () => {
    const message = tradeClosingBlockerMessage(
      Array.from({ length: 8 }, (_, i) => `Mi·PL ${300 + i} (U)`)
    );
    assert.match(message ?? "", /and 3 more/);
  });

  it("reads as one line in the singular", () => {
    assert.match(tradeClosingBlockerMessage(["Mi·PL 309 (U)"]) ?? "", /^One line has/);
  });
});
