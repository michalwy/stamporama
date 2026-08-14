import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_LABEL_LENGTH,
  isBatchLabelTooLong,
  normalizeBatchLabel,
} from "../../src/lib/scan-batch-label";

// A scan batch's optional name (#587). The rule lives in a pure module because both halves read it
// — the write enforces the ceiling and the input the collector types into states it — and a
// `server-only` module cannot be where a client component gets a constant from. That is the thing
// worth pinning: the number, and that a blank name is *no* name rather than an empty one.

describe("scan batch label (#587)", () => {
  it("trims a name and treats blank as no name at all", () => {
    assert.equal(normalizeBatchLabel("  Klaser Polska 1  "), "Klaser Polska 1");
    // "no name" is one state, not two — a stored empty string would read as a name nobody can see.
    assert.equal(normalizeBatchLabel(""), null);
    assert.equal(normalizeBatchLabel("   "), null);
    assert.equal(normalizeBatchLabel(null), null);
    assert.equal(normalizeBatchLabel(undefined), null);
  });

  it("keeps a name that is not ASCII, because the cards are not", () => {
    assert.equal(normalizeBatchLabel("Zestawy 3–5"), "Zestawy 3–5");
  });

  it("refuses a name past the ceiling rather than truncating it", () => {
    // Truncation would silently mangle wording the collector chose; the input's `maxLength` makes
    // this unreachable from the screen, so reaching it at all means something else wrote it.
    assert.equal(isBatchLabelTooLong("x".repeat(MAX_BATCH_LABEL_LENGTH)), false);
    assert.equal(isBatchLabelTooLong("x".repeat(MAX_BATCH_LABEL_LENGTH + 1)), true);
    assert.equal(isBatchLabelTooLong(null), false);
  });
});
