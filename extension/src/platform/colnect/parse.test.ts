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

// A single stamp's page. Structure taken verbatim from a real one: the whole item is itself wrapped
// in div.pl-it, the main stamp's codes are spelled out in full ("Michel PL 389") with no colon, and
// the minor variants sit in .nested_items li[data-id] using the same abbreviated markup as a list
// page. Includes an Unlisted variant code, a value containing a space ("PL 347a B1"), and lazy
// images with an inline placeholder in src.
const STAMP_PAGE = `
<html><body>
  <div class="pl-it">
    <h1>Stamp catalog : Stamp › <span id="name">Romuald Traugutt surcharge 5zł on 25gr</span></h1>
    <div id="item_pics_row">
      <img src="//i.colnect.net/f/7468/104/Main.jpg" alt="Romuald Traugutt surcharge 5zł on 25gr">
    </div>
    <div class="i_d"><dl>
      <dt>Country:</dt><dd><a href="/en/stamps/years/country/172-Poland">Poland</a></dd>
      <dt>Issued on:</dt><dd><a href="/en/stamps/countries/year/1945">1945</a>-01-22</dd>
      <dt>Catalog codes:</dt>
      <dd><strong>Michel</strong> PL 389<br><strong>Stamp Number</strong> PL 362<br><strong>Polish Stamps Catalog (Fischer)</strong> PL 347a</dd>
    </dl></div>

    <div id="minorvariants" class="year_variants minor_variants nested_items"><ul>
      <li id="v1133075" data-id="1133075">
        <div class="variant_row">
          <div class="st_codes"><strong>Mi:</strong>PL 389U<br><strong>Sg:</strong>PL 507b<br><strong>Pol:</strong>PL 347nz</div>
          <div class="variant_pics st_pictures"><span class="item_z_pic_lazy">
            <img class="lzy" data-src="//i.colnect.net/t/8240/676/V1.jpg" src="data:image/gif;base64,R0lGOD">
          </span></div>
          <div class="st_diff"><div class="i_d"><dl>
            <dt>Colors:</dt><dd><a href="#">Grey red</a></dd>
            <dt>Perforation:</dt><dd><a href="#">Imperforate</a></dd>
          </dl></div></div>
          <div class="variants_more"><a href="https://colnect.com/en/stamps/stamp/1133075-X-Poland">More details</a></div>
        </div>
        <ul class="oth_inv"></ul>
      </li>
      <li id="v1641582" data-id="1641582">
        <div class="variant_row">
          <div class="st_codes"><strong>Pol:</strong>PL 347a B10<br><strong>Mi:</strong>Unlisted</div>
          <div class="variant_pics st_pictures"><span class="item_z_pic_lazy">
            <img class="lzy" data-src="//i.colnect.net/t/23130/423/V2.jpg" src="data:image/gif;base64,R0lGOD">
          </span></div>
          <div class="st_diff"><div class="i_d"><dl>
            <dt>Description:</dt><dd class="item_description">Big spot above the right eye</dd>
          </dl></div></div>
          <div class="variants_more"><a href="https://colnect.com/en/stamps/stamp/1641582-X-Poland">More details</a></div>
        </div>
      </li>
      <li id="vnope" data-id="555000">
        <div class="variant_row"><div class="st_codes"></div></div>
      </li>
    </ul></div>
  </div>
</body></html>`;

function stampPageDoc() {
  return parseHTML(STAMP_PAGE).document as unknown as Document;
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

describe("extractColnect on a single stamp's page", () => {
  it("extracts the minor variants and skips the main stamp", () => {
    const items = extractColnect(stampPageDoc());

    // Two variants with codes. The main stamp is absent: its codes are written with full catalog
    // names and no colon, which the abbreviation mapping can't key off anyway. The third variant
    // has an empty .st_codes and is dropped.
    assert.equal(items.length, 2);
    assert.ok(
      !items.some((i) => i.platformItemId === "136748"),
      "the main stamp is not extracted from a stamp page"
    );

    assert.deepEqual(items[0], {
      platformItemId: "1133075",
      name: "Romuald Traugutt surcharge 5zł on 25gr — Grey red",
      catalogRefs: [
        { catalog: "Mi", number: "PL 389U" },
        { catalog: "Sg", number: "PL 507b" },
        { catalog: "Pol", number: "PL 347nz" },
      ],
      imageUrl: "//i.colnect.net/t/8240/676/V1.jpg",
      country: "Poland",
      issuedYear: 1945,
    });

    // Country and issue year come from the stamp page: a variant states neither of its own.
    assert.equal(items[0].country, "Poland");
    assert.equal(items[0].issuedYear, 1945);

    // Unlisted is skipped, and a value containing a space survives intact.
    assert.deepEqual(items[1].catalogRefs, [{ catalog: "Pol", number: "PL 347a B10" }]);
    assert.equal(items[1].name, "Romuald Traugutt surcharge 5zł on 25gr — Big spot above the right eye");
    assert.equal(items[1].imageUrl, "//i.colnect.net/t/23130/423/V2.jpg");
  });

  it("a stamp page URL is recognised", () => {
    assert.equal(
      matchesColnectUrl("https://colnect.com/en/stamps/stamp/136748-Romuald_Traugutt-Poland"),
      true
    );
  });
});
