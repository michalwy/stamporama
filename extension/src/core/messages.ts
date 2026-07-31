import type { ExtractedItem } from "../platform/types";
import type { ListingFillOutcome, ListingTask } from "../platform/listing";
import type { CapturedLot, CaptureRefusal } from "../platform/capture";
import type { BackfillProposal, MatchResult } from "./decisions";
import type { CaptureOutcome } from "./capture";

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
}
export type ConfirmResponse =
  | { ok: true; backfill: BackfillProposal[] }
  | { ok: false; error: string; conflict?: boolean; existingColnectId?: string };

export type BackgroundRequest = MatchRequest | ConfirmRequest;

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
  | CaptureSaveRequest
  | ListRequest
  | ListingSubmittedNotice
  | DetectedNotice
  | OpenMatchRequest
  | CachedResultsRequest;
