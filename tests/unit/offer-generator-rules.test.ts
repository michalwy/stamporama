import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LotChecklist } from "../../src/lib/lot-builder-rules";
import type { OfferMemberCopy } from "../../src/lib/offer-collision-rules";
import {
  assembleSets,
  findPlanDrift,
  fingerprintPlan,
  generatorRequestParams,
  parseGeneratorRequest,
  parsePlanFingerprint,
  planOffers,
  skipReason,
  type GeneratorCopy,
  type GeneratorOffer,
  type GeneratorPlanInput,
  type SkipFacts,
} from "../../src/lib/offer-generator-rules";

// Generating offers in bulk from the Copies list (#1287).

let nextNo = 0;

/** An MNH, uncertified single copy unless a case says otherwise. */
function copy(
  itemId: string,
  stampId: string,
  opts: Partial<
    Pick<GeneratorCopy, "conditionId" | "certificateStatusId" | "formatId" | "multiStamp" | "itemNo" | "listedStampId">
  > & {
    chain?: string[];
  } = {}
): GeneratorCopy {
  nextNo += 1;
  return {
    itemId,
    itemNo: opts.itemNo ?? nextNo,
    stampId,
    variantChain: opts.chain ?? [stampId],
    conditionId: opts.conditionId ?? "mnh",
    certificateStatusId: opts.certificateStatusId ?? null,
    formatId: opts.formatId ?? null,
    multiStamp: opts.multiStamp ?? false,
    catalogSortKey: null,
    ...(opts.listedStampId ? { listedStampId: opts.listedStampId } : {}),
  };
}

const pair: LotChecklist = { checklistId: "pair", stampIds: ["s1", "s2"] };

function offer(offerId: string, offerNo: number, extra: Partial<GeneratorOffer> = {}): GeneratorOffer {
  return { offerId, offerNo, state: "active", inActiveBidding: false, setCount: 1, ...extra };
}

/** The members of one offer set, all MNH. */
function members(offerId: string, setId: string, stamps: string[]): OfferMemberCopy[] {
  return stamps.map((stampId, i) => ({ offerId, offerSetId: setId, itemId: `${setId}-${i}`, stampId, conditionId: "mnh" }));
}

function plan(input: Partial<GeneratorPlanInput> & Pick<GeneratorPlanInput, "copies">) {
  return planOffers({
    checklists: [pair],
    mode: "checklists",
    packaging: "multi",
    members: [],
    offers: new Map(),
    ...input,
  });
}

const ids = (sets: { copies: GeneratorCopy[] }[]) => sets.map((set) => set.copies.map((c) => c.itemId));

describe("assembleSets (#1287)", () => {
  it("lets the checklist earlier in the issue's order take a copy two checklists compete for", () => {
    const copies = [copy("c1", "s1"), copy("c2", "s2"), copy("c3", "s3")];
    const a: LotChecklist = { checklistId: "a", stampIds: ["s1", "s2"] };
    const b: LotChecklist = { checklistId: "b", stampIds: ["s2", "s3"] };

    const aFirst = assembleSets(copies, [a, b]);
    assert.deepEqual(ids(aFirst.sets), [["c1", "c2"]]);
    assert.deepEqual(aFirst.sets.map((s) => s.checklistId), ["a"]);
    assert.deepEqual(ids(aFirst.singles), [["c3"]]);

    const bFirst = assembleSets(copies, [b, a]);
    assert.deepEqual(ids(bFirst.sets), [["c2", "c3"]]);
    assert.deepEqual(ids(bFirst.singles), [["c1"]]);
  });

  it("forms no set from a checklist that only mixed conditions could complete", () => {
    const { sets, singles } = assembleSets([copy("c1", "s1"), copy("c2", "s2", { conditionId: "used" })], [pair]);
    assert.equal(sets.length, 0);
    assert.deepEqual(ids(singles), [["c1"], ["c2"]]);
  });

  it("keeps certificate and format apart too", () => {
    const certified = assembleSets([copy("c1", "s1"), copy("c2", "s2", { certificateStatusId: "cert" })], [pair]);
    assert.equal(certified.sets.length, 0);
    const blocks = assembleSets([copy("c1", "s1", { formatId: "block" }), copy("c2", "s2")], [pair]);
    assert.equal(blocks.sets.length, 0);
  });

  it("does not treat a checklist of one stamp as a set (#1257)", () => {
    const { sets, singles } = assembleSets([copy("c1", "s1")], [{ checklistId: "one", stampIds: ["s1"] }]);
    assert.equal(sets.length, 0);
    assert.deepEqual(ids(singles), [["c1"]]);
  });

  it("fills a slot with the slot's own stamp before a variant of it (#661)", () => {
    const { sets } = assembleSets(
      [copy("v", "s1v", { chain: ["s1v", "s1"], itemNo: 1 }), copy("own", "s1", { itemNo: 2 }), copy("c2", "s2", { itemNo: 3 })],
      [pair]
    );
    assert.deepEqual(ids(sets), [["own", "c2"]]);
  });

  it("lets a variant complete a further set", () => {
    const { sets } = assembleSets(
      [copy("own", "s1"), copy("v", "s1v", { chain: ["s1v", "s1"] }), copy("a", "s2"), copy("b", "s2")],
      [pair]
    );
    assert.deepEqual(ids(sets), [["own", "a"], ["v", "b"]]);
  });

  it("never lets a multi-stamp copy fill a slot (#745)", () => {
    const { sets, singles } = assembleSets([copy("cover", "s1", { multiStamp: true }), copy("c2", "s2")], [pair]);
    assert.equal(sets.length, 0);
    assert.equal(singles.length, 2);
  });
});

describe("planOffers (#1287)", () => {
  const twoSets = () => [copy("a1", "s1"), copy("a2", "s2"), copy("b1", "s1"), copy("b2", "s2")];

  it("packs two complete sets of one kind as one multi-quantity offer", () => {
    const { lines } = plan({ copies: twoSets() });
    assert.equal(lines.length, 1);
    assert.deepEqual(ids(lines[0].sets), [["a1", "a2"], ["b1", "b2"]]);
    assert.deepEqual(lines[0].target, { kind: "new" });
    assert.equal(lines[0].resultingSetCount, 2);
  });

  it("makes an offer per set with separate packaging, each line its own id", () => {
    const { lines } = plan({ copies: twoSets(), packaging: "separate" });
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => ids(line.sets)), [[["a1", "a2"]], [["b1", "b2"]]]);
    assert.notEqual(lines[0].id, lines[1].id);
  });

  it("lists the leftover single in singles mode, and counts it for the other mode", () => {
    const copies = [...twoSets(), copy("x", "s1")];
    const series = plan({ copies });
    assert.equal(series.otherModeCopies, 1);
    const singles = plan({ copies, mode: "singles" });
    assert.deepEqual(singles.lines.map((line) => ids(line.sets)), [[["x"]]]);
    assert.equal(singles.otherModeCopies, 4);
  });

  it("groups identical singles and keeps a different certificate apart", () => {
    const { lines } = plan({
      copies: [copy("a", "s9"), copy("b", "s9"), copy("c", "s9", { certificateStatusId: "cert" })],
      mode: "singles",
    });
    assert.deepEqual(lines.map((line) => ids(line.sets)), [[["a"], ["b"]], [["c"]]]);
  });

  it("never groups multi-stamp copies, even of one leading stamp", () => {
    const { lines } = plan({
      copies: [copy("k1", "s9", { multiStamp: true }), copy("k2", "s9", { multiStamp: true })],
      mode: "singles",
    });
    assert.equal(lines.length, 2);
  });

  it("keeps a set with a variant apart from the plain set (decided 2026-09-14)", () => {
    const { lines } = plan({
      copies: [copy("own", "s1"), copy("v", "s1v", { chain: ["s1v", "s1"] }), copy("a", "s2"), copy("b", "s2")],
    });
    assert.equal(lines.length, 2);
  });

  it("packs an umbrella with the variant it is listed under as one line (#1347, decided 2026-09-19)", () => {
    const { lines } = plan({
      copies: [
        copy("umb", "523", { conditionId: "used", listedStampId: "523I" }),
        copy("var", "523I", { conditionId: "used", chain: ["523I", "523"], listedStampId: "523I" }),
      ],
      mode: "singles",
    });
    assert.deepEqual(lines.map((line) => ids(line.sets)), [[["umb"], ["var"]]]);
  });

  it("keeps an umbrella apart from a variant it is not listed under (#1347)", () => {
    const { lines } = plan({
      copies: [
        copy("umb", "523", { conditionId: "used", listedStampId: "523II" }),
        copy("var", "523I", { conditionId: "used", chain: ["523I", "523"], listedStampId: "523I" }),
      ],
      mode: "singles",
    });
    assert.equal(lines.length, 2);
  });

  it("adds an umbrella single to the offer on the variant it is listed under (#1347)", () => {
    const offers = new Map([["o7", offer("o7", 7)]]);
    const { lines } = plan({
      copies: [copy("umb", "523", { conditionId: "used", listedStampId: "523I" })],
      mode: "singles",
      members: [
        {
          offerId: "o7",
          offerSetId: "set7",
          itemId: "listed",
          stampId: "523I",
          conditionId: "used",
          listedStampId: "523I",
          listsResolved: true,
        },
      ],
      offers,
    });
    assert.deepEqual(lines[0].target, { kind: "existing", offerId: "o7" });
  });

  it("adds a matching set to an existing offer with multi-quantity, and not with separate offers", () => {
    const offers = new Map([["o7", offer("o7", 7, { setCount: 3 })]]);
    const listed = members("o7", "set7", ["s1", "s2"]);

    const multi = plan({ copies: twoSets(), members: listed, offers });
    assert.deepEqual(multi.lines[0].target, { kind: "existing", offerId: "o7" });
    assert.deepEqual(multi.lines[0].matches, ["o7"]);
    assert.equal(multi.lines[0].resultingSetCount, 5);

    const separate = plan({ copies: twoSets(), members: listed, offers, packaging: "separate" });
    assert.ok(separate.lines.every((line) => line.target.kind === "new" && line.matches.length === 0));
  });

  it("matches by #732's rule: a strict subset of a listed set is not the same entry", () => {
    const offers = new Map([["o7", offer("o7", 7)]]);
    const { lines } = plan({
      copies: [copy("x", "s1")],
      mode: "singles",
      members: members("o7", "set7", ["s1", "s2"]),
      offers,
    });
    assert.deepEqual(lines[0].target, { kind: "new" });
  });

  it("proposes the lowest-numbered match and honours another pick among the matches", () => {
    const offers = new Map([
      ["o9", offer("o9", 9)],
      ["o4", offer("o4", 4)],
    ]);
    const listed = [...members("o9", "set9", ["s5"]), ...members("o4", "set4", ["s5"])];
    const base = { copies: [copy("x", "s5")], mode: "singles" as const, members: listed, offers };

    const proposed = plan(base);
    assert.deepEqual(proposed.lines[0].matches, ["o4", "o9"]);
    assert.deepEqual(proposed.lines[0].target, { kind: "existing", offerId: "o4" });

    const picked = plan({ ...base, targets: { [proposed.lines[0].id]: "o9" } });
    assert.deepEqual(picked.lines[0].target, { kind: "existing", offerId: "o9" });

    const bogus = plan({ ...base, targets: { [proposed.lines[0].id]: "elsewhere" } });
    assert.deepEqual(bogus.lines[0].target, { kind: "existing", offerId: "o4" });
  });

  it("never adds to an offer in active bidding, and makes a new offer instead (#334)", () => {
    const offers = new Map([["o3", offer("o3", 3, { inActiveBidding: true })]]);
    const { lines } = plan({ copies: twoSets(), members: members("o3", "set3", ["s1", "s2"]), offers });
    assert.deepEqual(lines[0].target, { kind: "new" });
    assert.deepEqual(lines[0].matches, []);
    assert.deepEqual(lines[0].biddingMatches, ["o3"]);
  });

  it("counts every line going into one offer towards what it will hold", () => {
    const offers = new Map([["o2", offer("o2", 2, { setCount: 1 })]]);
    const { lines } = plan({
      copies: [copy("a", "s5"), copy("b", "s5", { certificateStatusId: "cert" })],
      mode: "singles",
      members: members("o2", "set2", ["s5"]),
      offers,
    });
    assert.deepEqual(lines.map((line) => line.resultingSetCount), [2, 3]);
  });
});

describe("findPlanDrift (#717's rule, #1287)", () => {
  const offers = new Map([["o7", offer("o7", 7)]]);
  const base = () => [copy("a1", "s1"), copy("a2", "s2"), copy("b1", "s1"), copy("b2", "s2")];
  const listed = members("o7", "set7", ["s1", "s2"]);
  const fingerprint = (copies: GeneratorCopy[], at = offers) => fingerprintPlan(plan({ copies, members: listed, offers: at }), at);

  it("finds nothing when the plan is unchanged", () => {
    const copies = base();
    assert.equal(findPlanDrift(fingerprint(copies), fingerprint(copies)), null);
  });

  it("names a copy that is no longer available", () => {
    const copies = base();
    assert.deepEqual(findPlanDrift(fingerprint(copies), fingerprint(copies.slice(1))), { kind: "copy", itemId: "a1" });
  });

  it("names a copy that newly entered the pass", () => {
    const copies = base();
    const third = [...copies, copy("c1", "s1"), copy("c2", "s2")];
    assert.deepEqual(findPlanDrift(fingerprint(copies), fingerprint(third)), { kind: "copy", itemId: "c1" });
  });

  it("names a receiving offer that changed state", () => {
    const copies = base();
    const paused = new Map([["o7", offer("o7", 7, { state: "paused" })]]);
    assert.deepEqual(findPlanDrift(fingerprint(copies), fingerprint(copies, paused)), { kind: "offer", offerId: "o7" });
  });

  it("names a receiving offer that no longer receives the sets", () => {
    const copies = base();
    const bidding = new Map([["o7", offer("o7", 7, { inActiveBidding: true })]]);
    assert.deepEqual(findPlanDrift(fingerprint(copies), fingerprint(copies, bidding)), { kind: "offer", offerId: "o7" });
  });

  it("reads a fingerprint back from the wire, and refuses a malformed one", () => {
    const shown = fingerprint(base());
    assert.deepEqual(parsePlanFingerprint(JSON.parse(JSON.stringify(shown))), shown);
    assert.equal(parsePlanFingerprint({ lines: [{ id: "x", sets: [[1]] }] }), null);
    assert.equal(parsePlanFingerprint(null), null);
  });
});

describe("skipReason (#1287)", () => {
  const listable: SkipFacts = {
    gone: false,
    forSale: true,
    deliveryState: "delivered",
    setAside: false,
    offeredOnPlatform: false,
    inActiveBidding: false,
  };

  it("names the most final reason first", () => {
    assert.equal(skipReason({ ...listable, gone: true, forSale: false }), "gone");
    assert.equal(skipReason({ ...listable, forSale: false, deliveryState: "ordered" }), "not-for-sale");
    assert.equal(skipReason({ ...listable, deliveryState: "in_transit", setAside: true }), "not-in-hand");
    assert.equal(skipReason({ ...listable, setAside: true, offeredOnPlatform: true }), "set-aside");
    assert.equal(skipReason({ ...listable, offeredOnPlatform: true, inActiveBidding: true }), "offered");
    assert.equal(skipReason({ ...listable, inActiveBidding: true }), "in-bidding");
    assert.equal(skipReason(listable), null);
  });
});

describe("the generator request (#1287)", () => {
  it("round-trips through a query string", () => {
    const request = {
      platformId: "p1",
      state: "preparing" as const,
      mode: "singles" as const,
      packaging: "separate" as const,
      itemIds: ["i1", "i2"],
      filters: "",
      targets: { abc: "o1" },
    };
    assert.deepEqual(parseGeneratorRequest(generatorRequestParams(request)), request);
    const filtered = { ...request, itemIds: null, filters: "conditionIds=mnh&areaIds=a1", targets: {} };
    assert.deepEqual(parseGeneratorRequest(generatorRequestParams(filtered)), filtered);
  });

  it("refuses a request missing a choice, rather than guessing it", () => {
    const params = generatorRequestParams({
      platformId: "p1",
      state: "ready",
      mode: "checklists",
      packaging: "multi",
      itemIds: null,
      filters: "",
      targets: {},
    });
    for (const key of ["platformId", "state", "mode", "packaging"]) {
      const without = new URLSearchParams(params);
      without.delete(key);
      assert.equal(parseGeneratorRequest(without), null, key);
    }
    const paused = new URLSearchParams(params);
    paused.set("state", "paused");
    assert.equal(parseGeneratorRequest(paused), null);
  });
});
