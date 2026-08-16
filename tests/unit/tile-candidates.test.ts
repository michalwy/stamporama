import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candidateLabel,
  candidateShortLabel,
  sharedVariantParent,
  toTileCandidate,
  type TileCandidate,
} from "../../src/lib/tile-candidates";

// The shortlist a parked tile carries (#607), and the correction that keeps it from being reached
// for where the app already has a better answer.
//
// What is pinned here is the **condition** on that correction, because getting it wrong is worse
// than not offering it at all: a shortlist of *the base stamp or its overprint* must never be
// offered the parent, since there the parent is one of the answers rather than the question, and
// identifying against it would record a decision nobody made.

const PARENT = { stampId: "mi200", stampName: "Birds", catalogNumbers: ["200"] };

function candidate(over: Partial<TileCandidate> & { stampId: string }): TileCandidate {
  return {
    stampName: null,
    catalogNumbers: [],
    issueId: null,
    collectionAreaId: null,
    unknownVariant: false,
    parent: PARENT,
    actsAsVariant: true,
    ...over,
  };
}

describe("a parked tile's candidates (#607)", () => {
  it("names a candidate by its numbers and then its name", () => {
    assert.equal(
      candidateLabel({ stampName: "Birds", catalogNumbers: ["200a", "12"] }),
      "200a · 12 — Birds"
    );
    assert.equal(candidateLabel({ stampName: null, catalogNumbers: ["200a"] }), "200a");
    assert.equal(candidateLabel({ stampName: "Birds", catalogNumbers: [] }), "Birds");
    assert.equal(candidateLabel({ stampName: null, catalogNumbers: [] }), "(unnamed stamp)");
  });

  it("reaches for one number, the primary catalogue's, on a strip square", () => {
    assert.equal(candidateShortLabel({ stampName: "Birds", catalogNumbers: ["200a", "12"] }), "200a");
    assert.equal(candidateShortLabel({ stampName: "Birds", catalogNumbers: [] }), "Birds");
  });

  it("offers the parent when every candidate is a variant child of the same node", () => {
    const parent = sharedVariantParent([
      candidate({ stampId: "a", catalogNumbers: ["200a"] }),
      candidate({ stampId: "b", catalogNumbers: ["200b"] }),
    ]);
    assert.deepEqual(parent, PARENT);
  });

  it("does not offer it when a candidate is not an effective variant", () => {
    // An error, a plate flaw or an overprint is its own collectible, and the parent is a concrete
    // stamp in its own right — so *the base stamp or its overprint* is a real shortlist and the
    // parent would be one of its answers.
    assert.equal(
      sharedVariantParent([
        candidate({ stampId: "a" }),
        candidate({ stampId: "b", actsAsVariant: false }),
      ]),
      null
    );
  });

  it("does not offer it across two different parents, or where a candidate has none", () => {
    assert.equal(
      sharedVariantParent([
        candidate({ stampId: "a" }),
        candidate({
          stampId: "b",
          parent: { stampId: "mi201", stampName: null, catalogNumbers: ["201"] },
        }),
      ]),
      null
    );
    // The base stamp itself is not settled — exactly what candidates exist for.
    assert.equal(
      sharedVariantParent([candidate({ stampId: "a" }), candidate({ stampId: "b", parent: null })]),
      null
    );
  });

  it("says nothing about a shortlist of one, which is not a shortlist", () => {
    assert.equal(sharedVariantParent([candidate({ stampId: "a" })]), null);
    assert.equal(sharedVariantParent([]), null);
  });

  it("resolves the effective actsAsVariant in the one place, override before subtype", () => {
    const row = {
      id: "a",
      name: "Watermark A",
      catalogNumbers: [{ number: "200a" }],
      parent: { id: "mi200", name: "Birds", catalogNumbers: [{ number: "200" }] },
    };
    assert.equal(
      toTileCandidate({ ...row, actsAsVariantOverride: null, subtype: { actsAsVariant: true } })
        .actsAsVariant,
      true
    );
    // The per-stamp override wins over the subtype's flag (ADR-0010 §2a)…
    assert.equal(
      toTileCandidate({ ...row, actsAsVariantOverride: false, subtype: { actsAsVariant: true } })
        .actsAsVariant,
      false
    );
    // …and an unclassified child is not a variant, which is the safe answer here: it withholds the
    // correction rather than offering a parent that may be one of the answers.
    assert.equal(
      toTileCandidate({ ...row, actsAsVariantOverride: null, subtype: null }).actsAsVariant,
      false
    );
    assert.deepEqual(
      toTileCandidate({ ...row, actsAsVariantOverride: true, subtype: null }).parent,
      { stampId: "mi200", stampName: "Birds", catalogNumbers: ["200"] }
    );
  });

  it("carries what the picker's own row needs: the issue, its area, and umbrella-ness", () => {
    // The row is fetched per issue and formatted per area (#377), so a candidate that names neither
    // falls back to the plain label rather than rendering half a row.
    const bare = toTileCandidate({
      id: "a",
      name: "Loose stamp",
      catalogNumbers: [],
      actsAsVariantOverride: null,
      subtype: null,
      parent: null,
    });
    assert.equal(bare.issueId, null);
    assert.equal(bare.collectionAreaId, null);
    assert.equal(bare.unknownVariant, false);

    // Only the **first** membership answers, the one-issue-per-stamp rule every other read follows.
    const onIssue = toTileCandidate({
      id: "b",
      name: null,
      catalogNumbers: [{ number: "200" }],
      actsAsVariantOverride: null,
      subtype: null,
      parent: null,
      issueMemberships: [
        { issue: { id: "issue-1", collectionAreaId: "area-1" } },
        { issue: { id: "issue-2", collectionAreaId: "area-2" } },
      ],
      // …and a stamp with variant children under it is an umbrella, so pressing it means "this
      // stamp, variant not yet known" — which the row says, exactly as the picker does.
      variants: [{ actsAsVariantOverride: null, subtype: { actsAsVariant: true } }],
    });
    assert.equal(onIssue.issueId, "issue-1");
    assert.equal(onIssue.collectionAreaId, "area-1");
    assert.equal(onIssue.unknownVariant, true);
  });
});
