import { getActiveProfile, getProfileStore } from "../core/profile";
import { CATALOG_BACKFILL, getCatalogBackfill, getMatchOnLoad } from "../core/settings";
import type {
  BackgroundMessage,
  BackgroundRequest,
  CaptureSaveResponse,
  CachedResultsResponse,
  ConfirmResponse,
  DetectedNotice,
  MatchedNotice,
  MatchResponse,
  OpenMatchResponse,
} from "../core/messages";
import type { MatchResult } from "../core/decisions";
import { callConfirm, callMatch } from "./matching-client";
import { callCapture } from "./capture-client";
import { findCaptureModuleForUrl } from "../platform/modules";
import { instancePatterns, syncInstanceContentScripts } from "./instance-scripts";
import { captureListedUrl, listingSubmitted, listingTabClosed, runListingTask } from "./listing";
import { handleRegistrationClick } from "./registration";

// Background service worker: routes match/confirm requests from the popup to the active profile's
// instance, and maintains the per-tab toolbar badge showing how many items the page holds.
// Extraction itself happens in the content script; the SW owns instance I/O and the badge.

// Badge colours carry meaning: blue = "this many items are on the page" (we haven't matched, or
// couldn't reach the instance), amber = "something needs your decision", green = "all unambiguous,
// ready to write".
const BADGE_DETECTED = "#2563eb";
const BADGE_NEEDS_DECISION = "#b45309";
const BADGE_AUTO = "#15803d";

async function setBadge(tabId: number | undefined, count: number, color: string): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  } catch {
    // The tab may be gone by now — a stale badge update is never worth surfacing.
  }
}

/** Load-time match results, per tab, so opening the window is instant. Cleared on navigation. */
const resultCache = new Map<number, MatchResult[]>();

/**
 * Dry-run the page as it loads and turn the outcome into a badge: how many stamps actually need
 * action (`auto` waiting to be written + `needs-confirm`), amber when a decision is required.
 * Everything here is read-only. On any failure — no profile, instance unreachable, disabled — the
 * badge falls back to the detected count, so an absent badge never silently means "couldn't reach
 * the instance".
 */
async function matchOnLoad(tabId: number, notice: DetectedNotice): Promise<void> {
  if (notice.count === 0) return;
  if (!(await getMatchOnLoad())) return;
  const profile = await getActiveProfile();
  if (!profile) return;

  try {
    const items = notice.refs.map((r) => ({
      platformItemId: r.platformItemId,
      catalogRefs: r.catalogRefs,
    }));
    const results = await callMatch(profile, items, true, await getCatalogBackfill());
    resultCache.set(tabId, results);

    const needsConfirm = results.filter((r) => r.status === "needs-confirm").length;
    const pendingAuto = results.filter((r) => r.status === "auto" && !r.alreadySet).length;
    const todo = needsConfirm + pendingAuto;
    await setBadge(tabId, todo, needsConfirm > 0 ? BADGE_NEEDS_DECISION : BADGE_AUTO);
  } catch {
    // Leave the detected-count badge in place; browsing offline must stay quiet.
  }
}

async function handle(msg: BackgroundRequest): Promise<MatchResponse | ConfirmResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }

  // The backfill flag is read here rather than taken from the caller, so the load-time match, the
  // window's preview and every write all describe the same setting (#280).
  const backfill = await getCatalogBackfill();

  if (msg.type === "match") {
    const results = await callMatch(profile, msg.items, msg.dryRun, backfill);
    return { ok: true, results };
  }

  const outcome = await callConfirm(profile, msg.colnectId, msg.stampId, {
    allowOverwrite: msg.allowOverwrite,
    backfill,
    catalogRefs: msg.catalogRefs,
  });
  if (outcome.ok) {
    // The instance now knows something a screen of it may be showing. Ring the doorbell — not
    // awaited, since the popup's answer must not wait on other tabs.
    void broadcastMatched();
    return { ok: true, backfill: outcome.backfill };
  }
  if (outcome.conflict) {
    return { ok: false, error: "conflict", conflict: true, existingColnectId: outcome.existingColnectId };
  }
  return { ok: false, error: outcome.error };
}

async function captureLot(
  lot: Parameters<typeof callCapture>[1],
  dryRun: boolean
): Promise<CaptureSaveResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }
  return callCapture(profile, lot, dryRun);
}

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  // Fire-and-forget page report from a content script: show what's there, then refine the badge
  // into "work to do" once the dry-run comes back. No response expected.
  if (msg?.type === "detected") {
    const tabId = sender.tab?.id;
    void setBadge(tabId, msg.count, BADGE_DETECTED);
    if (tabId !== undefined) void matchOnLoad(tabId, msg);
    return false;
  }

  // A listing handed over by an instance's own page (#409). It needs no profile — a task is
  // self-contained, and the origin that wrote it is one the collector registered — so it is answered
  // ahead of the profile check every matcher call goes through.
  // The sale form the Assistant filled has been submitted (#412) — noted, so that the tab being
  // closed without a recognised entry page can be told apart from a listing simply abandoned.
  if (msg?.type === "listing-submitted") {
    void listingSubmitted(sender.tab?.id);
    return false;
  }

  // A stamp handed over from an offer screen for matching. Like `list`, it needs no profile — the
  // origin that wrote it is one the collector registered — so it is answered ahead of the profile
  // check every matcher call goes through.
  if (msg?.type === "open-match") {
    openMatch(msg.url, sender.tab)
      .then(() => sendResponse({ ok: true } satisfies OpenMatchResponse))
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies OpenMatchResponse)
      );
    return true;
  }

  // A lot captured from a marketplace page (#355). It needs the active profile — unlike a listing
  // handoff, nothing about a marketplace page says which collection it belongs to — so it is answered
  // here rather than in `handle`, which is shaped around the matcher's own two calls.
  if (msg?.type === "capture-save") {
    captureLot(msg.lot, msg.dryRun)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies CaptureSaveResponse)
      );
    return true;
  }

  if (msg?.type === "list") {
    runListingTask(msg.task, msg.requestId, sender.tab)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  // The window asking for the load-time match of its source tab.
  if (msg?.type === "cached-results") {
    sendResponse({ results: resultCache.get(msg.tabId) ?? null } satisfies CachedResultsResponse);
    return false;
  }

  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // keep the message channel open for the async response
});

// A navigation invalidates the previous count; clear it so a stale number never lingers on a page
// we haven't (or can't) parse. The content script sets a fresh one when the new page settles.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    resultCache.delete(tabId);
    void setBadge(tabId, 0, BADGE_DETECTED);
  }
  // Where a submitted listing is read back (#412). The URL is taken from the change itself so a page
  // that only ever commits — a redirect chain, a document that never reports `complete` — is still
  // seen; the pending record makes this a no-op on every tab but the one holding a filled form.
  const url = changeInfo.url;
  if (url) void captureListedUrl(tabId, url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  resultCache.delete(tabId);
  void listingTabClosed(tabId);
});

// Switching profile (#251) re-points everything: every cached result and every badge was computed
// against the instance we just left, so they are dropped rather than left to describe the wrong
// collection. The next page load (or the Assistant window) matches afresh against the new target.
// Switching the backfill setting (#280) invalidates the cache for the same reason: the cached
// results were computed with the other setting and would show the wrong proposals.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // Which origins the Assistant scripts follows the profile list and nothing else (#409): a profile
  // added by registration, one whose URL was corrected, one deleted after its token was revoked.
  // Hanging it off the store rather than off each call site is what keeps the two from drifting.
  if ("profiles" in changes) void syncInstanceContentScripts();
  if (!("activeProfileId" in changes) && !("profiles" in changes) && !(CATALOG_BACKFILL in changes)) {
    return;
  }
  for (const tabId of resultCache.keys()) void setBadge(tabId, 0, BADGE_DETECTED);
  resultCache.clear();
});

// ── The Assistant window ─────────────────────────────────────────────────────
// A toolbar popup can't be sized past 800×600 and is always anchored to the icon, which is too
// cramped to compare a Colnect item against candidate stamps. Clicking the icon therefore opens the
// same UI as a proper window, centred on the current browser window. The source tab's id travels in
// the URL, because a separate window is its own "current window" — querying the active tab there
// would find the Assistant itself, not the Colnect page.

// Sized for comparing a stamp against its candidates: wide enough for the two columns to hold an
// image plus its details without crowding, tall enough to see several rows at once. `centredBounds`
// clamps to the parent window, so a smaller screen just gets as much as it has. The capture window
// (#355) is far smaller — it is one lot's five fields — and shares the window slot rather than the
// size: two Assistant windows over one browser window would compete for the collector's attention,
// and the page that is open is always about the page they were just looking at.
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 980;
const CAPTURE_WINDOW_WIDTH = 560;
const CAPTURE_WINDOW_HEIGHT = 760;

let assistantWindowId: number | null = null;

function centredBounds(
  parent: chrome.windows.Window,
  maxWidth: number,
  maxHeight: number
): { left: number; top: number; width: number; height: number } {
  const width = Math.min(maxWidth, parent.width ?? maxWidth);
  const height = Math.min(maxHeight, parent.height ?? maxHeight);
  return {
    width,
    height,
    left: Math.round((parent.left ?? 0) + ((parent.width ?? width) - width) / 2),
    top: Math.round((parent.top ?? 0) + ((parent.height ?? height) - height) / 2),
  };
}

/** The match window (#253) — the default meaning of the toolbar click. */
async function openAssistant(sourceTab: chrome.tabs.Tab): Promise<void> {
  await openAssistantWindow(sourceTab, "popup.html", WINDOW_WIDTH, WINDOW_HEIGHT);
}

/** The capture window (#355), for a page that holds one auction rather than a page of stamps. */
async function openCapture(sourceTab: chrome.tabs.Tab): Promise<void> {
  await openAssistantWindow(sourceTab, "capture.html", CAPTURE_WINDOW_WIDTH, CAPTURE_WINDOW_HEIGHT);
}

async function openAssistantWindow(
  sourceTab: chrome.tabs.Tab,
  page: string,
  maxWidth: number,
  maxHeight: number
): Promise<void> {
  const url = chrome.runtime.getURL(`${page}${sourceTab.id ? `?tabId=${sourceTab.id}` : ""}`);

  // Reuse an open Assistant window: point it at the new source tab and focus it, so clicking the
  // icon on another page refreshes rather than stacking windows. Clicking the icon is the *only*
  // refresh gesture in the UI, so it must always produce a fresh scan + match — navigating to an
  // identical URL is not guaranteed to reload, hence the explicit reload in that case.
  if (assistantWindowId !== null) {
    try {
      const win = await chrome.windows.get(assistantWindowId, { populate: true });
      const tab = win.tabs?.[0];
      if (tab?.id !== undefined) {
        if (tab.url === url) await chrome.tabs.reload(tab.id);
        else await chrome.tabs.update(tab.id, { url });
      }
      await chrome.windows.update(assistantWindowId, { focused: true });
      return;
    } catch {
      assistantWindowId = null; // it was closed behind our back
    }
  }

  // Centre on the window holding the page we were launched from, not merely the "current" one —
  // in a service worker that distinction is not always the same window.
  const parent = await chrome.windows.get(sourceTab.windowId);
  const created = await chrome.windows.create({
    url,
    type: "popup",
    ...centredBounds(parent, maxWidth, maxHeight),
  });
  assistantWindowId = created.id ?? null;
}

// ── Opening a match from an instance's own page ──────────────────────────────
//
// The gesture the toolbar click is, taken for a collector who is looking at an offer rather than at
// a marketplace: open the search the instance built (#423) and put the match window in front of it.
// Only the two steps the page cannot take — what happens in the window is unchanged, and the write
// it makes reaches every instance tab through `broadcastMatched` rather than back down this path.

/** How long to wait for the search page to load before matching it anyway. Matching an unloaded page
 *  finds nothing, and a marketplace that is slow, challenging us, or simply down must still end in a
 *  window the collector can see rather than in silence. */
const MATCH_TAB_LOAD_TIMEOUT_MS = 15_000;

/** Resolve when `tabId` finishes loading — or when the wait runs out, which is not an error. */
function tabLoaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, MATCH_TAB_LOAD_TIMEOUT_MS);
    // It may already be there: a tab created moments ago can complete before the listener is on.
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") finish();
      },
      () => finish()
    );
  });
}

async function openMatch(url: string, sourceTab: chrome.tabs.Tab | undefined): Promise<void> {
  // Beside the page that asked, in its own window — the collector is coming back to the offer, and a
  // search opened somewhere else is a search they have to go and find.
  const created = await chrome.tabs.create({
    url,
    active: true,
    ...(sourceTab?.windowId !== undefined ? { windowId: sourceTab.windowId } : {}),
    ...(sourceTab?.index !== undefined ? { index: sourceTab.index + 1 } : {}),
  });
  if (created.id === undefined) throw new Error("The search tab could not be opened.");
  await tabLoaded(created.id);
  // Re-read it: the tab now holds the loaded page, and `openAssistant` centres the window on the one
  // it is in. A tab closed while we waited is the collector changing their mind, not an error worth
  // reporting into their offer screen.
  const tab = await chrome.tabs.get(created.id).catch(() => null);
  if (tab) await openAssistant(tab);
}

/**
 * Tell every instance page that a match was written, so a screen showing item-IDs can re-read them
 * instead of waiting to be reloaded by hand. Sent for **every** confirmed match, including those the
 * collector started from the toolbar icon — those have no handoff to answer, and are exactly the
 * case a page-driven signal would miss.
 *
 * Best-effort by design: a tab with no content script (an instance page open since before the
 * profile was registered) simply does not answer, and nothing depends on it having.
 */
async function broadcastMatched(): Promise<void> {
  const { profiles } = await getProfileStore();
  const patterns = instancePatterns(profiles);
  if (patterns.length === 0) return;
  const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.tabs.sendMessage(tab.id, { type: "matched" } satisfies MatchedNotice).catch(() => {});
  }
}

// The icon click has two meanings, decided by what the page in front offers. On a Stamporama
// Settings page holding a registration payload (#252) it registers that instance + collection — the
// click is what grants `activeTab`, which is how we may read a page on an origin the extension does
// not otherwise script. Everywhere else it opens the Assistant, as before.
chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (tab.id !== undefined && (await handleRegistrationClick(tab.id))) return;
    // A page holding one auction opens the capture window instead (#355). Decided from the URL alone,
    // in the worker, because the click is what grants `activeTab` and the content script has not been
    // injected yet — and because a marketplace this collection only ever bids on holds no stamps to
    // match, so the match window would open on an empty scan.
    if (tab.url && findCaptureModuleForUrl(tab.url)) {
      await openCapture(tab);
      return;
    }
    await openAssistant(tab);
  })();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === assistantWindowId) assistantWindowId = null;
});

// Registered scripts persist across sessions, so these two are a reconcile and not a setup: they
// catch a store edited while the extension was disabled, and an update that changed what the script
// is called. Both are idempotent.
chrome.runtime.onInstalled.addListener(() => void syncInstanceContentScripts());
chrome.runtime.onStartup.addListener(() => void syncInstanceContentScripts());
