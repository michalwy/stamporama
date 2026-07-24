// Connection profile: which Stamporama instance + collection the extension talks to, and the token
// it authenticates with. This shell stores a SINGLE active profile in chrome.storage.local — a
// deliberate stub. #251 replaces it with multiple named profiles, an active-profile selector, and
// registration (#252); the shape here is forward-compatible with that work.

export interface Profile {
  /** Human label, e.g. "Dev" or "Raspberry Pi (PROD)". */
  name: string;
  /** Origin of the instance, e.g. "http://raspberrypi.local:3000". No trailing path. */
  apiBaseUrl: string;
  /** Internal collection id the matcher is scoped to. */
  collectionId: string;
  /** Optional display name for the collection. */
  collectionName?: string;
  /** Assistant bearer token issued from Settings → Colnect. */
  token: string;
}

const ACTIVE_KEY = "activeProfile";

export async function getActiveProfile(): Promise<Profile | null> {
  const data = await chrome.storage.local.get(ACTIVE_KEY);
  return (data[ACTIVE_KEY] as Profile | undefined) ?? null;
}

export async function setActiveProfile(profile: Profile | null): Promise<void> {
  if (profile) await chrome.storage.local.set({ [ACTIVE_KEY]: profile });
  else await chrome.storage.local.remove(ACTIVE_KEY);
}

/** Origin without a trailing slash, so path joining is predictable. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}
