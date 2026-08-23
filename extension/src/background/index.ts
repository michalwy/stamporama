import { getActiveProfile, getProfileStore } from "../core/profile";
import {
  CATALOG_BACKFILL,
  ISSUE_DATE_SYNC,
  getCatalogBackfill,
  getIssueDateSync,
  getMatchOnLoad,
} from "../core/settings";
import type {
  BackgroundMessage,
  BackgroundRequest,
  CaptureSaveResponse,
  CachedResultsResponse,
  ConfirmResponse,
  DetectedNotice,
  MatchedNotice,
  MatchResponse,
  LotLookupResponse,
  OfferLookupResponse,
  OrderImportResponse,
  OrderLookupResponse,
  ReportedOrder,
  OpenMatchResponse,
  OverwriteDateResponse,
  OverwriteNumberResponse,
  ResultsUpdatedNotice,
  SearchResponse,
} from "../core/messages";
import type { MatchResult } from "../core/decisions";
import { badgeTodo } from "../core/decisions";
import { callConfirm, callMatch, callOverwriteDate, callOverwriteNumber } from "./matching-client";
import { callCapture } from "./capture-client";
import { callSearch } from "./search-client";
import { callOfferLookup } from "./offer-lookup-client";
import { callLotLookup } from "./lot-lookup-client";
import { callOrderImport, callOrderLookup } from "./order-client";
import { findCaptureModuleForUrl } from "../platform/modules";
import { instancePatterns, syncInstanceContentScripts } from "./instance-scripts";
import {
  captureListedUrl,
  listedUrlReported,
  listingSubmitted,
  listingTabClosed,
  runListingTask,
} from "./listing";
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
      ...(r.issuedOn ? { issuedOn: r.issuedOn } : {}),
    }));
    const results = await callMatch(
      profile,
      items,
      true,
      await getCatalogBackfill(),
      await getIssueDateSync()
    );
    resultCache.set(tabId, results);
    await showTodoBadge(tabId, results);
  } catch {
    // Leave the detected-count badge in place; browsing offline must stay quiet.
  }
}

/**
 * Whether two addresses name the same document, the fragment aside. A fragment moves the collector
 * about *within* the page the results describe and does not reload it, so a strict comparison would
 * throw away a perfectly good update for a click on an anchor.
 */
function sameDocument(a: string, b: string): boolean {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    x.hash = "";
    y.hash = "";
    return x.href === y.href;
  } catch {
    return a === b;
  }
}

/** Draw a set of results as the badge: how much is left, amber when any of it is a decision. */
async function showTodoBadge(tabId: number, results: MatchResult[]): Promise<void> {
  const { todo, needsConfirm } = badgeTodo(results);
  await setBadge(tabId, todo, needsConfirm > 0 ? BADGE_NEEDS_DECISION : BADGE_AUTO);
}

/**
 * Take the window's word for what a page now holds (#283) — cache and badge together, since they
 * are one answer told twice and the write that outdated one outdated the other.
 *
 * The tab is re-read rather than trusted: this arrives after a round trip to the instance, and a
 * collector who navigated in the meantime has already had the badge cleared for that navigation.
 * A tab that is gone, or has moved on, is simply left alone.
 */
async function applyResultsUpdate(msg: ResultsUpdatedNotice): Promise<void> {
  try {
    const tab = await chrome.tabs.get(msg.tabId);
    if (!tab.url || !sameDocument(tab.url, msg.url)) return;
  } catch {
    return;
  }
  resultCache.set(msg.tabId, msg.results);
  await showTodoBadge(msg.tabId, msg.results);
}

async function handle(
  msg: BackgroundRequest
): Promise<MatchResponse | ConfirmResponse | OverwriteNumberResponse | OverwriteDateResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }

  // Both flags are read here rather than taken from the caller, so the load-time match, the
  // window's preview and every write all describe the same settings (#280, #655).
  const backfill = await getCatalogBackfill();
  const issueDate = await getIssueDateSync();

  if (msg.type === "match") {
    const results = await callMatch(profile, msg.items, msg.dryRun, backfill, issueDate);
    return { ok: true, results };
  }

  // Correcting a catalog number (#433) writes no Colnect ID, so no doorbell: the screens listening
  // for one are waiting on a *match*, and re-reading them over a number they never showed would be
  // noise. The window renders the new value from this answer.
  if (msg.type === "overwrite-number") {
    return callOverwriteNumber(profile, msg.stampId, msg.catalogVendorId, msg.number);
  }

  // Correcting a date (#655) is the same kind of act, and stays silent for the same reason.
  if (msg.type === "overwrite-date") {
    return callOverwriteDate(profile, msg.stampId, msg.issuedOn);
  }

  const outcome = await callConfirm(profile, msg.colnectId, msg.stampId, {
    allowOverwrite: msg.allowOverwrite,
    backfill,
    catalogRefs: msg.catalogRefs,
    issueDate,
    issuedOn: msg.issuedOn,
  });
  if (outcome.ok) {
    // The instance now knows something a screen of it may be showing. Ring the doorbell — not
    // awaited, since the popup's answer must not wait on other tabs.
    void broadcastMatched();
    return { ok: true, backfill: outcome.backfill, date: outcome.date };
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

/**
 * Answer the search window's "what does the collection hold matching this?" (#529).
 *
 * The active profile decides which collection is asked, as the capture does and for the same reason:
 * the text came off a page that says nothing about where it should be looked for. No profile is a
 * refusal naming the fix, not an empty result — an empty answer here would read as *"you don't have
 * this"*, which is the one wrong thing this window could say.
 */
async function runSearch(query: string): Promise<SearchResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }
  return callSearch(profile, query);
}

/**
 * Answer a marketplace page's "which of these listings are mine?" (#466).
 *
 * No active profile is an **empty answer** rather than an error: an extension installed but not yet
 * connected must leave every page it runs on exactly as it found it, and the page has nothing to do
 * with an error either way.
 */
async function lookupOffers(platformOfferIds: string[]): Promise<OfferLookupResponse> {
  const profile = await getActiveProfile();
  if (!profile) return { ok: true, matches: {} };
  return callOfferLookup(profile, platformOfferIds);
}

/**
 * Answer a marketplace page's "am I already tracking this listing as a lot?" (#575).
 *
 * No active profile is an **empty answer** rather than an error, exactly as the offer lookup's is:
 * an extension installed but not yet connected must leave every page it runs on as it found it.
 */
async function lookupLots(platformOfferIds: string[]): Promise<LotLookupResponse> {
  const profile = await getActiveProfile();
  if (!profile) return { ok: true, matches: {} };
  return callLotLookup(profile, platformOfferIds);
}

/**
 * Answer a seller screen's "which of these orders are recorded here?" (#612).
 *
 * No active profile is an **empty answer** rather than an error, as both lookups above are: a page
 * that cannot be asked must be left exactly as it was found, and marking a row *Import* when there is
 * no instance to import into would be worse than not marking it at all.
 */
async function lookupOrders(module: string, orderIds: string[]): Promise<OrderLookupResponse> {
  const profile = await getActiveProfile();
  if (!profile) return { ok: true, matches: {} };
  return callOrderLookup(profile, module, orderIds);
}

/**
 * Record one order as a sale (#612).
 *
 * No active profile is an **error** here and not an empty answer, which is the opposite of the
 * lookups: this one happens because the collector pressed a button, and a click that quietly did
 * nothing is the one outcome they cannot act on.
 */
async function importOrder(module: string, order: ReportedOrder): Promise<OrderImportResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }
  return callOrderImport(profile, module, order);
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

  // The page the form was filled into says the listing exists and names it (#493). The other half of
  // the write-back above: a marketplace that confirms **in place** never navigates, so the address
  // bar this worker watches never changes and the page is the only thing that can say what was
  // posted. The URL arrives already narrowed by the module, and is delivered exactly as one read off
  // a navigation is.
  if (msg?.type === "listed-here") {
    void listedUrlReported(sender.tab?.id, msg.url);
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

  // "Which of these listings are offers of mine?" (#466), asked by a marketplace page as it loads.
  // Answered here for the same reason the capture is: it needs the active profile, and the token
  // that goes with it must never reach a script running inside somebody else's page.
  if (msg?.type === "offer-lookup") {
    lookupOffers(msg.platformOfferIds)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies OfferLookupResponse)
      );
    return true;
  }

  // "Am I already bidding on this?" (#575), asked by an auction page as it loads — the buying-side
  // twin of the lookup above, answered here for the same reason.
  if (msg?.type === "lot-lookup") {
    lookupLots(msg.platformOfferIds)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies LotLookupResponse)
      );
    return true;
  }

  // "Which of these orders have I already written down?" (#612), asked by a marketplace's own sold
  // items screen as it loads — the selling-side sibling of the two lookups above.
  if (msg?.type === "order-lookup") {
    lookupOrders(msg.module, msg.orderIds)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies OrderLookupResponse)
      );
    return true;
  }

  // "Record this one" (#612) — the same page, one row, and the collector's own click.
  if (msg?.type === "order-import") {
    importOrder(msg.module, msg.order)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies OrderImportResponse)
      );
    return true;
  }

  // The search window asking what the collection holds (#529). Answered here for the capture's
  // reason: it needs the active profile, and the token that goes with it lives only in the worker.
  if (msg?.type === "search") {
    runSearch(msg.query)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies SearchResponse)
      );
    return true;
  }

  if (msg?.type === "list") {
    runListingTask(msg.task, msg.requestId, sender.tab)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  // The window saying what that match now says, a write later (#283). The counterpart of the
  // question below: one hands the window the worker's answer, the other hands the worker the
  // window's. No response — the badge must never be something a write waits on.
  if (msg?.type === "results-updated") {
    void applyResultsUpdate(msg);
    return false;
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
// Switching the backfill (#280) or date-sync (#655) setting invalidates the cache for the same
// reason: the cached results were computed with the other setting and would show the wrong
// proposals.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // Which origins the Assistant scripts follows the profile list and nothing else (#409): a profile
  // added by registration, one whose URL was corrected, one deleted after its token was revoked.
  // Hanging it off the store rather than off each call site is what keeps the two from drifting.
  if ("profiles" in changes) void syncInstanceContentScripts();
  if (
    !("activeProfileId" in changes) &&
    !("profiles" in changes) &&
    !(CATALOG_BACKFILL in changes) &&
    !(ISSUE_DATE_SYNC in changes)
  ) {
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
// The search window (#529) sits between them: a list of rows, no side-by-side comparison to make
// room for — but a row is a Stamporama list row rather than a line of text, carrying a thumbnail, a
// wrapping row of catalog chips and a second one of condition chips. At the 720px it opened at
// those wrapped onto three lines each and a copy row stood taller than its own picture, so it is
// nearer the match window's width than the capture window's. `centredBounds` clamps to the parent
// window, so a smaller screen still gets only as much as it has.
const SEARCH_WINDOW_WIDTH = 1040;
const SEARCH_WINDOW_HEIGHT = 940;

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
  await openAssistantWindow(sourceTab, "popup.html", WINDOW_WIDTH, WINDOW_HEIGHT, sourceTabParam(sourceTab));
}

/** The capture window (#355), for a page that holds one auction rather than a page of stamps. */
async function openCapture(sourceTab: chrome.tabs.Tab): Promise<void> {
  await openAssistantWindow(
    sourceTab,
    "capture.html",
    CAPTURE_WINDOW_WIDTH,
    CAPTURE_WINDOW_HEIGHT,
    sourceTabParam(sourceTab)
  );
}

/**
 * The search window (#529), for text selected on a page nothing here has a module for.
 *
 * It carries the **selection**, not the tab: nothing is read back off the page, which is exactly why
 * this works on any site. The window shares the Assistant window slot with the other two — it is
 * opened about the page in front of the collector, and two Assistant windows over one browser window
 * would compete for their attention.
 */
async function openSearch(sourceTab: chrome.tabs.Tab, query: string): Promise<void> {
  await openAssistantWindow(sourceTab, "search.html", SEARCH_WINDOW_WIDTH, SEARCH_WINDOW_HEIGHT, {
    q: query,
  });
}

/** Which tab a window was opened from — a separate window is its own "current window", so the two
 *  windows that read a page are told which one rather than querying for it. */
function sourceTabParam(sourceTab: chrome.tabs.Tab): Record<string, string> {
  return sourceTab.id ? { tabId: String(sourceTab.id) } : {};
}

async function openAssistantWindow(
  sourceTab: chrome.tabs.Tab,
  page: string,
  maxWidth: number,
  maxHeight: number,
  params: Record<string, string>
): Promise<void> {
  const query = new URLSearchParams(params).toString();
  const url = chrome.runtime.getURL(`${page}${query ? `?${query}` : ""}`);

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
  assistantWindowId = created?.id ?? null;
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
    const listener = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
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

// ── Find in Stamporama (#529) ────────────────────────────────────────────────
//
// The fourth gesture, and the only one that is not a toolbar click: a **selection** on any page at
// all, right-clicked. A collector reading an auction on a marketplace we have no module for — or a
// dealer's list, or an email — selects the catalog number in the title and asks whether they already
// have it.
//
// A context menu rather than a toolbar meaning, because the icon already means three things decided
// by what the page in front *is*, and this is decided by what the collector **pointed at**. It also
// needs no `activeTab` and no injected script: the selected text travels in the click itself, which
// is what lets this work on a site the extension otherwise never touches.

const SEARCH_MENU_ID = "find-in-stamporama";

/** (Re)create the menu entry. `removeAll` first, so this is idempotent — Chrome persists context
 *  menus across sessions and refuses a duplicate id, which would otherwise make an update the one
 *  event that breaks the entry. */
async function installContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: SEARCH_MENU_ID,
    // `%s` is Chrome's own placeholder for the selection, so the entry names what it will look for.
    title: 'Find "%s" in Stamporama',
    contexts: ["selection"],
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SEARCH_MENU_ID) return;
  const query = (info.selectionText ?? "").trim();
  // A selection of pure whitespace is a slipped drag, not a question.
  if (!query) return;
  void (async () => {
    // The window is centred on the one holding the page it was asked from. Where the click carries
    // no tab, the focused window's active tab stands in; with neither there is nothing to centre on
    // and nothing to go back to, so the click is simply dropped.
    const source = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!source) return;
    await openSearch(source, query);
  })();
});

// Registered scripts and context menus both persist across sessions, so these two are a reconcile
// and not a setup: they catch a store edited while the extension was disabled, and an update that
// changed what the script is called. Both are idempotent.
chrome.runtime.onInstalled.addListener(() => {
  void syncInstanceContentScripts();
  void installContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  void syncInstanceContentScripts();
  void installContextMenus();
});
