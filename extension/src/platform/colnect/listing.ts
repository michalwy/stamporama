import type {
  ListingFilledField,
  ListingSkippedField,
  ListingFillOutcome,
  ListingPhotoFile,
  ListingTask,
  ListingTaskItem,
  PlatformListing,
} from "../listing";

// The Colnect half of the listing capability (#410, part of #155): get to the sale form and fill it
// from a neutral listing task (#405). The form is mapped field by field in #402, and every Colnect
// specific — the URL shape, the `20_` category prefix, the field names — lives here and nowhere else.
//
// Two rules shape the whole module:
//
//   • **Nothing is submitted.** Filling stops before Save; the collector clicks Colnect's own button.
//   • **Nothing pre-filled is touched.** `expiry_date`, `auto_renewal_times` and `auto_renewal_days`
//     are required, arrive filled in, and Stamporama has no concept matching them — writing our own
//     values would clobber the collector's defaults for no gain. Same for `options[] =
//     separate_listings`, which must stay unticked: ticking it splits the entry into one listing per
//     item, switches pricing to the per-item fields, and disables picture upload altogether (#402).
//
// Colnect's currency is a **seller-level setting**, not a form field (#402), so the offer's currency
// has nowhere to go here. That is why a Colnect platform locks its own currency in Stamporama (#196):
// the two are agreed once, in settings, rather than checked on every listing.

/** Colnect's category id for stamps. It leads every per-item value and field name (`20_<itemId>`). */
const STAMPS_CATEGORY = "20";

const FIELD = {
  price: "new_sale[price]",
  quantity: "new_sale[remaining_quantity]",
  description: "new_sale[sale_description_id]",
  privateNote: "new_sale[private_sale_description_id]",
  separateListings: "new_sale[options][]",
  condition: (catalogItemId: string) => `new_sale[cond_${STAMPS_CATEGORY}_${catalogItemId}]`,
} as const;

/**
 * The sale form for this task: `…/sell/new/category/stamps/item/<id>%2C<id>%2C…` over the copies'
 * Colnect item-IDs (#247) in listing order.
 *
 * **A komplet is declared in the URL** (#402), not assembled in the form, so this is string
 * concatenation over what the task already carries — no catalog lookup, and no page to visit first.
 *
 * Ids are **deduplicated**, because the form keys a fieldset per item: two copies of one stamp
 * cannot be declared twice, and repeating the id would silently collapse into one anyway. The copies
 * that fall away are named in the fill report rather than being dropped in silence.
 *
 * Throws when no copy carries a Colnect item-ID — a task the preconditions (#406) never let through,
 * and one where there is no form to open rather than a form to fill imperfectly.
 */
export function colnectSaleFormUrl(task: ListingTask): string {
  const ids = declaredItemIds(task.items);
  if (ids.length === 0) {
    throw new Error("None of this offer's stamps has a Colnect item-ID, so there is no sale form.");
  }
  return `https://colnect.com/en/sell/new/category/stamps/item/${encodeURIComponent(ids.join(","))}`;
}

/** The Colnect item-IDs a sale entry declares: listing order, first occurrence wins. */
function declaredItemIds(items: readonly ListingTaskItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const id = item.catalogItemId?.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** True for Colnect's new-sale form. The locale segment is whatever Colnect served — it may answer a
 *  `/en/` request in the seller's own language — and the trailing item list is not compared, since a
 *  redirect or a restored draft may word it differently than {@link colnectSaleFormUrl} did. */
export function isColnectSaleFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "colnect.com" && !host.endsWith(".colnect.com")) return false;
    return /^\/[a-z]{2}\/sell\/new\//.test(u.pathname);
  } catch {
    return false;
  }
}

/** A form control the sale form addresses by name. */
type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function fieldNamed(doc: Document, name: string): FormField | null {
  // Field names carry brackets, which are legal unescaped inside a quoted attribute selector.
  return doc.querySelector<FormField>(`[name="${name}"]`);
}

/** A `<select>`, without an `instanceof` against a global the test DOM does not install. */
function asSelect(el: FormField | null): HTMLSelectElement | null {
  return el && "options" in el ? (el as HTMLSelectElement) : null;
}

/** Tell the page a field changed, through its own window's `Event` where there is one. */
function dispatch(el: FormField, type: string): void {
  const view = el.ownerDocument?.defaultView as { Event?: typeof Event } | null;
  const Ctor = view?.Event ?? Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
}

/** Collects what went into the form and what did not, so the two are reported together (#408). */
class FillReport {
  readonly filled: ListingFilledField[] = [];
  readonly skipped: ListingSkippedField[] = [];

  fill(field: string, value: string): void {
    this.filled.push({ field, value });
  }

  skip(field: string, reason: string): void {
    this.skipped.push({ field, reason });
  }

  /**
   * Write `value` into the named control, or record why it could not be written. `display` is what
   * the report shows — the grade the collector reads on the form, rather than the number it submits.
   *
   * A **missing** field and a **disabled** one are both reported rather than ignored: the first
   * means the page is not the form we think it is (or the item is not on it), the second means
   * Colnect has switched the field off — which is what ticking *separate listings* does to the
   * shared price. `input` + `change` are dispatched because the page's own scripts listen for them.
   */
  write(doc: Document, name: string, label: string, value: string, display = value): void {
    const el = fieldNamed(doc, name);
    if (!el) {
      this.skip(label, `Colnect's form has no ${name} field on this page.`);
      return;
    }
    if (el.disabled) {
      this.skip(label, `Colnect has this field switched off — check the sale options above it.`);
      return;
    }
    const select = asSelect(el);
    if (select) {
      // Pick the option rather than assigning `value`: a value the form does not offer would
      // otherwise be swallowed silently, and here it is the one thing worth refusing on.
      const option = Array.from(select.options).find((o) => o.value === value);
      if (!option) {
        this.skip(label, `Colnect's form does not offer "${display}" here.`);
        return;
      }
      // Selecting an option deselects the rest on its own — the field takes one grade.
      option.selected = true;
    } else {
      el.value = value;
    }
    dispatch(el, "input");
    dispatch(el, "change");
    this.fill(label, display);
  }

  outcome(): ListingFillOutcome {
    return { filled: this.filled, skipped: this.skipped };
  }
}

/** How a copy is named in the report — its catalog label and the collection's own copy number. */
function copyLabel(item: ListingTaskItem): string {
  return `${item.label} (#${item.itemNo})`;
}

/**
 * Fill the sale form from `task`, and stop before Save.
 *
 * Per item, keyed by the `20_<colnectId>` id the form uses, this writes the copy's condition
 * translated through the collection's Colnect mapping (#404). Per listing, it writes the price, the
 * number of sets, the short description and the private note. Everything else the form holds is left
 * exactly as Colnect served it.
 */
export function fillColnectSaleForm(doc: Document, task: ListingTask): ListingFillOutcome {
  const report = new FillReport();

  warnOnSeparateListings(doc, report);
  fillConditions(doc, task, report);

  report.write(doc, FIELD.price, "Price", task.price);
  report.write(doc, FIELD.quantity, "Quantity", String(task.quantity));
  writeText(doc, report, FIELD.description, "Short description", task.description);
  writeText(doc, report, FIELD.privateNote, "Private note", task.privateNote);

  return report.outcome();
}

/** One condition select per **declared** item. A copy the form has no fieldset for is a second copy
 *  of a stamp already declared (see {@link colnectSaleFormUrl}) — reported by name, because the
 *  entry then describes fewer stamps than the offer holds and only the collector can decide about
 *  that. */
function fillConditions(doc: Document, task: ListingTask, report: FillReport): void {
  const declared = new Set<string>();
  for (const item of task.items) {
    const label = `Condition — ${copyLabel(item)}`;
    const id = item.catalogItemId?.trim();
    if (!id) {
      report.skip(label, `This stamp has no Colnect item-ID, so the entry does not list it.`);
      continue;
    }
    if (declared.has(id)) {
      report.skip(
        label,
        `Colnect declares each item once per sale entry, and this stamp is already listed above.`
      );
      continue;
    }
    declared.add(id);

    const { platformValue, platformLabel, name } = item.condition;
    if (!platformValue) {
      report.skip(label, `"${name}" has no Colnect grade mapped — set one in Settings → Colnect.`);
      continue;
    }
    report.write(
      doc,
      FIELD.condition(id),
      label,
      platformValue,
      platformLabel ?? platformValue
    );
  }
}

/**
 * A text field, subject to Colnect's own `maxlength` — 100 on both texts (#402).
 *
 * An over-long text is **not written and not truncated**: truncating mangles wording the collector
 * chose, and assigning past `maxlength` in script is not refused the way a paste is, so the form
 * would carry a value Colnect goes on to reject. The counter in Stamporama (#403) is where this is
 * fixed, and the reason says so with both numbers.
 */
function writeText(
  doc: Document,
  report: FillReport,
  name: string,
  label: string,
  text: string | null
): void {
  if (!text) return; // Nothing to say — an empty field is not a gap.
  // The `maxlength` **attribute** is what Colnect states about its own field — the same number the
  // counter in Stamporama is configured with (#403) — and it is counted in UTF-16 code units for the
  // same reason it is there: an HTML `maxlength` counts in those.
  const stated = fieldNamed(doc, name)?.getAttribute("maxlength");
  const limit = stated && Number(stated) > 0 ? Number(stated) : null;
  if (limit !== null && text.length > limit) {
    report.skip(
      label,
      `${text.length} characters, and Colnect allows ${limit} — shorten it in Stamporama.`
    );
    return;
  }
  report.write(doc, name, label, text);
}

/** *Open a separate sale listing for each item* must stay unticked: ticked, it splits the entry into
 *  one listing per item, moves pricing to the per-item fields and disables pictures entirely (#402).
 *  It is never touched — a tickbox the collector set is theirs — but it is said plainly, because the
 *  price this fills would then go into a field Colnect has switched off. */
function warnOnSeparateListings(doc: Document, report: FillReport): void {
  const el = doc.querySelector<HTMLInputElement>(
    `[name="${FIELD.separateListings}"][value="separate_listings"]`
  );
  // The property is the truth in a browser (the collector may have clicked it); the attribute is
  // what the page was served with, and the only answer a DOM without the property can give.
  const ticked = el && (typeof el.checked === "boolean" ? el.checked : el.hasAttribute("checked"));
  if (ticked) {
    report.skip(
      "Separate listings",
      `"Open a separate sale listing for each item" is ticked, which prices each item on its own and turns pictures off. Untick it for this listing.`
    );
  }
}

/**
 * The listed entry's own URL, once the sale has been submitted (#412) — or null for any other page.
 *
 * Colnect answers a successful Save by navigating **straight to the new entry**,
 * `https://colnect.com/en/market/sale/h5UXNh` (confirmed by posting one for real, which is what the
 * open question on #412 asked for). So recognising a listing is recognising that path: a short
 * opaque code under `/<locale>/market/sale/`, the locale being whatever Colnect served.
 *
 * Query and fragment are **dropped**. This URL is stored on the offer as the listing's address, and
 * a campaign parameter or an anchor Colnect happened to add is not part of that record — while the
 * entry's own path is stable and is what the collector would have copied by hand.
 */
export function colnectListedSaleUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "colnect.com" && !host.endsWith(".colnect.com")) return null;
  // The sale form lives under `/sell/`, the posted entry under `/market/sale/` — a different branch
  // of the site, so there is no chance of reading the form we just filled as its own outcome.
  if (!/^\/[a-z]{2}\/market\/sale\/[^/]+\/?$/.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

// ---------------------------------------------------------------------------------------------
// Pictures (#411)
// ---------------------------------------------------------------------------------------------
//
// The uploader is a Dropzone, but there is a real `<input type="file" multiple>` behind it (#402),
// so the offer's rendered images go in the way a drop would put them there: a `DataTransfer`, then
// `change`, and Colnect's own script does the uploading.
//
// It uploads **immediately**, over AJAX, before the sale is saved — the first picture mints the
// draft `sale_id` the rest are posted against. That is the whole reason this runs last, after every
// other field is in: by the time anything is written to Colnect, the collector is looking at a form
// with nothing left to decide.

/** How the report names the picture step, matching the neutral shell's own label. */
const PICTURES_FIELD = "Pictures";

/**
 * The sale form's real file input, behind the Dropzone.
 *
 * Found **structurally** rather than by name: #402 mapped the form field by field and this control
 * is the one thing in it Colnect does not address by a `new_sale[...]` name, so there is no stable
 * name to match on. An `accept` naming picture types is what identifies it; the first file input on
 * the page is the fallback, since the sale form has exactly one.
 */
export function colnectPictureInput(doc: Document): HTMLInputElement | null {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  return inputs.find((el) => /jpe?g|png|gif|image/i.test(el.getAttribute("accept") ?? "")) ?? inputs[0] ?? null;
}

/**
 * True when the input's own `accept` covers this file — by extension or by mime, both being legal in
 * one `accept` list.
 *
 * The check is the platform's answer to "would a drop of this file be taken", asked before anything
 * is uploaded: Colnect accepts `.jpg/.jpeg/.png/.gif` (#402) and a plan may hold something else, and
 * a picture silently dropped by the page is a listing that quietly went up without it. An input that
 * states no `accept` accepts everything, which is what the attribute's absence means in HTML.
 */
export function colnectAcceptsPicture(accept: string | null, fileName: string, mime: string): boolean {
  const rules = (accept ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = fileName.toLowerCase();
  const type = mime.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * Hand `photos` to the Dropzone's own input, in upload order, and stop (#411).
 *
 * Reports rather than throws, like every other step: a picture the form will not take is one the
 * collector drags in from the offer's ZIP, and the filled form has to survive that. The report says
 * the pictures were **handed over**, not that they arrived — the upload is Colnect's own AJAX and the
 * thumbnails appearing in the Dropzone are what confirms it, right where the collector is looking.
 */
export function attachColnectPictures(
  doc: Document,
  photos: readonly ListingPhotoFile[]
): ListingFillOutcome {
  const report = new FillReport();
  if (photos.length === 0) return report.outcome();

  const input = colnectPictureInput(doc);
  if (!input) {
    report.skip(PICTURES_FIELD, `Colnect's picture uploader is not on this page.`);
    return report.outcome();
  }
  if (input.disabled) {
    report.skip(
      PICTURES_FIELD,
      `Colnect has picture upload switched off — "Open a separate sale listing for each item" does that.`
    );
    return report.outcome();
  }

  const accept = input.getAttribute("accept");
  const taken: ListingPhotoFile[] = [];
  for (const photo of photos) {
    if (colnectAcceptsPicture(accept, photo.file.name, photo.file.type)) {
      taken.push(photo);
      continue;
    }
    report.skip(
      `${PICTURES_FIELD} — ${photo.file.name}`,
      `Colnect's uploader does not take ${photo.file.type || "this file type"}.`
    );
  }
  if (taken.length === 0) return report.outcome();

  // One `multiple` input takes the whole run; without it the form is a one-picture form and saying so
  // beats uploading the first image and losing the rest without a word. Property first and attribute
  // second, as the separate-listings check reads its own tickbox: a DOM without the property is not a
  // form that refuses several pictures.
  const multiple = typeof input.multiple === "boolean" ? input.multiple : input.hasAttribute("multiple");
  if (!multiple && taken.length > 1) {
    report.skip(
      `${PICTURES_FIELD} — ${taken.slice(1).map((p) => p.file.name).join(", ")}`,
      `Colnect's uploader takes one picture at a time on this page.`
    );
    taken.length = 1;
  }

  putFiles(input, taken.map((p) => p.file));
  dispatch(input, "change");
  report.fill(PICTURES_FIELD, `${taken.length} handed to Colnect's uploader`);
  return report.outcome();
}

/**
 * Put `files` into a file input the way a drop does — through a `DataTransfer`, which is the only
 * assignable source of a `FileList`.
 *
 * Built from the document's own window where there is one, exactly as {@link dispatch} builds its
 * `Event`: the input belongs to the page, and a value handed to it should come from the page's realm.
 */
function putFiles(input: HTMLInputElement, files: File[]): void {
  const view = input.ownerDocument?.defaultView as { DataTransfer?: typeof DataTransfer } | null;
  const Ctor = view?.DataTransfer ?? (globalThis as { DataTransfer?: typeof DataTransfer }).DataTransfer;
  if (!Ctor) throw new Error("This browser will not let the Assistant attach files to a form.");
  const dt = new Ctor();
  for (const file of files) dt.items.add(file);
  input.files = dt.files;
}

/** The Colnect module's listing half (#410, closed off by #412, pictures in #411). */
export const colnectListing: PlatformListing = {
  formUrl: colnectSaleFormUrl,
  isFormUrl: isColnectSaleFormUrl,
  fill: fillColnectSaleForm,
  listedUrl: colnectListedSaleUrl,
  attachPhotos: attachColnectPictures,
};
