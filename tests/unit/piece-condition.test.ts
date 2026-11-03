import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conditioned, NO_CONDITION, takesCondition } from "../../src/lib/piece-condition";
import { asPieceFilter, NOT_PIECE, PIECE, pieceFilterWhere } from "../../src/lib/multi-stamp";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import { offerConditionCounts } from "../../src/lib/offer-condition-counts";
import { listingItemGaps } from "../../src/lib/offer-item-gaps";
import {
  evaluateListingPreconditions,
  type PreconditionCopy,
} from "../../src/lib/listing-preconditions";
import { structureSegments, type StructureCopy } from "../../src/lib/collection-structure-rules";

// A piece has no condition, and no piece counts towards a stamp's holdings (#2383; ADR-0079) — the
// pure half: which copies take one, how a piece is filtered for and against, and the surfaces that
// read a copy's condition saying nothing about a piece's.

describe("takesCondition", () => {
  it("is a loose stamp's — one stamp, on a format with no kind", () => {
    assert.equal(takesCondition(1, null), true);
  });

  it("is never a piece's, one stamp on a cover as much as several", () => {
    assert.equal(takesCondition(1, "on_cover"), false);
    assert.equal(takesCondition(1, "on_piece"), false);
    assert.equal(takesCondition(3, null), false);
    assert.equal(takesCondition(2, "on_cover"), false);
  });
});

describe("conditioned", () => {
  it("hands back the copy itself when it has a condition", () => {
    const copy = { conditionId: "mnh", conditionName: "Mint", conditionAbbreviation: "**", itemNo: 1 };
    assert.equal(conditioned(copy), copy);
  });

  it("is null for a piece, which has none", () => {
    assert.equal(
      conditioned({ conditionId: null, conditionName: null, conditionAbbreviation: null }),
      null
    );
  });
});

describe("the pieces filter", () => {
  it("narrows through the very fragments the counts spread", () => {
    assert.equal(pieceFilterWhere("only"), PIECE);
    assert.equal(pieceFilterWhere("exclude"), NOT_PIECE);
    assert.deepEqual(pieceFilterWhere(undefined), {});
  });

  it("reads anything else as no filter", () => {
    assert.equal(asPieceFilter("only"), "only");
    assert.equal(asPieceFilter("exclude"), "exclude");
    for (const value of [null, undefined, "", "both"]) assert.equal(asPieceFilter(value), undefined);
  });

  it("round-trips through the URL a grouped list's member read writes", () => {
    assert.equal(readItemFilters(new URLSearchParams("piece=exclude")).piece, "exclude");
    assert.equal(readItemFilters(new URLSearchParams("")).piece, undefined);
  });

  it("keeps the Copies list's *No condition* value beside the conditions", () => {
    assert.deepEqual(
      readItemFilters(new URLSearchParams(`conditionIds=mnh,${NO_CONDITION}`)).conditionIds,
      ["mnh", NO_CONDITION]
    );
  });
});

describe("what reads a copy's condition says nothing about a piece's", () => {
  it("counts a piece under no condition on an offer's row", () => {
    const MNH = { abbreviation: "MNH", name: "Mint", sortOrder: 0 };
    assert.deepEqual(
      offerConditionCounts([
        { conditionId: "mnh", condition: MNH },
        { conditionId: null, condition: null },
      ]),
      [{ id: "mnh", abbreviation: "MNH", name: "Mint", count: 1 }]
    );
  });

  it("never offers `+ CV` on a piece's row", () => {
    const gaps = listingItemGaps(
      [{ stampId: "s1", conditionId: null, catalogUrl: "u", unpricedVariantStampId: null }],
      [{ stampId: "s1", conditionId: null, value: { unpriced: true, mark: null } }]
    );
    assert.equal(gaps.unpriced, 0);
  });

  it("blocks a piece on a platform that grades every item, and nowhere else", () => {
    const piece: PreconditionCopy = {
      itemId: "i1",
      label: "Mi·PL 1",
      stampId: "s1",
      catalogItemId: "c1",
      conditionId: null,
      conditionName: null,
      certificateStatusId: null,
      formatId: null,
      platformCondition: null,
    };
    const sets = [{ setId: "set-1", label: "Mi·PL 1", copies: [piece] }];
    const colnect = evaluateListingPreconditions({ platformModule: "colnect", state: "ready", sets });
    assert.deepEqual(
      colnect.map((b) => b.code),
      ["piece-without-condition"]
    );
    assert.deepEqual(colnect[0].subjects, ["Mi·PL 1"]);
    assert.deepEqual(
      evaluateListingPreconditions({ platformModule: "allegro", state: "ready", sets }).map((b) => b.code),
      []
    );
  });

  it("offers *No condition* on the structure screen only where a piece is", () => {
    const vocab = {
      conditions: [{ id: "mnh", name: "Mint" }],
      certificateStatuses: [],
      formats: [],
      subtypes: [],
      areas: [],
      locations: [],
      tags: [],
      includeSubAreas: true,
    } as unknown as Parameters<typeof structureSegments>[2];
    const narrowing = { conditionIds: [] } as unknown as Parameters<typeof structureSegments>[3];
    const loose = { conditionId: "mnh" } as StructureCopy;
    const piece = { conditionId: null } as StructureCopy;
    const labels = (copies: StructureCopy[]) =>
      structureSegments("condition", copies, vocab, narrowing).map((s) => s.label);
    assert.deepEqual(labels([loose]), ["Mint"]);
    assert.deepEqual(labels([loose, piece]), ["No condition", "Mint"]);
    const noCondition = structureSegments("condition", [piece], vocab, narrowing)[0];
    assert.equal(noCondition.match(piece), true);
    assert.equal(noCondition.match(loose), false);
    assert.deepEqual(noCondition.params, { conditionIds: NO_CONDITION });
  });
});
