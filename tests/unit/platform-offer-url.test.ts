import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerUrlMatchClauses, urlNamesPlatformOffer } from "../../src/lib/platform-offer-url";

describe("urlNamesPlatformOffer", () => {
  it("matches the canonical offer address", () => {
    assert.equal(urlNamesPlatformOffer("https://allegro.pl/oferta/8795065609", "8795065609"), true);
  });

  it("matches a slug address, where the id is the last segment of the name", () => {
    assert.equal(
      urlNamesPlatformOffer("https://allegro.pl/oferta/polska-1918-mi-1-8795065609", "8795065609"),
      true
    );
  });

  it("matches a product page carrying the offer as a parameter", () => {
    assert.equal(
      urlNamesPlatformOffer("https://allegro.pl/produkt/abc-def?offerId=8795065609", "8795065609"),
      true
    );
  });

  it("matches an address with a query after the id", () => {
    assert.equal(
      urlNamesPlatformOffer("https://allegro.pl/oferta/8795065609?bi_s=ads", "8795065609"),
      true
    );
    assert.equal(
      urlNamesPlatformOffer("https://allegro.pl/oferta/mi-1-8795065609?bi_s=ads", "8795065609"),
      true
    );
  });

  it("never matches an id sitting inside a longer number", () => {
    // The whole reason the rule is written at boundaries: this listing is a different auction.
    assert.equal(urlNamesPlatformOffer("https://allegro.pl/oferta/18795065609", "8795065609"), false);
    assert.equal(
      urlNamesPlatformOffer("https://allegro.pl/produkt/x?offerId=18795065609", "8795065609"),
      false
    );
  });

  it("is false for a missing url or a missing id", () => {
    assert.equal(urlNamesPlatformOffer(null, "8795065609"), false);
    assert.equal(urlNamesPlatformOffer(undefined, "8795065609"), false);
    assert.equal(urlNamesPlatformOffer("https://allegro.pl/oferta/8795065609", ""), false);
  });
});

describe("offerUrlMatchClauses", () => {
  it("states the same five shapes the in-memory test answers", () => {
    const clauses = offerUrlMatchClauses("42");
    assert.deepEqual(clauses, [
      { url: { endsWith: "/42" } },
      { url: { endsWith: "-42" } },
      { url: { contains: "/42?" } },
      { url: { contains: "-42?" } },
      { url: { contains: "offerId=42" } },
    ]);
  });
});
