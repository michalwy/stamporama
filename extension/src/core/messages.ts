import type { ExtractedItem } from "../platform/types";
import type { ListingFillOutcome, ListingTask } from "../platform/listing";
import type { CapturedLot, CaptureRefusal } from "../platform/capture";
import type { BackfillProposal, DateProposal, MatchResult } from "./decisions";
import type { CaptureOutcome } from "./capture";
import type { OfferMarkerTarget } from "./offer-marker";
import type { LotMarkerTarget } from "./lot-marker";
import type { OrderSaleTarget } from "./order-marker";
import type { OrderImportSummary } from "./order-dialog";
import type { PlatformOrder } from "../platform/orders";
import type { SearchAnswer } from "./search";
import type {
  ApplyDirection,
  ApplyHandoffReport,
  ApplyHandoffState,
  ApplyTask,
} from "./colnect-apply-handoff";
import type { ColnectCondQtyStep } from "../platform/colnect/list-write";
import type {
  ExportHandoffReport,
  ExportHandoffState,
  ExportTask,
} from "./colnect-export-handoff";

// Typed message contracts. The popup asks the content script to extract, and asks the background
// service worker to match/confirm against the active profile's instance (background fetch is exempt
// from CORS under host_permissions, so all instance calls go through the SW).

// popup → content script (in the active tab)
export interface ExtractRequest {
  type: "extract";
}
export type ExtractResponse =
  | { ok: true; items: ExtractedItem[] }
  | { ok: false; error: string };

// background → content script (in the tab it opened on the sale form, #409). The fill runs in the
// page rather than in the worker because it is DOM work, and the module that performs it is the
// same one on both sides — only the document differs.
export interface FillRequest {
  type: "fill";
  task: ListingTask;
}
export type FillResponse =
  | { ok: true; moduleId: string; moduleName: string; outcome: ListingFillOutcome }
  /** `retry` says the page is not the form **yet** (#419) — the marketplace answered the sale form's
   *  own address with something that reloads itself into it, so the worker waits for the next load
   *  and asks again instead of reporting a fill that never happened. */
  | { ok: false; error: string; retry?: boolean };

// background → content script, **after** the fill and on the same page (#411): the offer's rendered
// images, for the module to hand to the form's own uploader. A second message rather than part of
// `FillRequest`, because the two steps must be ordered — Colnect uploads a picture the moment it is
// handed over, before the sale is saved, so nothing goes to the marketplace until the form the
// collector is looking at is otherwise complete.
//
// The bytes are base64: extension messaging is JSON, and a `File` does not survive it. The page turns
// them back into `File`s, which is also where they belong — the form is there.
export interface AttachPhotosRequest {
  type: "attach-photos";
  /** The module that filled this page, as its own answer named it. */
  moduleId: string;
  photos: AttachPhotoPayload[];
}
export interface AttachPhotoPayload {
  photoId: string;
  fileName: string;
  mime: string;
  /** The image's bytes, base64. */
  data: string;
}
export type AttachPhotosResponse =
  | { ok: true; outcome: ListingFillOutcome }
  | { ok: false; error: string };

// capture window → content script (in the tab holding the auction, #355). The same shape as
// `extract`, for the same reason: reading a page is DOM work and happens where the DOM is. A refusal
// carries its `reason` so the window can say what the page *is* — a fixed-price offer is not an
// error, and telling the collector that is more use than a lot with an invented closing time.
export interface CaptureRequest {
  type: "capture";
}
export type CaptureResponse =
  | { ok: true; moduleId: string; moduleName: string; lot: CapturedLot }
  | ({ ok: false; error: string } & Partial<CaptureRefusal>);

// capture window → background service worker: write the lot to the active profile's instance (#355).
// It goes through the worker like every other instance call, because a cross-site fetch is only
// exempt from CORS there. `dryRun` asks what *would* happen — which parcel it lands in, whether the
// seller is new here, whether this listing is already watched — and writes nothing.
export interface CaptureSaveRequest {
  type: "capture-save";
  lot: CapturedLot;
  dryRun: boolean;
}
export type CaptureSaveResponse =
  | { ok: true; result: CaptureOutcome }
  | { ok: false; error: string };

// content script (on a marketplace page) → background service worker: "which of these listings are
// offers of mine?" (#466). It goes through the worker for the same reason every other instance call
// does — a cross-site fetch is only exempt from CORS there — and because the profile and its token
// live there, which a script running inside somebody else's page must never hold.
//
// **Many ids at once**, because the seller's own assortment page is a list: asking per row would be
// a request per row. A single listing page is the batch of one.
//
// The answer is what the page needs to draw its links and nothing else: a finished address, the
// offer's number, its title and its state, keyed by the marketplace id each answers for. An id that
// matched nothing is simply absent — most listings are somebody else's, which is not an error.
export interface OfferLookupRequest {
  type: "offer-lookup";
  /** The marketplace's own listing ids, read from the addresses by the page's own module. */
  platformOfferIds: string[];
}
export type OfferLookupResponse =
  | { ok: true; matches: Record<string, OfferMarkerTarget> }
  | { ok: false; error: string };

// content script (on a marketplace page) → background service worker: "am I already tracking this
// listing as an auction lot?" (#575). The same trip as the offer lookup above, through the worker
// for the same reasons, and a separate question rather than a second field on that answer: the two
// are asked of different halves of the collection — the shop and the watchlist — and a page that
// turns out to be neither must be able to hear both misses without either standing in for the other.
export interface LotLookupRequest {
  type: "lot-lookup";
  /** The marketplace's own listing ids, read from the addresses by the page's own module. */
  platformOfferIds: string[];
}
export type LotLookupResponse =
  | { ok: true; matches: Record<string, LotMarkerTarget> }
  | { ok: false; error: string };

// content script (on a marketplace's own sold-order screens) → background service worker: "which of
// these orders are already recorded here?" (#612). The selling-side sibling of the two lookups above
// and the same trip for the same reasons — the worker holds the profile and its token, and a
// cross-site fetch is only exempt from CORS there.
//
// **Many orders at once**, because a phase screen is a list of them. An order that is not recorded
// yet is an absent entry rather than an error: it is the ordinary case, and the one the *Import*
// affordance on that row exists for.
export interface OrderLookupRequest {
  type: "order-lookup";
  /** Which marketplace's orders these are — the id of the module that read the page (#698). Sent
   *  because the instance answers per marketplace: an order id is only unique inside the site that
   *  issued it, and two of them could be the same digits. The shell still never names one. */
  module: string;
  /** The marketplace's own order ids, read from the addresses by the page's own module. */
  orderIds: string[];
}
export type OrderLookupResponse =
  | { ok: true; matches: Record<string, OrderSaleTarget> }
  | { ok: false; error: string };

/** One order exactly as the page printed it — the module's own reading, minus the element it is to
 *  be marked on. What the instance decides *from*, and deliberately not a decision itself (#409). */
export type ReportedOrder = Omit<PlatformOrder, "anchor">;

// content script → background service worker: "record this order as a sale" (#612). The one message
// from a marketplace page that **writes**, and it writes nothing itself: it reports what the row
// printed and the instance decides which offers those items are, whether the order can be recorded
// whole, and what the sale then says.
//
// A refusal comes back as a sentence naming the item that stopped it, because the way through is
// that offer's own screen and then the same button again.
export interface OrderImportRequest {
  type: "order-import";
  /** The module that read the order, as on the lookup above (#698). */
  module: string;
  order: ReportedOrder;
}
export type OrderImportResponse =
  | {
      ok: true;
      sale: OrderSaleTarget;
      /** What the sale says, for the window the click opened (#698's follow-up). Null where the
       *  instance answered without one — an older build, whose window then shows the link alone. */
      summary: OrderImportSummary | null;
      /** False where the order was already recorded, so nothing was written just now. */
      created: boolean;
    }
  | {
      ok: false;
      error: string;
      /** One sentence per reason, as the instance worded them. The window lists them; the mark still
       *  carries the run-on in its tooltip, a mark having room for a line and not for a list. */
      problems: string[];
    };

// search window → background service worker: "what does the collection hold matching this text?"
// (#529). Through the worker like every other instance call — a cross-site fetch is only exempt from
// CORS there, and the profile's token must never reach a page that is not ours.
//
// The query is **the collector's**, not the page's: it arrives as whatever they selected and is
// re-sent whenever they edit it, so a selection that caught a stray word is fixed in the window
// rather than by selecting again on the page.
export interface SearchRequest {
  type: "search";
  query: string;
}
export type SearchResponse = { ok: true; answer: SearchAnswer } | { ok: false; error: string };

// popup → background service worker
export interface MatchRequest {
  type: "match";
  items: ExtractedItem[];
  dryRun: boolean;
}
export type MatchResponse =
  | { ok: true; results: MatchResult[] }
  | { ok: false; error: string };

export interface ConfirmRequest {
  type: "confirm";
  colnectId: string;
  stampId: string;
  allowOverwrite?: boolean;
  /** What the page printed for this item, so the chosen stamp can be backfilled in the same call
   *  (#280). Whether the backfill actually runs is the extension setting, applied by the worker. */
  catalogRefs?: { catalog: string; number: string }[];
  /** The page's printed date of issue, travelling with the confirmation for the same reason the
   *  numbers do (#655). Whether it is used is the extension setting, applied by the worker. */
  issuedOn?: string;
}
export type ConfirmResponse =
  | { ok: true; backfill: BackfillProposal[]; date: DateProposal | null }
  | { ok: false; error: string; conflict?: boolean; existingColnectId?: string };

// popup → background: "Colnect is right about this number" (#433). One field of one stamp, taken
// deliberately and on its own — confirming a match links an item, while this rewrites something we
// already hold, and the two are not the same claim. The number travels already resolved to what we
// would store (the matcher stripped the area prefix against the stamp's own area), so the window and
// the instance cannot disagree about the value.
export interface OverwriteNumberRequest {
  type: "overwrite-number";
  stampId: string;
  catalogVendorId: string;
  number: string;
}
export type OverwriteNumberResponse =
  | { ok: true; label: string; duplicateStampNames?: string[] }
  | { ok: false; error: string };

// popup → background: "Colnect is right about when this was issued" (#655). The date the two sides
// disagree about, settled one stamp at a time — the number overwrite's shape, on the one field a
// stamp has for it. The value travels as the page printed it, so the instance reads exactly what
// the matcher read when it reported the disagreement.
export interface OverwriteDateRequest {
  type: "overwrite-date";
  stampId: string;
  issuedOn: string;
}
export type OverwriteDateResponse =
  | { ok: true; label: string }
  | { ok: false; error: string };

// instance content script (on the Colnect report screen) → background: "carry this list difference
// out on Colnect" (#689). The **first message in this extension that leads to a write on somebody
// else's site** — see ADR-0042.
//
// It goes through the worker for the reason every long job does: the page that asked may be closed
// or navigated away from long before an hour-and-a-half run finishes, and the worklist has to
// outlive it. The worker answers as soon as the run is under way; the progress comes back on
// {@link ColnectApplyProgressNotice}, and what landed is marked done on the instance as it lands.
export interface ColnectApplyRequest {
  type: "colnect-apply";
  task: ApplyTask;
  /** The handoff this is, echoed back so the page can tell an answer from a leftover. */
  requestId: string;
}
export type ColnectApplyResponse = { ok: true } | { ok: false; error: string };

// background → instance content script: how the run is going (#689), carried back onto the node the
// worklist came in on. Fire-and-forget: a run must never wait on a page that may be closed.
export interface ColnectApplyProgressNotice {
  type: "colnect-apply-progress";
  requestId: string;
  state: ApplyHandoffState;
  message: string;
  report: ApplyHandoffReport;
}

// background → content script on a **colnect.com** page: write one item's list membership (#689).
//
// It happens in the page rather than in the worker because the auth is Colnect's own session cookie
// and nothing else — no CSRF token, no header — so the request has to be same-origin, from a
// document the collector is signed in on. The worker owns the pace, the worklist and the reporting;
// the page owns exactly one `fetch`.
export interface ColnectWriteRequest {
  type: "colnect-write";
  colnectId: string;
  lt: number;
  direction: ApplyDirection;
}
export type ColnectWriteResponse =
  /** The HTTP status and the answer's body, classified by the worker through
   *  `platform/colnect/list-write.ts` — the page reports what happened and never decides what it
   *  means. The body matters since #704: Colnect answers `act=check&val=+` with the entry it made,
   *  as quantities indexed by condition id, which is what the correction is planned against. */
  | { ok: true; status: number; retryAfter: string | null; body: string }
  | { ok: false; error: string };

// background → content script on a **colnect.com** page: correct one condition row of a list entry
// (#704). The membership call's sibling, and deliberately a message of its own: `act` and `val` are
// a different shape, and one request type meaning four acts is how a body comes to be built in two
// places. The step is decided in the worker (`planColnectCondQty`) and the body built in the page
// from the same pure module, so `list-write.ts` stays the only place either is spelled.
export interface ColnectCondQtyRequest {
  type: "colnect-cond-qty";
  colnectId: string;
  lt: number;
  step: ColnectCondQtyStep;
}

// instance content script (on the Colnect report screen) → background: "fetch this list from Colnect
// and load it here" (#690). The manual export — open Colnect, press the button, find the file,
// upload it — is the only step of the loop the collector was still doing by hand.
//
// It goes through the worker because the file has two ends that the page has neither of: a
// colnect.com tab to ask from, and the instance's own bearer token to post the result on. The page
// gets back a sentence and a count; the bytes never touch it.
export interface ColnectExportRequest {
  type: "colnect-export";
  task: ExportTask;
  /** The handoff this is, echoed back so the page can tell an answer from a leftover. */
  requestId: string;
}
export type ColnectExportResponse = { ok: true } | { ok: false; error: string };

// background → instance content script: how the refresh went (#690), carried back onto the node the
// task came in on. Fire-and-forget, as the apply run's progress is: the collector may have navigated
// away, and the snapshot on the instance is the real record either way.
export interface ColnectExportProgressNotice {
  type: "colnect-export-progress";
  requestId: string;
  state: ExportHandoffState;
  message: string;
  report: ExportHandoffReport | null;
}

// background → content script on a **colnect.com** page: ask Colnect for one list's export and read
// the file back (#690).
//
// It happens in the page rather than in the worker for the write's reason (`ColnectWriteRequest`):
// the call is authenticated by the collector's session cookie and nothing else, so it has to be
// same-origin from a document they are signed in on. The file itself is fetched from the same
// document, since the URL Colnect answers with is authenticated the same way.
export interface ColnectExportFetchRequest {
  type: "colnect-export-fetch";
  lt: number;
}
export type ColnectExportFetchResponse =
  | { ok: true; fileName: string; text: string }
  | { ok: false; error: string };

export type BackgroundRequest =
  | MatchRequest
  | ConfirmRequest
  | OverwriteNumberRequest
  | OverwriteDateRequest;

// instance content script → background: "the collector handed this offer over" (#409). The worker
// resolves the module, opens the sale form in a tab of its own and has it filled; the answer is what
// the page renders. It carries no profile: a task is self-contained, and the instance that wrote it
// is the one whose page is asking.
export interface ListRequest {
  type: "list";
  task: ListingTask;
  /** The handoff this is (#409). Remembered with the filled form, so the answer that comes back after
   *  Save (#412) names the request it answers exactly as the fill's own answer does. */
  requestId: string;
}
export type ListResponse =
  | {
      ok: true;
      moduleId: string;
      moduleName: string;
      /** The sale form the task was filled into. */
      formUrl: string;
      outcome: ListingFillOutcome;
    }
  | { ok: false; error: string };

// content script (on the sale form) → background: "the form the Assistant filled has been
// submitted" (#412). It is what separates a listing the collector *posted* from one they abandoned:
// a submission that then lands somewhere the module does not recognise is worth reporting, while an
// abandoned form is worth nothing at all. Fire-and-forget, no response.
export interface ListingSubmittedNotice {
  type: "listing-submitted";
}

// content script (on the sale form) → background: "the listing exists, and **this page says its
// address**" (#412/#493). Fire-and-forget, no response.
//
// The second way a listed URL is found, and the only one on a marketplace that confirms **in place**:
// Allegro answers a submitted form by re-rendering the same document into a thank-you page carrying
// the offer's link, so the address bar never changes and there is no navigation to read. The
// background treats it exactly as it treats one read off a navigation — same pending record, same
// write-back, same "activate this offer" — because it is the same fact arriving by another road.
export interface ListedHereNotice {
  type: "listed-here";
  /** The listing's own URL, already narrowed by the module that filled the form. */
  url: string;
}

// background → instance content script: "the sale was posted" (#412), carried back to the page that
// handed the offer over. The reply says whether the page **took** it: the answer arrives minutes
// after the fill, by which time the collector may have dismissed the strip or handed the next offer
// over, and an answer nobody is following is what the POST fallback exists for.
export interface ListedNotice {
  type: "listed";
  requestId: string;
  offerId: string;
  moduleId: string;
  moduleName: string;
  formUrl: string;
  /** The entry's own URL, or null when the sale was posted and it could not be read. */
  listedUrl: string | null;
  /**
   * Which act was saved (#462). Absent means `create`, the only one there used to be.
   *
   * An `update` is the same event on the same page — Colnect answers a saved edit with the listing's
   * own entry — and a **different fact**: the listing already existed, the offer is already Active,
   * and the URL is the one this run was sent to. So the page reports it and does nothing else, and the
   * worker's POST fallback is never reached: there is nothing to write back.
   */
  mode?: "create" | "update";
}
export interface ListedResponse {
  /** True when the page is still following this handoff, so it is the one activating the offer. */
  taken: boolean;
}

/** The minimum an item needs for matching: no name, no image bytes. Keeps the load-time message
 *  small, since it is sent on every supported page view. */
export interface SlimItem {
  platformItemId: string;
  catalogRefs: ExtractedItem["catalogRefs"];
  /** The printed date of issue (#655). Small enough to carry here, and it must be: the window
   *  reuses this match as its preview, and a preview that omitted the dates would promise less than
   *  the write it leads to. */
  issuedOn?: string;
}

// content script → background: "this tab holds these items", on page load. The background sets the
// toolbar badge from it and — when match-on-load is enabled — runs the dry-run so the badge can
// count work to do rather than raw page contents. Fire-and-forget, no response.
export interface DetectedNotice {
  type: "detected";
  count: number;
  refs: SlimItem[];
}

// popup → background: hand back the load-time match for this tab, if it is still current, so
// opening the window is instant instead of re-running the whole batch.
export interface CachedResultsRequest {
  type: "cached-results";
  tabId: number;
}
export interface CachedResultsResponse {
  results: MatchResult[] | null;
}

// popup → background: "this is what the page's results say now" (#283). The badge is set once, off
// the load-time dry-run, and nothing after that touches it — so a page whose matches have just been
// written kept advertising work that is done, until a navigation cleared it. The window is where the
// writing happens and the only place that knows, so it says so.
//
// It carries the whole result set rather than a new count: the worker caches those results for the
// next opening of the window, and a cache left describing the pre-write page would hand the
// collector back the very rows they just settled. The count is then derived there, by the same
// function the load-time match uses.
//
// Fire-and-forget, no response. The badge is not what the collector is looking at while this window
// is open, and a write must never fail on the strength of it.
export interface ResultsUpdatedNotice {
  type: "results-updated";
  tabId: number;
  /** The address the window scanned. The worker drops the update unless the tab is still on it: a
   *  tab that has navigated had its badge cleared for that navigation, and a late push would
   *  resurrect a count for a page nobody is looking at. */
  url: string;
  results: MatchResult[];
}

// instance content script → background: "the collector asked for this stamp to be matched". The
// worker opens the search beside the page that asked and puts the match window in front of it —
// the two steps the page cannot take itself. It answers as soon as the window is up: what happens in
// it is the collector's own work, reported later by {@link MatchedNotice} and to every instance tab
// rather than to this one handoff.
export interface OpenMatchRequest {
  type: "open-match";
  /** The marketplace search the instance built (#423). */
  url: string;
  /** The handoff this is, echoed straight back so the page can tell an answer from a leftover. */
  requestId: string;
}
export type OpenMatchResponse = { ok: true } | { ok: false; error: string };

// background → every instance content script: "a match was just written". Fire-and-forget, no
// response, no request id: any confirmed match may be the one a screen is waiting for, and what the
// page does with it is re-read its own data. It is sent for matches started from the toolbar icon
// too, which is the whole point — those have no handoff to answer.
export interface MatchedNotice {
  type: "matched";
}

export type BackgroundMessage =
  | BackgroundRequest
  | SearchRequest
  | CaptureSaveRequest
  | OfferLookupRequest
  | LotLookupRequest
  | OrderLookupRequest
  | OrderImportRequest
  | ColnectApplyRequest
  | ColnectExportRequest
  | ListRequest
  | ListingSubmittedNotice
  | ListedHereNotice
  | DetectedNotice
  | OpenMatchRequest
  | CachedResultsRequest
  | ResultsUpdatedNotice;
