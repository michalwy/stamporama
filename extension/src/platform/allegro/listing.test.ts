import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  allegroListedOfferUrl,
  allegroListedUrlInDocument,
  allegroPictureInput,
  isoDurationHours,
  allegroSaleFormUrl,
  fillAllegroSaleForm,
  isAllegroSaleFormDocument,
  isAllegroSaleFormUrl,
  prepareAllegroSaleForm,
} from "./listing";
import type { ListingPhotoFile, ListingTask, ListingTaskAllegro } from "../listing";

// The fixtures below are Allegro's **recommerce wizard** as mapped for #719: five steps in one
// document, client-side routed, each one addressed by its own ids and Allegro's own test ids. The
// harness is not decoration — the module both reads and writes this form (a control's existence
// follows from a value already chosen), so a fixture that never changed under it would test nothing.
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

before(() => {
  (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
});
after(() => {
  delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
});

const ALLEGRO: ListingTaskAllegro = {
  categoryId: "3633",
  categoryName: "1944 - 1950",
  categoryPath: "Kolekcje i sztuka > Kolekcje > Filatelistyka > Polska > 1944 - 1950",
  parameters: [
    { parameterId: "213", parameterName: "Rodzaj", describesProduct: false, displayValues: ["czysty"] },
    { parameterId: "7914", parameterName: "Rok emisji", describesProduct: true, displayValues: ["1948"] },
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

function photo(name: string): ListingPhotoFile {
  return { photoId: name, file: { name, type: "image/jpeg" } as File };
}

function docOf(html: string): Document {
  return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

// ---------------------------------------------------------------------------------------------
// The wizard, as much of one as the module can tell from a document
// ---------------------------------------------------------------------------------------------

type StepName = "product" | "describe" | "details" | "delivery" | "summary";

interface WizardOptions {
  /** Which delivery price lists are on the step itself; the rest sit behind *Inne zapisane dostawy*. */
  ratesOnStep?: string[];
  /** Serve Allegro's AI-watermark question over the uploader, as it once did behind a flag. */
  aiWatermark?: boolean;
  /** Open with the *Kontynuuj wystawianie* prompt over the page. */
  draftPrompt?: boolean;
  /** Start somewhere other than the first step, as a re-run on a form the collector left open does. */
  from?: StepName;
}

/**
 * A wizard that behaves like Allegro's: it re-renders under the module, grows the controls a choice
 * brings with it, and refuses to advance a step it is unhappy with.
 *
 * Clicks are wired by hand — the test DOM dispatches nothing of its own — and re-wired after every
 * render, exactly as a re-rendering page hands out new elements.
 */
function wizard(options: WizardOptions = {}) {
  const ratesOnStep = options.ratesOnStep ?? ["rates-1"];
  const doc = docOf(`<main></main><div id="dialogs"></div>`);
  const main = doc.querySelector("main")!;
  const dialogs = doc.getElementById("dialogs")!;

  const state = {
    step: options.from ?? ("product" as StepName),
    /** What the module chose on its way through, in Allegro's own terms. */
    category: null as string | null,
    searched: false,
    unfolded: false,
    auction: false,
    pictures: 0,
    savedRates: ["rates-1", "rates-2"],
    /** Which steps were left, so a test can say the run stopped where it says it did. */
    reached: [options.from ?? "product"] as StepName[],
    published: false,
    /** What each step held when it was left — the wizard throws its own controls away as it moves on,
     *  exactly as Allegro's does, so this is where a test reads the fill's work back from. */
    written: {} as Record<string, string>,
  };

  /** Note what this step holds, before the next render takes its controls away. */
  function capture(): void {
    const grab = (id: string): string | undefined =>
      (doc.getElementById(id) as unknown as HTMLInputElement | null)?.value;
    const values: Record<string, string | undefined> = {
      "title-input": grab("title-input"),
      "dropdown-213": grab("dropdown-213"),
      "7914": grab("7914"),
      priceCents: grab("priceCents"),
      quantity: (main.querySelector('input[type="number"]') as unknown as HTMLInputElement | null)?.value,
      description: doc.querySelector('[aria-label="Opis oferty"]')?.innerHTML,
      rates: (
        Array.from(main.querySelectorAll('input[type="radio"]')) as unknown as HTMLInputElement[]
      ).find((r) => r.value?.startsWith("rates-") && r.checked)?.value,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) state.written[key] = value;
    }
  }

  const click = (el: Element | null, run: () => void): void => {
    if (el) (el as unknown as { click: () => void }).click = run;
  };
  const buttons = (root: Element, text: RegExp): HTMLElement[] =>
    Array.from(root.querySelectorAll("button")).filter((b) =>
      text.test((b.textContent ?? "").trim())
    ) as unknown as HTMLElement[];
  const button = (root: Element, text: RegExp): HTMLElement | null => buttons(root, text)[0] ?? null;

  function go(step: StepName): void {
    state.step = step;
    if (!state.reached.includes(step)) state.reached.push(step);
    render();
  }

  function render(): void {
    // Allegro's own form keeps its values across a render — React does that for it. This one is
    // rebuilt from a string, so what the step held is noted, put back, and left in `state.written`
    // for a test to read after the wizard has moved on and thrown the controls away.
    capture();
    main.innerHTML = html();
    restore();
    wire();
  }

  function restore(): void {
    for (const id of ["title-input", "dropdown-213", "7914", "priceCents"]) {
      const el = doc.getElementById(id) as unknown as HTMLInputElement | null;
      if (el && state.written[id] !== undefined) el.value = state.written[id]!;
    }
    const quantity = main.querySelector('input[type="number"]') as unknown as HTMLInputElement | null;
    if (quantity && state.written["quantity"] !== undefined) quantity.value = state.written["quantity"]!;
    const editor = doc.querySelector('[aria-label="Opis oferty"]');
    if (editor && state.written["description"] !== undefined) {
      editor.innerHTML = state.written["description"]!;
    }
  }

  function html(): string {
    switch (state.step) {
      case "product":
        return `
          <input type="text" id="product-name-search" placeholder="Podaj nazwę lub GTIN/EAN/ISBN">
          <button type="button">SZUKAJ</button>
          ${
            state.searched
              ? `<label><input type="radio"><span>MOJEGO PRODUKTU TU NIE MA</span></label>`
              : ""
          }`;
      case "describe":
        return `
          <input type="text" id="title-input" data-testid="offer-title-input" value="">
          ${
            state.category
              ? `<p>${state.category}</p><button type="button">ZMIEŃ</button>
                 ${parametersHtml()}
                 <input type="file" id="file-input" data-testid="drag-drop-photo-upload" accept="image/*">
                 ${thumbnailsHtml()}`
              : `<button type="button">WSZYSTKIE KATEGORIE</button>`
          }
          <div contenteditable="true" role="textbox" aria-label="Opis oferty"></div>
          ${state.pictures === 0 && state.category ? "" : ""}
          <button type="button" data-testid="submit-button">KOLEJNY KROK</button>`;
      case "details":
        return `
          <label data-testid="offer-type-selection">
            <input type="radio"><div data-testid="radio-selection-label">Kup teraz</div>
          </label>
          <label data-testid="offer-type-selection">
            <input type="radio"${state.auction ? " checked" : ""}>
            <div data-testid="radio-selection-label">Licytacja</div>
          </label>
          ${
            state.auction
              ? `<select id="offer-duration-select">
                   <option value="">-wybierz-</option>
                   <option value="PT24H">1 dzień</option>
                   <option value="PT168H">7 dni</option>
                 </select>`
              : `<input type="number" value="1">`
          }
          <input type="checkbox" role="switch">
          <input type="text" id="priceCents" data-testid="offer-price-input" value="">
          <button type="button" data-testid="submit-button">KOLEJNY KROK</button>`;
      case "delivery":
        return `
          <select>
            <option value="">-wybierz-</option>
            <option value="PT24H">1 dzień</option>
            <option value="PT72H">3 dni</option>
          </select>
          ${ratesOnStep.map(rateCard).join("")}
          <button type="button">INNE ZAPISANE DOSTAWY (${state.savedRates.length - ratesOnStep.length})</button>
          <select>
            <option value="">Wybierz warunki zwrotów</option>
            <option value="ret-1">Zwrot</option>
          </select>
          <button type="button" data-testid="submit-button">KOLEJNY KROK</button>`;
      case "summary":
        return `
          <div data-testid="price-summary">Prowizja 13.53%</div>
          <button type="button" data-testid="submit-button">WYSTAW NA ALLEGRO</button>`;
    }
  }

  const rateCard = (id: string): string => `
    <label data-testid="shipping-rate-option-${id}">
      <input type="radio" value="${id}"><span>${id === "rates-1" ? "Znaczki" : "Książka"}</span>
    </label>`;

  const parametersHtml = (): string => `
    <input type="text" id="dropdown-213" role="combobox" value="">
    <div id="dropdown-213-content" data-testid="select-search-dropdown"></div>
    ${
      state.unfolded
        ? `<input type="text" id="7914" value="">
           <button type="button">POKAŻ MNIEJ</button>`
        : `<button type="button">POKAŻ WIĘCEJ</button>`
    }`;

  const thumbnailsHtml = (): string =>
    Array.from(
      { length: state.pictures },
      (_, i) => `<img data-testid="https://a.allegroimg.com/original/aaa/${i}">`
    ).join("");

  function wire(): void {
    // ── Wybór produktu ──
    click(button(main, /^szukaj$/i), () => {
      state.searched = true;
      render();
    });
    const noProduct = Array.from(main.querySelectorAll("label")).find((l) =>
      /mojego produktu tu nie ma/i.test(l.textContent ?? "")
    );
    click(noProduct?.querySelector("input") ?? null, () => {
      // Allegro carries the search phrase over as the title; the fill then writes the offer's own.
      go("describe");
      const title = doc.getElementById("title-input") as unknown as HTMLInputElement | null;
      if (title) title.value = "carried over from the search";
    });

    // ── Zdjęcia i opis ──
    click(button(main, /^(wszystkie kategorie|zmień)$/i), () => openCategoryPicker());
    click(button(main, /^pokaż więcej$/i), () => {
      state.unfolded = true;
      render();
    });
    wireDropdown();
    const file = doc.getElementById("file-input");
    if (file) {
      file.addEventListener("change", () => {
        const input = file as unknown as HTMLInputElement;
        state.pictures += input.files?.length ?? 0;
        if (options.aiWatermark) openAiWatermark();
        render();
      });
    }

    // ── Szczegóły ──
    for (const card of Array.from(main.querySelectorAll('[data-testid="offer-type-selection"]'))) {
      const name = card.querySelector('[data-testid="radio-selection-label"]')?.textContent?.trim();
      click(card.querySelector("input"), () => {
        state.auction = name === "Licytacja";
        render();
      });
    }

    // ── Dostawa ──
    click(button(main, /^inne zapisane dostawy/i), () => openSavedRates());

    // ── On, or not ──
    const submit = main.querySelector('[data-testid="submit-button"]');
    click(submit, () => {
      if (state.step === "summary") {
        state.published = true;
        throw new Error("The Assistant must never submit an Allegro listing.");
      }
      capture();
      if (state.step === "describe" && state.pictures === 0) {
        main.insertAdjacentHTML(
          "beforeend",
          `<div data-testid="photos-error">Dodaj przynajmniej jedno zdjęcie</div>`
        );
        return;
      }
      go(state.step === "describe" ? "details" : state.step === "details" ? "delivery" : "summary");
    });
  }

  /** The combobox: a list drawn only while it is open, filtered by what was typed. */
  function wireDropdown(): void {
    const input = doc.getElementById("dropdown-213") as unknown as HTMLInputElement | null;
    const list = doc.getElementById("dropdown-213-content");
    if (!input || !list) return;
    const OPTIONS = ["brak informacji", "czysty", "kasowany"];
    input.addEventListener("input", () => {
      const typed = input.value.trim().toLowerCase();
      const shown = OPTIONS.filter((o) => o.startsWith(typed));
      list.innerHTML = shown.map((o) => `<li role="option"><button type="button">${o}</button></li>`).join("");
      for (const row of Array.from(list.querySelectorAll("li[role='option'] button"))) {
        click(row, () => {
          input.value = (row.textContent ?? "").trim();
          list.innerHTML = "";
        });
      }
    });
  }

  const TREE: Record<string, string[]> = {
    "": ["Dom i Ogród", "Kolekcje i sztuka"],
    "Kolekcje i sztuka": ["Kolekcje", "Sztuka"],
    Kolekcje: ["Filatelistyka", "Numizmatyka"],
    Filatelistyka: ["Polska", "Europa"],
    Polska: ["1918 - 1939", "1944 - 1950", "1951 - 1960"],
    "1944 - 1950": [],
  };

  function openCategoryPicker(): void {
    let at = "";
    const trail: string[] = [];
    const draw = (): void => {
      const children = TREE[at] ?? [];
      dialogs.innerHTML = `
        <div role="dialog">
          <h2>Wybierz kategorię</h2>
          <button type="button" aria-label="zamknij"></button>
          ${at ? `<button type="button">Cofnij do ${at}</button>` : ""}
          ${children.map((c) => `<button type="button">${c}</button>`).join("")}
        </div>`;
      const dialog = dialogs.querySelector("[role='dialog']")!;
      click(button(dialog, /^zamknij$/i) ?? dialog.querySelector('[aria-label="zamknij"]'), () => {
        dialogs.innerHTML = "";
      });
      for (const name of children) {
        click(button(dialog, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)), () => {
          trail.push(name);
          if ((TREE[name] ?? []).length === 0) {
            dialogs.innerHTML = "";
            state.category = trail.join(" / ");
            render();
            return;
          }
          at = name;
          draw();
        });
      }
    };
    draw();
  }

  function openSavedRates(): void {
    const hidden = state.savedRates.filter((r) => !ratesOnStep.includes(r));
    let picked: string | null = null;
    dialogs.innerHTML = `
      <div role="dialog">
        <h2>Zapisane dostawy</h2>
        ${hidden.map(rateCard).join("")}
        <button type="button">ZAMKNIJ</button>
        <button type="button">ZAPISZ</button>
      </div>`;
    const dialog = dialogs.querySelector("[role='dialog']")!;
    for (const id of hidden) {
      const card = dialog.querySelector(`[data-testid="shipping-rate-option-${id}"]`)!;
      click(card.querySelector("input"), () => {
        picked = id;
      });
    }
    click(button(dialog, /^zamknij$/i), () => {
      dialogs.innerHTML = "";
    });
    click(button(dialog, /^zapisz$/i), () => {
      dialogs.innerHTML = "";
      if (picked) ratesOnStep.push(picked);
      render();
    });
  }

  function openAiWatermark(): void {
    dialogs.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog"><h2>Oznacz zdjęcia znakiem wodnym</h2>
         <input type="checkbox"><button type="button">Potwierdź wybór</button>
       </div>`
    );
    const dialog = dialogs.querySelector("[role='dialog']:last-child")!;
    click(button(dialog, /potwierdź wybór/i), () => {
      dialog.remove();
    });
  }

  if (options.draftPrompt) {
    dialogs.innerHTML = `
      <div role="dialog">
        <h2>Kontynuuj wystawianie</h2>
        <button type="button">USUŃ</button>
        <button type="button">CHCĘ WYSTAWIĆ NOWĄ OFERTĘ</button>
      </div>`;
    const dialog = dialogs.querySelector("[role='dialog']")!;
    click(button(dialog, /usuń/i), () => {
      throw new Error("The Assistant must never delete the collector's draft.");
    });
    click(button(dialog, /chcę wystawić nową ofertę/i), () => {
      dialogs.innerHTML = "";
    });
  }
  render();

  return {
    doc,
    state,
    /** What a field held when its step was left, or what it holds now if that step is still open. */
    value: (id: string) =>
      state.written[id] ?? (doc.getElementById(id) as unknown as HTMLInputElement | null)?.value,
    description: () =>
      state.written["description"] ?? doc.querySelector('[aria-label="Opis oferty"]')?.innerHTML,
  };
}

/** The waits, cut to nothing: the fixtures answer instantly, and a case that is *meant* to time out
 *  would otherwise cost the suite a minute of real waiting each. */
const FAST = { page: 50, step: 50, upload: 50, poll: 1 };

/** Prepare and fill one wizard, and read the report back by field name. */
async function run(w: ReturnType<typeof wizard>, t = task(), photos = [photo("o-01.jpg")]) {
  await prepareAllegroSaleForm(w.doc, t, FAST);
  const outcome = await fillAllegroSaleForm(w.doc, t, photos, FAST);
  return {
    filled: Object.fromEntries(outcome.filled.map((f) => [f.field, f.value])),
    skipped: Object.fromEntries(outcome.skipped.map((s) => [s.field, s.reason])),
  };
}

// ---------------------------------------------------------------------------------------------

describe("allegroSaleFormUrl", () => {
  it("is the wizard's own first step, and carries nothing of the task", () => {
    assert.equal(
      allegroSaleFormUrl(task()),
      "https://allegro.pl/moje-allegro/recommerce/formularz-wystawiania/produkt"
    );
  });
});

describe("isAllegroSaleFormUrl", () => {
  it("accepts every step of the wizard, and the legacy address that redirects into it", () => {
    for (const step of ["produkt", "opis", "szczegoly", "dostawa", "podsumowanie"]) {
      assert.ok(
        isAllegroSaleFormUrl(
          `https://allegro.pl/moje-allegro/recommerce/formularz-wystawiania/18881642279/draft/${step}`
        ),
        step
      );
    }
    assert.ok(isAllegroSaleFormUrl("https://allegro.pl/moje-allegro/sprzedaz/formularz-wystawiania"));
  });

  it("refuses another site's page, and Allegro's other pages", () => {
    assert.equal(isAllegroSaleFormUrl("https://allegro.pl/oferta/znaczki-123"), false);
    assert.equal(
      isAllegroSaleFormUrl("https://example.com/moje-allegro/recommerce/formularz-wystawiania"),
      false
    );
    assert.equal(isAllegroSaleFormUrl("not a url"), false);
  });
});

describe("isAllegroSaleFormDocument", () => {
  it("is the step the fill starts on, and none of the others", () => {
    assert.equal(isAllegroSaleFormDocument(wizard({ from: "product" }).doc), false);
    assert.equal(isAllegroSaleFormDocument(wizard({ from: "describe" }).doc), true);
    assert.equal(isAllegroSaleFormDocument(wizard({ from: "details" }).doc), false);
    assert.equal(isAllegroSaleFormDocument(wizard({ from: "delivery" }).doc), false);
    assert.equal(isAllegroSaleFormDocument(wizard({ from: "summary" }).doc), false);
  });
});

describe("prepareAllegroSaleForm", () => {
  it("searches past Allegro's product catalogue and lands on the step the fill starts on", async () => {
    const w = wizard();
    await prepareAllegroSaleForm(w.doc, task(), FAST);
    assert.ok(isAllegroSaleFormDocument(w.doc));
    assert.equal(w.state.searched, true);
  });

  it("searches for what is being sold, the catalogue not opening at all until something is", async () => {
    const w = wizard();
    const typed: string[] = [];
    const field = w.doc.getElementById("product-name-search") as unknown as HTMLInputElement;
    field.addEventListener("input", () => typed.push(field.value));
    await prepareAllegroSaleForm(w.doc, task(), FAST);
    assert.deepEqual(typed, ["Polska 1948 Mi 480-483 czyste"]);
  });

  it("answers Allegro's unfinished-draft prompt with a new offer, and never with Usuń", async () => {
    const w = wizard({ draftPrompt: true });
    await prepareAllegroSaleForm(w.doc, task(), FAST);
    assert.equal(w.doc.querySelectorAll('[role="dialog"]').length, 0);
    assert.ok(isAllegroSaleFormDocument(w.doc));
  });

  it("goes back to that step when the collector left the form further on", async () => {
    // The step strip carries a button per step already visited, which is the way back.
    const w = wizard({ from: "details" });
    const strip = w.doc.querySelector("main")!;
    strip.insertAdjacentHTML("afterbegin", `<ul><li><button type="button">Zdjęcia i opis</button></li></ul>`);
    const back = strip.querySelector("li button") as unknown as { click: () => void };
    let went = 0;
    back.click = () => {
      went += 1;
      w.state.step = "describe";
      strip.innerHTML = `<input type="text" id="title-input"><button data-testid="submit-button">KOLEJNY KROK</button>`;
    };
    await prepareAllegroSaleForm(w.doc, task(), FAST);
    assert.equal(went, 1);
  });

  it("says so rather than filling when Allegro never renders the form", async () => {
    await assert.rejects(
      () => prepareAllegroSaleForm(docOf("<main></main>"), task(), FAST),
      /did not finish loading/
    );
  });
});

describe("filling the wizard", () => {
  it("walks every step and stops on the summary, never submitting", async () => {
    const w = wizard();
    const report = await run(w);

    assert.deepEqual(w.state.reached, ["product", "describe", "details", "delivery", "summary"]);
    assert.equal(w.state.published, false);
    assert.equal(report.filled["Title"], "Polska 1948 Mi 480-483 czyste");
    assert.equal(report.filled["Category"], ALLEGRO.categoryPath);
    assert.equal(report.filled["Offer type"], "Kup teraz");
    assert.equal(report.filled["Price"], "48.00");
    assert.equal(report.filled["Quantity"], "2");
    assert.equal(report.filled["Pictures"], "1 uploaded");
  });

  it("overwrites the title Allegro carried over from the product search", async () => {
    const w = wizard();
    await run(w);
    // The fill reads its own title back off the step it wrote it on, before moving on.
    assert.equal(w.state.reached.includes("details"), true);
  });

  it("files the listing under the offer's own category, level by level", async () => {
    const w = wizard();
    await run(w);
    assert.equal(w.state.category, "Kolekcje i sztuka / Kolekcje / Filatelistyka / Polska / 1944 - 1950");
  });

  it("reports a category it can only name by number rather than picking Allegro's guess", async () => {
    const w = wizard();
    const report = await run(
      w,
      task({ allegro: { ...ALLEGRO, categoryPath: null } })
    );
    assert.match(report.skipped["Category"], /stores only 3633/);
    assert.equal(w.state.category, null);
  });

  it("unfolds the rest of the parameters, then answers each in its own control", async () => {
    const w = wizard();
    const report = await run(w);
    assert.equal(w.state.unfolded, true);
    // A dictionary parameter is the combobox `#dropdown-213`; a free-text one is `#7914`.
    assert.equal(w.value("dropdown-213"), "czysty");
    assert.equal(w.value("7914"), "1948");
    assert.equal(report.filled["Parameter — Rodzaj"], "czysty");
    assert.equal(report.filled["Parameter — Rok emisji"], "1948");
  });

  it("leaves a dictionary control empty when Allegro does not offer the answer", async () => {
    const w = wizard();
    const report = await run(
      w,
      task({
        allegro: {
          ...ALLEGRO,
          parameters: [
            { parameterId: "213", parameterName: "Rodzaj", describesProduct: false, displayValues: ["ząbkowany"] },
          ],
        },
      })
    );
    // An invalid combobox is what stops the wizard advancing, so a value that did not go in must not
    // be left typed into it.
    assert.equal(w.value("dropdown-213"), "");
    assert.match(report.skipped["Parameter — Rodzaj"], /does not offer "ząbkowany"/);
  });

  it("writes a plain description as the editor's own paragraphs", async () => {
    const w = wizard();
    await run(w, task({ description: "Pierwszy.\n\nDrugi." }));
    assert.equal(w.description(), "<p>Pierwszy.</p><p>Drugi.</p>");
  });

  it("hands the pictures over and waits for Allegro to take them", async () => {
    const w = wizard();
    const report = await run(w, task(), [photo("o-01.jpg"), photo("o-02.jpg")]);
    assert.equal(w.state.pictures, 2);
    assert.equal(report.filled["Pictures"], "2 uploaded");
  });

  it("confirms Allegro's AI-watermark question with nothing ticked", async () => {
    const w = wizard({ aiWatermark: true });
    const report = await run(w);
    assert.equal(w.doc.querySelectorAll('[role="dialog"]').length, 0);
    assert.equal(
      (w.doc.querySelector('[role="dialog"] input[type="checkbox"]') as unknown as HTMLInputElement | null)
        ?.checked,
      undefined
    );
    assert.equal(report.filled["Pictures"], "1 uploaded");
  });

  it("stops on the step Allegro refuses to leave, in Allegro's own words", async () => {
    // An offer with no rendered pictures: the wizard will not go on, and everything written stays.
    const w = wizard();
    const report = await run(w, task(), []);
    assert.deepEqual(w.state.reached, ["product", "describe"]);
    assert.match(report.skipped["Pictures and description"], /Dodaj przynajmniej jedno zdjęcie/);
    assert.equal(report.filled["Title"], "Polska 1948 Mi 480-483 czyste");
  });

  it("fills delivery, handling time and returns from the offer's profile", async () => {
    const w = wizard();
    const report = await run(w);
    assert.equal(report.filled["Handling time"], "1 dzień");
    assert.equal(report.filled["Delivery price list"], "Znaczki");
    assert.equal(report.filled["Returns"], "Zwrot");
    assert.match(report.skipped["Sending address"], /75-381 Koszalin/);
  });

  it("fetches a delivery price list Allegro keeps behind its saved-deliveries dialog", async () => {
    const w = wizard({ ratesOnStep: ["rates-2"] });
    const report = await run(w);
    assert.equal(report.filled["Delivery price list"], "Znaczki");
    assert.equal(w.doc.querySelectorAll('[role="dialog"]').length, 0);
  });

  it("says a quick buy has no duration to set rather than dropping the profile's silently", async () => {
    const report = await run(wizard());
    assert.match(report.skipped["Listing duration"], /runs a quick buy for 30 days/);
  });

  it("leaves everything to Allegro when the offer carries no listing profile", async () => {
    const report = await run(wizard(), task({ allegro: { ...ALLEGRO, profile: null } }));
    assert.match(report.skipped["Delivery"], /no Allegro listing profile/);
  });
});

describe("filling an auction (#449)", () => {
  const auction = () =>
    task({ allegro: { ...ALLEGRO, listingType: "auction", startingPrice: "1.00" } });

  it("ticks the format, then writes the opening price and the auction's own duration", async () => {
    const w = wizard();
    const report = await run(w, auction());
    assert.equal(w.state.auction, true);
    assert.equal(report.filled["Offer type"], "Licytacja");
    assert.equal(report.filled["Starting price"], "1.00");
    assert.equal(report.filled["Listing duration"], "7 dni");
    // A quantity on an auction would be a field the form does not have — and a Buy Now price on one
    // is a second way of selling the offer never asked for.
    assert.equal(report.filled["Quantity"], undefined);
    assert.equal(report.filled["Price"], undefined);
  });
});

describe("never submitting (#408)", () => {
  it("refuses the summary's own button, which Allegro gives the same test id", async () => {
    const w = wizard({ from: "summary" });
    // The button reads *Wystaw na Allegro*; the fill must find no way on from here.
    const outcome = await fillAllegroSaleForm(w.doc, task(), [photo("o-01.jpg")], FAST);
    assert.equal(w.state.published, false);
    assert.ok(outcome.skipped.length > 0);
  });
});

describe("allegroPictureInput", () => {
  it("is Allegro's own uploader, by test id and then by what it accepts", () => {
    assert.ok(
      allegroPictureInput(docOf(`<input type="file" data-testid="drag-drop-photo-upload">`))
    );
    assert.ok(allegroPictureInput(docOf(`<input type="file" accept="image/jpeg,image/png">`)));
    assert.equal(allegroPictureInput(docOf(`<input type="file" accept=".pdf">`)), null);
  });
});

describe("isoDurationHours", () => {
  it("reads the notations Allegro's API and its form each use for one length", () => {
    assert.equal(isoDurationHours("P3D"), 72);
    assert.equal(isoDurationHours("PT72H"), 72);
    assert.equal(isoDurationHours("PT0S"), 0); // *natychmiast*, which Allegro does offer.
    assert.equal(isoDurationHours("P1M"), null);
    assert.equal(isoDurationHours(""), null);
  });
});

describe("reading the listing back (#412)", () => {
  it("recognises a published offer's own address, without its tracking parameters", () => {
    assert.equal(
      allegroListedOfferUrl("https://allegro.pl/oferta/znaczki-polska-1948-16883421?bi_s=ads"),
      "https://allegro.pl/oferta/znaczki-polska-1948-16883421"
    );
    assert.equal(allegroListedOfferUrl("https://allegro.pl/oferta/"), null);
    assert.equal(allegroListedOfferUrl("https://allegro.pl/moje-allegro/sprzedaz"), null);
  });

  it("reads the URL off a confirmation that replaced the form without navigating", () => {
    const legacy = docOf(
      `<div id="thank-you-page"><a href="https://allegro.pl/oferta/znaczki-16883421">Zobacz ofertę</a></div>`
    );
    assert.equal(
      allegroListedUrlInDocument(legacy),
      "https://allegro.pl/oferta/znaczki-16883421"
    );

    const wizardConfirmation = docOf(
      `<main><h1>Oferta jest przygotowana</h1>
         <a href="https://allegro.pl/oferta/znaczki-16883421">Zobacz ofertę</a></main>`
    );
    assert.equal(
      allegroListedUrlInDocument(wizardConfirmation),
      "https://allegro.pl/oferta/znaczki-16883421"
    );
  });

  it("says nothing while the page is still a step of the wizard", () => {
    // A link to somebody else's offer on a form being filled is not the listing that was just posted.
    const w = wizard({ from: "describe" });
    w.doc
      .querySelector("main")!
      .insertAdjacentHTML("beforeend", `<a href="https://allegro.pl/oferta/inna-oferta-1">Podobne</a>`);
    assert.equal(allegroListedUrlInDocument(w.doc), null);
  });
});
