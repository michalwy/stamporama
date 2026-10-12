import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  differenceFigure,
  figureDirection,
  markEstimated,
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
const NOT_APPLICABLE: StatedFigure = { state: "not_applicable", amount: null };

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

  // #1325: copies from an opening-balance lot with no opening value have no cost at all.
  it("states not applicable when every copy in scope is one the figure cannot apply to", () => {
    assert.deepEqual(stateFigure("0.00", 0, 0, 12), NOT_APPLICABLE);
  });

  it("still waits when something in scope is yet to be worked out", () => {
    // A pending copy beside unvalued ones: a figure is coming, so it is not *not applicable*.
    assert.deepEqual(stateFigure("0.00", 0, 1, 12), UNKNOWN);
  });

  it("states the amount over the copies it applies to, and calls it complete", () => {
    assert.deepEqual(stateFigure("40.00", 3, 0, 12), { state: "complete", amount: "40.00" });
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

  it("is not applicable against a side that is not applicable (#1325)", () => {
    assert.deepEqual(differenceFigure("120.00", [stated, NOT_APPLICABLE]), NOT_APPLICABLE);
  });

  it("still waits when one side is not applicable and another is unknown", () => {
    assert.deepEqual(differenceFigure("120.00", [UNKNOWN, NOT_APPLICABLE]), UNKNOWN);
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

// A figure leaning on estimated costs is marked as one (#1881), and so is a difference against it.
describe("markEstimated", () => {
  it("marks a stated figure with estimated copies behind it", () => {
    assert.deepEqual(markEstimated(stateFigure("12.00", 3, 0), 2), {
      state: "complete",
      amount: "12.00",
      estimated: true,
    });
  });

  it("leaves a figure with no estimated copies unmarked", () => {
    assert.deepEqual(markEstimated(stateFigure("12.00", 3, 0), 0), {
      state: "complete",
      amount: "12.00",
    });
  });

  it("never marks an absence", () => {
    assert.deepEqual(markEstimated(stateFigure("0.00", 0, 4), 2), { state: "unknown", amount: null });
  });

  it("carries the mark through a difference", () => {
    const realized = stateFigure("50.00", 2, 0);
    const spent = markEstimated(stateFigure("30.00", 5, 0), 5);
    assert.deepEqual(differenceFigure("20.00", [realized, spent]), {
      state: "complete",
      amount: "20.00",
      estimated: true,
    });
    assert.deepEqual(differenceFigure("20.00", [realized, stateFigure("30.00", 5, 0)]), {
      state: "complete",
      amount: "20.00",
    });
  });

  it("gives an unknown difference no mark even beside an estimated side", () => {
    const spent = markEstimated(stateFigure("30.00", 5, 0), 5);
    assert.deepEqual(differenceFigure("0.00", [stateFigure("0.00", 0, 1), spent]), {
      state: "unknown",
      amount: null,
    });
  });
});

describe("figureDirection", () => {
  it("calls a positive figure a gain and a negative one a loss (#1883)", () => {
    assert.equal(figureDirection("46.44"), "gain");
    assert.equal(figureDirection("-516.23"), "loss");
    assert.equal(figureDirection(124.4), "gain");
    assert.equal(figureDirection(-86), "loss");
  });

  it("gives zero no direction, negative zero included", () => {
    assert.equal(figureDirection("0.00"), "none");
    assert.equal(figureDirection("-0.00"), "none");
    assert.equal(figureDirection(-0), "none");
  });

  it("gives an absence no direction", () => {
    assert.equal(figureDirection(null), "none");
  });

  it("reads an estimated difference by its amount, as a settled one", () => {
    const spent = markEstimated(stateFigure("600.00", 10, 0), 10);
    const net = differenceFigure("-516.23", [stateFigure("83.77", 2, 0), spent]);
    assert.equal(net.estimated, true);
    assert.equal(figureDirection(net.amount), "loss");
  });
});
