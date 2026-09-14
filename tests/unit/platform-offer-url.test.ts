import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  offerUrlMatchClauses,
  platformOfferIdFromUrl,
  urlNamesPlatformOffer,
} from "../../src/lib/platform-offer-url";

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

describe("platformOfferIdFromUrl (#1036)", () => {
  it("reads the id off the canonical address, a slug and a trailing slash", () => {
    assert.equal(platformOfferIdFromUrl("https://allegro.pl/oferta/8795065609"), "8795065609");
    assert.equal(
      platformOfferIdFromUrl("https://allegro.pl/oferta/polska-1918-mi-1-8795065609"),
      "8795065609"
    );
    assert.equal(platformOfferIdFromUrl("https://allegro.pl/oferta/8795065609/"), "8795065609");
  });

  it("drops the tracking a mail adds, in the query and in the fragment", () => {
    assert.equal(
      platformOfferIdFromUrl("https://allegro.pl/oferta/mi-1-8795065609?utm_source=mail&bi_s=ads"),
      "8795065609"
    );
    assert.equal(platformOfferIdFromUrl("https://allegro.pl/oferta/mi-1-8795065609#opis"), "8795065609");
  });

  it("prefers the offerId parameter to a product slug that happens to end in digits", () => {
    assert.equal(
      platformOfferIdFromUrl("https://allegro.pl/produkt/znaczki-123456789012?offerId=8795065609"),
      "8795065609"
    );
    assert.equal(
      platformOfferIdFromUrl("https://allegro.pl/produkt/x?a=1&offerId=8795065609&b=2"),
      "8795065609"
    );
  });

  it("names nothing where no id sits at a boundary", () => {
    assert.equal(platformOfferIdFromUrl("https://allegro.pl/kategoria/znaczki"), null);
    // The digits are inside a word, not after a separator.
    assert.equal(platformOfferIdFromUrl("https://example.com/lot42"), null);
    assert.equal(platformOfferIdFromUrl(""), null);
  });

  it("answers exactly the id the stored-address rule would find the same link under", () => {
    // The point of reading it at the same boundaries: whatever id this returns, a lot storing the
    // link is found under it — and a stored address never matches a shorter id sitting inside it.
    for (const url of [
      "https://allegro.pl/oferta/8795065609",
      "https://allegro.pl/oferta/polska-1918-mi-1-8795065609",
      "https://allegro.pl/oferta/8795065609?bi_s=ads",
      "https://allegro.pl/produkt/abc-def?offerId=8795065609",
    ]) {
      const id = platformOfferIdFromUrl(url);
      assert.ok(id, `no id read out of ${url}`);
      assert.equal(urlNamesPlatformOffer(url, id), true, url);
    }
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
