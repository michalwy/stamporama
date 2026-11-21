import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMMON_LANGUAGES } from "../../src/lib/languages";
import { TRADE_STATUSES } from "../../src/lib/trade-rules";
import {
  hasTradeShareLabels,
  TRADE_SHARE_LABEL_LANGUAGES,
  tradeShareCount,
  tradeShareCountText,
  tradeShareLabelLanguage,
  tradeShareLabels,
  tradeShareRejectLabel,
  tradeShareSideSummary,
} from "../../src/lib/trade-share-labels";

// The partner's page's own words in the partner's language (#2606).

describe("the partner's page's words (#2606)", () => {
  it("has words in every language the offer specification has them in", () => {
    assert.deepEqual([...TRADE_SHARE_LABEL_LANGUAGES], COMMON_LANGUAGES.map((l) => l.code).sort());
  });

  it("fills every word in every language", () => {
    for (const code of TRADE_SHARE_LABEL_LANGUAGES) {
      const words = tradeShareLabels(code);
      for (const [key, value] of Object.entries(words)) {
        if (typeof value === "string") assert.ok(value.trim(), `${code}.${key}`);
        else if (typeof value === "function") {
          const said = (value as (...args: unknown[]) => string)("A", "B", "C");
          assert.ok(typeof said === "string" && said.trim(), `${code}.${key}()`);
        } else {
          for (const [inner, text] of Object.entries(value as Record<string, string>)) {
            assert.ok(text.trim(), `${code}.${key}.${inner}`);
          }
        }
      }
      for (const status of TRADE_STATUSES) assert.ok(words.status[status], `${code}.status.${status}`);
    }
  });

  it("is English where the language has none, and says so", () => {
    assert.equal(hasTradeShareLabels("de"), true);
    assert.equal(hasTradeShareLabels("de-AT"), true);
    assert.equal(hasTradeShareLabels("ja"), false);
    assert.equal(hasTradeShareLabels(null), false);
    assert.equal(tradeShareLabels("ja").groupBy, "Group by");
    assert.equal(tradeShareLabelLanguage("ja"), "en");
    assert.equal(tradeShareLabels("de").groupBy, "Gruppieren nach");
    assert.equal(tradeShareLabels("de").from("Anna"), "Von Anna");
  });

  it("counts in each language's plural form", () => {
    assert.equal(tradeShareCountText("en", { lines: 1, pieces: 1 }), "1 stamp");
    assert.equal(tradeShareCountText("en", { lines: 9, pieces: 12 }), "12 stamps (9 lines)");
    assert.equal(tradeShareCount("pl", 3, (l) => l.stamps), "3 znaczki");
    assert.equal(tradeShareCount("pl", 5, (l) => l.stamps), "5 znaczków");
    assert.equal(tradeShareCountText("de", { lines: 2, pieces: 2 }), "2 Marken");
  });

  it("asks which copy with the number of copies in it", () => {
    assert.equal(tradeShareLabels("en").choicePrompt(2), "Two of these would do — which would you like?");
    assert.match(tradeShareLabels("en").choicePrompt(4), /^4 of these/);
  });
});

describe("what a side of the partner's page says it is carrying (#667)", () => {
  it("says nothing at all when nothing has been said", () => {
    assert.equal(tradeShareSideSummary("en", "give", { notes: 0, rejected: 0 }), null);
  });

  it("counts notes and marks apart — they are different acts", () => {
    assert.equal(
      tradeShareSideSummary("en", "give", { notes: 3, rejected: 1 }),
      "You left 3 notes and 1 marked not wanted on this side."
    );
  });

  it("uses the side's own word for the mark, as the chip on the row does", () => {
    assert.equal(
      tradeShareSideSummary("en", "receive", { notes: 0, rejected: 2 }),
      "You left 2 marked cannot send on this side."
    );
    assert.equal(tradeShareRejectLabel("de", "give"), "Nicht gewünscht");
  });

  it("counts one note as a note", () => {
    assert.equal(tradeShareSideSummary("en", "give", { notes: 1, rejected: 0 }), "You left 1 note on this side.");
  });

  it("says it in the partner's language", () => {
    assert.equal(
      tradeShareSideSummary("pl", "give", { notes: 2, rejected: 0 }),
      "Po tej stronie zostawiono: 2 uwagi."
    );
  });
});
