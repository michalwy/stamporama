import { getProfileStore, normalizeBaseUrl, type Profile } from "../core/profile";

// The content script the extension runs on **its own instances** (#409).
//
// The declared script in `manifest.json` covers colnect.com and nothing else, because a self-hosted
// instance has no origin to declare: it is whatever the collector runs. Registration (#252) reads
// its page under `activeTab`, granted by the toolbar click that performs it — but a listing starts
// from a click on an offer card, and there is no toolbar click in that gesture to grant anything.
//
// So the origins are registered **as profiles are**, through `chrome.scripting.registerContentScripts`.
// `host_permissions` is already `http://*/*` + `https://*/*`, so this costs no new permission prompt
// and asks the collector nothing: connecting an instance is what says "script this origin", and
// disconnecting it is what takes it back.

/** Script ids are derived from the origin, so the registered set can be reconciled against the
 *  profiles without storing a mapping of its own. */
const ID_PREFIX = "stamporama-instance:";

function scriptId(origin: string): string {
  return `${ID_PREFIX}${origin}`;
}

/**
 * The match pattern for an instance origin — scheme, host **and port**, so a dev server on
 * `localhost:3002` is not the same target as one on `localhost:3000`. Chrome's match patterns take a
 * port; returns null for anything that is not an http(s) origin we can express.
 */
export function instanceMatchPattern(apiBaseUrl: string): string | null {
  try {
    const url = new URL(normalizeBaseUrl(apiBaseUrl));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

/** Every origin the stored profiles point at, deduplicated — two collections on one instance are two
 *  profiles and one origin. */
export function instancePatterns(profiles: readonly Profile[]): string[] {
  const patterns = new Set<string>();
  for (const p of profiles) {
    const pattern = instanceMatchPattern(p.apiBaseUrl);
    if (pattern) patterns.add(pattern);
  }
  return [...patterns];
}

/**
 * Reconcile the registered scripts with the stored profiles: register what is missing, unregister
 * what no longer has a profile. Idempotent, and the single answer to every event that can change the
 * set — a registration, an edited URL, a deleted profile, a revoked token the collector then removed.
 *
 * Registration failures are per-origin and swallowed with a warning: one unusable URL in the store
 * must not cost the other instances their script.
 */
export async function syncInstanceContentScripts(): Promise<void> {
  const { profiles } = await getProfileStore();
  const wanted = instancePatterns(profiles);

  let registered: chrome.scripting.RegisteredContentScript[] = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts();
  } catch {
    return; // nothing to reconcile against; the next event tries again
  }
  const ours = registered.filter((s) => s.id.startsWith(ID_PREFIX));

  const stale = ours.filter((s) => !wanted.includes(s.id.slice(ID_PREFIX.length)));
  if (stale.length > 0) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: stale.map((s) => s.id) });
    } catch (e) {
      console.warn("[assistant] could not unregister instance scripts", e);
    }
  }

  const existing = new Set(ours.map((s) => s.id));
  for (const pattern of wanted) {
    if (existing.has(scriptId(pattern))) continue;
    try {
      await chrome.scripting.registerContentScripts([
        {
          id: scriptId(pattern),
          matches: [pattern],
          js: ["instance.js"],
          runAt: "document_idle",
          // Survives a browser restart, so the collector connects an instance once and not once per
          // session. The reconcile above is what keeps that from outliving the profile.
          persistAcrossSessions: true,
        },
      ]);
      await injectIntoOpenTabs(pattern);
    } catch (e) {
      console.warn(`[assistant] could not register a content script for ${pattern}`, e);
    }
  }
}

/**
 * Run the script in the instance's tabs that are **already open**, since a freshly registered script
 * only reaches documents loaded after it. The tab registration happened in is one of them, and being
 * told to reload the page you just connected from is exactly the sort of step nobody remembers.
 * Best-effort: a tab that cannot be scripted simply picks it up on its next load.
 */
async function injectIntoOpenTabs(pattern: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: pattern });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["instance.js"] });
    } catch {
      // A tab mid-navigation, or one showing an error page — the declarative registration covers it
      // from its next load onwards.
    }
  }
}
