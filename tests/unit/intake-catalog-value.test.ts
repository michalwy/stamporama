import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  EMPTY_INTAKE_CATALOG_VALUE,
  catalogValueEntry,
  catalogValueSubjectKey,
} from "../../src/lib/intake-catalog-value";

// The intake step's catalogue value (#593). What is tested here is the rule for *whether to write*,
// which is where the issue's three promises live: blank is unremarkable, an existing price is
// edited rather than duplicated, and a figure never follows a change of condition.

const held = {
  catalogNameId: "cat-michel",
  amount: "",
  recorded: null,
  loading: false,
};

describe("catalogValueEntry", () => {
  it("writes nothing when the field is blank — the ordinary intake", () => {
    assert.equal(catalogValueEntry(held), null);
    assert.equal(catalogValueEntry({ ...held, amount: "   " }), null);
  });

  it("writes nothing when the stamp's area has no primary catalogue to write to", () => {
    assert.equal(catalogValueEntry({ ...held, catalogNameId: null, amount: "12" }), null);
    assert.equal(catalogValueEntry(EMPTY_INTAKE_CATALOG_VALUE), null);
  });

  it("writes what was typed when nothing is on file", () => {
    assert.deepEqual(catalogValueEntry({ ...held, amount: "12.50" }), {
      catalogNameId: "cat-michel",
      amount: "12.50",
    });
  });

  it("writes an edit of an existing price, so it is replaced rather than duplicated", () => {
    assert.deepEqual(catalogValueEntry({ ...held, amount: "18", recorded: "12.00" }), {
      catalogNameId: "cat-michel",
      amount: "18",
    });
  });

  it("writes nothing when the prefill was left alone, however it is spelled", () => {
    // The recorded value arrives as `12.00`; retyping it as `12` or `12,00` has changed nothing, and
    // a textual comparison would send a write on every intake of an already-priced stamp.
    assert.equal(catalogValueEntry({ ...held, amount: "12.00", recorded: "12.00" }), null);
    assert.equal(catalogValueEntry({ ...held, amount: "12", recorded: "12.00" }), null);
    assert.equal(catalogValueEntry({ ...held, amount: "12,00", recorded: "12.00" }), null);
  });

  it("passes an unparseable figure through to be refused, rather than reading it as unchanged", () => {
    assert.deepEqual(catalogValueEntry({ ...held, amount: "1.2.3", recorded: "12.00" }), {
      catalogNameId: "cat-michel",
      amount: "1.2.3",
    });
  });

  it("writes nothing while the context for the chosen axes is still being read", () => {
    // The figure on screen belongs to the answer just left; writing it would reassign it onto a
    // condition it was never typed for.
    assert.equal(catalogValueEntry({ ...held, amount: "12", loading: true }), null);
  });
});

describe("catalogValueSubjectKey", () => {
  it("separates every axis a catalogue price is recorded against", () => {
    const base = catalogValueSubjectKey("s1", "mnh", "", "");
    assert.notEqual(base, catalogValueSubjectKey("s1", "used", "", ""));
    assert.notEqual(base, catalogValueSubjectKey("s1", "mnh", "cert-bpp", ""));
    // Format is an axis of the price too (#343/#573): a block of four must not be filed as the
    // single, which is the gap #593's wording left open.
    assert.notEqual(base, catalogValueSubjectKey("s1", "mnh", "", "block4"));
    // …and the stamp itself, since the dialog is re-used for the next pick without unmounting.
    assert.notEqual(base, catalogValueSubjectKey("s2", "mnh", "", ""));
  });

  it("is stable for the same subject", () => {
    assert.equal(
      catalogValueSubjectKey("s1", "mnh", "cert", "pair"),
      catalogValueSubjectKey("s1", "mnh", "cert", "pair")
    );
  });
});
