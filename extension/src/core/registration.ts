// One-click registration (#252): a Stamporama instance registers *itself* into the extension.
//
// Its Settings → Assistant page exposes a payload — the instance's own origin, the collection, and a
// short-lived single-use code — in a hidden element. Clicking the toolbar icon on that page grants
// `activeTab`, which is enough to read the payload out of an origin we do not otherwise script; the
// code is then exchanged (background fetch, CORS-exempt under host_permissions) for an Assistant
// token. The long-lived token therefore never appears in a URL, a fragment, or the page.
//
// Mirror of `src/app/c/[collectionSlug]/settings/assistant-panel.tsx` — kept in sync by hand, since
// the extension is a separate build with no import path into the app.

/** Element id the payload lives in, and the node whose attributes carry our verdict back. */
export const REGISTRATION_ELEMENT_ID = "stamporama-assistant-registration";

export interface RegistrationPayload {
  v: 1;
  /** Suggested profile name, e.g. "World (raspberrypi.local:3000)". */
  name: string;
  /** The instance's own origin — correct by construction, since the instance served it. */
  apiBaseUrl: string;
  collectionId: string;
  collectionName: string;
  /** One-time code, exchanged for a token. Valid for minutes. */
  regCode: string;
  expiresAt: string;
}

/** What `POST /api/assistant/register` answers with. */
export interface RegistrationResponse {
  token: string;
  collectionId: string;
  collectionName: string;
}

/**
 * Validate whatever was read off a page into a payload, or `null`. Any page may claim to hold one —
 * this is the boundary where an arbitrary origin's JSON becomes a typed value, so every field is
 * checked, and the version is pinned so an older extension declines a payload it cannot honour.
 */
export function parseRegistrationPayload(raw: string | null | undefined): RegistrationPayload | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const p = data as Record<string, unknown>;
  if (p.v !== 1) return null;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const apiBaseUrl = str(p.apiBaseUrl);
  const collectionId = str(p.collectionId);
  const regCode = str(p.regCode);
  if (!apiBaseUrl || !collectionId || !regCode) return null;
  // Only http(s): the payload decides where a token-bearing request will be sent.
  if (!/^https?:\/\//i.test(apiBaseUrl)) return null;

  const collectionName = str(p.collectionName) ?? collectionId;
  return {
    v: 1,
    name: str(p.name) ?? collectionName,
    apiBaseUrl,
    collectionId,
    collectionName,
    regCode,
    expiresAt: str(p.expiresAt) ?? "",
  };
}
