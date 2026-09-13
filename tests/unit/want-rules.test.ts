import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wantMatchesCopy,
  narrowConditionSeed,
  groupWantMatches,
  acceptanceSetsEqual,
  acceptanceAxisView,
  type AcceptanceSets,
  type WantAcceptance,
  type WantCandidateCopy,
} from "../../src/lib/want-rules";

const U = "cond-used";
const MNG = "cond-mng";
const MH = "cond-mh";
const MNH = "cond-mnh";
const ALL_CONDITIONS = [U, MNG, MH, MNH];

const CERT_PHOTO = "cert-photo";
const BLOCK4 = "fmt-block4";

const want = (over: Partial<WantAcceptance> = {}): WantAcceptance => ({
  stampId: "stamp-309",
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
  ...over,
});

const copy = (over: Partial<WantCandidateCopy> = {}): WantCandidateCopy => ({
  stampId: "stamp-309",
  conditionId: U,
  certificateStatusId: null,
  formatId: null,
  ...over,
});

describe("wantMatchesCopy", () => {
  it("a want with no sets at all takes anything of that stamp", () => {
    assert.equal(wantMatchesCopy(want(), copy()), true);
    assert.equal(
      wantMatchesCopy(
        want(),
        copy({ conditionId: MNH, certificateStatusId: CERT_PHOTO, formatId: BLOCK4 })
      ),
      true
    );
  });

  it("never matches a different stamp, however wide the sets are", () => {
    assert.equal(wantMatchesCopy(want(), copy({ stampId: "stamp-310" })), false);
  });

  it("a mint-only want is not satisfied by a used copy — the upgrade case", () => {
    const mintOnly = want({ conditionIds: [MNG, MH, MNH] });
    assert.equal(wantMatchesCopy(mintOnly, copy({ conditionId: U })), false);
    assert.equal(wantMatchesCopy(mintOnly, copy({ conditionId: MH })), true);
  });

  it("a null certificate member means 'no certificate', not 'any certificate'", () => {
    const noCert = want({ certificateStatusIds: [null] });
    assert.equal(wantMatchesCopy(noCert, copy({ certificateStatusId: null })), true);
    assert.equal(wantMatchesCopy(noCert, copy({ certificateStatusId: CERT_PHOTO })), false);
  });

  it("an empty certificate set is 'don't care' — both a certified and an uncertified copy match", () => {
    const dontCare = want({ certificateStatusIds: [] });
    assert.equal(wantMatchesCopy(dontCare, copy({ certificateStatusId: null })), true);
    assert.equal(wantMatchesCopy(dontCare, copy({ certificateStatusId: CERT_PHOTO })), true);
  });

  it("a null format member means 'single'", () => {
    const singlesOnly = want({ formatIds: [null] });
    assert.equal(wantMatchesCopy(singlesOnly, copy({ formatId: null })), true);
    assert.equal(wantMatchesCopy(singlesOnly, copy({ formatId: BLOCK4 })), false);

    const blocksOnly = want({ formatIds: [BLOCK4] });
    assert.equal(wantMatchesCopy(blocksOnly, copy({ formatId: null })), false);
    assert.equal(wantMatchesCopy(blocksOnly, copy({ formatId: BLOCK4 })), true);
  });

  it("every axis must pass — one narrow axis is enough to refuse", () => {
    const specific = want({
      conditionIds: [MNH],
      certificateStatusIds: [CERT_PHOTO],
      formatIds: [BLOCK4],
    });
    assert.equal(
      wantMatchesCopy(
        specific,
        copy({ conditionId: MNH, certificateStatusId: CERT_PHOTO, formatId: BLOCK4 })
      ),
      true
    );
    assert.equal(
      wantMatchesCopy(
        specific,
        copy({ conditionId: MNH, certificateStatusId: CERT_PHOTO, formatId: null })
      ),
      false
    );
  });
});

describe("narrowConditionSeed", () => {
  it("seeds an 'anything' want with every condition except the one that arrived", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [U], []), [MNG, MH, MNH]);
  });

  it("keeps the dictionary's own order, which is display order and nothing more", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [MH], []), [U, MNG, MNH]);
  });

  it("leaves an already-narrowed set exactly as it is — that question was answered once", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [U], [MNH]), [MNH]);
    // Even when the arrived condition is in it: closing or leaving it open is the collector's call.
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [MNH], [MNH, MH]), [MNH, MH]);
  });

  it("drops every condition that arrived when one pass brought several (#1262)", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [U, MH], []), [MNG, MNH]);
    // The same condition twice is the one condition.
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, [U, U], []), [MNG, MH, MNH]);
  });

  it("returns an empty seed when there is nothing left to narrow to, rather than inventing one", () => {
    assert.deepEqual(narrowConditionSeed([U], [U], []), []);
  });

  it("does not mutate the set it was handed", () => {
    const current = [MNH];
    const seeded = narrowConditionSeed(ALL_CONDITIONS, [U], current);
    seeded.push(MH);
    assert.deepEqual(current, [MNH]);
  });
});

describe("groupWantMatches", () => {
  const w1 = { id: "w1" };
  const w2 = { id: "w2" };

  it("asks each want once, naming every copy that raised it, in the order they came (#1262)", () => {
    const rows = groupWantMatches([
      { itemId: "c1", want: w1 },
      { itemId: "c1", want: w2 },
      { itemId: "c2", want: w1 },
      { itemId: "c3", want: w1 },
    ]);
    assert.deepEqual(rows, [
      { want: w1, itemIds: ["c1", "c2", "c3"] },
      { want: w2, itemIds: ["c1"] },
    ]);
  });

  it("names a copy once against one want, however often it was matched", () => {
    assert.deepEqual(
      groupWantMatches([
        { itemId: "c1", want: w1 },
        { itemId: "c1", want: w1 },
      ]),
      [{ want: w1, itemIds: ["c1"] }]
    );
  });

  it("returns no rows for no matches", () => {
    assert.deepEqual(groupWantMatches([]), []);
  });
});

describe("acceptanceSetsEqual", () => {
  const sets = (over: Partial<AcceptanceSets> = {}): AcceptanceSets => ({
    conditionIds: [],
    certificateStatusIds: [],
    formatIds: [],
    ...over,
  });

  it("is true for two empty acceptances — both say 'anything'", () => {
    assert.equal(acceptanceSetsEqual(sets(), sets()), true);
  });

  it("ignores order, which is display order and carries no meaning", () => {
    assert.equal(
      acceptanceSetsEqual(
        sets({ conditionIds: [MNG, MH, MNH] }),
        sets({ conditionIds: [MNH, MNG, MH] })
      ),
      true
    );
  });

  it("keeps 'any' apart from a set that happens to list everything", () => {
    assert.equal(
      acceptanceSetsEqual(sets(), sets({ conditionIds: ALL_CONDITIONS })),
      false
    );
  });

  it("treats null as the member it is, not as an absent answer", () => {
    assert.equal(
      acceptanceSetsEqual(
        sets({ certificateStatusIds: [null] }),
        sets({ certificateStatusIds: [] })
      ),
      false
    );
    assert.equal(
      acceptanceSetsEqual(
        sets({ formatIds: [null, BLOCK4] }),
        sets({ formatIds: [BLOCK4, null] })
      ),
      true
    );
  });

  it("compares every axis, not just the first", () => {
    assert.equal(
      acceptanceSetsEqual(
        sets({ conditionIds: [MNH], formatIds: [BLOCK4] }),
        sets({ conditionIds: [MNH], formatIds: [] })
      ),
      false
    );
  });
});

describe("acceptanceAxisView", () => {
  // The want chip's table (#1244): a cell reads *any*, or its members in the settings' order.
  const ORDER = [MNH, MH, MNG, U];

  it("reads an empty set as any, never as no members", () => {
    assert.deepEqual(acceptanceAxisView([], ORDER), { any: true });
  });

  it("keeps the null member apart from any, and leads with it", () => {
    // "No certificate" is a real want since #532, and it must not read like "any certificate".
    assert.deepEqual(acceptanceAxisView([CERT_PHOTO, null], [CERT_PHOTO]), {
      any: false,
      members: [null, CERT_PHOTO],
    });
  });

  it("lists the members in the dictionary's order, unknown ids last", () => {
    assert.deepEqual(acceptanceAxisView([U, "cond-gone", MNH, MH], ORDER), {
      any: false,
      members: [MNH, MH, U, "cond-gone"],
    });
  });
});
