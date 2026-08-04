// Allegro's OAuth endpoints and the three exchanges this app performs (#476; ADR-0023).
//
// Everything Allegro-URL-shaped lives here and in `allegro-api.ts`, for the same reason a platform
// module owns a marketplace's own shape: when Allegro changes, there is one file to change.
//
// The **device code flow** is the default. It needs no redirect URI and no publicly reachable
// address, so it behaves identically on `localhost`, on a home server behind NAT and on a VPS —
// which for a self-hosted app is the only flow that can be the default. The **authorization code
// flow** is offered beside it, never instead of it, for an instance that does have a stable public
// address.
//
// No Prisma and no `server-only` import: the endpoint builders and the response readers are pure
// and unit-tested, and the token store above this is what holds the secrets.

// Scopes are deliberately **never requested** — by either flow. They come from the application's own
// registration at `apps.developer.allegro.pl`, which is the only place they can be granted anyway,
// and asking for one the application does not hold fails the whole authorization. Worse, it fails
// it as *"OAuth 2.0 Parameter: client_id"*, which sends whoever is debugging it after the client id
// for an hour. Both flows now take whatever the registered application carries, and the user guide
// says which access to grant.

interface AllegroHosts {
  /** Where the OAuth endpoints live. */
  auth: string;
  /** Where the REST API lives. */
  api: string;
}

const PRODUCTION: AllegroHosts = {
  auth: "https://allegro.pl",
  api: "https://api.allegro.pl",
};

const SANDBOX: AllegroHosts = {
  auth: "https://allegro.pl.allegrosandbox.pl",
  api: "https://api.allegro.pl.allegrosandbox.pl",
};

/** The pair of hosts one connection talks to. Sandbox is a property of the *connection*, not of the
 *  deployment: an application registered in the sandbox has different credentials from one
 *  registered in production. */
export function allegroHosts(sandbox: boolean): AllegroHosts {
  return sandbox ? SANDBOX : PRODUCTION;
}

/** The API base URL for a connection — the one fact `allegro-api.ts` needs from here. */
export function allegroApiBase(sandbox: boolean): string {
  return allegroHosts(sandbox).api;
}

/** Where an order is read on Allegro itself — what a sale created from one records as its
 *  transaction link (#292/#463). The seller's own order view, not the buyer's: the collector is the
 *  one who will follow it. */
export function allegroOrderPageUrl(sandbox: boolean, orderId: string): string {
  return `${allegroHosts(sandbox).auth}/moje-allegro/sprzedaz/zamowienia/${encodeURIComponent(orderId)}`;
}

/** The redirect URI a code-flow connection uses, derived from the instance's own configured base
 *  URL rather than being a second setting that could disagree with it. The collector registers this
 *  exact string with their Allegro application, which is why it is shown to them verbatim. */
export function allegroRedirectUri(appBase: string): string {
  return `${appBase.replace(/\/+$/, "")}/api/allegro/callback`;
}

/** Where the `User-Agent` below points. One URL for every install, because what it documents is the
 *  software rather than one collector's instance — and an instance's own address is usually private
 *  anyway, which is the whole reason the device flow exists. */
const USER_AGENT_URL = "https://github.com/michalwy/stamporama";

/** The fallback application name: what an instance identifies as before the collector has said what
 *  they called their own registered application. */
const DEFAULT_APPLICATION_NAME = "Stamporama";

/** A header value is ASCII and has no spaces in the product token, so the collector's own name is
 *  narrowed to what can appear there: spaces become `-`, everything outside a conservative set is
 *  dropped, and a name that survives as nothing falls back. A rejected header would fail every call
 *  with an error about nothing the collector could see. */
function sanitizeProductToken(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned.length > 0 ? cleaned : DEFAULT_APPLICATION_NAME;
}

/**
 * The `User-Agent` every request to Allegro carries — **required on every call** from the end of
 * June 2026, and stated in Allegro's own shape: `ApplicationName/Version (+DocumentationURL)`.
 *
 * The name is meant to be the application registered at `apps.developer.allegro.pl`, which in a
 * self-hosted install is one the collector registered themselves and named whatever they liked — so
 * it is a setting (`AllegroConnection.applicationName`) rather than a constant, and this app's own
 * name is what it falls back to. That fallback is deliberate and not a failure state: Allegro's
 * reason for wanting the header is being able to reach whoever is generating the traffic, and
 * "Stamporama" plus a repository URL answers that even when the field is blank.
 *
 * Pure, so the shape is unit-tested rather than trusted — the same reason `deviceCodeUrl` is
 * exported.
 */
export function allegroUserAgent(applicationName: string | null, version: string): string {
  const name = sanitizeProductToken(applicationName ?? "");
  const productVersion = sanitizeProductToken(version || "dev");
  return `${name}/${productVersion} (+${USER_AGENT_URL})`;
}

/** HTTP Basic, the client authentication every one of these endpoints takes. */
function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

/** The headers all four exchanges share. The `User-Agent` is on the token endpoints too, not only on
 *  the API: Allegro asks for it on **every** request, and an application that identifies itself while
 *  reading orders but not while refreshing its token is exactly the half-identified caller the
 *  requirement exists to prevent. */
function oauthHeaders(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}): Record<string, string> {
  return {
    Authorization: basicAuth(opts.clientId, opts.clientSecret),
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": opts.userAgent,
  };
}

/** Raised when Allegro refuses an exchange. Carries Allegro's own `error` code where there is one,
 *  because the device poll has to tell "still waiting" apart from "denied" and both arrive as a
 *  400. */
export class AllegroOAuthError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "AllegroOAuthError";
    this.code = code;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Allegro states its failures as `{ error, error_description }`; a gateway in front of it may not
 *  state them at all, hence the status fallback. */
function oauthError(res: Response, body: Record<string, unknown>): AllegroOAuthError {
  const code = str(body.error);
  const description = str(body.error_description) ?? str(body.message);
  return new AllegroOAuthError(
    description ?? code ?? `Allegro returned HTTP ${res.status}.`,
    code
  );
}

// ---------------------------------------------------------------------------
// Device code flow
// ---------------------------------------------------------------------------

export interface AllegroDeviceCode {
  /** Held by the instance and polled with; never shown. */
  deviceCode: string;
  /** The short code the collector types on Allegro. */
  userCode: string;
  /** Where they type it. */
  verificationUri: string;
  /** The same page with the code already filled in, when Allegro supplies it — the link actually
   *  worth clicking. Null rather than a silently identical duplicate. */
  verificationUriComplete: string | null;
  /** Seconds until the code stops working. */
  expiresIn: number;
  /** Seconds Allegro asks us to wait between polls. Its own answer, honoured rather than guessed:
   *  polling faster earns `slow_down` and nothing else. */
  interval: number;
}

/**
 * The device endpoint's URL, `client_id` included.
 *
 * `client_id` goes in the **query string** here — this endpoint alone. Every other exchange puts
 * its parameters in the form body, and putting this one there too is what Allegro answers with
 * *"OAuth 2.0 Parameter: client_id"*: it reads the query, finds nothing, and never looks at the
 * body. Exported so the shape is unit-tested rather than trusted.
 */
export function deviceCodeUrl(clientId: string, sandbox: boolean): string {
  const params = new URLSearchParams({ client_id: clientId });
  return `${allegroHosts(sandbox).auth}/auth/oauth/device?${params.toString()}`;
}

/**
 * Ask Allegro for a device code. Step one of the default flow.
 *
 * The request carries **no body**: the documented call is the query parameter plus the Basic
 * header, and the scopes come from the application's own registration rather than from here.
 */
export async function requestDeviceCode(opts: {
  clientId: string;
  clientSecret: string;
  /** The identifying `User-Agent`, built by {@link allegroUserAgent}. */
  userAgent: string;
  sandbox: boolean;
}): Promise<AllegroDeviceCode> {
  const res = await fetch(deviceCodeUrl(opts.clientId, opts.sandbox), {
    method: "POST",
    headers: oauthHeaders(opts),
  });
  const body = await readJson(res);
  if (!res.ok) throw oauthError(res, body);

  const deviceCode = str(body.device_code);
  const userCode = str(body.user_code);
  const verificationUri = str(body.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new AllegroOAuthError("Allegro's device-code response was missing required fields.");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: str(body.verification_uri_complete),
    expiresIn: num(body.expires_in) ?? 600,
    interval: num(body.interval) ?? 5,
  };
}

/** What one poll of the device flow found. `pending` and `slow_down` are Allegro's own answers and
 *  are **not** errors — the collector simply has not confirmed yet — which is the whole reason this
 *  returns a union rather than throwing on a 400. */
export type AllegroDevicePoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "granted"; token: AllegroTokenResponse }
  | { status: "denied"; message: string }
  | { status: "expired"; message: string };

/** Poll once for the token behind a device code. */
export async function pollDeviceToken(opts: {
  clientId: string;
  clientSecret: string;
  /** The identifying `User-Agent`, built by {@link allegroUserAgent}. */
  userAgent: string;
  sandbox: boolean;
  deviceCode: string;
}): Promise<AllegroDevicePoll> {
  const res = await fetch(`${allegroHosts(opts.sandbox).auth}/auth/oauth/token`, {
    method: "POST",
    headers: oauthHeaders(opts),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: opts.deviceCode,
    }),
  });
  const body = await readJson(res);
  if (res.ok) return { status: "granted", token: readTokenResponse(body) };

  const code = str(body.error);
  const message = str(body.error_description) ?? code ?? `Allegro returned HTTP ${res.status}.`;
  if (code === "authorization_pending") return { status: "pending" };
  if (code === "slow_down") return { status: "slow_down" };
  if (code === "access_denied") return { status: "denied", message };
  if (code === "expired_token") return { status: "expired", message };
  throw oauthError(res, body);
}

// ---------------------------------------------------------------------------
// Authorization code flow
// ---------------------------------------------------------------------------

/** The URL to send the collector's browser to. `state` is minted by the caller and checked on the
 *  way back — this is a redirect a third party can trigger, so the callback has to be able to tell
 *  its own request from anyone else's. */
export function authorizationUrl(opts: {
  clientId: string;
  sandbox: boolean;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `${allegroHosts(opts.sandbox).auth}/auth/oauth/authorize?${params.toString()}`;
}

/** Exchange the `code` Allegro sent back for a grant. */
export async function exchangeAuthorizationCode(opts: {
  clientId: string;
  clientSecret: string;
  /** The identifying `User-Agent`, built by {@link allegroUserAgent}. */
  userAgent: string;
  sandbox: boolean;
  code: string;
  redirectUri: string;
}): Promise<AllegroTokenResponse> {
  const res = await fetch(`${allegroHosts(opts.sandbox).auth}/auth/oauth/token`, {
    method: "POST",
    headers: oauthHeaders(opts),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  const body = await readJson(res);
  if (!res.ok) throw oauthError(res, body);
  return readTokenResponse(body);
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * Trade a refresh token for a fresh grant.
 *
 * The refresh is **identical for both flows** and carries no `redirect_uri` — that parameter
 * belongs to the initial authorization-code exchange only. An earlier version of this branched on
 * how the grant was obtained; it was wrong, and it would have failed every code-flow refresh three
 * months in, where the cost is a silent reconnection rather than a visible error.
 */
export async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  /** The identifying `User-Agent`, built by {@link allegroUserAgent}. */
  userAgent: string;
  sandbox: boolean;
  refreshToken: string;
}): Promise<AllegroTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
  });

  const res = await fetch(`${allegroHosts(opts.sandbox).auth}/auth/oauth/token`, {
    method: "POST",
    headers: oauthHeaders(opts),
    body: params,
  });
  const body = await readJson(res);
  if (!res.ok) throw oauthError(res, body);
  return readTokenResponse(body);
}

// ---------------------------------------------------------------------------
// Scopes (#485)
// ---------------------------------------------------------------------------
//
// Nothing here *requests* a scope — see the note at the top of this file. What these do is read back
// which permissions the application the collector registered actually carries, so that "publishing
// needs the sale-offer write access" can be answered on the settings tab rather than as a 403 three
// screens later.
//
// The source is the access token itself: Allegro issues a JWT whose payload carries a `scope` array.
// It is read **for display only** and never verified — this app is not the token's audience and has
// no key to verify it with, and nothing is authorized on the strength of what it says. Allegro is
// still the only thing that decides what a call may do; this only decides what the panel says.

/** Creating and updating one's own offers, and uploading the images they carry. The one permission
 *  publishing (#477, #487) cannot be done without. */
export const ALLEGRO_SALE_OFFERS_WRITE_SCOPE = "allegro:api:sale:offers:write";

/** Reading one's own offers — what the sold-listing sweep (#467) and the bidding poll (#481) use. */
export const ALLEGRO_SALE_OFFERS_READ_SCOPE = "allegro:api:sale:offers:read";

/**
 * The scopes an access token carries, or **null** when they cannot be read.
 *
 * Null is not "none": a token that is not a JWT, or one whose payload states no scope, is a token
 * this app cannot describe — and rendering that as an empty permission list would tell the collector
 * their application grants nothing, which is a claim it has no basis for. The two states are
 * therefore kept apart all the way to the screen.
 */
export function readTokenScopes(accessToken: string | null): string[] | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const scope = (payload as { scope?: unknown })?.scope;
  // An array is what Allegro sends; the space-delimited string is OAuth's own form, accepted so that
  // a change of shape reads as fewer permissions rather than as none at all.
  const values = Array.isArray(scope)
    ? scope
    : typeof scope === "string"
      ? scope.split(/\s+/)
      : null;
  if (!values) return null;
  const scopes = values.filter((one): one is string => typeof one === "string" && one.length > 0);
  return scopes.length > 0 ? scopes : null;
}

/** Whether a token's scopes allow publishing. Null in, null out — "not known" is not "no", and the
 *  panel says so rather than warning about a permission it could not read. */
export function grantsOfferPublishing(scopes: string[] | null): boolean | null {
  if (!scopes) return null;
  return scopes.includes(ALLEGRO_SALE_OFFERS_WRITE_SCOPE);
}

// ---------------------------------------------------------------------------
// Token response
// ---------------------------------------------------------------------------

export interface AllegroTokenResponse {
  accessToken: string;
  /** Absent when Allegro chose not to rotate it — the stored one then stands. */
  refreshToken: string | null;
  /** Absolute, computed here from `expires_in`, because everything above stores an instant. */
  expiresAt: Date;
}

/** Read a token endpoint's body. Exported for the unit tests, which is also why it takes a plain
 *  object rather than a `Response`. */
export function readTokenResponse(body: Record<string, unknown>): AllegroTokenResponse {
  const accessToken = str(body.access_token);
  if (!accessToken) {
    throw new AllegroOAuthError("Allegro's token response carried no access token.");
  }
  // A default rather than a refusal: a grant with an unstated lifetime is still a usable grant, and
  // an hour is Allegro's own, so the worst case is one early refresh.
  const expiresIn = num(body.expires_in) ?? 3600;
  return {
    accessToken,
    refreshToken: str(body.refresh_token),
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}
