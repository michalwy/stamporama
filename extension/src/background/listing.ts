import "../platform/modules"; // registers the shipped platform modules into this bundle's registry
import { resolveListingTarget } from "../platform/listing-run";
import type { FillRequest, FillResponse, ListResponse } from "../core/messages";
import type { ListingTask } from "../platform/listing";

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
