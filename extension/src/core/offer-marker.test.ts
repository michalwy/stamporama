import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  anchorNeedsLink,
  offerAnchors,
  removeOfferMarker,
  renderInlineOfferLink,
  renderOfferMarker,
} from "./offer-marker";

// The in-page link from a listing to the offer behind it (#466). What is worth testing here is not
// how the chip looks but that a page can be handed the answer twice — a re-check, a second load of
// the same document — and still carry exactly one link, pointing where the instance said.

const TARGET = {
  url: "https://stamps.example/c/main/offers/cms7q5dtf001f69mkczj8robk",
  offerNo: 42,
  title: "Poland 1960 — Zodiac, MNH",
  state: "active",
};

function emptyDoc(): Document {
  return parseHTML("<html><body><h1>Some Allegro listing</h1></body></html>")
    .document as unknown as Document;
}

function markers(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("[data-stamporama-offer]"));
}

describe("renderOfferMarker", () => {
  it("links to the offer the instance named, in a new tab", () => {
    const doc = emptyDoc();
    const a = renderOfferMarker(doc, TARGET, null)!;

    assert.equal(a.getAttribute("href"), TARGET.url);
    assert.equal(a.getAttribute("target"), "_blank");
    assert.equal(a.getAttribute("rel"), "noreferrer noopener");
    assert.equal(markers(doc).length, 1);
  });

  it("names the offer by its short number, its state and its title", () => {
    const doc = emptyDoc();
    const a = renderOfferMarker(doc, TARGET, null)!;

    assert.match(a.textContent ?? "", /Offer #42/);
    assert.match(a.textContent ?? "", /active/);
    assert.match(a.textContent ?? "", /Zodiac/);
  });

  it("draws the mark when one is passed, and nothing when it is not", () => {
    const withIcon = emptyDoc();
    renderOfferMarker(withIcon, TARGET, "data:image/png;base64,AAAA");
    assert.equal(withIcon.querySelectorAll("img").length, 1);

    const without = emptyDoc();
    renderOfferMarker(without, TARGET, null);
    assert.equal(without.querySelectorAll("img").length, 0);
  });

  it("replaces its own chip rather than stacking a second one", () => {
    const doc = emptyDoc();
    renderOfferMarker(doc, TARGET, null);
    renderOfferMarker(doc, { ...TARGET, offerNo: 43 }, null);

    const found = markers(doc);
    assert.equal(found.length, 1);
    assert.match(found[0].textContent ?? "", /Offer #43/);
  });

  it("leaves the page alone otherwise", () => {
    const doc = emptyDoc();
    renderOfferMarker(doc, TARGET, null);
    assert.equal(doc.querySelector("h1")?.textContent, "Some Allegro listing");
  });
});

describe("removeOfferMarker", () => {
  it("takes the chip away and is a no-op on a page without one", () => {
    const doc = emptyDoc();
    renderOfferMarker(doc, TARGET, null);
    removeOfferMarker(doc);
    assert.equal(markers(doc).length, 0);
    removeOfferMarker(doc);
    assert.equal(markers(doc).length, 0);
  });
});

// ── The inline link beside the marketplace's own number (#466) ───────────────
//
// This one runs over a **list** that redraws itself — Allegro's assortment table re-renders on every
// filter, sort and page change, reusing its row elements. So what is tested is where the link lands
// in a row shaped like a real one, and that a re-scan of a redrawn table never doubles a link and
// never leaves one pointing at the row's previous listing.

const LISTING = "18812112102";
const OTHER_LISTING = "18804446728";

/** A row as *Mój asortyment* draws one: the title as a link to the listing, and the listing's own
 *  number on a line of its own below it. Class names are the hashed ones, and nothing reads them. */
function rowDoc(href: string, listingNo: string | null = LISTING): Document {
  const number = listingNo
    ? `<div class="mpof_ki mwdn_1"><div class="m3h2_8"><span class="mgmw_ag">nr: </span><span class="_b4f97_bk6uO">${listingNo}</span></div></div>`
    : "";
  return parseHTML(
    `<html><body><table><tr data-cy="${listingNo ?? ""}"><td><div class="mpof_ki myre_8v"><a class="mli8_k4" href="${href}">Polska, 1966, Fi Ark. 1541-2, ** [A639]</a></div>${number}</td><td>2,00 zł</td></tr></table></body></html>`
  ).document as unknown as Document;
}

function anchorOf(doc: Document): HTMLAnchorElement {
  return doc.querySelector("a")! as unknown as HTMLAnchorElement;
}

function links(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("[data-stamporama-offer-link]"));
}

describe("renderInlineOfferLink", () => {
  it("lands after the marketplace's own number, where the row says which listing it is", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const link = renderInlineOfferLink(anchorOf(doc), LISTING, TARGET, null)!;

    assert.equal(link.previousElementSibling?.textContent, LISTING);
    assert.equal(link.getAttribute("href"), TARGET.url);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.match(link.textContent ?? "", /Offer #42/);
    assert.match(link.getAttribute("title") ?? "", /Zodiac/);
    assert.match(link.getAttribute("title") ?? "", /active/);
  });

  it("occupies no box of its own — a table cell is laid out by the marketplace", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const style = renderInlineOfferLink(anchorOf(doc), LISTING, TARGET, null)!.getAttribute("style")!;

    assert.match(style, /all: ?initial/);
    assert.doesNotMatch(style, /border|background|padding/);
  });

  it("falls back to the title link where a row prints no number", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`, null);
    const anchor = anchorOf(doc);
    const link = renderInlineOfferLink(anchor, LISTING, TARGET, null)!;

    assert.equal(anchor.nextElementSibling, link);
  });

  it("records a listing that matched nothing, and draws nothing for it", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/somebody-elses-${LISTING}`);
    const anchor = anchorOf(doc);

    assert.equal(renderInlineOfferLink(anchor, LISTING, null, null), null);
    assert.equal(links(doc).length, 0);
    assert.equal(anchorNeedsLink(anchor, LISTING), false);
  });

  it("answers each listing once, however often the list is re-scanned", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const anchor = anchorOf(doc);

    assert.equal(anchorNeedsLink(anchor, LISTING), true);
    renderInlineOfferLink(anchor, LISTING, TARGET, null);
    assert.equal(anchorNeedsLink(anchor, LISTING), false);
    assert.equal(links(doc).length, 1);
  });

  it("follows a reused row to its new listing rather than keeping the old link", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const anchor = anchorOf(doc);
    renderInlineOfferLink(anchor, LISTING, TARGET, null);

    // What paging the table does: the same row element, pointing at another listing.
    anchor.setAttribute("href", `https://allegro.pl/oferta/polska-1971-${OTHER_LISTING}`);
    assert.equal(anchorNeedsLink(anchor, OTHER_LISTING), true);

    renderInlineOfferLink(anchor, OTHER_LISTING, { ...TARGET, offerNo: 43 }, null);
    const found = links(doc);
    assert.equal(found.length, 1);
    assert.match(found[0].textContent ?? "", /Offer #43/);
  });

  it("takes the link away when a reused row turns out to be somebody else's", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const anchor = anchorOf(doc);
    renderInlineOfferLink(anchor, LISTING, TARGET, null);

    renderInlineOfferLink(anchor, OTHER_LISTING, null, null);
    assert.equal(links(doc).length, 0);
  });

  it("draws the mark when one is passed", () => {
    const doc = rowDoc(`https://allegro.pl/oferta/polska-1966-${LISTING}`);
    const link = renderInlineOfferLink(anchorOf(doc), LISTING, TARGET, "data:image/png;base64,AAAA")!;
    assert.equal(link.querySelectorAll("img").length, 1);
  });
});

describe("offerAnchors", () => {
  it("finds the page's links, and nothing else", () => {
    const doc = parseHTML(
      `<html><body><a href="https://allegro.pl/oferta/x-1">one</a><a>no address</a><span>text</span><a href="/moje-allegro">two</a></body></html>`
    ).document as unknown as Document;

    assert.equal(offerAnchors(doc).length, 2);
  });
});
