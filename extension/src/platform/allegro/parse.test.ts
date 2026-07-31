import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  allegroListingUrl,
  allegroOfferId,
  captureAllegroLot,
  matchesAllegroListingUrl,
  parseAllegroAmount,
  parseAllegroBidderCount,
} from "./parse";

// The fixtures below are the real page's own JSON, trimmed to the keys the module reads — captured
// from a live Licytacja and a live Kup teraz offer. Everything else on an Allegro offer page is
// hashed class names, which is exactly why nothing here matches on markup.

function auctionPage(overrides: { bidding?: string; seller?: string; ld?: string } = {}): Document {
  const bidding =
    overrides.bidding ??
    `{"price":{"priceLabel":"Aktualna cena"},"biddingSection":{
        "currentPrice":{"formatted":"107,00 zł","currency":"PLN","label":"Aktualna cena"},
        "popularityLabel":"6 osób licytuje","visible":true,
        "endingDate":"2026-08-06T17:08:00Z",
        "formattedEndingDate":"(czw., 6 sie 2026, 19:08:00)",
        "endingDateLabel":"6 dni do końca licytacji","offerId":"18795065609",
        "nextPrice":"112.00","stepPrice":{"formatted":"5,00 zł","rawAmount":"5.00"}}}`;
  const seller =
    overrides.seller ??
    `{"sellerName":"Philkam_znaczki","sellerRating":"99,8%","isPrivateSeller":false,"isSuperSeller":true}`;
  const ld =
    overrides.ld ??
    `{"@context":"https://schema.org","@type":"Product",
      "name":"Fi 348-357, Wyzwolenie 10 miast, 1945r. E0177","sku":"18795065609",
      "offers":{"@type":"Offer","priceValidUntil":"2026-08-06T17:08:00Z"}}`;
  return parseHTML(`
    <html><body>
      <script type="application/json">{"loginUrl":"/logowanie"}</script>
      <script type="application/json">${bidding}</script>
      <script type="application/json">${seller}</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"x"}</script>
      <script type="application/ld+json">${ld}</script>
    </body></html>
  `).document as unknown as Document;
}

const AUCTION_URL =
  "https://allegro.pl/oferta/fi-348-357-wyzwolenie-10-miast-1945r-e0177-18795065609";

describe("matchesAllegroListingUrl", () => {
  it("takes offer and product pages on allegro.pl", () => {
    assert.equal(matchesAllegroListingUrl(AUCTION_URL), true);
    assert.equal(matchesAllegroListingUrl("https://allegro.pl/produkt/some-slug-uuid"), true);
    assert.equal(matchesAllegroListingUrl("https://www.allegro.pl/oferta/x-123456"), true);
  });

  it("leaves everything else alone", () => {
    assert.equal(matchesAllegroListingUrl("https://allegro.pl/kategoria/filatelistyka-76"), false);
    // A different marketplace that merely shares part of the name.
    assert.equal(matchesAllegroListingUrl("https://allegrolokalnie.pl/oferta/x"), false);
    assert.equal(matchesAllegroListingUrl("not a url"), false);
  });
});

describe("allegroOfferId", () => {
  it("reads the trailing digits of an offer slug", () => {
    assert.equal(allegroOfferId(AUCTION_URL), "18795065609");
  });

  it("reads the offerId parameter of a product page", () => {
    assert.equal(
      allegroOfferId("https://allegro.pl/produkt/some-slug-uuid?offerId=18795065609&x=1"),
      "18795065609"
    );
  });

  it("is null when the address names no offer", () => {
    assert.equal(allegroOfferId("https://allegro.pl/produkt/some-slug-uuid"), null);
    assert.equal(allegroOfferId("https://allegro.pl/kategoria/filatelistyka-76"), null);
  });

  it("records the canonical address, not the slug it was reached by", () => {
    assert.equal(allegroListingUrl("18795065609"), "https://allegro.pl/oferta/18795065609");
  });
});

describe("parseAllegroAmount", () => {
  it("reads a Polish-formatted price", () => {
    assert.equal(parseAllegroAmount("107,00 zł"), "107.00");
    assert.equal(parseAllegroAmount("1 250,50 zł"), "1250.50");
    assert.equal(parseAllegroAmount("40 zł"), "40");
  });

  it("is null for anything that is not a figure", () => {
    assert.equal(parseAllegroAmount(undefined), null);
    assert.equal(parseAllegroAmount("brak ofert"), null);
  });
});

describe("parseAllegroBidderCount", () => {
  it("counts bidders", () => {
    assert.equal(parseAllegroBidderCount("6 osób licytuje"), 6);
    assert.equal(parseAllegroBidderCount("1 osoba licytuje"), 1);
  });

  it("ignores a label about something other than bidding", () => {
    // What a fixed-price offer prints in the very same field.
    assert.equal(parseAllegroBidderCount("9 osób kupiło tę ofertę"), null);
    assert.equal(parseAllegroBidderCount(null), null);
  });
});

describe("captureAllegroLot", () => {
  it("reads a live auction", () => {
    const result = captureAllegroLot(auctionPage(), AUCTION_URL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.lot, {
      platformOfferId: "18795065609",
      url: "https://allegro.pl/oferta/18795065609",
      title: "Fi 348-357, Wyzwolenie 10 miast, 1945r. E0177",
      lotNo: "18795065609",
      sellerName: "Philkam_znaczki",
      endsAt: "2026-08-06T17:08:00Z",
      startingPrice: null,
      currentBid: "107.00",
      currency: "PLN",
      bidderCount: 6,
    });
  });

  it("records an unbid auction's figure as an opening price, not as a bid", () => {
    // A lot nobody has bid on costs nothing whatever it opens at (#351), and Allegro prints the
    // minimum under the same "Aktualna cena" label.
    const doc = auctionPage({
      bidding: `{"biddingSection":{"currentPrice":{"formatted":"20,00 zł","currency":"PLN"},
        "popularityLabel":null,"visible":true,"endingDate":"2026-08-06T17:08:00Z"}}`,
    });
    const result = captureAllegroLot(doc, AUCTION_URL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.startingPrice, "20.00");
    assert.equal(result.lot.currentBid, null);
    assert.equal(result.lot.bidderCount, null);
  });

  it("refuses a fixed-price offer, naming what the page is", () => {
    const doc = auctionPage({
      bidding: `{"biddingSection":{"currentPrice":{"formatted":"158,00 zł","currency":"PLN"},
        "popularityLabel":"9 osób kupiło tę ofertę","visible":false,"endingDate":null}}`,
    });
    const result = captureAllegroLot(doc, AUCTION_URL);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-an-auction");
  });

  it("refuses a page with no bidding section at all", () => {
    const doc = parseHTML("<html><body><p>nothing here</p></body></html>")
      .document as unknown as Document;
    const result = captureAllegroLot(doc, AUCTION_URL);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-an-auction");
  });

  it("falls back to the JSON-LD sku when the address names no offer", () => {
    const result = captureAllegroLot(auctionPage(), "https://allegro.pl/produkt/some-slug-uuid");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.platformOfferId, "18795065609");
    // The number quoted on a lot is the same one, so a listing reached through a product page still
    // carries the number the collector would read off it.
    assert.equal(result.lot.lotNo, "18795065609");
  });

  it("has no title and no seller rather than an invented one", () => {
    const doc = auctionPage({ seller: `{"unrelated":true}`, ld: `{"@type":"Thing","name":"x"}` });
    const result = captureAllegroLot(doc, AUCTION_URL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.title, null);
    assert.equal(result.lot.sellerName, null);
  });

  it("survives an unparseable JSON blob beside the ones it needs", () => {
    const doc = parseHTML(`
      <html><body>
        <script type="application/json">{ not json at all </script>
        <script type="application/json">{"biddingSection":{"currentPrice":{"formatted":"5,00 zł","currency":"PLN"},
          "popularityLabel":"2 osoby licytują","visible":true,"endingDate":"2026-09-01T10:00:00Z"}}</script>
      </body></html>
    `).document as unknown as Document;
    const result = captureAllegroLot(doc, AUCTION_URL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.currentBid, "5.00");
    assert.equal(result.lot.bidderCount, 2);
  });
});
