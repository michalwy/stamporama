import { findModuleForUrl } from "../platform/modules";
import type { DetectedNotice, ExtractRequest, ExtractResponse } from "../core/messages";

// Content script. It runs two ways, both guarded so only one instance is ever live per page:
//   • declaratively on Colnect pages (manifest `content_scripts`) — so the toolbar badge can show
//     how many items the page holds before the popup is ever opened;
//   • injected on demand by the popup (chrome.scripting) — which also covers tabs that were already
//     open when the extension was installed or reloaded, where the declarative script never ran.
//
// The manifest's match pattern is a coarse net (all of colnect.com); `findModuleForUrl` does the
// precise check, so a non-catalog Colnect page simply reports zero. Detection is entirely local —
// no instance call is made to produce the badge count.

declare global {
  interface Window {
    __stamporamaAssistantLoaded?: boolean;
  }
}

/** Extract the current page with whichever module handles it, or null when none does. */
function extractHere() {
  const module = findModuleForUrl(location.href);
  if (!module) return null;
  return module.extract(document);
}

if (!window.__stamporamaAssistantLoaded) {
  window.__stamporamaAssistantLoaded = true;

  chrome.runtime.onMessage.addListener(
    (msg: ExtractRequest, _sender, sendResponse: (r: ExtractResponse) => void) => {
      if (msg?.type !== "extract") return;
      try {
        const items = extractHere();
        if (!items) {
          sendResponse({ ok: false, error: "No Assistant module matches this page." });
          return;
        }
        sendResponse({ ok: true, items });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // Report the count for the toolbar badge. Best-effort: a page we can't parse just reports 0, and
  // the message is fire-and-forget (the service worker may be asleep on a page we don't handle).
  try {
    const count = extractHere()?.length ?? 0;
    const notice: DetectedNotice = { type: "detected", count };
    void chrome.runtime.sendMessage(notice).catch(() => {});
  } catch {
    /* detection must never break the page */
  }
}
