import { getActiveProfile } from "../core/profile";
import type {
  BackgroundMessage,
  BackgroundRequest,
  ConfirmResponse,
  MatchResponse,
} from "../core/messages";
import { callConfirm, callMatch } from "./matching-client";

// Background service worker: routes match/confirm requests from the popup to the active profile's
// instance, and maintains the per-tab toolbar badge showing how many items the page holds.
// Extraction itself happens in the content script; the SW owns instance I/O and the badge.

const BADGE_COLOR = "#2563eb";

/** Show the detected count on the toolbar icon for one tab (empty clears it). */
async function setBadge(tabId: number | undefined, count: number): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  } catch {
    // The tab may be gone by now — a stale badge update is never worth surfacing.
  }
}

async function handle(msg: BackgroundRequest): Promise<MatchResponse | ConfirmResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "No active profile. Set one in the extension options." };
  }

  if (msg.type === "match") {
    const results = await callMatch(profile, msg.items, msg.dryRun);
    return { ok: true, results };
  }

  const outcome = await callConfirm(profile, msg.colnectId, msg.stampId, msg.allowOverwrite);
  if (outcome.ok) return { ok: true };
  if (outcome.conflict) {
    return { ok: false, error: "conflict", conflict: true, existingColnectId: outcome.existingColnectId };
  }
  return { ok: false, error: outcome.error };
}

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  // Fire-and-forget badge update from a content script; no response expected.
  if (msg?.type === "detected") {
    void setBadge(sender.tab?.id, msg.count);
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
  if (changeInfo.status === "loading") void setBadge(tabId, 0);
});

// ── The Assistant window ─────────────────────────────────────────────────────
// A toolbar popup can't be sized past 800×600 and is always anchored to the icon, which is too
// cramped to compare a Colnect item against candidate stamps. Clicking the icon therefore opens the
// same UI as a proper window, centred on the current browser window. The source tab's id travels in
// the URL, because a separate window is its own "current window" — querying the active tab there
// would find the Assistant itself, not the Colnect page.

const WINDOW_WIDTH = 920;
const WINDOW_HEIGHT = 760;

let assistantWindowId: number | null = null;

function centredBounds(parent: chrome.windows.Window): { left: number; top: number; width: number; height: number } {
  const width = Math.min(WINDOW_WIDTH, parent.width ?? WINDOW_WIDTH);
  const height = Math.min(WINDOW_HEIGHT, parent.height ?? WINDOW_HEIGHT);
  return {
    width,
    height,
    left: Math.round((parent.left ?? 0) + ((parent.width ?? width) - width) / 2),
    top: Math.round((parent.top ?? 0) + ((parent.height ?? height) - height) / 2),
  };
}

async function openAssistant(sourceTab: chrome.tabs.Tab): Promise<void> {
  const url = chrome.runtime.getURL(`popup.html${sourceTab.id ? `?tabId=${sourceTab.id}` : ""}`);

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
  const created = await chrome.windows.create({ url, type: "popup", ...centredBounds(parent) });
  assistantWindowId = created.id ?? null;
}

chrome.action.onClicked.addListener((tab) => {
  void openAssistant(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === assistantWindowId) assistantWindowId = null;
});
