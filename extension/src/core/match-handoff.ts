// The **match handoff**: how "find this stamp on the marketplace and let me match it" crosses from
// an instance's own page into the extension.
//
// It is the listing handoff (#409) again, on a third element, and deliberately so: the page writes a
// task into a hidden node as JSON, the extension answers with `data-*` attributes on that same node,
// and the page keeps owning it. A separate node rather than a second task type on the listing one —
// the two travel at once (an offer being prepared is matched *and* listed) and an answer to one must
// not overwrite the answer to the other.
//
// What it buys: listing on Colnect needs every stamp to carry an item-ID, and recording one meant
// leaving the offer, searching by hand, pressing the toolbar icon, matching, and reloading. The task
// carries the search the instance already knows how to build (#423), and the extension does the two
// steps the page has no way to take: open it, and put the match window in front of it.
//
// Mirrored by hand in `src/app/c/[collectionSlug]/offers/assistant-match-handoff.ts` — separate
// builds, no import path between them, exactly as the listing and registration contracts are.

/** Element id the task lives in, and the node whose attributes carry the outcome back. */
export const MATCH_ELEMENT_ID = "stamporama-assistant-match";

/** What the page writes into the element when the collector asks for a stamp to be matched. */
export interface MatchHandoff {
  v: 1;
  /** Identifies this handoff, so an answer states which request it answers. Any non-empty string. */
  requestId: string;
  task: MatchTask;
}

export interface MatchTask {
  /** The marketplace search to open — built by the instance, which is where the catalog number and
   *  the platform's URL shape both live (#423). The extension opens it and matches what loads. */
  url: string;
  /** What the collector pressed Link on, for the message the page renders back. Cosmetic. */
  label?: string;
}

/**
 * How far a match handoff has got. It ends at `opened`: what happens in the match window is the
 * collector's own work, and its outcome comes back on the broadcast (see {@link MATCHED_ATTRIBUTE})
 * rather than on this node — a match may be written for a stamp this handoff never named.
 */
export type MatchHandoffState = "running" | "opened" | "error";

export const MATCH_STATE_ATTRIBUTE = "data-match-state";
export const MATCH_REQUEST_ATTRIBUTE = "data-match-request";
export const MATCH_MESSAGE_ATTRIBUTE = "data-match-message";

/**
 * Set on `<html>` — and *changed* — every time a match is written to an instance, whatever started
 * it: this handoff, or the collector pressing the toolbar icon on a page of their own. It is a
 * doorbell, not a message: the value is only there to differ from the last one, and what the page
 * does with it is re-read its own data.
 *
 * Deliberately carries no request id. Any confirmed match may be the one a screen is waiting for,
 * re-reading is cheap, and per-request precision here would be precision nobody can see.
 */
export const MATCHED_ATTRIBUTE = "data-stamporama-assistant-matched";

/**
 * Validate whatever the page wrote into the element, or `null`.
 *
 * As with the listing handoff, this is a boundary between the page's JSON and a typed value rather
 * than a trust boundary — the origin is one the collector registered. A half-written node (React
 * renders the element before a stamp is chosen) must read as "no handoff", not as a broken one.
 */
export function parseMatchHandoff(raw: string | null | undefined): MatchHandoff | null {
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
  const url = typeof t.url === "string" ? t.url.trim() : "";
  // Only http(s), and parsed rather than prefix-matched: the URL is handed to `chrome.tabs.create`,
  // and a `javascript:` one written into the page would otherwise be opened by us.
  if (!isHttpUrl(url)) return null;

  return {
    v: 1,
    requestId,
    task: { url, label: typeof t.label === "string" ? t.label : undefined },
  };
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
