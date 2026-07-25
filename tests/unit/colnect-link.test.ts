import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colnectStampUrl } from "@/lib/colnect-link";

describe("colnectStampUrl", () => {
  it("builds the Colnect stamp URL from a stored item-ID", () => {
    assert.equal(
      colnectStampUrl("1133075"),
      "https://colnect.com/en/stamps/stamp/1133075"
    );
  });

  it("trims surrounding whitespace", () => {
    assert.equal(
      colnectStampUrl("  136748 "),
      "https://colnect.com/en/stamps/stamp/136748"
    );
  });

  it("returns null for a missing or blank id", () => {
    assert.equal(colnectStampUrl(null), null);
    assert.equal(colnectStampUrl(undefined), null);
    assert.equal(colnectStampUrl("   "), null);
  });

  it("escapes anything unexpected in the stored id", () => {
    assert.equal(
      colnectStampUrl("12 34/56"),
      "https://colnect.com/en/stamps/stamp/12%2034%2F56"
    );
  });
});
