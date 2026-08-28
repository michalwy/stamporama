import type {
  ListingFilledField,
  ListingSkippedField,
  ListingFillOutcome,
  ListingPhotoFile,
  ListingTask,
  ListingTaskAllegro,
  PlatformListing,
} from "../listing";
import { allegroOfferId } from "./parse";

// The Allegro half of the listing capability (#493, part of #155; rewritten for the new form in
// #719): walk Allegro's own entry page to its sale form, then fill the form from the neutral task
// (#405) plus the offer's Allegro section (#494). Everything Allegro-specific — the addresses, the
// element ids, the order the steps come in — lives here and nowhere else.
//
// **Why a form at all**, when #477 already publishes through the API: `POST /sale/product-offers` is
// open to business accounts only, and a private seller's grant is refused the first time a listing
// goes out (ADR-0027 §4c). The API path stays and stays the better one where it works; this is the
// path that works today.
//
// Allegro withdrew its legacy one-screen form (#719). What every account is served now is the
// **recommerce wizard**: five steps in a single document, client-side routed, and nothing between
// them is a page load — `…/formularz-wystawiania/<draft>/draft/{produkt,opis,szczegoly,dostawa,
// podsumowanie}`. One content-script lifetime therefore drives the whole of it, which is the one
// piece of luck in the change.
//
// Four rules shape the module:
//
//   • **Nothing is submitted.** Filling stops on *Podsumowanie*; the collector clicks Allegro's own
//     *Wystaw na Allegro*. That button carries the **same** `data-testid` as *Kolejny krok* on every
//     earlier step, which is the single most dangerous fact on this page — see {@link nextStepButton}.
//   • **No class names, ever** (#355's rule for this marketplace). Every class on an Allegro page is
//     hashed per build. What is used instead are element ids, Allegro's own test ids, and — for the
//     category parameters — *Allegro's own parameter ids*: the control answering parameter `213` is
//     `#dropdown-213` where it is a dictionary and `#213` where it is free text.
//   • **Nothing pre-filled is overwritten** unless the offer has something to say about it. A form
//     Allegro served with the collector's own defaults in it is theirs.
//   • **A control's existence follows from a value.** The parameters, the picture uploader and the
//     auction's own fields do not exist until a category or a format has been chosen. This is why
//     the fill both reads and writes, step by step, and why it is asynchronous.

const HOST = "allegro.pl";

/** Where a run starts: the wizard's own first step. The legacy address still redirects here, but
 *  opening it costs a redirect and lands in the same place, so it is not what we ask for. */
const SALE_FORM_URL = `https://${HOST}/moje-allegro/recommerce/formularz-wystawiania/produkt`;

/** The ids and test ids the wizard addresses its own fields by (mapped 2026-08-28). */
const FIELD = {
  /** *Wybór produktu*: one field for a name and a GTIN alike. */
  productSearch: "product-name-search",
  title: "title-input",
  /** The asking price on a quick buy and the **opening** price on an auction — one field, renamed by
   *  the format rather than replaced, which is why the two are written through the same id. */
  price: "priceCents",
  /** How long an auction runs. A quick buy has no such field at all on this form: Allegro fixes it
   *  at 30 days and says so beside the format. */
  auctionDuration: "offer-duration-select",
} as const;

const TESTID = {
  /** *Kolejny krok* — **and** *Wystaw na Allegro* on the summary. Never clicked without both guards
   *  in {@link nextStepButton}. */
  submit: "submit-button",
  /** One card per format on *Szczegóły*, the format's name inside it. */
  offerType: "offer-type-selection",
  offerTypeName: "radio-selection-label",
  /** One card per saved delivery price list, named by **Allegro's own `shippingRatesId`** — which is
   *  exactly what the listing profile stores (#486), so this is a direct match and not a lookup. */
  shippingRate: "shipping-rate-option-",
  photoInput: "drag-drop-photo-upload",
  /** The fee panel, which only the summary has. */
  priceSummary: "price-summary",
} as const;

/** Allegro's description editor: a same-origin `contenteditable` (tiptap/ProseMirror), where the
 *  legacy form had TinyMCE inside an iframe. */
const DESCRIPTION = '[contenteditable="true"][aria-label="Opis oferty"]';

/** A thumbnail Allegro has accepted. The element carries the **uploaded image's own URL** as its test
 *  id, which is the one thing that cannot exist before the upload finished — so it is what the picture
 *  step waits for. */
const UPLOADED_PICTURE = '[data-testid^="https://"]';

/** Every field-level complaint the wizard renders, by the suffix Allegro names them all with
 *  (`photos-error`, and its siblings). Read only when a step refuses to advance, so that what is
 *  reported is the form's own words rather than our guess at them. */
const VALIDATION_ERROR = '[data-testid$="-error"]';

// ---------------------------------------------------------------------------------------------
// Where the form is, and which of its steps this is
// ---------------------------------------------------------------------------------------------

/**
 * The sale form's address.
 *
 * Nothing about the task goes into it. Allegro's form is not addressed by what is being sold, and the
 * one value that would narrow it — the category — is chosen from a name tree rather than carried in a
 * query. So this is a constant, and the work of getting to the fillable step is {@link
 * prepareAllegroSaleForm}'s.
 */
export function allegroSaleFormUrl(_task: ListingTask): string {
  return SALE_FORM_URL;
}

/** True for the wizard's address and for the legacy one it replaced — the old address still answers
 *  with a redirect into the wizard, and a collector who has it bookmarked lands there. */
export function isAllegroSaleFormUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  return (
    /^\/moje-allegro\/sprzedaz\/formularz-wystawiania(\/|$)/.test(parsed.pathname) ||
    /^\/moje-allegro\/recommerce\/formularz-wystawiania(\/|$)/.test(parsed.pathname)
  );
}

/** The wizard's steps, in the order it walks them. */
type Step = "product" | "describe" | "details" | "delivery" | "summary";

/**
 * Which step this document is showing, or null while it is still rendering.
 *
 * Structural, over a control each step has and no other does — never over the address, which the
 * wizard rewrites as it goes and which a fresh load does **not** restore: opening a draft's own
 * `…/draft/opis` serves an empty *Zdjęcia i opis*, the draft's values living in the page rather than
 * in the URL. The address is where the collector is; this is what is on the screen.
 *
 * The summary is asked first because it is the one step nothing may be written into.
 */
function whichStep(doc: Document): Step | null {
  if (doc.querySelector(byTestId(TESTID.priceSummary))) return "summary";
  if (byId(doc, FIELD.title)) return "describe";
  if (byId(doc, FIELD.price)) return "details";
  if (doc.querySelector(`[data-testid^="${TESTID.shippingRate}"]`)) return "delivery";
  if (byId(doc, FIELD.productSearch)) return "product";
  return null;
}

/**
 * True when this document **is** the step the fill starts on (#419's question).
 *
 * That step is *Zdjęcia i opis*, and the test is its title field: the entry page carries a search box
 * and no form to fill, and the wizard's later steps are reached by filling this one rather than by
 * being landed on. {@link prepareAllegroSaleForm} is what gets a page here.
 */
export function isAllegroSaleFormDocument(doc: Document): boolean {
  return whichStep(doc) === "describe";
}

// ---------------------------------------------------------------------------------------------
// Getting to the form (the entry sequence)
// ---------------------------------------------------------------------------------------------

/**
 * How long each kind of wait is given, and how often it looks.
 *
 * `page` is deliberately large: Allegro's form is a React app that renders **long** after its
 * document has loaded — half a minute is normal, and a page that is still blank is not a page that is
 * not coming. The content script arrives on the load event, so without it every decision below would
 * be made against an empty `<main>` and a run would fail on a page that was merely slow. `step` is one
 * round-trip inside a rendered page — a search, a modal, the wizard moving on — and `upload` is
 * longer than either, those being the run's only large requests.
 *
 * `filter` is deliberately **short**, and is the one wait that is not "how long could this take". A
 * combobox that is going to answer a typed phrase answers it in milliseconds; one that does not answer
 * has not opened, and the way out of that is {@link chooseFromDropdown}'s second attempt rather than
 * more waiting. Measured against the live form: a control that filtered did so in 19 ms, and one that
 * had not opened was still silent after six seconds. A long wait here only delays the fallback that
 * works, once per parameter.
 *
 * Overridable, but **only ever by tests**, exactly as Colnect's picture removal is: they have no
 * Allegro to answer them, and a case that is *meant* to time out would otherwise cost a minute of
 * real waiting each. The shell calls both entry points with the arguments the interface states.
 */
export interface AllegroWaits {
  page?: number;
  step?: number;
  upload?: number;
  filter?: number;
  poll?: number;
}

type Waits = Required<AllegroWaits>;

const DEFAULT_WAITS: Waits = { page: 60_000, step: 20_000, upload: 90_000, filter: 2_000, poll: 250 };

const waitsOf = (waits: AllegroWaits | undefined): Waits => ({ ...DEFAULT_WAITS, ...waits });

/**
 * Walk this page to the step the fill starts on (#493/#719).
 *
 * The entry is short now and none of it is a page load: *Wybór produktu* → a search → *Mojego
 * produktu tu nie ma* → *Zdjęcia i opis*. It stays separate from the fill for the reason it always
 * did — nothing here writes a value from the offer into a listing, it is navigation — and it stays
 * asynchronous because a search is a round-trip.
 *
 * The search phrase is the listing's own title, for one reason: Allegro will not offer the way past
 * its catalogue until a search has been run, and a search for what is actually being sold is the one
 * phrase that could also, occasionally, be useful. Nothing is ever chosen from the results: a listing
 * filed against Allegro's catalogue product is the catalog path this app deliberately does not take
 * (ADR-0026, #477's non-goals).
 *
 * Idempotent at every step, because a re-run may find the page anywhere in the wizard: a collector
 * who was already working on it, or a fill that came back for a second attempt.
 */
export async function prepareAllegroSaleForm(
  doc: Document,
  task: ListingTask,
  options?: AllegroWaits
): Promise<void> {
  const waits = waitsOf(options);
  // **Wait for the page before reading it.** Everything below is a decision about which of Allegro's
  // steps this is, and an app that has not rendered yet looks exactly like a page on none of them —
  // which is how a slow render turns into "the sale form could not be opened".
  const step = await waitFor(doc, () => whichStep(doc), waits.page, waits.poll);
  if (!step) {
    throw new Error("Allegro's sale form did not finish loading, so the Assistant could not fill it.");
  }

  // Allegro may open over the form with an unfinished draft it wants continued. It is a backdrop over
  // the whole page, so nothing below would reach anything until it is answered — and the only answer
  // this may give is *a new offer*: the other control on it **deletes** the collector's draft.
  await startANewOffer(doc, waits);

  if (step === "product") {
    await searchPastTheProductCatalogue(doc, task, waits);
    return;
  }
  // Anywhere past the first step, the fill starts by going back to the one it writes first. The step
  // strip carries a button per step already visited, which is the collector's own way back.
  if (step !== "describe") await goBackToDescribe(doc, waits);
}

/** Answer Allegro's *Kontynuuj wystawianie* prompt with **a new offer**, and never with the other
 *  button on it: *Usuń* throws away a draft the collector started and this run knows nothing about.
 *  Silent when no such dialog is open, which is the ordinary case. */
async function startANewOffer(doc: Document, waits: Waits): Promise<void> {
  const start = dialogControl(doc, /kontynuuj wystawianie/i, /chcę wystawić nową ofertę/i);
  if (!start) return;
  start.click();
  await waitFor(
    doc,
    () => (dialogTitled(doc, /kontynuuj wystawianie/i) ? null : true),
    waits.step,
    waits.poll
  );
}

/**
 * Get past the product catalogue, which a stamp is never in.
 *
 * The step will not let anything through until a search has been run: *Mojego produktu tu nie ma*
 * appears only with the results, and picking it is what opens *Zdjęcia i opis* — carrying the phrase
 * over as the title, which the fill then overwrites with the offer's own.
 */
async function searchPastTheProductCatalogue(
  doc: Document,
  task: ListingTask,
  waits: Waits
): Promise<void> {
  const search = byId<HTMLInputElement>(doc, FIELD.productSearch);
  if (!search) throw new Error("Allegro's sale form did not open on a page the Assistant recognises.");
  writeValue(search, task.title);

  const searchButton = buttonMatching(doc, /^szukaj$/i);
  if (!searchButton) throw new Error("Allegro's product search has no search button on this page.");
  searchButton.click();

  const skip = await waitFor(doc, () => noSuchProductControl(doc), waits.step, waits.poll);
  if (!skip) {
    throw new Error(
      "Allegro did not offer to continue without a catalogue product, so the sale form could not be opened."
    );
  }
  skip.click();
  if (!(await onDescribe(doc, waits))) {
    throw new Error("Allegro did not open its listing form after the product search.");
  }
}

/** *Mojego produktu tu nie ma* — a radio dressed as a card, so the clickable thing is the input. */
function noSuchProductControl(doc: Document): HTMLElement | null {
  for (const label of Array.from(doc.querySelectorAll<HTMLElement>("label"))) {
    if (!/mojego produktu tu nie ma/i.test(label.textContent ?? "")) continue;
    return label.querySelector<HTMLElement>('input[type="radio"]') ?? label;
  }
  return null;
}

/** Back to *Zdjęcia i opis* from wherever the page is, through the step strip's own button. */
async function goBackToDescribe(doc: Document, waits: Waits): Promise<void> {
  const back = stepButton(doc, /^zdjęcia i opis$/i);
  if (!back) throw new Error("Allegro's listing form is open past the step the Assistant fills first.");
  back.click();
  if (!(await onDescribe(doc, waits))) {
    throw new Error("Allegro would not go back to the step the Assistant fills first.");
  }
}

/** Wait for the wizard to be showing the step the fill starts on. */
function onDescribe(doc: Document, waits: Waits): Promise<true | null> {
  return waitFor(doc, () => (whichStep(doc) === "describe" ? true : null), waits.step, waits.poll);
}

/** One step of the wizard's own strip. Only steps already visited are buttons there; the rest are
 *  plain text, which is exactly the distinction wanted. The strip is rendered twice (Allegro draws one
 *  for each width), so the first match is taken. */
function stepButton(doc: Document, name: RegExp): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>("li button"));
  return buttons.find((b) => name.test((b.textContent ?? "").trim())) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Filling the form
// ---------------------------------------------------------------------------------------------

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

  /** Write a value into the text field with this id, or say why it could not be written. */
  write(doc: Document, id: string, label: string, value: string, display = value): void {
    const el = byId<FormField>(doc, id);
    if (!el) {
      this.skip(label, `Allegro's form has no ${label.toLowerCase()} field on this step.`);
      return;
    }
    if (el.disabled) {
      this.skip(label, "Allegro has this field switched off on this form.");
      return;
    }
    writeValue(el, value);
    this.fill(label, display);
  }

  /**
   * Choose an option in a native `select`, matched on its **value**.
   *
   * Picking the option rather than assigning the value: one the form does not offer would otherwise
   * be swallowed silently, and here it is the one thing worth refusing on.
   */
  choose(select: HTMLSelectElement | null, label: string, value: string, display = value): boolean {
    if (!select) {
      this.skip(label, `Allegro's form has no ${label.toLowerCase()} field on this step.`);
      return false;
    }
    const option = Array.from(select.options).find((o) => o.value === value);
    if (!option) {
      this.skip(label, `Allegro's form does not offer "${display}" here.`);
      return false;
    }
    selectOption(select, option);
    this.fill(label, display);
    return true;
  }

  /**
   * Choose an **ISO-8601 duration** in a select, matched by how long it is rather than by the string.
   *
   * The two are not the same question here. Allegro's API and Allegro's sale form state the very same
   * durations in different notations — the profile holds `P3D` because that is what
   * `POST /sale/product-offers` takes (#486), and the form offers `PT72H` — so a plain string match
   * silently selects nothing and leaves the form's default standing, which is exactly how a handling
   * time of three days went out as one day.
   */
  chooseDuration(select: HTMLSelectElement | null, label: string, iso: string): void {
    if (!select) {
      this.skip(label, `Allegro's form has no ${label.toLowerCase()} field on this step.`);
      return;
    }
    const wanted = isoDurationHours(iso);
    const option =
      wanted === null
        ? undefined
        : Array.from(select.options).find((o) => isoDurationHours(o.value) === wanted);
    if (!option) {
      this.skip(label, `Allegro's form does not offer ${label.toLowerCase()} "${iso}" here.`);
      return;
    }
    selectOption(select, option);
    this.fill(label, option.textContent?.trim() || option.value);
  }

  outcome(): ListingFillOutcome {
    return { filled: this.filled, skipped: this.skipped };
  }
}

/**
 * An ISO-8601 duration in hours, or null when it is not one this app writes.
 *
 * Only the shapes the two vocabularies use — days, hours, minutes, seconds — because that is the
 * whole of what Allegro states a handling time or a listing duration in, and a parser that accepted
 * months would have to decide how long one is.
 */
export function isoDurationHours(iso: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  return (
    Number(days ?? 0) * 24 +
    Number(hours ?? 0) +
    Number(minutes ?? 0) / 60 +
    Number(seconds ?? 0) / 3600
  );
}

/**
 * Fill the wizard from `task` and `photos`, and stop on *Podsumowanie* (#719).
 *
 * Three steps are written, in the wizard's own order, and each one is left by the form's own
 * *Kolejny krok*: *Zdjęcia i opis* (title, category, parameters, pictures, description), *Szczegóły*
 * (format, price, quantity, re-listing) and *Dostawa* (handling time, delivery price list, returns).
 * The fourth step is the summary, and the module's work ends the moment it is reached.
 *
 * **The pictures go in here**, in the middle, and that is not a preference: the wizard refuses to
 * leave *Zdjęcia i opis* without one, so a run that saved them for last — as the shell used to make
 * every module do (#411) — would never reach the price. Handing them over is therefore the first
 * thing in the run that writes to the marketplace at all, which is worth knowing and is why the
 * report says so.
 *
 * **A step that will not advance ends the fill**, with Allegro's own complaint about it in the
 * report: everything written so far stays written and in front of the collector, and the honest thing
 * is to say which step it stopped on rather than to keep clicking.
 */
export async function fillAllegroSaleForm(
  doc: Document,
  task: ListingTask,
  photos: readonly ListingPhotoFile[] = [],
  options?: AllegroWaits
): Promise<ListingFillOutcome> {
  const waits = waitsOf(options);
  const report = new FillReport();
  const allegro = task.allegro ?? null;

  report.write(doc, FIELD.title, "Title", task.title);

  // The category first, and everything else on this step after it: the parameters and the picture
  // uploader do not exist in the document until Allegro knows what is being sold.
  if (await chooseCategory(doc, allegro, report, waits)) {
    await revealEveryParameter(doc, waits);
    await fillParameters(doc, allegro, report, waits);
  }
  fillDescription(doc, task, report);
  await attachPictures(doc, photos, report, waits);

  if (!(await advance(doc, "describe", "Pictures and description", report, waits))) {
    return report.outcome();
  }

  await fillDetails(doc, task, allegro, report, waits);
  if (!(await advance(doc, "details", "Details", report, waits))) return report.outcome();

  await fillDelivery(doc, allegro, report, waits);
  await advance(doc, "delivery", "Delivery", report, waits);

  return report.outcome();
}

// ---------------------------------------------------------------------------------------------
// Step 1 — Zdjęcia i opis
// ---------------------------------------------------------------------------------------------

/**
 * File the listing under the offer's own category, by walking Allegro's name tree.
 *
 * The legacy form took the **number**, which is what the offer stores and what every other part of
 * this app speaks in. The new picker has no such field: it is a modal that drills down one level at a
 * time, and the only thing it can be driven by is the category's **name path** — which is why
 * `categoryPath` (#494, the breadcrumb walked up from the node itself) is the value read here and the
 * id is not.
 *
 * An offer that holds a category **id but no path** is therefore reported rather than guessed at.
 * Allegro offers a category of its own on this step, suggested from the title, and ticking it would
 * file somebody's stamps under a category nobody chose — the fill's whole promise is that what goes
 * into the form is what the offer says.
 *
 * The category is set even when one is already showing: the picker is the same modal either way
 * (*Wszystkie kategorie* when nothing is chosen, *Zmień* when something is), and walking the path is
 * cheaper than reading a breadcrumb and deciding whether it means the same thing.
 *
 * Answers whether the category is in — everything else on this step depends on it.
 */
async function chooseCategory(
  doc: Document,
  allegro: ListingTaskAllegro | null,
  report: FillReport,
  waits: Waits
): Promise<boolean> {
  const label = "Category";
  const path = splitCategoryPath(allegro?.categoryPath);
  if (path.length === 0) {
    report.skip(
      label,
      allegro?.categoryId
        ? `Allegro's new form picks a category from a list of names rather than by number, and this offer stores only ${allegro.categoryId} — re-match the category on the offer's Allegro card, then list again.`
        : "This offer has no Allegro category — set one on the offer's Allegro card."
    );
    return false;
  }

  const open = buttonMatching(doc, /^(wszystkie kategorie|zmień)$/i);
  if (!open) {
    report.skip(label, "Allegro's form has no category picker on this step.");
    return false;
  }
  open.click();
  if (!(await waitFor(doc, () => categoryPicker(doc), waits.step, waits.poll))) {
    report.skip(label, "Allegro's category picker would not open to the Assistant.");
    return false;
  }

  for (const name of path) {
    const picker = categoryPicker(doc);
    const entry = picker && categoryEntry(picker, name);
    if (!entry) {
      report.skip(label, `Allegro's category list has no "${name}" where this offer expects it.`);
      // A picker left half way down somebody else's tree is worse than one that was never opened.
      closeDialog(doc, categoryPicker(doc));
      return false;
    }
    entry.click();
    // Each level is a round-trip; the last one closes the modal instead of drawing another level.
    await waitFor(
      doc,
      () => (categoryEntry(categoryPicker(doc), name) ? null : true),
      waits.step,
      waits.poll
    );
  }

  // The parameters this category asks are what proves it landed — a picker that closed on nothing
  // would otherwise be reported as a category that went in.
  const settled = await waitFor(
    doc,
    () => (buttonMatching(doc, /^zmień$/i) ? true : null),
    waits.step,
    waits.poll
  );
  if (!settled) {
    report.skip(label, "Allegro did not take the category the Assistant chose.");
    return false;
  }
  report.fill(label, allegro?.categoryPath ?? path.join(" > "));
  return true;
}

/** A category breadcrumb as its own levels. Stored as `A > B > C` (#494) and rendered by Allegro with
 *  a different separator, so the string is split rather than compared. */
function splitCategoryPath(path: string | null | undefined): string[] {
  return (path ?? "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
}

function categoryPicker(doc: Document): HTMLElement | null {
  return dialogTitled(doc, /wybierz kategorię/i);
}

/** One level's entry in the picker, by its exact name — the level list carries a *Cofnij do …* button
 *  too, which contains a category's name without being it. */
function categoryEntry(picker: HTMLElement | null, name: string): HTMLElement | null {
  if (!picker) return null;
  const buttons = Array.from(picker.querySelectorAll<HTMLElement>("button"));
  return buttons.find((b) => (b.textContent ?? "").trim() === name) ?? null;
}

/**
 * Unfold the rest of the category's parameters.
 *
 * Allegro shows a handful and hides the rest behind *Pokaż więcej* — and a hidden control is not in
 * the document at all, so a fill that ran first would report half this category's answers as fields
 * the form does not have. The button names its own state (it reads *Pokaż mniej* once everything is
 * out), which is what this waits for.
 *
 * Silent when there is no such button: a category whose parameters all fit needs no unfolding.
 */
async function revealEveryParameter(doc: Document, waits: Waits): Promise<void> {
  const more = buttonMatching(doc, /^pokaż więcej$/i);
  if (!more) return;
  more.click();
  await waitFor(doc, () => buttonMatching(doc, /^pokaż mniej$/i), waits.step, waits.poll);
}

/**
 * The category's parameters, each answered in the control Allegro named after it.
 *
 * **Both sections are filled** — the offer's own and the product's (#494). The API path has to drop
 * the product half because `POST /sale/product-offers` refuses it there; this form asks for both, in
 * one list, and a collector filling it by hand would answer both.
 *
 * Two shapes, and the id says which: a dictionary parameter is the combobox `#dropdown-<id>` and a
 * free-text one is `#<id>`. The dictionary is answered by its **displayed text**, which is why the
 * answers travel with their display value beside the dictionary ids the API takes; a parameter with
 * no display value — Allegro unreachable when the task was built — is named rather than guessed at.
 */
async function fillParameters(
  doc: Document,
  allegro: ListingTaskAllegro | null,
  report: FillReport,
  waits: Waits
): Promise<void> {
  for (const parameter of allegro?.parameters ?? []) {
    const label = `Parameter — ${parameter.parameterName ?? parameter.parameterId}`;
    const [value] = parameter.displayValues;
    if (!value) {
      report.skip(label, "Allegro could not be asked what this answer is called on its own form.");
      continue;
    }
    if (byId(doc, dropdownId(parameter.parameterId))) {
      await chooseFromDropdown(doc, parameter.parameterId, label, value, report, waits);
    } else if (byId(doc, parameter.parameterId)) {
      report.write(doc, parameter.parameterId, label, value);
    } else {
      report.skip(label, "This category's form on Allegro has no field for that parameter.");
      continue;
    }
    // Several values in one control is Allegro's `multipleChoices`, which this form answers with one
    // row per value — worth naming rather than silently posting the first.
    if (parameter.displayValues.length > 1) {
      report.skip(
        `${label} — ${parameter.displayValues.slice(1).join(", ")}`,
        "Allegro takes one value per row here — add the rest by hand."
      );
    }
  }
}

const dropdownId = (parameterId: string): string => `dropdown-${parameterId}`;

/**
 * Answer one dictionary parameter, the way the collector answers it.
 *
 * The control is not a `select` but a **combobox**: an `<input role="combobox">` whose list is drawn
 * into `#dropdown-<id>-content` only while it is open, as `li[role="option"]` rows. So the value
 * cannot be assigned — it has to be typed and then chosen, which is also what makes the choice
 * verifiable.
 *
 * Typed first because that is what filters the list, and Allegro's own display value is what the row
 * reads. That attempt is given a **short** wait (`waits.filter`): a control that is going to answer
 * answers at once, and a silent one has not opened rather than being slow — Allegro mounts a
 * dictionary's options on the first input the control sees, so the *second* write is routinely what
 * opens it. Clearing the field is therefore both the fallback and the opener, and it asks for the
 * whole list, which also finds an option whose text differs from the display value by more than the
 * filter allows.
 *
 * **The field is left empty on a failure.** A combobox holding text that matches no option is an
 * invalid field, and an invalid field is what stops the wizard advancing three lines later — for a
 * value we already know did not go in.
 */
async function chooseFromDropdown(
  doc: Document,
  parameterId: string,
  label: string,
  value: string,
  report: FillReport,
  waits: Waits
): Promise<void> {
  const input = byId<HTMLInputElement>(doc, dropdownId(parameterId));
  if (!input) {
    report.skip(label, "This category's form on Allegro has no field for that parameter.");
    return;
  }
  const options = (): HTMLElement | null => {
    const list = byId<HTMLElement>(doc, `${dropdownId(parameterId)}-content`);
    if (!list) return null;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('li[role="option"] button'));
    return rows.find((row) => (row.textContent ?? "").trim() === value) ?? null;
  };

  writeValue(input, value);
  let option = await waitFor(doc, options, waits.filter, waits.poll);
  if (!option) {
    writeValue(input, "");
    option = await waitFor(doc, options, waits.step, waits.poll);
  }
  if (!option) {
    writeValue(input, "");
    report.skip(label, `Allegro's form does not offer "${value}" here.`);
    return;
  }
  option.click();
  report.fill(label, value);
}

/**
 * The description, into Allegro's own editor.
 *
 * It is a same-origin `contenteditable` (tiptap/ProseMirror) rather than the iframe TinyMCE used to
 * put here, and it is in the document from the start — no click is needed to bring it to life. The
 * text goes in as **HTML**, followed by an `input` event, which is what the editor listens for to
 * notice a change it did not make itself.
 *
 * The text is written as it stands. It arrives already in the format the offer stores (#319) and
 * Allegro's own field takes a small set of tags, so a description that renders as markup here is the
 * same one the API path sends.
 */
function fillDescription(doc: Document, task: ListingTask, report: FillReport): void {
  const label = "Description";
  const text = task.description?.trim();
  if (!text) return; // Nothing to say — an empty description is not a gap.

  const editor = doc.querySelector<HTMLElement>(DESCRIPTION);
  if (!editor) {
    report.skip(label, "Allegro's description editor is not on this page — paste it in yourself.");
    return;
  }
  editor.innerHTML = task.descriptionFormat === "plain" ? paragraphs(text) : text;
  dispatch(editor, "input");
  report.fill(label, text);
}

/** Plain text as the editor's own paragraphs — a description written as plain (#319) has its line
 *  breaks as its only structure, and pasting it as one block loses them. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PICTURES_FIELD = "Pictures";

/**
 * Hand the offer's rendered images to the wizard's own uploader, in upload order (#411).
 *
 * This is the **first thing in the run that writes to Allegro**: the uploader posts each file the
 * moment it is handed over, and the thumbnails that come back carry the uploaded image's own URL —
 * which is exactly what is waited for here, an upload still in flight being the ordinary reason the
 * next step refuses.
 *
 * It cannot be moved later. Allegro will not leave this step without a picture, so a run with none
 * stops here — reported plainly, since the fix is in Stamporama (the offer's rendered pictures) and
 * not on this form.
 */
async function attachPictures(
  doc: Document,
  photos: readonly ListingPhotoFile[],
  report: FillReport,
  waits: Waits
): Promise<void> {
  if (photos.length === 0) return; // The shell has already said why (#411).

  const input = allegroPictureInput(doc);
  if (!input) {
    report.skip(PICTURES_FIELD, "Allegro's picture uploader is not on this step.");
    return;
  }
  const before = uploadedPictures(doc);
  putFiles(input, photos.map((p) => p.file));
  dispatch(input, "change");

  const arrived = await waitFor(
    doc,
    () => {
      // Answered while waiting rather than after: Allegro has asked an AI-Act question over its
      // uploader before, behind a flag, and a dialog nobody answers is an upload that never finishes.
      declineAiWatermark(doc);
      return uploadedPictures(doc) >= before + photos.length ? true : null;
    },
    waits.upload,
    waits.poll
  );
  if (!arrived) {
    report.skip(
      PICTURES_FIELD,
      `Allegro took ${uploadedPictures(doc) - before} of ${photos.length} pictures before the Assistant stopped waiting — add the rest from the offer's ZIP.`
    );
    return;
  }
  report.fill(PICTURES_FIELD, `${photos.length} uploaded`);
}

/** How many pictures Allegro has taken — counted by the thumbnails it stamps with the uploaded
 *  image's own address, which cannot exist before the upload finished. */
function uploadedPictures(doc: Document): number {
  return doc.querySelectorAll(UPLOADED_PICTURE).length;
}

/** The dialog Allegro has opened over a picture upload: the AI Act marking question. */
const AI_WATERMARK_TITLE = /znakiem wodnym/i;

/**
 * Confirm Allegro's AI-watermark dialog with **nothing ticked**, if it is open.
 *
 * Allegro asks which pictures should carry an "AI" watermark under the AI Act. Every box starts
 * unticked, which is the truthful answer for an offer's pictures: they are photographs of stamps,
 * rendered by Stamporama from those photographs, and nothing in that path is generative. So this
 * confirms the default rather than choosing anything — **the one thing it must never do is tick a
 * box**, since that would put a claim on the listing that the collector did not make and that is not
 * true.
 *
 * Matched on the dialog's own **title**, not on the button alone: *Potwierdź wybór* is a button
 * Allegro could put on any dialog, and confirming the wrong one is a click nobody asked for.
 *
 * It was not served on the new form when it was mapped (#719) — it is behind a flag — so its absence
 * is the ordinary case and costs one query per poll.
 */
function declineAiWatermark(doc: Document): void {
  dialogControl(doc, AI_WATERMARK_TITLE, /potwierdź wybór/i)?.click();
}

/** The wizard's picture input, behind its drop area — Allegro's own test id, with the `accept` a
 *  picture uploader carries as the fallback. */
export function allegroPictureInput(doc: Document): HTMLInputElement | null {
  const named = doc.querySelector<HTMLInputElement>(`input${byTestId(TESTID.photoInput)}`);
  if (named) return named;
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  return inputs.find((el) => /jpe?g|png|gif|image/i.test(el.getAttribute("accept") ?? "")) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Step 2 — Szczegóły
// ---------------------------------------------------------------------------------------------

/**
 * What it is being sold as, for how much, and how many there are.
 *
 * The **format is a reshaping** rather than a field: ticking *Licytacja* grows a duration select and
 * an opening price and takes the quantity away, none of which is in the document beforehand. So it is
 * chosen first and everything after it is read from the form the choice produced.
 *
 * One thing is deliberately **not** written on an auction: *Dodaj Licytację z opcją Kup teraz*. A Buy
 * Now price on an auction is a second way of selling that the offer never asked for.
 *
 * A quick buy has no duration on this form at all — Allegro fixes it at 30 days and says so beside
 * the format — so a profile's `durationLimit` only ever reaches an auction, and is reported rather
 * than silently dropped.
 */
async function fillDetails(
  doc: Document,
  task: ListingTask,
  allegro: ListingTaskAllegro | null,
  report: FillReport,
  waits: Waits
): Promise<void> {
  const auction = allegro?.listingType === "auction";
  await chooseOfferType(doc, auction, report, waits);

  if (auction) {
    const profile = allegro?.profile;
    if (profile?.durationLimit) {
      report.chooseDuration(
        selectById(doc, FIELD.auctionDuration),
        "Listing duration",
        profile.durationLimit
      );
    }
    report.write(doc, FIELD.price, "Starting price", allegro?.startingPrice ?? task.price);
  } else {
    if (allegro?.profile?.durationLimit) {
      report.skip(
        "Listing duration",
        "Allegro's new form runs a quick buy for 30 days and offers no choice — the profile's duration only applies to an auction."
      );
    }
    report.write(doc, FIELD.price, "Price", task.price);
    writeQuantity(doc, task.quantity, report);
  }

  // A switch the profile decides, so it is written in **both** directions rather than only turned on:
  // a profile that says "do not re-list" is an answer, and leaving Allegro's control as served would
  // make it depend on what Allegro happened to serve.
  if (allegro?.profile) {
    setSwitch(doc, allegro.profile.autoRepublish, "Automatic re-listing", report);
  }
}

/** Tick *Kup teraz* or *Licytacja*, and wait for the fields the choice brings with it. A format
 *  already chosen is left alone — the click is only ever the one the collector would have made. */
async function chooseOfferType(
  doc: Document,
  auction: boolean,
  report: FillReport,
  waits: Waits
): Promise<void> {
  const label = "Offer type";
  const name = auction ? "Licytacja" : "Kup teraz";
  const radio = offerTypeRadio(doc, name);
  if (!radio) {
    report.skip(label, `Allegro's form does not offer "${name}" on this step.`);
    return;
  }
  if (!radio.checked) {
    radio.click();
    // What the choice grows: an auction's own duration select, a quick buy's quantity.
    await waitFor(
      doc,
      () => (auction ? selectById(doc, FIELD.auctionDuration) : quantityInput(doc)),
      waits.step,
      waits.poll
    );
  }
  report.fill(label, name);
}

function offerTypeRadio(doc: Document, name: string): HTMLInputElement | null {
  for (const card of Array.from(doc.querySelectorAll<HTMLElement>(byTestId(TESTID.offerType)))) {
    const shown = card.querySelector(byTestId(TESTID.offerTypeName))?.textContent?.trim() ?? "";
    if (shown !== name) continue;
    return card.querySelector<HTMLInputElement>('input[type="radio"]');
  }
  return null;
}

/**
 * How many sets there are.
 *
 * The control is the step's own number spinner and Allegro gives it no id, so it is found by being
 * the only `input[type="number"]` on the step — and **only** while it is the only one, because a
 * second number field appearing here is a form this module has not been shown, and writing the
 * quantity into it would be worse than saying so.
 */
function writeQuantity(doc: Document, quantity: number, report: FillReport): void {
  const label = "Quantity";
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  if (inputs.length !== 1) {
    report.skip(
      label,
      inputs.length === 0
        ? "Allegro's form has no quantity field on this step."
        : "Allegro's form has more than one number field on this step — set the quantity yourself."
    );
    return;
  }
  writeValue(inputs[0]!, String(quantity));
  report.fill(label, String(quantity));
}

/**
 * Put the re-listing switch into the state the profile asks for.
 *
 * Clicked rather than assigned, because the control belongs to a React form and a `checked` set
 * behind its back is a value the next render throws away — and never clicked when it already reads
 * what it should, since a click is a toggle and would then undo the very thing it is asked for.
 */
function setSwitch(doc: Document, wanted: boolean, label: string, report: FillReport): void {
  const switches = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][role="switch"]')
  );
  if (switches.length !== 1) {
    report.skip(label, `Allegro's form has no ${label.toLowerCase()} switch on this step.`);
    return;
  }
  const box = switches[0]!;
  const checked = typeof box.checked === "boolean" ? box.checked : box.hasAttribute("checked");
  if (checked !== wanted) box.click();
  report.fill(label, wanted ? "on" : "off");
}

// ---------------------------------------------------------------------------------------------
// Step 3 — Dostawa
// ---------------------------------------------------------------------------------------------

/**
 * Delivery, handling time and returns, from the offer's listing profile (#486).
 *
 * Two of the profile's three ids **are** Allegro's own: `shippingRatesId` is the test id of the price
 * list's card and `returnPolicyId` is the value of the returns option, so both are direct matches
 * rather than translations. The handling time is a duration and is matched by length (see
 * {@link FillReport.chooseDuration}).
 *
 * The sending address is not a field here either: Allegro keeps it as an account setting behind
 * *Zmień adres wysyłki*, so the profile's city and post code are *reported* — the collector checks the
 * line the form already shows, which is the only thing that can honestly be done about a value with
 * nowhere to go.
 */
async function fillDelivery(
  doc: Document,
  allegro: ListingTaskAllegro | null,
  report: FillReport,
  waits: Waits
): Promise<void> {
  const profile = allegro?.profile;
  if (!profile) {
    report.skip(
      "Delivery",
      "This offer has no Allegro listing profile, so delivery, returns and the sending address are left as Allegro served them."
    );
    return;
  }

  report.chooseDuration(handlingTimeSelect(doc), "Handling time", profile.handlingTime);
  await chooseShippingRates(doc, profile.shippingRatesId, profile.shippingRatesName, report, waits);
  if (profile.returnPolicyId) {
    report.choose(
      selectOfferingValue(doc, profile.returnPolicyId),
      "Returns",
      profile.returnPolicyId,
      profile.returnPolicyName ?? profile.returnPolicyId
    );
  }

  report.skip(
    "Sending address",
    `Allegro takes this from the account, not from the form — check it reads ${profile.locationPostCode} ${profile.locationCity}.`
  );
}

/**
 * Tick the profile's delivery price list.
 *
 * Allegro shows three of the account's saved lists and keeps the rest behind *Inne zapisane dostawy*,
 * a dialog of its own — so a list that is not on the step is fetched from there and saved back onto
 * it, which is exactly the two clicks a collector makes.
 */
async function chooseShippingRates(
  doc: Document,
  ratesId: string,
  ratesName: string | null,
  report: FillReport,
  waits: Waits
): Promise<void> {
  const label = "Delivery price list";
  const display = ratesName ?? ratesId;

  let card = shippingRateCard(doc, ratesId);
  if (!card) {
    const more = buttonMatching(doc, /^inne zapisane dostawy/i);
    if (!more) {
      report.skip(label, `Allegro's form does not offer "${display}" on this step.`);
      return;
    }
    more.click();
    const saved = await waitFor(
      doc,
      () => dialogTitled(doc, /zapisane dostawy/i),
      waits.step,
      waits.poll
    );
    const inDialog = saved && shippingRateCard(saved, ratesId);
    if (!inDialog) {
      closeDialog(doc, saved);
      report.skip(label, `Allegro's saved delivery lists do not include "${display}".`);
      return;
    }
    tickCard(inDialog);
    dialogControl(doc, /zapisane dostawy/i, /^zapisz$/i)?.click();
    card = await waitFor(doc, () => shippingRateCard(doc, ratesId), waits.step, waits.poll);
    if (!card) {
      report.skip(label, `Allegro did not bring "${display}" onto the form.`);
      return;
    }
  }

  tickCard(card);
  report.fill(label, display);
}

function shippingRateCard(root: Document | HTMLElement, ratesId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${TESTID.shippingRate}${ratesId}"]`);
}

/** Choose one of the cards this step is a list of — the clickable thing inside is the radio. */
function tickCard(card: HTMLElement): void {
  const radio = card.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) return;
  if (!radio.checked) radio.click();
}

/**
 * The handling-time select — the one on this step whose every option is an ISO-8601 duration.
 *
 * Allegro gives neither select on this step an id, and the other one lists return policies, so what
 * tells them apart is what they are lists **of**. That is a sturdier test than a position: a step that
 * grows a third select does not silently move the handling time.
 */
function handlingTimeSelect(doc: Document): HTMLSelectElement | null {
  for (const select of Array.from(doc.querySelectorAll<HTMLSelectElement>("select"))) {
    const values = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);
    if (values.length > 0 && values.every((v) => isoDurationHours(v) !== null)) return select;
  }
  return null;
}

/** The select on this page that offers `value` — how the returns policy is found, its id being
 *  Allegro's own and therefore the surest thing to look for. */
function selectOfferingValue(doc: Document, value: string): HTMLSelectElement | null {
  const selects = Array.from(doc.querySelectorAll<HTMLSelectElement>("select"));
  return selects.find((s) => Array.from(s.options).some((o) => o.value === value)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Moving between the steps
// ---------------------------------------------------------------------------------------------

/**
 * Leave `from` for the next step, and say so when the form will not let go.
 *
 * `from` is passed rather than read so the caller's own idea of where it is has to agree with the
 * page's — a fill that thought it was on *Szczegóły* while the page had moved on would otherwise
 * click a button on a step it never wrote to.
 *
 * A refusal is reported in **Allegro's own words**: the wizard renders a complaint per field it is
 * unhappy about, and "Dodaj przynajmniej jedno zdjęcie" tells the collector more than any sentence
 * this module could compose. Everything already written stays written; the fill simply ends there.
 */
async function advance(
  doc: Document,
  from: Step,
  label: string,
  report: FillReport,
  waits: Waits
): Promise<boolean> {
  if (whichStep(doc) !== from) {
    report.skip(label, "Allegro's form moved on before the Assistant had finished this step.");
    return false;
  }
  const next = nextStepButton(doc);
  if (!next) {
    report.skip(label, "Allegro's form has no way on from this step.");
    return false;
  }
  next.click();
  const moved = await waitFor(doc, () => (whichStep(doc) === from ? null : true), waits.step, waits.poll);
  if (moved) return true;

  const complaints = validationErrors(doc);
  report.skip(
    label,
    complaints.length > 0
      ? `Allegro would not go on from this step: ${complaints.join("; ")}`
      : "Allegro would not go on from this step."
  );
  return false;
}

/**
 * The *Kolejny krok* button — and **never** *Wystaw na Allegro*.
 *
 * Allegro gives both the same `data-testid`, which is the one fact on this page that could turn a
 * fill into a published listing. Nothing is submitted here or anywhere in this module (#408), so the
 * button is checked twice over: {@link advance} refuses to click on any step but the three it writes,
 * and this refuses any button whose own words say it posts the listing. Either guard alone would do;
 * both are here because the cost of being wrong is a listing the collector never saw.
 */
function nextStepButton(doc: Document): HTMLElement | null {
  const button = doc.querySelector<HTMLElement>(`button${byTestId(TESTID.submit)}`);
  if (!button) return null;
  if (/wystaw/i.test((button.textContent ?? "").trim())) return null;
  return button;
}

/** Everything the wizard is complaining about, in the order it draws them. */
function validationErrors(doc: Document): string[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(VALIDATION_ERROR))
    .map((el) => (el.textContent ?? "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// The listing that comes out the other end
// ---------------------------------------------------------------------------------------------

/**
 * The listed offer's own URL, once the form has been submitted (#412) — null for every other page.
 *
 * Allegro answers a published listing with `/oferta/<slug>-<id>`, which is the very shape the capture
 * half already recognises (#355) and the one #467 matches a synced listing on. So a listing posted
 * this way is found by exactly the rule a hand-posted one is.
 *
 * Query and fragment are dropped: this is stored on the offer as the listing's address, and a campaign
 * parameter Allegro appended is not part of that record.
 */
export function allegroListedOfferUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (!/^\/oferta\//.test(parsed.pathname)) return null;
  // Only a page that names an offer id — `/oferta/` alone is a listing of nothing.
  if (!allegroOfferId(url)) return null;
  return `${parsed.origin}${parsed.pathname}`;
}

/** The legacy form's confirmation, which it rendered **in place** of itself. Still recognised: it
 *  costs one `getElementById` and it is the one landmark that was ever observed with certainty. */
const THANK_YOU_PAGE = "thank-you-page";

/**
 * The listing's URL as Allegro's own confirmation states it (#412/#493).
 *
 * Allegro's legacy form did not navigate when it was posted: the same document re-rendered into
 * *Oferta jest przygotowana*, carrying the offer's address as a link and leaving the address bar on
 * the form. So this is where the URL was, and reading it is what let the offer go live here.
 *
 * The wizard's confirmation was **not observed** — reading it would have meant publishing a listing
 * from the collector's own account — so the rule is written to survive either shape it takes. It is
 * asked only of the page the form was filled into, and only once that page has **stopped being any
 * step of the wizard**: a document at the form's address that is no longer the form, carrying a link
 * to an `/oferta/<id>`, is a listing that was just posted and nothing else. If Allegro navigates to
 * the offer instead, the run never needs this at all — the background reads a listed URL off the
 * tab's own navigations (#412).
 */
export function allegroListedUrlInDocument(doc: Document): string | null {
  const legacy = byId<HTMLElement>(doc, THANK_YOU_PAGE);
  const scope = legacy ?? (whichStep(doc) === null ? doc.querySelector<HTMLElement>("main") : null);
  if (!scope) return null;
  for (const anchor of Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const listed = allegroListedOfferUrl(anchor.href);
    if (listed) return listed;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------------------------

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const byTestId = (testId: string): string => `[data-testid="${testId}"]`;

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== HOST && !host.endsWith(`.${HOST}`)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function byId<T extends Element>(doc: Document, id: string): T | null {
  // `getElementById` takes the id verbatim, which matters: Allegro's parameter ids are numbers, and
  // `#213` is not a valid CSS selector.
  return (doc.getElementById(id) as T | null) ?? null;
}

/** A `<select>` by id, without an `instanceof` against a global the test DOM does not install. */
function selectById(doc: Document, id: string): HTMLSelectElement | null {
  const el = byId<FormField>(doc, id);
  return el && "options" in el ? (el as HTMLSelectElement) : null;
}

/** Tell the page a field changed, through its own window's `Event` where there is one — the form is
 *  React-rendered and every control it draws is listening. */
function dispatch(el: Element, type: string): void {
  const view = el.ownerDocument?.defaultView as { Event?: typeof Event } | null;
  const Ctor = view?.Event ?? Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
}

/** Choose one option of a native select, and tell the page. */
function selectOption(select: HTMLSelectElement, option: HTMLOptionElement): void {
  option.selected = true;
  dispatch(select, "input");
  dispatch(select, "change");
}

/**
 * Write into a text field the way typing does.
 *
 * The value goes through the **native** setter rather than the element's own, because React installs
 * a property descriptor over `value` and tracks the last value it wrote: assigning directly updates
 * the DOM and leaves React's copy behind, so the next render puts the old value back. Setting through
 * the prototype and then dispatching `input` is what makes the page believe it was typed.
 */
function writeValue(el: FormField, value: string): void {
  const view = el.ownerDocument?.defaultView as
    | { HTMLInputElement?: typeof HTMLInputElement; HTMLTextAreaElement?: typeof HTMLTextAreaElement }
    | null;
  const proto =
    el.tagName === "TEXTAREA"
      ? (view?.HTMLTextAreaElement ?? HTMLTextAreaElement)?.prototype
      : (view?.HTMLInputElement ?? HTMLInputElement)?.prototype;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
  if (setter) setter.call(el, value);
  else el.value = value;
  dispatch(el, "input");
  dispatch(el, "change");
}

/** An open dialog by its own heading — the only thing that tells Allegro's modals apart, every one of
 *  them being `[role="dialog"]` and every class on them hashed. */
function dialogTitled(doc: Document, title: RegExp): HTMLElement | null {
  for (const dialog of Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    const heading = dialog.querySelector("h1, h2, h3, #modal-title")?.textContent ?? "";
    if (title.test(heading)) return dialog;
  }
  return null;
}

/** One named control inside one named dialog. Both halves matter: *Potwierdź wybór* and *Zapisz* are
 *  buttons Allegro puts on more than one modal, and pressing the wrong one is a click nobody asked
 *  for. */
function dialogControl(doc: Document, title: RegExp, control: RegExp): HTMLElement | null {
  const dialog = dialogTitled(doc, title);
  if (!dialog) return null;
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
  return buttons.find((b) => control.test((b.textContent ?? "").trim())) ?? null;
}

/** Shut a dialog this module opened and could not use — through its own close control, and never by
 *  anything that would decide something inside it. */
function closeDialog(_doc: Document, dialog: HTMLElement | null): void {
  if (!dialog) return;
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
  const close = buttons.find((b) => {
    const label = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "";
    return /zamknij/i.test(label) || /^zamknij$/i.test((b.textContent ?? "").trim());
  });
  close?.click();
}

function buttonMatching(doc: Document, pattern: RegExp): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>("main button"));
  return buttons.find((b) => pattern.test((b.textContent ?? "").trim())) ?? null;
}

/** The step's quantity spinner, used as a landmark while the format's own fields appear. */
function quantityInput(doc: Document): HTMLInputElement | null {
  return doc.querySelector<HTMLInputElement>('input[type="number"]');
}

/** Wait for `find` to answer, or give up. Polling rather than a `MutationObserver` because what is
 *  waited for is a network round-trip inside a React render, and the honest question is "is it there
 *  now" rather than "did anything change". */
async function waitFor<T>(
  doc: Document,
  find: () => T | null,
  timeoutMs: number,
  pollMs: number
): Promise<T | null> {
  const view = doc.defaultView ?? (globalThis as unknown as Window);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise<void>((resolve) => view.setTimeout(resolve, pollMs));
  }
}

/** Put `files` into a file input the way a drop does — through a `DataTransfer`, the only assignable
 *  source of a `FileList`, built from the page's own realm. */
function putFiles(input: HTMLInputElement, files: File[]): void {
  const view = input.ownerDocument?.defaultView as { DataTransfer?: typeof DataTransfer } | null;
  const Ctor =
    view?.DataTransfer ?? (globalThis as { DataTransfer?: typeof DataTransfer }).DataTransfer;
  if (!Ctor) throw new Error("This browser will not let the Assistant attach files to a form.");
  const dt = new Ctor();
  for (const file of files) dt.items.add(file);
  input.files = dt.files;
}

/** The Allegro module's listing half (#493, rewritten for the recommerce wizard in #719). */
export const allegroListing: PlatformListing = {
  formUrl: allegroSaleFormUrl,
  isFormUrl: isAllegroSaleFormUrl,
  isFormDocument: isAllegroSaleFormDocument,
  prepare: prepareAllegroSaleForm,
  takesPhotos: true,
  fill: fillAllegroSaleForm,
  listedUrl: allegroListedOfferUrl,
  listedUrlInDocument: allegroListedUrlInDocument,
};
