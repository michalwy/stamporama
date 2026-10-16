import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assistantActsOn,
  assistantRunLabel,
  assistantRunSummary,
  cancelQueued,
  enqueueRuns,
  liveRun,
  nextRun,
  offerAssistantFacts,
  patchRun,
  planAssistantRuns,
  queueBusy,
  type AssistantRun,
} from "../../src/lib/offer-assistant-runs";
import { needsActionRemedy } from "../../src/lib/offer-needs-action-remedy";

const colnect = {
  state: "active" as const,
  platformModule: "colnect",
  url: "https://colnect.com/en/sell/sale/abc",
  colnectSaleId: "abc",
  listingOutOfDate: false,
};
const forSale = { id: "s1", sold: false, soldElsewhere: false, needsAction: false };
const soldElsewhere = { id: "s2", sold: false, soldElsewhere: true, needsAction: true };
const biddingElsewhere = { id: "s3", sold: false, soldElsewhere: false, needsAction: true };

describe("offerAssistantFacts (#1969)", () => {
  it("is the offer screen's remedy, asked of the same sets", () => {
    for (const sets of [[soldElsewhere], [forSale, soldElsewhere], [forSale, biddingElsewhere], []]) {
      const facts = offerAssistantFacts({ ...colnect, sets });
      assert.deepEqual(
        facts?.remedy,
        needsActionRemedy({
          state: "active",
          needsAction: sets.some((s) => s.needsAction),
          listingOutOfDate: false,
          sets,
        })
      );
    }
  });

  it("highlights nothing on an offer in step", () => {
    assert.equal(offerAssistantFacts({ ...colnect, sets: [forSale] })?.remedy, null);
  });

  it("names the sets an update removes first", () => {
    assert.deepEqual(
      offerAssistantFacts({ ...colnect, sets: [forSale, soldElsewhere] })?.soldElsewhereSetIds,
      ["s2"]
    );
  });

  it("is null off Active and where the Assistant can do neither", () => {
    assert.equal(offerAssistantFacts({ ...colnect, state: "paused", sets: [soldElsewhere] }), null);
    assert.equal(
      offerAssistantFacts({ ...colnect, url: null, colnectSaleId: null, sets: [soldElsewhere] }),
      null
    );
    assert.equal(assistantActsOn({ ...colnect, platformModule: null }), false);
  });

  it("offers a highlight only where both actions are offered", () => {
    const noSale = offerAssistantFacts({ ...colnect, colnectSaleId: " ", sets: [soldElsewhere] });
    assert.equal(noSale?.closeSaleId, null);
    assert.equal(noSale?.update, true);
    assert.equal(noSale?.remedy, null);
  });
});

describe("planAssistantRuns (#1969)", () => {
  const close = { id: "a", assistant: offerAssistantFacts({ ...colnect, sets: [soldElsewhere] }) };
  const update = { id: "b", assistant: offerAssistantFacts({ ...colnect, sets: [forSale, soldElsewhere] }) };
  const inStep = { id: "c", assistant: offerAssistantFacts({ ...colnect, sets: [forSale] }) };
  const elsewhere = { id: "d", assistant: null };
  const ticked = [close, update, inStep, elsewhere];

  it("closes only what has nothing left to sell, and counts the rest", () => {
    const plan = planAssistantRuns(ticked, "close");
    assert.deepEqual(plan.run.map((o) => o.id), ["a"]);
    assert.equal(plan.skipped, 3);
  });

  it("updates only what still has something to sell and needs it", () => {
    const plan = planAssistantRuns(ticked, "update");
    assert.deepEqual(plan.run.map((o) => o.id), ["b"]);
    assert.equal(plan.skipped, 3);
  });
});

function run(offerId: string, act: "close" | "update" = "close") {
  return { offerId, offerNo: 1, label: offerId, act, saleId: "x", removeSetIds: [] };
}

describe("the Assistant queue (#1969)", () => {
  it("runs one at a time, in order", () => {
    let q = enqueueRuns([], [run("a"), run("b")]);
    assert.equal(nextRun(q)?.offerId, "a");
    q = patchRun(q, "a", { status: "running" });
    assert.equal(nextRun(q), null, "nothing starts while one is running");
    q = patchRun(q, "a", { status: "failed", message: "boom" });
    assert.equal(nextRun(q)?.offerId, "b", "a failure stops nothing else");
  });

  it("does not queue an offer twice, and requeues a finished one", () => {
    let q = enqueueRuns([], [run("a")]);
    q = enqueueRuns(q, [run("a")]);
    assert.equal(q.length, 1);
    q = patchRun(q, "a", { status: "failed", message: "boom" });
    q = enqueueRuns(q, [run("a")]);
    assert.deepEqual(q.map((r) => [r.offerId, r.status]), [["a", "queued"]]);
  });

  it("cancels what has not started and lets the running one finish", () => {
    let q = enqueueRuns([], [run("a"), run("b"), run("c")]);
    q = patchRun(q, "a", { status: "running" });
    q = cancelQueued(q);
    assert.deepEqual(q.map((r) => r.offerId), ["a"]);
    assert.equal(queueBusy(q), true);
    q = patchRun(q, "a", { status: "done" });
    assert.equal(queueBusy(q), false);
  });

  it("labels and summarises in the issue's words", () => {
    const [a] = enqueueRuns([], [run("a")]);
    assert.equal(assistantRunLabel(a), "Queued");
    assert.equal(assistantRunLabel({ ...a, status: "running" }), "Closing…");
    assert.equal(assistantRunLabel({ ...a, status: "done" }), "Closed");
    assert.equal(assistantRunLabel({ ...a, status: "failed", message: "no tab" }), "Failed: no tab");
    const q: AssistantRun[] = [
      { ...a, status: "done" },
      { ...a, offerId: "b", act: "update", status: "done" },
      { ...a, offerId: "c", status: "failed" },
    ];
    assert.equal(assistantRunSummary(q), "1 closed · 1 updated · 1 failed");
  });
});

describe("liveRun (#1969)", () => {
  const [queued] = enqueueRuns([], [run("a")]);
  const close: AssistantRun = { ...queued, status: "running" };
  const update: AssistantRun = { ...queued, act: "update", status: "running" };

  it("fails the run on its node's error, which starts the next", () => {
    const failed = liveRun(close, null, { offerId: "a", state: "error", message: "not signed in" });
    assert.equal(failed.status, "failed");
    assert.equal(failed.message, "not signed in");
    assert.equal(nextRun([failed, ...enqueueRuns([], [run("b")])])?.offerId, "b");
  });

  it("reads only the node the run follows, for its own offer", () => {
    const error = { offerId: "a", state: "error", message: "x" };
    assert.equal(liveRun(close, error, null).status, "running", "an update's node is not a close's");
    assert.equal(liveRun(update, null, error).status, "running", "a close's node is not an update's");
    assert.equal(liveRun(close, null, { ...error, offerId: "b" }).status, "running");
    assert.equal(liveRun({ ...close, status: "done" }, null, error).status, "done");
  });

  it("keeps a confirmed close running until the withdrawal settles it", () => {
    const closed = liveRun(close, null, { offerId: "a", state: "closed", message: "Closed." });
    assert.equal(closed.status, "running");
    assert.equal(closed.message, "Withdrawing…");
  });

  it("waits on the collector's Save", () => {
    const filled = liveRun(update, { offerId: "a", state: "filled", message: "Filled." }, null);
    assert.equal(filled.status, "running");
    assert.equal(filled.message, "Waiting for you to save it on Colnect");
  });
});
