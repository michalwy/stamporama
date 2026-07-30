import type { ExtractedItem } from "../platform/types";
import type { ListingFillOutcome, ListingTask } from "../platform/listing";
import type { BackfillProposal, MatchResult } from "./decisions";

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

export type BackgroundMessage =
  | BackgroundRequest
  | ListRequest
  | ListingSubmittedNotice
  | DetectedNotice
  | CachedResultsRequest;
