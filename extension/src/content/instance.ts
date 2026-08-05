import {
  ASSISTANT_PRESENT_ATTRIBUTE,
  describeListedReport,
  describeListingReport,
  describeUnreadReport,
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
import type {
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
// It does one thing: carry a listing task from the bulk listing workspace (#322/#407) to the
// background worker, and carry the outcome back onto the page. It never touches the instance's data,
// never reads a token, and runs on no other origin.

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

/** Read the element; hand a task the extension has not seen before to the worker. */
async function pump(): Promise<void> {
  const el = handoffElement();
  if (!el) return;
  const handoff = parseListingHandoff(el.textContent);
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
  const handoff = parseMatchHandoff(el.textContent);
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
        report(
          msg.requestId,
          msg.listedUrl ? "listed" : "unread",
          msg.listedUrl ? describeListedReport(detail) : describeUnreadReport(detail),
          detail
        );
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

  void pump();
  void pumpMatch();

  // The elements are written by a click inside a client-rendered screen, so they appear (and are
  // rewritten for the next offer) long after load. Watching the whole document is the cheap,
  // obvious thing: the observer fires on the page's own renders and both pumps exit on the first
  // line whenever there is nothing new.
  new MutationObserver(() => {
    void pump();
    void pumpMatch();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
