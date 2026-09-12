import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OfferState } from "../../src/lib/offer-rules";
import type { LotChecklist } from "../../src/lib/lot-builder-rules";
import {
  fewestOffersToChange,
  findRecombinableSeries,
  singlyOfferedCopies,
  type RecombinationCopy,
  type RecombinationOfferSet,
  type RecombinationSlot,
} from "../../src/lib/series-recombination-rules";

// Which series single offers plus available copies could complete (#1210; #754's design).

function available(itemId: string, stampId: string, chain: string[] = [stampId]): RecombinationCopy {
  return { itemId, stampId, variantChain: chain, offerIds: [] };
}

function offered(itemId: string, stampId: string, offerIds: string[]): RecombinationCopy {
  return { itemId, stampId, variantChain: [stampId], offerIds };
}

const series: LotChecklist = { checklistId: "set", stampIds: ["s1", "s2", "s3", "s4", "s5"] };

function states(entries: Record<string, OfferState>): Map<string, OfferState> {
  return new Map(Object.entries(entries));
}

describe("findRecombinableSeries (#1210)", () => {
  it("lists #754's use case: three singles plus the two copies that arrived later", () => {
    const found = findRecombinableSeries({
      copies: [
        offered("c1", "s1", ["o1"]),
        offered("c2", "s2", ["o2"]),
        offered("c3", "s3", ["o3"]),
        available("c4", "s4"),
        available("c5", "s5"),
      ],
      checklists: [series],
      offerStates: states({ o1: "active", o2: "paused", o3: "preparing" }),
    });
    assert.equal(found.length, 1);
    assert.deepEqual(
      found[0].slots.map((slot) => slot.stampId),
      ["s1", "s2", "s3", "s4", "s5"],
      "the slots read in the checklist's own order"
    );
    assert.deepEqual(found[0].offersToChange, { offerIds: ["o1", "o2", "o3"], liveCount: 2 });
  });

  it("does not list a series the available copies complete on their own", () => {
    const found = findRecombinableSeries({
      copies: [
        ...series.stampIds.map((stampId, i) => available(`a${i}`, stampId)),
        offered("c1", "s1", ["o1"]),
      ],
      checklists: [series],
      offerStates: states({ o1: "active" }),
    });
    assert.deepEqual(found, []);
  });

  it("does not list a series still missing a slot after the singles are counted", () => {
    const found = findRecombinableSeries({
      copies: [offered("c1", "s1", ["o1"]), available("c2", "s2"), available("c3", "s3"), available("c4", "s4")],
      checklists: [series],
      offerStates: states({ o1: "active" }),
    });
    assert.deepEqual(found, []);
  });

  it("lets a variant copy fill its parent's slot (#661)", () => {
    const pair: LotChecklist = { checklistId: "pair", stampIds: ["226", "227"] };
    const found = findRecombinableSeries({
      copies: [available("v", "226yw", ["226yw", "226"]), offered("c", "227", ["o1"])],
      checklists: [pair],
      offerStates: states({ o1: "ready" }),
    });
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].slots[0].copies.map((copy) => copy.itemId), ["v"]);
  });

  it("puts an available copy first in its slot, and then counts no offer for that slot", () => {
    const pair: LotChecklist = { checklistId: "pair", stampIds: ["s1", "s2"] };
    const found = findRecombinableSeries({
      copies: [offered("c1", "s1", ["o1"]), available("a1", "s1"), offered("c2", "s2", ["o2"])],
      checklists: [pair],
      offerStates: states({ o1: "active", o2: "active" }),
    });
    assert.deepEqual(found[0].slots[0].copies.map((copy) => copy.itemId), ["a1", "c1"]);
    assert.deepEqual(found[0].offersToChange, { offerIds: ["o2"], liveCount: 1 });
  });
});

describe("fewestOffersToChange (#1210)", () => {
  const slot = (stampId: string, ...copies: RecombinationCopy[]): RecombinationSlot => ({ stampId, copies });
  const live = (ids: string[]) => (id: string) => ids.includes(id);

  it("counts an offer holding singles for two slots once", () => {
    const result = fewestOffersToChange(
      [slot("s1", offered("c1", "s1", ["o1"])), slot("s2", offered("c2", "s2", ["o1"]))],
      live([])
    );
    assert.deepEqual(result, { offerIds: ["o1"], liveCount: 0 });
  });

  it("finds the smallest cover, not the first one", () => {
    // s1 can come out of o1 or o2; s2 only out of o2. Taking o1 for s1 would change two offers.
    const result = fewestOffersToChange(
      [
        slot("s1", offered("c1", "s1", ["o1"]), offered("c2", "s1", ["o2"])),
        slot("s2", offered("c3", "s2", ["o2"])),
      ],
      live([])
    );
    assert.deepEqual(result, { offerIds: ["o2"], liveCount: 0 });
  });

  it("breaks a tie on size toward the offer that is not live", () => {
    const result = fewestOffersToChange(
      [slot("s1", offered("c1", "s1", ["live"]), offered("c2", "s1", ["draft"]))],
      live(["live"])
    );
    assert.deepEqual(result, { offerIds: ["draft"], liveCount: 0 });
  });

  it("prefers fewer offers over fewer live ones", () => {
    // Two drafts, or one live offer holding both singles: the live one is the smaller change.
    const result = fewestOffersToChange(
      [
        slot("s1", offered("c1", "s1", ["d1"]), offered("c2", "s1", ["live"])),
        slot("s2", offered("c3", "s2", ["d2"]), offered("c4", "s2", ["live"])),
      ],
      live(["live"])
    );
    assert.deepEqual(result, { offerIds: ["live"], liveCount: 1 });
  });

  it("changes every offer a copy is single in, since taking it out changes each", () => {
    const result = fewestOffersToChange([slot("s1", offered("c1", "s1", ["o2", "o1"]))], live(["o1"]));
    assert.deepEqual(result, { offerIds: ["o1", "o2"], liveCount: 1 });
  });

  it("changes nothing when every slot has an available copy", () => {
    const result = fewestOffersToChange(
      [slot("s1", available("a1", "s1"), offered("c1", "s1", ["o1"]))],
      live(["o1"])
    );
    assert.deepEqual(result, { offerIds: [], liveCount: 0 });
  });
});

describe("singlyOfferedCopies (#1210)", () => {
  const set = (
    offerId: string,
    itemIds: string[],
    state: OfferState = "active",
    inActiveBidding = false
  ): RecombinationOfferSet => ({ offerId, state, inActiveBidding, itemIds });

  it("counts a copy alone in its set, in every open state", () => {
    const singles = singlyOfferedCopies([
      set("o1", ["a"], "preparing"),
      set("o2", ["b"], "ready"),
      set("o3", ["c"], "active"),
      set("o4", ["d"], "paused"),
    ]);
    assert.deepEqual([...singles.keys()].sort(), ["a", "b", "c", "d"]);
  });

  it("does not count a copy in a sold or withdrawn offer", () => {
    const singles = singlyOfferedCopies([set("o1", ["a"], "sold"), set("o2", ["b"], "withdrawn")]);
    assert.equal(singles.size, 0);
  });

  it("does not count a copy in a multi-copy set — not even one also offered alone elsewhere", () => {
    const singles = singlyOfferedCopies([
      set("o1", ["a", "b"]),
      set("o2", ["b"]),
      set("o3", ["c"]),
    ]);
    assert.deepEqual([...singles.keys()], ["c"]);
  });

  it("never counts a copy in an offer in active bidding (#334)", () => {
    const singles = singlyOfferedCopies([set("o1", ["a"], "active", true), set("o2", ["a"], "preparing")]);
    assert.equal(singles.size, 0);
  });

  it("reads the bidding flag only on an active offer, as the availability clause does", () => {
    const singles = singlyOfferedCopies([set("o1", ["a"], "paused", true)]);
    assert.deepEqual(singles.get("a"), ["o1"]);
  });

  it("names every offer holding a copy singly", () => {
    const singles = singlyOfferedCopies([set("o2", ["a"]), set("o1", ["a"], "preparing")]);
    assert.deepEqual(singles.get("a"), ["o1", "o2"]);
  });
});
