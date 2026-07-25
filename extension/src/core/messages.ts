import type { ExtractedItem } from "../platform/types";
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

export type BackgroundMessage = BackgroundRequest | DetectedNotice | CachedResultsRequest;
