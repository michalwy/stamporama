import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerAssistantFacts } from "../../src/lib/offer-assistant-runs";
import {
  fixEverythingSummary,
  planFixEverything,
  planSoldElsewhereRemoval,
  type FixableOffer,
} from "../../src/lib/offer-fix-everything";
import type { OfferState } from "../../src/lib/offer-rules";

let next = 0;
function offer(over: Partial<FixableOffer> = {}): FixableOffer {
  next += 1;
  return {
    id: `o${next}`,
    offerNo: next,
    state: "preparing",
    platformName: "Delcampe",
    needsAction: false,
    needsResolution: false,
    platformSale: null,
    listingOutOfDate: null,
    listingToClose: null,
    assistant: null,
    soldElsewhere: null,
    ...over,
  };
}

/** A Preparing offer with `sold` sets sold elsewhere and `left` still for sale. */
function prepared(sold: number, left: number, state: OfferState = "preparing"): FixableOffer {
  return offer({
    state,
    needsAction: true,
    soldElsewhere: { setIds: Array.from({ length: sold }, (_, i) => `s${i}`), leftToSell: left },
  });
}

/** An Active Colnect listing, with the Assistant's facts as the list builds them. */
function colnect(sets: { id: string; sold: boolean; soldElsewhere: boolean; needsAction: boolean }[]): FixableOffer {
  const se = sets.filter((s) => s.soldElsewhere);
  const left = sets.filter((s) => !s.sold && !s.soldElsewhere).length;
  return offer({
    state: "active",
    platformName: "Colnect",
    needsAction: sets.some((s) => s.needsAction),
    assistant: offerAssistantFacts({
      state: "active",
      platformModule: "colnect",
      url: "https://colnect.com/en/sell/sale/x",
      colnectSaleId: "x",
      listingOutOfDate: false,
      sets,
    }),
    soldElsewhere: se.length > 0 ? { setIds: se.map((s) => s.id), leftToSell: left } : null,
  });
}
const forSale = (id: string) => ({ id, sold: false, soldElsewhere: false, needsAction: false });
const goneElsewhere = (id: string) => ({ id, sold: false, soldElsewhere: true, needsAction: true });

const ctx = { assistantUnavailable: null, queued: new Set<string>() };

describe("planSoldElsewhereRemoval (#2581)", () => {
  it("runs on the offers that keep something to sell and leaves the sold-out ones, with the reason", () => {
    const partly = [prepared(1, 1), prepared(2, 3)];
    const soldOut = [prepared(1, 0), prepared(1, 0), prepared(1, 0)];
    const { run, leftAlone } = planSoldElsewhereRemoval([...partly, ...soldOut]);
    assert.deepEqual(run, partly);
    assert.deepEqual(
      leftAlone.map((l) => [l.offer, l.reason]),
      soldOut.map((o) => [o, "Nothing would be left: withdraw it instead"])
    );
  });

  it("leaves an offer with no set sold elsewhere alone", () => {
    const { run, leftAlone } = planSoldElsewhereRemoval([offer()]);
    assert.equal(run.length, 0);
    assert.equal(leftAlone[0].reason, "No set sold elsewhere");
  });

  it("covers a live listing on a platform without the Assistant's update", () => {
    const live = { ...prepared(1, 2), state: "active" as const };
    assert.deepEqual(planSoldElsewhereRemoval([live]).run, [live]);
  });

  it("leaves a Colnect listing to Update via Assistant, which removes them itself (#1835)", () => {
    const o = colnect([forSale("a"), goneElsewhere("b")]);
    const { run, leftAlone } = planSoldElsewhereRemoval([o]);
    assert.equal(run.length, 0);
    assert.match(leftAlone[0].reason, /Update via Assistant/);
  });
});

describe("planFixEverything (#2581)", () => {
  it("gives the issue's mixed selection six fixes in one plan", () => {
    const closeA = colnect([goneElsewhere("a")]);
    const closeB = colnect([goneElsewhere("b"), goneElsewhere("c")]);
    const update = colnect([forSale("d"), goneElsewhere("e")]);
    const partlyA = prepared(1, 1);
    const partlyB = prepared(2, 1, "ready");
    const soldOut = prepared(1, 0);
    const { fixes, leftAlone } = planFixEverything(
      [closeA, closeB, update, partlyA, partlyB, soldOut],
      ctx
    );
    assert.equal(leftAlone.length, 0);
    assert.deepEqual(
      fixes.map((f) => [f.offer, f.fix]),
      [
        [closeA, "close"],
        [closeB, "close"],
        [update, "update"],
        [partlyA, "remove"],
        [partlyB, "remove"],
        [soldOut, "withdraw"],
      ]
    );
    assert.equal(
      fixEverythingSummary(fixes),
      "2 closed on Colnect · 1 updated on Colnect · 3 sets removed from 2 offers · 1 withdrawn"
    );
  });

  it("removes the sets from a live listing elsewhere that keeps something, and never withdraws one", () => {
    const keeps = { ...prepared(1, 1), state: "active" as const };
    const soldOut = { ...prepared(1, 0), state: "active" as const };
    const { fixes, leftAlone } = planFixEverything([keeps, soldOut], ctx);
    assert.deepEqual(fixes.map((f) => f.fix), ["remove"]);
    assert.equal(leftAlone[0].offer, soldOut);
    assert.match(leftAlone[0].reason, /take the listing down on Delcampe by hand/);
  });

  it("leaves alone, with the reason, what only the collector can do", () => {
    const cases: [FixableOffer, RegExp][] = [
      [offer({ state: "active", platformName: "Allegro", platformSale: { orderId: "1" } }), /record the sale/],
      [offer({ state: "sold", listingToClose: new Date() }), /Close the listing on Delcampe by hand/],
      [offer({ state: "active", listingOutOfDate: new Date() }), /update it on Delcampe by hand/],
      [offer({ state: "active", needsAction: true }), /bidding elsewhere/],
      [offer({ state: "active", needsResolution: true }), /Auction ended/],
      [offer(), /Nothing here needs fixing/],
    ];
    for (const [o, reason] of cases) {
      const { fixes, leftAlone } = planFixEverything([o], ctx);
      assert.equal(fixes.length, 0);
      assert.match(leftAlone[0].reason, reason);
    }
  });

  it("leaves the Assistant's offers alone while it cannot be asked, and those already queued", () => {
    const close = colnect([goneElsewhere("a")]);
    const removal = prepared(1, 1);
    const off = planFixEverything([close, removal], { ...ctx, assistantUnavailable: "Install the Assistant" });
    assert.deepEqual(off.fixes.map((f) => f.fix), ["remove"]);
    assert.equal(off.leftAlone[0].reason, "Install the Assistant");

    const queued = planFixEverything([close], { ...ctx, queued: new Set([close.id]) });
    assert.equal(queued.fixes.length, 0);
    assert.equal(queued.leftAlone[0].reason, "Already in the Assistant queue");
  });
});
