import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applySwaps,
  assignTwins,
  listedElsewhereMarker,
  listedElsewhereSentence,
  listedElsewhereSummary,
  listedOnSentence,
  NO_TWIN_SENTENCE,
  swapAllPairs,
  twinDifference,
  twinSentence,
  type ListedElsewhereCopy,
  type TwinCopy,
} from "../../src/lib/listed-elsewhere-rules";
import {
  generatorRequestParams,
  parseGeneratorRequest,
  swappedAskedIds,
  type GeneratorRequest,
} from "../../src/lib/offer-generator-rules";

// The twin rule of the *listed elsewhere* note (#2339): same stamp, condition and format; an exact one
// on faults and certificate first, else the first that differs, named; one twin per listed copy.

function twin(itemId: string, extra: Partial<TwinCopy> = {}): TwinCopy {
  return {
    itemId,
    stampId: "s1",
    conditionId: "mnh",
    formatId: null,
    certificateStatusId: null,
    faultIds: [],
    twinnable: true,
    ...extra,
  };
}

const names = { certificate: (id: string) => (id === "cert" ? "Certificate" : id), fault: (id: string) => id };

describe("assignTwins (#2339)", () => {
  it("takes the first exact twin over an earlier one that differs", () => {
    const copy = twin("a");
    const assigned = assignTwins([copy], [twin("thin", { faultIds: ["Thin"] }), twin("exact")]);
    assert.equal(assigned.get("a")?.itemId, "exact");
  });

  it("falls back to the first twin that differs when no exact one is free", () => {
    const assigned = assignTwins([twin("a", { certificateStatusId: "cert" })], [twin("plain"), twin("thin", { faultIds: ["Thin"] })]);
    assert.equal(assigned.get("a")?.itemId, "plain");
  });

  it("never matches another stamp, condition or format, nor a copy that is not one stamp", () => {
    const assigned = assignTwins(
      [twin("a")],
      [
        twin("other-stamp", { stampId: "s2" }),
        twin("used", { conditionId: "u" }),
        twin("pair", { formatId: "pair" }),
        twin("piece", { twinnable: false }),
      ]
    );
    assert.equal(assigned.size, 0);
    assert.equal(assignTwins([twin("a", { twinnable: false })], [twin("b")]).size, 0);
  });

  it("gives each listed copy a twin of its own", () => {
    const assigned = assignTwins([twin("a"), twin("b"), twin("c")], [twin("t1"), twin("t2")]);
    assert.deepEqual(
      ["a", "b", "c"].map((id) => assigned.get(id)?.itemId ?? null),
      ["t1", "t2", null]
    );
  });
});

describe("twinDifference (#2339)", () => {
  it("is null for an exact twin and names the twin's side otherwise", () => {
    assert.equal(twinDifference(twin("a"), twin("b"), names), null);
    assert.equal(twinDifference(twin("a", { certificateStatusId: "cert" }), twin("b"), names), "no certificate");
    assert.equal(twinDifference(twin("a"), twin("b", { certificateStatusId: "cert" }), names), "Certificate");
    assert.equal(
      twinDifference(twin("a", { faultIds: ["Crease"] }), twin("b", { faultIds: ["Thin"] }), names),
      "with Thin; without Crease"
    );
  });
});

describe("the note's sentences and swaps (#2339)", () => {
  const listed: ListedElsewhereCopy = {
    itemId: "a",
    itemNo: 7375,
    offers: [
      { offerId: "o1", offerNo: 3012, platformName: "Facebook" },
      { offerId: "o2", offerNo: 3020, platformName: "Allegro" },
    ],
    twin: { itemId: "t", itemNo: 7401, difference: "with Thin" },
  };

  it("names the copy, every offer it is in, and the twin", () => {
    assert.equal(listedElsewhereSentence(listed), "#7375 is on Facebook #3012 and Allegro #3020");
    assert.equal(listedElsewhereSentence({ ...listed, offers: listed.offers.slice(0, 1) }), "#7375 is on Facebook #3012");
    assert.equal(twinSentence(listed.twin!), "#7401 is listed nowhere (with Thin)");
  });

  it("swaps every copy that has a twin, each where it stood", () => {
    const pairs = swapAllPairs([listed, { ...listed, itemId: "b", twin: null }]);
    assert.deepEqual(pairs, [{ from: "a", to: "t" }]);
    assert.deepEqual(applySwaps(["x", "a", "y"], new Map([["a", "t"]])), ["x", "t", "y"]);
  });
});

describe("the generator's swaps (#2339)", () => {
  it("takes each swapped copy out of what was asked and its twin in, once", () => {
    assert.deepEqual(swappedAskedIds(["a", "b"], undefined), ["a", "b"]);
    assert.deepEqual(swappedAskedIds(["a", "b"], { a: "t" }), ["b", "t"]);
    assert.deepEqual(swappedAskedIds(["a", "b", "t"], { a: "t" }), ["b", "t"], "a twin already asked for is not doubled");
  });

  it("carries the swaps through the query string", () => {
    const request: GeneratorRequest = {
      platformId: "p",
      mode: "singles",
      packaging: "multi",
      itemIds: ["a", "b"],
      filters: "",
      targets: {},
      skip: [],
      facebook: { facebookGroupId: null, endsAt: null },
      swaps: { b: "u", a: "t" },
    };
    const params = generatorRequestParams(request);
    assert.equal(params.get("swaps"), "a:t,b:u");
    assert.deepEqual(parseGeneratorRequest(params)?.swaps, { a: "t", b: "u" });
    assert.equal(generatorRequestParams({ ...request, swaps: {} }).has("swaps"), false);
    assert.equal(parseGeneratorRequest(generatorRequestParams({ ...request, swaps: undefined }))?.swaps, undefined);
  });
});

describe("the generator's summary and markers (#2479)", () => {
  const on = (itemId: string, platforms: string[], twin: boolean): ListedElsewhereCopy => ({
    itemId,
    itemNo: 7000,
    offers: platforms.map((platformName, i) => ({ offerId: `${itemId}-${i}`, offerNo: 3196 + i, platformName })),
    twin: twin ? { itemId: `${itemId}-twin`, itemNo: 7401, difference: null } : null,
  });

  it("marks a line with its count and platforms, the platform with the most first", () => {
    assert.equal(listedElsewhereMarker([]), null);
    assert.equal(listedElsewhereMarker([on("a", ["Colnect"], true), on("b", ["Colnect"], false)]), "2 on Colnect");
    assert.equal(
      listedElsewhereMarker([
        on("a", ["Allegro"], true),
        on("b", ["Colnect", "Allegro"], true),
        on("c", ["Colnect"], false),
        on("d", ["Colnect", "Colnect"], false),
      ]),
      "4 on Colnect, Allegro"
    );
  });

  it("says how many copies, in how many offers, and how many can be swapped, on one line", () => {
    const copies = [on("a", ["Colnect"], true), on("b", ["Allegro"], false), on("c", ["Colnect"], true)];
    assert.equal(
      listedElsewhereSummary(copies, 2),
      "3 copies in 2 of the offers are already in an open offer — 2 can be swapped for a copy listed nowhere"
    );
    assert.equal(
      listedElsewhereSummary([copies[0]!, copies[2]!], 1),
      "2 copies in one of the offers are already in an open offer — both can be swapped for a copy listed nowhere"
    );
    assert.equal(
      listedElsewhereSummary([copies[1]!], 1),
      `A copy in one of the offers is already in an open offer — ${NO_TWIN_SENTENCE}`
    );
  });

  it("names the open offer alone for a copy's own note", () => {
    assert.equal(listedOnSentence(on("a", ["Colnect"], true)), "on Colnect #3196");
    assert.equal(NO_TWIN_SENTENCE, "no other copy to swap in");
  });
});
