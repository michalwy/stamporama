import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyName } from "../../src/lib/template-copy-name";

// A duplicated template's name (#1474): unique within the collection, since a template is picked by
// name, and saying where it came from.
describe("copyName", () => {
  it("adds (copy) when that is free", () => {
    assert.equal(copyName("Polska A4", ["Polska A4"]), "Polska A4 (copy)");
  });

  it("counts on rather than stacking a second (copy)", () => {
    assert.equal(copyName("Polska A4", ["Polska A4", "Polska A4 (copy)"]), "Polska A4 (copy 2)");
    assert.equal(
      copyName("Polska A4", ["Polska A4", "Polska A4 (copy)", "Polska A4 (copy 2)"]),
      "Polska A4 (copy 3)"
    );
  });

  it("treats names differing only in case as taken", () => {
    assert.equal(copyName("Polska A4", ["polska a4 (COPY)"]), "Polska A4 (copy 2)");
  });
});
