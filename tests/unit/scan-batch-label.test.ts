import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_LABEL_LENGTH,
  batchLabelFromFileName,
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

describe("scan batch label from the file name (#603)", () => {
  it("takes the file's name without its extension", () => {
    assert.equal(batchLabelFromFileName("Klaser Polska 1.jpg"), "Klaser Polska 1");
    assert.equal(batchLabelFromFileName("Zestawy 3–5.tiff"), "Zestawy 3–5");
    // Only the last extension goes: the rest is the name as the collector saved it.
    assert.equal(batchLabelFromFileName("skan.2026-08-15.png"), "skan.2026-08-15");
    assert.equal(batchLabelFromFileName("no-extension"), "no-extension");
  });

  it("leaves a name that is only an extension, or only space, unnamed", () => {
    assert.equal(batchLabelFromFileName(".jpg"), null);
    assert.equal(batchLabelFromFileName("   .jpg"), null);
    assert.equal(batchLabelFromFileName(""), null);
  });

  it("yields no name rather than a refusal when the file name is too long", () => {
    // A typed name past the ceiling is refused, because shortening the collector's wording is worse
    // than saying no. There is no wording to preserve here and no question to put — a scanner's
    // long file name must not be what fails an upload — so the card is simply left unnamed.
    assert.equal(batchLabelFromFileName(`${"x".repeat(MAX_BATCH_LABEL_LENGTH)}.jpg`), "x".repeat(MAX_BATCH_LABEL_LENGTH));
    assert.equal(batchLabelFromFileName(`${"x".repeat(MAX_BATCH_LABEL_LENGTH + 1)}.jpg`), null);
  });
});
