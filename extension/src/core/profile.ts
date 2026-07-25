// Connection profiles (#251): the named Stamporama instances + collections this extension can talk
// to, which one is active, and the token each authenticates with. The target is never inferred — a
// dev server and the Raspberry Pi are driven from the same browser on the same colnect.com origin, so
// it has to be an explicit, visible choice.
//
// Stored in chrome.storage.local as two keys: the list and the active id. The id exists so renaming a
// profile or fixing its URL doesn't lose the active selection.

export interface Profile {
  /** Stable internal id; never shown. */
  id: string;
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

/** A profile as the forms hand it over: everything but the id, which the store owns. */
export type ProfileInput = Omit<Profile, "id">;

const PROFILES_KEY = "profiles";
const ACTIVE_ID_KEY = "activeProfileId";
/** #253's single-profile stub. Read once, then folded into the list and removed. */
const LEGACY_KEY = "activeProfile";

export interface ProfileStore {
  profiles: Profile[];
  activeProfileId: string | null;
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Read the store, upgrading the #253 single-profile key on first sight. Migration lives here rather
 * than in an install hook because a service worker starts and dies constantly — whoever reads first
 * performs it, and it is idempotent.
 */
export async function getProfileStore(): Promise<ProfileStore> {
  const data = await chrome.storage.local.get([PROFILES_KEY, ACTIVE_ID_KEY, LEGACY_KEY]);
  const stored = data[PROFILES_KEY] as Profile[] | undefined;
  const legacy = data[LEGACY_KEY] as ProfileInput | undefined;

  if (!stored && legacy) {
    const migrated: Profile = { id: newId(), ...legacy };
    await chrome.storage.local.set({ [PROFILES_KEY]: [migrated], [ACTIVE_ID_KEY]: migrated.id });
    await chrome.storage.local.remove(LEGACY_KEY);
    return { profiles: [migrated], activeProfileId: migrated.id };
  }

  const profiles = stored ?? [];
  const activeId = data[ACTIVE_ID_KEY] as string | undefined;
  // A dangling active id (the profile was deleted on another surface) falls back to the first
  // profile, so the UI is never in a "nothing selected, yet profiles exist" state.
  const activeProfileId = profiles.some((p) => p.id === activeId)
    ? (activeId as string)
    : (profiles[0]?.id ?? null);
  return { profiles, activeProfileId };
}

export async function getActiveProfile(): Promise<Profile | null> {
  const { profiles, activeProfileId } = await getProfileStore();
  return profiles.find((p) => p.id === activeProfileId) ?? null;
}

export async function setActiveProfileId(id: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_ID_KEY]: id });
}

/**
 * Create (no id) or update (existing id) a profile. A new profile becomes active only when it is the
 * first one — otherwise adding a profile would silently re-point the extension.
 */
export async function saveProfile(input: ProfileInput | Profile): Promise<Profile> {
  const { profiles, activeProfileId } = await getProfileStore();
  const id = "id" in input && input.id ? input.id : newId();
  const profile: Profile = { ...input, id };

  const at = profiles.findIndex((p) => p.id === id);
  const next = [...profiles];
  if (at === -1) next.push(profile);
  else next[at] = profile;

  await chrome.storage.local.set({
    [PROFILES_KEY]: next,
    [ACTIVE_ID_KEY]: activeProfileId ?? profile.id,
  });
  return profile;
}

/** Remove a profile; if it was active, hand the selection to whatever is left. */
export async function deleteProfile(id: string): Promise<void> {
  const { profiles, activeProfileId } = await getProfileStore();
  const next = profiles.filter((p) => p.id !== id);
  await chrome.storage.local.set({
    [PROFILES_KEY]: next,
    [ACTIVE_ID_KEY]: activeProfileId === id ? (next[0]?.id ?? null) : activeProfileId,
  });
}

/** Origin without a trailing slash, so path joining is predictable. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** What a profile points at. Two profiles with the same target are the same target, whatever they are named. */
export function profileTarget(p: Pick<Profile, "apiBaseUrl" | "collectionId">): string {
  return `${normalizeBaseUrl(p.apiBaseUrl)}|${p.collectionId.trim()}`;
}

/** One-line description of the target, for badges and write confirms. */
export function profileSubtitle(p: Profile): string {
  return `${p.apiBaseUrl} · ${p.collectionName || p.collectionId}`;
}

// ── Colours ──────────────────────────────────────────────────────────────────
// Every profile carries a colour so the active target is recognisable at a glance — the point of the
// always-visible badge is that PROD is unmistakable. The colour is *derived*, not configured: hashed
// from the target (instance + collection), so the same Raspberry Pi always looks the same, and
// de-collided across the stored set so no two profiles share a colour.

/** Hues far enough apart to tell apart at dot size. Red is left out: it would read as a warning. */
const PROFILE_HUES = [210, 145, 30, 275, 185, 320, 95, 250];

function hash(s: string): number {
  // FNV-1a — tiny, and stable across sessions (unlike anything seeded per run).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** CSS colour for a hue, mid-lightness so it holds up against both light and dark UI. */
export function hueColor(hue: number): string {
  return `hsl(${hue} 62% 45%)`;
}

/**
 * Colour per profile id: the preferred hue comes from the target hash, then the next free hue when two
 * profiles would collide. Deterministic for a given list, so colours don't shuffle between openings.
 */
export function assignProfileColors(profiles: Profile[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const p of profiles) {
    const preferred = hash(profileTarget(p)) % PROFILE_HUES.length;
    let slot = preferred;
    for (let step = 0; step < PROFILE_HUES.length && taken.has(slot); step++) {
      slot = (preferred + step + 1) % PROFILE_HUES.length;
    }
    taken.add(slot);
    out.set(p.id, hueColor(PROFILE_HUES[slot]));
  }
  return out;
}
