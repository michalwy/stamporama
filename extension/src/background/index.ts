import { getActiveProfile } from "../core/profile";
import type {
  BackgroundRequest,
  ConfirmResponse,
  MatchResponse,
} from "../core/messages";
import { callConfirm, callMatch } from "./matching-client";

// Background service worker: routes match/confirm requests from the popup to the active profile's
// instance. Extraction is handled directly by the content script; the SW owns only instance I/O.

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

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // keep the message channel open for the async response
});
