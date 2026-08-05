import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  allegroListedOfferUrl,
  allegroListedUrlInDocument,
  attachAllegroPictures,
  isoDurationHours,
  allegroSaleFormUrl,
  fillAllegroSaleForm,
  isAllegroSaleFormDocument,
  isAllegroSaleFormUrl,
  prepareAllegroSaleForm,
} from "./listing";
import type { ListingPhotoFile, ListingTask, ListingTaskAllegro } from "../listing";

// Fixtures mirror Allegro's legacy sale form as mapped for #493: every control addressed by its own
// `id`, and each category parameter by **Allegro's parameter id**. The entry pages are here too,
// since getting to the form is half of what this module does.

const SALE_FORM = `
  <main>
    <input type="text" id="name" value="">
    <select id="213">
      <option value="">wybierz</option>
      <option value="czysty">czysty</option>
      <option value="kasowany">kasowany</option>
    </select>
    <input type="text" id="225693_0" value="">
    <div data-testid="description-section-container">
      <iframe id="id_ifr"></iframe>
    </div>
    <input type="file" accept="image/jpeg,image/png">
    <input type="text" id="buynow-price" value="">
    <input type="checkbox" id="auction-checkbox">
    <input type="checkbox" id="checkbox-republish">
    <input type="text" id="quantity" value="1">
    <select id="durationLimit">
      <option value="">wybierz</option>
      <option value="PT72H">3 dni</option>
      <option value="PT168H">7 dni</option>
      <option value="PT720H">30 dni</option>
    </select>
    <select id="shippingRatesId">
      <option value="">wybierz</option>
      <option value="rates-1">Znaczki</option>
    </select>
    <select id="estimatedShippingTimeId">
      <option value="">wybierz</option>
      <option value="PT24H">1 dzień</option>
      <option value="PT48H">2 dni</option>
      <option value="PT72H">3 dni</option>
    </select>
    <select id="return-policies">
      <option value="">wybierz</option>
      <option value="ret-1">Zwrot</option>
    </select>
  </main>`;

/** The newer form Allegro redirects a Regular account to — one link out of it. */
const RECOMMERCE_PAGE = `
  <main>
    <input type="text" id="product-name-search">
    <p>Możesz też wystawić przez
      <a href="/moje-allegro/sprzedaz/formularz-wystawiania">dotychczasowy formularz.</a>
    </p>
  </main>`;

/** The legacy form's own first page: the product catalogue a stamp is never in. */
const PRODUCT_SEARCH_PAGE = `
  <main>
    <input type="text" id="product-search-phrase-field">
    <button type="button">SZUKAJ</button>
  </main>`;

const CATEGORY_MODAL = `
  <main>
    <input type="text" id="category-id" placeholder="Numer kategorii">
  </main>`;

const ALLEGRO: ListingTaskAllegro = {
  categoryId: "3633",
  categoryName: "1944 - 1950",
  categoryPath: "Kolekcje i sztuka > Kolekcje > Filatelistyka > Polska > 1944 - 1950",
  parameters: [
    {
      parameterId: "213",
      parameterName: "Rodzaj",
      describesProduct: false,
      displayValues: ["czysty"],
    },
  ],
  profile: {
    id: "p1",
    name: "Znaczki",
    shippingRatesId: "rates-1",
    shippingRatesName: "Znaczki",
    handlingTime: "PT24H",
    durationLimit: "PT168H",
    autoRepublish: true,
    returnPolicyId: "ret-1",
    returnPolicyName: "Zwrot",
    impliedWarrantyId: null,
    locationCountryCode: "PL",
    locationCity: "Koszalin",
    locationPostCode: "75-381",
    invoiceType: "NO_INVOICE",
  },
  listingType: "fixed",
  startingPrice: null,
};

function task(over: Partial<ListingTask> = {}): ListingTask {
  return {
    offerId: "o1",
    collectionId: "c1",
    state: "ready",
    platform: { id: "pl1", name: "Allegro", module: "allegro" },
    title: "Polska 1948 Mi 480-483 czyste",
    description: "Zestaw czterech znaczków.",
    privateNote: null,
    descriptionFormat: "plain",
    price: "48.00",
    currency: "PLN",
    quantity: 2,
    items: [],
    photos: { status: "ready", outOfDate: false, images: [] },
    allegro: ALLEGRO,
    ...over,
  };
}

function docOf(html: string): Document {
  return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

const filledIn = (doc: Document, t = task()) => {
  const outcome = fillAllegroSaleForm(doc, t);
  return {
    filled: Object.fromEntries(outcome.filled.map((f) => [f.field, f.value])),
    skipped: outcome.skipped.map((s) => s.field),
  };
};

describe("allegroSaleFormUrl", () => {
  it("is the legacy form's own address, and carries nothing of the task", () => {
    assert.equal(
      allegroSaleFormUrl(task()),
      "https://allegro.pl/moje-allegro/sprzedaz/formularz-wystawiania"
    );
  });
});

describe("isAllegroSaleFormUrl", () => {
  it("accepts both forms' addresses — the redirect between them is part of one run", () => {
    assert.ok(isAllegroSaleFormUrl("https://allegro.pl/moje-allegro/sprzedaz/formularz-wystawiania"));
    assert.ok(
      isAllegroSaleFormUrl("https://allegro.pl/moje-allegro/sprzedaz/formularz-wystawiania/188196/restore")
    );
    assert.ok(
      isAllegroSaleFormUrl("https://allegro.pl/moje-allegro/recommerce/formularz-wystawiania/produkt")
    );
  });

  it("refuses another site's page, and Allegro's other pages", () => {
    assert.equal(isAllegroSaleFormUrl("https://allegro.pl/oferta/znaczki-123"), false);
    assert.equal(isAllegroSaleFormUrl("https://example.com/moje-allegro/sprzedaz/formularz-wystawiania"), false);
    assert.equal(isAllegroSaleFormUrl("not a url"), false);
  });
});

describe("isAllegroSaleFormDocument", () => {
  it("is the sale form only — never one of the pages on the way to it (#419)", () => {
    assert.ok(isAllegroSaleFormDocument(docOf(SALE_FORM)));
    assert.equal(isAllegroSaleFormDocument(docOf(RECOMMERCE_PAGE)), false);
    assert.equal(isAllegroSaleFormDocument(docOf(PRODUCT_SEARCH_PAGE)), false);
    assert.equal(isAllegroSaleFormDocument(docOf(CATEGORY_MODAL)), false);
  });
});

describe("prepareAllegroSaleForm", () => {
  it("follows the newer form's opt-out link, and does nothing else on that page", async () => {
    const doc = docOf(RECOMMERCE_PAGE);
    let clicked = 0;
    const link = doc.querySelector("a") as unknown as { click: () => void };
    link.click = () => {
      clicked += 1;
    };
    await prepareAllegroSaleForm(doc, task());
    assert.equal(clicked, 1);
  });

  it("types the offer's own category number into the entry modal", async () => {
    const doc = docOf(CATEGORY_MODAL);
    await prepareAllegroSaleForm(doc, task());
    assert.equal((doc.getElementById("category-id") as unknown as HTMLInputElement).value, "3633");
  });

  it("walks the legacy entry page: off GTIN, search, past the catalogue, category number", async () => {
    const doc = docOf(`
      <main>
        <input type="text" id="product-search-phrase-field" placeholder="Podaj numer GTIN: EAN, ISBN">
        <button type="button" id="gtin-off">Mój produkt nie ma numeru GTIN (kodu EAN)</button>
        <button type="button" id="go">SZUKAJ</button>
      </main>`);
    const main = doc.querySelector("main") as unknown as HTMLElement;
    const clicked: string[] = [];

    const gtinOff = doc.getElementById("gtin-off") as unknown as { click: () => void };
    gtinOff.click = () => {
      clicked.push("gtin-off");
      // Allegro swaps the placeholder on the very same field, which is all that tells the two
      // searches apart.
      doc
        .getElementById("product-search-phrase-field")
        ?.setAttribute("placeholder", "Podaj nazwę lub kod produktu");
    };
    const go = doc.getElementById("go") as unknown as { click: () => void };
    go.click = () => {
      clicked.push("szukaj");
      // Nothing matched — which is the answer for a stamp, and the one that offers the way past.
      main.innerHTML += `<button type="button" id="skip">Kontynuuj bez wybierania produktu</button>`;
      const skip = doc.getElementById("skip") as unknown as { click: () => void };
      skip.click = () => {
        clicked.push("skip");
        main.innerHTML += `<input type="text" id="category-id" placeholder="Numer kategorii">`;
      };
    };

    await prepareAllegroSaleForm(doc, task());
    assert.deepEqual(clicked, ["gtin-off", "szukaj", "skip"]);
    assert.equal(
      (doc.getElementById("product-search-phrase-field") as unknown as HTMLInputElement).value,
      "Polska 1948 Mi 480-483 czyste"
    );
    assert.equal((doc.getElementById("category-id") as unknown as HTMLInputElement).value, "3633");
  });

  it("refuses an offer with no category — there is no form to open", async () => {
    const doc = docOf(CATEGORY_MODAL);
    await assert.rejects(
      () => prepareAllegroSaleForm(doc, task({ allegro: { ...ALLEGRO, categoryId: null } })),
      /no Allegro category/
    );
  });

  it("does nothing at all on the form itself", async () => {
    const doc = docOf(SALE_FORM);
    await prepareAllegroSaleForm(doc, task());
    assert.equal((doc.getElementById("name") as unknown as HTMLInputElement).value, "");
  });
});

describe("prepareAllegroSaleForm on the form itself", () => {
  it("unfolds the rest of the category's parameters before anything is filled", async () => {
    // Allegro hides all but a handful behind *więcej parametrów*, and a hidden control is not in the
    // document at all — a fill that ran first would report them as fields the form does not have.
    const doc = docOf(`
      <main>
        <input type="text" id="name" value="">
        <input type="text" id="buynow-price" value="">
        <select id="213"><option value="">wybierz</option><option value="czysty">czysty</option></select>
        <button type="button" id="more">więcej parametrów</button>
      </main>`);
    const main = doc.querySelector("main") as unknown as HTMLElement;
    const more = doc.getElementById("more") as unknown as { click: () => void };
    more.click = () => {
      main.innerHTML += `
        <select id="9525"><option value="">wybierz</option><option value="tak">tak</option></select>
        <button type="button">mniej parametrów</button>`;
    };

    await prepareAllegroSaleForm(doc, task());
    assert.ok(doc.getElementById("9525"));
  });

  it("ticks *licytacja* for an auction, and waits for the fields it grows", async () => {
    const doc = docOf(SALE_FORM);
    const main = doc.querySelector("main") as unknown as HTMLElement;
    const box = doc.getElementById("auction-checkbox") as unknown as {
      click: () => void;
      checked: boolean;
    };
    box.click = () => {
      box.checked = true;
      // Allegro swaps the quick buy's duration for the auction's own and grows an opening price.
      doc.getElementById("durationLimit")?.remove();
      main.innerHTML += `
        <input type="text" id="auction-starting-price" value="">
        <select id="auctionDurationSelect">
          <option value="">wybierz</option>
          <option value="PT168H">7 dni</option>
        </select>`;
    };

    await prepareAllegroSaleForm(
      doc,
      task({ allegro: { ...ALLEGRO, listingType: "auction", startingPrice: "5.00" } })
    );
    assert.equal(box.checked, true);
    assert.ok(doc.getElementById("auction-starting-price"));
  });

  it("leaves a box the collector already ticked alone", async () => {
    const doc = docOf(SALE_FORM);
    const box = doc.getElementById("auction-checkbox") as unknown as {
      click: () => void;
      checked: boolean;
    };
    box.checked = true;
    let clicks = 0;
    box.click = () => (clicks += 1);
    await prepareAllegroSaleForm(
      doc,
      task({ allegro: { ...ALLEGRO, listingType: "auction", startingPrice: "5.00" } })
    );
    assert.equal(clicks, 0);
  });
});

describe("waking Allegro's description editor", () => {
  it("clicks the placeholder and waits for the frame, since none exists until it does", async () => {
    // The form is served with an empty `<p>` where the editor will be; TinyMCE mounts on the click.
    const doc = docOf(`
      <main>
        <input type="text" id="name" value="">
        <input type="text" id="buynow-price" value="">
        <div data-testid="description-section-container"><div><p></p></div></div>
      </main>`);
    const section = doc.querySelector('[data-testid="description-section-container"]') as unknown as HTMLElement;
    const placeholder = doc.querySelector("p") as unknown as HTMLElement;
    placeholder.addEventListener("click", () => {
      section.innerHTML += `<iframe id="id_ifr"></iframe>`;
    });

    await prepareAllegroSaleForm(doc, task());
    assert.ok(doc.getElementById("id_ifr"));
  });

  it("leaves it shut for an offer with no description to write", async () => {
    const doc = docOf(`
      <main>
        <input type="text" id="name" value="">
        <input type="text" id="buynow-price" value="">
        <div data-testid="description-section-container"><div><p></p></div></div>
      </main>`);
    let clicks = 0;
    (doc.querySelector("p") as unknown as HTMLElement).addEventListener("click", () => (clicks += 1));
    await prepareAllegroSaleForm(doc, task({ description: null }));
    assert.equal(clicks, 0);
  });
});

describe("isoDurationHours", () => {
  it("reads Allegro's two notations for one duration as the same length", () => {
    // The profile holds what the API takes; the form offers the other spelling.
    assert.equal(isoDurationHours("P3D"), isoDurationHours("PT72H"));
    assert.equal(isoDurationHours("PT0S"), 0);
    assert.equal(isoDurationHours("P14D"), 336);
    assert.equal(isoDurationHours("PT30M"), 0.5);
    assert.equal(isoDurationHours("nonsense"), null);
    assert.equal(isoDurationHours("P"), null);
  });
});

describe("fillAllegroSaleForm", () => {
  it("fills the title, price, quantity and the profile's three ids", () => {
    const doc = docOf(SALE_FORM);
    const { filled } = filledIn(doc);
    assert.equal(filled["Title"], "Polska 1948 Mi 480-483 czyste");
    assert.equal(filled["Price"], "48.00");
    assert.equal(filled["Quantity"], "2");
    assert.equal(filled["Delivery price list"], "Znaczki");
    assert.equal(filled["Handling time"], "1 dzień");
    assert.equal(filled["Listing duration"], "7 dni");
    assert.equal(filled["Returns"], "Zwrot");
    assert.equal((doc.getElementById("buynow-price") as unknown as HTMLInputElement).value, "48.00");
    assert.equal((doc.getElementById("shippingRatesId") as unknown as HTMLSelectElement).value, "rates-1");
  });

  it("answers a category parameter in the control Allegro named after it", () => {
    const doc = docOf(SALE_FORM);
    const { filled } = filledIn(doc);
    assert.equal(filled["Parameter — Rodzaj"], "czysty");
    assert.equal((doc.getElementById("213") as unknown as HTMLSelectElement).value, "czysty");
  });

  it("answers a text parameter through Allegro's own row suffix", () => {
    const doc = docOf(SALE_FORM);
    const t = task({
      allegro: {
        ...ALLEGRO,
        parameters: [
          { parameterId: "225693", parameterName: "EAN", describesProduct: true, displayValues: ["590"] },
        ],
      },
    });
    filledIn(doc, t);
    assert.equal((doc.getElementById("225693_0") as unknown as HTMLInputElement).value, "590");
  });

  it("names a parameter it has no Allegro label for rather than guessing one", () => {
    const doc = docOf(SALE_FORM);
    const t = task({
      allegro: {
        ...ALLEGRO,
        parameters: [
          { parameterId: "213", parameterName: "Rodzaj", describesProduct: false, displayValues: [] },
        ],
      },
    });
    const { skipped } = filledIn(doc, t);
    assert.ok(skipped.includes("Parameter — Rodzaj"));
    const select = doc.getElementById("213") as unknown as HTMLSelectElement;
    assert.equal(Array.from(select.options).some((o) => o.selected), false);
  });

  it("writes the description into the editor's own frame", () => {
    const doc = docOf(SALE_FORM);
    const frame = doc.getElementById("id_ifr") as unknown as { contentDocument: Document };
    const inner = parseHTML("<html><body></body></html>").document;
    frame.contentDocument = inner as unknown as Document;
    filledIn(doc);
    assert.match(inner.body.innerHTML, /Zestaw czterech znaczków\./);
  });

  it("says the sending address cannot be set, and what it should read", () => {
    const doc = docOf(SALE_FORM);
    const outcome = fillAllegroSaleForm(doc, task());
    const address = outcome.skipped.find((s) => s.field === "Sending address");
    assert.ok(address);
    assert.match(address.reason, /75-381 Koszalin/);
  });

  it("matches a handling time Allegro spells differently from its own API", () => {
    // The profile holds `P3D` because that is what `POST /sale/product-offers` takes; the form
    // offers `PT72H`. A string match would select nothing and leave the default standing.
    const doc = docOf(SALE_FORM);
    const t = task({ allegro: { ...ALLEGRO, profile: { ...ALLEGRO.profile!, handlingTime: "P3D" } } });
    filledIn(doc, t);
    assert.equal(
      (doc.getElementById("estimatedShippingTimeId") as unknown as HTMLSelectElement).value,
      "PT72H"
    );
  });

  it("opens an auction at its starting price, and never as a quick buy", () => {
    const doc = docOf(`
      ${SALE_FORM}
      <input type="text" id="auction-starting-price" value="">
      <select id="auctionDurationSelect">
        <option value="">wybierz</option>
        <option value="PT168H">7 dni</option>
      </select>`);
    const t = task({
      allegro: { ...ALLEGRO, listingType: "auction", startingPrice: "5.00" },
    });
    const { filled } = filledIn(doc, t);
    assert.equal(filled["Starting price"], "5.00");
    assert.equal(
      (doc.getElementById("auction-starting-price") as unknown as HTMLInputElement).value,
      "5.00"
    );
    // A Buy Now price on an auction is a second way of selling the offer never asked for.
    assert.equal((doc.getElementById("buynow-price") as unknown as HTMLInputElement).value, "");
    // The auction has its own duration select — the quick buy's is not on the form at all.
    assert.equal(
      (doc.getElementById("auctionDurationSelect") as unknown as HTMLSelectElement).value,
      "PT168H"
    );
  });

  it("sets automatic re-listing to what the profile says, in both directions", () => {
    const doc = docOf(SALE_FORM);
    const box = doc.getElementById("checkbox-republish") as unknown as {
      click: () => void;
      checked: boolean;
    };
    box.checked = false;
    let clicks = 0;
    box.click = () => {
      clicks += 1;
      box.checked = !box.checked;
    };

    const { filled } = filledIn(doc);
    assert.equal(clicks, 1);
    assert.equal(box.checked, true);
    assert.equal(filled["Automatic re-listing"], "on");

    // Already in the wanted state — a click here would toggle it back off.
    clicks = 0;
    filledIn(doc);
    assert.equal(clicks, 0);
    assert.equal(box.checked, true);
  });

  it("says nothing about a duration a profile does not state", () => {
    const doc = docOf(SALE_FORM);
    const t = task({ allegro: { ...ALLEGRO, profile: { ...ALLEGRO.profile!, durationLimit: null } } });
    const { filled, skipped } = filledIn(doc, t);
    assert.equal(filled["Listing duration"], undefined);
    assert.equal(skipped.includes("Listing duration"), false);
  });
});

describe("allegroListedUrlInDocument", () => {
  // Allegro does not navigate when a form is posted: the same document becomes *Oferta jest
  // przygotowana*, carrying the offer's link, with the address bar still on the sale form.
  const THANK_YOU = `
    <main>
      <div id="thank-you-page">
        <h2>Oferta jest przygotowana</h2>
        <span>Gdy ją zatwierdzimy, będzie opublikowana pod linkiem:
          <a href="https://allegro.pl/oferta/18819972918">https://allegro.pl/oferta/18819972918</a>
        </span>
        <a href="/moje-allegro/sprzedaz/obsluga-ofert/moj-asortyment">Mój asortyment</a>
      </div>
    </main>`;

  it("reads the listing's address out of Allegro's own confirmation", () => {
    assert.equal(
      allegroListedUrlInDocument(docOf(THANK_YOU)),
      "https://allegro.pl/oferta/18819972918"
    );
  });

  it("says nothing while the form is still a form", () => {
    assert.equal(allegroListedUrlInDocument(docOf(SALE_FORM)), null);
  });

  it("ignores a page's other links — only an offer's own address is the listing", () => {
    const doc = docOf(`
      <main>
        <div id="thank-you-page">
          <a href="/moje-allegro/sprzedaz/obsluga-ofert/moj-asortyment">Mój asortyment</a>
          <a href="https://allegro.pl/pomoc">Pomoc</a>
        </div>
      </main>`);
    assert.equal(allegroListedUrlInDocument(doc), null);
  });
});

describe("allegroListedOfferUrl", () => {
  it("recognises the published offer, and drops what is not part of its address", () => {
    assert.equal(
      allegroListedOfferUrl("https://allegro.pl/oferta/znaczki-polska-1948-16959191999?utm_source=x"),
      "https://allegro.pl/oferta/znaczki-polska-1948-16959191999"
    );
  });

  it("is null for the sale form it was just filled into, and for anything else", () => {
    assert.equal(
      allegroListedOfferUrl("https://allegro.pl/moje-allegro/sprzedaz/formularz-wystawiania"),
      null
    );
    assert.equal(allegroListedOfferUrl("https://example.com/oferta/123"), null);
  });
});

// ── The pictures, and the question Allegro asks about them (#411/#493) ────────
//
// `DataTransfer` is the only assignable source of a `FileList` and the test DOM has none, so it is
// stubbed exactly as Colnect's test stubs it.

class FakeDataTransfer {
  readonly files: File[] = [];
  readonly items = {
    add: (file: File) => {
      this.files.push(file);
    },
  };
}

function photo(name: string): ListingPhotoFile {
  return { photoId: name, file: { name, type: "image/jpeg" } as File };
}

/** The dialog Allegro opens over the upload, with every box unticked as it serves it. */
const AI_DIALOG = `
  <div role="dialog">
    <h1 id="modal-title">Oznacz zdjęcia znakiem wodnym „AI”</h1>
    <input id="checkbox-1" type="checkbox">
    <button type="button">Anuluj</button>
    <button type="button">Potwierdź wybór</button>
  </div>`;

describe("attaching the offer's pictures", () => {
  before(() => {
    (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
  });
  after(() => {
    delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
  });

  it("hands the images to the form's own uploader", async () => {
    const doc = docOf(SALE_FORM);
    // A form Allegro never opens the dialog on — the ordinary case, the marking being behind a
    // feature flag. The wait is cut short here rather than in the module, which has a person to
    // serve.
    const outcome = await attachAllegroPictures(doc, [photo("o-01.jpg"), photo("o-02.jpg")], 50);
    const input = doc.querySelector('input[type="file"]') as unknown as { files: File[] };
    assert.deepEqual(
      input.files.map((f) => f.name),
      ["o-01.jpg", "o-02.jpg"]
    );
    assert.equal(outcome.skipped.length, 0);
    assert.match(outcome.filled[0].value, /2 handed/);
  });

  it("confirms Allegro's AI-watermark dialog without marking a single picture", async () => {
    const doc = docOf(SALE_FORM);
    const main = doc.querySelector("main") as unknown as HTMLElement;
    let confirmed = 0;
    // Allegro opens it the moment the files arrive — which is what `change` stands for here.
    (doc.querySelector('input[type="file"]') as unknown as HTMLElement).addEventListener(
      "change",
      () => {
        main.innerHTML += AI_DIALOG;
        const buttons = Array.from(doc.querySelectorAll("button")) as unknown as {
          textContent: string;
          click: () => void;
        }[];
        const confirm = buttons.find((b) => /Potwierdź wybór/.test(b.textContent));
        if (confirm) confirm.click = () => (confirmed += 1);
      }
    );

    const outcome = await attachAllegroPictures(doc, [photo("o-01.jpg")]);
    assert.equal(confirmed, 1);
    assert.equal(doc.getElementById("checkbox-1")?.hasAttribute("checked"), false);
    assert.match(outcome.filled[0].value, /none marked as AI/);
  });
});
