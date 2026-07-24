import type { ExtractedItem } from "../platform/types";
import type { MatchResult } from "./decisions";

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
}
export type ConfirmResponse =
  | { ok: true }
  | { ok: false; error: string; conflict?: boolean; existingColnectId?: string };

export type BackgroundRequest = MatchRequest | ConfirmRequest;
