import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wantMatchesCopy,
  narrowConditionSeed,
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
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, U, []), [MNG, MH, MNH]);
  });

  it("keeps the dictionary's own order, which is display order and nothing more", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, MH, []), [U, MNG, MNH]);
  });

  it("leaves an already-narrowed set exactly as it is — that question was answered once", () => {
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, U, [MNH]), [MNH]);
    // Even when the arrived condition is in it: closing or leaving it open is the collector's call.
    assert.deepEqual(narrowConditionSeed(ALL_CONDITIONS, MNH, [MNH, MH]), [MNH, MH]);
  });

  it("returns an empty seed when there is nothing left to narrow to, rather than inventing one", () => {
    assert.deepEqual(narrowConditionSeed([U], U, []), []);
  });

  it("does not mutate the set it was handed", () => {
    const current = [MNH];
    const seeded = narrowConditionSeed(ALL_CONDITIONS, U, current);
    seeded.push(MH);
    assert.deepEqual(current, [MNH]);
  });
});
