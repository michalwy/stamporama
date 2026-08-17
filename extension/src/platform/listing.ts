// The **listing** half of a platform module (#408, part of #155).
//
// Extraction (#249/#253) reads a marketplace page; listing writes one — get to the sale form, fill
// it from a neutral task, and stop. Both halves live in the shell rather than inside the Colnect
// module because Delcampe (#154) and Allegro (#355) need the same shape, and a shell that can only
// drive one marketplace is not a shell.
//
// A module is free to implement extraction only: the listing half is optional, and a platform whose
// module has none simply offers no **List via Assistant** (#407).

/** Mirror of the Stamporama listing-kit response (#405), kept in sync by hand exactly as
 *  `core/decisions.ts` mirrors the matcher response — the extension is a separate build with no
 *  import path into the app. It is the endpoint's payload **unchanged**: the task says what the
 *  listing holds, never how a form is laid out, and the mapping onto fields is the module's job.
 *
 *  A served kit's `blockers` are always empty (the endpoint refuses on any, #406), so they are not
 *  mirrored here — nothing on this side of the wire has an opinion about a precondition. */
export interface ListingTask {
  offerId: string;
  collectionId: string;
  /** The offer's lifecycle state (#405). `ready` for anything the workspace hands over, and `active`
   *  for an update (#462). */
  state: string;
  /** Whether this posts a new listing or re-fills one already live (#462). **Optional**, and absent
   *  means `create`: an instance predating the update flow serves a kit without it, and the shell must
   *  read that as the act it has always been rather than as a malformed task. */
  mode?: ListingMode;
  /** The listing's address on the platform (#412), which an update navigates back to and a module
   *  turns into its own edit address. Null on an offer that carries none. */
  listingUrl?: string | null;
  /** The platform, and the module id that knows its sale form — `Contact.platformModule` (#406),
   *  matched against `PlatformModule.id`. Null when the platform names none, which the endpoint
   *  refuses; the shell refuses it too rather than guessing a module. */
  platform: { id: string; name: string; module: string | null };
  /** The listing title (#209). Carried because most platforms have such a field; Colnect's own sale
   *  form has none (#402) and its module ignores it. */
  title: string;
  description: string | null;
  privateNote: string | null;
  /** How the description is written (#319), so a module knows whether the field takes markup. */
  descriptionFormat: ListingDescriptionFormat;
  /** Decimal string in `currency`, which on a platform that locks one (#196) is the platform's. */
  price: string;
  currency: string;
  /** How many of this listing there are — the number of sets. Truthful only over interchangeable
   *  sets, which the preconditions guarantee; `items` describes **one** of them. */
  quantity: number;
  /** One set's copies in listing order — what a single buyer takes. */
  items: ListingTaskItem[];
  photos: ListingTaskPhotos;
  /** Allegro's own half of the task (#493) — null for an offer on any other platform. A **named
   *  section** rather than fields above: a category and a delivery profile mean nothing on another
   *  marketplace, and the neutral shape must not grow one marketplace's vocabulary. Its own
   *  `blockers` are always empty on a served task, exactly as the kit's are, so they are not
   *  mirrored. */
  allegro?: ListingTaskAllegro | null;
}

/** What Allegro's sale form needs beside the neutral fields: what the stamps are filed as, and what
 *  the account sells them under. Every value is what the offer stores (#494), never worked out
 *  here. */
export interface ListingTaskAllegro {
  /** The category number the form's own **Nr kategorii** field takes, which is what opens it in the
   *  right category. */
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  parameters: ListingTaskAllegroParameter[];
  profile: ListingTaskAllegroProfile | null;
  /** Whether it opens as an auction (#449), and at what — a different figure from `price`. */
  listingType: "fixed" | "auction";
  startingPrice: string | null;
}

/** One answered category parameter. `parameterId` is Allegro's own, which on the sale form is also
 *  the **element id** of the control that answers it. */
export interface ListingTaskAllegroParameter {
  parameterId: string;
  parameterName: string | null;
  /** Whether Allegro files this under the product rather than the offer. The sale form asks for
   *  both, so both are filled here — it is the API path that drops these. */
  describesProduct: boolean;
  /** What the form's control shows for this answer: a `select` submits the option's **text**, not
   *  the dictionary id. Empty where Allegro could not be asked, which is a field left for the
   *  collector rather than one filled wrongly. */
  displayValues: string[];
}

/** The listing profile (#486). The three ids are the option values of the form's own delivery,
 *  handling-time and returns selects; the address has no field on the form and is carried so the
 *  fill can *say* what it could not set. */
export interface ListingTaskAllegroProfile {
  id: string;
  name: string;
  shippingRatesId: string;
  shippingRatesName: string | null;
  /** Both are ISO-8601 durations, and both are matched against the form's options **by length**
   *  rather than by string: Allegro's API states the same durations in another notation (`P3D` where
   *  the form says `PT72H`). Null on the duration leaves the form as it was served. */
  handlingTime: string;
  durationLimit: string | null;
  /** Whether Allegro re-lists the offer when its duration runs out (#493). Written **either way**:
   *  it is a decision the profile makes, not a value that may be absent. */
  autoRepublish: boolean;
  returnPolicyId: string | null;
  returnPolicyName: string | null;
  impliedWarrantyId: string | null;
  locationCountryCode: string;
  locationCity: string;
  locationPostCode: string;
  invoiceType: string;
}

export type ListingDescriptionFormat = "plain" | "html" | "markdown";

/** Mirror of the instance's own `ListingMode` (#462): posting a listing, or correcting one that is
 *  already live. Every other field of a task means the same thing in both. */
export type ListingMode = "create" | "update";

/** One copy of the listing. `catalogItemId` and `condition.platformValue` are non-null on a servable
 *  task — that is exactly what the preconditions check — but stay nullable in the shape, because the
 *  same payload is what the app's own card reads. */
export interface ListingTaskItem {
  itemId: string;
  /** The collection's own copy number (#268), so a filled form traces back to the piece. */
  itemNo: number;
  stampId: string;
  /** The copy's label — its leading catalog number (#379). What a message names it by. */
  label: string;
  /** The platform's catalog item-ID (Colnect's item-ID, #247). For a stamp whose variant is not
   *  identified the instance derives it from the cheapest variant (#616) — a form is filled
   *  identically either way, so the task carries no marker of it that a module would read; the
   *  instance's own payload has one, and it is the instance that reports which variant it was. */
  catalogItemId: string | null;
  condition: ListingTaskCondition;
}

/** A copy's condition, ours and the platform's side by side: the local pair names it in a message,
 *  the platform pair is what the form submits (#404). */
export interface ListingTaskCondition {
  id: string;
  name: string;
  abbreviation: string;
  platformValue: string | null;
  platformLabel: string | null;
}

export type ListingPhotoStatus = "none" | "queued" | "running" | "ready" | "failed";

/** The offer's photos as a listing needs them: the upload set only, in upload order (#405). */
export interface ListingTaskPhotos {
  status: ListingPhotoStatus;
  /** The stored images were rendered from inputs that have since changed (#311). A signal, never a
   *  refusal — what is stored is still a truthful set of pictures of these stamps. */
  outOfDate: boolean;
  images: ListingTaskPhoto[];
}

/** One image of the upload run. `url` is instance-relative; the photo route takes the Assistant
 *  token (#253), so it is fetched with the same bearer the task was read with. */
export interface ListingTaskPhoto {
  photoId: string;
  url: string;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** One value a module put into the form. `field` is named for the collector, not for the DOM: it is
 *  read back in a report, so "Price" beats `new_sale[price]`. */
export interface ListingFilledField {
  field: string;
  /** What was written, as it now stands in the form. */
  value: string;
}

/** One value a module could **not** put into the form, and why — an unmapped condition above all.
 *  A skip is not an error: the form is still filled, and the collector fixes the rest by hand. */
export interface ListingSkippedField {
  field: string;
  /** English, complete, and naming what is at fault — the shell has no vocabulary of its own. */
  reason: string;
}

/** What filling a form produced. Deliberately a report and never a verdict: whether a listing is
 *  good enough to post is the collector's call, made in front of the form. */
export interface ListingFillOutcome {
  filled: ListingFilledField[];
  skipped: ListingSkippedField[];
}

/** One image, fetched from the instance and ready to hand to a platform's own uploader (#411). The
 *  `File` carries the upload name and mime the plan gave it (#314/#326), so a picture posted through
 *  the Assistant is named exactly as one dragged in from the offer's ZIP. */
export interface ListingPhotoFile {
  photoId: string;
  file: File;
}

/** The listing half of a module: how to reach the sale form, how to recognise it, and how to fill
 *  it. Filling **stops before submit** — the collector clicks the platform's own button, so nothing
 *  is posted to a marketplace without a human look (#408). */
export interface PlatformListing {
  /** The URL of the sale form for this task, built from what the task already carries. Throws only
   *  when the task cannot be expressed as a form at all, which the shell reports as a refusal. */
  formUrl(task: ListingTask): string;
  /** True when `url` is that sale form — how the shell knows the page it is on is the one to fill.
   *  Broader than an equality test against {@link formUrl}: the platform may redirect, add its own
   *  parameters, or restore a draft. */
  isFormUrl(url: string): boolean;
  /**
   * The URL of the form that edits the listing this task is **already live as** (#462), built from
   * the task's own `listingUrl`.
   *
   * **Optional**, and the counterpart of {@link formUrl} rather than a variant of it: a marketplace
   * whose live listing cannot be reached and re-filled simply has none, and the instance never offers
   * **⟳ Update via Assistant** for it. Colnect has one because it serves the identical form at a
   * second address — which is why the module needs no second {@link fill}, and why this is a URL and
   * not a whole second half of the interface.
   *
   * A page at this address must also answer {@link isFormUrl}, since that is what the shell checks
   * before it fills anything.
   *
   * Throws when the task's listing URL is missing or is not one this module recognises — a refusal the
   * shell reports, because an edit form opened at a guessed address is somebody else's listing.
   */
  editUrl?(task: ListingTask): string;
  /**
   * True when `doc` — a document already at {@link isFormUrl} — actually **holds** the sale form
   * (#419).
   *
   * The URL is the address, not the contents: a marketplace may answer the very same address with an
   * anti-bot interstitial that reloads itself into the form a moment later, and Colnect does. Filling
   * that page writes nothing and reports every field as missing, which reads like a broken form
   * rather than like a page that has not arrived yet — so the two are asked separately, and the shell
   * waits for the reload instead (`fillListing` → `retry`).
   *
   * A structural check over the controls the module is about to write, never a marker of the
   * platform's own: what matters is whether the fields are there to fill.
   */
  isFormDocument(doc: Document): boolean;
  /**
   * Walk a page that is at {@link isFormUrl} but not yet {@link isFormDocument} **one step closer**
   * to the sale form (#493).
   *
   * **Optional**, and most modules will never have one: a marketplace whose sale form is at an
   * address is opened by opening it, and Colnect's is. Allegro's is not — it answers that address
   * with a different form, whose opt-out link leads to a product search, which must be run before it
   * will offer to continue without a catalogue product, which finally opens the category modal the
   * form is entered through. Only the ends of that sequence are page loads.
   *
   * That is why this is **async** while {@link fill} is not: the steps are network round-trips inside
   * one document, and a synchronous DOM pass cannot wait for one. It is also why it is a separate
   * member rather than part of the fill — nothing here writes a value from the offer into a listing;
   * it is navigation, and the fill still happens exactly once, on the form itself.
   *
   * Called at most once per page, and only when the document is not the form. It may end by causing a
   * navigation, in which case it simply resolves — the page is on its way out and the shell picks the
   * run up again on the next load. Throws when the page cannot be advanced at all, which is a refusal
   * with a reason worth showing.
   */
  prepare?(doc: Document, task: ListingTask): Promise<void>;
  /** Fill the form in `doc` from `task`, and stop. Never submits, and never touches a field the
   *  task has nothing to say about (#410). Throws only on unexpected DOM. */
  fill(doc: Document, task: ListingTask): ListingFillOutcome;
  /**
   * The **listed entry's own URL**, when `url` is the page a submitted sale form landed on — and
   * null for every other page (#412).
   *
   * This is what closes the loop: the entry exists only after the collector submits, so its URL
   * cannot be known when the form is opened, and the one place it is ever stated is the address bar
   * the platform navigates to. A module recognising its own entry page is the same knowledge
   * {@link isFormUrl} already carries, on the other side of Save.
   *
   * Returning the URL rather than a boolean is deliberate: it is **stored** on the offer, so the
   * module is what decides which part of what the browser shows is the listing's address — a
   * tracking parameter is not part of the record.
   */
  listedUrl(url: string): string | null;
  /**
   * The listed entry's own URL as **this page states it**, for a marketplace that confirms a
   * submitted form without navigating (#493) — and null on every other page.
   *
   * **Optional**, and the counterpart of {@link listedUrl} rather than a replacement: Colnect
   * navigates to the new entry, so its address *is* the answer, while Allegro re-renders the same
   * document into a thank-you page that carries the offer's link and leaves the address bar on the
   * form. A run that only watched the address bar would report every Allegro listing as "submitted,
   * URL unread" — the listing exists and the offer would never learn its address.
   *
   * Read from the page's own confirmation, never from anything the form still holds: this is what
   * gets stored on the offer, and a link found somewhere else on the page is not the listing that was
   * just posted.
   */
  listedUrlInDocument?(doc: Document): string | null;
  /**
   * Put the offer's rendered images into the form's own uploader, in upload order, and stop (#411).
   *
   * **Optional**, like the listing half itself: a sale form with no pictures is a form this module
   * fills completely, and the shell then fetches no bytes and says nothing about photos. The absence
   * is a fact about the platform, not a gap.
   *
   * Called **after** {@link fill} and never instead of it. On Colnect the uploader posts each
   * picture the moment it is handed over — before the sale is saved (#402) — so this is the last
   * thing that happens in a run, with the filled form already in front of the collector: everything
   * that can still be decided has been decided by the time anything is written to the marketplace.
   *
   * Reports rather than throws, exactly as {@link fill} does: a picture the uploader will not take is
   * one the collector drags in from the offer's ZIP, and the rest of the filled form must survive it.
   *
   * May answer **asynchronously**, because handing pictures over is not always the end of it: Allegro
   * opens a dialog the moment the files arrive (its AI-watermark question, #493) and the uploader is
   * not done until that dialog is answered. A module with nothing to wait for returns its report
   * directly, as Colnect's does, and pays nothing for this.
   */
  attachPhotos?(
    doc: Document,
    photos: readonly ListingPhotoFile[]
  ): ListingFillOutcome | Promise<ListingFillOutcome>;
}
