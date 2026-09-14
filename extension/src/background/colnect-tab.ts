// Finding a Colnect page to act from — shared by the apply run (#689), the export refresh (#690) and
// closing a listing (#729).
//
// All three need the same thing for the same reason: their calls are authenticated by the collector's
// session cookie and nothing else, so they have to be issued same-origin from a document that
// session is live on. None cares *which* Colnect page — the call names its own item, list or sale —
// so an already-open tab is reused before a new one is opened, which is also the tab most likely to
// be signed in.
//
// **A tab is only half of it: the content script has to be in it** (#1292). The declared content
// script runs in pages loaded after the extension was, so a Colnect tab already open when the
// Assistant was installed, updated or reloaded holds no listener, and the first message sent to it
// fails with nothing on the other end — which is how closing a listing failed on the day it shipped.
// So every tab handed back here has had `content.js` injected, as the popup and the listing fill do;
// the script guards itself against running twice.

/** Where a tab is opened when none is open. Colnect's own home, in English; the language of the page
 *  that ends up being used is read back off its URL where it matters (`list-export.ts`). */
const COLNECT_HOME = "https://colnect.com/en";

/** A Colnect tab to act from, with the content script in it: one already open by preference, a new
 *  one otherwise. Null where the browser refused — no tab means no authority, and every caller says
 *  so rather than guessing. */
export async function colnectTab(): Promise<number | null> {
  try {
    const open = await chrome.tabs.query({ url: "*://*.colnect.com/*" });
    for (const tab of open) {
      // A discarded tab has no document to run anything in until somebody looks at it.
      if (tab.id === undefined || tab.discarded) continue;
      if (tab.status !== "complete") await waitForColnectLoad(tab.id);
      if (await withContentScript(tab.id)) return tab.id;
    }
    const created = await chrome.tabs.create({ url: COLNECT_HOME, active: false });
    if (created.id === undefined) return null;
    await waitForColnectLoad(created.id);
    return (await withContentScript(created.id)) ? created.id : null;
  } catch {
    return null;
  }
}

/** Put the content script into a tab. False where the browser will not — a tab showing an error
 *  page, or one closed in the meantime — so the caller moves on to another tab. */
async function withContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch {
    return false;
  }
}

/** Wait for a tab to finish loading, so there is a settled document to act from. */
export function waitForColnectLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Finite: a Colnect page that never settles still has a document, and the first call will say so
    // far more usefully than waiting for ever would.
    const timer = setTimeout(done, 30_000);
    // It may already have settled between `create` and this listener going on.
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") done();
      },
      () => done()
    );
  });
}
