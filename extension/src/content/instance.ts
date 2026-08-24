import {
  ASSISTANT_PRESENT_ATTRIBUTE,
  describeListedReport,
  describeListingReport,
  describeUnreadReport,
  describeUpdatedReport,
  LISTING_ELEMENT_ID,
  LISTING_MESSAGE_ATTRIBUTE,
  LISTING_REPORT_ATTRIBUTE,
  LISTING_REQUEST_ATTRIBUTE,
  LISTING_STATE_ATTRIBUTE,
  parseListingHandoff,
  type ListingHandoffReport,
  type ListingHandoffState,
} from "../core/listing-handoff";
import {
  MATCH_ELEMENT_ID,
  MATCH_MESSAGE_ATTRIBUTE,
  MATCH_REQUEST_ATTRIBUTE,
  MATCH_STATE_ATTRIBUTE,
  MATCHED_ATTRIBUTE,
  parseMatchHandoff,
  type MatchHandoffState,
} from "../core/match-handoff";
import {
  APPLY_ELEMENT_ID,
  APPLY_MESSAGE_ATTRIBUTE,
  APPLY_REPORT_ATTRIBUTE,
  APPLY_REQUEST_ATTRIBUTE,
  APPLY_STATE_ATTRIBUTE,
  parseApplyHandoff,
  type ApplyHandoffState,
} from "../core/colnect-apply-handoff";
import type {
  ColnectApplyProgressNotice,
  ColnectApplyRequest,
  ColnectApplyResponse,
  ListedNotice,
  ListedResponse,
  ListRequest,
  ListResponse,
  MatchedNotice,
  OpenMatchRequest,
  OpenMatchResponse,
} from "../core/messages";

// The content script that runs on a **registered instance's own origin** (#409) — registered
// dynamically as profiles are (`background/instance-scripts.ts`), because a self-hosted instance has
// no origin the manifest could declare.
//
// It carries tasks from the instance's own screens to the background worker, and the outcomes back
// onto the page: a listing task from the bulk listing workspace (#322/#407), a stamp to match
// (#423), and — since #689 — a Colnect list difference to apply. It never touches the instance's
// data, never reads a token, and runs on no other origin.

declare global {
  interface Window {
    __stamporamaAssistantInstanceLoaded?: boolean;
  }
}

/**
 * Handoffs already answered (or being answered), so a re-render of the element — React owns that
 * node — is not read as the collector asking again.
 *
 * A request stays here **however it ended**, failures included. The answer is written back onto that
 * very node, so an id dropped on failure is picked straight back up by the observer the report itself
 * fires, handed over again, and fails again — a run that opens a marketplace tab per turn, for ever.
 * Pressing the button again is not blocked by this: the page mints a fresh `requestId` per press
 * (`assistant-handoff.ts`), which is what a retry *is*.
 */
const handled = new Set<string>();

function handoffElement(): HTMLElement | null {
  return document.getElementById(LISTING_ELEMENT_ID);
}

/** Write the outcome back the way registration does: attributes on the page's own node. The request
 *  id travels with it, so the page can tell an answer to *this* handoff from a leftover one. */
function report(
  requestId: string,
  state: ListingHandoffState,
  message: string,
  detail?: ListingHandoffReport
): void {
  const el = handoffElement();
  if (!el) return; // the collector navigated on; the tab with the form is still there
  el.setAttribute(LISTING_REQUEST_ATTRIBUTE, requestId);
  el.setAttribute(LISTING_STATE_ATTRIBUTE, state);
  el.setAttribute(LISTING_MESSAGE_ATTRIBUTE, message);
  if (detail) el.setAttribute(LISTING_REPORT_ATTRIBUTE, JSON.stringify(detail));
  else el.removeAttribute(LISTING_REPORT_ATTRIBUTE);
}

/**
 * The payload text each pump last looked at.
 *
 * The observer below fires on **every** mutation of a React screen — a tooltip opening, a row
 * re-rendering, a query settling — and the handoff element holds the offer's whole listing kit once
 * one has been handed over. Without this, every one of those mutations re-parses a multi-kilobyte
 * JSON twice, on the main thread, for ever after the first listing: the screen goes sticky exactly
 * where it was fine a moment before, and a click can land while the row under it is being re-rendered.
 *
 * The text is the whole of what a pump reads, so a text that has not changed cannot mean anything new.
 */
let lastListingPayload: string | null = null;
let lastMatchPayload: string | null = null;
let lastApplyPayload: string | null = null;

/** Read the element; hand a task the extension has not seen before to the worker. */
async function pump(): Promise<void> {
  const el = handoffElement();
  if (!el) return;
  const raw = el.textContent;
  if (raw === lastListingPayload) return;
  lastListingPayload = raw;
  const handoff = parseListingHandoff(raw);
  if (!handoff || handled.has(handoff.requestId)) return;
  handled.add(handoff.requestId);

  // Said before anything is opened: resolving the module and loading a marketplace form takes long
  // enough that a card with no acknowledgement reads as a dead button.
  report(handoff.requestId, "running", "Opening the listing form…");

  let res: ListResponse;
  try {
    res = (await chrome.runtime.sendMessage({
      type: "list",
      task: handoff.task,
      requestId: handoff.requestId,
    } satisfies ListRequest)) as ListResponse;
  } catch (e) {
    // The worker is gone or the extension was reloaded mid-handoff. Reported and left alone — see
    // {@link handled} for why this must not be retried from here.
    report(handoff.requestId, "error", e instanceof Error ? e.message : String(e));
    return;
  }

  if (!res.ok) {
    report(handoff.requestId, "error", res.error);
    return;
  }

  const detail: ListingHandoffReport = {
    moduleId: res.moduleId,
    moduleName: res.moduleName,
    formUrl: res.formUrl,
    filled: res.outcome.filled,
    skipped: res.outcome.skipped,
  };
  report(handoff.requestId, "filled", describeListingReport(detail), detail);
}

// ── The match handoff ────────────────────────────────────────────────────────
// The same two motions on a second node: read a task the extension has not seen, answer on the node
// it came in on. Its own `handled` set, since the two handoffs mint ids independently.

const matchesHandled = new Set<string>();

function matchElement(): HTMLElement | null {
  return document.getElementById(MATCH_ELEMENT_ID);
}

function reportMatch(requestId: string, state: MatchHandoffState, message: string): void {
  const el = matchElement();
  if (!el) return; // the collector navigated on; the search tab is open regardless
  el.setAttribute(MATCH_REQUEST_ATTRIBUTE, requestId);
  el.setAttribute(MATCH_STATE_ATTRIBUTE, state);
  el.setAttribute(MATCH_MESSAGE_ATTRIBUTE, message);
}

async function pumpMatch(): Promise<void> {
  const el = matchElement();
  if (!el) return;
  const raw = el.textContent;
  if (raw === lastMatchPayload) return;
  lastMatchPayload = raw;
  const handoff = parseMatchHandoff(raw);
  if (!handoff || matchesHandled.has(handoff.requestId)) return;
  matchesHandled.add(handoff.requestId);

  // Said before anything opens: loading a marketplace search and matching it against the collection
  // takes long enough that a button with no acknowledgement reads as a dead one.
  reportMatch(handoff.requestId, "running", "Opening the search…");

  let res: OpenMatchResponse;
  try {
    res = (await chrome.runtime.sendMessage({
      type: "open-match",
      url: handoff.task.url,
      requestId: handoff.requestId,
    } satisfies OpenMatchRequest)) as OpenMatchResponse;
  } catch (e) {
    // Reported and left alone, for the listing pump's reason exactly: the answer is written onto the
    // node the request came in on, so a request forgotten on failure is re-read from the mutation the
    // failure itself caused. A press of the button mints a new id.
    reportMatch(handoff.requestId, "error", e instanceof Error ? e.message : String(e));
    return;
  }

  if (!res.ok) {
    reportMatch(handoff.requestId, "error", res.error);
    return;
  }
  reportMatch(
    handoff.requestId,
    "opened",
    handoff.task.label
      ? `Searching for ${handoff.task.label} — match it in the Assistant window.`
      : "Match it in the Assistant window."
  );
}

// ── The Colnect apply handoff (#689) ─────────────────────────────────────────
// The same two motions on a fourth node, and its own `handled` set. What is different is the far
// end: this is the one handoff that leads to a **write on somebody else's site** (ADR-0042), and one
// that runs for an hour and a half — so the answer is not one report but a stream of them, arriving
// on the notice below long after the request was answered.

const appliesHandled = new Set<string>();

function applyElement(): HTMLElement | null {
  return document.getElementById(APPLY_ELEMENT_ID);
}

function reportApply(
  requestId: string,
  state: ApplyHandoffState,
  message: string,
  report?: unknown
): void {
  const el = applyElement();
  if (!el) return; // the collector navigated on; the run carries on regardless
  el.setAttribute(APPLY_REQUEST_ATTRIBUTE, requestId);
  el.setAttribute(APPLY_STATE_ATTRIBUTE, state);
  el.setAttribute(APPLY_MESSAGE_ATTRIBUTE, message);
  if (report) el.setAttribute(APPLY_REPORT_ATTRIBUTE, JSON.stringify(report));
}

async function pumpApply(): Promise<void> {
  const el = applyElement();
  if (!el) return;
  const raw = el.textContent;
  if (raw === lastApplyPayload) return;
  lastApplyPayload = raw;
  const handoff = parseApplyHandoff(raw);
  if (!handoff || appliesHandled.has(handoff.requestId)) return;
  appliesHandled.add(handoff.requestId);

  reportApply(handoff.requestId, "running", "Opening Colnect…");

  let res: ColnectApplyResponse;
  try {
    res = (await chrome.runtime.sendMessage({
      type: "colnect-apply",
      task: handoff.task,
      requestId: handoff.requestId,
    } satisfies ColnectApplyRequest)) as ColnectApplyResponse;
  } catch (e) {
    // Reported and left alone, exactly as the two pumps above are: the answer lands on the node the
    // request came in on, so an id forgotten on failure is picked straight back up by the mutation
    // the failure itself caused. A press of the button mints a new id, which is what a retry is.
    reportApply(handoff.requestId, "error", e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok) reportApply(handoff.requestId, "error", res.error);
}

/**
 * Whether this page is still following `requestId` — which is what decides who activates the offer
 * (#412).
 *
 * The handoff element's **text** is the page's own half of the contract, so a task still written there
 * under this id means the screen that started the listing is on the other end of the answer and will
 * publish it. Anything else — dismissed, replaced by the next offer's handoff, or a screen that is no
 * longer this one — is the case the background worker posts the URL for instead.
 */
function stillFollowing(requestId: string): boolean {
  return parseListingHandoff(handoffElement()?.textContent)?.requestId === requestId;
}

if (!window.__stamporamaAssistantInstanceLoaded) {
  window.__stamporamaAssistantInstanceLoaded = true;

  // The listing was posted on the marketplace (#412) — minutes after the fill, in the collector's own
  // time. It comes back onto the same node the fill's report did, and the reply says whether this page
  // took it: an answer nobody is following is the one the worker posts to the instance itself.
  chrome.runtime.onMessage.addListener(
    (msg: ListedNotice, _sender, sendResponse: (r: ListedResponse) => void) => {
      if (msg?.type !== "listed") return;
      const taken = stillFollowing(msg.requestId);
      if (taken) {
        const detail: ListingHandoffReport = {
          moduleId: msg.moduleId,
          moduleName: msg.moduleName,
          formUrl: msg.formUrl,
          filled: [],
          skipped: [],
          ...(msg.listedUrl ? { listedUrl: msg.listedUrl } : {}),
        };
        // An update is one answer rather than two (#462): the listing existed before this run, so
        // whether its URL was read back changes nothing the page would act on.
        if (msg.mode === "update") {
          report(msg.requestId, "updated", describeUpdatedReport(detail), detail);
        } else {
          report(
            msg.requestId,
            msg.listedUrl ? "listed" : "unread",
            msg.listedUrl ? describeListedReport(detail) : describeUnreadReport(detail),
            detail
          );
        }
      }
      sendResponse({ taken });
    }
  );

  // A match was written somewhere — this page's own handoff, or the collector matching a Colnect
  // page from the toolbar icon. Ring the doorbell; what the page does with it is its own business,
  // and every screen showing item-IDs wants the same thing: to re-read them.
  chrome.runtime.onMessage.addListener((msg: MatchedNotice) => {
    if (msg?.type !== "matched") return;
    // The value only has to differ from the last one for the page's observer to fire.
    document.documentElement.setAttribute(MATCHED_ATTRIBUTE, String(Date.now()));
  });

  // Tell the page the Assistant is here and scripting this origin, so **List via Assistant** can be
  // offered by a page that has no other way to find out — and stays honest on a browser without the
  // extension, where the attribute simply never appears.
  document.documentElement.setAttribute(
    ASSISTANT_PRESENT_ATTRIBUTE,
    chrome.runtime.getManifest().version
  );

  // How a Colnect run is going (#689), arriving over the whole length of it — minutes to hours. It
  // comes back onto the same node the worklist went out on, and is dropped where the screen has been
  // replaced: the run is recorded on the instance as it goes, so nobody is depending on this.
  chrome.runtime.onMessage.addListener((msg: ColnectApplyProgressNotice) => {
    if (msg?.type !== "colnect-apply-progress") return;
    reportApply(msg.requestId, msg.state, msg.message, msg.report);
  });

  void pump();
  void pumpMatch();
  void pumpApply();

  // The elements are written by a click inside a client-rendered screen, so they appear (and are
  // rewritten for the next offer) long after load. Watching the whole document is the cheap, obvious
  // thing — but only because both pumps stop at a payload they have already read (`lastListingPayload`)
  // and because a burst of mutations is **coalesced into one pass**.
  //
  // Both matter on the screen this runs on. React re-renders a row, opens a tooltip and settles a
  // query in tens of mutations at a time, and a listing workspace holds forty of those rows; a pump
  // per mutation is a JSON parse per mutation, which is how a screen that was fine before the first
  // listing turns sticky after it.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    // A microtask, not a frame: the answer should still be immediate to the collector, and this only
    // has to outlast the burst that React is in the middle of.
    void Promise.resolve().then(() => {
      scheduled = false;
      void pump();
      void pumpMatch();
      void pumpApply();
    });
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
