import {
  getProfileStore,
  normalizeBaseUrl,
  profileTarget,
  saveProfile,
  setActiveProfileId,
  type Profile,
  type ProfileInput,
} from "../core/profile";
import {
  parseRegistrationPayload,
  REGISTRATION_ELEMENT_ID,
  type RegistrationPayload,
  type RegistrationResponse,
} from "../core/registration";

// The registration half of the toolbar-icon click (#252). Reading the page needs `activeTab`, which
// the click itself grants — that is the whole reason registration is icon-driven rather than
// something a content script could do: it works on *any* instance origin without the extension
// having to declare one up front.

/**
 * Read a registration payload out of a tab, or `null` when the page has none (the normal case — any
 * other page, including Colnect). Failures are swallowed: a tab we may not script (`chrome://`, the
 * web store) is not an error, it just isn't a registration.
 */
export async function readRegistrationPayload(
  tabId: number
): Promise<RegistrationPayload | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (elementId: string) => document.getElementById(elementId)?.textContent ?? null,
      args: [REGISTRATION_ELEMENT_ID],
    });
    return parseRegistrationPayload(result?.result as string | null | undefined);
  } catch {
    return null;
  }
}

/**
 * Tell the page how it went, by setting attributes on the payload element the page is watching.
 * Attributes rather than text or an event: the page owns that node (React re-renders it), and a
 * `CustomEvent` detail does not cross the isolated-world boundary intact.
 */
async function reportToPage(tabId: number, state: "ok" | "error", message: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (elementId: string, s: string, m: string) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.setAttribute("data-registration-state", s);
        el.setAttribute("data-registration-message", m);
      },
      args: [REGISTRATION_ELEMENT_ID, state, message],
    });
  } catch {
    // The tab navigated away mid-exchange; the profile is saved either way.
  }
}

/** Exchange the one-time code for a token. Throws with a message fit to show on the page. */
async function redeemCode(payload: RegistrationPayload): Promise<RegistrationResponse> {
  const url = `${normalizeBaseUrl(payload.apiBaseUrl)}/api/assistant/register`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: payload.regCode }),
    });
  } catch {
    throw new Error(`Could not reach ${payload.apiBaseUrl}.`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Registration failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as RegistrationResponse;
}

/**
 * Redeem a payload and store it as the active profile. A profile already pointing at this instance +
 * collection is **updated in place** — same id, fresh token — rather than added alongside: two
 * profiles with one target are rejected by #251's guard anyway, and re-registering is exactly how a
 * revoked or lost token is meant to be replaced. The result is always made active, since registering
 * is an explicit "talk to this one".
 */
async function saveRegisteredProfile(
  payload: RegistrationPayload,
  redeemed: RegistrationResponse
): Promise<{ profile: Profile; replaced: boolean }> {
  // Trust the server for the collection identity: the code decides which collection is registered.
  const target = {
    apiBaseUrl: normalizeBaseUrl(payload.apiBaseUrl),
    collectionId: redeemed.collectionId,
  };
  const { profiles } = await getProfileStore();
  const existing = profiles.find((p) => profileTarget(p) === profileTarget(target));

  const input: ProfileInput = {
    // A profile the user renamed keeps its name; only the credentials are refreshed.
    name: existing?.name || payload.name,
    apiBaseUrl: target.apiBaseUrl,
    collectionId: target.collectionId,
    collectionName: redeemed.collectionName || payload.collectionName,
    token: redeemed.token,
  };
  const profile = await saveProfile(existing ? { ...input, id: existing.id } : input);
  await setActiveProfileId(profile.id);
  return { profile, replaced: Boolean(existing) };
}

/**
 * Handle an icon click as a registration when the page offers one. Returns `false` when it doesn't,
 * so the caller falls through to opening the Assistant window — the click keeps its usual meaning
 * everywhere else.
 */
export async function handleRegistrationClick(tabId: number): Promise<boolean> {
  const payload = await readRegistrationPayload(tabId);
  if (!payload) return false;

  try {
    const redeemed = await redeemCode(payload);
    const { profile, replaced } = await saveRegisteredProfile(payload, redeemed);
    await reportToPage(
      tabId,
      "ok",
      replaced
        ? `Reconnected “${profile.name}” with a fresh token. It is now the active profile.`
        : `Connected as “${profile.name}”. It is now the active profile.`
    );
  } catch (e) {
    await reportToPage(tabId, "error", e instanceof Error ? e.message : String(e));
  }
  return true;
}
