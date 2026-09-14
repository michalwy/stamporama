// The **Colnect close handoff** (#729): how "take this listing down on Colnect" crosses from an
// offer's own screen into the extension, and how the outcome crosses back.
//
// The export handoff's contract again (#690), on a sixth element: the page writes a task into a hidden
// node as JSON, the extension answers with `data-*` attributes on that same node, and the page keeps
// owning it. A **separate** node rather than another mode of the listing one, because that node already
// carries this offer's listing report, and two answers on one node overwrite each other.
//
// **The extension closes; the page withdraws.** What crosses back is only whether Colnect confirmed
// the close. Withdrawing the offer is the instance's own transition, taken by the screen the collector
// confirmed on — #407's rule, the extension reports and the instance decides.
//
// Mirrored by hand in `src/app/c/[collectionSlug]/offers/assistant-close-handoff.ts` — separate builds,
// no import path between them.

/** Element id the task lives in, and the node whose attributes carry the outcome back. */
export const CLOSE_ELEMENT_ID = "stamporama-assistant-colnect-close";

/** What the page writes into the element when the collector confirms. */
export interface CloseTask {
  offerId: string;
  collectionId: string;
  /** Colnect's own code for the sale — `Offer.colnectSaleId` (#696), never parsed out of a URL here. */
  saleId: string;
  /** What the offer is called, for the sentences the run reports. */
  label: string;
}

export interface CloseHandoff {
  v: 1;
  /** Identifies this close, so an answer states which one it answers. Any non-empty string. */
  requestId: string;
  task: CloseTask;
}

/**
 * How far a close has got.
 *
 * - `running` — a Colnect page is being found and the close sent.
 * - `closed` — Colnect answered `OK`. The page's cue to withdraw the offer.
 * - `error` — **nothing was closed that this build knows of**, and the offer is left as it is.
 */
export type CloseHandoffState = "running" | "closed" | "error";

export const CLOSE_STATE_ATTRIBUTE = "data-close-state";
export const CLOSE_REQUEST_ATTRIBUTE = "data-close-request";
export const CLOSE_MESSAGE_ATTRIBUTE = "data-close-message";

/**
 * Validate whatever the page wrote into the element, or `null`.
 *
 * A boundary between the page's JSON and a typed value rather than a trust boundary — the origin is one
 * the collector registered — but this one leads to a write on somebody else's site, so every field the
 * write names is checked rather than only the spine: a task with no sale code is no task.
 */
export function parseCloseHandoff(raw: string | null | undefined): CloseHandoff | null {
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
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const offerId = text(t.offerId);
  const collectionId = text(t.collectionId);
  const saleId = text(t.saleId);
  if (!offerId || !collectionId || !saleId) return null;

  return {
    v: 1,
    requestId,
    task: { offerId, collectionId, saleId, label: text(t.label) || "this offer" },
  };
}

/** The sentence for a confirmed close. English and complete: the page renders it as it stands. */
export function describeClosed(task: CloseTask): string {
  return `Closed ${task.label} on Colnect.`;
}

/** What the collector can do after a close that did not happen. The same whatever broke, because so is
 *  their position: the offer is still Active here, and either another try or closing the listing on
 *  Colnect by hand gets them out. */
export const CLOSE_NEXT_STEP =
  "This offer is still active. Try again, or close the listing on Colnect by hand and then withdraw this offer.";

/**
 * The sentence for a close that did not happen (#1292): what went wrong, then {@link CLOSE_NEXT_STEP}.
 * A failure that named only the step that broke left the collector with a diagnosis and no way on.
 */
export function describeCloseFailure(what: string): string {
  const sentence = what.trim().replace(/[\s.]+$/, "");
  return sentence ? `${sentence}. ${CLOSE_NEXT_STEP}` : `The listing was not closed. ${CLOSE_NEXT_STEP}`;
}
