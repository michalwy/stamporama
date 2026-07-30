import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  attachColnectPictures,
  colnectAcceptsPicture,
  colnectListedSaleUrl,
  colnectPictureInput,
  colnectSaleFormUrl,
  fillColnectSaleForm,
  isColnectSaleFormUrl,
} from "./listing";
import type { ListingPhotoFile, ListingTask, ListingTaskItem } from "../listing";

// Fixture mirrors the sale form as mapped in #402: one fieldset per item with a hidden `items[]` and
// a `new_sale[cond_20_<id>]` select over Colnect's fixed five grades, then the per-listing fields —
// including the three pre-filled ones this module must leave exactly as served.

const GRADES = `
  <option value="">Select condition</option>
  <option value="1">MNH - Mint Never Hinged</option>
  <option value="2">MH - Mint Hinged</option>
  <option value="3">MNG - Mint No Gum</option>
  <option value="4">U - Used</option>
  <option value="5">CTO - Cancelled To Order</option>`;

function itemFieldset(colnectId: string): string {
  return `
  <fieldset>
    <input type="hidden" name="items[]" value="20_${colnectId}">
    <select name="new_sale[cond_20_${colnectId}]" required>${GRADES}</select>
    <input type="text" name="new_sale[item_price_20_${colnectId}]" disabled>
  </fieldset>`;
}

/** The Dropzone's real file input (#402/#411). `pictures: false` stands for a form served without
 *  one; the attributes mirror what Colnect states about it. */
function pictureInput(opts: PictureOpts): string {
  if (opts.pictures === false) return "";
  return `<input type="file" accept=".jpg,.jpeg,.png,.gif"${
    opts.singlePicture ? "" : " multiple"
  }${opts.picturesDisabled ? " disabled" : ""}>`;
}

interface PictureOpts {
  separateListings?: boolean;
  pictures?: boolean;
  singlePicture?: boolean;
  picturesDisabled?: boolean;
}

function formHtml(colnectIds: string[], opts: PictureOpts = {}): string {
  return `<html><body>
  <form id="new-sale-form" method="post">
    ${colnectIds.map(itemFieldset).join("\n")}
    <div class="dropzone">${pictureInput(opts)}</div>
    <input type="text" name="new_sale[price]" value="">
    <input type="number" name="new_sale[remaining_quantity]" value="1" min="1" max="65535">
    <input type="text" name="new_sale[sale_description_id]" maxlength="100" value="">
    <input type="text" name="new_sale[private_sale_description_id]" maxlength="100" value="">
    <label><input type="checkbox" name="new_sale[options][]" value="separate_listings"${
      opts.separateListings ? " checked" : ""
    }> Open a separate sale listing for each item</label>
    <input type="text" name="new_sale[expiry_date]" value="2026-08-29">
    <input type="number" name="new_sale[auto_renewal_times]" value="10">
    <input type="number" name="new_sale[auto_renewal_days]" value="30">
    <input type="submit" value="Save">
  </form>
</body></html>`;
}

function docOf(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

function value(doc: Document, name: string): string {
  return doc.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "";
}

function item(
  colnectId: string | null,
  grade: { value: string | null; label?: string; name?: string } = { value: "1" },
  overrides: Partial<ListingTaskItem> = {}
): ListingTaskItem {
  return {
    itemId: `i-${colnectId ?? "none"}`,
    itemNo: 123,
    stampId: `s-${colnectId ?? "none"}`,
    label: `Mi·PL ${colnectId ?? "?"}`,
    catalogItemId: colnectId,
    condition: {
      id: "cond-1",
      name: grade.name ?? "Mint never hinged",
      abbreviation: "MNH",
      platformValue: grade.value,
      platformLabel: grade.value ? (grade.label ?? "MNH - Mint Never Hinged") : null,
    },
    ...overrides,
  };
}

function task(items: ListingTaskItem[], overrides: Partial<ListingTask> = {}): ListingTask {
  return {
    offerId: "o1",
    collectionId: "c1",
    state: "ready",
    platform: { id: "p1", name: "Colnect", module: "colnect" },
    title: "Mi·PL 1-3",
    description: "Poland 1945, complete set, MNH.",
    privateNote: "Klaser A, 12",
    descriptionFormat: "plain",
    price: "40.00",
    currency: "EUR",
    quantity: 1,
    items,
    photos: { status: "ready", outOfDate: false, images: [] },
    ...overrides,
  };
}

describe("the sale form URL", () => {
  it("declares a komplet in the URL, in listing order", () => {
    assert.equal(
      colnectSaleFormUrl(task([item("111"), item("222"), item("333")])),
      "https://colnect.com/en/sell/new/category/stamps/item/111%2C222%2C333"
    );
  });

  it("declares one item once — a second copy of a stamp cannot be a second fieldset", () => {
    assert.equal(
      colnectSaleFormUrl(task([item("111"), item("222"), item("111")])),
      "https://colnect.com/en/sell/new/category/stamps/item/111%2C222"
    );
  });

  it("refuses a task no stamp of which carries a Colnect item-ID", () => {
    assert.throws(() => colnectSaleFormUrl(task([item(null)])), /Colnect item-ID/);
  });

  it("recognises the form it served, whatever locale and item list came back", () => {
    assert.equal(isColnectSaleFormUrl("https://colnect.com/en/sell/new/category/stamps/item/111"), true);
    assert.equal(isColnectSaleFormUrl("https://colnect.com/pl/sell/new/category/stamps/item/9%2C8"), true);
    assert.equal(isColnectSaleFormUrl("https://colnect.com/en/sell"), false);
    assert.equal(isColnectSaleFormUrl("https://colnect.com/en/stamps/list"), false);
    assert.equal(isColnectSaleFormUrl("https://not-colnect.test/en/sell/new/x"), false);
  });

  // #412: Save navigates straight to the new entry, which is where the offer's URL comes from.
  it("reads the entry Colnect lands on after Save, and nothing else", () => {
    assert.equal(
      colnectListedSaleUrl("https://colnect.com/en/market/sale/h5UXNh"),
      "https://colnect.com/en/market/sale/h5UXNh"
    );
    // Whatever locale Colnect answered in — the entry is the same listing.
    assert.equal(
      colnectListedSaleUrl("https://colnect.com/pl/market/sale/h5UXNh"),
      "https://colnect.com/pl/market/sale/h5UXNh"
    );
    // A parameter or an anchor Colnect added is not part of the record the offer stores.
    assert.equal(
      colnectListedSaleUrl("https://www.colnect.com/en/market/sale/h5UXNh?ref=mail#pics"),
      "https://www.colnect.com/en/market/sale/h5UXNh"
    );
    // The form itself, the market index, and a page on somebody else's site.
    assert.equal(colnectListedSaleUrl("https://colnect.com/en/sell/new/category/stamps/item/111"), null);
    assert.equal(colnectListedSaleUrl("https://colnect.com/en/market/sale"), null);
    assert.equal(colnectListedSaleUrl("https://colnect.com/en/stamps/list"), null);
    assert.equal(colnectListedSaleUrl("https://not-colnect.test/en/market/sale/h5UXNh"), null);
    assert.equal(colnectListedSaleUrl("not a url"), null);
  });
});

describe("filling the form", () => {
  it("fills every mapped field and leaves the pre-filled ones alone", () => {
    const doc = docOf(formHtml(["111", "222"]));
    const outcome = fillColnectSaleForm(
      doc,
      task([item("111"), item("222", { value: "4", label: "U - Used" })], { quantity: 3 })
    );

    assert.equal(value(doc, "new_sale[cond_20_111]"), "1");
    assert.equal(value(doc, "new_sale[cond_20_222]"), "4");
    assert.equal(value(doc, "new_sale[price]"), "40.00");
    assert.equal(value(doc, "new_sale[remaining_quantity]"), "3");
    assert.equal(value(doc, "new_sale[sale_description_id]"), "Poland 1945, complete set, MNH.");
    assert.equal(value(doc, "new_sale[private_sale_description_id]"), "Klaser A, 12");

    // Untouched (#402): required, pre-filled, and nothing in Stamporama matches them.
    assert.equal(value(doc, "new_sale[expiry_date]"), "2026-08-29");
    assert.equal(value(doc, "new_sale[auto_renewal_times]"), "10");
    assert.equal(value(doc, "new_sale[auto_renewal_days]"), "30");
    assert.equal(
      doc.querySelector(`[name="new_sale[options][]"]`)?.hasAttribute("checked"),
      false
    );

    assert.deepEqual(outcome.skipped, []);
    // Grades are reported as the collector reads them, not as the form submits them.
    assert.deepEqual(outcome.filled, [
      { field: "Condition — Mi·PL 111 (#123)", value: "MNH - Mint Never Hinged" },
      { field: "Condition — Mi·PL 222 (#123)", value: "U - Used" },
      { field: "Price", value: "40.00" },
      { field: "Quantity", value: "3" },
      { field: "Short description", value: "Poland 1945, complete set, MNH." },
      { field: "Private note", value: "Klaser A, 12" },
    ]);
  });

  it("fills the rest of the form when a condition is unmapped, and says which copy", () => {
    const doc = docOf(formHtml(["111", "222"]));
    const outcome = fillColnectSaleForm(
      doc,
      task([item("111"), item("222", { value: null, name: "On cover" })])
    );

    assert.equal(value(doc, "new_sale[cond_20_111]"), "1");
    assert.equal(value(doc, "new_sale[cond_20_222]"), "");
    assert.equal(value(doc, "new_sale[price]"), "40.00");
    assert.deepEqual(outcome.skipped, [
      {
        field: "Condition — Mi·PL 222 (#123)",
        reason: `"On cover" has no Colnect grade mapped — set one in Settings → Colnect.`,
      },
    ]);
  });

  it("names the second copy of a stamp the entry cannot declare twice", () => {
    const doc = docOf(formHtml(["111"]));
    const outcome = fillColnectSaleForm(doc, task([item("111"), item("111")]));

    assert.equal(value(doc, "new_sale[cond_20_111]"), "1");
    assert.equal(outcome.skipped.length, 1);
    assert.match(outcome.skipped[0].reason, /already listed above/);
  });

  it("refuses a text past Colnect's own limit rather than truncating it", () => {
    const doc = docOf(formHtml(["111"]));
    const long = "x".repeat(137);
    const outcome = fillColnectSaleForm(doc, task([item("111")], { description: long }));

    assert.equal(value(doc, "new_sale[sale_description_id]"), "");
    assert.deepEqual(outcome.skipped, [
      {
        field: "Short description",
        reason: "137 characters, and Colnect allows 100 — shorten it in Stamporama.",
      },
    ]);
    // The rest of the listing is still filled — a long text misstates nothing about the stamps.
    assert.equal(value(doc, "new_sale[price]"), "40.00");
  });

  it("says nothing about a text the offer does not carry", () => {
    const doc = docOf(formHtml(["111"]));
    const outcome = fillColnectSaleForm(
      doc,
      task([item("111")], { description: null, privateNote: null })
    );
    assert.deepEqual(outcome.skipped, []);
    assert.deepEqual(
      outcome.filled.map((f) => f.field),
      ["Condition — Mi·PL 111 (#123)", "Price", "Quantity"]
    );
  });

  it("reports a ticked separate-listings box without unticking it", () => {
    const doc = docOf(formHtml(["111"], { separateListings: true }));
    const outcome = fillColnectSaleForm(doc, task([item("111")]));

    assert.equal(
      doc.querySelector(`[name="new_sale[options][]"]`)?.hasAttribute("checked"),
      true
    );
    assert.equal(outcome.skipped[0].field, "Separate listings");
    assert.match(outcome.skipped[0].reason, /Untick it/);
  });

  it("reports a field the form does not hold instead of failing the whole fill", () => {
    const doc = docOf(formHtml([]));
    const outcome = fillColnectSaleForm(doc, task([item("111")]));

    assert.deepEqual(
      outcome.skipped.map((s) => s.field),
      ["Condition — Mi·PL 111 (#123)"]
    );
    assert.equal(value(doc, "new_sale[price]"), "40.00");
  });
});

// ── Pictures (#411) ──────────────────────────────────────────────────────────
//
// The uploader is a Dropzone with a real `<input type="file" multiple>` behind it (#402), and it
// posts each picture the moment it is handed over — which is why this runs after the fill and never
// as part of it. `DataTransfer` is the only assignable source of a `FileList` and the test DOM has
// none, so it is stubbed: what is under test is which files reach the input and what is reported
// about the ones that do not.

class FakeDataTransfer {
  readonly files: File[] = [];
  readonly items = {
    add: (file: File) => {
      this.files.push(file);
    },
  };
}

/** A fetched image, as the content script hands it over. */
function photo(name: string, mime = "image/jpeg"): ListingPhotoFile {
  return { photoId: name, file: { name, type: mime } as File };
}

/** The files that actually reached the form's own input. */
function attachedTo(doc: Document): string[] {
  const input = doc.querySelector<HTMLInputElement>('input[type="file"]');
  return Array.from((input?.files ?? []) as unknown as File[]).map((f) => f.name);
}

describe("attaching the offer's pictures", () => {
  before(() => {
    (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
  });
  after(() => {
    delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
  });

  it("hands the plan's images to the Dropzone's own input, in upload order", () => {
    const doc = docOf(formHtml(["111"]));
    const outcome = attachColnectPictures(doc, [photo("offer-01.jpg"), photo("offer-02.jpg")]);

    assert.deepEqual(attachedTo(doc), ["offer-01.jpg", "offer-02.jpg"]);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(outcome.filled.length, 1);
    assert.match(outcome.filled[0].value, /2 handed/);
  });

  it("says so instead of failing when the uploader is not on the page", () => {
    const doc = docOf(formHtml(["111"], { pictures: false }));
    const outcome = attachColnectPictures(doc, [photo("offer-01.jpg")]);

    assert.deepEqual(outcome.filled, []);
    assert.match(outcome.skipped[0].reason, /not on this page/);
  });

  it("names *separate listings* when Colnect has switched the uploader off", () => {
    const doc = docOf(formHtml(["111"], { picturesDisabled: true }));
    const outcome = attachColnectPictures(doc, [photo("offer-01.jpg")]);

    assert.deepEqual(attachedTo(doc), []);
    assert.match(outcome.skipped[0].reason, /separate sale listing/);
  });

  it("leaves out a file type the form does not accept, and keeps the rest", () => {
    const doc = docOf(formHtml(["111"]));
    const outcome = attachColnectPictures(doc, [
      photo("offer-01.webp", "image/webp"),
      photo("offer-02.jpg"),
    ]);

    assert.deepEqual(attachedTo(doc), ["offer-02.jpg"]);
    assert.match(outcome.skipped[0].field, /offer-01\.webp/);
    assert.match(outcome.skipped[0].reason, /image\/webp/);
  });

  it("takes only the first picture when the input is not `multiple`, and says which were left", () => {
    const doc = docOf(formHtml(["111"], { singlePicture: true }));
    const outcome = attachColnectPictures(doc, [photo("offer-01.jpg"), photo("offer-02.jpg")]);

    assert.deepEqual(attachedTo(doc), ["offer-01.jpg"]);
    assert.match(outcome.skipped[0].field, /offer-02\.jpg/);
  });

  it("touches nothing when there is nothing to attach", () => {
    const doc = docOf(formHtml(["111"]));
    const outcome = attachColnectPictures(doc, []);

    assert.deepEqual(outcome, { filled: [], skipped: [] });
    assert.deepEqual(attachedTo(doc), []);
  });

  it("finds the uploader by what it accepts, not by position", () => {
    const doc = docOf(
      `<html><body><form>
        <input type="file" accept=".csv">
        <input type="file" accept=".jpg,.jpeg,.png,.gif" multiple>
      </form></body></html>`
    );
    assert.equal(colnectPictureInput(doc)?.getAttribute("accept"), ".jpg,.jpeg,.png,.gif");
  });

  it("reads an `accept` list by extension and by mime alike", () => {
    assert.equal(colnectAcceptsPicture(".jpg,.png", "a.PNG", "image/png"), true);
    assert.equal(colnectAcceptsPicture(".jpg,.png", "a.webp", "image/webp"), false);
    assert.equal(colnectAcceptsPicture("image/*", "a.webp", "image/webp"), true);
    assert.equal(colnectAcceptsPicture("image/jpeg", "a.jpg", "image/jpeg"), true);
    // No `accept` is HTML for "anything", and inventing a rule here would drop a valid picture.
    assert.equal(colnectAcceptsPicture(null, "a.tiff", "image/tiff"), true);
  });
});
