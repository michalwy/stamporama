import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { extractColnect, matchesColnectUrl, parseCatalogCodes } from "./parse";

// Fixture mirrors a real Colnect stamp list page: div.pl-it cards, .ibox[data-xid] item-IDs, and a
// "Catalog codes:" dt→dd with <strong>Abbr:</strong>Value pairs. Covers PL prefixes, an Unlisted
// value to skip, a suffix/range/block kept verbatim, and a card whose id comes only from the link.
const FIXTURE = `
<html><body>
  <div class="pl-it">
    <div class="ibox" data-xid="3690001">
      <img src="https://i.colnect.net/f/3690/001/Foo.jpg" alt="Foo">
    </div>
    <a href="/en/stamps/stamp/3690001-Foo/">Poland 1998 Foo</a>
    <dl>
      <dt>Catalog codes:</dt>
      <dd><strong>Mi:</strong>PL 3690, <strong>Sn:</strong>PL 3382</dd>
    </dl>
  </div>

  <div class="pl-it">
    <div class="ibox" data-xid="3701002">
      <img data-src="https://i.colnect.net/f/3701/002/Bar.jpg" src="data:image/gif;base64,R0lGOD" alt="Bar">
    </div>
    <a href="/en/stamps/stamp/3701002-Bar/">Poland 1998 Bar</a>
    <dl>
      <dt>Catalog codes:</dt>
      <dd><strong>Mi:</strong>PL 3701y, <strong>Sn:</strong>Unlisted, <strong>Yt:</strong>BL132</dd>
    </dl>
  </div>

  <div class="pl-it">
    <a href="/en/stamps/stamp/778899-Baz/">Baz</a>
    <dl>
      <dt>Catalog codes:</dt>
      <dd><strong>Mi:</strong>PL 3706-3711</dd>
    </dl>
  </div>

  <div class="pl-it">
    <div class="ibox" data-xid="999"></div>
    <a href="/en/stamps/stamp/999-NoCodes/">No codes</a>
    <dl><dt>Issued on:</dt><dd>1998</dd></dl>
  </div>
</body></html>`;

function doc() {
  return parseHTML(FIXTURE).document as unknown as Document;
}

describe("matchesColnectUrl", () => {
  it("accepts Colnect stamp list pages (any locale/subdomain)", () => {
    assert.equal(matchesColnectUrl("https://colnect.com/en/stamps/list/country/POL"), true);
    assert.equal(matchesColnectUrl("https://www.colnect.com/pl/stamps/year/1998"), true);
  });
  it("rejects non-Colnect and non-stamp pages", () => {
    assert.equal(matchesColnectUrl("https://example.com/en/stamps/list"), false);
    assert.equal(matchesColnectUrl("https://colnect.com/en/coins/list"), false);
    assert.equal(matchesColnectUrl("not a url"), false);
  });
});

describe("parseCatalogCodes", () => {
  it("splits Abbr:Value pairs and keeps values verbatim", () => {
    const dd = doc().querySelectorAll("div.pl-it")[0].querySelector("dd")!;
    assert.deepEqual(parseCatalogCodes(dd), [
      { catalog: "Mi", number: "PL 3690" },
      { catalog: "Sn", number: "PL 3382" },
    ]);
  });
  it("skips Unlisted and preserves suffixes/blocks", () => {
    const dd = doc().querySelectorAll("div.pl-it")[1].querySelector("dd")!;
    assert.deepEqual(parseCatalogCodes(dd), [
      { catalog: "Mi", number: "PL 3701y" },
      { catalog: "Yt", number: "BL132" },
    ]);
  });
});

describe("extractColnect", () => {
  it("extracts each card, filtering those with no id or no refs", () => {
    const items = extractColnect(doc());
    assert.equal(items.length, 3); // the "No codes" card is dropped

    assert.deepEqual(items[0], {
      platformItemId: "3690001",
      name: "Poland 1998 Foo",
      catalogRefs: [
        { catalog: "Mi", number: "PL 3690" },
        { catalog: "Sn", number: "PL 3382" },
      ],
      imageUrl: "https://i.colnect.net/f/3690/001/Foo.jpg",
    });

    // A lazy-loaded card keeps its real URL in data-src behind an inline placeholder in src.
    assert.equal(items[1].imageUrl, "https://i.colnect.net/f/3701/002/Bar.jpg");

    // Item-ID falls back to the stamp-page link when there is no data-xid; range kept verbatim.
    assert.equal(items[2].platformItemId, "778899");
    assert.deepEqual(items[2].catalogRefs, [{ catalog: "Mi", number: "PL 3706-3711" }]);
    assert.equal(items[2].imageUrl, undefined, "a card with no image simply has none");
  });
});
