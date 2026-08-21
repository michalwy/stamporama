import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareGiveCandidates,
  describeGiveResolution,
  isGiveGap,
  isGiveShortfall,
  parseGiveAxis,
  rankGiveCandidates,
  resolveGiveRequirements,
  servesRequirement,
  summariseGiveResolutions,
  GIVE_AXIS_ANY,
  GIVE_AXIS_NONE,
  type GiveCandidateCopy,
  type GiveRequirement,
} from "../../src/lib/trade-give-resolution-rules";

// Resolving a requirement to a copy (#659) — the order, the narrowing and the gap.
//
// The load-bearing tests are the order ones: the same wish list imported twice has to pick the same
// copies, and a partner asking for "this stamp" must not be handed a certified piece or a block of
// four because it happened to sort first.

function copy(over: Partial<GiveCandidateCopy> = {}): GiveCandidateCopy {
  return {
    id: over.id ?? `i${over.itemNo ?? 1}`,
    itemNo: 1,
    stampId: "s1",
    conditionId: "c1",
    certificateStatusId: null,
    formatId: null,
    forTrade: false,
    hasPhoto: false,
    ...over,
  };
}

function requirement(over: Partial<GiveRequirement> = {}): GiveRequirement {
  return { stampId: "s1", conditionId: "c1", quantity: 1, ...over };
}

describe("servesRequirement", () => {
  it("needs the stamp and the condition to agree", () => {
    assert.equal(servesRequirement(requirement(), copy()), true);
    assert.equal(servesRequirement(requirement(), copy({ stampId: "s2" })), false);
    assert.equal(servesRequirement(requirement(), copy({ conditionId: "c2" })), false);
  });

  it("ignores certificate and format when the source said nothing", () => {
    const wish = requirement();
    assert.equal(servesRequirement(wish, copy({ certificateStatusId: "cert" })), true);
    assert.equal(servesRequirement(wish, copy({ formatId: "block" })), true);
  });

  it("narrows to exactly what was stated, null included", () => {
    const plain = requirement({ certificateStatusId: null, formatId: null });
    assert.equal(servesRequirement(plain, copy()), true);
    assert.equal(servesRequirement(plain, copy({ certificateStatusId: "cert" })), false);
    assert.equal(servesRequirement(plain, copy({ formatId: "block" })), false);

    const certified = requirement({ certificateStatusId: "cert" });
    assert.equal(servesRequirement(certified, copy()), false);
    assert.equal(servesRequirement(certified, copy({ certificateStatusId: "cert" })), true);
  });
});

describe("the preference order", () => {
  it("puts a for-trade copy before anything else", () => {
    const marked = copy({ id: "a", itemNo: 9, forTrade: true, formatId: "block" });
    const album = copy({ id: "b", itemNo: 1, hasPhoto: true });
    assert.deepEqual(
      [marked, album].sort(compareGiveCandidates).map((c) => c.id),
      ["a", "b"]
    );
  });

  it("prefers the plain single to a certified copy or a multiple", () => {
    const plain = copy({ id: "plain", itemNo: 9 });
    const certified = copy({ id: "cert", itemNo: 1, certificateStatusId: "cert", hasPhoto: true });
    const block = copy({ id: "block", itemNo: 2, formatId: "block", hasPhoto: true });
    assert.equal([certified, block, plain].sort(compareGiveCandidates)[0]?.id, "plain");
  });

  it("prefers a copy with a photo, then the lowest copy number", () => {
    const shown = copy({ id: "shown", itemNo: 7, hasPhoto: true });
    const blank = copy({ id: "blank", itemNo: 3 });
    assert.deepEqual(
      [blank, shown].sort(compareGiveCandidates).map((c) => c.id),
      ["shown", "blank"]
    );
    assert.deepEqual(
      [copy({ id: "hi", itemNo: 5 }), copy({ id: "lo", itemNo: 2 })]
        .sort(compareGiveCandidates)
        .map((c) => c.id),
      ["lo", "hi"]
    );
  });

  it("ranks only the copies that serve the requirement", () => {
    const pool = [copy({ id: "other", stampId: "s2" }), copy({ id: "mine", itemNo: 4 })];
    assert.deepEqual(
      rankGiveCandidates(requirement(), pool).map((c) => c.id),
      ["mine"]
    );
  });
});

describe("resolveGiveRequirements", () => {
  const pool = [
    copy({ id: "a", itemNo: 1 }),
    copy({ id: "b", itemNo: 2 }),
    copy({ id: "c", itemNo: 3 }),
  ];

  it("takes N distinct copies for a quantity of N", () => {
    const [resolution] = resolveGiveRequirements([requirement({ quantity: 2 })], pool);
    assert.deepEqual(resolution?.itemIds, ["a", "b"]);
    assert.equal(resolution?.served, 2);
    assert.equal(resolution?.missing, 0);
  });

  it("reports a shortfall rather than rounding down", () => {
    const [resolution] = resolveGiveRequirements([requirement({ quantity: 5 })], pool);
    assert.equal(resolution?.served, 3);
    assert.equal(resolution?.missing, 2);
    assert.equal(isGiveShortfall(resolution!), true);
    assert.equal(isGiveGap(resolution!), false);
  });

  it("reports a gap as an outcome, not an error", () => {
    const [resolution] = resolveGiveRequirements([requirement({ conditionId: "c9" })], pool);
    assert.deepEqual(resolution?.itemIds, []);
    assert.equal(resolution?.missing, 1);
    assert.equal(isGiveGap(resolution!), true);
  });

  it("never serves one copy to two requirements", () => {
    const [first, second] = resolveGiveRequirements(
      [requirement({ quantity: 2 }), requirement({ quantity: 2 })],
      pool
    );
    assert.deepEqual(first?.itemIds, ["a", "b"]);
    assert.deepEqual(second?.itemIds, ["c"]);
    assert.equal(second?.missing, 1);
  });

  it("resolves the same input to the same copies twice", () => {
    const input = [requirement({ quantity: 2 }), requirement({ stampId: "s2" })];
    const shuffled = [pool[2]!, pool[0]!, pool[1]!];
    assert.deepEqual(
      resolveGiveRequirements(input, pool).map((r) => r.itemIds),
      resolveGiveRequirements(input, shuffled).map((r) => r.itemIds)
    );
  });

  it("treats a missing or zero quantity as one", () => {
    const [resolution] = resolveGiveRequirements([requirement({ quantity: 0 })], pool);
    assert.equal(resolution?.requested, 1);
    assert.equal(resolution?.served, 1);
  });
});

describe("parseGiveAxis", () => {
  it("reads silence as any and the token as none", () => {
    assert.equal(parseGiveAxis(GIVE_AXIS_ANY), undefined);
    assert.equal(parseGiveAxis(undefined), undefined);
    assert.equal(parseGiveAxis(GIVE_AXIS_NONE), null);
    assert.equal(parseGiveAxis("cert-id"), "cert-id");
  });
});

describe("the words", () => {
  it("says how many are missing, and never rounds it away", () => {
    const [full, short, gap] = resolveGiveRequirements(
      [requirement(), requirement({ quantity: 3 }), requirement({ stampId: "s9" })],
      [copy({ id: "a", itemNo: 1 }), copy({ id: "b", itemNo: 2 })]
    );
    assert.match(describeGiveResolution(full!), /1 copy/);
    assert.match(describeGiveResolution(short!), /1 of 3/);
    assert.match(describeGiveResolution(gap!), /no copy/);
  });

  it("counts gaps apart from shortfalls", () => {
    const summary = summariseGiveResolutions(
      resolveGiveRequirements(
        [requirement({ quantity: 3 }), requirement({ stampId: "s9" })],
        [copy({ id: "a", itemNo: 1 })]
      )
    );
    assert.deepEqual(summary, { served: 1, gaps: 1, shortfalls: 1 });
  });
});
