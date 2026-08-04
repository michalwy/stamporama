import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { appBaseUrl } from "./app-url";
import { AllegroApiError, allegroWhoAmI } from "./allegro-api";
import { getAppVersion } from "./version";
import {
  AllegroOAuthError,
  type AllegroTokenResponse,
  allegroRedirectUri,
  allegroUserAgent,
  authorizationUrl,
  exchangeAuthorizationCode,
  grantsOfferPublishing,
  readTokenScopes,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
} from "./allegro-oauth";
import {
  SECRET_KEY_ENV,
  SecretDecryptError,
  SecretKeyMissingError,
  openSecret,
  sealSecret,
  secretKeyConfigured,
} from "./secret-box";

// The Allegro connection's token store (#476; ADR-0023) — one per collection, and the only module
// that decrypts anything.
//
// The shape it exists to guarantee: a caller downstream (#467, #463) asks for an access token and
// either gets a usable one or gets told the connection needs reconnecting. It never gets a token
// that is about to expire, and it never has to know a refresh happened.

/** Refresh this far ahead of expiry. A token that expires mid-request is indistinguishable from a
 *  revoked one to the caller, and re-running a page of orders to find that out is worse than one
 *  early refresh. */
const REFRESH_LEEWAY_MS = 120_000;

// ---------------------------------------------------------------------------
// Pending flows
// ---------------------------------------------------------------------------
//
// A device code and a code-flow `state` live in memory rather than in the row, deliberately: both
// are single-use and expire in minutes, and persisting them would put a third and fourth secret in
// a table whose whole point is that it holds as few as possible. Losing them to a restart costs the
// collector one click on Connect — losing a *token* is what the row is for.
//
// Pinned to `globalThis` so `next dev`'s HMR reuses one map instead of stranding a flow behind a
// reload of this module.

interface PendingDevice {
  deviceCode: string;
  expiresAt: number;
  /** Allegro's own polling interval, in ms, raised whenever it answers `slow_down`. */
  intervalMs: number;
  nextPollAt: number;
}

interface PendingState {
  collectionId: string;
  ownerId: string;
  expiresAt: number;
}

const globalForAllegro = globalThis as unknown as {
  allegroPendingDevice?: Map<string, PendingDevice>;
  allegroPendingState?: Map<string, PendingState>;
};

const pendingDevice = (globalForAllegro.allegroPendingDevice ??= new Map());
const pendingState = (globalForAllegro.allegroPendingState ??= new Map());

function prunePending(now: number): void {
  for (const [key, value] of pendingDevice) if (value.expiresAt <= now) pendingDevice.delete(key);
  for (const [key, value] of pendingState) if (value.expiresAt <= now) pendingState.delete(key);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** Everything Settings shows about the connection. Carries **no secret** — not the client secret,
 *  not either token — because this crosses to the browser. */
export interface AllegroConnectionStatus {
  /** Whether an application has been configured at all. */
  configured: boolean;
  clientId: string | null;
  /** The name of the registered application, as it goes into the `User-Agent` Allegro requires.
   *  Null when unset, which the panel renders as the `Stamporama` fallback rather than as blank. */
  applicationName: string | null;
  /** Whether a client secret is stored. Never the value: it is write-only from the browser's side. */
  hasClientSecret: boolean;
  sandbox: boolean;
  /** True once a flow has completed and a grant is stored. */
  connected: boolean;
  accountLogin: string | null;
  lastRefreshedAt: string | null;
  expiresAt: string | null;
  /** The explicit "needs reconnecting" state — a rejected refresh, or secrets that no longer
   *  decrypt — rather than every later call failing on its own. */
  needsReconnect: boolean;
  lastError: string | null;
  /** False when `STAMPORAMA_SECRET_KEY` is unset. Stated on the tab, because without it nothing
   *  here can be saved and the reason is in a file, not on the screen. */
  secretKeyConfigured: boolean;
  /** The redirect URI to register with Allegro, or null when the instance has no configured base
   *  URL — which is exactly when the code flow is not available and the device flow is the answer. */
  redirectUri: string | null;
  /** What the connected application is actually permitted to do (#485), read off the access token.
   *  **Null is not an empty list**: it is a token whose scopes could not be read, and the panel says
   *  so rather than claiming the application grants nothing. */
  scopes: string[] | null;
  /** Whether those scopes include the sale-offer write access publishing needs. Null where the
   *  scopes are unknown, so "cannot publish" is never asserted without a basis. */
  canPublishOffers: boolean | null;
}

function toStatus(
  row: {
    clientId: string;
    applicationName: string | null;
    clientSecretSealed: string;
    sandbox: boolean;
    refreshTokenSealed: string | null;
    expiresAt: Date | null;
    accountLogin: string | null;
    needsReconnect: boolean;
    lastError: string | null;
    lastRefreshedAt: Date | null;
  } | null,
  /** Read by the caller, which is the only thing that may open a sealed token. */
  scopes: string[] | null = null
): AllegroConnectionStatus {
  const base = appBaseUrl();
  const redirectUri = base ? allegroRedirectUri(base) : null;
  if (!row) {
    return {
      configured: false,
      clientId: null,
      applicationName: null,
      hasClientSecret: false,
      sandbox: false,
      connected: false,
      accountLogin: null,
      lastRefreshedAt: null,
      expiresAt: null,
      needsReconnect: false,
      lastError: null,
      secretKeyConfigured: secretKeyConfigured(),
      redirectUri,
      scopes: null,
      canPublishOffers: null,
    };
  }
  return {
    configured: true,
    clientId: row.clientId,
    applicationName: row.applicationName,
    hasClientSecret: row.clientSecretSealed.length > 0,
    sandbox: row.sandbox,
    connected: row.refreshTokenSealed !== null,
    accountLogin: row.accountLogin,
    lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    needsReconnect: row.needsReconnect,
    lastError: row.lastError,
    secretKeyConfigured: secretKeyConfigured(),
    redirectUri,
    scopes,
    canPublishOffers: grantsOfferPublishing(scopes),
  };
}

/**
 * The connection's status for Settings.
 *
 * The permissions (#485) are read off the stored access token, which is why this is the one status
 * read that opens a secret: the scopes themselves are not one — they are a list of what the
 * collector's own application may do — but they arrive inside something that is. An unreadable token
 * reads as *unknown permissions*, never as none: `needsReconnect` is what says the connection is
 * broken, and this line must not say it a second time in different words.
 */
export async function getAllegroConnectionStatus(
  ownerId: string,
  collectionId: string
): Promise<AllegroConnectionStatus> {
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.allegroConnection.findUnique({ where: { collectionId } });
  let scopes: string[] | null = null;
  if (row?.accessTokenSealed) {
    try {
      scopes = readTokenScopes(openSecret(row.accessTokenSealed));
    } catch {
      scopes = null;
    }
  }
  return toStatus(row, scopes);
}

/**
 * Save the registered application's credentials.
 *
 * A blank `clientSecret` **keeps** the stored one, which is what makes the field write-only: the
 * browser is never sent the secret, so it cannot send it back, and re-saving the sandbox toggle
 * must not wipe it. Changing the client id or the sandbox flag **drops the grant** — it belongs to
 * the application that issued it, and a token from one application replayed against another is a
 * silent authentication failure later rather than an obvious one now.
 */
export async function saveAllegroCredentials(
  ownerId: string,
  collectionId: string,
  input: {
    clientId: string;
    clientSecret: string | null;
    sandbox: boolean;
    /** What the application is called on Allegro. Blank clears it back to the fallback name — it is
     *  a label, not a credential, so "leave blank to keep" would be the wrong rule here. */
    applicationName: string | null;
  }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);

  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("Client ID is required.");

  const existing = await prisma.allegroConnection.findUnique({ where: { collectionId } });
  const secret = input.clientSecret?.trim() || null;

  if (!existing && !secret) throw new Error("Client secret is required.");
  if (!secretKeyConfigured()) {
    throw new SecretKeyMissingError(
      `${SECRET_KEY_ENV} is not set. It is required to store Allegro credentials; generate one with \`openssl rand -base64 32\` and restart.`
    );
  }

  const sealedSecret = secret ? sealSecret(secret) : existing!.clientSecretSealed;
  const applicationChanged =
    existing !== null && (existing.clientId !== clientId || existing.sandbox !== input.sandbox);

  const grantReset = applicationChanged
    ? {
        accessTokenSealed: null,
        refreshTokenSealed: null,
        expiresAt: null,
        accountId: null,
        accountLogin: null,
        needsReconnect: false,
        lastError: null,
        lastRefreshedAt: null,
      }
    : {};

  await prisma.allegroConnection.upsert({
    where: { collectionId },
    create: {
      collectionId,
      clientId,
      applicationName: input.applicationName?.trim() || null,
      clientSecretSealed: sealedSecret,
      sandbox: input.sandbox,
    },
    update: {
      clientId,
      applicationName: input.applicationName?.trim() || null,
      clientSecretSealed: sealedSecret,
      sandbox: input.sandbox,
      ...grantReset,
    },
  });

  pendingDevice.delete(collectionId);
}

/** Forget the connection entirely. Local only, by decision (ADR-0023 §4): a local drop always
 *  succeeds — including when the token is already dead, which is the state one is most likely to be
 *  disconnecting *from* — whereas a revoke adds a failure path whose only honest handling is to
 *  disconnect anyway. The grant stays listed in the collector's Allegro account until they remove
 *  it there, which the user guide says. */
export async function disconnectAllegro(ownerId: string, collectionId: string): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  pendingDevice.delete(collectionId);
  await prisma.allegroConnection.deleteMany({ where: { collectionId } });
}

// ---------------------------------------------------------------------------
// Credentials, opened
// ---------------------------------------------------------------------------

interface OpenedCredentials {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
  /** The identifying header every call to Allegro carries, built once from the stored application
   *  name so that no caller downstream has to know it exists. */
  userAgent: string;
}

async function openCredentials(collectionId: string): Promise<OpenedCredentials> {
  const row = await prisma.allegroConnection.findUnique({ where: { collectionId } });
  if (!row) throw new Error("No Allegro application is configured for this collection.");
  return {
    clientId: row.clientId,
    clientSecret: openSecret(row.clientSecretSealed),
    sandbox: row.sandbox,
    userAgent: allegroUserAgent(row.applicationName, getAppVersion()),
  };
}

/** Record a completed grant and identify who it belongs to. Shared by both flows — which is more
 *  than tidiness, since a refreshed grant is indistinguishable between them: same endpoint, same
 *  parameters, nothing about the original flow replayed. */
async function storeGrant(
  collectionId: string,
  credentials: OpenedCredentials,
  token: AllegroTokenResponse
): Promise<void> {
  // The grant is written **first**, and nothing is allowed to stop it. Allegro has just issued a
  // working token; throwing it away over anything that happens next means the collector confirms a
  // code on their phone and lands back on "Not connected yet."
  await prisma.allegroConnection.update({
    where: { collectionId },
    data: {
      accessTokenSealed: sealSecret(token.accessToken),
      // Allegro rotates the refresh token on most grants but is not obliged to; an absent one
      // leaves the stored one standing rather than clearing the connection.
      ...(token.refreshToken ? { refreshTokenSealed: sealSecret(token.refreshToken) } : {}),
      expiresAt: token.expiresAt,
      needsReconnect: false,
      lastError: null,
      lastRefreshedAt: new Date(),
    },
  });

  // Naming the account is a **courtesy, not a precondition**. `GET /me` needs the profile scope,
  // which an application registered only for offers and orders does not carry — and that
  // application is completely able to do everything #467 and #463 will ask of it. An earlier
  // version made this the gate and turned a granted token into a failed connection.
  try {
    const account = await allegroWhoAmI({
      sandbox: credentials.sandbox,
      accessToken: token.accessToken,
      userAgent: credentials.userAgent,
    });
    await prisma.allegroConnection.update({
      where: { collectionId },
      data: { accountId: account.id, accountLogin: account.login },
    });
  } catch {
    // Left null, which the status line renders as a connection without a name rather than as a
    // fault. Deliberately not recorded in `lastError`: that field drives "needs reconnecting", and
    // reconnecting fixes nothing here.
    await prisma.allegroConnection.update({
      where: { collectionId },
      data: { accountId: null, accountLogin: null },
    });
  }
}

// ---------------------------------------------------------------------------
// Device code flow — the default
// ---------------------------------------------------------------------------

/** What the collector is shown while the device flow runs. */
export interface AllegroDevicePrompt {
  userCode: string;
  verificationUri: string;
  /** The same page with the code filled in, where Allegro supplies one — the link worth clicking. */
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** Start the device flow. The device code stays on the server; only the user code and URL cross to
 *  the browser. */
export async function startAllegroDeviceFlow(
  ownerId: string,
  collectionId: string
): Promise<AllegroDevicePrompt> {
  await assertCollectionOwner(ownerId, collectionId);
  const credentials = await openCredentials(collectionId);
  const code = await requestDeviceCode(credentials);

  const now = Date.now();
  prunePending(now);
  pendingDevice.set(collectionId, {
    deviceCode: code.deviceCode,
    expiresAt: now + code.expiresIn * 1000,
    intervalMs: code.interval * 1000,
    nextPollAt: now + code.interval * 1000,
  });

  return {
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    verificationUriComplete: code.verificationUriComplete,
    expiresInSeconds: code.expiresIn,
    intervalSeconds: code.interval,
  };
}

/** One poll of a running device flow. `waiting` is not an error — it is the collector not having
 *  confirmed yet — which is why the browser can call this on a timer without a failed request per
 *  tick. */
export type AllegroDeviceResult =
  | { status: "waiting"; retryInSeconds: number }
  | { status: "connected"; accountLogin: string | null }
  | { status: "failed"; message: string };

export async function pollAllegroDeviceFlow(
  ownerId: string,
  collectionId: string
): Promise<AllegroDeviceResult> {
  await assertCollectionOwner(ownerId, collectionId);

  const now = Date.now();
  const pending = pendingDevice.get(collectionId);
  if (!pending) {
    return { status: "failed", message: "This connection attempt is no longer running. Start again." };
  }
  if (pending.expiresAt <= now) {
    pendingDevice.delete(collectionId);
    return { status: "failed", message: "The code expired before it was confirmed. Start again." };
  }
  // Allegro's own interval is honoured rather than guessed at: polling faster earns `slow_down` and
  // nothing else, so a browser ticking too eagerly is told to wait instead of being passed through.
  if (pending.nextPollAt > now) {
    return { status: "waiting", retryInSeconds: Math.ceil((pending.nextPollAt - now) / 1000) };
  }

  const credentials = await openCredentials(collectionId);
  let poll;
  try {
    poll = await pollDeviceToken({ ...credentials, deviceCode: pending.deviceCode });
  } catch (err) {
    pendingDevice.delete(collectionId);
    return { status: "failed", message: describeError(err) };
  }

  if (poll.status === "slow_down") {
    pending.intervalMs += 5000;
    pending.nextPollAt = Date.now() + pending.intervalMs;
    return { status: "waiting", retryInSeconds: Math.ceil(pending.intervalMs / 1000) };
  }
  if (poll.status === "pending") {
    pending.nextPollAt = Date.now() + pending.intervalMs;
    return { status: "waiting", retryInSeconds: Math.ceil(pending.intervalMs / 1000) };
  }
  if (poll.status === "denied" || poll.status === "expired") {
    pendingDevice.delete(collectionId);
    return { status: "failed", message: poll.message };
  }

  pendingDevice.delete(collectionId);
  try {
    await storeGrant(collectionId, credentials, poll.token);
  } catch (err) {
    return { status: "failed", message: describeError(err) };
  }

  const row = await prisma.allegroConnection.findUnique({
    where: { collectionId },
    select: { accountLogin: true },
  });
  // Null when the application carries no profile scope — a nameless connection, not a failed one.
  return { status: "connected", accountLogin: row?.accountLogin ?? null };
}

// ---------------------------------------------------------------------------
// Authorization code flow — the alternative
// ---------------------------------------------------------------------------

/** Begin the code flow, returning the URL to send the browser to. Refuses when the instance has no
 *  configured base URL: without one there is no redirect URI to register, which is precisely the
 *  install the device flow exists for. */
export async function startAllegroCodeFlow(
  ownerId: string,
  collectionId: string
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const base = appBaseUrl();
  if (!base) {
    throw new Error(
      "This instance has no configured address (BETTER_AUTH_URL), so Allegro has nowhere to send you back to. Use the device code instead."
    );
  }
  const credentials = await openCredentials(collectionId);
  const state = randomBytes(24).toString("base64url");

  const now = Date.now();
  prunePending(now);
  // Ten minutes: long enough to sign in and confirm on Allegro, short enough that a state left
  // behind by an abandoned attempt is not a lasting entry.
  pendingState.set(state, { collectionId, ownerId, expiresAt: now + 600_000 });

  return authorizationUrl({
    clientId: credentials.clientId,
    sandbox: credentials.sandbox,
    redirectUri: allegroRedirectUri(base),
    state,
  });
}

/** Which collection a pending state belongs to, without spending it — the callback needs this to
 *  land the collector back on the right Settings tab even when Allegro refused, and a refusal has
 *  no code to exchange. Returns null for a state that was never minted here or has expired. */
export function peekAllegroCodeFlow(state: string): { collectionId: string } | null {
  prunePending(Date.now());
  const pending = pendingState.get(state);
  return pending ? { collectionId: pending.collectionId } : null;
}

/** Drop a pending state without completing it. The failure path spends it too: the attempt is over
 *  either way, and leaving it live would let the same link be replayed. */
export function abandonAllegroCodeFlow(state: string): void {
  pendingState.delete(state);
}

/**
 * Complete the code flow from the callback route.
 *
 * `state` is the whole authorization: this is a URL a third party can make the collector's browser
 * visit, so the callback trusts nothing in the query but the state it minted itself — which is also
 * where the collection and the owner come from, rather than from anything the caller supplies.
 */
export async function completeAllegroCodeFlow(
  state: string,
  code: string
): Promise<{ collectionId: string }> {
  const now = Date.now();
  prunePending(now);
  const pending = pendingState.get(state);
  if (!pending) throw new Error("This sign-in link is no longer valid. Start again from Settings.");
  // Single use: a replayed callback is not a second connection.
  pendingState.delete(state);

  const base = appBaseUrl();
  if (!base) throw new Error("This instance has no configured address (BETTER_AUTH_URL).");
  const redirectUri = allegroRedirectUri(base);

  const credentials = await openCredentials(pending.collectionId);
  const token = await exchangeAuthorizationCode({ ...credentials, code, redirectUri });
  await storeGrant(pending.collectionId, credentials, token);
  return { collectionId: pending.collectionId };
}

// ---------------------------------------------------------------------------
// Using the connection
// ---------------------------------------------------------------------------

/**
 * What one authenticated call needs: the token, which environment it is for, and how this instance
 * identifies itself. Exported because the sync passes it around whole (`{ ...token }`) and annotates
 * it in half a dozen places — one type so a fourth field lands in all of them at once.
 */
export interface AllegroCallCredentials {
  accessToken: string;
  sandbox: boolean;
  userAgent: string;
}

/** Raised when there is no usable grant. Distinct from an API failure, because the fix is a
 *  reconnection in Settings rather than a retry. */
export class AllegroNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllegroNotConnectedError";
  }
}

async function latchNeedsReconnect(collectionId: string, message: string): Promise<void> {
  await prisma.allegroConnection.update({
    where: { collectionId },
    data: { needsReconnect: true, lastError: message },
  });
}

/**
 * Latch the needs-reconnect state from outside this module — what the background sync (#467) does
 * with a 401. Exported rather than left to the caller's own `update` so that every unusable state
 * still converges on the one pair of columns the settings panel reads (ADR-0023).
 */
export async function markAllegroConnectionRejected(
  collectionId: string,
  message: string
): Promise<void> {
  await latchNeedsReconnect(collectionId, message);
}

/**
 * A usable access token for this collection, refreshed ahead of expiry.
 *
 * The entry point for everything downstream (#467, #463): a caller either gets a token it can use
 * for the next couple of minutes, or an {@link AllegroNotConnectedError} — never a token that is
 * about to expire, and never a decision to make about refreshing.
 */
export async function getAllegroAccessToken(
  ownerId: string,
  collectionId: string
): Promise<AllegroCallCredentials> {
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.allegroConnection.findUnique({ where: { collectionId } });
  if (!row || !row.refreshTokenSealed) {
    throw new AllegroNotConnectedError("This collection is not connected to Allegro.");
  }
  if (row.needsReconnect) {
    throw new AllegroNotConnectedError(
      row.lastError ?? "The Allegro connection needs reconnecting."
    );
  }

  let clientSecret: string;
  let refreshToken: string;
  let accessToken: string | null;
  try {
    clientSecret = openSecret(row.clientSecretSealed);
    refreshToken = openSecret(row.refreshTokenSealed);
    accessToken = row.accessTokenSealed ? openSecret(row.accessTokenSealed) : null;
  } catch (err) {
    // Unreadable secrets are exactly as unusable as a rejected refresh, and the collector's next
    // step is the same either way — so they land in the same state rather than in an error only a
    // log would show.
    const message =
      err instanceof SecretDecryptError || err instanceof SecretKeyMissingError
        ? err.message
        : "The stored Allegro credentials could not be read.";
    await latchNeedsReconnect(collectionId, message);
    throw new AllegroNotConnectedError(message);
  }

  const stillFresh =
    accessToken !== null &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() - REFRESH_LEEWAY_MS > Date.now();
  const userAgent = allegroUserAgent(row.applicationName, getAppVersion());
  if (stillFresh) return { accessToken: accessToken!, sandbox: row.sandbox, userAgent };

  let refreshed: AllegroTokenResponse;
  try {
    refreshed = await refreshAccessToken({
      clientId: row.clientId,
      clientSecret,
      sandbox: row.sandbox,
      refreshToken,
      userAgent,
    });
  } catch (err) {
    const message = describeError(err);
    await latchNeedsReconnect(collectionId, message);
    throw new AllegroNotConnectedError(`Allegro refused to refresh the connection: ${message}`);
  }

  await prisma.allegroConnection.update({
    where: { collectionId },
    data: {
      accessTokenSealed: sealSecret(refreshed.accessToken),
      ...(refreshed.refreshToken ? { refreshTokenSealed: sealSecret(refreshed.refreshToken) } : {}),
      expiresAt: refreshed.expiresAt,
      needsReconnect: false,
      lastError: null,
      lastRefreshedAt: new Date(),
    },
  });

  return { accessToken: refreshed.accessToken, sandbox: row.sandbox, userAgent };
}

/** One authenticated call, end to end — the check Settings offers and the shape #467 and #463 will
 *  build on. A 401 here latches the needs-reconnect state: the token was refused, and repeating the
 *  call is not what fixes that. */
export async function testAllegroConnection(
  ownerId: string,
  collectionId: string
): Promise<{ accountLogin: string | null; detail: string }> {
  const { accessToken, sandbox, userAgent } = await getAllegroAccessToken(ownerId, collectionId);
  try {
    const account = await allegroWhoAmI({ sandbox, accessToken, userAgent });
    await prisma.allegroConnection.update({
      where: { collectionId },
      data: { accountId: account.id, accountLogin: account.login },
    });
    return { accountLogin: account.login, detail: `Allegro answered as ${account.login}.` };
  } catch (err) {
    if (err instanceof AllegroApiError && err.unauthorized) {
      // 401 is the token being refused, which reconnecting is the fix for.
      await latchNeedsReconnect(collectionId, err.message);
      throw new AllegroNotConnectedError(err.message);
    }
    // 403 is the opposite conclusion, and telling the two apart is the whole point of this call:
    // Allegro accepted the token and then declined *this endpoint*. `GET /me` needs the profile
    // scope, which an application registered only for offers and orders does not have — so the
    // connection is working and simply cannot say whose it is.
    if (err instanceof AllegroApiError && err.status === 403) {
      return {
        accountLogin: null,
        detail:
          "Allegro accepted the connection. It will not say which account it is, because the application has no profile access — add the profile scope to it if you want the name shown here. Nothing else needs it.",
      };
    }
    throw err;
  }
}

/** One message per failure, whatever kind it was — these all end up in front of the collector on
 *  the same line, and "something went wrong" would be the least useful of them. */
function describeError(err: unknown): string {
  if (err instanceof AllegroOAuthError) return err.message;
  if (err instanceof AllegroApiError) return err.message;
  if (err instanceof SecretKeyMissingError || err instanceof SecretDecryptError) return err.message;
  if (err instanceof Error) return err.message;
  return "Allegro could not be reached.";
}
