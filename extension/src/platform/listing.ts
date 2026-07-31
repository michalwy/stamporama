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
  /** The offer's lifecycle state (#405). `ready` for anything the workspace hands over. */
  state: string;
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
}

export type ListingDescriptionFormat = "plain" | "html" | "markdown";

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
  /** The platform's catalog item-ID (Colnect's item-ID, #247). */
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
   */
  attachPhotos?(doc: Document, photos: readonly ListingPhotoFile[]): ListingFillOutcome;
}
