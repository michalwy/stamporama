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

// The Allegro half of the listing capability (#493, part of #155): walk Allegro's own entry pages to
// its sale form, then fill the form from the neutral task (#405) plus the offer's Allegro section
// (#494). Everything Allegro-specific — the addresses, the element ids, the entry sequence — lives
// here and nowhere else.
//
// **Why a form at all**, when #477 already publishes through the API: `POST /sale/product-offers` is
// open to business accounts only, and a private seller's grant is refused the first time a listing
// goes out (ADR-0027 §4c). The API path stays and stays the better one where it works; this is the
// path that works today.
//
// Three rules shape the module:
//
//   • **Nothing is submitted.** Filling stops before *wystaw i zaakceptuj warunki*; the collector
//     clicks Allegro's own button.
//   • **No class names, ever** (#355's rule for this marketplace). Every class on an Allegro page is
//     hashed per build. What is used instead are the form's **element ids**, which are the site's own
//     field vocabulary — and, for the category parameters, *Allegro's own parameter ids*: the control
//     answering parameter `213` is `#213`. A mapping this direct is why the form is worth filling.
//   • **Nothing pre-filled is overwritten** unless the offer has something to say about it. A form
//     Allegro served with the collector's own defaults in it is theirs.
//
// Two forms exist and a Regular account is pushed to the newer one. Every direct navigation to the
// legacy address answers with `…/recommerce/formularz-wystawiania/produkt`; the one-screen legacy
// form loads only when *that* page's own opt-out link is followed. So the module drives the entry
// (see {@link prepareAllegroSaleForm}) rather than pretending the address is enough.

const HOST = "allegro.pl";

/** The legacy one-screen sale form. Opening it is what starts a run, redirect and all. */
const SALE_FORM_URL = `https://${HOST}/moje-allegro/sprzedaz/formularz-wystawiania`;

/** The ids the legacy form addresses its own fields by (mapped 2026-08-05). */
const FIELD = {
  /** The category number, in the entry modal — typing it is what opens the form in that category. */
  categoryId: "category-id",
  title: "name",
  price: "buynow-price",
  quantity: "quantity",
  shippingRates: "shippingRatesId",
  handlingTime: "estimatedShippingTimeId",
  returnPolicy: "return-policies",
  /** How long a quick buy runs. An auction has **its own** select and this one is not on the form at
   *  all while the format is ticked — the two are never both present. */
  duration: "durationLimit",
  auction: "auction-checkbox",
  auctionStartingPrice: "auction-starting-price",
  auctionDuration: "auctionDurationSelect",
  republish: "checkbox-republish",
  /** TinyMCE's editable document, inside the description section. */
  descriptionFrame: "id_ifr",
} as const;

/** The description section's own container — the one place on this form that is addressed by a test
 *  id rather than by an element id, Allegro giving its editor no id of its own. */
const DESCRIPTION_SECTION = '[data-testid="description-section-container"]';

/** The product-search field of the legacy entry page — the step before the category modal. */
const PRODUCT_SEARCH = "product-search-phrase-field";

// ---------------------------------------------------------------------------------------------
// Where the form is, and what it is
// ---------------------------------------------------------------------------------------------

/**
 * The sale form's address.
 *
 * Nothing about the task goes into it: Allegro's form is not addressed by what is being sold, and
 * the one value that *would* narrow it — the category — is typed into the entry modal rather than
 * carried in a query (a `?categoryId=` is dropped along with the rest of the URL by the redirect).
 * So this is a constant, and the work of getting to the right form is {@link prepareAllegroSaleForm}'s.
 */
export function allegroSaleFormUrl(_task: ListingTask): string {
  return SALE_FORM_URL;
}

/** True for either sale form's address — the legacy one and the newer *recommerce* one Allegro
 *  redirects a Regular account to, since a redirect is exactly what {@link allegroSaleFormUrl}'s own
 *  address answers with. Both are pages this run passes through. */
export function isAllegroSaleFormUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  return (
    /^\/moje-allegro\/sprzedaz\/formularz-wystawiania(\/|$)/.test(parsed.pathname) ||
    /^\/moje-allegro\/recommerce\/formularz-wystawiania(\/|$)/.test(parsed.pathname)
  );
}

/**
 * True when this document **is** the legacy sale form, rather than one of the pages on the way to it
 * (#419's question, asked of a marketplace that answers its own address with three different pages).
 *
 * Structural, over two controls the fill is about to write: the title and the asking price. Both
 * together rather than either alone, because the entry pages carry a search field and a modal and
 * neither of them is a form to fill — and because a single id is a thinner promise than the pair.
 */
export function isAllegroSaleFormDocument(doc: Document): boolean {
  return byId(doc, FIELD.title) !== null && byId(doc, FIELD.price) !== null;
}

// ---------------------------------------------------------------------------------------------
// Getting to the form (the entry sequence)
// ---------------------------------------------------------------------------------------------

/**
 * How long the entry page itself is waited for.
 *
 * Deliberately large. Allegro's legacy form is a React app that renders **long** after its document
 * has loaded — half a minute is normal, and a page that is still blank is not a page that is not
 * coming. The content script arrives on the load event, so without this wait every step below would
 * be decided against an empty `<main>` and the run would fail on a page that was merely slow.
 */
const PAGE_TIMEOUT_MS = 60_000;

/** How long one step *inside* a rendered page is waited for — a search round-trip, a modal opening. */
const STEP_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

/**
 * Walk this page one step closer to the sale form (#493).
 *
 * The entry is a sequence and only its ends are navigations: *recommerce landing* → (load) → *product
 * search* → SZUKAJ → *Kontynuuj bez wybierania produktu* → the **category modal** → the category
 * number → (load) → the sale form. The middle steps happen inside one document and are asynchronous,
 * which is why this exists at all: `fill` is synchronous DOM work and cannot wait for a search.
 *
 * It is deliberately **not** a fill. Nothing it does is a value from the offer except the category —
 * which is not a field on the form at all, but the thing that decides which form there is. It stops
 * as soon as it has caused a navigation, the document then being on its way out.
 *
 * The search phrase is the listing's own title, for one reason: Allegro will not offer *Kontynuuj bez
 * wybierania produktu* until a search has been run, and a search for what is actually being sold is
 * the one phrase that could also, occasionally, be useful.
 */
export async function prepareAllegroSaleForm(doc: Document, task: ListingTask): Promise<void> {
  // **Wait for the page before reading it.** Everything below is a decision about which of Allegro's
  // pages this is, and an app that has not rendered yet looks exactly like a page with none of them
  // on it — which is how a slow render turns into "the sale form could not be opened".
  const landmark = await waitFor(doc, () => whichPage(doc), PAGE_TIMEOUT_MS);
  if (!landmark) {
    throw new Error("Allegro's sale form did not finish loading, so the Assistant could not fill it.");
  }
  // On the form itself, preparing means **revealing what is folded away**: Allegro serves a short
  // list of parameters behind *więcej parametrów*, and an auction's own fields do not exist until the
  // format is ticked. Both are React re-renders, which is the whole reason this step is async and the
  // fill is not.
  if (landmark === "form") {
    await revealEveryParameter(doc);
    await openAuctionFields(doc, task);
    await mountDescriptionEditor(doc, task);
    return;
  }

  // The newer form. Its opt-out link is the only way back to the one-screen form, and following it
  // is a full page load, so this is the whole of this document's part.
  if (landmark === "recommerce") {
    legacyFormLink(doc)?.click();
    return;
  }

  const category = task.allegro?.categoryId?.trim();
  if (!category) {
    throw new Error(
      "This offer has no Allegro category, so there is no form to open — set one on the offer's Allegro card."
    );
  }

  // The category modal may already be open (a re-run on a page the collector left there).
  if (landmark === "search") {
    await searchPastTheProductCatalogue(doc, task);
  }

  const field = await waitFor(doc, () => byId<HTMLInputElement>(doc, FIELD.categoryId));
  if (!field) {
    throw new Error("Allegro did not offer its category field, so the sale form could not be opened.");
  }
  writeValue(field, category);
  submitField(field);
}

/**
 * Unfold the rest of the category's parameters.
 *
 * Allegro shows a handful and hides the rest behind *więcej parametrów* — and a hidden control is not
 * in the document at all, so a fill that ran first would report half this category's answers as
 * fields the form does not have. The button names its own state (it reads *mniej parametrów* once
 * everything is out), which is what this waits for.
 *
 * Silent when there is no such button: a category whose parameters all fit needs no unfolding.
 */
async function revealEveryParameter(doc: Document): Promise<void> {
  const more = buttonMatching(doc, /^więcej parametrów$/i);
  if (!more) return;
  more.click();
  await waitFor(doc, () => buttonMatching(doc, /^mniej parametrów$/i), STEP_TIMEOUT_MS);
}

/**
 * Tick *licytacja* for an offer that is an auction (#449), and wait for the fields that appear with
 * it.
 *
 * The format is not a field but a **reshaping**: ticking it grows an opening price and a minimum
 * price, and swaps the quick buy's duration select for the auction's own — none of which exists in
 * the document beforehand. So it belongs here rather than in the fill, and the fill can then write
 * those fields as plainly as any other.
 *
 * A quick buy touches none of this, and a box already ticked is left alone: this is the collector's
 * form and the click is only ever the one they would have made.
 */
async function openAuctionFields(doc: Document, task: ListingTask): Promise<void> {
  if (task.allegro?.listingType !== "auction") return;
  const checkbox = byId<HTMLInputElement>(doc, FIELD.auction);
  if (!checkbox || checkbox.checked) return;
  checkbox.click();
  await waitFor(doc, () => byId(doc, FIELD.auctionStartingPrice), STEP_TIMEOUT_MS);
}

/**
 * Wake Allegro's description editor up, so there is something to write the description into.
 *
 * The form is served with the description as an **empty placeholder** — a bare `<p>` in the section
 * container and no editor at all. TinyMCE mounts only when the collector puts the cursor there, and
 * until it does there is no `iframe#id_ifr`, which is why a fill running first reported the
 * description as a field the page does not have.
 *
 * So the placeholder is clicked exactly as a collector clicks it, and this waits for the frame. The
 * click is on the innermost node of the section's own container (addressed by test id, the one thing
 * on this form Allegro gives no element id) rather than on anything named by a class — those are
 * hashed per build (#355).
 *
 * Skipped for an offer with no description: an editor nobody is going to type into is a control the
 * collector never asked to have opened.
 */
async function mountDescriptionEditor(doc: Document, task: ListingTask): Promise<void> {
  if (!task.description?.trim()) return;
  if (byId(doc, FIELD.descriptionFrame)) return;
  const section = doc.querySelector<HTMLElement>(DESCRIPTION_SECTION);
  if (!section) return;

  const target = deepestChild(section);
  // `click()` rather than a `MouseEvent` of our own: it is the element's own native click, so it
  // carries whatever the page expects of one, and it is the same primitive every other click in this
  // module uses. The two around it are for an editor that mounts on the press rather than the
  // release — TinyMCE has done both.
  dispatch(target, "mousedown");
  target.click?.();
  dispatch(target, "mouseup");
  target.focus?.();
  await waitFor(doc, () => byId(doc, FIELD.descriptionFrame), STEP_TIMEOUT_MS);
}

/** The node a click on this section would actually land on — its first leaf. */
function deepestChild(element: HTMLElement): HTMLElement {
  let node = element;
  while (node.firstElementChild) node = node.firstElementChild as HTMLElement;
  return node;
}

/**
 * Get past the product catalogue, which a stamp is never in.
 *
 * Allegro opens its legacy form on *Co chcesz sprzedać?* and will not let anything through until a
 * product search has been run — the *Kontynuuj bez wybierania produktu* link appears only with the
 * results. Nothing is chosen from those results: a listing filed against Allegro's catalogue product
 * is the catalog path this app deliberately does not take (ADR-0026, #477's non-goals).
 */
async function searchPastTheProductCatalogue(doc: Document, task: ListingTask): Promise<void> {
  // The page opens on its **GTIN** search, and the two searches share one field — same id, different
  // placeholder — so a title typed into it is looked up as a barcode and finds nothing in a way that
  // does not offer the way past. Switching first is what makes the search the one being run.
  const byName = buttonMatching(doc, /nie ma numeru GTIN/i);
  if (byName) {
    byName.click();
    await waitFor(doc, () => (searchesByName(doc) ? true : null), STEP_TIMEOUT_MS);
  }

  const search = byId<HTMLInputElement>(doc, PRODUCT_SEARCH);
  if (!search) {
    throw new Error("Allegro's sale form did not open on a page the Assistant recognises.");
  }
  writeValue(search, task.title);
  const searchButton = buttonMatching(doc, /^szukaj$/i);
  if (!searchButton) throw new Error("Allegro's product search has no search button on this page.");
  searchButton.click();

  const skip = await waitFor(doc, () => linkMatching(doc, /kontynuuj bez wybierania produktu/i));
  if (!skip) {
    throw new Error(
      "Allegro did not offer to continue without a catalogue product, so the sale form could not be opened."
    );
  }
  skip.click();
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

  /** Write a value into the control with this id, or say why it could not be written. `display` is
   *  what the report shows, which for a category parameter is Allegro's own label. */
  write(doc: Document, id: string, label: string, value: string, display = value): void {
    const el = byId<FormField>(doc, id);
    if (!el) {
      this.skip(label, `Allegro's form has no ${label.toLowerCase()} field on this page.`);
      return;
    }
    if (el.disabled) {
      this.skip(label, "Allegro has this field switched off on this form.");
      return;
    }
    const select = asSelect(el);
    if (select) {
      // Pick the option rather than assigning: a value the form does not offer would otherwise be
      // swallowed silently, and here it is the one thing worth refusing on.
      const option = Array.from(select.options).find((o) => o.value === value);
      if (!option) {
        this.skip(label, `Allegro's form does not offer "${display}" here.`);
        return;
      }
      option.selected = true;
      dispatch(select, "input");
      dispatch(select, "change");
    } else {
      writeValue(el, value);
    }
    this.fill(label, display);
  }

  /**
   * Write an **ISO-8601 duration** into a select, matched by how long it is rather than by the
   * string.
   *
   * The two are not the same question here. Allegro's API and Allegro's sale form state the very
   * same durations in different notations — the profile holds `P3D` because that is what
   * `POST /sale/product-offers` takes (#486), and the form offers `PT72H` — so a plain string match
   * silently selects nothing and leaves the form's default standing, which is exactly how a handling
   * time of three days went out as one day.
   */
  writeDuration(doc: Document, id: string, label: string, iso: string): void {
    const select = asSelect(byId<FormField>(doc, id));
    if (!select) {
      this.skip(label, `Allegro's form has no ${label.toLowerCase()} field on this page.`);
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
    option.selected = true;
    dispatch(select, "input");
    dispatch(select, "change");
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
 * Fill the sale form from `task`, and stop before *wystaw*.
 *
 * The order is the form's own, top to bottom, so a collector watching it fill sees it fill the way
 * they would have typed it: the title, the category's parameters, the description, the price and
 * quantity, then delivery and returns.
 */
export function fillAllegroSaleForm(doc: Document, task: ListingTask): ListingFillOutcome {
  const report = new FillReport();
  const allegro = task.allegro ?? null;

  report.write(doc, FIELD.title, "Title", task.title);
  fillParameters(doc, allegro, report);
  fillDescription(doc, task, report);
  fillPricing(doc, task, allegro, report);
  fillProfile(doc, allegro, report);

  return report.outcome();
}

/**
 * The category's parameters, each answered in the control Allegro named after it.
 *
 * **Both sections are filled** — the offer's own and the product's (#494). The API path has to drop
 * the product half because `POST /sale/product-offers` refuses it there; this form asks for both, in
 * one list, and a collector filling it by hand would answer both.
 *
 * A `select` is matched on the option's **text**, since that is what this form submits, which is why
 * the answers travel with their display value beside the dictionary ids the API takes. A parameter
 * with no display value — Allegro unreachable when the task was built — is named rather than
 * guessed at.
 */
function fillParameters(
  doc: Document,
  allegro: ListingTaskAllegro | null,
  report: FillReport
): void {
  for (const parameter of allegro?.parameters ?? []) {
    const label = `Parameter — ${parameter.parameterName ?? parameter.parameterId}`;
    const [value] = parameter.displayValues;
    if (!value) {
      report.skip(label, "Allegro could not be asked what this answer is called on its own form.");
      continue;
    }
    // A dictionary parameter is a select under the parameter's own id; a text one is that id with
    // Allegro's own `_0` row suffix, the form allowing several rows per parameter.
    const select = byId<FormField>(doc, parameter.parameterId);
    const id = select ? parameter.parameterId : `${parameter.parameterId}_0`;
    if (!byId(doc, id)) {
      report.skip(label, "This category's form on Allegro has no field for that parameter.");
      continue;
    }
    report.write(doc, id, label, value);
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

/**
 * The description, into TinyMCE's own editable document.
 *
 * Allegro's description editor is an `<iframe>` (same-origin, `#id_ifr`) holding a `<body>` the
 * editor writes into, and there is no textarea to set instead: the value is read out of that document
 * when the form is posted. So the text goes in as **HTML**, through the frame's own body, followed by
 * an `input` event — which is what the editor listens for to notice a change it did not make itself.
 *
 * The text is written as it stands. It arrives already in the format the offer stores (#319) and
 * Allegro's own field takes a small set of tags, so a description that renders as markup here is the
 * same one the API path sends.
 */
function fillDescription(doc: Document, task: ListingTask, report: FillReport): void {
  const label = "Description";
  const text = task.description?.trim();
  if (!text) return; // Nothing to say — an empty description is not a gap.

  const section = doc.querySelector(DESCRIPTION_SECTION);
  const frame = byId<HTMLIFrameElement>(doc, FIELD.descriptionFrame);
  if (!section || !frame) {
    report.skip(label, "Allegro's description editor is not on this page — paste it in yourself.");
    return;
  }
  const body = frame.contentDocument?.body;
  if (!body) {
    report.skip(label, "Allegro's description editor would not open to the Assistant.");
    return;
  }
  body.innerHTML = task.descriptionFormat === "plain" ? paragraphs(text) : text;
  dispatch(body, "input");
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

/**
 * What it is being sold for, and how many there are.
 *
 * The two formats (#449) write different fields, and the *wrong* one being written is the mistake
 * worth avoiding: an auction's opening price in the quick-buy field would be an asking price nobody
 * meant, and a quick buy's price in the opening one would put the listing up for bidding. The format
 * itself is ticked in {@link openAuctionFields} before this runs, which is what puts the auction's
 * own fields in the document.
 *
 * An auction's `#buynow-price` is deliberately left **empty**: filled, it would add a Buy Now price
 * to the auction, which is a second way of selling the offer never asked for.
 */
function fillPricing(
  doc: Document,
  task: ListingTask,
  allegro: ListingTaskAllegro | null,
  report: FillReport
): void {
  if (allegro?.listingType === "auction") {
    report.write(
      doc,
      FIELD.auctionStartingPrice,
      "Starting price",
      allegro.startingPrice ?? task.price
    );
  } else {
    report.write(doc, FIELD.price, "Price", task.price);
  }
  report.write(doc, FIELD.quantity, "Quantity", String(task.quantity));
}

/**
 * Delivery, handling time and returns, from the offer's listing profile (#486).
 *
 * The three ids the profile stores **are** the option values of these three selects, so this is a
 * straight write and not a translation. The sending address is not: Allegro keeps it as an account
 * setting behind a *ZMIEŃ* dialog rather than as a field, so the profile's city and post code are
 * *reported* — the collector checks the line the form already shows, which is the only thing that can
 * honestly be done about a value with nowhere to go.
 */
function fillProfile(
  doc: Document,
  allegro: ListingTaskAllegro | null,
  report: FillReport
): void {
  const profile = allegro?.profile;
  if (!profile) {
    report.skip(
      "Delivery",
      "This offer has no Allegro listing profile, so delivery, returns and the sending address are left as Allegro served them."
    );
    return;
  }
  report.write(
    doc,
    FIELD.shippingRates,
    "Delivery price list",
    profile.shippingRatesId,
    profile.shippingRatesName ?? profile.shippingRatesId
  );
  report.writeDuration(doc, FIELD.handlingTime, "Handling time", profile.handlingTime);
  // The two duration selects are never both on the form: ticking *licytacja* replaces one with the
  // other, so which one this writes follows the format rather than being a second decision.
  if (profile.durationLimit) {
    const auction = allegro?.listingType === "auction";
    report.writeDuration(
      doc,
      auction ? FIELD.auctionDuration : FIELD.duration,
      "Listing duration",
      profile.durationLimit
    );
  }
  if (profile.returnPolicyId) {
    report.write(
      doc,
      FIELD.returnPolicy,
      "Returns",
      profile.returnPolicyId,
      profile.returnPolicyName ?? profile.returnPolicyId
    );
  }
  // A tickbox the profile decides, so it is written in **both** directions rather than only ticked:
  // a profile that says "do not re-list" is an answer, and leaving Allegro's box as served would make
  // it depend on what Allegro happened to serve.
  setCheckbox(doc, FIELD.republish, profile.autoRepublish, "Automatic re-listing", report);

  report.skip(
    "Sending address",
    `Allegro takes this from the account, not from the form — check it reads ${profile.locationPostCode} ${profile.locationCity}.`
  );
}

// ---------------------------------------------------------------------------------------------
// Pictures, and the listing that comes out the other end
// ---------------------------------------------------------------------------------------------

const PICTURES_FIELD = "Pictures";

/**
 * Hand the offer's rendered images to the form's own uploader, in upload order (#411), and answer the
 * question Allegro asks about them.
 *
 * The file input is found structurally, like Colnect's: it is the one control on this form Allegro
 * gives no id, and an `accept` naming picture types is what identifies it.
 *
 * Handed over **last** in a run, after every other field is in, exactly as Colnect's are. What
 * Allegro's uploader then does with them was not established: thumbnails appear straight away, which
 * looks like Colnect's immediate AJAX upload rather than a set held until the offer is created. The
 * ordering is written for the stricter of the two readings — by the time anything could reach the
 * marketplace, the filled form is already in front of the collector.
 *
 * **Asynchronous** because of {@link declineAiWatermark}: the pictures are not in until the dialog
 * Allegro opens over them has been answered.
 */
export async function attachAllegroPictures(
  doc: Document,
  photos: readonly ListingPhotoFile[],
  dialogTimeoutMs: number = AI_DIALOG_TIMEOUT_MS
): Promise<ListingFillOutcome> {
  const report = new FillReport();
  if (photos.length === 0) return report.outcome();

  const input = allegroPictureInput(doc);
  if (!input) {
    report.skip(PICTURES_FIELD, "Allegro's picture uploader is not on this page.");
    return report.outcome();
  }
  putFiles(input, photos.map((p) => p.file));
  dispatch(input, "change");

  const marked = await declineAiWatermark(doc, dialogTimeoutMs);
  report.fill(
    PICTURES_FIELD,
    marked
      ? `${photos.length} handed to Allegro's uploader, none marked as AI`
      : `${photos.length} handed to Allegro's uploader`
  );
  return report.outcome();
}

/** The dialog Allegro opens over a picture upload, by its own title — the AI Act marking question. */
const AI_WATERMARK_TITLE = /znakiem wodnym/i;

/** How long Allegro is given to open that dialog. It is behind a feature flag on the form, so its
 *  absence is the ordinary case and not a failure — hence short. */
const AI_DIALOG_TIMEOUT_MS = 8_000;

/**
 * Confirm Allegro's AI-watermark dialog with **nothing ticked**, and say whether it appeared.
 *
 * Allegro opens it the moment files reach the uploader, asking which pictures should carry an "AI"
 * watermark under the AI Act. Every box starts unticked, which is the truthful answer for an offer's
 * pictures: they are photographs of stamps, rendered by Stamporama from those photographs, and
 * nothing in that path is generative. So this confirms the default rather than choosing anything —
 * **the one thing it must never do is tick a box**, since that would put a claim on the listing that
 * the collector did not make and that is not true.
 *
 * Matched on the dialog's own **title**, not on the button alone: *Potwierdź wybór* is a button
 * Allegro could put on any dialog, and confirming the wrong one is a click nobody asked for.
 */
async function declineAiWatermark(doc: Document, timeoutMs: number): Promise<boolean> {
  const confirm = await waitFor(doc, () => aiWatermarkConfirm(doc), timeoutMs);
  if (!confirm) return false;
  confirm.click();
  return true;
}

/** The confirm button of that dialog, or null while it is not open. */
function aiWatermarkConfirm(doc: Document): HTMLElement | null {
  for (const dialog of Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    const title = dialog.querySelector("#modal-title")?.textContent ?? "";
    if (!AI_WATERMARK_TITLE.test(title)) continue;
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
    return buttons.find((b) => /potwierdź wybór/i.test((b.textContent ?? "").trim())) ?? null;
  }
  return null;
}

/** The form's picture input, behind its drop area. */
export function allegroPictureInput(doc: Document): HTMLInputElement | null {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  return (
    inputs.find((el) => /jpe?g|png|gif|image/i.test(el.getAttribute("accept") ?? "")) ??
    inputs[0] ??
    null
  );
}

/**
 * The listed offer's own URL, once the form has been submitted (#412) — null for every other page.
 *
 * Allegro answers a published listing by navigating to `/oferta/<slug>-<id>`, which is the very shape
 * the capture half already recognises (#355) and the one #467 matches a synced listing on. So a
 * listing posted this way is found by exactly the rule a hand-posted one is.
 *
 * Query and fragment are dropped: this is stored on the offer as the listing's address, and a
 * campaign parameter Allegro appended is not part of that record.
 */
export function allegroListedOfferUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (!/^\/oferta\//.test(parsed.pathname)) return null;
  // Only a page that names an offer id — `/oferta/` alone is a listing of nothing.
  if (!allegroOfferId(url)) return null;
  return `${parsed.origin}${parsed.pathname}`;
}

/** The thank-you page Allegro renders **in place** of the form once it is submitted. A stable id, and
 *  the one thing that tells this document apart from the form it was a moment ago. */
const THANK_YOU_PAGE = "thank-you-page";

/**
 * The listing's URL as Allegro's own confirmation states it (#412/#493).
 *
 * Allegro does not navigate when a form is posted: the same document re-renders into *Oferta jest
 * przygotowana*, which carries the offer's address as a link and leaves the address bar on the sale
 * form. So this is where the URL is, and reading it is what lets the offer go live here.
 *
 * Scoped to the confirmation itself, and every link in it is put through {@link
 * allegroListedOfferUrl}: what is wanted is an `/oferta/<id>` and nothing else, and a link found
 * elsewhere on the page is not the listing that was just posted.
 *
 * The offer it names is **awaiting Allegro's review** — the page says so — but it exists and this is
 * its address, which is exactly what the write-back records.
 */
export function allegroListedUrlInDocument(doc: Document): string | null {
  const page = byId<HTMLElement>(doc, THANK_YOU_PAGE);
  if (!page) return null;
  for (const anchor of Array.from(page.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const listed = allegroListedOfferUrl(anchor.href);
    if (listed) return listed;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------------------------

/**
 * Put a tickbox into the state `wanted`, and say so.
 *
 * Clicked rather than assigned, because the box belongs to a React form and a `checked` set behind
 * its back is a value the next render throws away — and never clicked when it already reads what it
 * should, since a click is a toggle and would then undo the very thing it is asked for.
 */
function setCheckbox(
  doc: Document,
  id: string,
  wanted: boolean,
  label: string,
  report: FillReport
): void {
  const box = byId<HTMLInputElement>(doc, id);
  if (!box) {
    report.skip(label, `Allegro's form has no ${label.toLowerCase()} box on this page.`);
    return;
  }
  const checked = typeof box.checked === "boolean" ? box.checked : box.hasAttribute("checked");
  if (checked !== wanted) box.click();
  report.fill(label, wanted ? "on" : "off");
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

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

/** A `<select>`, without an `instanceof` against a global the test DOM does not install. */
function asSelect(el: FormField | null): HTMLSelectElement | null {
  return el && "options" in el ? (el as HTMLSelectElement) : null;
}

/** Tell the page a field changed, through its own window's `Event` where there is one — the form is
 *  React-rendered and every control it draws is listening. */
function dispatch(el: Element, type: string): void {
  const view = el.ownerDocument?.defaultView as { Event?: typeof Event } | null;
  const Ctor = view?.Event ?? Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
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

/** Enter, as the category field's own submit — it has no button of its own. Silent where the realm
 *  has no `KeyboardEvent` at all: the value is written either way, and a test DOM is not a browser. */
function submitField(el: FormField): void {
  const view = el.ownerDocument?.defaultView as { KeyboardEvent?: typeof KeyboardEvent } | null;
  const Ctor =
    view?.KeyboardEvent ?? (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent;
  if (!Ctor) return;
  for (const type of ["keydown", "keypress", "keyup"]) {
    el.dispatchEvent(new Ctor(type, { key: "Enter", bubbles: true }));
  }
}

/** Whether the shared search field is asking for a **name** rather than a barcode — the placeholder
 *  being the only thing that differs between Allegro's two searches. */
function searchesByName(doc: Document): boolean {
  const field = byId<HTMLInputElement>(doc, PRODUCT_SEARCH);
  return field !== null && !/GTIN/i.test(field.placeholder ?? "");
}

/** Which of Allegro's pages this is, or null while it is still rendering — the one question every
 *  step of {@link prepareAllegroSaleForm} is a branch of. */
function whichPage(doc: Document): "form" | "category" | "search" | "recommerce" | null {
  if (isAllegroSaleFormDocument(doc)) return "form";
  if (byId(doc, FIELD.categoryId)) return "category";
  if (byId(doc, PRODUCT_SEARCH)) return "search";
  if (legacyFormLink(doc)) return "recommerce";
  return null;
}

/** The one link out of the newer form and into the legacy one. Matched on its text, since it is the
 *  only anchor in the page's own `<main>` and its address is the same one that redirected here. */
function legacyFormLink(doc: Document): HTMLAnchorElement | null {
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("main a"));
  return links.find((a) => /dotychczasowy formularz/i.test(a.textContent ?? "")) ?? null;
}

function buttonMatching(doc: Document, pattern: RegExp): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>("main button"));
  return buttons.find((b) => pattern.test((b.textContent ?? "").trim())) ?? null;
}

function linkMatching(doc: Document, pattern: RegExp): HTMLElement | null {
  const nodes = Array.from(
    doc.querySelectorAll<HTMLElement>("main a, main button, main [role='button']")
  );
  return nodes.find((n) => pattern.test((n.textContent ?? "").trim())) ?? null;
}

/** Wait for `find` to answer, or give up. Polling rather than a `MutationObserver` because what is
 *  waited for is a network round-trip inside a React render, and the honest question is "is it there
 *  now" rather than "did anything change". */
async function waitFor<T>(
  doc: Document,
  find: () => T | null,
  timeoutMs = STEP_TIMEOUT_MS
): Promise<T | null> {
  const view = doc.defaultView ?? (globalThis as unknown as Window);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise<void>((resolve) => view.setTimeout(resolve, POLL_MS));
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

/** The Allegro module's listing half (#493). */
export const allegroListing: PlatformListing = {
  formUrl: allegroSaleFormUrl,
  isFormUrl: isAllegroSaleFormUrl,
  isFormDocument: isAllegroSaleFormDocument,
  prepare: prepareAllegroSaleForm,
  fill: fillAllegroSaleForm,
  listedUrl: allegroListedOfferUrl,
  listedUrlInDocument: allegroListedUrlInDocument,
  attachPhotos: attachAllegroPictures,
};
