import { findModuleForUrl } from "../platform/registry";
import type { ExtractRequest, ExtractResponse } from "../core/messages";

// Content script, injected on demand into the active tab by the popup. It consults the module
// registry for one that handles the current page and runs its extraction. The shell registers no
// modules, so on any page it reports "no module" until #249 adds the Colnect parser.
//
// Injected via chrome.scripting, which re-runs this file on each request; guard so only one message
// listener is ever attached per page.

declare global {
  interface Window {
    __stamporamaAssistantLoaded?: boolean;
  }
}

if (!window.__stamporamaAssistantLoaded) {
  window.__stamporamaAssistantLoaded = true;

  chrome.runtime.onMessage.addListener(
    (msg: ExtractRequest, _sender, sendResponse: (r: ExtractResponse) => void) => {
      if (msg?.type !== "extract") return;
      try {
        const module = findModuleForUrl(location.href);
        if (!module) {
          sendResponse({ ok: false, error: "No Assistant module matches this page." });
          return;
        }
        sendResponse({ ok: true, items: module.extract(document) });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );
}
