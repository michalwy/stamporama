import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  capturePhilasearchLot,
  matchesPhilasearchLotUrl,
  parsePhilasearchAmount,
  parsePhilasearchClose,
  philasearchLotId,
  philasearchLotUrl,
} from "./parse";

// The fixtures below are live philasearch.com lot pages as the browser renders them (2026-09-15),
// trimmed to the elements the module reads and the ones around them that could be mistaken for
// them: a Christoph Gärtner lot the collector had bid on, a Philatino lot in Buenos Aires time, a
// Robert A. Siegel lot with an estimate above its opening bid, the German page of the Gärtner lot,
// and an after-auction sale. Figures arrive already localised by the page's scripts (`150 EUR`),
// which is why nothing here matches on wording.

const GAERTNER_URL = "https://www.philasearch.com/en/cat/13320_9081/lot/9081-A66-9850";

interface PageParts {
  saleName?: string;
  heading?: string;
  category?: string;
  lotBlock?: string;
  description?: string;
  house?: string;
  purchase: string;
}

function page(parts: PageParts): Document {
  const lotBlock = parts.lotBlock ?? "9081-A66-9850";
  return parseHTML(`
    <html><body><div class="page">
      <div class="toolbar">
        <div class="grow flex flex-col justify-between">
          <span class="text-lg">${parts.saleName ?? "Christoph Gärtner 66th Auction "}</span>
        </div>
        <div class="shrink text-sm"> Lot Number Search </div>
      </div>
      <div class="grid grid-cols-30 gap-0 md:gap">
        <div class="col-span-30 lg:col-span-7 xl:col-span-6 order-3 lg:order-1">
          <div class="text-sm">
            <div class="hidden" data-modal="onlineDispute"><i class="fas fa-times"></i>
              <h3>Imprint</h3><h3>Auktionhaus Christoph Gärtner GmbH &amp; Co KG</h3>
            </div>
            <div class="hidden" data-modal="right_of_revocation"><i class="fas fa-times"></i>
              <h3>${parts.house ?? "Gärtner Christoph Auktionshaus"}</h3>
            </div>
          </div>
          <div class="text-sm">
            <div class="text-base">Auction Conditions:</div>
            <p>The auctioneer receives a premium of 26.2 % of the hammer price.</p>
          </div>
        </div>
        <div class="col-span-30 lg:col-span-23">
          <div class="flex flex-col gap">
            <div class="flex gap justify-between items-baseline">
              <div><h1 class="text-2xl leading-6"> ${parts.heading ?? "Lot 9850 D"} <span class="text-lg ml-2">${
                parts.category ?? "Poland"
              }</span> </h1></div>
              <div data-lot-block="${lotBlock}" data-order-no="${lotBlock}" class="relative text-warning text-3xl z-10" title="Add to Bookmarks"><i class="fa-star far"></i></div>
            </div>
            <div class="flex gap items-center"></div>
            <div> Description <p class="text-sm">${
              parts.description ??
              "1918/2005, mint and used collection in eight brown Safe albums (from 1980 onwards &quot;dual&quot; hingeless system), well collected throughout from early issues"
            }</p></div>
          </div>
          ${parts.purchase}
        </div>
      </div>
    </div></body></html>
  `).document as unknown as Document;
}

const BID_FORM = `
  <form action="/en/add_cart.php3" method="post" class="flex flex-col gap-2">
    <div class="mt-4"><div>Your maximum bid:</div>
      <div class="flex justify-end items-center">
        <input class="border-r-neutral-400 flex-grow text-right" title="Inputfield for Bid" type="text" name="gebot" placeholder="0,00">
        <div class="bg-gray-300 text-sm self-stretch px-2 flex items-center">EUR</div>
      </div>
    </div>
  </form>`;

const GAERTNER_BID_PLACED = `
  <div id="posdetail-purchase" class="flex min-w-0 w-full flex-col gap-2">
    <div><div class="text-lg">Public Auction</div></div>
    <div> Minimum bid <div class="text-2xl"><div data-localized-number="" data-localized-number-type="currency">150 EUR<br><i>(app. 649 PLN)</i></div></div></div>
    <div></div>
    <div> End date of bidding: </div>
    <div class="font-semibold">Thursday October 15th, 2026, 08:00 <span data-tooltip="" class="has-tip" title="Europe/Berlin GMT +2:00"> CEST</span></div>
    <div>You already placed a bid for this item.<br>If you like to increase your bid, just place another bid.</div>
    <div>Your current bid:</div>
    <div class="text-lg"><span data-localized-number="" data-localized-number-type="currency">150</span><div class="text-sm">EUR</div></div>
    ${BID_FORM}
  </div>`;

const PHILATINO_NOT_BID = `
  <div id="posdetail-purchase" class="flex min-w-0 w-full flex-col gap-2">
    <div><div class="text-lg">Public Auction</div></div>
    <div> Minimum bid <div class="text-2xl"><div data-localized-number="" data-localized-number-type="currency">50.00 USD<br><i style="font-size:smaller">(app. 43 EUR, app. 186 PLN)</i></div></div></div>
    <div></div>
    <div> End date of bidding: </div> Thursday September 17th, 2026, 19:00 <span data-tooltip="" class="has-tip" title="America/Argentina/Buenos Aires GMT -3:00"> -03</span>
    <br> <br> <b>Local Time - Europe/Warsaw</b> <br> Friday September 18th, 2026, 00:00 <span data-tooltip="" class="has-tip" title="Europe/Warsaw GMT +2:00"> CEST</span>
    ${BID_FORM}
  </div>`;

const SIEGEL_ESTIMATE = `
  <div id="posdetail-purchase" class="flex min-w-0 w-full flex-col gap-2">
    <div><div class="text-lg">Public Auction</div> Estimated price <div class="text-lg" data-localized-number=""> 2000.00 - 3000.00 USD </div></div>
    <div> Opening bid <div class="text-2xl"><div data-localized-number="" data-localized-number-type="currency">2,000.00 USD<br><i>(app. 1724 EUR, app. 7457 PLN)</i></div></div></div>
    <div></div>
    <div> End date of bidding: </div>
    <div class="font-semibold">Wednesday September 16th, 2026, 11:00 <span data-tooltip="" class="has-tip" title="Europe/Berlin GMT +2:00"> CEST</span></div>
    ${BID_FORM}
  </div>`;

const GAERTNER_GERMAN = `
  <div id="posdetail-purchase" class="flex min-w-0 w-full flex-col gap-2">
    <div><div class="text-lg">Saalauktion</div></div>
    <div> Ausruf <div class="text-2xl"><div data-localized-number="" data-localized-number-type="currency">150,00 EUR<br><i>(ca. 649 PLN)</i></div></div></div>
    <div></div>
    <div> Ende der Gebotsabgabe: </div>
    <div class="font-semibold">Donnerstag 15.10.2026, 08:00 <span data-tooltip="" class="has-tip" title="Europe/Berlin GMT +2:00"> CEST</span></div>
    <div>Sie haben auf dieses Los bereits ein Gebot abgegeben.</div>
    <div>Ihr aktuelles Gebot:</div>
    <div class="text-lg"><span data-localized-number="" data-localized-number-type="currency">150,00</span><div class="text-sm">EUR</div></div>
    ${BID_FORM}
  </div>`;

const AFTER_AUCTION_SALE = `
  <div id="posdetail-purchase" class="flex min-w-0 w-full flex-col gap-2">
    <div><div class="text-lg">After-Auction-Sale</div></div>
    <div> Minimum bid <div class="text-2xl"><div data-localized-number="" data-localized-number-type="currency">30.00 EUR<br><i>(app. 130 PLN)</i></div></div></div>
    <div></div>
    <div> End of after auction sale: </div>
    <div class="font-semibold">Saturday October 31st, 2026, <span data-tooltip="" class="has-tip" title="Europe/Berlin GMT +1:00"> CET</span></div>
  </div>`;

describe("philasearch lot addresses", () => {
  it("reads the site's own lot id out of a lot page's path", () => {
    assert.equal(philasearchLotId(GAERTNER_URL), "9081-A66-9850");
    assert.equal(
      philasearchLotId("https://philasearch.com/de/cat/13251_35/lot/35-A389-1001?page=2#top"),
      "35-A389-1001"
    );
    assert.equal(matchesPhilasearchLotUrl(GAERTNER_URL), true);
  });

  it("leaves every other page alone", () => {
    assert.equal(matchesPhilasearchLotUrl("https://www.philasearch.com/en/cat/13320_9081/lots"), false);
    assert.equal(matchesPhilasearchLotUrl("https://www.philasearch.com/en/auctions_current.html"), false);
    // A sister site with lots of its own.
    assert.equal(matchesPhilasearchLotUrl("https://www.numissearch.com/en/cat/1_2/lot/2-A1-1"), false);
    assert.equal(matchesPhilasearchLotUrl("not a url"), false);
  });

  it("records the lot page without what browsing appended to it", () => {
    assert.equal(
      philasearchLotUrl("https://philasearch.com/en/cat/13320_9081/lot/9081-A66-9850/?suchtext=poland#x"),
      GAERTNER_URL
    );
  });
});

describe("parsePhilasearchAmount", () => {
  it("reads a figure however the page localised it", () => {
    assert.equal(parsePhilasearchAmount("150 EUR"), "150.00");
    assert.equal(parsePhilasearchAmount("50.00 USD"), "50.00");
    assert.equal(parsePhilasearchAmount("2,000.00 USD"), "2000.00");
    assert.equal(parsePhilasearchAmount("1.500,00 EUR"), "1500.00");
    assert.equal(parsePhilasearchAmount("1 500 CHF"), "1500.00");
    assert.equal(parsePhilasearchAmount("1.500 CHF"), "1500.00");
    assert.equal(parsePhilasearchAmount("150,00"), "150.00");
    assert.equal(parsePhilasearchAmount("12,5"), "12.50");
  });

  it("reads nothing out of a label with no figure", () => {
    assert.equal(parsePhilasearchAmount("EUR"), null);
    assert.equal(parsePhilasearchAmount(null), null);
  });
});

describe("parsePhilasearchClose", () => {
  it("converts a house's wall clock with the offset beside it", () => {
    assert.equal(
      parsePhilasearchClose("Thursday October 15th, 2026, 08:00", "Europe/Berlin GMT +2:00"),
      "2026-10-15T06:00:00.000Z"
    );
    // Buenos Aires closes at 19:00 its time — already the next day in Warsaw.
    assert.equal(
      parsePhilasearchClose(
        "Thursday September 17th, 2026, 19:00",
        "America/Argentina/Buenos Aires GMT -3:00"
      ),
      "2026-09-17T22:00:00.000Z"
    );
    assert.equal(
      parsePhilasearchClose("Donnerstag 15.10.2026, 08:00", "Europe/Berlin GMT +2:00"),
      "2026-10-15T06:00:00.000Z"
    );
  });

  it("reads no close from a date with no time, or a time with no zone", () => {
    assert.equal(parsePhilasearchClose("Saturday October 31st, 2026,", "Europe/Berlin GMT +1:00"), null);
    assert.equal(parsePhilasearchClose("Thursday October 15th, 2026, 08:00", "CEST"), null);
  });
});

describe("capturePhilasearchLot", () => {
  it("reads a lot the collector has bid on: the opening figure, and their own bid as theirs", () => {
    const result = capturePhilasearchLot(page({ purchase: GAERTNER_BID_PLACED }), `${GAERTNER_URL}?rownr=4`);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.lot, {
      platformOfferId: "9081-A66-9850",
      url: GAERTNER_URL,
      title:
        'Poland — 1918/2005, mint and used collection in eight brown Safe albums (from 1980 onwards "dual"…',
      lotNo: "9850",
      sellerName: "Gärtner Christoph Auktionshaus",
      saleName: "Christoph Gärtner 66th Auction",
      endsAt: "2026-10-15T06:00:00.000Z",
      startingPrice: "150.00",
      // A written bid is a proxy maximum, never the price the lot stands at — which the page never
      // states at all.
      currentBid: null,
      myBid: "150.00",
      currency: "EUR",
      bidderCount: null,
    });
  });

  it("reads a lot not bid on yet, closing in the house's own time zone", () => {
    const result = capturePhilasearchLot(
      page({
        saleName: "Philatino #2635 - Argentina: &quot;Budget&quot; auction with many interesting lots",
        heading: "Lot 1",
        category: "Argentina",
        lotBlock: "9337-A2635-1",
        description: "JALIL Guillermo",
        house: "Guillermo Jalil-Philatino",
        purchase: PHILATINO_NOT_BID,
      }),
      "https://www.philasearch.com/en/cat/13307_9337/lot/9337-A2635-1"
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.platformOfferId, "9337-A2635-1");
    assert.equal(result.lot.lotNo, "1");
    assert.equal(result.lot.title, "Argentina — JALIL Guillermo");
    assert.equal(result.lot.sellerName, "Guillermo Jalil-Philatino");
    // The first zone in the box is the house's; the collector's local time printed beneath it is the
    // same instant again.
    assert.equal(result.lot.endsAt, "2026-09-17T22:00:00.000Z");
    assert.equal(result.lot.startingPrice, "50.00");
    assert.equal(result.lot.currency, "USD");
    assert.equal(result.lot.myBid, null);
  });

  it("takes the opening bid, not the estimate printed above it", () => {
    const result = capturePhilasearchLot(page({ purchase: SIEGEL_ESTIMATE }), GAERTNER_URL);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.startingPrice, "2000.00");
    assert.equal(result.lot.currency, "USD");
  });

  it("reads the German page the same way", () => {
    const result = capturePhilasearchLot(
      page({
        saleName: "Christoph Gärtner 66. Auktion",
        heading: "Los 9850 D",
        category: "Polen",
        purchase: GAERTNER_GERMAN,
      }),
      "https://www.philasearch.com/de/cat/13320_9081/lot/9081-A66-9850"
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.lot.lotNo, "9850");
    assert.equal(result.lot.saleName, "Christoph Gärtner 66. Auktion");
    assert.equal(result.lot.endsAt, "2026-10-15T06:00:00.000Z");
    assert.equal(result.lot.startingPrice, "150.00");
    assert.equal(result.lot.myBid, "150.00");
  });

  it("refuses an after-auction sale, naming what it is", () => {
    const result = capturePhilasearchLot(page({ purchase: AFTER_AUCTION_SALE }), GAERTNER_URL);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-an-auction");
    assert.match(result.message, /after-auction sale/);
  });

  it("refuses a page with no bidding box", () => {
    const result = capturePhilasearchLot(
      parseHTML("<html><body><h1>Current Auctions</h1></body></html>").document as unknown as Document,
      "https://www.philasearch.com/en/auctions_current.html"
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not-a-listing");
  });
});
