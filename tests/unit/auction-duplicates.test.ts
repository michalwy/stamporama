import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collidingLotIds,
  duplicateMatches,
  overallStrength,
  sameStamp,
  type AtRiskLine,
  type ComposedLine,
} from "../../src/lib/auction-duplicates";

// The duplicate warning's rules (#369): am I already winning this stamp?

function atRisk(overrides: Partial<AtRiskLine> = {}): AtRiskLine {
  return {
    lotId: "lot-1",
    auctionLotNo: 12,
    saleId: "sale-1",
    lotTitle: "Köhler 385 · lot 41",
    stampId: "stamp-12",
    familyIds: [],
    stampLabel: "Mi·PL 12",
    conditionId: "cond-mnh",
    conditionLabel: "**",
    formatId: null,
    formatLabel: null,
    certificateStatusId: null,
    certificateStatusLabel: null,
    ...overrides,
  };
}

function composed(overrides: Partial<ComposedLine> = {}): ComposedLine {
  return {
    stampId: "stamp-12",
    conditionId: "cond-mnh",
    formatId: null,
    certificateStatusId: null,
    ...overrides,
  };
}

// Which stamps count as the same stamp ----------------------------------------

describe("sameStamp", () => {
  it("matches the identical stamp", () => {
    assert.equal(sameStamp("stamp-12", atRisk()), true);
  });

  it("matches through the umbrella, in both directions", () => {
    // The candidate is the umbrella, the composed line one of its variants…
    assert.equal(sameStamp("stamp-12-ii", atRisk({ familyIds: ["stamp-12-i", "stamp-12-ii"] })), true);
    // …and the other way round: the candidate is the variant, the line the umbrella.
    assert.equal(
      sameStamp("stamp-12", atRisk({ stampId: "stamp-12-ii", familyIds: ["stamp-12"] })),
      true
    );
  });

  it("does not match siblings", () => {
    // `Mi. 12 I` and `Mi. 12 II` share an umbrella but are different stamps, and the family of each
    // is its own chain — never everything under the common root. Bidding on both is ordinary.
    const sibling = atRisk({ stampId: "stamp-12-i", familyIds: ["stamp-12"] });
    assert.equal(sameStamp("stamp-12-ii", sibling), false);
  });

  it("does not match an unrelated stamp", () => {
    assert.equal(sameStamp("stamp-99", atRisk()), false);
  });
});

// How loudly a pair warns -----------------------------------------------------

describe("duplicateMatches strength", () => {
  it("is hard for the same stamp at the same condition and format", () => {
    const [match] = duplicateMatches([composed()], [atRisk()]);
    assert.equal(match.strength, "hard");
    assert.equal(match.certificateDiffers, false);
  });

  it("stays hard when only the certificate differs, and says so", () => {
    // A Fotoattest changes what a copy is worth, not which stamp it is.
    const [match] = duplicateMatches(
      [composed({ certificateStatusId: "cert-attest" })],
      [atRisk({ certificateStatusId: null })]
    );
    assert.equal(match.strength, "hard");
    assert.equal(match.certificateDiffers, true);
  });

  it("is soft when the condition differs", () => {
    const [match] = duplicateMatches([composed({ conditionId: "cond-used" })], [atRisk()]);
    assert.equal(match.strength, "soft");
  });

  it("is soft when the format differs", () => {
    // A single and a block of four are two different things to own.
    const [match] = duplicateMatches([composed({ formatId: "fmt-block4" })], [atRisk()]);
    assert.equal(match.strength, "soft");
  });

  it("is silent for an unrelated stamp", () => {
    assert.deepEqual(duplicateMatches([composed({ stampId: "stamp-99" })], [atRisk()]), []);
  });

  it("is silent when there is nothing being won", () => {
    assert.deepEqual(duplicateMatches([composed()], []), []);
  });

  it("is silent for a composition with no lines", () => {
    assert.deepEqual(duplicateMatches([], [atRisk()]), []);
  });
});

// One lot, reported once ------------------------------------------------------

describe("duplicateMatches folding", () => {
  it("reports a lot once however many lines collide with it", () => {
    const matches = duplicateMatches(
      [composed(), composed({ conditionId: "cond-used" })],
      [atRisk()]
    );
    assert.equal(matches.length, 1);
  });

  it("upgrades a soft match to hard, never the reverse", () => {
    const soft = composed({ conditionId: "cond-used" });
    const hard = composed();
    assert.equal(duplicateMatches([soft, hard], [atRisk()])[0].strength, "hard");
    assert.equal(duplicateMatches([hard, soft], [atRisk()])[0].strength, "hard");
  });

  it("puts hard matches first, then orders by lot number", () => {
    const matches = duplicateMatches(
      [composed(), composed({ conditionId: "cond-used" })],
      [
        atRisk({ lotId: "a", auctionLotNo: 30, formatId: "fmt-block4" }),
        atRisk({ lotId: "b", auctionLotNo: 20 }),
        atRisk({ lotId: "c", auctionLotNo: 10 }),
      ]
    );
    assert.deepEqual(
      matches.map((m) => [m.line.lotId, m.strength]),
      [
        ["c", "hard"],
        ["b", "hard"],
        ["a", "soft"],
      ]
    );
  });
});

// Which lots collide with each other ------------------------------------------

describe("collidingLotIds", () => {
  it("reports both sides of a collision", () => {
    const ids = collidingLotIds([
      atRisk({ lotId: "a", auctionLotNo: 1 }),
      atRisk({ lotId: "b", auctionLotNo: 2 }),
    ]);
    assert.deepEqual(ids, ["a", "b"]);
  });

  it("ignores a soft match", () => {
    // The chip and the badge only ever mean "on course to buy this twice".
    const ids = collidingLotIds([
      atRisk({ lotId: "a" }),
      atRisk({ lotId: "b", conditionId: "cond-used" }),
    ]);
    assert.deepEqual(ids, []);
  });

  it("does not collide a lot with itself", () => {
    // One lot holding the same stamp twice is a lot with two of them — that is what quantity is for.
    const ids = collidingLotIds([atRisk({ lotId: "a" }), atRisk({ lotId: "a" })]);
    assert.deepEqual(ids, []);
  });

  it("collides through the umbrella", () => {
    const ids = collidingLotIds([
      atRisk({ lotId: "a", stampId: "stamp-12", familyIds: ["stamp-12-ii"] }),
      atRisk({ lotId: "b", stampId: "stamp-12-ii", familyIds: ["stamp-12"] }),
    ]);
    assert.deepEqual(ids, ["a", "b"]);
  });

  it("does not collide two variants of one umbrella", () => {
    const ids = collidingLotIds([
      atRisk({ lotId: "a", stampId: "stamp-12-i", familyIds: ["stamp-12"] }),
      atRisk({ lotId: "b", stampId: "stamp-12-ii", familyIds: ["stamp-12"] }),
    ]);
    assert.deepEqual(ids, []);
  });

  it("lists each lot once, in first-appearance order", () => {
    const ids = collidingLotIds([
      atRisk({ lotId: "c" }),
      atRisk({ lotId: "a" }),
      atRisk({ lotId: "a", stampId: "stamp-40", familyIds: [] }),
      atRisk({ lotId: "b", stampId: "stamp-40", familyIds: [] }),
    ]);
    assert.deepEqual(ids, ["c", "a", "b"]);
  });

  it("is empty when nothing is being won", () => {
    assert.deepEqual(collidingLotIds([]), []);
  });
});

// What the banner takes as a whole --------------------------------------------

describe("overallStrength", () => {
  it("is hard when any match is hard", () => {
    const matches = duplicateMatches(
      [composed(), composed({ conditionId: "cond-used" })],
      [atRisk({ lotId: "a", conditionId: "cond-used" }), atRisk({ lotId: "b" })]
    );
    assert.equal(overallStrength(matches), "hard");
  });

  it("is soft when every match is soft", () => {
    const matches = duplicateMatches([composed({ conditionId: "cond-used" })], [atRisk()]);
    assert.equal(overallStrength(matches), "soft");
  });

  it("is null when nothing matched", () => {
    assert.equal(overallStrength([]), null);
  });
});
