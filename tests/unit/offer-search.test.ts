import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOfferAddressSearch } from "../../src/lib/offer-search";

/** How the offers list's search box (#465) reads an entry that might name a listing's own address:
 * a pasted marketplace link, or the offer number a sale notification quotes. */
describe("offer address search", () => {
  it("reads a pasted link as host + path, dropping what two copies of one link differ in", () => {
    for (const entry of [
      "https://allegro.pl/oferta/znaczek-16123456",
      "http://www.allegro.pl/oferta/znaczek-16123456/",
      "https://allegro.pl/oferta/znaczek-16123456?utm_source=newsletter#photos",
      "allegro.pl/oferta/znaczek-16123456",
    ]) {
      assert.deepEqual(
        parseOfferAddressSearch(entry),
        { address: "allegro.pl/oferta/znaczek-16123456", listingId: "16123456" },
        entry
      );
    }
  });

  it("carries no listing id when the address ends in no number", () => {
    assert.deepEqual(parseOfferAddressSearch("https://www.colnect.com/en/stamps/market/sale/ab12"), {
      address: "colnect.com/en/stamps/market/sale/ab12",
      listingId: null,
    });
  });

  it("reads a bare number as a listing id, above the four-digit floor", () => {
    assert.deepEqual(parseOfferAddressSearch("16123456"), {
      address: null,
      listingId: "16123456",
    });
    // Below it, a run of digits is far more likely a catalog number — and the offer's own short
    // number (#416) is matched separately.
    assert.deepEqual(parseOfferAddressSearch("865"), { address: null, listingId: null });
  });

  it("is not an address at all for a phrase, a bare host, or a foreign scheme", () => {
    for (const entry of [
      "",
      "   ",
      "Poland 1960 birds",
      "allegro.pl",
      "mint never hinged",
      "javascript:alert(1)",
      "ftp://allegro.pl/oferta/1",
    ]) {
      assert.deepEqual(parseOfferAddressSearch(entry), { address: null, listingId: null }, entry);
    }
  });
});
