import {
  ASSISTANT_PRESENT_ATTRIBUTE,
  describeListingReport,
  LISTING_ELEMENT_ID,
  LISTING_MESSAGE_ATTRIBUTE,
  LISTING_REPORT_ATTRIBUTE,
  LISTING_REQUEST_ATTRIBUTE,
  LISTING_STATE_ATTRIBUTE,
  parseListingHandoff,
  type ListingHandoffReport,
  type ListingHandoffState,
} from "../core/listing-handoff";
import type { ListRequest, ListResponse } from "../core/messages";

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

/** Handoffs already answered (or being answered), so a re-render of the element — React owns that
 *  node — is not read as the collector asking again. */
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
    } satisfies ListRequest)) as ListResponse;
  } catch (e) {
    // The worker is gone or the extension was reloaded mid-handoff. Forget the request, so pressing
    // the button again actually retries it.
    handled.delete(handoff.requestId);
    report(handoff.requestId, "error", e instanceof Error ? e.message : String(e));
    return;
  }

  if (!res.ok) {
    handled.delete(handoff.requestId);
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

if (!window.__stamporamaAssistantInstanceLoaded) {
  window.__stamporamaAssistantInstanceLoaded = true;

  // Tell the page the Assistant is here and scripting this origin, so **List via Assistant** can be
  // offered by a page that has no other way to find out — and stays honest on a browser without the
  // extension, where the attribute simply never appears.
  document.documentElement.setAttribute(
    ASSISTANT_PRESENT_ATTRIBUTE,
    chrome.runtime.getManifest().version
  );

  void pump();

  // The element is written by a click inside a client-rendered screen, so it appears (and is
  // rewritten for the next offer) long after load. Watching the whole document is the cheap,
  // obvious thing: the observer fires on the page's own renders and `pump` exits on the first line
  // whenever there is nothing new.
  new MutationObserver(() => void pump()).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
