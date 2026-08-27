// Finding a Colnect page to act from — shared by the apply run (#689) and the export refresh (#690).
//
// Both need the same thing for the same reason: their calls are authenticated by the collector's
// session cookie and nothing else, so they have to be issued same-origin from a document that
// session is live on. Neither cares *which* Colnect page — the call names its own item or list — so
// an already-open tab is reused before a new one is opened, which is also the tab most likely to be
// signed in.

/** Where a tab is opened when none is open. Colnect's own home, in English; the language of the page
 *  that ends up being used is read back off its URL where it matters (`list-export.ts`). */
const COLNECT_HOME = "https://colnect.com/en";

/** A Colnect tab to act from: one already open by preference, a new one otherwise. Null where the
 *  browser refused — no tab means no authority, and every caller says so rather than guessing. */
export async function colnectTab(): Promise<number | null> {
  try {
    const open = await chrome.tabs.query({ url: "*://*.colnect.com/*" });
    const existing = open.find((tab) => tab.id !== undefined);
    if (existing?.id !== undefined) return existing.id;
    const created = await chrome.tabs.create({ url: COLNECT_HOME, active: false });
    if (created.id === undefined) return null;
    await waitForColnectLoad(created.id);
    return created.id;
  } catch {
    return null;
  }
}

/** Wait for a freshly opened tab to finish loading, so the content script is in it. */
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
