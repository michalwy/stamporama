// The **Colnect market handoff** (#2454): how "read what Colnect's market asks for this offer's
// stamps" crosses from an offer's own screen into the extension, and how the read crosses back.
//
// The close handoff's contract again (#729), on a seventh element: the page writes a task into a
// hidden node as JSON, the extension answers with `data-*` attributes on that same node, and the page
// keeps owning it. A node of its own, because the listing and close nodes on the same screen carry
// their own answers and two answers on one node overwrite each other.
//
// **The extension reads; the page records.** What crosses back is the read as the pages printed it —
// prices in the currency Colnect showed them in, conditions as Colnect's grade numbers, each listing's
// seller — and what any of it means here (which condition is the collector's, which listing is their
// own, what a price is in the offer's currency) is the instance's to decide, #407's rule.
//
// Mirrored by hand in `src/app/c/[collectionSlug]/offers/assistant-market-handoff.ts` — separate
// builds, no import path between them.

import type { ColnectMarketOfferRead } from "../platform/colnect/market";

/** Element id the task lives in, and the node whose attributes carry the read back. */
export const MARKET_ELEMENT_ID = "stamporama-assistant-colnect-market";

/** One Colnect item to read — a stamp of the offer, or the variant it is listed under (#616). */
export interface MarketTaskItem {
  colnectId: string;
  /** What the offer calls it — its catalogue number — for the sentences the run reports. */
  label: string;
}

/** What the page writes into the element when the collector presses the button. */
export interface MarketTask {
  offerId: string;
  collectionId: string;
  items: MarketTaskItem[];
}

export interface MarketHandoff {
  v: 1;
  /** Identifies this read, so an answer states which one it answers. Any non-empty string. */
  requestId: string;
  task: MarketTask;
}

/** What one item's listings turned out to be. */
export interface MarketItemRead {
  colnectId: string;
  offers: ColnectMarketOfferRead[];
  lots: number;
  unreadable: number;
  /** Pages read, and whether there were more than {@link COLNECT_MARKET_MAX_PAGES} allows. */
  pages: number;
  truncated: boolean;
}

/** The whole read, as it goes back to the page. */
export interface MarketRead {
  /** The Colnect login the pages were read as — whose listings are the collector's own. */
  signedInAs: string | null;
  items: MarketItemRead[];
}

/**
 * How far a read has got.
 *
 * - `running` — Colnect's pages are being read.
 * - `done` — the read is on the node (`data-market-result`), for the page to record.
 * - `error` — nothing was read that this build trusts; the card keeps its last read.
 */
export type MarketHandoffState = "running" | "done" | "error";

export const MARKET_STATE_ATTRIBUTE = "data-market-state";
export const MARKET_REQUEST_ATTRIBUTE = "data-market-request";
export const MARKET_MESSAGE_ATTRIBUTE = "data-market-message";
export const MARKET_RESULT_ATTRIBUTE = "data-market-result";

/** At most this many items in one read — an offer of a few hundred different stamps is a lot that is
 *  not priced off a strip per stamp, and reading it would be minutes of pages. */
export const MARKET_MAX_ITEMS = 40;

/**
 * Validate whatever the page wrote into the element, or `null`.
 *
 * Each item id is checked to be a plain Colnect item id, because it goes into a path on Colnect.
 */
export function parseMarketHandoff(raw: string | null | undefined): MarketHandoff | null {
  if (!raw || !raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const h = data as Record<string, unknown>;
  if (h.v !== 1) return null;

  const requestId = typeof h.requestId === "string" ? h.requestId.trim() : "";
  if (!requestId) return null;

  const task = h.task;
  if (typeof task !== "object" || task === null) return null;
  const t = task as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const offerId = str(t.offerId);
  const collectionId = str(t.collectionId);
  if (!offerId || !collectionId || !Array.isArray(t.items)) return null;

  const items: MarketTaskItem[] = [];
  const seen = new Set<string>();
  for (const raw of t.items) {
    if (typeof raw !== "object" || raw === null) return null;
    const i = raw as Record<string, unknown>;
    const colnectId = str(i.colnectId);
    if (!/^\d+$/.test(colnectId)) return null;
    if (seen.has(colnectId)) continue;
    seen.add(colnectId);
    items.push({ colnectId, label: str(i.label) || colnectId });
  }
  if (items.length === 0 || items.length > MARKET_MAX_ITEMS) return null;

  return { v: 1, requestId, task: { offerId, collectionId, items } };
}

/** The sentence for a finished read. English and complete: the page renders it as it stands. */
export function describeMarketRead(read: MarketRead): string {
  const count = read.items.reduce((n, i) => n + i.offers.length, 0);
  return `Read ${count} Colnect listing${count === 1 ? "" : "s"}.`;
}
