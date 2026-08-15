import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { removeLotMarker, renderLotMarker } from "./lot-marker";
import { removeOfferMarker, renderOfferMarker } from "./offer-marker";

// The in-page link from an auction to the lot tracking it (#575). What is worth testing here is not
// how the chip looks but that the page can be handed the answer twice and still carry exactly one
// chip, that it says which lot in Stamporama's own words, and that it shares the corner with the
// offer-side chip (#466) rather than covering it.

const LOT = {
  url: "https://stamps.example/c/main/auctions/sales/cms7q5dtf001f69mkczj8robk?lot=cms7q5dtf001g69mk1t8xs2vd",
  auctionLotNo: 12,
  title: "Poland 1960 — Zodiac, used",
  saleName: "philatelist_pl — Allegro",
  outcome: "pending",
};

const OFFER = {
  url: "https://stamps.example/c/main/offers/cms7q5dtf001f69mkczj8robk",
  offerNo: 42,
  title: "Poland 1960 — Zodiac, MNH",
  state: "active",
};

function emptyDoc(): Document {
  return parseHTML("<html><body><h1>Some Allegro auction</h1></body></html>")
    .document as unknown as Document;
}

function markers(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("[data-stamporama-lot]"));
}

describe("renderLotMarker", () => {
  it("links to the lot the instance named, in a new tab", () => {
    const doc = emptyDoc();
    const a = renderLotMarker(doc, LOT, null)!;

    assert.equal(a.getAttribute("href"), LOT.url);
    assert.equal(a.getAttribute("target"), "_blank");
    assert.equal(a.getAttribute("rel"), "noreferrer noopener");
    assert.equal(markers(doc).length, 1);
  });

  it("names the lot by its short number, the sale it sits in, and how it went", () => {
    const doc = emptyDoc();
    const a = renderLotMarker(doc, LOT, null)!;

    assert.match(a.textContent ?? "", /Lot #12/);
    assert.match(a.textContent ?? "", /philatelist_pl/);
    // The app's own word for a lot still in play — never the `pending` the wire carries.
    assert.match(a.textContent ?? "", /Open/);
    assert.doesNotMatch(a.textContent ?? "", /pending/);
  });

  it("says how a closed lot ended", () => {
    const doc = emptyDoc();
    const a = renderLotMarker(doc, { ...LOT, outcome: "lost" }, null)!;
    assert.match(a.textContent ?? "", /Lost/);
  });

  it("prints an outcome this build has never heard of rather than dropping it", () => {
    const doc = emptyDoc();
    const a = renderLotMarker(doc, { ...LOT, outcome: "settled" }, null)!;
    assert.match(a.textContent ?? "", /settled/);
  });

  it("replaces its own chip rather than stacking a second one", () => {
    const doc = emptyDoc();
    renderLotMarker(doc, LOT, null);
    renderLotMarker(doc, { ...LOT, auctionLotNo: 13 }, null);

    const found = markers(doc);
    assert.equal(found.length, 1);
    assert.match(found[0].textContent ?? "", /Lot #13/);
  });

  it("leaves the page alone otherwise", () => {
    const doc = emptyDoc();
    renderLotMarker(doc, LOT, null);
    assert.equal(doc.querySelector("h1")?.textContent, "Some Allegro auction");
  });
});

describe("removeLotMarker", () => {
  it("takes the chip away and is a no-op on a page without one", () => {
    const doc = emptyDoc();
    renderLotMarker(doc, LOT, null);
    removeLotMarker(doc);
    assert.equal(markers(doc).length, 0);
    removeLotMarker(doc);
    assert.equal(markers(doc).length, 0);
  });
});

// ── The corner both answers share (#466 + #575) ──────────────────────────────
//
// A listing is in practice one or the other — nobody bids on their own auction — but neither answer
// says so, and two chips each claiming the bottom-right corner would leave the lower one unreadable.

describe("the marker stack", () => {
  it("holds both chips at once, each in one copy", () => {
    const doc = emptyDoc();
    renderOfferMarker(doc, OFFER, null);
    renderLotMarker(doc, LOT, null);

    const stacks = Array.from(doc.querySelectorAll("[data-stamporama-markers]"));
    assert.equal(stacks.length, 1);
    assert.equal(stacks[0].children.length, 2);
    assert.equal(markers(doc).length, 1);
    assert.equal(doc.querySelectorAll("[data-stamporama-offer]").length, 1);
  });

  it("goes away with the last chip, leaving the page as it was found", () => {
    const doc = emptyDoc();
    renderOfferMarker(doc, OFFER, null);
    renderLotMarker(doc, LOT, null);

    removeOfferMarker(doc);
    assert.equal(doc.querySelectorAll("[data-stamporama-markers]").length, 1);
    removeLotMarker(doc);
    assert.equal(doc.querySelectorAll("[data-stamporama-markers]").length, 0);
  });
});
