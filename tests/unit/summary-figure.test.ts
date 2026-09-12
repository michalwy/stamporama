import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  differenceFigure,
  negatedAmount,
  signedAmount,
  stateFigure,
  type StatedFigure,
} from "../../src/lib/summary-figure";

// A summary figure with nothing behind it (#1184). The bug was not arithmetic — every sum here is
// correct — it was that three different situations all arrived at the screen as `0.00`:
//
//   nothing worked out yet   the alarming reading the collector actually got, on a purchase of
//                            1355 copies with no market evidence and no closed lot
//   worked out from part     a useful figure, as long as it is not passed off as complete
//   genuinely zero           a true statement that must survive the fix
//
// Each is asserted on the counts that separate them, because nothing else can.

const UNKNOWN: StatedFigure = { state: "unknown", amount: null };

describe("stateFigure", () => {
  it("states no amount when nothing contributed and something was meant to", () => {
    // The live purchase from the issue: market value over 1355 copies, none with auction results.
    assert.deepEqual(stateFigure("0.00", 0, 1355), UNKNOWN);
  });

  it("states a figure built from part of the scope, and says it is partial", () => {
    assert.deepEqual(stateFigure("340.50", 12, 1343), { state: "partial", amount: "340.50" });
  });

  it("states a genuine zero when every copy in scope contributed", () => {
    assert.deepEqual(stateFigure("0.00", 1355, 0), { state: "complete", amount: "0.00" });
  });

  it("states zero for an empty scope rather than claiming a pending calculation", () => {
    // A purchase with no copies yet has nothing to work out; zero is the answer, not a placeholder.
    assert.deepEqual(stateFigure("0.00", 0, 0), { state: "complete", amount: "0.00" });
  });

  it("never carries a negative zero through", () => {
    assert.equal(stateFigure("-0.00", 3, 0).amount, "0.00");
  });

  it("leaves a real amount's digits exactly as the read model stated them", () => {
    assert.equal(stateFigure("1200.40", 8, 0).amount, "1200.40");
  });
});

describe("differenceFigure", () => {
  const stated: StatedFigure = { state: "complete", amount: "100.00" };
  const partial: StatedFigure = { state: "partial", amount: "100.00" };

  it("states nothing when either side has nothing behind it", () => {
    // Subtracting a spend nobody has costed yet would state the whole of the proceeds as profit.
    assert.deepEqual(differenceFigure("120.00", [stated, UNKNOWN]), UNKNOWN);
    assert.deepEqual(differenceFigure("-120.00", [UNKNOWN, stated]), UNKNOWN);
  });

  it("inherits the weaker of the two sides when both are stated", () => {
    assert.deepEqual(differenceFigure("20.00", [stated, partial]), {
      state: "partial",
      amount: "20.00",
    });
    assert.deepEqual(differenceFigure("20.00", [stated, stated]), {
      state: "complete",
      amount: "20.00",
    });
  });

  it("never carries a negative zero through", () => {
    assert.equal(differenceFigure("-0.00", [stated, stated]).amount, "0.00");
  });
});

describe("negatedAmount", () => {
  it("states a deduction with the typographic minus", () => {
    assert.equal(negatedAmount("12.00"), "−12.00");
  });

  it("never produces a negative zero", () => {
    // The write-off row printed `−0.00 PLN`, which is the symptom the issue leads with.
    assert.equal(negatedAmount("0.00"), "0.00");
    assert.equal(negatedAmount("-0.00"), "0.00");
  });
});

describe("signedAmount", () => {
  it("always prints the sign", () => {
    assert.equal(signedAmount("120.00"), "+120.00");
    assert.equal(signedAmount("-12.50"), "−12.50");
  });

  it("gives zero a plus rather than a minus", () => {
    assert.equal(signedAmount("0.00"), "+0.00");
    assert.equal(signedAmount("-0.00"), "+0.00");
  });
});
