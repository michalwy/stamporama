import "../platform/modules"; // registers the shipped platform modules into this bundle's registry
import { resolveListedUrl, resolveListingTarget } from "../platform/listing-run";
import type {
  FillRequest,
  FillResponse,
  ListedNotice,
  ListedResponse,
  ListResponse,
} from "../core/messages";
import type { ListingTask } from "../platform/listing";
import {
  forgetPendingListing,
  getPendingListing,
  markPendingListingSubmitted,
  rememberPendingListing,
  type PendingListing,
} from "./pending-listings";
import { postListedUrl, profileForListing } from "./listing-client";

// The wiring around `listing-run.ts` (#409): the half that has a browser to drive.
//
// `resolveListingTarget` and `fillListing` are pure and know nothing of Colnect or of tabs; what
// sits between them is a **navigation**, and this is where it happens — open the sale form beside
// the page that asked, wait for it, and have the content script there fill it. A second marketplace
// reuses every line of this unchanged, because nothing here names one.
//
// Nothing is submitted, here or below: the collector clicks the platform's own button.

/** How long to wait for the sale form to load before giving up. Generous — a marketplace form is a
 *  heavy page and the collector may be signing in — but finite, so a tab that never settles reports
 *  a timeout instead of leaving the offer card spinning for ever. */
const LOAD_TIMEOUT_MS = 90_000;

/**
 * Run one listing task: resolve the module and the form URL, open it, fill it, and report.
 *
 * `sender` is the instance tab the handoff came from, used only to place the new tab beside it —
 * a listing session is worked through offer by offer, so the form belongs next to the workspace and
 * not at the end of a window's worth of tabs.
 */
export async function runListingTask(
  task: ListingTask,
  requestId: string,
  sender: chrome.tabs.Tab | undefined
): Promise<ListResponse> {
  const target = resolveListingTarget(task);
  if (!target.ok) return { ok: false, error: target.error };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({
      url: target.url,
      active: true,
      openerTabId: sender?.id,
      windowId: sender?.windowId,
      index: sender?.index === undefined ? undefined : sender.index + 1,
    });
  } catch (e) {
    return { ok: false, error: `Could not open ${target.moduleName}'s listing form: ${message(e)}` };
  }
  if (tab.id === undefined) {
    return { ok: false, error: `Could not open ${target.moduleName}'s listing form.` };
  }

  try {
    await waitForLoad(tab.id);
    // The declared content script covers the marketplace's own origin, but a tab that was already
    // open before an extension reload never ran it — the popup injects for the same reason. The
    // script guards itself against running twice.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: "fill",
      task,
    } satisfies FillRequest)) as FillResponse;
    if (!res.ok) return { ok: false, error: res.error };

    // The form is filled and the collector takes over. What they do next — Save, or nothing at all —
    // happens in their own time, long after this worker has been unloaded, so the wait is written
    // down rather than held (#412).
    await rememberPendingListing({
      tabId: tab.id,
      moduleId: res.moduleId,
      moduleName: res.moduleName,
      formUrl: target.url,
      offerId: task.offerId,
      collectionId: task.collectionId,
      requestId,
      instanceTabId: sender?.id ?? null,
      instanceOrigin: originOf(sender?.url),
      submitted: false,
      filledAt: Date.now(),
    });

    return {
      ok: true,
      moduleId: res.moduleId,
      moduleName: res.moduleName,
      formUrl: target.url,
      outcome: res.outcome,
    };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * A navigation in a tab that holds a filled form: the one place the listing's own URL can be read
 * (#412).
 *
 * The module is asked whether this page **is** the listed entry — for Colnect it is, Save landing
 * straight on it — and only an answer captures. Every other page is silence: the collector may be
 * signing in, may have followed a link out of the form, or the form may have come back with its own
 * validation errors, and none of those has produced a listing.
 */
export async function captureListedUrl(tabId: number, url: string): Promise<void> {
  const pending = await getPendingListing(tabId, Date.now());
  if (!pending) return;
  const listedUrl = resolveListedUrl(pending.moduleId, url);
  if (!listedUrl) return;

  // Forgotten first: the entry page may fire more than one navigation event, and an offer is
  // activated once.
  await forgetPendingListing(tabId);
  await deliverListedUrl(pending, listedUrl);
}

/**
 * The listing tab was closed. A form the collector **submitted** whose entry was never recognised is
 * worth saying so — the listing exists and the offer does not know — while an abandoned one is worth
 * nothing at all: it leaves a Ready offer exactly as it was, which is what the scope asks for.
 */
export async function listingTabClosed(tabId: number): Promise<void> {
  const pending = await getPendingListing(tabId, Date.now());
  await forgetPendingListing(tabId);
  if (pending?.submitted) await deliverListedUrl(pending, null);
}

/** The filled form has been submitted, reported by the content script watching it (#412). */
export async function listingSubmitted(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await markPendingListingSubmitted(tabId);
}

/**
 * Get the outcome home: to the **page** that handed the offer over, which publishes it itself, and
 * failing that straight to the instance.
 *
 * The page is preferred because that is #407's rule — the extension reports and the instance decides,
 * with the collector watching it happen on the card they started from. But this arrives after Save,
 * by which time that page may be closed, navigated away, or following the next offer's handoff, and
 * the URL is the one thing that cannot be recovered later. So a `taken: false` (or no page to ask at
 * all) falls through to the endpoint, which is idempotent precisely so the two cannot collide.
 *
 * A null `listedUrl` is the "submitted, URL unread" report: there is nothing to post, and the page is
 * simply told so.
 */
async function deliverListedUrl(pending: PendingListing, listedUrl: string | null): Promise<void> {
  const notice: ListedNotice = {
    type: "listed",
    requestId: pending.requestId,
    offerId: pending.offerId,
    moduleId: pending.moduleId,
    moduleName: pending.moduleName,
    formUrl: pending.formUrl,
    listedUrl,
  };

  let taken = false;
  if (pending.instanceTabId !== null) {
    try {
      const res = (await chrome.tabs.sendMessage(pending.instanceTabId, notice)) as
        | ListedResponse
        | undefined;
      taken = res?.taken === true;
    } catch {
      taken = false; // the tab is gone, or on another origin now
    }
  }
  if (taken || !listedUrl) return;

  const profile = await profileForListing(pending.instanceOrigin, pending.collectionId);
  if (!profile) {
    // Nothing to post with: the instance the page was on is not one this Assistant holds a token for
    // (the collector may have disconnected it since). The listing stands; the offer is activated in
    // Stamporama, where a blank URL is already an accepted answer.
    console.warn("[assistant] no connection to record the listing with", pending.instanceOrigin);
    return;
  }
  try {
    await postListedUrl(profile, pending.offerId, listedUrl);
  } catch (e) {
    console.warn("[assistant] could not record the listing's URL", message(e));
  }
}

/** The origin of a tab's URL, or null — how the page's own instance is named. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Resolve once the tab has finished loading a document. Rejects when the collector closes it, and
 *  when nothing has settled inside {@link LOAD_TIMEOUT_MS} — both being answers the page can state,
 *  unlike a promise that never resolves. */
function waitForLoad(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      fn();
    };
    const onUpdated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === "complete") done(resolve);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) done(() => reject(new Error("The listing tab was closed.")));
    };
    const timer = setTimeout(
      () => done(() => reject(new Error("The listing form did not finish loading."))),
      LOAD_TIMEOUT_MS
    );
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // The tab may already have settled between `create` and this listener going on.
    void chrome.tabs.get(tabId).then(
      (t) => {
        if (t.status === "complete") done(resolve);
      },
      () => done(() => reject(new Error("The listing tab was closed.")))
    );
  });
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
