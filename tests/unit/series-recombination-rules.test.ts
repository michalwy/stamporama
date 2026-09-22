import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OfferState } from "../../src/lib/offer-rules";
import type { LotChecklist } from "../../src/lib/lot-builder-rules";
import {
  candidateKey,
  checkSeriesPicks,
  collapseCandidates,
  collapsedChoice,
  combinationKey,
  combinationOf,
  composeTargetDrift,
  composeTargetOf,
  composeTargets,
  compositionOutcome,
  copyMatchesCombination,
  DEFAULT_SERIES_CRITERIA,
  fewestOffersToChange,
  findRecombinableSeries,
  NO_MIXING,
  parseComposeTargetPlan,
  parseSeriesCombination,
  parseSeriesCriteria,
  seriesCriteriaParams,
  singlyOfferedCopies,
  type ComposeTargetOffer,
  type RecombinationCopy,
  type RecombinationOfferSet,
  type RecombinationSlot,
} from "../../src/lib/series-recombination-rules";

// Which series single offers plus available copies could complete (#1210; #754's design).

type Axes = Partial<Pick<RecombinationCopy, "conditionId" | "certificateStatusId" | "formatId">>;

/** Every copy is MNH, uncertified and a single unless a case says otherwise (#1265). */
const PLAIN = { conditionId: "mnh", certificateStatusId: null, formatId: null } as const;

function available(
  itemId: string,
  stampId: string,
  chain: string[] = [stampId],
  axes: Axes = {}
): RecombinationCopy {
  return { itemId, stampId, variantChain: chain, offerIds: [], ...PLAIN, ...axes };
}

function offered(itemId: string, stampId: string, offerIds: string[], axes: Axes = {}): RecombinationCopy {
  return { itemId, stampId, variantChain: [stampId], offerIds, ...PLAIN, ...axes };
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

  it("does not list a checklist of one stamp, which the single offer already is (#1257)", () => {
    const one: LotChecklist = { checklistId: "one", stampIds: ["s1"] };
    const found = findRecombinableSeries({
      copies: [offered("c1", "s1", ["o1"])],
      checklists: [one],
      offerStates: states({ o1: "active" }),
    });
    assert.deepEqual(found, []);
  });

  it("counts a stamp repeated in a checklist once when deciding it is a one-stamp checklist (#1257)", () => {
    const repeated: LotChecklist = { checklistId: "repeated", stampIds: ["s1", "s1"] };
    const found = findRecombinableSeries({
      copies: [offered("c1", "s1", ["o1"])],
      checklists: [repeated],
      offerStates: states({ o1: "active" }),
    });
    assert.deepEqual(found, []);
  });

  it("lists a checklist of two stamps as before (#1257)", () => {
    const pair: LotChecklist = { checklistId: "pair", stampIds: ["s1", "s2"] };
    const found = findRecombinableSeries({
      copies: [offered("c1", "s1", ["o1"]), available("a2", "s2")],
      checklists: [pair],
      offerStates: states({ o1: "active" }),
    });
    assert.deepEqual(found.map((series) => series.checklistId), ["pair"]);
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

describe("checkSeriesPicks (#1211)", () => {
  const slots: RecombinationSlot[] = [
    { stampId: "s1", copies: [available("a1", "s1"), offered("c1", "s1", ["o1"])] },
    { stampId: "s2", copies: [offered("c2", "s2", ["o2"])] },
  ];

  it("returns the chosen copies in slot order", () => {
    const check = checkSeriesPicks(slots, { s2: "c2", s1: "c1" });
    assert.ok(check.ok);
    assert.deepEqual(check.copies.map((copy) => copy.itemId), ["c1", "c2"]);
  });

  it("takes the copy the collector picked where several fill a slot", () => {
    const check = checkSeriesPicks(slots, { s1: "a1", s2: "c2" });
    assert.ok(check.ok);
    assert.equal(check.copies[0].itemId, "a1");
  });

  it("refuses a slot with no copy chosen, even one with a single candidate", () => {
    assert.deepEqual(checkSeriesPicks(slots, { s1: "a1" }), {
      ok: false,
      refusal: { kind: "unchosen", stampId: "s2" },
    });
  });

  it("refuses, by name, a chosen copy the re-read no longer counts for its slot", () => {
    assert.deepEqual(checkSeriesPicks(slots, { s1: "gone", s2: "c2" }), {
      ok: false,
      refusal: { kind: "stale", stampId: "s1", itemId: "gone" },
    });
  });

  it("refuses a copy chosen for the wrong slot", () => {
    assert.deepEqual(checkSeriesPicks(slots, { s1: "c2", s2: "c2" }), {
      ok: false,
      refusal: { kind: "stale", stampId: "s1", itemId: "c2" },
    });
  });

  it("refuses a pick for a stamp that is not a slot of the series", () => {
    assert.deepEqual(checkSeriesPicks(slots, { s1: "a1", s2: "c2", s9: "x" }), {
      ok: false,
      refusal: { kind: "not-a-slot", stampId: "s9" },
    });
  });
});

describe("compositionOutcome (#1211)", () => {
  const offers = (entries: Record<string, [OfferState, number]>) =>
    new Map(Object.entries(entries).map(([id, [state, setCount]]) => [id, { state, setCount }]));

  it("withdraws an emptied offer that was never listed, and keeps an emptied live one (#1277)", () => {
    const outcome = compositionOutcome(
      [{ offerIds: ["o1"] }, { offerIds: ["o2"] }, { offerIds: ["o3"] }, { offerIds: ["o4"] }, { offerIds: [] }],
      offers({ o1: ["active", 1], o2: ["preparing", 1], o3: ["paused", 1], o4: ["ready", 1] })
    );
    assert.deepEqual(outcome, [
      { offerId: "o1", setsLost: 1, setsLeft: 0, emptied: true, withdrawn: false, live: true },
      { offerId: "o2", setsLost: 1, setsLeft: 0, emptied: true, withdrawn: true, live: false },
      { offerId: "o3", setsLost: 1, setsLeft: 0, emptied: true, withdrawn: false, live: true },
      { offerId: "o4", setsLost: 1, setsLeft: 0, emptied: true, withdrawn: true, live: false },
    ]);
  });

  it("keeps an offer that still holds other sets", () => {
    const outcome = compositionOutcome([{ offerIds: ["o1"] }], offers({ o1: ["paused", 3] }));
    assert.deepEqual(outcome, [
      { offerId: "o1", setsLost: 1, setsLeft: 2, emptied: false, withdrawn: false, live: true },
    ]);
  });

  it("counts one set per chosen copy an offer holds singly", () => {
    const outcome = compositionOutcome(
      [{ offerIds: ["o1"] }, { offerIds: ["o1"] }],
      offers({ o1: ["ready", 2] })
    );
    assert.deepEqual(outcome, [
      { offerId: "o1", setsLost: 2, setsLeft: 0, emptied: true, withdrawn: true, live: false },
    ]);
  });

  it("changes every offer a chosen copy is single in", () => {
    const outcome = compositionOutcome(
      [{ offerIds: ["o1", "o2"] }],
      offers({ o1: ["active", 1], o2: ["preparing", 2] })
    );
    assert.deepEqual(
      outcome.map((change) => [change.offerId, change.emptied]),
      [
        ["o1", true],
        ["o2", false],
      ]
    );
  });

  it("changes nothing when every chosen copy is available", () => {
    assert.deepEqual(compositionOutcome([{ offerIds: [] }], offers({})), []);
  });
});

// One condition, one certificate status and one format per proposal by default (#1265).

describe("findRecombinableSeries — combinations (#1265)", () => {
  const pair: LotChecklist = { checklistId: "pair", stampIds: ["s1", "s2"] };
  const offerStates = states({ o1: "active", o2: "active", o3: "active" });

  it("proposes a checklist complete in two conditions twice, each card naming its condition", () => {
    const found = findRecombinableSeries({
      copies: [
        offered("m1", "s1", ["o1"]),
        available("m2", "s2"),
        offered("u1", "s1", ["o2"], { conditionId: "used" }),
        available("u2", "s2", ["s2"], { conditionId: "used" }),
      ],
      checklists: [pair],
      offerStates,
    });
    assert.deepEqual(
      found.map((series) => series.combination),
      [
        { conditionId: "mnh", certificateStatusId: null, formatId: null },
        { conditionId: "used", certificateStatusId: null, formatId: null },
      ]
    );
    assert.deepEqual(
      found.map((series) => series.slots.flatMap((slot) => slot.copies.map((copy) => copy.itemId))),
      [["m1", "m2"], ["u1", "u2"]],
      "no card holds a copy of the other condition"
    );
    assert.notEqual(found[0].key, found[1].key, "two cards of one checklist have two identities");
  });

  it("does not propose a series complete only by mixing conditions — unless condition mixing is on", () => {
    const copies = [offered("m1", "s1", ["o1"]), available("u2", "s2", ["s2"], { conditionId: "used" })];
    assert.deepEqual(findRecombinableSeries({ copies, checklists: [pair], offerStates }), []);

    const mixed = findRecombinableSeries({
      copies,
      checklists: [pair],
      offerStates,
      mixing: { ...NO_MIXING, condition: true },
    });
    assert.equal(mixed.length, 1);
    assert.deepEqual(mixed[0].combination, { certificateStatusId: null, formatId: null });
  });

  it("mixes only the axis whose switch is on", () => {
    const copies = [
      offered("a", "s1", ["o1"], { certificateStatusId: "cert" }),
      available("b", "s2", ["s2"], { conditionId: "used" }),
    ];
    assert.deepEqual(
      findRecombinableSeries({ copies, checklists: [pair], offerStates, mixing: { ...NO_MIXING, condition: true } }),
      [],
      "conditions may mix, certificates still may not"
    );
    const both = findRecombinableSeries({
      copies,
      checklists: [pair],
      offerStates,
      mixing: { condition: true, certificate: true, format: false },
    });
    assert.deepEqual(both.map((series) => series.combination), [{ formatId: null }]);

    const formats = [offered("c", "s1", ["o1"]), available("d", "s2", ["s2"], { formatId: "pair" })];
    assert.deepEqual(
      findRecombinableSeries({ copies: formats, checklists: [pair], offerStates, mixing: { ...NO_MIXING, condition: true, certificate: true } }),
      [],
      "a single and a pair are two formats"
    );
    assert.equal(
      findRecombinableSeries({ copies: formats, checklists: [pair], offerStates, mixing: { ...NO_MIXING, format: true } }).length,
      1
    );
  });

  it("asks 'complete over the available copies alone' within the combination", () => {
    const found = findRecombinableSeries({
      copies: [
        // MNH: the available copies complete it on their own — no card.
        available("m1", "s1"),
        available("m2", "s2"),
        // Used: only with the single.
        offered("u1", "s1", ["o1"], { conditionId: "used" }),
        available("u2", "s2", ["s2"], { conditionId: "used" }),
      ],
      checklists: [pair],
      offerStates,
    });
    assert.deepEqual(found.map((series) => series.combination.conditionId), ["used"]);
  });
});

describe("combination helpers (#1265)", () => {
  it("tells a single from a mixed format, and no certificate from a mixed certificate", () => {
    const copy = { conditionId: "mnh", certificateStatusId: null, formatId: null };
    assert.equal(copyMatchesCombination(copy, { formatId: null }), true);
    assert.equal(copyMatchesCombination({ ...copy, formatId: "pair" }, { formatId: null }), false);
    assert.equal(copyMatchesCombination({ ...copy, formatId: "pair" }, {}), true, "absent is mixed");
    assert.notEqual(combinationKey({ formatId: null }), combinationKey({}));
    assert.deepEqual(combinationOf(copy, { condition: true, certificate: false, format: true }), {
      certificateStatusId: null,
    });
  });

  it("reads a combination off the wire, refusing anything that is not one", () => {
    assert.deepEqual(parseSeriesCombination({ conditionId: "mnh", certificateStatusId: null }), {
      conditionId: "mnh",
      certificateStatusId: null,
    });
    assert.deepEqual(parseSeriesCombination({}), {});
    for (const bad of [null, "mnh", [], { conditionId: null }, { formatId: 3 }, { subtypeId: "x" }]) {
      assert.equal(parseSeriesCombination(bad), null, JSON.stringify(bad));
    }
  });

  it("round-trips the criteria through the address, and keeps the default address bare", () => {
    const criteria = parseSeriesCriteria(
      new URLSearchParams("conditionIds=mnh,mh&formatIds=single&subtypeIds=none&mixCertificates=true&mixFormats=yes")
    );
    assert.deepEqual(criteria, {
      conditionIds: ["mnh", "mh"],
      certificateStatusIds: [],
      formatIds: ["single"],
      subtypeIds: ["none"],
      mixing: { condition: false, certificate: true, format: false },
    });
    assert.deepEqual(parseSeriesCriteria(new URLSearchParams(seriesCriteriaParams(criteria))), criteria);
    assert.deepEqual(seriesCriteriaParams(DEFAULT_SERIES_CRITERIA), []);
  });
});

describe("collapseCandidates (#1266)", () => {
  type Numbered = RecombinationCopy & { itemNo: number };
  const numbered = (copy: RecombinationCopy, itemNo: number): Numbered => ({ ...copy, itemNo });

  it("collapses fourteen identical copies in one offer into one group, lowest number first", () => {
    const copies = Array.from({ length: 14 }, (_, i) => numbered(offered(`c${i}`, "s1", ["o1"]), 100 - i));
    const groups = collapseCandidates(copies);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].copies.length, 14);
    assert.deepEqual(
      groups[0].copies.map((copy) => copy.itemNo),
      Array.from({ length: 14 }, (_, i) => 87 + i),
      "the first is the lowest-numbered copy, the one a collapsed line chooses"
    );
  });

  it("never collapses copies from different offers, or offered with not offered yet", () => {
    const groups = collapseCandidates([
      numbered(offered("a", "s1", ["o1"]), 1),
      numbered(offered("b", "s1", ["o2"]), 2),
      numbered(offered("c", "s1", ["o1", "o2"]), 3),
      numbered(available("d", "s1"), 4),
      numbered(available("e", "s1"), 5),
    ]);
    assert.deepEqual(
      groups.map((group) => group.copies.map((copy) => copy.itemId)),
      [["d", "e"], ["a"], ["b"], ["c"]],
      "available first, then by lowest number; each offer, and each pair of offers, is its own source"
    );
  });

  it("treats the offers a copy names as a set, in any order", () => {
    assert.equal(
      candidateKey(offered("a", "s1", ["o2", "o1"])),
      candidateKey(offered("b", "s1", ["o1", "o2", "o1"]))
    );
  });

  it("keeps apart copies that differ in stamp, condition, certificate or format", () => {
    const base = offered("base", "s1", ["o1"]);
    const variants: RecombinationCopy[] = [
      { ...offered("variant", "v1", ["o1"]), variantChain: ["v1", "s1"] },
      offered("used", "s1", ["o1"], { conditionId: "used" }),
      offered("cert", "s1", ["o1"], { certificateStatusId: "cert" }),
      offered("pair", "s1", ["o1"], { formatId: "pair" }),
    ];
    const groups = collapseCandidates([base, ...variants].map((copy, i) => numbered(copy, i + 1)));
    assert.equal(groups.length, 5, "no two of these are identical");
    assert.notEqual(
      candidateKey(offered("x", "s1", ["o1"], { certificateStatusId: null })),
      candidateKey(offered("x", "s1", ["o1"], { certificateStatusId: "null" })),
      "no certificate is a value, not a string that spells it"
    );
  });
});

describe("collapsedChoice (#1266)", () => {
  const group = ["low", "mid", "high"];

  it("chooses the lowest-numbered copy when nothing in the group is chosen yet", () => {
    assert.equal(collapsedChoice(group, undefined), "low");
    assert.equal(collapsedChoice(group, "elsewhere"), "low");
  });

  it("keeps a copy chosen after expanding, so collapsing again does not change the choice", () => {
    assert.equal(collapsedChoice(group, "high"), "high");
  });
});

describe("where a composed series goes (#1369)", () => {
  const chosen = [
    { itemId: "a1", stampId: "A", conditionId: "mnh" },
    { itemId: "b1", stampId: "B", conditionId: "mnh" },
  ];
  const member = (offerId: string, set: string, itemId: string, stampId: string, conditionId = "mnh") => ({
    offerId,
    offerSetId: set,
    itemId,
    stampId,
    conditionId,
  });
  const ref = (offerId: string, offerNo: number, extra: Partial<ComposeTargetOffer> = {}): ComposeTargetOffer => ({
    offerId,
    offerNo,
    state: "active",
    inActiveBidding: false,
    setCount: 1,
    ...extra,
  });
  const members = [
    member("o7", "s7", "a7", "A"),
    member("o7", "s7", "b7", "B"),
    member("o3", "s3", "a3", "A"),
    member("o3", "s3", "b3", "B"),
    // A superset and another condition are not the same entry (#732).
    member("o4", "s4", "a4", "A"),
    member("o4", "s4", "b4", "B"),
    member("o4", "s4", "c4", "C"),
    member("o5", "s5", "a5", "A"),
    member("o5", "s5", "b5", "B", "used"),
    member("o9", "s9", "a9", "A"),
    member("o9", "s9", "b9", "B"),
  ];
  const offers = new Map([
    ["o7", ref("o7", 7)],
    ["o3", ref("o3", 3)],
    ["o4", ref("o4", 4)],
    ["o5", ref("o5", 5)],
    ["o9", ref("o9", 9, { inActiveBidding: true })],
  ]);

  it("matches by set equality, lowest number first, bidding offers apart", () => {
    assert.deepEqual(composeTargets(chosen, members, offers), { matches: ["o3", "o7"], biddingMatches: ["o9"] });
  });

  it("proposes the lowest-numbered match, keeps a picked one, and honours asking for a new offer", () => {
    const targets = { matches: ["o3", "o7"], biddingMatches: [] };
    assert.equal(composeTargetOf(targets, undefined), "o3");
    assert.equal(composeTargetOf(targets, "o7"), "o7");
    assert.equal(composeTargetOf(targets, "o4"), "o3", "a pick that is no match falls back to the proposal");
    assert.equal(composeTargetOf(targets, null), null);
    assert.equal(composeTargetOf({ matches: [], biddingMatches: ["o9"] }, undefined), null);
  });

  it("names the offer a confirmed plan no longer describes", () => {
    const fresh = { matches: ["o3", "o7"], biddingMatches: [] };
    const plan = { offerId: "o3", matches: [ref("o3", 3), ref("o7", 7)] };
    assert.equal(composeTargetDrift(plan, fresh, offers), null);
    assert.equal(composeTargetDrift({ ...plan, matches: [ref("o3", 3)] }, fresh, offers), "o7", "a new match");
    assert.equal(composeTargetDrift(plan, { matches: ["o3"], biddingMatches: [] }, offers), "o7", "a match gone");
    assert.equal(
      composeTargetDrift({ offerId: "o3", matches: [ref("o3", 3, { setCount: 2 }), ref("o7", 7)] }, fresh, offers),
      "o3",
      "the target's quantity changed"
    );
    assert.equal(
      composeTargetDrift({ offerId: "o7", matches: [ref("o3", 3), ref("o7", 7, { state: "paused" })] }, fresh, offers),
      "o7",
      "the target's status changed"
    );
    assert.equal(
      composeTargetDrift({ offerId: null, matches: [ref("o3", 3, { setCount: 5 }), ref("o7", 7)] }, fresh, offers),
      null,
      "a new offer asked for does not care about a match's quantity"
    );
  });

  it("parses only a well-formed plan", () => {
    assert.deepEqual(parseComposeTargetPlan({ offerId: null, matches: [] }), { offerId: null, matches: [] });
    assert.deepEqual(parseComposeTargetPlan({ offerId: "o3", matches: [ref("o3", 3)] }), {
      offerId: "o3",
      matches: [ref("o3", 3)],
    });
    assert.equal(parseComposeTargetPlan(undefined), null);
    assert.equal(parseComposeTargetPlan({ offerId: 3, matches: [] }), null);
    assert.equal(parseComposeTargetPlan({ offerId: null, matches: [{ ...ref("o3", 3), state: "gone" }] }), null);
  });
});
