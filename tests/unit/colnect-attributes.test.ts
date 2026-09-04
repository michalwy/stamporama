import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attributeWrites,
  guessColnectAttributeValue,
  mapColnectAttribute,
  parseColnectAttributes,
  proposeStampAttributes,
  type ColnectAttributeDictionaries,
  type CurrentStampAttributes,
} from "../../src/lib/colnect-attributes";

// Filling a stamp's attributes off a Colnect page (#739): fill what we state nothing for, report a
// disagreement, never overwrite silently — and never invent a dictionary row for a word the
// collection's mapping does not cover.

const DICTIONARIES: ColnectAttributeDictionaries = {
  color: [
    { id: "c1", name: "Carmine", colnectValue: "Carmine" },
    { id: "c2", name: "Grey red", colnectValue: "Grey Red" },
    { id: "c3", name: "Blue", colnectValue: null },
  ],
  watermark: [{ id: "w1", name: "Lozenges", colnectValue: "Lozenges" }],
  paper: [{ id: "p1", name: "Thin paper", colnectValue: "Thin" }],
  printing: [{ id: "r1", name: "Photogravure", colnectValue: "Photogravure" }],
};

function stamp(over: Partial<CurrentStampAttributes> = {}): CurrentStampAttributes {
  return {
    denomination: null,
    perforation: null,
    colorId: null,
    watermarkId: null,
    paperId: null,
    printingId: null,
    ...over,
  };
}

describe("mapping a Colnect word to a dictionary row", () => {
  it("matches on the mapped value, ignoring case and spacing", () => {
    assert.equal(mapColnectAttribute(DICTIONARIES.color, "carmine")?.id, "c1");
    assert.equal(mapColnectAttribute(DICTIONARIES.color, "  grey   red ")?.id, "c2");
  });

  // The mapping is explicit and nothing else is consulted: a row whose name happens to read like
  // Colnect's word is *not* a mapping, or the Settings panel would be decorative.
  it("does not fall back to the row's own name", () => {
    assert.equal(mapColnectAttribute(DICTIONARIES.color, "Blue"), null);
  });

  it("maps nothing for a blank word", () => {
    assert.equal(mapColnectAttribute(DICTIONARIES.color, "   "), null);
  });
});

describe("the Fill matching guess", () => {
  it("proposes an unmapped row's own name", () => {
    const rows = DICTIONARIES.color;
    assert.equal(guessColnectAttributeValue(rows, rows[2]), "Blue");
  });

  it("leaves a mapped row alone", () => {
    const rows = DICTIONARIES.color;
    assert.equal(guessColnectAttributeValue(rows, rows[0]), null);
  });

  // Two rows claiming one word would make the lookup depend on which the database handed back
  // first, so the guess declines rather than creating the ambiguity.
  it("declines a word another row has already claimed", () => {
    const rows = [
      { id: "a", name: "Carmine", colnectValue: null },
      { id: "b", name: "Carmine red", colnectValue: "Carmine" },
    ];
    assert.equal(guessColnectAttributeValue(rows, rows[0]), null);
  });
});

describe("proposing a stamp's attributes", () => {
  it("fills what the stamp states nothing for", () => {
    const proposals = proposeStampAttributes(
      { denomination: "10 gr", color: "Carmine" },
      stamp(),
      DICTIONARIES
    );
    assert.deepEqual(
      proposals.map((p) => [p.field, p.status, p.value]),
      [
        ["denomination", "would-fill", "10 gr"],
        ["color", "would-fill", "c1"],
      ]
    );
    assert.equal(proposals[1].label, "Carmine");
  });

  // Silence, not a proposal — the same answer a catalog ref matching our number gives.
  it("says nothing where the two sides agree", () => {
    assert.deepEqual(
      proposeStampAttributes(
        { denomination: "10 GR", color: "Carmine" },
        stamp({ denomination: "10 gr", colorId: "c1" }),
        DICTIONARIES
      ),
      []
    );
  });

  it("reports a disagreement and never writes it", () => {
    const proposals = proposeStampAttributes(
      { perforation: "12", color: "Grey Red" },
      stamp({ perforation: "11½", colorId: "c1" }),
      DICTIONARIES
    );
    assert.deepEqual(
      proposals.map((p) => [p.field, p.status, p.currentLabel, p.colnectLabel]),
      [
        ["perforation", "conflict", "11½", "12"],
        ["color", "conflict", "Carmine", "Grey Red"],
      ]
    );
    assert.deepEqual(attributeWrites(proposals, ["would-fill"]), {});
  });

  // The whole point of the mapping: a word we cannot place is said out loud and nothing is created.
  it("reports an unmapped word without proposing anything", () => {
    const proposals = proposeStampAttributes({ color: "Vermilion" }, stamp(), DICTIONARIES);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].status, "unmapped");
    assert.equal(proposals[0].value, null);
    assert.equal(proposals[0].colnectLabel, "Vermilion");
    assert.deepEqual(attributeWrites(proposals, ["would-fill", "conflict"]), {});
  });

  // An unmapped colour must not cost the page its other five attributes.
  it("lets the other attributes through beside an unmapped one", () => {
    const proposals = proposeStampAttributes(
      { color: "Vermilion", watermark: "Lozenges" },
      stamp(),
      DICTIONARIES
    );
    assert.deepEqual(
      proposals.map((p) => [p.field, p.status]),
      [
        ["color", "unmapped"],
        ["watermark", "would-fill"],
      ]
    );
    assert.deepEqual(attributeWrites(proposals, ["would-fill"]), { watermarkId: "w1" });
  });

  it("proposes nothing for an attribute the page does not state", () => {
    assert.deepEqual(proposeStampAttributes({ color: "  " }, stamp(), DICTIONARIES), []);
    assert.deepEqual(proposeStampAttributes(null, stamp(), DICTIONARIES), []);
  });

  it("writes a dictionary attribute by its id column", () => {
    const proposals = proposeStampAttributes(
      { denomination: "10 gr", paper: "Thin", printing: "Photogravure" },
      stamp(),
      DICTIONARIES
    );
    assert.deepEqual(attributeWrites(proposals, ["would-fill"]), {
      denomination: "10 gr",
      paperId: "p1",
      printingId: "r1",
    });
  });
});

describe("reading the attributes off a request body", () => {
  it("keeps the six known keys, trimmed", () => {
    assert.deepEqual(parseColnectAttributes({ color: " Carmine ", perforation: "11½" }), {
      color: "Carmine",
      perforation: "11½",
    });
  });

  // Not a hard shape: an unreadable value is no attribute, and must never cost an item its match.
  it("drops what it cannot read, and answers null for a body with nothing in it", () => {
    assert.deepEqual(parseColnectAttributes({ color: 7, size: "24 x 30", watermark: "  " }), null);
    assert.equal(parseColnectAttributes(null), null);
    assert.equal(parseColnectAttributes("carmine"), null);
  });
});
