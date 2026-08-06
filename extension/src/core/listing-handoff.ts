import type { ListingFilledField, ListingSkippedField, ListingTask } from "../platform/listing";

// The listing handoff (#409, part of #155): how a listing task crosses from the instance's own page
// into the extension, and how the outcome crosses back.
//
// It is deliberately the **registration contract again** (#252), one element on the instance's
// origin: the page writes the task into it, the extension answers by setting `data-*` attributes on
// the same node. Nothing new is invented, and the page keeps owning the node — React re-renders it,
// so text in and attributes out is the only direction of travel that survives.
//
// What is different is the *gesture*. Registration is read under `activeTab`, granted by the toolbar
// click that performs it. A listing starts from a click on a card, so there is no toolbar click to
// grant anything — which is why the extension registers a content script for the profile's origin at
// registration time (`background/instance-scripts.ts`) instead.
//
// Mirror of the workspace's own handoff element (#407) — kept in sync by hand, since the extension
// is a separate build with no import path into the app.

/** Element id the task lives in, and the node whose attributes carry the outcome back. */
export const LISTING_ELEMENT_ID = "stamporama-assistant-listing";

/**
 * Attribute the content script stamps on `<html>` on every instance page it runs on, holding the
 * extension's version. It is how the page knows the Assistant is installed *and* scripting this
 * origin — without it, **List via Assistant** would be a button that silently does nothing.
 */
export const ASSISTANT_PRESENT_ATTRIBUTE = "data-stamporama-assistant";

/** What the page writes into the element when the collector hands an offer over. */
export interface ListingHandoff {
  v: 1;
  /**
   * Identifies this handoff. The page reads the outcome back off the same node it may have used
   * before, so an answer states which request it answers rather than leaving a stale one to be read
   * as the current one. Any non-empty string the page cares to mint.
   */
  requestId: string;
  /** The listing kit (#405), unchanged — see `platform/listing.ts`. */
  task: ListingTask;
}

/**
 * How far a handoff has got.
 *
 * `filled` means the form was reached and filled as far as the task allowed — skipped fields
 * included, since a skip is a report and not a failure (#408). The two after it are #412's, and
 * arrive **later**: filling stops before Save, so what happens next happens in the collector's own
 * time, on the marketplace's page.
 *
 *   • `listed` — the sale was submitted and the entry's URL was read. The page publishes the offer
 *     with it (and the extension posts it to the instance when no page is following, #412).
 *   • `unread` — the sale was submitted and the URL could **not** be read. Nothing is wrong with the
 *     listing; it just has to be activated in Stamporama by hand, where a blank URL is already an
 *     accepted answer. Distinct from `error` because nothing failed, and distinct from `filled`
 *     because the listing now exists.
 *
 *   • `updated` — an **edit** of a live listing was saved (#462). Its own state rather than `listed`,
 *     because nothing about the offer changes: it was Active before and it is Active after, and the
 *     URL the page would have published is the address this run was sent to. It also does not split
 *     into two the way the pair above does — the listing existed either way, so reading its URL back
 *     adds nothing worth a separate answer.
 *
 * A submission the collector abandons produces none of them: an untouched Ready offer is not news.
 */
export type ListingHandoffState =
  | "running"
  | "filled"
  | "listed"
  | "unread"
  | "updated"
  | "error";

export const LISTING_STATE_ATTRIBUTE = "data-listing-state";
export const LISTING_REQUEST_ATTRIBUTE = "data-listing-request";
export const LISTING_MESSAGE_ATTRIBUTE = "data-listing-message";
export const LISTING_REPORT_ATTRIBUTE = "data-listing-report";

/** The detail behind a `filled` outcome, as JSON in {@link LISTING_REPORT_ATTRIBUTE}. The message
 *  alone says how it went; this is what the page lists field by field. */
export interface ListingHandoffReport {
  moduleId: string;
  moduleName: string;
  /** The sale form the task was filled into, so the page can link to the tab's page. */
  formUrl: string;
  filled: ListingFilledField[];
  skipped: ListingSkippedField[];
  /** The listed entry's own URL, on a `listed` answer only (#412) — what the offer records and goes
   *  live with. Absent everywhere else: before Save there is no entry to have a URL. */
  listedUrl?: string;
}

/**
 * Validate whatever the page wrote into the element, or `null`.
 *
 * The origin is one the collector registered, so this is not a trust boundary the way the
 * registration payload's is — but it is still a boundary between the page's JSON and a typed value,
 * and a half-written node (React renders the element before the task is chosen) must read as "no
 * handoff" rather than as a broken one. Only the spine every consumer immediately dereferences is
 * checked; the rest is the kit's own shape, which the instance served.
 */
export function parseListingHandoff(raw: string | null | undefined): ListingHandoff | null {
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
  if (typeof t.offerId !== "string" || !t.offerId.trim()) return null;
  if (!Array.isArray(t.items)) return null;

  const platform = t.platform;
  if (typeof platform !== "object" || platform === null) return null;
  const p = platform as Record<string, unknown>;
  if (typeof p.name !== "string") return null;
  // `module` is nullable by design: a platform naming none is a refusal the shell states in full
  // (`listing-run.ts`), not a payload to discard here.
  if (p.module !== null && typeof p.module !== "string") return null;

  return { v: 1, requestId, task: task as ListingTask };
}

/** One sentence for {@link LISTING_MESSAGE_ATTRIBUTE}, naming the module and counting the report.
 *  English and complete: the page renders it as it stands, exactly as it does the registration one. */
export function describeListingReport(report: ListingHandoffReport): string {
  const filled = `${report.filled.length} field${report.filled.length === 1 ? "" : "s"}`;
  if (report.skipped.length === 0) {
    return `Filled ${filled} in ${report.moduleName}'s listing form. Check it over and post it there.`;
  }
  const skipped = `${report.skipped.length} field${report.skipped.length === 1 ? "" : "s"}`;
  return `Filled ${filled} in ${report.moduleName}'s listing form; ${skipped} could not be filled. Check it over and post it there.`;
}

/** One sentence for a `listed` answer (#412): the sale is posted and its URL was read, so the page's
 *  next act is to go live with it. The page says what it then did — this only says what happened on
 *  the marketplace, which is the part only the extension saw. */
export function describeListedReport(report: ListingHandoffReport): string {
  return `Posted on ${report.moduleName}. Activating this offer with the listing's URL…`;
}

/** One sentence for an `updated` answer (#462): the edit was saved on the marketplace, and that is the
 *  whole of it — there is nothing for the page to do afterwards, which is exactly what it says. */
export function describeUpdatedReport(report: ListingHandoffReport): string {
  return `The listing was updated on ${report.moduleName}. Nothing to do here — this offer was already live.`;
}

/** One sentence for an `unread` answer (#412). It names the listing as posted first, because that is
 *  the fact that changed, and then the one thing left to do here. */
export function describeUnreadReport(report: ListingHandoffReport): string {
  return `The listing was submitted on ${report.moduleName}, but the Assistant could not read its URL. Activate this offer here — the URL can be pasted in, or left blank.`;
}
